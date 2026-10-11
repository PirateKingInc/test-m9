// Exact serialisation of a game's state, for snapshots and state hashes.
//
// A graph serialisation of live objects: plain objects and arrays, Map, Set,
// typed arrays, instances of registered classes, shared references and cycles,
// and exact numbers (-0, NaN, Infinity and undefined are kept, which JSON would
// lose). Constant data (tables that never change during a match) can be
// written as a reference by name instead of copied, so a restored state points
// at the same objects. Fields that are not state (caches, libraries, closures)
// are skipped per class and rebuilt by a per-class fixup after decoding.
// Anything unexpected (an unregistered class, a function in a field) throws: a
// snapshot is exact or it is refused.
//
//   const codec = createCodec({
//     classes: { Board, Piece },              // name -> class, for instances
//     skip: { Board: ['cache'] },             // fields that are not state
//     fixups: { Board(b, ctx) { b.cache = new Map(); } }, // rebuild them
//     constants: { rules: RULES_MODULE },     // data written by reference
//   });
//   const text = codec.serialize(state);      // a string
//   const copy = codec.deserialize(text, ctx); // ctx is passed to the fixups
//
// A state made only of plain data needs no options at all: createCodec().

const TYPED = { Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array, Uint8ClampedArray };

export function createCodec({ classes = {}, skip = {}, fixups = {}, constants = {} } = {}) {
  const CLASSES = new Map(); // name -> class
  const NAMES = new Map(); // prototype -> name
  const SKIP = new Map(Object.entries(skip).map(([n, fields]) => [n, new Set(fields)]));
  const FIXUPS = { ...fixups };
  const EXT = new Map(); // object -> path
  const EXT_BY_PATH = new Map();

  const register = (name, cls) => { CLASSES.set(name, cls); NAMES.set(cls.prototype, name); };
  for (const [n, c] of Object.entries(classes)) register(n, c);

  // Constant data: every object reachable from each named root, by path.
  const walk = (v, path) => {
    if (v === null || typeof v !== 'object' || EXT.has(v)) return;
    EXT.set(v, path);
    EXT_BY_PATH.set(path, v);
    for (const k of Object.keys(v)) walk(v[k], `${path}.${k}`);
  };
  for (const [name, root] of Object.entries(constants)) {
    for (const [k, v] of Object.entries(root)) walk(v, `${name}.${k}`);
  }

  const num = (v) => (Number.isFinite(v) && !Object.is(v, -0) ? v : { $n: Object.is(v, -0) ? '-0' : String(v) });
  const unnum = (v) => (typeof v === 'object' ? (v.$n === '-0' ? -0 : Number(v.$n)) : v);

  function encode(root) {
    const ids = new Map();
    let next = 1;
    const enc = (v, path) => {
      if (v === undefined) return { $u: 1 };
      if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
      if (typeof v === 'number') return num(v);
      if (typeof v === 'function') throw new Error(`snapshot: a function in state at ${path}`);
      if (typeof v !== 'object') throw new Error(`snapshot: unsupported ${typeof v} at ${path}`);
      const ext = EXT.get(v);
      if (ext) return { $x: ext };
      if (ids.has(v)) return { $r: ids.get(v) };
      const id = next++;
      ids.set(v, id);
      if (Array.isArray(v)) return { $i: id, $a: v.map((x, i) => enc(x, `${path}[${i}]`)) };
      if (v instanceof Map) return { $i: id, $m: [...v].map(([k, x]) => [enc(k, `${path}<key>`), enc(x, `${path}<${String(k)}>`)]) };
      if (v instanceof Set) return { $i: id, $s: [...v].map((x) => enc(x, `${path}<set>`)) };
      if (ArrayBuffer.isView(v)) return { $i: id, $t: v.constructor.name, d: Array.from(v, num) }; // num: a float array's -0 and NaN too
      const proto = Object.getPrototypeOf(v);
      let cls = null;
      if (proto !== Object.prototype && proto !== null) {
        cls = NAMES.get(proto);
        if (!cls) throw new Error(`snapshot: unregistered class ${proto.constructor?.name} at ${path}`);
      }
      const sk = cls && SKIP.get(cls), o = {};
      for (const k of Object.keys(v)) if (!sk || !sk.has(k)) o[k] = enc(v[k], `${path}.${k}`);
      return cls ? { $i: id, $c: cls, $o: o } : { $i: id, $o: o };
    };
    return enc(root, '$');
  }

  function decode(data, ctx = {}) {
    const objs = new Map();
    const made = []; // [object, class name] for the fixups
    const dec = (v) => {
      if (v === null || typeof v !== 'object') return v;
      if ('$u' in v) return undefined;
      if ('$n' in v) return v.$n === '-0' ? -0 : Number(v.$n);
      if ('$x' in v) { const o = EXT_BY_PATH.get(v.$x); if (!o) throw new Error(`snapshot: unknown data ${v.$x}`); return o; }
      if ('$r' in v) { if (!objs.has(v.$r)) throw new Error(`snapshot: dangling reference ${v.$r}`); return objs.get(v.$r); }
      if ('$a' in v) { const a = []; objs.set(v.$i, a); for (const x of v.$a) a.push(dec(x)); return a; }
      if ('$m' in v) { const m = new Map(); objs.set(v.$i, m); for (const [k, x] of v.$m) m.set(dec(k), dec(x)); return m; }
      if ('$s' in v) { const s = new Set(); objs.set(v.$i, s); for (const x of v.$s) s.add(dec(x)); return s; }
      if ('$t' in v) { const t = new TYPED[v.$t](v.d.map(unnum)); objs.set(v.$i, t); return t; }
      const cls = v.$c ? CLASSES.get(v.$c) : null;
      if (v.$c && !cls) throw new Error(`snapshot: unknown class ${v.$c}`);
      const o = cls ? Object.create(cls.prototype) : {};
      objs.set(v.$i, o);
      for (const k of Object.keys(v.$o)) o[k] = dec(v.$o[k]);
      if (cls) made.push([o, v.$c]);
      return o;
    };
    const root = dec(data);
    for (const [o, name] of made) FIXUPS[name]?.(o, ctx);
    return root;
  }

  const serialize = (root) => JSON.stringify(encode(root));
  const deserialize = (text, ctx) => decode(JSON.parse(text), ctx);
  return { register, encode, decode, serialize, deserialize, hash: (root) => hashText(serialize(root)) };
}

// 64-bit FNV-1a over a string, as 16 hex digits.
export function hashText(s) {
  let h1 = 0x811c9dc5, h2 = 0xcbf29ce4;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c * 31 + (i & 0xff)), 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
