// AABB world collision, character movement with step-up / ground snapping, and fast raycasts.
import * as THREE from 'three';

const EPS = 0.001;
const CELL = 8;

export class World {
  constructor() {
    this.boxes = [];
    this.grid = new Map();
  }

  clear() { this.boxes.length = 0; this.grid.clear(); }

  add(minX, minY, minZ, maxX, maxY, maxZ, surface = 'concrete', extra = null) {
    const b = { min: new THREE.Vector3(minX, minY, minZ), max: new THREE.Vector3(maxX, maxY, maxZ), surface, id: this.boxes.length, active: true, ...extra };
    this.boxes.push(b);
    this._insert(b);
    return b;
  }

  _key(ix, iz) { return ix * 4096 + iz; }
  _insert(b) {
    for (let ix = Math.floor(b.min.x / CELL); ix <= Math.floor(b.max.x / CELL); ix++)
      for (let iz = Math.floor(b.min.z / CELL); iz <= Math.floor(b.max.z / CELL); iz++) {
        const k = this._key(ix, iz);
        let arr = this.grid.get(k);
        if (!arr) this.grid.set(k, arr = []);
        arr.push(b);
      }
  }

  /** Boxes potentially overlapping the XZ rect. */
  query(minX, minZ, maxX, maxZ, out = []) {
    out.length = 0;
    const stamp = ++this._stamp || (this._stamp = 1);
    for (let ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL); ix++)
      for (let iz = Math.floor(minZ / CELL); iz <= Math.floor(maxZ / CELL); iz++) {
        const arr = this.grid.get(this._key(ix, iz));
        if (!arr) continue;
        for (const b of arr) if (b.active && b._s !== stamp) { b._s = stamp; out.push(b); }
      }
    return out;
  }

  overlaps(x, y, z, r, h, list = null) {
    const L = list || this.query(x - r, z - r, x + r, z + r, _q);
    for (const b of L) {
      if (x + r > b.min.x && x - r < b.max.x && z + r > b.min.z && z - r < b.max.z && y + h > b.min.y && y < b.max.y) return b;
    }
    return null;
  }

  /** Highest surface under (x,z) footprint between y-maxDrop and y+0.01 */
  groundBelow(x, y, z, r, maxDrop) {
    let best = -Infinity;
    if (y - maxDrop <= 0 && y >= -0.01) best = 0;
    const L = this.query(x - r, z - r, x + r, z + r, _q);
    for (const b of L) {
      if (x + r > b.min.x && x - r < b.max.x && z + r > b.min.z && z - r < b.max.z && b.max.y <= y + 0.02 && b.max.y >= y - maxDrop) {
        if (b.max.y > best) best = b.max.y;
      }
    }
    return best;
  }

  /**
   * Moves a vertical box character. pos = feet position. Mutates pos & vel.
   * Returns { grounded, hitWall, groundSurface }.
   */
  move(pos, vel, dt, r, h, opts = {}) {
    const step = opts.step ?? 0.45;
    const wasGrounded = !!opts.grounded;
    const res = { grounded: false, hitWall: false, ceiling: false, surface: 'concrete' };
    const dist = Math.hypot(vel.x, vel.y, vel.z) * dt;
    const n = Math.max(1, Math.ceil(dist / 0.15));
    const sdt = dt / n;
    let grounded = wasGrounded;
    for (let i = 0; i < n; i++) {
      // horizontal X
      pos.x += vel.x * sdt;
      this._resolveAxis(pos, vel, r, h, 'x', grounded, step, res);
      pos.z += vel.z * sdt;
      this._resolveAxis(pos, vel, r, h, 'z', grounded, step, res);
      // Resolve only surfaces crossed vertically, so low ceilings cannot become floors.
      const oldY = pos.y;
      pos.y += vel.y * sdt;
      grounded = false;
      const L = this.query(pos.x - r, pos.z - r, pos.x + r, pos.z + r, _q);
      for (const b of L) {
        if (pos.x + r > b.min.x && pos.x - r < b.max.x && pos.z + r > b.min.z && pos.z - r < b.max.z && pos.y + h > b.min.y && pos.y < b.max.y) {
          if (vel.y <= 0 && oldY >= b.max.y - EPS) { pos.y = b.max.y; vel.y = 0; grounded = true; res.surface = b.surface; }
          else if (vel.y > 0 && oldY + h <= b.min.y + EPS) { pos.y = b.min.y - h - EPS; vel.y = 0; res.ceiling = true; }
        }
      }
      // Keep resting contact through every substep, including stationary rooftops.
      if (!grounded && vel.y <= 0) {
        const support = this.groundBelow(pos.x, pos.y, pos.z, r * 0.7, 0.004);
        if (support > -Infinity && support <= pos.y + EPS) {
          pos.y = support; vel.y = 0; grounded = true;
          const floor = L.find(b => Math.abs(b.max.y - support) < EPS && pos.x + r * 0.7 > b.min.x && pos.x - r * 0.7 < b.max.x && pos.z + r * 0.7 > b.min.z && pos.z - r * 0.7 < b.max.z);
          if (floor) res.surface = floor.surface;
        }
      }
      if (pos.y <= 0) { pos.y = 0; if (vel.y < 0) vel.y = 0; grounded = true; }
    }
    // snap down stairs/slopes when walking off small ledges
    if (!grounded && wasGrounded && vel.y <= 0 && !opts.noSnap) {
      const g = this.groundBelow(pos.x, pos.y, pos.z, r * 0.7, step + 0.05);
      if (g > -Infinity) { pos.y = g; grounded = true; vel.y = 0; }
    }
    res.grounded = grounded;
    return res;
  }

  _resolveAxis(pos, vel, r, h, axis, grounded, step, res) {
    const L = this.query(pos.x - r, pos.z - r, pos.x + r, pos.z + r, _q2);
    for (const b of L) {
      if (!(pos.x + r > b.min.x && pos.x - r < b.max.x && pos.z + r > b.min.z && pos.z - r < b.max.z && pos.y + h > b.min.y && pos.y < b.max.y)) continue;
      // step up?
      const rise = b.max.y - pos.y;
      if (grounded && rise > 0 && rise <= step && !this.overlaps(pos.x, b.max.y + EPS, pos.z, r, h)) {
        pos.y = b.max.y + EPS;
        continue;
      }
      if (axis === 'x') {
        const c = (b.min.x + b.max.x) / 2;
        pos.x = pos.x < c ? b.min.x - r - EPS : b.max.x + r + EPS;
        vel.x = 0;
      } else {
        const c = (b.min.z + b.max.z) / 2;
        pos.z = pos.z < c ? b.min.z - r - EPS : b.max.z + r + EPS;
        vel.z = 0;
      }
      res.hitWall = true;
    }
  }

  /** Ray vs all boxes + ground plane. dir must be normalized. */
  raycast(o, d, maxDist, out = _hit) {
    let best = maxDist, bestBox = null, axis = -1, sign = 0;
    // ground
    if (d.y < -1e-6) {
      const t = -o.y / d.y;
      if (t >= 0 && t < best) { best = t; bestBox = GROUND; axis = 1; sign = 1; }
    }
    const ex = o.x + d.x * best, ez = o.z + d.z * best;
    const L = this.query(Math.min(o.x, ex), Math.min(o.z, ez), Math.max(o.x, ex), Math.max(o.z, ez), _q3);
    const ix = 1 / d.x, iy = 1 / d.y, iz = 1 / d.z;
    for (const b of L) {
      let t1 = (b.min.x - o.x) * ix, t2 = (b.max.x - o.x) * ix;
      let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2), ax = 0;
      t1 = (b.min.y - o.y) * iy; t2 = (b.max.y - o.y) * iy;
      let a = Math.min(t1, t2), c = Math.max(t1, t2);
      if (a > tmin) { tmin = a; ax = 1; }
      if (c < tmax) tmax = c;
      t1 = (b.min.z - o.z) * iz; t2 = (b.max.z - o.z) * iz;
      a = Math.min(t1, t2); c = Math.max(t1, t2);
      if (a > tmin) { tmin = a; ax = 2; }
      if (c < tmax) tmax = c;
      if (tmax < Math.max(tmin, 0) || tmin > best) continue;
      if (tmin < 0) continue; // origin inside box: ignore (prevents self-hits from inside geometry)
      best = tmin; bestBox = b; axis = ax;
      sign = ax === 0 ? -Math.sign(d.x) : ax === 1 ? -Math.sign(d.y) : -Math.sign(d.z);
    }
    if (!bestBox) return null;
    out.t = best;
    out.box = bestBox;
    out.surface = bestBox.surface;
    out.point.copy(o).addScaledVector(d, best);
    out.normal.set(axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0);
    return out;
  }

  /** True if segment a->b is unobstructed. */
  lineOfSight(a, b) {
    _d.subVectors(b, a);
    const len = _d.length();
    if (len < 1e-4) return true;
    _d.divideScalar(len);
    return !this.raycast(a, _d, len - 0.05, _losHit);
  }
}

const GROUND = { surface: 'ground', min: new THREE.Vector3(-1e4, -1, -1e4), max: new THREE.Vector3(1e4, 0, 1e4) };
const _q = [], _q2 = [], _q3 = [];
const _d = new THREE.Vector3();
const _hit = { t: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), box: null, surface: '' };
const _losHit = { t: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), box: null, surface: '' };
export function makeHit() { return { t: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), box: null, surface: '' }; }
