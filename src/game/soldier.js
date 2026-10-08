// Soldier models. The default is a skinned CC0 character (Quaternius Universal Base Characters, kitted out with
// gear by tools/build_soldier.py) driven by retargeted CC0 mocap-style clips (Universal Animation Library), with
// spine aiming and two-bone arm IK onto the weapon. A procedural box soldier is kept as a fallback.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { buildWeaponModel } from './weapons.js';
import { clamp, damp, pick, rand, markShared, disposeModel } from '../core/utils.js';

const FACTIONS = {
  ironfront: { uniform: 0x6e6b4f, pants: 0x5d5b43, vest: 0x4a5034, helmet: 0x5b5d44, gear: 0x3b3f2c, accent: 0x4fb3ff, mask: false },
  korvax: { uniform: 0x33373c, pants: 0x2a2d31, vest: 0x1d2023, helmet: 0x25282b, gear: 0x17191b, accent: 0xff4b3e, mask: true },
};
const SKINS = [0xc89a7c, 0x9c6e52, 0x6b4a36, 0xe0b496, 0x845a40];
const matCache = new Map();
function mat(color, rough = 0.85, metal = 0, emissive = 0) {
  const k = `${color}-${rough}-${metal}-${emissive}`;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive: emissive ? color : 0, emissiveIntensity: emissive }));
  return matCache.get(k);
}
const geoCache = new Map();
function boxGeo(w, h, d, oy = 0) {
  const k = `${w}|${h}|${d}|${oy}`;
  if (!geoCache.has(k)) { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, oy, 0); g.userData.shared = true; geoCache.set(k, g); }
  return geoCache.get(k);
}
function mesh(parent, geo, m, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
}

class ProceduralSoldier {
  constructor(faction = 'ironfront', def = null) {
    const F = FACTIONS[faction];
    this.F = F;
    const U = mat(F.uniform), P = mat(F.pants), V = mat(F.vest, 0.75), H = mat(F.helmet, 0.6, 0.1), G = mat(F.gear), skin = mat(pick(SKINS), 0.7);
    const boots = mat(0x231d18, 0.8), black = mat(0x111214, 0.6), accent = mat(F.accent, 0.5, 0, 1.4), lens = mat(0x0b0d10, 0.1, 0.9);
    const root = this.root = new THREE.Group();
    root.rotation.order = 'YXZ';
    const hips = this.hips = new THREE.Group(); hips.position.y = 0.95; root.add(hips);
    mesh(hips, boxGeo(0.36, 0.2, 0.22), P, 0, 0, 0);
    mesh(hips, boxGeo(0.38, 0.05, 0.24), black, 0, 0.08, 0); // belt
    // legs
    this.legs = {};
    for (const s of [-1, 1]) {
      const thigh = new THREE.Group(); thigh.position.set(s * 0.1, -0.05, 0); hips.add(thigh);
      mesh(thigh, boxGeo(0.15, 0.46, 0.17, -0.23), P);
      mesh(thigh, boxGeo(0.07, 0.12, 0.1, -0.2), G, s * 0.08, 0, 0); // thigh pouch
      const shin = new THREE.Group(); shin.position.y = -0.45; thigh.add(shin);
      mesh(shin, boxGeo(0.135, 0.44, 0.145, -0.22), P);
      mesh(shin, boxGeo(0.15, 0.12, 0.16, 0), G, 0, -0.02, -0.01); // knee pad
      mesh(shin, boxGeo(0.13, 0.11, 0.27, -0.05), boots, 0, -0.41, -0.05);
      this.legs[s] = { thigh, shin };
    }
    // torso
    const spine = this.spine = new THREE.Group(); spine.position.y = 0.08; hips.add(spine);
    const chest = this.chest = new THREE.Group(); spine.add(chest);
    mesh(chest, boxGeo(0.4, 0.52, 0.24, 0.26), U);
    mesh(chest, boxGeo(0.44, 0.36, 0.31, 0.3), V);
    for (let i = -1; i <= 1; i++) mesh(chest, boxGeo(0.1, 0.13, 0.06, 0), G, i * 0.12, 0.2, -0.18); // mag pouches
    mesh(chest, boxGeo(0.3, 0.3, 0.12, 0), G, 0, 0.3, 0.2); // backpack
    mesh(chest, boxGeo(0.06, 0.08, 0.06), G, 0.14, 0.43, -0.16); // radio
    mesh(chest, boxGeo(0.12, 0.025, 0.02), accent, -0.17, 0.42, -0.06); // faction strip
    // head
    const neck = this.neck = new THREE.Group(); neck.position.y = 0.53; chest.add(neck);
    mesh(neck, boxGeo(0.1, 0.08, 0.1, 0.04), F.mask ? black : skin);
    const head = this.head = new THREE.Group(); head.position.y = 0.08; neck.add(head);
    mesh(head, boxGeo(0.19, 0.23, 0.21, 0.11), F.mask ? black : skin);
    if (!F.mask) { mesh(head, boxGeo(0.2, 0.05, 0.05), black, 0, 0.13, -0.1); } // sunglasses strap
    else mesh(head, boxGeo(0.17, 0.045, 0.02), lens, 0, 0.14, -0.105);
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.145, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), H);
    helm.position.y = 0.17; helm.scale.set(1.0, 0.95, 1.08); helm.castShadow = true; head.add(helm);
    mesh(head, boxGeo(0.06, 0.05, 0.04), black, 0, 0.27, -0.13); // NVG mount
    mesh(head, boxGeo(0.07, 0.035, 0.02), G, 0.11, 0.2, -0.02);
    // arms (segments re-posed every frame)
    this.arms = {};
    for (const s of [-1, 1]) {
      const upper = mesh(chest, boxGeo(0.11, 0.11, 1), U);
      const fore = mesh(chest, boxGeo(0.095, 0.095, 1), U);
      const hand = mesh(chest, boxGeo(0.07, 0.08, 0.1), black);
      const pad = mesh(chest, boxGeo(0.13, 0.08, 0.13), G);
      this.arms[s] = { upper, fore, hand, pad };
    }
    this.gunMount = new THREE.Group(); this.gunMount.position.set(0.11, 0.33, -0.3); chest.add(this.gunMount);
    if (def) this.setWeapon(def);
    this.phase = Math.random() * 6;
    this.crouchT = 0;
    this.dead = false; this.deathT = 0;
    this.recoil = 0;
  }

  setWeapon(def) {
    if (this.gun) { this.gunMount.remove(this.gun); disposeModel(this.gun); }
    const { group, info } = buildWeaponModel(def, { shadows: true });
    this.gun = group; this.gunInfo = info;
    this.gunMount.add(group);
    this._poseArms();
  }

  _poseArms() {
    const info = this.gunInfo; if (!info) return;
    const gm = this.gunMount.position;
    const grip = _a.set(gm.x, gm.y - 0.07, gm.z + info.gripZ);
    const fore = _b.set(gm.x - 0.01, gm.y - 0.04 + (info.foreY || 0), gm.z + (info.pistol ? info.gripZ : info.foreZ));
    const z = this.recoil * 0.05;
    grip.z += z; fore.z += z;
    this._limb(this.arms[1], _c.set(0.24, 0.46, 0.02), _d.set(0.3, 0.2, -0.05), grip);
    this._limb(this.arms[-1], _c.set(-0.24, 0.46, 0.02), _d.set(-0.12, 0.22, fore.z * 0.5), fore);
  }

  _limb(arm, sh, el, hand) {
    seg(arm.upper, sh, el); seg(arm.fore, el, hand);
    arm.hand.position.copy(hand); arm.hand.quaternion.copy(arm.fore.quaternion);
    arm.pad.position.copy(sh).y -= 0.02;
  }

  /** st: { dt, speed (m/s), crouch (bool), pitch, firing } */
  animate(st) {
    const dt = st.dt;
    if (this.dead) return this._death(dt);
    this.crouchT = damp(this.crouchT, st.crouch ? 1 : 0, 10, dt);
    const c = this.crouchT;
    const sp = Math.min(1.4, st.speed / 5);
    this.phase += dt * (4 + st.speed * 1.6) * (sp > 0.05 ? 1 : 0);
    const sw = Math.sin(this.phase) * 0.62 * sp;
    for (const s of [-1, 1]) {
      const L = this.legs[s];
      const ph = s > 0 ? this.phase : this.phase + Math.PI;
      const swing = Math.sin(ph) * 0.62 * sp;
      L.thigh.rotation.x = swing * (1 - c * 0.5) + c * 1.25 + (s > 0 ? c * -0.2 : c * 0.35);
      L.shin.rotation.x = -Math.max(0, Math.sin(ph + 1.3)) * 0.95 * sp - c * (s > 0 ? 1.9 : 1.3);
    }
    this.hips.position.y = 0.95 - c * 0.38 + Math.abs(Math.cos(this.phase)) * 0.035 * sp;
    this.hips.rotation.y = sw * 0.12;
    this.recoil = damp(this.recoil, 0, 18, dt);
    const pitch = st.pitch || 0;
    this.spine.rotation.x = pitch * 0.75 - this.recoil * 0.06 + c * 0.15;
    this.spine.rotation.y = -sw * 0.12;
    this.neck.rotation.x = pitch * 0.25 - c * 0.15;
    this._poseArms();
  }

  fire() { this.recoil = 1; }

  die(fromDir) {
    this.dead = true; this.deathT = 0;
    // fall away from the shot
    const fwd = _a.set(-Math.sin(this.root.rotation.y), 0, -Math.cos(this.root.rotation.y));
    this.fallSign = fromDir && fwd.dot(fromDir) > 0 ? -1 : 1; // shot from behind -> fall forward
    this.fallTwist = rand(-0.5, 0.5);
    this.startY = this.root.position.y;
  }

  _death(dt) {
    this.deathT += dt;
    const t = Math.min(1, this.deathT / 0.7);
    const e = t * t * (3 - 2 * t);
    const knees = Math.min(1, this.deathT / 0.35);
    this.legs[1].thigh.rotation.x = knees * 0.9; this.legs[-1].thigh.rotation.x = knees * 0.6;
    this.legs[1].shin.rotation.x = -knees * 1.4; this.legs[-1].shin.rotation.x = -knees * 1.0;
    this.hips.position.y = 0.95 - knees * 0.4 * (1 - e);
    this.root.rotation.x = this.fallSign * e * (Math.PI / 2 - 0.08);
    this.root.rotation.z = this.fallTwist * e;
    this.spine.rotation.x = -this.fallSign * e * 0.3;
    this.root.position.y = this.startY + e * 0.14;
  }

  muzzleWorld(out) {
    if (!this.gunInfo) return out.copy(this.root.position).setY(1.4);
    return this.gunInfo.muzzleObj.getWorldPosition(out);
  }

  reset() {
    this.dead = false; this.deathT = 0;
    this.root.rotation.set(0, this.root.rotation.y, 0);
    this.hips.position.y = 0.95;
  }

  dispose() { disposeModel(this.root); }
}

const _m = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0);
function seg(m, a, b) {
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.scale.set(1, 1, Math.max(0.01, a.distanceTo(b)));
  _m.lookAt(a, b, _up);
  m.quaternion.setFromRotationMatrix(_m);
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

/** Floating callsign tag (allies). */
export function nameTag(text, color = '#4fb3ff') {
  const c = document.createElement('canvas'); c.width = 256; c.height = 48;
  const g = c.getContext('2d');
  g.font = 'bold 30px Rajdhani, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.strokeText(text, 128, 24);
  g.fillStyle = color; g.fillText(text, 128, 24);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, fog: false }));
  s.scale.set(1.2, 0.225, 1); s.renderOrder = 10;
  return s;
}

// ------------------------------------------------------------------ SKINNED SOLDIER (real assets)
let SOLDIER = null;

/** Load the skinned soldier + animation clips. On failure soldiers fall back to the procedural model. */
export async function loadSoldierAssets(base) {
  const dir = `${base}assets/models/soldier/`;
  try {
    const loader = new GLTFLoader();
    const [body, anims, arms] = await Promise.all(['soldier.glb', 'soldier_anims.glb', 'fp_arms.glb'].map((f) => loader.loadAsync(dir + f)));
    const tl = new THREE.TextureLoader();
    const tex = (f, srgb, rep) => {
      const t = tl.load(dir + f);
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = 4;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const clips = {};
    const FINGER = /^(index|middle|ring|pinky|thumb)_0\d_[lr]\./;
    for (const c of anims.animations) {
      // rotations drive everything; only the pelvis keeps its translation (bob, crouch, falling).
      // Fingers are left out: they are driven by the separate grip layer below.
      const tracks = c.tracks.filter((t) => !t.name.endsWith('.scale') && (!t.name.endsWith('.position') || t.name.startsWith('pelvis.')) && !FINGER.test(t.name));
      clips[c.name] = new THREE.AnimationClip(c.name, c.duration, tracks);
    }
    const hold = anims.animations.find((c) => c.name === 'Pistol_Idle_Loop');
    if (hold) clips.Grip = new THREE.AnimationClip('Grip', hold.duration, hold.tracks.filter((t) => FINGER.test(t.name) && t.name.endsWith('.quaternion')));
    markShared(body.scene); markShared(arms.scene);
    const src = {};
    body.scene.traverse((o) => { if (o.isMesh) src[o.material.name] = o.material; });
    SOLDIER = {
      scene: body.scene, arms: arms.scene, clips, src, mats: new Map(),
      tex: { woodland: tex('camo_woodland.jpg', true, 5), urban: tex('camo_urban.jpg', true, 5), clothN: tex('cloth_n.jpg', false, 10), web: tex('webbing.jpg', true, 3), webN: tex('webbing_n.jpg', false, 3) },
    };
  } catch (e) { console.warn('soldier model unavailable, using procedural soldiers', e); }
}

const LOOK = {
  ironfront: { camo: 'woodland', vest: 0x8d7a58, helmet: 0x63674a, gloves: 0x2b2924, boots: 0x3a2d21, belt: 0x2d2a22, pads: 0x3b392e, mask: false },
  korvax: { camo: 'urban', vest: 0x25272a, helmet: 0x222427, gloves: 0x111111, boots: 0x151515, belt: 0x121212, pads: 0x1b1b1c, mask: true },
};
const TONES = [0xffffff, 0xf0d8c4, 0xc9a084, 0x9c7458];

function soldierMaterials(faction, tone) {
  const S = SOLDIER, key = `${faction}|${tone}`;
  if (S.mats.has(key)) return S.mats.get(key);
  const L = LOOK[faction] || LOOK.ironfront, T = S.tex;
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, ...o });
  const m = {
    M_Uniform: std({ map: T[L.camo], normalMap: T.clothN, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.93 }),
    M_Vest: std({ color: L.vest, map: T.web, normalMap: T.webN, roughness: 0.88 }),
    M_Helmet: std({ color: L.helmet, roughness: 0.7 }),
    M_Gloves: std({ color: L.gloves, roughness: 0.65 }),
    M_Boots: std({ color: L.boots, roughness: 0.6 }),
    M_Belt: std({ color: L.belt, roughness: 0.7 }),
    M_Pads: std({ color: L.pads, roughness: 0.55 }),
  };
  const skin = S.src.MI_Superhero_Male;
  if (L.mask) m.MI_Superhero_Male = std({ color: 0x141517, normalMap: T.clothN, roughness: 0.95 }); // balaclava
  else if (skin) { const sk = skin.clone(); sk.color.setHex(tone); m.MI_Superhero_Male = sk; }
  S.mats.set(key, m);
  return m;
}

class SkinnedSoldier {
  constructor(faction = 'ironfront', def = null) {
    const S = SOLDIER;
    const L = LOOK[faction] || LOOK.ironfront;
    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';
    this.body = cloneSkinned(S.scene);
    this.body.rotation.y = Math.PI; // the asset faces +Z, game forward is -Z
    this.root.add(this.body);
    const mats = soldierMaterials(faction, pick(TONES));
    this.body.traverse((o) => {
      if (!o.isMesh) return;
      const n = o.material.name;
      o.material = mats[n] || o.material;
      o.castShadow = true; o.receiveShadow = true;
      o.frustumCulled = false; // skinned bounds do not follow the animation
      if (n === 'MI_Hair_1' && L.mask) o.visible = false;
    });
    this.bones = {};
    this.body.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });
    this.handFrames = { r: handFrame(this.bones, 'r'), l: handFrame(this.bones, 'l') };
    this.mixer = new THREE.AnimationMixer(this.body);
    this.actions = {};
    for (const [n, c] of Object.entries(S.clips)) this.actions[n] = this.mixer.clipAction(c);
    const death = this.actions.Death01;
    if (death) { death.setLoop(THREE.LoopOnce, 1); death.clampWhenFinished = true; }
    this.cur = null;
    this.play('Idle_Loop', 0);
    if (this.actions.Grip) this.actions.Grip.play();
    this.mixer.update(Math.random() * 2); // desync idle breathing between soldiers
    this.gunMount = new THREE.Group();
    this.root.add(this.gunMount);
    this.dead = false; this.deathT = 0; this.recoil = 0;
    if (def) this.setWeapon(def);
  }

  play(name, fade = 0.25) {
    const a = this.actions[name];
    if (!a || this.cur === a) return a;
    a.reset(); a.enabled = true; a.setEffectiveTimeScale(1); a.setEffectiveWeight(1); a.play();
    if (this.cur && fade > 0) this.cur.crossFadeTo(a, fade, false);
    else if (this.cur) this.cur.stop();
    this.cur = a;
    return a;
  }

  setWeapon(def) {
    if (this.gun) { this.gun.removeFromParent(); disposeModel(this.gun); }
    const { group, info } = buildWeaponModel(def, { shadows: true });
    this.gun = group; this.gunInfo = info;
    this.gunMount.add(group);
  }

  /** st: { dt, speed (m/s), crouch (bool), pitch, back (moving backwards) } */
  animate(st) {
    const dt = st.dt;
    if (this.dead) { this.deathT += dt; this.mixer.update(dt); return; }
    const sp = st.speed || 0;
    let name = 'Idle_Loop', scale = 1;
    if (st.crouch) { if (sp > 0.6) { name = 'Crouch_Fwd_Loop'; scale = clamp(sp / 1.8, 0.6, 1.6); } else name = 'Crouch_Idle_Loop'; }
    else if (sp > 6.2) { name = 'Sprint_Loop'; scale = clamp(sp / 6.5, 0.8, 1.4); }
    else if (sp > 3.3) { name = 'Jog_Fwd_Loop'; scale = clamp(sp / 3.8, 0.7, 1.5); }
    else if (sp > 0.5) { name = 'Walk_Loop'; scale = clamp(sp / 1.5, 0.6, 1.9); }
    const a = this.play(name);
    if (a) a.timeScale = (st.back ? -1 : 1) * scale;
    this.mixer.update(dt);
    this.recoil = damp(this.recoil, 0, 18, dt);
    this._aim(clamp(st.pitch || 0, -1.1, 1.1));
  }

  /** Bend the spine toward the aim, put the gun on the shoulder and IK both hands onto it. */
  _aim(pitch) {
    const b = this.bones;
    this.root.updateMatrixWorld(true);
    const rootQ = this.root.getWorldQuaternion(_q1);
    _axis.set(1, 0, 0).applyQuaternion(rootQ);
    rotateBoneWorld(b.spine_02, _axis, pitch * 0.3);
    rotateBoneWorld(b.spine_03, _axis, pitch * 0.3);
    // the gun pivots about the right shoulder pocket
    const chest = this.root.worldToLocal(b.spine_03.getWorldPosition(_v1));
    const reach = 0.24 - this.recoil * 0.05;
    this.gunMount.position.set(0.12, chest.y + 0.13 + Math.sin(pitch) * reach, chest.z - Math.cos(pitch) * reach);
    this.gunMount.rotation.set(pitch, 0, 0);
    this.gunMount.updateMatrixWorld(true);
    const info = this.gunInfo;
    if (!info || !b.upperarm_r) return;
    const grip = this.gun.localToWorld(_v2.set(0, -0.06, info.gripZ + 0.01));
    const fore = this.gun.localToWorld(_v3.set(info.pistol ? -0.01 : 0, (info.foreY ?? 0) - 0.03, info.pistol ? info.gripZ + 0.02 : info.foreZ));
    ik(b.upperarm_r, b.lowerarm_r, b.hand_r, grip, _pole.set(0.7, -1, 0.35).applyQuaternion(rootQ).normalize());
    ik(b.upperarm_l, b.lowerarm_l, b.hand_l, fore, _pole.set(-0.5, -1, 0.1).applyQuaternion(rootQ).normalize());
    gripHands(b, this.handFrames, this.gun.getWorldQuaternion(_gq), info.pistol);
  }

  fire() { this.recoil = 1; }

  die() {
    this.dead = true; this.deathT = 0;
    this.play('Death01', 0.12);
    // the rifle goes down with the body
    if (this.gun && this.bones.hand_r) this.bones.hand_r.attach(this.gun);
  }

  muzzleWorld(out) {
    if (!this.gunInfo) return out.copy(this.root.position).setY(this.root.position.y + 1.4);
    return this.gunInfo.muzzleObj.getWorldPosition(out);
  }

  reset() {
    this.dead = false; this.deathT = 0;
    this.root.rotation.set(0, this.root.rotation.y, 0);
    if (this.gun) { this.gunMount.add(this.gun); this.gun.position.set(0, 0, 0); this.gun.rotation.set(0, 0, 0); this.gun.scale.set(1, 1, 1); }
    this.mixer.stopAllAction();
    this.cur = null;
    this.play('Idle_Loop', 0);
    if (this.actions.Grip) this.actions.Grip.play();
    this.mixer.update(0); // pose the bones now so the death pose never shows for a frame
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.body);
    disposeModel(this.root);
  }
}

function rotateBoneWorld(bone, axis, angle) {
  if (!bone || !angle) return;
  bone.getWorldQuaternion(_qa).premultiply(_qb.setFromAxisAngle(axis, angle));
  bone.quaternion.copy(bone.parent.getWorldQuaternion(_qc).invert().multiply(_qa));
  bone.updateMatrixWorld(true);
}

/** Rotate `bone` so the world point `from` swings onto `to`. */
function aimBone(bone, from, to) {
  const p = bone.getWorldPosition(_p0);
  _d1.subVectors(from, p).normalize(); _d2.subVectors(to, p).normalize();
  bone.getWorldQuaternion(_qa).premultiply(_qb.setFromUnitVectors(_d1, _d2));
  bone.quaternion.copy(bone.parent.getWorldQuaternion(_qc).invert().multiply(_qa));
  bone.updateMatrixWorld(true);
}

/** Analytic two-bone IK: places `hand` on `target`, bending the elbow toward `pole`. */
function ik(upper, lower, hand, target, pole) {
  if (!upper || !lower || !hand) return;
  const a = upper.getWorldPosition(_ia), bpos = lower.getWorldPosition(_ib), c = hand.getWorldPosition(_ic);
  const l1 = a.distanceTo(bpos), l2 = bpos.distanceTo(c);
  const dir = _id.subVectors(target, a);
  let d = dir.length();
  dir.divideScalar(d || 1);
  d = clamp(d, Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.002);
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  const pd = _ip.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
  const elbow = _ie.copy(a).addScaledVector(dir, cosA * l1).addScaledVector(pd, sinA * l1);
  aimBone(upper, bpos, elbow);
  aimBone(lower, hand.getWorldPosition(_ic), _it.copy(a).addScaledVector(dir, d));
}

/** Hand axes in hand-local space, measured at rest: F = wrist to middle knuckle, N = the way the palm faces. */
function handFrame(bones, side) {
  const h = bones['hand_' + side], m = bones['middle_01_' + side], t = bones['thumb_01_' + side];
  if (!h || !m || !t) return null;
  h.updateWorldMatrix(true, true);
  const hp = h.getWorldPosition(new THREE.Vector3());
  const F = m.getWorldPosition(new THREE.Vector3()).sub(hp).normalize();
  const T = t.getWorldPosition(new THREE.Vector3()).sub(hp);
  const N = new THREE.Vector3().crossVectors(F, T).normalize().multiplyScalar(side === 'r' ? -1 : 1);
  const qi = h.getWorldQuaternion(new THREE.Quaternion()).invert();
  return { F: F.applyQuaternion(qi), N: N.applyQuaternion(qi) };
}

/** Turn a hand so its fingers run along world `F` and its palm faces world `N`. */
function orientHand(hand, frame, F, N) {
  if (!hand || !frame) return;
  _hx.copy(F).normalize(); _hy.copy(N).addScaledVector(_hx, -N.dot(_hx)).normalize(); _hz.crossVectors(_hx, _hy);
  _m1.makeBasis(_hx, _hy, _hz);
  _hx.copy(frame.F); _hy.copy(frame.N).addScaledVector(_hx, -frame.N.dot(_hx)).normalize(); _hz.crossVectors(_hx, _hy);
  _m2.makeBasis(_hx, _hy, _hz).transpose();
  _qa.setFromRotationMatrix(_m1.multiply(_m2));
  hand.quaternion.copy(hand.parent.getWorldQuaternion(_qc).invert().multiply(_qa));
  hand.updateMatrixWorld(true);
}

// how hands sit on a weapon, in weapon space (x right, y up, -z toward the muzzle)
const GRIP_R = { F: new THREE.Vector3(0, -0.5, -1), N: new THREE.Vector3(-1, 0, 0) };
const GRIP_L = { F: new THREE.Vector3(0.35, 0.05, -1), N: new THREE.Vector3(0.15, 1, 0) };
const GRIP_L_PISTOL = { F: new THREE.Vector3(0.25, -0.6, -1), N: new THREE.Vector3(1, 0.2, 0) };

/** Point both hands of a rig along a weapon whose world rotation is `gunQ`. */
function gripHands(bones, frames, gunQ, pistol) {
  const L = pistol ? GRIP_L_PISTOL : GRIP_L;
  orientHand(bones.hand_r, frames.r, _g1.copy(GRIP_R.F).applyQuaternion(gunQ), _g2.copy(GRIP_R.N).applyQuaternion(gunQ));
  orientHand(bones.hand_l, frames.l, _g1.copy(L.F).applyQuaternion(gunQ), _g2.copy(L.N).applyQuaternion(gunQ));
}
const _hx = new THREE.Vector3(), _hy = new THREE.Vector3(), _hz = new THREE.Vector3(), _g1 = new THREE.Vector3(), _g2 = new THREE.Vector3();
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _gq = new THREE.Quaternion();

const _q1 = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qc = new THREE.Quaternion();
const _axis = new THREE.Vector3(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _pole = new THREE.Vector3();
const _p0 = new THREE.Vector3(), _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3();
const _ia = new THREE.Vector3(), _ib = new THREE.Vector3(), _ic = new THREE.Vector3(), _id = new THREE.Vector3(), _ip = new THREE.Vector3(), _ie = new THREE.Vector3(), _it = new THREE.Vector3();

/**
 * First-person arms (camo sleeves + gloves of the soldier model) for the viewmodel, or null if unavailable.
 * Returns { root, bones, mixer, ik(rightTarget, leftTarget, rightPole, leftPole) } with world-space targets.
 */
export function createFPArms(faction = 'ironfront') {
  const S = SOLDIER;
  if (!S || !S.arms) return null;
  const root = cloneSkinned(S.arms);
  const mats = soldierMaterials(faction, TONES[0]);
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.material = mats[o.material.name] || o.material;
    o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false;
  });
  const bones = {};
  root.traverse((o) => { if (o.isBone) bones[o.name] = o; });
  const frames = { r: handFrame(bones, 'r'), l: handFrame(bones, 'l') };
  const mixer = new THREE.AnimationMixer(root);
  if (S.clips.Grip) mixer.clipAction(S.clips.Grip).play();
  const len = (a, b) => (a && b ? a.getWorldPosition(new THREE.Vector3()).distanceTo(b.getWorldPosition(new THREE.Vector3())) : 0.28);
  const reach = len(bones.upperarm_l, bones.lowerarm_l) + len(bones.lowerarm_l, bones.hand_l);
  return {
    root, bones, mixer, reach,
    /** World-space targets for each hand, elbow pole directions, and the weapon's world rotation. */
    pose(rt, lt, rp, lp, gunQ, pistol) {
      ik(bones.upperarm_r, bones.lowerarm_r, bones.hand_r, rt, rp);
      ik(bones.upperarm_l, bones.lowerarm_l, bones.hand_l, lt, lp);
      gripHands(bones, frames, gunQ, pistol);
    },
  };
}

/** Soldier factory: the skinned real-asset soldier when loaded, otherwise the procedural fallback. */
export class SoldierModel {
  constructor(faction = 'ironfront', def = null) {
    return SOLDIER ? new SkinnedSoldier(faction, def) : new ProceduralSoldier(faction, def);
  }
}
