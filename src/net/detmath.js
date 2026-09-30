// Phase 11: deterministic Math for multiplayer (PHASE11_SPEC.md "Determinism").
// ECMAScript leaves Math.sin/cos/atan2/hypot "implementation-approximated", so
// two browser engines may disagree in the last bit, and lockstep peers would
// drift apart. These replacements use only + - * /, comparisons, Math.sqrt
// (correctly rounded by IEEE 754, in hardware everywhere) and explicit bit
// reads, so every engine evaluates exactly the same operations. The
// algorithms are fdlibm's (via musl): accurate to about one unit in the last
// place. Installed only while a multiplayer match runs; single-player and all
// existing fingerprints keep the native functions.

const view = new DataView(new ArrayBuffer(8));
const hiWord = (x) => { view.setFloat64(0, x); return view.getUint32(0); }; // big-endian: high word first
const expBits = (x) => (hiWord(x) >>> 20) & 0x7ff;
const signBit = (x) => x < 0 || Object.is(x, -0);

// ---- sin / cos -------------------------------------------------------------

const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
  S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05,
  C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;

function kSin(x, y, iy) {
  const z = x * x, w = z * z;
  const r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6);
  const v = z * x;
  if (iy === 0) return x + v * (S1 + z * r);
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}

function kCos(x, y) {
  const z = x * x, w = z * z;
  const r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
  const hz = 0.5 * z, one = 1.0 - hz;
  return one + (((1.0 - one) - hz) + (z * r - x * y));
}

const INVPIO2 = 6.36619772367581382433e-01, TOINT = 6755399441055744; // 1.5 / 2^-52
const PIO2_1 = 1.57079632673412561417e+00, PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.07710050630396597660e-11, PIO2_2T = 2.02226624879595063154e-21;
const PIO2_3 = 2.02226624871116645580e-21, PIO2_3T = 8.47842766036889956997e-32;
const PIO4 = 0.785398163397448309616, TWOPI = 6.283185307179586;

// x = n * pi/2 + (y0 + y1), |y0 + y1| <= pi/4 (musl __rem_pio2, medium range).
function remPio2(x) {
  if (!(Math.abs(x) < 1647099.3291652855)) { // beyond 2^20 * pi/2: never reached by the sim
    const k = Math.floor(x / TWOPI); // deterministic, if less precise
    return remPio2(x - k * TWOPI);
  }
  let fn = x * INVPIO2 + TOINT - TOINT;
  let n = fn | 0;
  let r = x - fn * PIO2_1, w = fn * PIO2_1T;
  if (r - w < -PIO4) { n--; fn--; r = x - fn * PIO2_1; w = fn * PIO2_1T; } else if (r - w > PIO4) { n++; fn++; r = x - fn * PIO2_1; w = fn * PIO2_1T; }
  let y0 = r - w;
  const ex = expBits(x);
  if (ex - expBits(y0) > 16) { // cancellation: second round
    let t = r;
    w = fn * PIO2_2; r = t - w; w = fn * PIO2_2T - ((t - r) - w); y0 = r - w;
    if (ex - expBits(y0) > 49) { // third round
      t = r;
      w = fn * PIO2_3; r = t - w; w = fn * PIO2_3T - ((t - r) - w); y0 = r - w;
    }
  }
  const y1 = (r - y0) - w;
  return [n, y0, y1];
}

export function sin(x) {
  x = +x;
  if (x !== x || x === Infinity || x === -Infinity) return NaN;
  if (Math.abs(x) < 7.450580596923828e-9) return x; // |x| < 2^-27, keeps -0
  if (Math.abs(x) <= PIO4) return kSin(x, 0, 0);
  const [n, y0, y1] = remPio2(x);
  switch (n & 3) {
    case 0: return kSin(y0, y1, 1);
    case 1: return kCos(y0, y1);
    case 2: return -kSin(y0, y1, 1);
    default: return -kCos(y0, y1);
  }
}

export function cos(x) {
  x = +x;
  if (x !== x || x === Infinity || x === -Infinity) return NaN;
  if (Math.abs(x) <= PIO4) return kCos(x, 0);
  const [n, y0, y1] = remPio2(x);
  switch (n & 3) {
    case 0: return kCos(y0, y1);
    case 1: return -kSin(y0, y1, 1);
    case 2: return -kCos(y0, y1);
    default: return kSin(y0, y1, 1);
  }
}

// ---- atan / atan2 ------------------------------------------------------------

const ATANHI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
  9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
  4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02];

export function atan(x) {
  x = +x;
  if (x !== x) return NaN;
  const neg = signBit(x);
  let ax = Math.abs(x), id;
  if (ax >= 7.378697629483821e19) return neg ? -(ATANHI[3] + ATANLO[3]) : ATANHI[3] + ATANLO[3]; // |x| >= 2^66
  if (ax < 0.4375) {
    if (ax < 7.450580596923828e-9) return x; // |x| < 2^-27
    id = -1;
  } else if (ax < 1.1875) {
    if (ax < 0.6875) { id = 0; ax = (2.0 * ax - 1.0) / (2.0 + ax); } else { id = 1; ax = (ax - 1.0) / (ax + 1.0); }
  } else if (ax < 2.4375) { id = 2; ax = (ax - 1.5) / (1.0 + 1.5 * ax); } else { id = 3; ax = -1.0 / ax; }
  const xx = id < 0 ? x : ax;
  const z = xx * xx, w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return xx - xx * (s1 + s2);
  const r = ATANHI[id] - ((xx * (s1 + s2) - ATANLO[id]) - xx);
  return neg ? -r : r;
}

const PI = 3.1415926535897931160E+00, PI_LO = 1.2246467991473531772E-16, PIO2 = 1.5707963267948965580E+00;

export function atan2(y, x) {
  y = +y; x = +x;
  if (x !== x || y !== y) return NaN;
  if (x === 1) return atan(y);
  const m = (signBit(y) ? 1 : 0) | (signBit(x) ? 2 : 0); // 2*sign(x) + sign(y)
  if (y === 0) return m === 0 || m === 1 ? y : m === 2 ? PI : -PI;
  if (x === 0) return m & 1 ? -PIO2 : PIO2;
  if (x === Infinity || x === -Infinity) {
    if (y === Infinity || y === -Infinity) return [PI / 4, -PI / 4, 3 * PI / 4, -3 * PI / 4][m];
    return [0, -0, PI, -PI][m];
  }
  if (y === Infinity || y === -Infinity) return m & 1 ? -PIO2 : PIO2;
  const ex = expBits(x), ey = expBits(y);
  if (ex + 64 < ey) return m & 1 ? -PIO2 : PIO2; // |y/x| > 2^64
  const z = (m & 2) && ey + 64 < ex ? 0 : atan(Math.abs(y / x));
  switch (m) {
    case 0: return z;
    case 1: return -z;
    case 2: return PI - (z - PI_LO);
    default: return (z - PI_LO) - PI;
  }
}

// ---- hypot ----------------------------------------------------------------------

export function hypot(a, b) {
  if (arguments.length !== 2) return hypotN(arguments);
  a = Math.abs(+a); b = Math.abs(+b);
  if (a === Infinity || b === Infinity) return Infinity;
  if (a !== a || b !== b) return NaN;
  if (a < b) { const t = a; a = b; b = t; }
  if (a === 0) return 0;
  const r = b / a; // scaled: no overflow, one sqrt
  return a * Math.sqrt(1 + r * r);
}

function hypotN(args) {
  let inf = false, nan = false, max = 0;
  const v = Array.from(args, (x) => Math.abs(+x));
  for (const a of v) { if (a === Infinity) inf = true; else if (a !== a) nan = true; else if (a > max) max = a; }
  if (inf) return Infinity;
  if (nan) return NaN;
  if (max === 0) return 0;
  let sum = 0;
  for (const a of v) { const r = a / max; sum += r * r; }
  return max * Math.sqrt(sum);
}

// ---- install ------------------------------------------------------------------

const NATIVE = { sin: Math.sin, cos: Math.cos, atan: Math.atan, atan2: Math.atan2, hypot: Math.hypot };
const DET = { sin, cos, atan, atan2, hypot };
let installs = 0;

// Replace the engine's functions for the length of a multiplayer match.
export function installDetMath() {
  if (installs++ === 0) Object.assign(Math, DET);
  let done = false;
  return () => { if (!done && --installs === 0) Object.assign(Math, NATIVE); done = true; };
}

export const detMathInstalled = () => Math.sin === sin;
