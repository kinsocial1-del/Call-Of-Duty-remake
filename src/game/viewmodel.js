// First-person viewmodel: arms + weapon, procedural animation (bob, sway, recoil springs, reloads, sprint poses).
import * as THREE from 'three';
import { buildWeaponModel } from './weapons.js';
import { equippedCamo } from '../core/cosmetics.js';
import { createFPArms } from './soldier.js';
import { damp, lerp, clamp, rand } from '../core/utils.js';

const HIP = new THREE.Vector3(0.155, -0.175, -0.36);
const HIP_PISTOL = new THREE.Vector3(0.13, -0.16, -0.34);

function flashTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,230,1)'); grd.addColorStop(0.15, 'rgba(255,220,140,0.95)');
  grd.addColorStop(0.4, 'rgba(255,140,40,0.45)'); grd.addColorStop(1, 'rgba(255,90,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    g.save(); g.translate(64, 64); g.rotate((i / 7) * Math.PI * 2 + Math.random() * 0.3);
    const sp = g.createLinearGradient(0, 0, 60, 0);
    sp.addColorStop(0, 'rgba(255,230,160,0.9)'); sp.addColorStop(1, 'rgba(255,120,20,0)');
    g.fillStyle = sp; g.beginPath(); g.moveTo(0, -5); g.lineTo(62, 0); g.lineTo(0, 5); g.fill(); g.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export const FLASH_TEX = flashTexture();

class Spring {
  constructor(k = 180, d = 18) { this.k = k; this.d = d; this.x = 0; this.v = 0; }
  /** Integrates towards `target` (0 = rest). Under-damped springs overshoot, which reads as weight. */
  update(dt, target = 0) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 240))), stepDt = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = -this.k * (this.x - target) - this.d * this.v;
      this.v += a * stepDt; this.x += this.v * stepDt;
    }
    return this.x;
  }
}

export class Viewmodel {
  constructor(renderer) {
    this.R = renderer;
    this.cam = renderer.vmCamera;
    this.root = new THREE.Group();      // animated transform
    this.cam.add(this.root);
    this.gunHolder = new THREE.Group();
    this.root.add(this.gunHolder);
    this.sleeve = new THREE.MeshStandardMaterial({ color: 0x4d5240, roughness: 0.9 });
    this.glove = new THREE.MeshStandardMaterial({ color: 0x1c1d1e, roughness: 0.7 });
    this.skin = new THREE.MeshStandardMaterial({ color: 0x9b7458, roughness: 0.7 });
    this.arms = { L: this._arm(), R: this._arm() };
    this.gunHolder.add(this.arms.L.group, this.arms.R.group);
    // real skinned arms (camo sleeves + gloves) when the soldier asset is available; box arms otherwise
    this.fp = createFPArms('ironfront');
    if (this.fp) {
      const fp = this.fp;
      fp.root.rotation.y = Math.PI;
      this.cam.add(fp.root);
      this.cam.updateMatrixWorld(true);
      const sh = (b) => this.cam.worldToLocal(b.getWorldPosition(new THREE.Vector3()));
      const mid = sh(fp.bones.upperarm_l).add(sh(fp.bones.upperarm_r)).multiplyScalar(0.5);
      this.fpBase = new THREE.Vector3(0, -0.24, -0.02).sub(mid);   // shoulders just below and behind the eye
      this.fpShoulderL = sh(fp.bones.upperarm_l).add(this.fpBase);
      fp.root.position.copy(this.fpBase);
    }
    // muzzle flash
    const fm = new THREE.MeshBasicMaterial({ map: FLASH_TEX, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.flash = new THREE.Group();
    // star facing the camera + two crossed planes stretched forward along the barrel
    const p1 = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), fm); p1.position.z = -0.015;
    const pg = new THREE.PlaneGeometry(0.07, 0.26); pg.rotateX(-Math.PI / 2); pg.translate(0, 0, -0.13);
    const p2 = new THREE.Mesh(pg, fm);
    const p3 = new THREE.Mesh(pg, fm); p3.rotation.z = Math.PI / 2;
    for (const p of [p1, p2, p3]) { p.renderOrder = 5; p.frustumCulled = false; }
    this.flash.add(p1, p2, p3);
    this.flash.visible = false;
    // shells
    this.shells = [];
    const sg = new THREE.CylinderGeometry(0.0045, 0.0045, 0.026, 8);
    this.shellMats = {
      brass: new THREE.MeshStandardMaterial({ color: 0xd1a54a, metalness: 1, roughness: 0.28 }),
      hull: new THREE.MeshStandardMaterial({ color: 0x9c1f1a, metalness: 0.1, roughness: 0.55 }),   // shotgun shell
    };
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Mesh(sg, this.shellMats.brass); s.visible = false; this.cam.add(s);
      this.shells.push({ m: s, v: new THREE.Vector3(), w: new THREE.Vector3(), life: 0 });
    }
    this.shellIdx = 0;
    // grenade in hand
    this.nade = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), new THREE.MeshStandardMaterial({ color: 0x3f4a32, roughness: 0.6 }));
    this.nade.visible = false; this.root.add(this.nade);
    // knife
    const knife = this.knife = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.03, 0.17), new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 1, roughness: 0.25 }));
    blade.position.z = -0.1; knife.add(blade);
    knife.add(new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.03, 0.1), this.glove));
    knife.visible = false; this.root.add(knife);

    this.springs = { kz: new Spring(220, 20), rx: new Spring(160, 16), ry: new Spring(160, 16), rz: new Spring(140, 14), py: new Spring(200, 18),
      // look sway with inertia: the gun lags behind a flick, then settles past centre and back
      sx: new Spring(95, 11), sy: new Spring(95, 11), tilt: new Spring(70, 12) };
    this.sway = new THREE.Vector2();
    this.bobPhase = 0;
    this.flashT = 0;
    this.adsT = 0;
    this.def = null;
  }

  _arm() {
    const group = new THREE.Group();
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.045, 0.1), this.glove);
    const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.03, 0.05), this.glove);
    fingers.position.set(0, -0.025, -0.03); fingers.rotation.x = 0.6; hand.add(fingers);
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.072, 1), this.sleeve);
    const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.064, 0.064, 0.05), this.glove);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 1), this.sleeve);
    group.add(hand, fore, cuff, upper);
    return { group, hand, fore, cuff, upper, handPos: new THREE.Vector3(), elbow: new THREE.Vector3(), shoulder: new THREE.Vector3() };
  }

  _seg(mesh, a, b, scaleXY = 1) {
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    const len = a.distanceTo(b);
    mesh.scale.set(scaleXY, scaleXY, len);
    mesh.lookAt(_tmp.copy(b).applyMatrix4(this.gunHolder.matrixWorld));
  }

  /** camo: undefined = the player's equipped camo, null = factory finish (e.g. an enemy's gun in the killcam). */
  setWeapon(def, camo = equippedCamo(def.id)) {
    if (this.model) this.gunHolder.remove(this.model);
    const { group, info } = buildWeaponModel(def, { camo });
    this.model = group; this.info = info; this.def = def;
    this.gunHolder.add(group);
    this.flash.removeFromParent();
    info.muzzleObj.add(this.flash);
    this.flash.scale.setScalar(def.model === 'smg' ? 0.6 : def.model === 'pistol' || def.model === 'mpistol' ? 0.55 : def.model === 'launcher' ? 1.6 : 1);
    this.hip = info.pistol ? HIP_PISTOL : HIP;
    this.ads = new THREE.Vector3(0, -def.sightH, def.scope ? -0.22 : info.pistol ? -0.27 : -0.3);
  }

  kick(def) {
    const r = def.recoil;
    const a = this.adsT;
    if (def.suppressed) { this.flashT = 0; }
    this.springs.kz.v += r.kick * 60 * (1 - a * 0.4);
    this.springs.rx.v += r.up * (1.5 - a * 0.9) * 0.9;
    this.springs.ry.v += (Math.random() - 0.5) * r.side * 1.2;
    this.springs.rz.v += (Math.random() - 0.5) * r.roll * 0.6;
    this.flash.visible = true;
    this.flash.rotation.z = Math.random() * Math.PI;
    const s = rand(0.85, 1.25) * (1 - a * 0.55);
    this.flash.children[0].scale.setScalar(s);
    this.flash.children[1].scale.set(1, 1, rand(0.7, 1.3) * (1 - a * 0.4));
    this.flash.children[2].scale.set(1, 1, rand(0.7, 1.3) * (1 - a * 0.4));
    this.flashT = 0.045;
    // pump and bolt guns throw their empty when the action is worked, not on the shot
    if (!def.rocket && def.mode !== 'pump' && def.mode !== 'bolt') this.ejectShell();
    this.R.vmFlashLight.userData.peak = rand(1.8, 3.4);
  }

  /** Spent casing out of the ejection port; it tinkles off the ground a moment later. */
  ejectShell() {
    const s = this.shells[this.shellIdx++ % this.shells.length];
    const shotgun = this.def.model === 'shotgun', big = this.def.mode === 'bolt' || this.def.model === 'sniper';
    s.m.material = shotgun ? this.shellMats.hull : this.shellMats.brass;
    s.m.scale.set(shotgun ? 2.6 : big ? 1.35 : 1, shotgun ? 2.3 : big ? 2.2 : 1, shotgun ? 2.6 : big ? 1.35 : 1);
    this.gunHolder.updateMatrixWorld(true);
    const p = _tmp.set(0.03, 0.06, -0.04).applyMatrix4(this.model.matrixWorld);
    this.cam.worldToLocal(p);
    s.m.position.copy(p);
    const slow = shotgun || big ? 0.7 : 1;   // pumped/bolted cases are flicked out, not blown out
    s.v.set(rand(0.9, 1.4) * slow, rand(0.9, 1.4) * slow, rand(-0.1, 0.25));
    s.w.set(rand(-20, 20), rand(-20, 20), rand(-20, 20));
    s.life = 0.7; s.m.visible = true;
    if (this.onCasing) this.onCasing(shotgun);
  }

  /** Landing (0..1) dips the gun; a jump lifts it slightly. */
  land(k) { this.springs.py.v -= 0.9 * k; this.springs.rx.v -= 2.2 * k; }
  jump() { this.springs.py.v += 0.35; this.springs.rx.v += 0.8; }

  /**
   * st: { dt, ads, speed (0..1+), sprint, tac, grounded, crouch, slide, lookX, lookY, reload (0..1|-1), reloadEmpty,
   *       swap (0..1 lowered), melee (0..1|-1), nade (0..1|-1), cycle (0..1|-1), shellLoad (0..1|-1), hidden }
   */
  update(st) {
    const dt = st.dt;
    if (!this.model) return;
    this.adsT = st.ads;
    const a = st.ads;
    // sway from look: springs, so a flick drags the gun and it overshoots slightly on the way back
    const swayK = 1 - a * 0.75;
    this.sway.x = this.springs.sx.update(dt, clamp(-st.lookX * 0.0018, -0.08, 0.08) * swayK);
    this.sway.y = this.springs.sy.update(dt, clamp(-st.lookY * 0.0018, -0.08, 0.08) * swayK);
    // lean into strafes
    const tilt = this.springs.tilt.update(dt, clamp(st.strafe || 0, -1.3, 1.3) * (1 - a * 0.8));
    // bob
    const moving = st.grounded ? Math.min(1.4, st.speed) : 0;
    this.bobPhase += dt * (st.sprint ? 13.5 : 9.5) * (moving > 0.05 ? 1 : 0);
    const bobAmp = moving * (1 - a) * (st.sprint ? 1.8 : 1);
    const bx = Math.sin(this.bobPhase) * 0.011 * bobAmp;
    const by = -Math.abs(Math.cos(this.bobPhase)) * 0.009 * bobAmp;
    // idle breathing
    const t = performance.now() / 1000;
    const br = 1 - a;
    const ix = Math.sin(t * 1.1) * 0.0018 * br, iy = Math.sin(t * 1.6) * 0.0022 * br;

    const kz = this.springs.kz.update(dt), rx = this.springs.rx.update(dt), ry = this.springs.ry.update(dt), rz = this.springs.rz.update(dt), py = this.springs.py.update(dt);
    const base = _base.copy(this.hip).lerp(this.ads, a);
    if (st.crouch && a < 0.5) base.x -= 0.015, base.y += 0.01;
    const R = this.root;
    let px = base.x + bx + ix + this.sway.x * 0.5 * (1 - a);
    let pyy = base.y + by + iy + this.sway.y * 0.5 * (1 - a) + py * (1 - a);
    let pz = base.z + kz * 0.06;
    let rotX = rx * 0.05 + this.sway.y * 0.6 * (1 - a * 0.9);
    let rotY = ry * 0.05 * (1 - a * 0.5) + this.sway.x * 1.0 * (1 - a * 0.9);
    let rotZ = rz * 0.04 * (1 - a * 0.6) + this.sway.x * 0.8 * (1 - a * 0.8) + Math.sin(this.bobPhase * 0.5) * 0.02 * bobAmp - tilt * 0.06;
    px += tilt * 0.006 * (1 - a);

    // sprint poses
    this.sprintT = damp(this.sprintT || 0, st.sprint && !st.tac ? 1 : 0, 26, dt);
    this.tacT = damp(this.tacT || 0, st.tac ? 1 : 0, 26, dt);
    this.slideT = damp(this.slideT || 0, st.slide ? 1 : 0, 10, dt);
    const sp = this.sprintT * (1 - a), tc = this.tacT * (1 - a), sl = this.slideT * (1 - a);
    px += sp * -0.04 + tc * -0.08 + sl * -0.03; pyy += sp * -0.03 + tc * 0.02; pz += sp * 0.03 + tc * 0.06;
    rotY += sp * 0.75 + tc * 0.2; rotX += sp * -0.25 + tc * 1.05; rotZ += sp * 0.35 + tc * -0.4 + sl * 0.45;

    // weapon swap (lowered)
    const sw = st.swap;
    pyy -= sw * 0.3; rotX -= sw * 0.9; rotY += sw * 0.3;

    // Inspect is purely presentational; aiming and firing cancel it immediately.
    if (st.inspect >= 0) {
      const pose = Math.sin(Math.PI * st.inspect), turn = pose * pose;
      px -= turn * 0.05; pyy += turn * 0.06; pz += turn * 0.025;
      rotY += turn * 0.65; rotZ -= turn * 0.62; rotX += turn * 0.12;
    }

    // reload choreography
    let magOff = 0, leftToMag = 0, boltPull = 0;
    if (st.reload >= 0) {
      const r = st.reload;
      const tilt = Math.sin(Math.min(1, r / 0.92) * Math.PI);
      rotZ += tilt * 0.55; rotX += tilt * 0.22; pyy -= tilt * 0.04; px -= tilt * 0.03;
      if (r > 0.12 && r < 0.72) {
        const phase = r < 0.3 ? clamp((r - 0.12) / 0.18, 0, 1) : r < 0.5 ? 1 : 1 - clamp((r - 0.5) / 0.22, 0, 1);
        magOff = phase * phase * (3 - 2 * phase);
      }
      leftToMag = r > 0.18 && r < 0.78 ? Math.sin(((r - 0.18) / 0.6) * Math.PI) : 0;
      if (st.reloadEmpty && r > 0.78) { boltPull = Math.sin(((r - 0.78) / 0.22) * Math.PI); rotZ -= boltPull * 0.2; }
    }
    if (st.shellLoad >= 0) {
      const s = Math.sin(st.shellLoad * Math.PI);
      rotZ += 0.35 + s * 0.08; rotX += 0.12; pyy -= 0.03; leftToMag = 0.6 + s * 0.4;
    }
    // bolt / pump cycle
    let pumpOff = 0, boltRot = 0;
    if (st.cycle >= 0 && st.cycle < 0.5) this._ejected = this._ejected || false;
    if (st.cycle >= 0.5 && this._ejected === false) { this._ejected = true; this.ejectShell(); }   // case leaves at full stroke
    if (st.cycle < 0) this._ejected = undefined;
    if (st.cycle >= 0) {
      const c = Math.sin(st.cycle * Math.PI);
      if (this.def.mode === 'pump') { pumpOff = c; rotX += c * 0.06; }
      if (this.def.mode === 'bolt') { boltRot = c; rotZ += c * 0.18; pyy -= c * 0.02; }
    }
    // melee lunge
    this.knife.visible = st.melee >= 0;
    if (st.melee >= 0) {
      const m = Math.sin(st.melee * Math.PI);
      px -= m * 0.12; pyy -= m * 0.12; rotZ -= m * 0.9; rotY += m * 0.4;
      this.knife.position.set(-0.05 + m * 0.02, -0.12 + m * 0.06, -0.25 - m * 0.3);
      this.knife.rotation.set(-0.3, 0.6 - m * 0.8, 0);
    }
    // grenade throw
    this.nade.visible = st.nade >= 0 && st.nade < 0.6;
    if (st.nade >= 0) {
      const n = st.nade;
      const low = Math.min(1, n * 4);
      pyy -= low * 0.25; rotX -= low * 0.6;
      const throwP = clamp((n - 0.35) / 0.3, 0, 1);
      this.nade.position.set(-0.12 + throwP * 0.05, -0.12 + Math.sin(throwP * Math.PI) * 0.15, -0.28 - throwP * 0.4);
    }

    R.position.set(px, pyy, pz);
    R.rotation.set(rotX, rotY, rotZ);
    // while aiming, rotate around the optic instead of the grip so the reticle stays on the crosshair
    if (a > 0) {
      const sightPt = _corr.set(0, this.def.sightH, this.def.scope ? -0.05 : -0.02);
      const rotated = _tmp5.copy(sightPt).applyEuler(R.rotation);
      R.position.addScaledVector(sightPt.sub(rotated), a);
    }
    this.model.visible = !st.hidden;
    this.arms.L.group.visible = this.arms.R.group.visible = !st.hidden && !this.fp;
    if (this.fp) this.fp.root.visible = !st.hidden;

    // weapon parts
    const info = this.info;
    if (info.mag) {
      info.mag.position.copy(info.magHome).add(_tmp.set(0, -0.28 * magOff, 0.05 * magOff));
      info.mag.rotation.copy(info.magRotation); info.mag.rotation.z += magOff * 0.12;
    }
    if (info.mag) info.mag.visible = magOff < 0.95 && !(this.def.rocket && st.empty && !(st.reload >= 0.5));
    if (info.pump) info.pump.position.z = info.pumpHome.z + pumpOff * 0.09;
    if (info.bolt && this.def.mode === 'bolt') { info.bolt.rotation.z = boltRot * 1.2; info.bolt.position.z = info.boltHome.z + boltRot * 0.05 * (boltRot > 0.5 ? 1 : 0); }
    if (info.bolt && boltPull > 0) info.bolt.position.z = info.boltHome.z + boltPull * 0.05;
    else if (info.bolt && this.def.mode !== 'bolt') info.bolt.position.z = info.boltHome.z;
    if (info.slide) info.slide.position.z = info.slideHome.z + Math.max(0, kz) * 0.25;

    // arms IK-ish
    this.gunHolder.updateMatrixWorld(true);
    const rh = _rh.set(0, -0.06, info.gripZ + 0.01);
    const lh = _lh.set(info.pistol ? -0.01 : 0, (info.foreY ?? 0) - 0.03, info.pistol ? info.gripZ + 0.02 : info.foreZ);
    if (leftToMag > 0) {
      if (info.mag) {
        // Track the animated magazine, including the authored model's part transform.
        info.mag.getWorldPosition(_tmp2); this.gunHolder.worldToLocal(_tmp2);
        lh.lerp(_tmp2.add(_tmp.set(-0.01, -0.035, 0.02)), leftToMag);
      } else lh.lerp(_tmp2.set(info.pistol ? 0 : -0.02, -0.2, 0.02), leftToMag);
    }
    if (this.def.mode === 'pump') lh.z += pumpOff * 0.09;
    if (this.fp) this._poseFP(dt, rh, lh, info);
    else {
      this._poseArm(this.arms.R, rh, _tmp3.set(0.13, -0.2, info.gripZ + 0.25), _tmp4.set(0.22, -0.45, info.gripZ + 0.65), 1);
      this._poseArm(this.arms.L, lh, _tmp3.set(-0.16, -0.17, lh.z + 0.28), _tmp4.set(-0.25, -0.42, lh.z + 0.7), -1);
    }

    // muzzle flash
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.visible = false; }
    this.R.vmFlashLight.intensity = this.flash.visible ? (this.R.vmFlashLight.userData.peak || 2.5) : 0;

    // shells
    for (const s of this.shells) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.v.y -= 6 * dt;
      s.m.position.addScaledVector(s.v, dt);
      s.m.rotation.x += s.w.x * dt; s.m.rotation.z += s.w.z * dt;
      if (s.life <= 0) s.m.visible = false;
    }
  }

  /** Skinned arms: slide the shoulders forward only as far as the support hand needs, then IK onto the gun. */
  _poseFP(dt, rh, lh, info) {
    const fp = this.fp, cam = this.cam;
    fp.mixer.update(dt);
    const rt = this.gunHolder.localToWorld(_fr.copy(rh));
    const lt = this.gunHolder.localToWorld(_fl.copy(lh));
    const lLocal = cam.worldToLocal(_fx.copy(lt));
    const d = lLocal.distanceTo(this.fpShoulderL), max = fp.reach * 0.94;
    fp.root.position.copy(this.fpBase);
    if (d > max) fp.root.position.addScaledVector(lLocal.sub(this.fpShoulderL).normalize(), d - max);
    fp.root.updateMatrixWorld(true);
    const cq = cam.getWorldQuaternion(_fq);
    fp.pose(rt, lt, _fpr.set(0.8, -1, 0.3).applyQuaternion(cq).normalize(), _fpl.set(-0.7, -1, 0.15).applyQuaternion(cq).normalize(),
      this.model.getWorldQuaternion(_fq2), !!info.pistol);
  }

  _poseArm(arm, hand, elbow, shoulder, side) {
    arm.hand.position.copy(hand);
    arm.hand.rotation.set(0.1, side * 0.1, side * -0.25);
    const wrist = _w.copy(hand).add(_tmp5.set(side * 0.005, -0.012, 0.06));
    arm.cuff.position.copy(wrist);
    this._segLocal(arm.cuff, wrist, elbow, 0.055);
    this._segLocal(arm.fore, wrist, elbow, 1);
    this._segLocal(arm.upper, elbow, shoulder, 1);
    arm.cuff.scale.set(1, 1, 1);
    arm.cuff.position.copy(wrist).lerp(elbow, 0.03);
  }

  _segLocal(mesh, a, b, s) {
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.scale.set(1, 1, a.distanceTo(b) * s);
    _m.lookAt(a, b, _up);
    mesh.quaternion.setFromRotationMatrix(_m);
  }

  setVisible(v) { this.root.visible = v; }

  /** World-space point that appears exactly where the viewmodel muzzle is drawn on screen. */
  muzzleWorld(worldCam, out) {
    if (!this.info) return out.copy(worldCam.position);
    this.root.updateMatrixWorld(true);
    const p = this.info.muzzleObj.getWorldPosition(_tmp2);
    const dist = Math.max(0.3, p.length());
    p.project(this.cam);
    _tmp3.set(p.x, p.y, 0.5).unproject(worldCam).sub(worldCam.position).normalize();
    return out.copy(worldCam.position).addScaledVector(_tmp3, dist * 1.4);
  }
}

const _tmp = new THREE.Vector3(), _tmp2 = new THREE.Vector3(), _tmp3 = new THREE.Vector3(), _tmp4 = new THREE.Vector3(), _tmp5 = new THREE.Vector3();
const _rh = new THREE.Vector3(), _lh = new THREE.Vector3(), _w = new THREE.Vector3(), _base = new THREE.Vector3();
const _m = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0), _corr = new THREE.Vector3();
const _fr = new THREE.Vector3(), _fl = new THREE.Vector3(), _fx = new THREE.Vector3(), _fpr = new THREE.Vector3(), _fpl = new THREE.Vector3();
const _fq = new THREE.Quaternion(), _fq2 = new THREE.Quaternion();
