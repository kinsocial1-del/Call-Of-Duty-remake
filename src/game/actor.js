// Shared combatant state + hitbox tests (used by both the human player and bots).
import * as THREE from 'three';
import { raySphere, raySegmentDistance } from '../core/utils.js';

let NEXT_ID = 1;

export class WeaponState {
  constructor(def) {
    this.def = def;
    this.mag = def.mag;
    this.reserve = def.reserve;
    this.burstLeft = 0;
    this.nextFire = 0;
    this.needsCycle = false;
  }
  refill() { this.mag = this.def.mag; this.reserve = this.def.reserve; this.burstLeft = 0; this.nextFire = 0; this.needsCycle = false; }
}

export class Actor {
  constructor(name, team) {
    this.id = NEXT_ID++;
    this.name = name;
    this.team = team;
    this.isPlayer = false;
    this.alive = false;
    this.health = 100;
    this.maxHealth = 100;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.crouch = 0;          // 0 stand .. 1 crouched (smoothed)
    this.grounded = true;
    this.kills = 0; this.deaths = 0; this.assists = 0; this.score = 0; this.streak = 0; this.captures = 0; this.confirms = 0; this.gunLevel = 0;
    this.damagers = new Map();
    this.lastShotTime = -99;  // for radar ping
    this.lastHurt = -99;
    this.spawnTime = 0;
  }

  get height() { return 1.8 - this.crouch * 0.6; }

  eye(out) { return out.set(this.pos.x, this.pos.y + 1.62 - this.crouch * 0.55, this.pos.z); }
  chest(out) { return out.set(this.pos.x, this.pos.y + 1.28 - this.crouch * 0.42, this.pos.z); }
  headPos(out) { return out.set(this.pos.x, this.pos.y + 1.66 - this.crouch * 0.52, this.pos.z); }

  forward(out) { return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)); }

  /** Ray vs body capsules. Returns { t, part } or null. */
  hitTest(o, d, maxT) {
    if (!this.alive) return null;
    // broad phase: distance from ray to actor centre
    const cx = this.pos.x - o.x, cy = this.pos.y + 0.9 - o.y, cz = this.pos.z - o.z;
    const proj = cx * d.x + cy * d.y + cz * d.z;
    if (proj < -1 || proj > maxT + 1) return null;
    const px = cx - d.x * proj, py = cy - d.y * proj, pz = cz - d.z * proj;
    if (px * px + py * py + pz * pz > 1.6) return null;
    let best = null;
    const c = this.crouch;
    // head
    const h = raySphere(o, d, this.headPos(_h), 0.15);
    if (h >= 0 && h < maxT) best = { t: h, part: 'head' };
    // torso
    _a.set(this.pos.x, this.pos.y + 0.98 - c * 0.36, this.pos.z);
    _b.set(this.pos.x, this.pos.y + 1.45 - c * 0.45, this.pos.z);
    let r = raySegmentDistance(o, d, maxT, _a, _b);
    if (r.dist < 0.25 && (!best || r.t < best.t - 0.05)) best = { t: r.t, part: 'body' };
    // legs
    _a.set(this.pos.x, this.pos.y + 0.12, this.pos.z);
    _b.set(this.pos.x, this.pos.y + 0.92 - c * 0.35, this.pos.z);
    r = raySegmentDistance(o, d, maxT, _a, _b);
    if (r.dist < 0.2 && (!best || r.t < best.t - 0.05)) best = { t: r.t, part: 'limb' };
    return best;
  }

  /** Distance from a ray to the head, for near-miss detection. */
  missDistance(o, d, maxT) {
    this.headPos(_h);
    const cx = _h.x - o.x, cy = _h.y - o.y, cz = _h.z - o.z;
    const proj = Math.max(0, Math.min(maxT, cx * d.x + cy * d.y + cz * d.z));
    const px = cx - d.x * proj, py = cy - d.y * proj, pz = cz - d.z * proj;
    return { dist: Math.sqrt(px * px + py * py + pz * pz), t: proj };
  }

  isEnemy(other, ffa) {
    if (!other || other === this) return false;
    return ffa ? true : other.team !== this.team;
  }
}

const _h = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
