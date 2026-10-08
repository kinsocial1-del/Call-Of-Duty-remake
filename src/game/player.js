// Human player controller: movement (sprint, tactical sprint, slide, mantle, crouch, jump), weapons, ADS, recoil, aim assist.
import * as THREE from 'three';
import { Actor, WeaponState } from './actor.js';
import { WEAPONS } from './weapons.js';
import { HOLD_TIME } from './pickups.js';
import { clamp, damp, lerp, DEG, coneDirection, wrapAngle } from '../core/utils.js';
import { audio } from '../engine/audio.js';
import { profile } from '../core/save.js';

const R_PLAYER = 0.34;
const GRAV = 22;
// Responsive shooter tuning: quick starts, firm stops, and faster weapon presentation.
const RESPONSE = {
  accelerate: 60, brake: 90, reverse: 80, air: 3.2,
  adsTimeScale: 0.65, adsExitScale: 0.75, adsMove: 0.7,
  sprintOut: 0.09, tacSprintOut: 0.17,
};

export class Player extends Actor {
  constructor(game, name) {
    super(name, 'A');
    this.game = game;
    this.isPlayer = true;
    this.weapons = [];
    this.cur = 0;
    this.grenades = 2;
    this.reset();
  }

  reset() {
    this.inspectT = -1; this.reloadCommitted = false;
    this.adsT = 0; this.sprinting = false; this.tac = false; this.tacTime = 0; this.tacCooldown = 0; this.sprintToggle = false;
    this.slideT = 0; this.mantle = null; this.crouchWanted = false; this.crouch = 0;
    this.swapT = -1; this.swapTo = -1; this.reloadT = -1; this.reloadDur = 1; this.reloadEmpty = false; this.shellT = -1;
    this.cycleT = -1; this.meleeT = -1; this.nadeT = -1; this.meleeDone = false; this.nadeDone = false;
    this.recoil = { p: 0, y: 0 }; this.bloom = 0; this.sprintOutT = 0;
    this.kickPend = { p: 0, y: 0 }; this.shotChain = 0; this.fovKick = 0; this.heat = 0;
    this.breath = { holding: false, left: 4, tired: 0 }; this.scopeSway = { x: 0, y: 0 };
    this.camBob = 0; this.landDip = 0; this.stepDist = 0; this.eyeH = 1.62; this.roll = 0;
    this.lastSprintP = -9; this.airTime = 0; this.fallVel = 0;
    this.vel.set(0, 0, 0); this.grounded = true; this.speed = 0;
    this.lookDX = this.lookDY = 0; this.pendingFireUntil = -1; this.fovBoost = 0; this.stairOffset = 0;
    this.jumpBufferedUntil = -1; this.lastGroundedTime = -Infinity;
    this._deferReload = this._blockReload = this._modeOverride = false;
    if (this.kickPend) { this.kickPend.p = this.kickPend.y = 0; this.scopeSway.x = this.scopeSway.y = 0; this.shotChain = 0; this.heat = 0; this.fovKick = 0; this.swayAmp = 0; this.breath.left = 4; this.breath.tired = 0; }
    this.autoReloadAt = -1;
  }

  setLoadout(lo) {
    this.loadout = { ...lo, perks: [...lo.perks] };
    this.perks = new Set(lo.perks);
    this.weapons = [new WeaponState(WEAPONS[lo.primary] || WEAPONS.vx4), new WeaponState(WEAPONS[lo.secondary] || WEAPONS.p17)];
    this.cur = 0;
  }

  /** Gun Game: the player carries exactly one weapon. */
  setSingleWeapon(def) {
    if (this.weapons.length === 1 && this.weapons[0].def === def) return;
    this.weapons = [new WeaponState(def)];
    this.cur = 0;
    this._raise(def);
  }

  /** Swap the weapon in hand for a picked-up one. */
  replaceWeapon(def, mag, reserve) {
    const ws = new WeaponState(def);
    ws.mag = Math.min(def.mag, mag); ws.reserve = Math.min(def.reserve, reserve);
    this.weapons[this.cur] = ws;
    this._raise(def);
  }

  _raise(def) {
    this.reloadT = -1; this.shellT = -1; this.cycleT = -1; this._modeOverride = false; this.autoReloadAt = -1;
    if (this.alive) { this.game.vm.setWeapon(def); this.swapT = 0.5; this.swapTo = -1; }
  }

  get w() { return this.weapons[this.cur]; }
  get def() { return this.w.def; }
  get busy() { return this.swapT >= 0 || this.reloadT >= 0 || this.meleeT >= 0 || this.nadeT >= 0 || !!this.mantle; }

  spawn(p, yaw) {
    this.pos.copy(p); this.yaw = yaw; this.pitch = 0;
    this.alive = true; this.health = this.maxHealth; this.armor = 0;   // bought armour is lost on death
    this.reset();
    this.weapons.forEach((w) => { w.refill(); if (this.perks.has('reserves')) w.reserve = Math.round(w.reserve * 1.5); });
    this.cur = 0;
    this.grenades = this.game.mode && this.game.mode.id === 'gun' ? 0 : this.perks.has('grenadier') ? 3 : 2;
    this.streak = 0;
    this.useHold = 0; this.useDone = false; this.pickup = null;
    this.spawnTime = this.game.time;
    this.game.vm.setWeapon(this.def);
    this.swapT = 0.5; this.swapTo = -1; // raise animation
  }

  cancelInput() {
    if (this.sprinting) this.sprintOutT = this.tac ? RESPONSE.tacSprintOut : RESPONSE.sprintOut;
    if (this.tac) this.tacCooldown = this.perks.has('marathon') || this.perks.has('lightweight') ? 3 : 5;
    this.sprinting = this.tac = this.sprintToggle = false;
    this.pendingFireUntil = -1; this.jumpBufferedUntil = -1; this.inspectT = -1;
  }

  speedMult() { return this.perks.has('lightweight') ? 1.08 : 1; }

  update(dt, a) {
    const g = this.game, s = profile.s;
    if (!this.alive) return;
    const now = g.time;
    const previousY = this.pos.y, previousGrounded = this.grounded, wasMantling = !!this.mantle;
    if (this.grounded) this.lastGroundedTime = now;
    if (a.jumpP && !this.mantle) this.jumpBufferedUntil = now + 0.1;

    // ---------------- LOOK
    const zoomFactor = lerp(1, this.def.zoom, this.adsT);
    const adsSens = lerp(1, s.adsSens, this.adsT) * zoomFactor;
    let lookX = 0, lookY = 0;
    if (a.mx || a.my) { lookX += a.mx * 0.0021 * s.sens * adsSens; lookY += a.my * 0.0021 * s.sens * adsSens; }
    if (a.padLookX || a.padLookY) {
      const curve = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.8);
      let slow = 1;
      const tgt = s.aimAssist ? g.aimAssistTarget(this) : null;
      if (tgt) {
        slow = 0.5;
        // rotational assist: drift toward target while the player is tracking
        const pull = 1 - Math.exp(-(this.adsT > 0.5 ? 3.2 : 1.6) * dt);
        this.yaw += wrapAngle(tgt.yaw - this.yaw) * pull;
        this.pitch += (tgt.pitch - this.pitch) * pull * 0.6;
      }
      lookX += curve(a.padLookX) * 3.2 * s.padSens * adsSens * slow * dt;
      lookY += curve(a.padLookY) * 2.3 * s.padSens * adsSens * slow * dt;
    }
    if (s.invertY) lookY = -lookY;
    this.yaw -= lookX; this.pitch -= lookY;
    this.lookDX = lookX / Math.max(dt, 1e-3); this.lookDY = lookY / Math.max(dt, 1e-3);
    // camera kick is fed in over ~40 ms instead of snapping, so the climb reads as a shove, not a teleport
    const kf = 1 - Math.exp(-dt / 0.018);
    const kp = this.kickPend.p * kf, ky = this.kickPend.y * kf;
    this.pitch += kp; this.yaw += ky; this.kickPend.p -= kp; this.kickPend.y -= ky;
    if (now - this.lastShotTime > 0.28) this.shotChain = 0;
    this.heat = Math.max(0, this.heat - dt * 2.5);
    this.fovKick = damp(this.fovKick, 0, 14, dt);
    this.updateScopeSway(dt, a, now);
    // recoil recovery
    const rec = 1 - Math.exp(-6 * dt);
    const rp = this.recoil.p * rec * 0.55, ry = this.recoil.y * rec * 0.55;
    this.pitch -= rp; this.yaw -= ry; this.recoil.p -= this.recoil.p * rec; this.recoil.y -= this.recoil.y * rec;
    this.pitch = clamp(this.pitch, -1.5, 1.5);
    this.yaw = wrapAngle(this.yaw);

    // ---------------- STANCE / SPRINT
    const fwdInput = a.ly > 0.5;
    // Sprint cancels a reload; ammo remains tied to the actual insertion stage.
    if ((a.sprint || this.sprintToggle) && fwdInput && !a.ads && !a.fire && !this.mantle) {
      this.reloadT = -1; this.shellT = -1;
    }
    if (a.sprintP) {
      // pad: click L3 again while sprinting. keyboard: double-tap shift.
      const pad = g.input.lastDevice === 'pad';
      const trigger = pad ? this.sprinting : now - this.lastSprintP < 0.35;
      if (trigger && this.tacCooldown <= 0 && !this.tac && fwdInput) { this.tac = true; this.tacTime = this.perks.has('marathon') ? 5.4 : 3.6; }
      else if (pad) this.sprintToggle = true;
      this.lastSprintP = now;
    }
    if (a.fire || a.ads) this.sprintToggle = false;
    const wantSprint = (a.sprint || this.sprintToggle) && fwdInput && this.grounded && this.slideT <= 0 && !a.ads && !a.fire && !g.world.overlaps(this.pos.x, this.pos.y + 0.001, this.pos.z, R_PLAYER, 1.8);
    const wasSprinting = this.sprinting, wasTac = this.tac;
    this.sprinting = wantSprint && this.reloadT < 0 && this.shellT < 0 && this.swapT < 0 && this.meleeT < 0 && this.nadeT < 0 && !this.mantle && !a.reloadP && !a.meleeP && !a.grenadeP && !a.swapP && !a.w1P && !a.w2P;
    if (this.sprinting && this.crouchWanted && !a.crouchP) this.crouchWanted = false;
    if (!this.sprinting) { this.sprintToggle = this.sprintToggle && fwdInput; if (this.tac) { this.tac = false; this.tacCooldown = this.perks.has('marathon') || this.perks.has('lightweight') ? 3 : 5; } }
    if (wasSprinting && !this.sprinting) this.sprintOutT = wasTac ? RESPONSE.tacSprintOut : RESPONSE.sprintOut;
    if (this.tac) { this.tacTime -= dt; if (this.tacTime <= 0) { this.tac = false; this.tacCooldown = this.perks.has('marathon') || this.perks.has('lightweight') ? 3 : 5; } }
    else this.tacCooldown = Math.max(0, this.tacCooldown - dt);
    this.sprintOutT = Math.max(0, this.sprintOutT - dt);

    if (a.crouchP && !this.mantle) {
      const spd = Math.hypot(this.vel.x, this.vel.z);
      if (this.sprinting && this.grounded && spd > 6) {
        this.slideT = 0.9; this.sprinting = false; this.sprintToggle = false;
        if (this.tac) this.tacCooldown = this.perks.has('marathon') || this.perks.has('lightweight') ? 3 : 5;
        this.tac = false; this.sprintOutT = wasTac ? RESPONSE.tacSprintOut : RESPONSE.sprintOut;
        const f = _f.set(this.vel.x / spd, 0, this.vel.z / spd);
        this.vel.x = f.x * Math.max(spd, 10.5); this.vel.z = f.z * Math.max(spd, 10.5);
        audio.footstep(null, true); audio.click(0.25, 500, 0.4);
      } else if (this.slideT > 0) { this.slideT = 0; this.crouchWanted = false; }
      else this.crouchWanted = !this.crouchWanted;
    }
    if (this.slideT > 0) {
      this.slideT -= dt;
      if (this.slideT <= 0) this.crouchWanted = true;
    }
    let targetCrouch = this.mantle ? this.crouch : this.slideT > 0 ? 1.25 : this.crouchWanted ? 1 : 0;
    if (targetCrouch < this.crouch && g.world.overlaps(this.pos.x, this.pos.y + 0.001, this.pos.z, R_PLAYER, 1.8 - targetCrouch * 0.6)) targetCrouch = this.crouch; // no headroom
    this.crouch = damp(this.crouch, targetCrouch, 20, dt);

    // ---------------- MANTLE / JUMP
    if (this.mantle) {
      const m = this.mantle; m.t += dt / m.dur;
      const k = Math.min(1, m.t);
      // Lift before moving over the lip; follow the same path checked by tryMantle.
      this.pos.y = lerp(m.from.y, m.to.y, Math.min(1, k * 3));
      const travel = clamp((k - 1 / 3) * 1.5, 0, 1);
      const te = travel * travel * (3 - 2 * travel);
      this.pos.x = lerp(m.from.x, m.to.x, te); this.pos.z = lerp(m.from.z, m.to.z, te);
      if (k >= 1) { this.mantle = null; this.vel.set(0, 0, 0); this.grounded = true; }
    } else if (now <= this.jumpBufferedUntil) {
      if (!(a.jumpP && this.tryMantle())) {
        if (this.grounded && this.crouchWanted && this.slideT <= 0) { this.crouchWanted = false; this.jumpBufferedUntil = -1; }
        else if ((this.grounded || now - this.lastGroundedTime <= 0.075) && !g.world.overlaps(this.pos.x, this.pos.y + 0.05, this.pos.z, R_PLAYER, this.height)) {
          this.vel.y = 7.2; this.grounded = false; this.jumpBufferedUntil = -1; this.lastGroundedTime = -Infinity;
          g.vm.jump();
          if (this.slideT > 0) { this.slideT = 0; this.crouchWanted = false; }
          audio.footstep(null, true);
        }
      } else this.jumpBufferedUntil = -1;
    }

    // ---------------- ADS
    const canAds = !this.sprinting && !this.mantle && this.swapT < 0 && this.meleeT < 0 && this.nadeT < 0 && !a.swapP && !a.w1P && !a.w2P && !a.meleeP && !a.grenadeP && !a.reloadP;
    const adsTarget = a.ads && canAds && (this.reloadT < 0 || this.def.shellReload) ? 1 : 0;
    const adsDuration = this.def.adsTime * RESPONSE.adsTimeScale * (this.perks.has('steady') ? 0.85 : 1);
    const adsSpeed = 1 / (adsDuration * (adsTarget ? 1 : RESPONSE.adsExitScale));
    if (adsTarget && this.adsT === 0 && g.input.lastDevice === 'pad' && s.aimAssist) g.aimSnap(this);
    this.adsT = clamp(this.adsT + (adsTarget ? 1 : -1) * adsSpeed * dt, 0, 1);

    // ---------------- MOVE
    if (!this.mantle) {
      const fwd = _f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const right = _r.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const wish = _w.set(0, 0, 0).addScaledVector(fwd, a.ly).addScaledVector(right, a.lx);
      if (wish.lengthSq() > 1) wish.normalize();
      let speed = 5.4;
      if (this.sprinting) speed = this.tac ? 9.7 : 7.7;
      speed *= lerp(1, 0.5, this.crouch);
      speed *= lerp(1, (RESPONSE.adsMove * (this.perks.has('stalker') ? 1.15 : 1)), this.adsT);
      speed *= this.def.move * this.speedMult();
      const steps = Math.max(1, Math.ceil(dt / (1 / 120))), stepDt = dt / steps;
      let res, preVy = this.vel.y;
      const startedGrounded = this.grounded;
      for (let i = 0; i < steps; i++) {
        if (this.slideT > 0) {
          const fr = Math.exp(-1.6 * stepDt), steer = 3 * (1 - fr) / 1.6;
          this.vel.x = this.vel.x * fr + wish.x * steer;
          this.vel.z = this.vel.z * fr + wish.z * steer;
        } else {
          const stopping = wish.lengthSq() < 1e-6;
          const reversing = this.vel.x * wish.x + this.vel.z * wish.z < 0;
          const response = this.grounded ? (stopping ? RESPONSE.brake : reversing ? RESPONSE.reverse : RESPONSE.accelerate) : RESPONSE.air;
          const k = 1 - Math.exp(-response * stepDt);
          // Preserve jump momentum; releasing movement in the air does not apply ground brakes.
          if (this.grounded || !stopping) {
            const airSpeed = this.grounded ? speed : Math.max(speed, Math.hypot(this.vel.x, this.vel.z));
            this.vel.x += (wish.x * airSpeed - this.vel.x) * k;
            this.vel.z += (wish.z * airSpeed - this.vel.z) * k;
          }
        }
        this.vel.y -= GRAV * stepDt;
        preVy = Math.min(preVy, this.vel.y);
        res = g.world.move(this.pos, this.vel, stepDt, R_PLAYER, this.height, { grounded: this.grounded, step: 0.45 });
        this.grounded = res.grounded;
      }
      if (!startedGrounded && res.grounded) {
        if (preVy < -7) { audio.land(); this.landDip = Math.min(0.075, -preVy * 0.006); g.input.rumble(0.3, 0.1, 80); }
        if (preVy < -3.5) g.vm.land(Math.min(1, (-preVy - 3.5) / 9));
        if (preVy < -16) this.damage(Math.round((-preVy - 16) * 9), null, null, 'fall');
      }
      this.grounded = res.grounded;
      this.surface = res.surface;
      // keep within playable bounds
      const b = g.map.bounds;
      const bx = clamp(this.pos.x, b.minX + 0.5, b.maxX - 0.5), bz = clamp(this.pos.z, b.minZ + 0.5, b.maxZ - 0.5);
      if (bx !== this.pos.x) this.vel.x = 0;
      if (bz !== this.pos.z) this.vel.z = 0;
      this.pos.x = bx; this.pos.z = bz;
    }
    // Smooth only the presentation of step-ups. Collision and input stay immediate.
    if (previousGrounded && this.grounded && !wasMantling && !this.mantle && this.pos.y > previousY) {
      this.stairOffset = Math.max(-0.45, this.stairOffset + previousY - this.pos.y);
    }
    if (!this.grounded || this.mantle) this.stairOffset = 0;
    if (this.pos.y < -20) this.damage(999, null, null, 'fall');

    // footsteps
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && this.slideT <= 0) {
      this.stepDist += hs * dt;
      const stride = this.sprinting ? 2.5 : 2.0;
      if (this.stepDist > stride) { this.stepDist = 0; if (this.crouch < 0.5 || this.sprinting) audio.footstep(null, this.sprinting, this.surface === 'metal' ? 'metal' : this.surface === 'wood' ? 'wood' : 'concrete'); }
    }
    this.speed = hs;

    // ---------------- PICKUPS (hold interact to swap; on a pad, a tap of the shared button still reloads)
    this.pickup = g.mode.id === 'gun' ? null : g.pickups.near(this);
    this.station = this.pickup ? null : g.buy.near(this);
    const padUse = g.input.lastDevice === 'pad';
    if ((this.pickup || this.station) && a.interact) {
      this.useHold += dt;
      if (this.useHold >= (this.pickup ? HOLD_TIME : 0.3) && !this.useDone && !this.busy) {
        this.useDone = true;
        if (this.pickup) { g.pickups.take(this, this.pickup); this.pickup = null; } else g.buy.openShop();
      }
    } else {
      if (padUse && this.useHold > 0 && !this.useDone) this._deferReload = true;
      this.useHold = 0; this.useDone = false;
    }
    this._blockReload = padUse && !!(this.pickup || this.station);

    // ---------------- WEAPON ACTIONS
    this.updateWeapon(dt, a, now);

    // health regen
    const delay = this.perks.has('quickfix') ? 2.2 : 3.6;
    if (this.health < this.maxHealth && now - this.lastHurt > delay) this.health = Math.min(this.maxHealth, this.health + (this.perks.has('quickfix') ? 70 : 42) * dt);
    if (this.health < 40 && Math.floor(now * 1.4) !== this._hb) { this._hb = Math.floor(now * 1.4); audio.heartbeat(); }
  }

  /**
   * Scoped rifles drift with the player's breathing. Hold sprint (Shift / L3) while scoped to hold your breath
   * and steady the shot for up to 4 s; after that the shooter gasps and the sway is worse for a couple of seconds.
   */
  updateScopeSway(dt, a, now) {
    const b = this.breath, scoped = this.def.scope && this.adsT > 0.6 && this.alive;
    const want = scoped && a.sprint && b.tired <= 0 && b.left > 0;
    if (want && !b.holding) audio.click(0.08, 900, 0.12);   // sharp inhale
    if (!want && b.holding && b.left <= 0) { b.tired = 2.2; audio.click(0.1, 700, 0.25); }   // out of breath
    b.holding = want;
    if (b.holding) b.left = Math.max(0, b.left - dt);
    else b.left = Math.min(4, b.left + dt * 1.2);
    b.tired = Math.max(0, b.tired - dt);
    const amp = scoped ? 0.0042 * (b.holding ? 0.08 : b.tired > 0 ? 1.9 : 1) * (this.crouch > 0.5 ? 0.65 : 1) * (this.perks.has('steady') ? 0.6 : 1) : 0;
    this.swayAmp = damp(this.swayAmp || 0, amp, 4, dt);
    const t = now;
    this.scopeSway.x = (Math.sin(t * 0.83) + Math.sin(t * 2.17) * 0.35) * this.swayAmp;
    this.scopeSway.y = (Math.sin(t * 1.31 + 1.2) * Math.cos(t * 0.53) + Math.sin(t * 2.9) * 0.2) * this.swayAmp;
  }

  tryMantle() {
    const g = this.game;
    if (this.busy || this.shellT >= 0) return false;
    const fwd = _f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    for (const reach of [0.55, 0.85]) {
      const px = this.pos.x + fwd.x * reach, pz = this.pos.z + fwd.z * reach;
      const box = g.world.overlaps(px, this.pos.y + 0.5, pz, 0.12, 1.2);
      if (!box) continue;
      const top = box.max.y;
      const rise = top - this.pos.y;
      if (rise < 0.5 || rise > 2.05) continue;
      // need clearance on top
      const tx = this.pos.x + fwd.x * (reach + 0.35), tz = this.pos.z + fwd.z * (reach + 0.35);
      const bounds = g.map.bounds;
      if (tx < bounds.minX + 0.5 || tx > bounds.maxX - 0.5 || tz < bounds.minZ + 0.5 || tz > bounds.maxZ - 0.5) continue;
      if (g.world.overlaps(tx, top + 0.01, tz, R_PLAYER, this.height)) continue;
      if (g.world.groundBelow(tx, top + 0.02, tz, 0.08, 0.05) < top - 0.02) continue;
      // Reject blocked paths, including ceilings and obstructions beyond the ledge.
      let blocked = false;
      for (let i = 1; i <= 24; i++) {
        const k = i / 24, travel = clamp((k - 1 / 3) * 1.5, 0, 1), e = travel * travel * (3 - 2 * travel);
        if (g.world.overlaps(lerp(this.pos.x, tx, e), lerp(this.pos.y, top + 0.01, Math.min(1, k * 3)), lerp(this.pos.z, tz, e), R_PLAYER, this.height)) { blocked = true; break; }
      }
      if (blocked) continue;
      this.mantle = { t: 0, dur: (0.18 + rise * 0.17) * (this.perks.has('mountaineer') ? 0.75 : 1), from: this.pos.clone(), to: new THREE.Vector3(tx, top + 0.01, tz) };
      this.crouchWanted = rise > 1.4 && g.world.overlaps(tx, top + 0.02, tz, R_PLAYER, 1.8) ? true : this.crouchWanted;
      this.sprinting = false; this.sprintToggle = false; this.slideT = 0;
      if (this.tac) this.tacCooldown = this.perks.has('marathon') || this.perks.has('lightweight') ? 3 : 5;
      this.tac = false; this.vel.set(0, 0, 0);
      audio.click(0.3, 700, 0.12); audio.footstep(null, true);
      return true;
    }
    return false;
  }

  updateWeapon(dt, a, now) {
    const g = this.game, ws = this.w, def = ws.def;
    const fast = this.perks.has('fasthands') ? 1.35 : 1;
    if (a.fire || a.ads || a.sprint || this.sprinting || this.busy || a.reloadP || a.swapP || a.w1P || a.w2P || a.meleeP || a.grenadeP || a.jumpP) this.inspectT = -1;
    else if (a.inspectP && this.inspectT < 0) this.inspectT = 0;
    if (this.inspectT >= 0) { this.inspectT += dt / 1.6; if (this.inspectT >= 1) this.inspectT = -1; }

    // swapping
    if (this.swapT >= 0) {
      const prev = this.swapT;
      this.swapT += dt * 3.2 * fast;
      if (this.swapTo >= 0 && prev < 0.5 && this.swapT >= 0.5) {
        this.cur = this.swapTo; this.swapTo = -1; g.vm.setWeapon(this.def); audio.reload('in', this.def);
      }
      if (this.swapTo < 0 && prev < 0.5 && this.swapT >= 0.5 && this.swapT < 0.5 + dt * 3.2 * fast) { /* raised */ }
      if (this.swapT >= 1) this.swapT = -1;
    }
    const wantSwap = a.swapP || (a.w1P && this.cur !== 0) || (a.w2P && this.cur !== 1);
    if (this.busy && this.sprintOutT <= 0) this.pendingFireUntil = -1;
    if (!this.mantle && wantSwap && this.weapons.length > 1 && this.swapT < 0 && this.meleeT < 0 && this.nadeT < 0) {
      this.swapTo = a.w1P ? 0 : a.w2P ? 1 : 1 - this.cur;
      this.swapT = 0; this.reloadT = -1; this.shellT = -1; this.cycleT = -1;
    }

    // melee
    if (!this.mantle && a.meleeP && this.meleeT < 0 && this.swapT < 0 && this.nadeT < 0) {
      this.meleeT = 0; this.meleeDone = false; this.reloadT = -1; this.shellT = -1; audio.melee();
    }
    if (this.meleeT >= 0) {
      this.meleeT += dt / 0.55;
      if (!this.meleeDone && this.meleeT > 0.32) { this.meleeDone = true; g.meleeAttack(this); }
      if (this.meleeT >= 1) this.meleeT = -1;
    }
    // grenade
    if (!this.mantle && a.grenadeP && this.grenades > 0 && this.nadeT < 0 && this.swapT < 0 && this.meleeT < 0) {
      this.nadeT = 0; this.nadeDone = false; this.reloadT = -1; this.shellT = -1; audio.pin();
    }
    if (this.nadeT >= 0) {
      this.nadeT += dt / 0.8;
      if (!this.nadeDone && this.nadeT > 0.45) { this.nadeDone = true; this.grenades--; g.throwGrenade(this); }
      if (this.nadeT >= 1) this.nadeT = -1;
    }

    // reload
    if (this.reloadT >= 0) {
      const prev = this.reloadT;
      this.reloadT += dt / this.reloadDur;
      if (prev < 0.15 && this.reloadT >= 0.15) audio.reload('out', def);
      if (prev < 0.62 && this.reloadT >= 0.62) audio.reload('in', def);
      if (this.reloadEmpty && prev < 0.8 && this.reloadT >= 0.8) audio.reload('charge', def);
      const insertAt = this.reloadEmpty ? 0.82 : 0.62;
      if (!this.reloadCommitted && this.reloadT >= insertAt) {
        const need = def.mag - ws.mag, take = Math.min(need, ws.reserve);
        ws.mag += take; ws.reserve -= take; this.reloadCommitted = true;
      }
      if (this.reloadT >= 1) this.reloadT = -1;
    }
    if (this.shellT >= 0) {
      const prev = this.shellT;
      this.shellT += dt / (def.reload / fast);
      if (prev < 0.6 && this.shellT >= 0.6) audio.reload('shell', def);
      if (this.shellT >= 1) {
        if (ws.reserve > 0 && ws.mag < def.mag) { ws.mag++; ws.reserve--; }
        this.shellT = ws.mag < def.mag && ws.reserve > 0 ? 0 : -1;
        if (this.shellT < 0) { this.cycleT = 0; audio.reload('pump', def); }
      }
    }
    const startReload = () => {
      if (ws.mag >= def.mag || ws.reserve <= 0 || this.busy || this.shellT >= 0) return;
      if (def.shellReload) { this.shellT = 0; return; }
      this.reloadEmpty = ws.mag === 0; this.reloadCommitted = false;
      this.reloadDur = (this.reloadEmpty ? def.reloadEmpty : def.reload) / fast;
      this.reloadT = 0; this.sprinting = false;
    };
    if ((a.reloadP && !this._blockReload) || this._deferReload) { this._deferReload = false; startReload(); }
    // auto-reload shortly after the mag runs dry (match time, so it pauses with the game and dies with the player)
    if (this.autoReloadAt >= 0 && now >= this.autoReloadAt) { this.autoReloadAt = -1; if (ws.mag === 0) startReload(); }

    // bolt / pump cycle
    if (this.cycleT >= 0) {
      const prev = this.cycleT;
      this.cycleT += dt / (def.mode === 'bolt' ? 0.85 : 0.5);
      if (prev < 0.15 && this.cycleT >= 0.15) audio.reload(def.mode === 'bolt' ? 'bolt' : 'pump', def);
      if (this.cycleT >= 1) { this.cycleT = -1; ws.needsCycle = false; }
    }

    // fire mode toggle (auto <-> semi) for automatic weapons
    if (a.firemodeP && (def.mode === 'auto' || this._modeOverride)) {
      this._modeOverride = !this._modeOverride; audio.click(0.3, 3000, 0.02);
    }
    const mode = this._modeOverride && def.mode === 'auto' ? 'semi' : def.mode;

    // firing
    const blocked = this.swapT >= 0 || this.reloadT >= 0 || this.meleeT >= 0 || this.nadeT >= 0 || this.mantle || this.sprinting || this.sprintOutT > 0 || this.cycleT >= 0;
    if (this.shellT >= 0 && a.fireP && ws.mag > 0) this.shellT = -1; // interrupt shell reload
    // Preserve a single tap during sprint recovery, without queuing other busy actions.
    if (a.fireP && this.sprintOutT > 0 && !this.busy && this.cycleT < 0) this.pendingFireUntil = now + this.sprintOutT + 0.1;
    const bufferedFire = now <= this.pendingFireUntil && this.sprintOutT <= 0;
    let trigger = false;
    if (mode === 'auto') trigger = a.fire;
    else if (mode === 'burst') { if ((a.fireP || bufferedFire) && ws.burstLeft <= 0 && now >= ws.nextFire) ws.burstLeft = def.burst; trigger = ws.burstLeft > 0; }
    else trigger = a.fireP || bufferedFire;
    if (trigger && !blocked && this.shellT < 0 && now >= ws.nextFire) {
      this.pendingFireUntil = -1;
      if (ws.mag <= 0) {
        if (a.fireP) audio.dry();
        ws.burstLeft = 0;
        startReload();
      } else {
        this.shoot(now);
        ws.mag--;
        ws.nextFire = now + 60 / def.rpm;
        if (mode === 'burst') { ws.burstLeft--; if (ws.burstLeft <= 0) ws.nextFire = now + def.burstDelay; }
        if (def.mode === 'bolt' || def.mode === 'pump') { if (ws.mag > 0) { this.cycleT = 0; ws.needsCycle = true; } }
        if (ws.mag === 0 && ws.reserve > 0 && (def.mode !== 'auto' || !a.fire)) this.autoReloadAt = now + 0.25;
      }
    } else if (mode === 'burst' && blocked) ws.burstLeft = 0;
    this.bloom = Math.max(0, this.bloom - dt * 4);
  }

  spreadDeg() {
    const def = this.def;
    const moving = Math.min(1, this.speed / 5);
    let hip = def.hip * (1 + moving * 0.6) * (this.grounded ? 1 : 1.8) * (1 - this.crouch * 0.2) * (this.perks.has('steady') ? 0.65 : 1);
    hip += this.bloom * def.hip * 0.6;
    const ads = def.adsSpread * (1 + moving * 0.5) * (this.grounded ? 1 : 3);
    return lerp(hip, ads, this.adsT);
  }

  shoot(now) {
    const g = this.game, def = this.def;
    const cam = g.R.camera;
    // Shooting happens before the render camera update. Use this frame's pose.
    this.positionCamera(cam);
    cam.updateMatrixWorld(true);
    const origin = cam.getWorldPosition(_o);
    const fwd = cam.getWorldDirection(_d);
    const spread = this.spreadDeg() * DEG;
    cam.updateMatrixWorld();
    const muzzle = g.vm.muzzleWorld(cam, _m);
    if (def.rocket) {
      // converge on whatever the crosshair is over
      const hit = g.world.raycast(origin, fwd, 300);
      const aimPt = hit ? hit.point.clone() : origin.clone().addScaledVector(fwd, 300);
      g.fireRocket(this, muzzle, aimPt.sub(muzzle).normalize());
    } else {
      const pellets = def.pellets || 1;
      for (let i = 0; i < pellets; i++) {
        const dir = coneDirection(fwd, spread, _dir);
        g.fireBullet(this, origin, dir, def, { muzzle, tracer: i === 0 || Math.random() < 0.3 });
      }
    }
    this.lastShotTime = now;
    g.onShotSound(this, this.pos);
    g.stats.shots++;
    audio.shot(def.sound, null, false);
    g.vm.kick(def);
    g.fx.muzzle(muzzle, def.rocket ? 2 : 0.6, false); // the viewmodel draws its own flash
    // recoil: a learnable pattern per gun (climb builds over the first shots, the side drift follows the same
    // wave every spray) plus a little randomness on top
    const r = def.recoil, adsK = lerp(1, 0.7, this.adsT) * (this.crouch > 0.5 ? 0.85 : 1);
    const n = this.shotChain++, seed = (def.id.charCodeAt(0) + def.id.length * 7) % 10;
    const climb = n === 0 ? 0.8 : Math.min(1.25, 0.95 + n * 0.05);
    const up = r.up * DEG * adsK * climb * (0.92 + Math.random() * 0.16);
    const side = (Math.sin(n * 0.85 + seed) * 0.55 + (Math.random() - 0.5) * 0.6) * r.side * DEG * adsK;
    this.kickPend.p += up; this.kickPend.y -= side;
    this.recoil.p += up; this.recoil.y -= side;
    this.fovKick = Math.min(4, this.fovKick + r.kick * 22);
    // a hot barrel smokes after a long burst
    this.heat += 1;
    if (this.heat > 7 && !def.suppressed && Math.random() < 0.5) g.fx.gunSmoke(muzzle);
    // the last rounds rattle in a light magazine
    const ws = this.w;
    if (ws.mag - 1 <= Math.max(2, Math.floor(def.mag * 0.2)) && def.mag > 3 && !def.rocket) audio.click(0.09, 5600, 0.012, audio.ctx ? audio.ctx.currentTime + 0.06 : null);
    this.bloom = Math.min(1.5, this.bloom + 0.25);
    g.shake(def.recoil.kick * 0.6);
    g.input.rumble(Math.min(1, r.kick * 6), Math.min(1, r.kick * 4), 60);
    if (this.sprinting) this.sprinting = false;
  }

  damage(amount, attacker, fromPos, cause) {
    const g = this.game;
    if (!this.alive) return;
    if (g.time - this.spawnTime < 1.5 && cause !== 'fall') return; // spawn protection
    if (cause === 'explosion' && this.perks.has('flak')) amount *= 0.45;
    if (cause === 'fall' && amount < 999 && this.perks.has('mountaineer')) amount *= 0.5;
    // armour plates soak up most of a hit until they break (falls go straight to health)
    if (this.armor > 0 && cause !== 'fall') {
      const soak = Math.min(this.armor, amount * 0.6);
      this.armor -= soak; amount -= soak;
      if (this.armor <= 0.5) { this.armor = 0; audio.impact(null, 'metal'); g.hud.toast('ARMOR BROKEN', 'enemy'); }
    }
    this.health -= amount;
    this.lastHurt = g.time;
    if (attacker) this.damagers.set(attacker.id, { a: attacker, t: g.time, dmg: (this.damagers.get(attacker.id)?.dmg || 0) + amount });
    if (fromPos) g.hud.damageIndicator(fromPos);
    // flinch: being hit knocks your aim (less while aiming down sights, and not from your own blast)
    if (attacker && attacker !== this && (cause === 'bullet' || cause === 'headshot' || cause === 'melee')) {
      const k = Math.min(1.6, amount / 30) * (1 - this.adsT * 0.45);
      this.kickPend.p += (0.5 + Math.random() * 0.7) * k * DEG;
      this.kickPend.y += (Math.random() - 0.5) * 1.4 * k * DEG;
      g.vm.springs.rz.v += (Math.random() - 0.5) * 6 * k; g.vm.springs.rx.v += 1.5 * k;
    }
    g.shake(Math.min(0.25, amount * 0.004) * (this.perks.has('focus') ? 0.4 : 1));
    g.input.rumble(0.6, 0.4, 140);
    if (this.health <= 0) { this.health = 0; g.onKill(attacker, this, { cause, part: 'body' }); }
  }

  /** Camera transform each frame. */
  applyCamera(cam, dt) {
    const g = this.game;
    this.eyeH = Math.min(this.height - 0.12, 1.62 - this.crouch * 0.6);
    this.stairOffset = damp(this.stairOffset, 0, 24, dt);
    this.landDip = damp(this.landDip, 0, 8, dt);
    const moving = this.grounded && this.slideT <= 0 ? Math.min(1.5, this.speed / 5) : 0;
    this.camBob += dt * (this.sprinting ? 13.5 : 9.5) * (moving > 0.1 ? 1 : 0);
    this.positionCamera(cam);
    this.roll = damp(this.roll, ((this.slideT > 0 ? 0.035 : 0) + (this.tac ? Math.sin(this.camBob) * 0.008 : 0)) * (1 - this.adsT), 8, dt);
    cam.rotation.z = this.roll * profile.s.cameraMotion + g.shakeVec.z;
    // fov
    const s = profile.s;
    const boost = this.slideT > 0 ? 6 : this.sprinting ? (this.tac ? 8 : 4) : 0;
    this.fovBoost = damp(this.fovBoost, boost, 24, dt);
    // ADS already has a timed transition. A second camera filter adds visible aim lag.
    cam.fov = (s.fov + (this.fovBoost - this.fovKick) * s.cameraMotion) * lerp(1, this.def.zoom, this.adsT);
    cam.updateProjectionMatrix();
    g.R.vmCamera.fov = lerp(58, 46, this.adsT); g.R.vmCamera.updateProjectionMatrix();
  }

  positionCamera(cam) {
    const g = this.game;
    const moving = this.grounded && this.slideT <= 0 ? Math.min(1.5, this.speed / 5) : 0;
    const motion = profile.s.cameraMotion;
    const bobY = Math.sin(this.camBob * 2) * 0.018 * moving * (1 - this.adsT) * motion;
    const bobX = Math.cos(this.camBob) * 0.012 * moving * (1 - this.adsT) * motion;
    cam.position.set(this.pos.x, this.pos.y + Math.min(this.eyeH, this.height - 0.12) + this.stairOffset + bobY - this.landDip * motion, this.pos.z);
    const right = _r.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    cam.position.addScaledVector(right, bobX);
    const sh = g.shakeVec;
    cam.rotation.set(this.pitch + sh.x + this.scopeSway.y, this.yaw + sh.y + this.scopeSway.x, this.roll * motion + sh.z, 'YXZ');

  }

  vmState(dt) {
    return {
      dt, ads: this.adsT, speed: this.grounded ? this.speed / 5 : 0, sprint: this.sprinting, tac: this.tac, grounded: this.grounded,
      crouch: this.crouch > 0.5, slide: this.slideT > 0, lookX: this.lookDX || 0, lookY: this.lookDY || 0,
      strafe: this.grounded ? (this.vel.x * Math.cos(this.yaw) - this.vel.z * Math.sin(this.yaw)) / 5 : 0,
      reload: this.reloadT, reloadEmpty: this.reloadEmpty, swap: this.swapT >= 0 ? Math.sin(Math.min(1, this.swapT) * Math.PI) : 0,
      melee: this.meleeT, nade: this.nadeT, cycle: this.cycleT, shellLoad: this.shellT, inspect: this.inspectT,
      hidden: !!(this.def.scope && this.adsT > 0.85) || !this.alive, empty: this.w.mag === 0,
    };
  }
}

const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _w = new THREE.Vector3(), _o = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Vector3(), _dir = new THREE.Vector3();
