import * as THREE from 'three';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const DEG = Math.PI / 180;

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function dampAngle(a, b, lambda, dt) {
  return a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));
}

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Random direction inside a cone around `dir` with half-angle `spread` radians. */
export function coneDirection(dir, spread, out = new THREE.Vector3()) {
  if (spread <= 0) return out.copy(dir);
  const up = Math.abs(dir.y) < 0.99 ? _up : _right;
  const t1 = _t1.crossVectors(dir, up).normalize();
  const t2 = _t2.crossVectors(dir, t1).normalize();
  const r = Math.sqrt(Math.random()) * Math.tan(spread);
  const a = Math.random() * Math.PI * 2;
  out.copy(dir).addScaledVector(t1, Math.cos(a) * r).addScaledVector(t2, Math.sin(a) * r).normalize();
  return out;
}
const _up = new THREE.Vector3(0, 1, 0);
const _right = new THREE.Vector3(1, 0, 0);
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();

/** Closest distance between a ray segment (o + d*t, t in [0,len]) and segment ab. Returns {dist, t}. */
const _u = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
export function raySegmentDistance(o, d, len, a, b) {
  _u.copy(d).multiplyScalar(len);
  _v.subVectors(b, a);
  _w.subVectors(o, a);
  const A = _u.dot(_u), B = _u.dot(_v), C = _v.dot(_v), D = _u.dot(_w), E = _v.dot(_w);
  const den = A * C - B * B;
  let s, t;
  if (den < 1e-8) { s = 0; t = B > C ? D / B : E / C; }
  else { s = (B * E - C * D) / den; t = (A * E - B * D) / den; }
  s = clamp(s, 0, 1);
  t = clamp(t, 0, 1);
  // re-project once for accuracy after clamping
  t = clamp((B * s + E) / (C || 1), 0, 1);
  s = clamp((B * t - D) / (A || 1), 0, 1);
  const px = o.x + _u.x * s - (a.x + _v.x * t);
  const py = o.y + _u.y * s - (a.y + _v.y * t);
  const pz = o.z + _u.z * s - (a.z + _v.z * t);
  return { dist: Math.sqrt(px * px + py * py + pz * pz), t: s * len };
}

/** Ray-sphere: returns distance along ray or -1 */
export function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : (cc < 0 ? 0 : -1);
}

export function formatTime(s) {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Countdown label for long waits: "2D 4H", "5H 12M", "3M 20S". */
export function formatCountdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60;
  return d ? `${d}D ${h}H` : h ? `${h}H ${m}M` : `${m}M ${s % 60}S`;
}

/** Deterministic random stream from a string seed (same seed, same sequence on every machine). */
export function seeded(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  // murmur3 finalizer: similar seeds ("d1", "d2") must not give similar streams
  h ^= h >>> 16; h = Math.imul(h, 2246822507); h ^= h >>> 13; h = Math.imul(h, 3266489909); h ^= h >>> 16;
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const fmtNum = (n) => Math.round(n).toLocaleString('en-US');

export const CALLSIGNS = [
  'Viper', 'Ghostline', 'Havoc', 'Rook', 'Nomad', 'Specter', 'Drifter', 'Bishop', 'Wraith', 'Sable', 'Kodiak', 'Talon',
  'Raptor', 'Jackal', 'Mako', 'Saber', 'Onyx', 'Vandal', 'Reaper', 'Cipher', 'Hex', 'Atlas', 'Bravo-6', 'Echo', 'Grizzly',
  'Lynx', 'Maverick', 'Nova', 'Outlaw', 'Patch', 'Quill', 'Ranger', 'Scythe', 'Tusk', 'Volt', 'Warden', 'Yeti', 'Zulu',
];

/** Mark every geometry under root as cached/shared so disposeModel() leaves it alone. */
export function markShared(root) {
  root.traverse((o) => { if (o.geometry) o.geometry.userData.shared = true; });
}

/** Free the GPU memory one model instance owns (its own geometry and skeleton textures). Shared geometry and all materials are kept. */
export function disposeModel(root) {
  if (!root) return;
  root.traverse((o) => {
    if (o.isSkinnedMesh && o.skeleton) o.skeleton.dispose();
    if (o.isInstancedMesh) o.dispose(); // frees its per-instance matrix buffer
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
  });
}
