// AI combatant: perception (vision cone + LOS + hearing), reaction time, tracking error, strafing, pathfinding, grenades.
import * as THREE from 'three';
import { Actor, WeaponState } from './actor.js';
import { SoldierModel, nameTag } from './soldier.js';
import { WEAPONS, BOT_WEAPONS } from './weapons.js';
import { clamp, damp, dampAngle, rand, pick, wrapAngle, DEG, coneDirection } from '../core/utils.js';
import { audio } from '../engine/audio.js';

export const DIFFICULTY = {
  recruit: { reaction: 0.8, error: 6.0, turn: 3.6, head: 0.04, dmgMul: 0.75, burst: [2, 5], label: 'RECRUIT' },
  regular: { reaction: 0.52, error: 3.8, turn: 5.5, head: 0.1, dmgMul: 0.9, burst: [3, 7], label: 'REGULAR' },
  hardened: { reaction: 0.36, error: 2.5, turn: 7.5, head: 0.18, dmgMul: 1, burst: [4, 9], label: 'HARDENED' },
  veteran: { reaction: 0.25, error: 1.6, turn: 10, head: 0.28, dmgMul: 1.05, burst: [5, 12], label: 'VETERAN' },
};

const R_BOT = 0.34;

export class Bot extends Actor {
  constructor(game, name, team, faction, difficulty = 'regular') {
    super(name, team);
    this.game = game;
    this.diff = DIFFICULTY[difficulty] || DIFFICULTY.regular;
    this.faction = faction;
    this.weaponId = pick(game.botWeaponPool || BOT_WEAPONS);
    this.ws = new WeaponState(WEAPONS[this.weaponId]);
    this.model = new SoldierModel(faction, this.ws.def);
    game.R.scene.add(this.model.root);
    this.model.root.visible = false;
    this.tag = null;
    this.state = 'roam';
    this.path = null; this.pathT = 0; this.goal = null;
    this.target = null; this.targetSeenT = 0; this.reactT = 0; this.trackT = 0;
    this.lastSeenPos = new THREE.Vector3(); this.lastSeenTime = -99;
    this.investigate = null;
    this.aimErr = new THREE.Vector2(); this.errT = 0;
    this.strafe = 0; this.strafeT = 0; this.wantCrouch = false;
    this.burstLeft = 0; this.pauseT = 0; this.reloadT = -1;
    this.nadeCD = rand(6, 14);
    this.percT = Math.random() * 0.2;
    this.stuckT = 0; this.lastPos = new THREE.Vector3();
    this.respawnT = 0;
    this.deadT = 0;
    this.grenades = 1;
    this.lookYaw = 0;
  }

  setTag(visible, color) {
    if (visible && !this.tag) { this.tag = nameTag(this.name, color); this.tag.position.y = 2.15; this.model.root.add(this.tag); }
    if (this.tag) this.tag.visible = visible;
  }

  spawn(p, yaw) {
    // occasionally swap weapons between lives
    if (Math.random() < 0.35 && this.game.mode && this.game.mode.id !== 'gun') {
      this.weaponId = pick(this.game.botWeaponPool || BOT_WEAPONS);
      this.ws = new WeaponState(WEAPONS[this.weaponId]);
      this.model.setWeapon(this.ws.def);
    }
    this.ws.refill();
    this.pos.copy(p); this.vel.set(0, 0, 0); this.yaw = yaw; this.pitch = 0;
    this.alive = true; this.health = this.maxHealth; this.crouch = 0;
    this.state = 'roam'; this.path = null; this.target = null; this.investigate = null;
    this.reloadT = -1; this.burstLeft = 0; this.pauseT = 0; this.grenades = this.game.mode && this.game.mode.id === 'gun' ? 0 : 1;
    this.streak = 0;
    this.spawnTime = this.game.time;
    this.model.reset();
    this.model.root.visible = true;
    this.model.root.position.copy(p);
    this.model.root.rotation.set(0, yaw, 0);
    this.deadT = 0;
    this.lastPos.copy(p);
  }

  get def() { return this.ws.def; }

  /** Force a specific weapon (Gun Game). */
  setWeapon(def) {
    if (this.ws.def === def) return;
    this.weaponId = def.id;
    this.ws = new WeaponState(def);
    this.model.setWeapon(def);
    this.reloadT = -1; this.burstLeft = 0; this.pauseT = 0.3;
  }

  idealRange() {
    const c = this.def.cls;
    return c === 'SHOTGUN' ? 6 : c === 'SUBMACHINE GUN' ? 12 : c === 'SNIPER RIFLE' ? 45 : c === 'LIGHT MACHINE GUN' ? 28
      : c === 'PISTOL' || c === 'MACHINE PISTOL' ? 10 : c === 'MARKSMAN RIFLE' ? 34 : c === 'LAUNCHER' ? 20 : 22;
  }

  hearShot(shooter, pos) {
    if (!this.alive || this.target || !this.isEnemy(shooter, this.game.ffa)) return;
    const d = this.pos.distanceTo(pos);
    if (d < 48 && Math.random() < 0.85) { this.investigate = pos.clone(); this.investigateT = this.game.time; }
  }

  onDamaged(attacker) {
    if (!attacker || attacker === this) return;
    if (!this.target || this.target !== attacker) {
      this.investigate = attacker.pos.clone(); this.investigateT = this.game.time;
      this.alertYaw = Math.atan2(-(attacker.pos.x - this.pos.x), -(attacker.pos.z - this.pos.z));
    }
  }

  damage(amount, attacker, fromPos, cause) {
    const g = this.game;
    if (!this.alive) return;
    if (g.time - this.spawnTime < 1.2) return;
    this.health -= amount;
    this.lastHurt = g.time;
    if (attacker) this.damagers.set(attacker.id, { a: attacker, t: g.time, dmg: (this.damagers.get(attacker.id)?.dmg || 0) + amount });
    this.onDamaged(attacker);
    if (this.health <= 0) { this.health = 0; g.onKill(attacker, this, { cause }); }
  }

  die(fromDir) {
    this.alive = false;
    this.model.die(fromDir);
    this.deadT = 0;
    if (this.tag) this.tag.visible = false;
  }

  // ------------------------------------------------------------------ PERCEPTION
  perceive() {
    const g = this.game;
    const eye = this.eye(_eye);
    let best = null, bestScore = Infinity;
    const fwdX = -Math.sin(this.yaw), fwdZ = -Math.cos(this.yaw);
    for (const o of g.actors) {
      if (!o.alive || !this.isEnemy(o, g.ffa)) continue;
      const dx = o.pos.x - this.pos.x, dz = o.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 95) continue;
      const cos = (dx * fwdX + dz * fwdZ) / (d || 1);
      const noticed = cos > 0.42 || d < 7 || (g.time - o.lastShotTime < 0.5 && d < 40) || o === this.target;
      if (!noticed) continue;
      // low-crouched targets far away are harder to spot
      if (o.crouch > 0.5 && d > 55 && o !== this.target) continue;
      const vis = g.world.lineOfSight(eye, o.chest(_c)) || g.world.lineOfSight(eye, o.headPos(_c));
      if (!vis) continue;
      const score = d * (o === this.target ? 0.6 : 1) * (2 - cos);
      if (score < bestScore) { bestScore = score; best = o; }
    }
    if (best) {
      if (best !== this.target) {
        this.target = best;
        this.reactT = this.diff.reaction * rand(0.75, 1.3) * (this.def.cls === 'SNIPER RIFLE' ? 1.6 : 1) * (g.time - this.lastHurt < 1 ? 0.6 : 1);
        this.trackT = 0;
      }
      this.targetVisible = true;
      this.lastSeenPos.copy(best.pos); this.lastSeenTime = g.time;
    } else {
      this.targetVisible = false;
      if (this.target && g.time - this.lastSeenTime > 4) this.target = null;
      if (this.target && !this.target.alive) this.target = null;
    }
  }

  // ------------------------------------------------------------------ UPDATE
  update(dt) {
    const g = this.game;
    if (!this.alive) {
      this.deadT += dt;
      this.model.animate({ dt });
      if (this.deadT > 6) this.model.root.visible = false;
      return;
    }
    this.percT -= dt;
    if (this.percT <= 0) { this.percT = 0.14 + Math.random() * 0.06; this.perceive(); }
    if (this.target && !this.target.alive) { this.target = null; this.targetVisible = false; }

    // regen
    if (this.health < this.maxHealth && g.time - this.lastHurt > 4) this.health = Math.min(this.maxHealth, this.health + 35 * dt);

    let moveDir = _md.set(0, 0, 0), speed = 5.2, sprint = false;
    let lookAt = null;
    this.nadeCD -= dt;

    if (this.target && this.targetVisible) {
      this.state = 'engage';
      const tgt = this.target;
      const dist = this.pos.distanceTo(tgt.pos);
      this.trackT += dt;
      // strafe pattern
      this.strafeT -= dt;
      if (this.strafeT <= 0) {
        this.strafeT = rand(0.45, 1.3);
        const r = Math.random();
        const ideal = this.idealRange();
        this.approach = dist > ideal * 1.5 ? 1 : dist < ideal * 0.4 ? -0.6 : 0;
        this.strafe = r < 0.4 ? -1 : r < 0.8 ? 1 : 0;
        this.wantCrouch = Math.random() < (this.def.cls === 'SNIPER RIFLE' || this.def.cls === 'LIGHT MACHINE GUN' ? 0.5 : 0.2);
      }
      const toT = _t.subVectors(tgt.pos, this.pos).setY(0).normalize();
      const side = _s.set(-toT.z, 0, toT.x);
      moveDir.addScaledVector(side, this.strafe).addScaledVector(toT, this.approach || 0);
      speed = this.wantCrouch ? 2.2 : 3.6;
      lookAt = this.aimPoint(tgt, dt);
      this.tryFire(dt, tgt, lookAt);
      // grenade at hard-to-hit targets behind cover
    } else {
      this.wantCrouch = false;
      // lost target: search last known
      if (this.target && g.time - this.lastSeenTime < 4) {
        this.state = 'search';
        if (this.nadeCD <= 0 && this.grenades > 0 && Math.random() < 0.02) {
          const d = this.pos.distanceTo(this.lastSeenPos);
          if (d > 9 && d < 28) { this.grenades--; this.nadeCD = rand(14, 24); g.throwGrenade(this, this.lastSeenPos.clone()); }
        }
        this.setGoal(this.lastSeenPos);
        lookAt = _la.copy(this.lastSeenPos).setY(this.lastSeenPos.y + 1.3);
      } else if (this.investigate && g.time - this.investigateT < 8) {
        this.state = 'investigate';
        this.setGoal(this.investigate);
        lookAt = _la.copy(this.investigate).setY(1.4);
        if (this.pos.distanceTo(this.investigate) < 2) this.investigate = null;
      } else {
        this.state = 'roam';
        if (!this.goal || this.pathT <= 0 || (this.path && this.path.length === 0)) {
          const goal = g.botGoal(this);
          this.setGoal(goal, true);
        }
        sprint = this.path && this.path.length > 2 && this.pos.distanceTo(this.goal) > 15;
      }
      this.followPath(moveDir, dt);
      speed = sprint ? 7.2 : 5.0;
      if (this.reloadT < 0) this.reloadIfNeeded(dt, true);
    }
    this.pathT -= dt;
    if (this.reloadT >= 0) { speed *= 0.8; this.reloadIfNeeded(dt, false); }

    // separation from other actors
    for (const o of g.actors) {
      if (o === this || !o.alive) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < 1.4 && d2 > 1e-4) { const d = Math.sqrt(d2); moveDir.x += (dx / d) * (1.2 - d) * 1.5; moveDir.z += (dz / d) * (1.2 - d) * 1.5; }
    }
    if (moveDir.lengthSq() > 1) moveDir.normalize();
    speed *= this.def.move;

    // physics
    const k = 1 - Math.exp(-10 * dt);
    this.vel.x += (moveDir.x * speed - this.vel.x) * k;
    this.vel.z += (moveDir.z * speed - this.vel.z) * k;
    this.vel.y -= 22 * dt;
    const res = g.world.move(this.pos, this.vel, dt, R_BOT, this.height, { grounded: this.grounded, step: 0.45 });
    this.grounded = res.grounded;
    if (res.hitWall && this.state === 'engage') this.strafe = -this.strafe;
    this.crouch = damp(this.crouch, this.wantCrouch ? 1 : 0, 8, dt);

    // stuck detection
    this.stuckT += dt;
    if (this.stuckT > 1.2) {
      const moved = this.pos.distanceTo(this.lastPos);
      if (moved < 0.4 && moveDir.lengthSq() > 0.2 && this.state !== 'engage') {
        if (this.grounded) this.vel.y = 6.5;
        this.path = null; this.pathT = 0;
        if (this.goal) this.goal.x += rand(-4, 4), this.goal.z += rand(-4, 4);
      }
      this.stuckT = 0; this.lastPos.copy(this.pos);
    }

    // facing
    if (lookAt) {
      const eye = this.eye(_eye);
      const dx = lookAt.x - eye.x, dy = lookAt.y - eye.y, dz = lookAt.z - eye.z;
      const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
      const turn = this.diff.turn * (this.state === 'engage' ? 1 : 0.6);
      this.yaw = dampAngle(this.yaw, yaw, turn, dt);
      this.pitch = damp(this.pitch, pitch, turn, dt);
    } else if (this.alertYaw !== undefined && g.time - this.lastHurt < 1.5) {
      this.yaw = dampAngle(this.yaw, this.alertYaw, this.diff.turn, dt);
    } else {
      const hs = Math.hypot(this.vel.x, this.vel.z);
      if (hs > 0.5) this.yaw = dampAngle(this.yaw, Math.atan2(-this.vel.x, -this.vel.z), 6, dt);
      this.pitch = damp(this.pitch, 0, 4, dt);
    }

    // footsteps audible to the player
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.stepAcc = (this.stepAcc || 0) + hs * dt;
    if (this.stepAcc > 2.3 && this.grounded) {
      this.stepAcc = 0;
      if (this.crouch < 0.5 && this.pos.distanceToSquared(g.player.pos) < 900) audio.footstep(_c.copy(this.pos), hs > 6, res.surface === 'metal' ? 'metal' : 'concrete');
    }

    // model
    const m = this.model;
    m.root.position.copy(this.pos);
    m.root.rotation.y = this.yaw;
    const back = hs > 0.5 && (this.vel.x * -Math.sin(this.yaw) + this.vel.z * -Math.cos(this.yaw)) < -0.4 * hs;
    m.animate({ dt, speed: hs, crouch: this.crouch > 0.5, pitch: this.pitch, back });
  }

  aimPoint(tgt, dt) {
    const g = this.game;
    this.errT -= dt;
    if (this.errT <= 0) {
      this.errT = rand(0.2, 0.45);
      const track = 1 + 1.8 * Math.exp(-this.trackT * 1.2);
      const tSpeed = Math.hypot(tgt.vel.x, tgt.vel.z);
      const mag = this.diff.error * DEG * track * (1 + tSpeed * 0.08) * (tgt.crouch > 0.5 ? 1.15 : 1) * (this.crouch > 0.5 ? 0.85 : 1);
      this.aimErr.set(rand(-1, 1) * mag, rand(-1, 1) * mag * 0.7);
      this.aimHead = Math.random() < this.diff.head;
    }
    const p = this.aimHead ? tgt.headPos(_ap) : tgt.chest(_ap);
    const dist = this.pos.distanceTo(tgt.pos);
    // apply angular error as positional offset
    const right = _s.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    p.addScaledVector(right, Math.tan(this.aimErr.x) * dist);
    p.y += Math.tan(this.aimErr.y) * dist;
    return p;
  }

  tryFire(dt, tgt, aimP) {
    const g = this.game;
    if (this.reloadT >= 0) return;
    this.reactT -= dt;
    if (this.reactT > 0) return;
    const ws = this.ws, def = ws.def;
    if (ws.mag <= 0) { this.reloadT = 0; return; }
    // angle check
    const eye = this.eye(_eye);
    const want = _t.subVectors(aimP, eye).normalize();
    const fwd = this.forward(_f);
    if (fwd.dot(want) < Math.cos(9 * DEG)) return;
    if (this.pauseT > 0) { this.pauseT -= dt; return; }
    if (g.time < ws.nextFire) return;
    if (def.rocket) {
      // launchers: keep a safe distance, one rocket at a time
      if (this.pos.distanceTo(tgt.pos) < 7) return;
      const muzzle = this.model.muzzleWorld(_mz);
      g.fireRocket(this, muzzle, _dir.subVectors(aimP, muzzle).normalize());
      ws.mag--; this.lastShotTime = g.time; this.model.fire();
      g.fx.muzzle(muzzle, 1.5);
      audio.shot(def.sound, _c.copy(muzzle), false);
      ws.nextFire = g.time + rand(1.5, 2.5);
      if (ws.mag <= 0) this.reloadT = 0;
      return;
    }
    if (this.burstLeft <= 0) {
      const auto = def.mode === 'auto';
      this.burstLeft = auto ? Math.round(rand(this.diff.burst[0], this.diff.burst[1])) : def.mode === 'burst' ? def.burst : 1;
    }
    // shoot along the facing (which lags the aim point -> natural tracking error)
    const spread = (def.cls === 'SHOTGUN' ? def.adsSpread : def.adsSpread + def.hip * 0.18) * DEG;
    const muzzle = this.model.muzzleWorld(_mz);
    const pellets = def.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const dir = coneDirection(fwd, spread, _dir);
      g.fireBullet(this, eye, dir, def, { muzzle, tracer: i === 0, dmgMul: this.diff.dmgMul });
    }
    ws.mag--;
    this.lastShotTime = g.time;
    this.model.fire();
    g.fx.muzzle(muzzle, 0.5);
    audio.shot(def.sound, _c.copy(muzzle), false);
    g.onShotSound(this, this.pos);
    this.burstLeft--;
    ws.nextFire = g.time + 60 / def.rpm * (def.mode === 'auto' || def.mode === 'burst' ? 1.05 : rand(1.2, 2.2));
    if (this.burstLeft <= 0) this.pauseT = def.mode === 'burst' ? def.burstDelay + rand(0.1, 0.3) : def.mode === 'auto' ? rand(0.18, 0.5) : rand(0.05, 0.3);
    if (ws.mag <= 0) this.reloadT = 0;
  }

  reloadIfNeeded(dt, idle) {
    const ws = this.ws;
    if (this.reloadT < 0) {
      if (idle && ws.mag < ws.def.mag * 0.5) this.reloadT = 0;
      return;
    }
    this.reloadT += dt;
    if (this.reloadT >= ws.def.reload * (ws.def.shellReload ? ws.def.mag * 0.6 : 1.15)) { ws.mag = ws.def.mag; this.reloadT = -1; }
  }

  setGoal(p, force = false) {
    const g = this.game;
    if (!force && this.goal && this.goal.distanceToSquared(p) < 4 && this.path && this.pathT > 0) return;
    if (g.time < (this.navRetryAt || 0)) return; // a search just failed: don't run a full A* again every frame
    if (g.navBudget <= 0 && this.path) return;
    g.navBudget--;
    this.goal = (this.goal || new THREE.Vector3()).copy(p);
    this.path = g.map.nav.findPath(this.pos, p);
    this.pathT = rand(4, 8);
    if (!this.path) { this.pathT = 0.5; this.goal = null; this.navRetryAt = g.time + 0.5; }
  }

  followPath(out, dt) {
    if (!this.path || this.path.length === 0) return;
    const wp = this.path[0];
    const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.7) { this.path.shift(); if (this.path.length === 0) { this.pathT = 0; } return; }
    out.x += dx / d; out.z += dz / d;
  }
}

const _eye = new THREE.Vector3(), _c = new THREE.Vector3(), _md = new THREE.Vector3(), _t = new THREE.Vector3(), _s = new THREE.Vector3();
const _la = new THREE.Vector3(), _ap = new THREE.Vector3(), _f = new THREE.Vector3(), _mz = new THREE.Vector3(), _dir = new THREE.Vector3();
