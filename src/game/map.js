// Map construction: merged static geometry, AABB colliders, nav grid, spawns, objectives & minimap.
import * as THREE from 'three';
import { hasProps, propSize, propClone, propParts } from './props.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { worldBox } from '../engine/renderer.js';
import { NavGrid } from './nav.js';
import { addMapPolish } from './map-polish.js';
import { buildWoodland } from './woodland-map.js';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const MAPS = {
  dockyard: { id: 'dockyard', name: 'PINE RIDGE', desc: '220 m woodland battlefield. Pine groves, boulder cover, fallen logs and three connected forest trails.', theme: 'forest' },
  outpost: { id: 'outpost', name: 'TIMBER CAMP', desc: '240 m forest camp. Fight through timber cabins, a lookout tower and wooded flanking routes.', theme: 'forest' },
};

class Builder {
  constructor(renderer, world) {
    this.R = renderer; this.M = renderer.mats; this.world = world;
    this.buckets = new Map();     // material -> geometries
    this.group = new THREE.Group();
    this.barrels = [];
    this.minimapRects = [];
    this.rng = mulberry32(1337);
    this.instances = new Map();   // prop key (+ shadow flag) -> { key, mats: Matrix4[], shadow }
    this.low = renderer.detail === 'low';   // 'WORLD DETAIL: LOW' drops decorative clutter and scenery
  }

  rand(a = 0, b = 1) { return a + this.rng() * (b - a); }

  _push(mat, geo, castShadow = true) {
    const key = mat.uuid + (castShadow ? 's' : 'n');
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, b = { mat, geos: [], castShadow });
    b.geos.push(geo);
  }

  /** Axis-aligned solid box. (cx, cz) centre, y0 bottom. */
  box(cx, y0, cz, w, h, d, mat, o = {}) {
    if (w <= 0.001 || h <= 0.001 || d <= 0.001) return null;
    if (mat) {
      const g = worldBox(w, h, d, o.tile ?? 2.5);
      g.translate(cx, y0 + h / 2, cz);
      this._push(mat, g, o.shadow !== false);
    }
    let col = null;
    if (o.collide !== false) {
      col = this.world.add(cx - w / 2, y0, cz - d / 2, cx + w / 2, y0 + h, cz + d / 2, o.surface || 'concrete', o.extra || null);
      if (y0 < 2.2 && !o.noMinimap) this.minimapRects.push({ x: cx - w / 2, z: cz - d / 2, w, d, h: y0 + h });
    }
    return col;
  }

  cyl(cx, y0, cz, r, h, mat, o = {}) {
    const g = new THREE.CylinderGeometry(o.rTop ?? r, r, h, o.seg ?? 16, 1, false);
    g.translate(cx, y0 + h / 2, cz);
    this._push(mat, g, o.shadow !== false);
    if (o.collide !== false) {
      const s = r * 0.85;
      this.world.add(cx - s, y0, cz - s, cx + s, y0 + h, cz + s, o.surface || 'metal');
      if (y0 < 2.2) this.minimapRects.push({ x: cx - s, z: cz - s, w: s * 2, d: s * 2, h: y0 + h });
    }
  }

  /** Axis-aligned wall from (ax,az) to (bx,bz) with rectangular openings [{c, w, b, t}] (c = offset from wall centre). */
  wall(ax, az, bx, bz, y0, h, t, mat, openings = [], o = {}) {
    const alongX = Math.abs(az - bz) < 1e-3;
    const len = alongX ? Math.abs(bx - ax) : Math.abs(bz - az);
    const start = alongX ? Math.min(ax, bx) : Math.min(az, bz);
    const fixed = alongX ? az : ax;
    const ops = openings.map((op) => ({ s: len / 2 + op.c - op.w / 2, e: len / 2 + op.c + op.w / 2, b: op.b ?? 0, t: Math.min(op.t ?? h, h) }))
      .filter((op) => op.e > 0 && op.s < len).sort((p, q) => p.s - q.s);
    const piece = (s0, s1, yb, yt) => {
      if (s1 - s0 < 0.01 || yt - yb < 0.01) return;
      const c = start + (s0 + s1) / 2;
      if (alongX) this.box(c, y0 + yb, fixed, s1 - s0, yt - yb, t, mat, o);
      else this.box(fixed, y0 + yb, c, t, yt - yb, s1 - s0, mat, o);
    };
    let cur = 0;
    for (const op of ops) {
      const s = Math.max(cur, op.s), e = Math.min(len, op.e);
      piece(cur, s, 0, h);
      piece(s, e, 0, op.b);
      piece(s, e, op.t, h);
      cur = Math.max(cur, e);
    }
    piece(cur, len, 0, h);
  }

  slab(x0, x1, z0, z1, y, th, mat, hole = null, o = {}) {
    if (!hole) { this.box((x0 + x1) / 2, y - th, (z0 + z1) / 2, x1 - x0, th, z1 - z0, mat, { ...o, noMinimap: true }); return; }
    const { hx0, hx1, hz0, hz1 } = hole;
    this.box((x0 + x1) / 2, y - th, (z0 + hz0) / 2, x1 - x0, th, hz0 - z0, mat, { ...o, noMinimap: true });
    this.box((x0 + x1) / 2, y - th, (hz1 + z1) / 2, x1 - x0, th, z1 - hz1, mat, { ...o, noMinimap: true });
    this.box((x0 + hx0) / 2, y - th, (hz0 + hz1) / 2, hx0 - x0, th, hz1 - hz0, mat, { ...o, noMinimap: true });
    this.box((hx1 + x1) / 2, y - th, (hz0 + hz1) / 2, x1 - hx1, th, hz1 - hz0, mat, { ...o, noMinimap: true });
  }

  /** Solid staircase. Runs along z (dir ±1) from zStart, across x in [xa, xb]. */
  stairs(xa, xb, zStart, dir, y0, rise, mat, alongX = false) {
    const n = Math.ceil(rise / 0.3), sh = rise / n, sd = 0.3;
    for (let i = 0; i < n; i++) {
      const top = y0 + (i + 1) * sh;
      const zc = zStart + dir * (i + 0.5) * sd;
      if (alongX) this.box(zc, y0, (xa + xb) / 2, sd, top - y0, xb - xa, mat, { noMinimap: true });
      else this.box((xa + xb) / 2, y0, zc, xb - xa, top - y0, sd, mat, { noMinimap: true });
    }
    return n * sd;
  }

  /**
   * Multi-storey building. doors: [{side:'n'|'s'|'e'|'w', c, w}] ground floor only.
   * Stairs run along the west interior wall; keep doors off the west side near z0.
   */
  building(cx, cz, w, d, o = {}) {
    const floors = o.floors ?? 1, fh = o.fh ?? 3.6, t = o.t ?? 0.35, mat = o.mat || this.M.wall;
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const H = floors * fh;
    const doors = o.doors || [];
    const roofAccess = !!o.roofAccess;
    const sideLen = { n: w, s: w, e: d - 2 * t, w: d - 2 * t };
    const winsFor = (side, f) => {
      if (o.windows === false) return [];
      const L = sideLen[side], ws = [];
      const step = o.winStep ?? 3.6;
      const count = Math.floor((L - 2) / step);
      for (let i = 0; i < count; i++) {
        const c = -((count - 1) * step) / 2 + i * step;
        if (f === 0 && doors.some((dd) => dd.side === side && Math.abs(dd.c - c) < dd.w / 2 + 1.0)) continue;
        if (o.ruined && this.rng() < 0.3) ws.push({ c, w: 2.2, b: 0.4, t: fh });
        else ws.push({ c, w: 1.3, b: 1.05, t: 2.2 });
      }
      return ws;
    };
    for (let f = 0; f < floors; f++) {
      const y = f * fh;
      const dOps = (side) => (f === 0 ? doors.filter((dd) => dd.side === side).map((dd) => ({ c: dd.c, w: dd.w, b: 0, t: dd.h ?? 2.5 })) : []);
      const hh = f === floors - 1 ? fh + (o.parapet ?? 1.0) : fh;
      this.wall(x0, z0 + t / 2, x1, z0 + t / 2, y, hh, t, mat, [...dOps('n'), ...winsFor('n', f)]);
      this.wall(x0, z1 - t / 2, x1, z1 - t / 2, y, hh, t, mat, [...dOps('s'), ...winsFor('s', f)]);
      this.wall(x0 + t / 2, z0 + t, x0 + t / 2, z1 - t, y, hh, t, mat, [...dOps('w'), ...winsFor('w', f)]);
      this.wall(x1 - t / 2, z0 + t, x1 - t / 2, z1 - t, y, hh, t, mat, [...dOps('e'), ...winsFor('e', f)]);
    }
    // facade detail: concrete sills and lintels on every window, grime under the roof line
    const sideInfo = {
      n: { along: true, fixed: z0, c0: cx, nx: 0, nz: -1 }, s: { along: true, fixed: z1, c0: cx, nx: 0, nz: 1 },
      w: { along: false, fixed: x0, c0: cz, nx: -1, nz: 0 }, e: { along: false, fixed: x1, c0: cz, nx: 1, nz: 0 },
    };
    const trimMat = o.trimMat || this.M.wallDark;
    for (const [side, si] of Object.entries(sideInfo)) {
      const at = (c, out) => (si.along ? [si.c0 + c, si.fixed + si.nz * out] : [si.fixed + si.nx * out, si.c0 + c]);
      for (let f = 0; f < floors; f++) {
        const y = f * fh, wins = winsFor(side, f);
        if (!o.ruined) {
          for (const wn of wins) {
            const [sx, sz] = at(wn.c, 0.06);
            const sw = si.along ? wn.w + 0.24 : 0.16, sd = si.along ? 0.16 : wn.w + 0.24;
            this.box(sx, y + wn.b - 0.07, sz, sw, 0.07, sd, trimMat, { collide: false, tile: 1 });
            this.box(sx, y + wn.t, sz, si.along ? wn.w + 0.1 : 0.1, 0.16, si.along ? 0.1 : wn.w + 0.1, trimMat, { collide: false, tile: 1, shadow: false });
          }
        }
      }
      // streaks below the roof line, clear of the top-floor windows
      const L = sideLen[side] + (si.along ? 0 : 2 * t);
      const [gx, gz] = at(0, 0);
      const ex = si.along ? L / 2 : 0, ez = si.along ? 0 : L / 2;
      const top = H + (o.parapet ?? 1.0);
      if (!o.ruined) this.grime(gx - ex, gz - ez, gx + ex, gz + ez, si.nx, si.nz, top, Math.min(top - ((floors - 1) * fh + 2.35), 2.6));
    }
    // ground floor finish
    this.box(cx, 0, cz, w - 2 * t, 0.04, d - 2 * t, this.M.floor, { collide: false, shadow: false, tile: 3 });
    // stairs + slabs
    const ix0 = x0 + t, ix1 = x1 - t, iz0 = z0 + t, iz1 = z1 - t;
    const flights = floors - 1 + (roofAccess ? 1 : 0);
    const holes = [];
    for (let f = 0; f < flights; f++) {
      const lane = f % 2;
      const xa = ix0 + lane * 1.25, xb = xa + 1.2;
      const zs = lane === 0 ? iz0 + 0.6 : iz0 + 0.6 + Math.ceil(fh / 0.3) * 0.3;
      const run = this.stairs(xa, xb, zs, lane === 0 ? 1 : -1, f * fh, fh, this.M.wallDark);
      holes[f + 1] = { hx0: xa - 0.05, hx1: xb + 0.05, hz0: Math.min(zs, zs + (lane ? -run : run)) - 0.4, hz1: Math.max(zs, zs + (lane ? -run : run)) + 0.05 };
    }
    for (let f = 1; f <= floors; f++) {
      const isRoof = f === floors;
      this.slab(ix0, ix1, iz0, iz1, f * fh, 0.3, isRoof ? (o.roofMat || this.M.wallDark) : this.M.floor, (isRoof && !roofAccess) ? null : holes[f] || null);
    }
    // interior clutter
    if (o.clutter !== false) {
      for (let f = 0; f < floors; f++) {
        const n = Math.floor((w * d) / 45);
        for (let i = 0; i < n; i++) {
          const px = this.rand(ix0 + 3.2, ix1 - 1), pz = this.rand(iz0 + 1, iz1 - 1);
          const s = this.rand(0.8, 1.2);
          const nearDoor = f === 0 && doors.some((dd) => {
            const dx = dd.side === 'e' ? x1 : dd.side === 'w' ? x0 : cx + dd.c, dz = dd.side === 'n' ? z0 : dd.side === 's' ? z1 : cz + dd.c;
            return Math.hypot(px - dx, pz - dz) < 2.6;
          });
          if (!nearDoor && !this.world.overlaps(px, f * fh + 0.05, pz, s / 2 + 0.6, 1.5)) this.box(px, f * fh, pz, s, s * 0.9, s, this.M.crate, { surface: 'wood', tile: 1.2 });
        }
      }
    }
    return { x0, x1, z0, z1, H };
  }

  /**
   * Instanced real prop (origin at its bottom centre): hundreds of these cost one draw call per prop type.
   * o: { rx, rz (tilt), sy, sz (non-uniform scale), shadow }. Returns false if the prop isn't loaded.
   */
  inst(key, x, y, z, ry = 0, s = 1, o = {}) {
    if (!propParts(key).length) return false;
    const shadow = o.shadow !== false && !NO_SHADOW.has(key), id = shadow ? key : key + '|noshadow';
    let list = this.instances.get(id);
    if (!list) this.instances.set(id, list = { key, mats: [], shadow });
    _e.set(o.rx || 0, ry, o.rz || 0, 'YXZ');
    list.mats.push(new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e), _sc.set(s, o.sy ?? s, o.sz ?? s)));
    return true;
  }

  /** Grime streaks running down from the top of a wall face (a multiplied overlay, merged with the map). */
  grime(ax, az, bx, bz, nx, nz, top, h) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1 || h < 0.3) return;
    const g = new THREE.PlaneGeometry(len, h);
    const uv = g.attributes.uv;
    const u0 = this.rand(0, 1);
    for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + uv.getX(i) * len / (h * 1.6));
    g.rotateY(Math.atan2(nx, nz));
    g.translate((ax + bx) / 2 + nx * 0.025, top - h / 2, (az + bz) / 2 + nz * 0.025);
    this._push(this.rng() < 0.5 ? this.M.grimeA : this.M.grimeB, g, false);
  }

  /** Place a real prop model (origin at its bottom centre). */
  prop(key, x, y, z, rotY = 0, sx = 1, sy = 1, sz = 1) {
    const m = propClone(key);
    if (!m) return null;
    m.position.set(x, y, z); m.rotation.y = rotY; m.scale.set(sx, sy, sz);
    this.group.add(m);
    return m;
  }

  /** Fill an s x s x s crate volume with a stack of real crates. */
  crateStack(cx, cz, s, y) {
    const kind = this.rng() < 0.55 ? 'mil_crate_b' : 'crate';
    const [w, h, d] = propSize(kind);
    const long = Math.max(w, d), short = Math.min(w, d), alongX = w >= d;
    const rows = Math.max(1, Math.round(s / short)), layers = Math.max(1, Math.round(s / h));
    const sl = s / long, ss = s / rows / short, sy = s / layers / h;
    const turn = this.rng() < 0.5;   // stack runs along x (false) or z (true)
    for (let l = 0; l < layers; l++) for (let r = 0; r < rows; r++) {
      const o = -s / 2 + (r + 0.5) * (s / rows);
      const rotY = (turn === alongX ? Math.PI / 2 : 0) + (this.rng() < 0.5 ? Math.PI : 0) + this.rand(-0.03, 0.03);
      this.inst(kind, turn ? cx + o : cx, y + l * (s / layers), turn ? cz : cz + o, rotY, alongX ? sl : ss, { sy, sz: alongX ? ss : sl });
    }
    if (this.rng() < 0.4) this.inst('ammo_box', cx + this.rand(-s / 3, s / 3), y + s, cz + this.rand(-s / 3, s / 3), this.rand(0, 6));
  }

  crate(cx, cz, s = 1.2, y = 0) {
    if (hasProps()) { this.box(cx, y, cz, s, s, s, null, { surface: 'wood' }); this.crateStack(cx, cz, s, y); return; }
    this.box(cx, y, cz, s, s, s, this.M.crate, { surface: 'wood', tile: s });
    this.box(cx, y + s, cz, s + 0.04, 0.06, s + 0.04, this.M.trim, { collide: false });
  }

  sandbags(cx, cz, len, alongZ = false, h = 1.0) {
    const rows = Math.round(h / 0.25);
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * 0.3;
      const segs = Math.floor(len / 0.6);
      for (let i = 0; i < segs; i++) {
        const p = -len / 2 + 0.3 + i * 0.6 + off * 0.5;
        if (p > len / 2 - 0.2) continue;
        const g = new THREE.CapsuleGeometry(0.13, 0.32, 3, 8);
        g.rotateZ(Math.PI / 2);
        if (alongZ) g.rotateY(Math.PI / 2);
        g.scale(1, 0.85, 1.6);
        g.translate(alongZ ? cx : cx + p, r * 0.24 + 0.12, alongZ ? cz + p : cz);
        this._push(this.M.sandbag, g, true);
      }
    }
    this.box(cx, 0, cz, alongZ ? 0.55 : len, h, alongZ ? len : 0.55, null, { surface: 'sand' });
  }

  barrel(cx, cz) {
    let mesh = null;
    if (hasProps()) {
      // scanned hazard drum, plus the odd jerrycan dumped beside it
      const [w, h] = propSize('barrel');
      mesh = this.prop('barrel', cx, 0, cz, this.rand(0, 6.28), 0.62 / w, 0.95 / h, 0.62 / w);
      if (this.rng() < 0.45) {
        const a = this.rand(0, 6.28);
        this.prop('jerrycan', cx + Math.cos(a) * 0.6, 0, cz + Math.sin(a) * 0.6, this.rand(0, 6.28));
      }
    }
    if (mesh) {
      const b = { mesh, hp: 40, alive: true, pos: new THREE.Vector3(cx, 0.5, cz), box: null };
      b.box = this.world.add(cx - 0.3, 0, cz - 0.3, cx + 0.3, 0.95, cz + 0.3, 'metal', { barrel: b });
      this.barrels.push(b);
      return;
    }
    const geo = new THREE.CylinderGeometry(0.32, 0.32, 0.95, 16);
    mesh = new THREE.Mesh(geo, this.M.barrel);
    mesh.position.set(cx, 0.475, cz);
    mesh.castShadow = mesh.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.325, 0.02, 4, 16), this.M.trim);
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.2; mesh.add(ring);
    const ring2 = ring.clone(); ring2.position.y = -0.2; mesh.add(ring2);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.25), new THREE.MeshBasicMaterial({ color: 0xffd400 }));
    sign.position.set(0, 0.05, 0.326); mesh.add(sign);
    this.group.add(mesh);
    const b = { mesh, hp: 40, alive: true, pos: new THREE.Vector3(cx, 0.5, cz), box: null };
    b.box = this.world.add(cx - 0.3, 0, cz - 0.3, cx + 0.3, 0.95, cz + 0.3, 'metal', { barrel: b });
    this.barrels.push(b);
  }

  /**
   * Buy station near (x, z): crates with a lit terminal facing the map centre. Searches outward for a clear spot
   * and returns { pos, ry } (pos = the terminal, where players stand to shop) or null.
   */
  buyStation(x, z) {
    let at = null;
    for (let r = 0; r <= 8 && !at; r += 1) for (let k = 0; k < (r ? 12 : 1); k++) {
      const a = (k / 12) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (!this.world.overlaps(px, 0.05, pz, 1.5, 2)) { at = [px, pz]; break; }
    }
    if (!at) return null;
    const [px, pz] = at, ry = Math.atan2(-px, -pz), fx = Math.sin(ry), fz = Math.cos(ry);
    // crates behind the terminal, collider covers both
    const bx = px - fx * 0.55, bz = pz - fz * 0.55;
    if (hasProps()) {
      this.inst('mil_crate_b', bx, 0, bz, ry);
      this.inst('mil_crate_b', bx, 0.464, bz, ry + 0.05);
      this.inst('ammo_box', bx + fz * 0.35, 0.93, bz - fx * 0.35, ry + 0.4);
    } else this.box(bx, 0, bz, 1.2, 0.9, 1.2, this.M.crate, { collide: false, tile: 1.2 });
    this.box(bx, 0, bz, 1.3, 1.0, 1.3, null, { surface: 'wood', noMinimap: true });
    // terminal: post + lit screen
    this.box(px, 0, pz, 0.12, 1.25, 0.12, this.M.trim, { surface: 'metal', noMinimap: true });
    const scr = new THREE.PlaneGeometry(0.8, 0.5);
    scr.rotateX(-0.25); scr.rotateY(ry); scr.translate(px + fx * 0.07, 1.42, pz + fz * 0.07);
    this._push(buyScreenMaterial(), scr, false);
    const back = new THREE.BoxGeometry(0.86, 0.56, 0.05);
    back.rotateX(-0.25); back.rotateY(ry); back.translate(px + fx * 0.03, 1.42, pz + fz * 0.03);
    this._push(this.M.trim, back, true);
    return { pos: new THREE.Vector3(px, 0, pz), ry };
  }

  finish() {
    for (const { mat, geos, castShadow } of this.buckets.values()) {
      // merge in chunks to keep index ranges sane
      for (let i = 0; i < geos.length; i += 600) {
        const merged = mergeGeometries(geos.slice(i, i + 600), false);
        const mesh = new THREE.Mesh(merged, mat);
        mesh.castShadow = castShadow; mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false; mesh.updateMatrix();
        this.group.add(mesh);
      }
      geos.forEach((g) => g.dispose());
    }
    this.buckets.clear();
    // one batch per prop type *per map chunk*, so batches off screen (or outside the shadow map) are skipped entirely
    for (const { key, mats, shadow } of this.instances.values()) {
      const cells = new Map();
      for (const m of mats) {
        const far = Math.hypot(m.elements[12], m.elements[14]) > 80, size = far ? 120 : 24;
        const id = `${Math.floor(m.elements[12] / size)},${Math.floor(m.elements[14] / size)},${far}`;
        if (!cells.has(id)) cells.set(id, []);
        cells.get(id).push(m);
      }
      for (const list of cells.values()) {
        for (const part of propParts(key)) {
          const im = new THREE.InstancedMesh(part.geometry, part.material, list.length);
          list.forEach((m, i) => im.setMatrixAt(i, _m4.multiplyMatrices(m, part.matrix)));
          im.castShadow = shadow; im.receiveShadow = true;
          im.computeBoundingSphere();
          im.matrixAutoUpdate = false;
          this.group.add(im);
        }
      }
    }
    this.instances.clear();
  }
}

// small props whose shadows nobody would miss (they cost a shadow-map draw each)
const NO_SHADOW = new Set(['ammo_box', 'jerrycan']);
let BUY_SCREEN = null;
function buyScreenMaterial() {
  if (BUY_SCREEN) return BUY_SCREEN;
  const c = document.createElement('canvas'); c.width = 512; c.height = 320;
  const g = c.getContext('2d');
  g.fillStyle = '#04120a'; g.fillRect(0, 0, 512, 320);
  g.strokeStyle = '#7be29b'; g.lineWidth = 6; g.strokeRect(10, 10, 492, 300);
  g.fillStyle = '#7be29b'; g.font = 'bold 150px Rajdhani, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('$', 256, 130);
  g.font = 'bold 54px Rajdhani, sans-serif'; g.fillText('BUY STATION', 256, 250);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  BUY_SCREEN = new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(1.6, 1.6, 1.6), toneMapped: false });
  return BUY_SCREEN;
}

const _p = new THREE.Vector3(), _sc = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m4 = new THREE.Matrix4();

export function buildMap(id, renderer, world) {
  world.clear();
  const B = new Builder(renderer, world);
  const def = MAPS[id];
  const map = { ...def, detail: renderer.detail, group: B.group, spawns: { A: [], B: [], ffa: [] }, flags: [], barrels: B.barrels, bounds: null };
  buildWoodland(B, map);
  addMapPolish(B, map);
  // buy stations: one by each team's staging area and one in the middle of the map
  map.buyStations = map.buySpots.map(([x, z]) => B.buyStation(x, z)).filter(Boolean);
  B.finish();
  // validate spawns
  for (const k of ['A', 'B', 'ffa']) map.spawns[k] = map.spawns[k].filter((p) => !world.overlaps(p.x, 0.05, p.z, 0.6, 1.8));
  map.nav = new NavGrid(world, map.bounds, 0.5);
  map.minimap = drawMinimap(B.minimapRects, map.bounds);
  map.rects = B.minimapRects;
  // hardpoint rotation: keep only zones on open, walkable ground; fall back to the flag sites
  map.hardpoints = (map.hardpoints || []).filter((p) => map.nav.walkableAt(p.x, p.z));
  if (map.hardpoints.length < 3) map.hardpoints = map.flags.map((f) => f.pos.clone());
  // strategic points for bot roaming
  map.roam = [];
  for (let i = 0; i < 60; i++) {
    const x = B.rand(map.bounds.minX + 4, map.bounds.maxX - 4), z = B.rand(map.bounds.minZ + 4, map.bounds.maxZ - 4);
    if (map.nav.walkableAt(x, z)) map.roam.push(new THREE.Vector3(x, 0, z));
  }
  return map;
}

// ---------------------------------------------------------------- MINIMAP
function drawMinimap(rects, bounds) {
  const ppm = 4;
  const W = (bounds.maxX - bounds.minX) * ppm, H = (bounds.maxZ - bounds.minZ) * ppm;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#26352b';
  g.fillRect(0, 0, W, H);
  const sorted = [...rects].sort((a, b) => a.h - b.h);
  for (const r of sorted) {
    const l = Math.min(1, r.h / 8);
    const base = [85, 100, 77];
    g.fillStyle = `rgb(${base.map((v) => Math.round(v + l * 70)).join(',')})`;
    g.fillRect((r.x - bounds.minX) * ppm, (r.z - bounds.minZ) * ppm, Math.max(1, r.w * ppm), Math.max(1, r.d * ppm));
  }
  return { canvas: c, ppm };
}
