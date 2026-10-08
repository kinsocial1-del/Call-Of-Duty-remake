// Grid navigation for bots: walkability baked from colliders, A* with binary heap, string-pulled paths.
import * as THREE from 'three';

const AGENT_R = 0.38;

export class NavGrid {
  constructor(world, bounds, cell = 0.5) {
    this.cell = cell;
    this.minX = bounds.minX; this.minZ = bounds.minZ;
    this.w = Math.ceil((bounds.maxX - bounds.minX) / cell);
    this.h = Math.ceil((bounds.maxZ - bounds.minZ) / cell);
    const N = this.w * this.h;
    this.block = new Uint8Array(N);
    this.cost = new Float32Array(N);
    this.g = new Float32Array(N);
    this.parent = new Int32Array(N);
    this.seen = new Uint32Array(N);
    this.closed = new Uint32Array(N);
    this.stamp = 0;
    this.heap = new Int32Array(N);
    this.f = new Float32Array(N);
    // bake: a cell is blocked if any low obstacle intersects the agent footprint at that cell
    for (const b of world.boxes) {
      if (b.min.y > 1.6 || b.max.y < 0.42) continue;
      const x0 = Math.floor((b.min.x - AGENT_R - this.minX) / cell), x1 = Math.floor((b.max.x + AGENT_R - this.minX) / cell);
      const z0 = Math.floor((b.min.z - AGENT_R - this.minZ) / cell), z1 = Math.floor((b.max.z + AGENT_R - this.minZ) / cell);
      for (let x = Math.max(0, x0); x <= Math.min(this.w - 1, x1); x++)
        for (let z = Math.max(0, z0); z <= Math.min(this.h - 1, z1); z++) {
          const cx = this.minX + (x + 0.5) * cell, cz = this.minZ + (z + 0.5) * cell;
          if (cx > b.min.x - AGENT_R && cx < b.max.x + AGENT_R && cz > b.min.z - AGENT_R && cz < b.max.z + AGENT_R) this.block[x + z * this.w] = 1;
        }
    }
    for (let x = 0; x < this.w; x++) { this.block[x] = 1; this.block[x + (this.h - 1) * this.w] = 1; }
    for (let z = 0; z < this.h; z++) { this.block[z * this.w] = 1; this.block[this.w - 1 + z * this.w] = 1; }
    // proximity cost: prefer paths not hugging walls
    for (let z = 1; z < this.h - 1; z++) for (let x = 1; x < this.w - 1; x++) {
      const i = x + z * this.w;
      if (this.block[i]) continue;
      let n = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) n += this.block[i + dx + dz * this.w];
      this.cost[i] = n * 0.4;
    }
  }

  idx(x, z) {
    const ix = Math.floor((x - this.minX) / this.cell), iz = Math.floor((z - this.minZ) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.w || iz >= this.h) return -1;
    return ix + iz * this.w;
  }

  walkableAt(x, z) { const i = this.idx(x, z); return i >= 0 && !this.block[i]; }

  nearestWalkable(x, z, maxR = 8) {
    const i0 = this.idx(x, z);
    if (i0 >= 0 && !this.block[i0]) return i0;
    const cx = Math.floor((x - this.minX) / this.cell), cz = Math.floor((z - this.minZ) / this.cell);
    for (let r = 1; r <= maxR / this.cell; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
        const ix = cx + dx, iz = cz + dz;
        if (ix < 0 || iz < 0 || ix >= this.w || iz >= this.h) continue;
        const i = ix + iz * this.w;
        if (!this.block[i]) return i;
      }
    }
    return -1;
  }

  center(i, out = new THREE.Vector3()) {
    return out.set(this.minX + ((i % this.w) + 0.5) * this.cell, 0, this.minZ + (Math.floor(i / this.w) + 0.5) * this.cell);
  }

  /** Grid line walk (supercover-ish) to check straight walkability between two world points. */
  clearLine(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const dist = Math.hypot(dx, dz);
    const steps = Math.ceil(dist / (this.cell * 0.5));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const i = this.idx(ax + dx * t, az + dz * t);
      if (i < 0 || this.block[i]) return false;
    }
    return true;
  }

  /** A* from world points. Returns array of Vector3 waypoints (smoothed) or null. */
  findPath(from, to, maxIter = 9000) {
    const s = this.nearestWalkable(from.x, from.z, 3), e = this.nearestWalkable(to.x, to.z, 6);
    if (s < 0 || e < 0) return null;
    if (s === e) return [this.center(e)];
    const W = this.w, st = ++this.stamp;
    const ex = e % W, ez = Math.floor(e / W);
    const heur = (i) => { const dx = Math.abs((i % W) - ex), dz = Math.abs(Math.floor(i / W) - ez); return (dx + dz + (1.4142 - 2) * Math.min(dx, dz)); };
    let hs = 0;
    const push = (i) => {
      let k = hs++; this.heap[k] = i;
      while (k > 0) { const p = (k - 1) >> 1; if (this.f[this.heap[p]] <= this.f[i]) break; this.heap[k] = this.heap[p]; this.heap[p] = i; k = p; }
    };
    const pop = () => {
      const top = this.heap[0]; const last = this.heap[--hs];
      let k = 0;
      if (hs > 0) {
        this.heap[0] = last;
        for (;;) {
          const l = 2 * k + 1, r = l + 1; let m = k;
          if (l < hs && this.f[this.heap[l]] < this.f[this.heap[m]]) m = l;
          if (r < hs && this.f[this.heap[r]] < this.f[this.heap[m]]) m = r;
          if (m === k) break;
          const tmp = this.heap[m]; this.heap[m] = this.heap[k]; this.heap[k] = tmp; k = m;
        }
      }
      return top;
    };
    this.g[s] = 0; this.f[s] = heur(s); this.seen[s] = st; this.parent[s] = -1;
    push(s);
    let iter = 0, found = false;
    const DX = [1, -1, 0, 0, 1, 1, -1, -1], DZ = [0, 0, 1, -1, 1, -1, 1, -1], DC = [1, 1, 1, 1, 1.4142, 1.4142, 1.4142, 1.4142];
    while (hs > 0 && iter++ < maxIter) {
      const c = pop();
      if (c === e) { found = true; break; }
      if (this.closed[c] === st) continue;
      this.closed[c] = st;
      const cx = c % W, cz = Math.floor(c / W);
      for (let k = 0; k < 8; k++) {
        const nx = cx + DX[k], nz = cz + DZ[k];
        if (nx < 0 || nz < 0 || nx >= W || nz >= this.h) continue;
        const n = nx + nz * W;
        if (this.block[n] || this.closed[n] === st) continue;
        if (k >= 4 && (this.block[cx + DX[k] + cz * W] || this.block[cx + (cz + DZ[k]) * W])) continue; // no corner cutting
        const g = this.g[c] + DC[k] + this.cost[n];
        if (this.seen[n] !== st || g < this.g[n]) {
          this.seen[n] = st; this.g[n] = g; this.parent[n] = c; this.f[n] = g + heur(n) * 1.15;
          push(n);
        }
      }
    }
    if (!found) return null;
    const raw = [];
    for (let i = e; i !== -1; i = this.parent[i]) raw.push(i);
    raw.reverse();
    // string pulling
    const pts = raw.map((i) => this.center(i));
    const out = [];
    // starting inside a blocked cell (pushed into a wall): head for the nearest open cell first
    let anchor = this.walkableAt(from.x, from.z) ? new THREE.Vector3(from.x, 0, from.z) : pts[0];
    if (anchor === pts[0]) out.push(pts[0]);
    let k = 0;
    while (k < pts.length - 1) {
      let far = k + 1;
      for (let j = Math.min(pts.length - 1, k + 48); j > k + 1; j--) {
        if (this.clearLine(anchor.x, anchor.z, pts[j].x, pts[j].z)) { far = j; break; }
      }
      out.push(pts[far]);
      anchor = pts[far];
      k = far;
    }
    if (out.length === 0) out.push(pts[pts.length - 1]);
    return out;
  }
}
