// A fixed battery of deterministic-Math inputs and the hash of the exact
// result bits. Node, every browser engine and every peer must produce the same
// hash: run detMathFingerprint() in each and compare it with GOLDEN.
import { sin, cos, atan2, hypot } from './detmath.js';

// The fingerprint every engine must produce.
export const GOLDEN = 'cc6ed4f6';

export function detMathFingerprint() {
  const dv = new DataView(new ArrayBuffer(8));
  let h = 0x811c9dc5, s = 12345;
  const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
  const mix = (x) => { dv.setFloat64(0, x); h = Math.imul(h ^ dv.getUint32(0), 0x01000193); h = Math.imul(h ^ dv.getUint32(4), 0x01000193); };
  for (let i = 0; i < 1000; i++) {
    const a = (rnd() * 2 - 1) * 8, y = (rnd() * 2 - 1) * 3072, x = (rnd() * 2 - 1) * 3072;
    mix(sin(a)); mix(cos(a)); mix(atan2(y, x)); mix(hypot(y, x));
  }
  for (const v of [0, -0, 1e-300, 7e-9, Math.PI / 4, Math.PI, 1e6, 3e6]) { mix(sin(v)); mix(cos(v)); mix(atan2(v, -1)); mix(hypot(v, 3)); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
