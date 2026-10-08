// Visual effects: GPU point particles (sparks, dust, blood, fire, smoke), tracers, bullet-hole decals, explosions.
import * as THREE from 'three';
import { rand } from '../core/utils.js';
import { FLASH_TEX } from './viewmodel.js';

function softTex(hard = false) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (hard) { grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(255,255,255,0.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)'); }
  else {
    grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  }
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  if (!hard) { // cloudy noise
    const img = g.getImageData(0, 0, 64, 64);
    for (let i = 0; i < img.data.length; i += 4) img.data[i + 3] *= 0.75 + Math.random() * 0.25;
    g.putImageData(img, 0, 0);
  }
  return new THREE.CanvasTexture(c);
}

function holeTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(0.18, 'rgba(10,8,6,0.95)'); grd.addColorStop(0.35, 'rgba(40,34,28,0.6)'); grd.addColorStop(1, 'rgba(40,34,28,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1.2;
  for (let i = 0; i < 6; i++) { const a = Math.random() * Math.PI * 2; g.beginPath(); g.moveTo(32, 32); g.lineTo(32 + Math.cos(a) * rand(10, 26), 32 + Math.sin(a) * rand(10, 26)); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function scorchTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(5,5,5,0.95)'); grd.addColorStop(0.5, 'rgba(15,12,10,0.7)'); grd.addColorStop(1, 'rgba(20,15,10,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const VERT = `
  attribute float size; attribute float alpha; attribute vec3 pcolor; attribute float rot;
  varying float vAlpha; varying vec3 vColor; varying float vRot;
  uniform float scale;
  #include <fog_pars_vertex>
  void main(){
    vAlpha = alpha; vColor = pcolor; vRot = rot;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * scale / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const FRAG = `
  uniform sampler2D map; varying float vAlpha; varying vec3 vColor; varying float vRot;
  #include <fog_pars_fragment>
  void main(){
    vec2 c = gl_PointCoord - 0.5;
    float s = sin(vRot), co = cos(vRot);
    c = vec2(c.x*co - c.y*s, c.x*s + c.y*co) + 0.5;
    vec4 t = texture2D(map, c);
    gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
    #include <fog_fragment>
  }`;

class ParticleSystem {
  constructor(scene, max, tex, blending, depthWrite = false) {
    this.max = max;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('rot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: tex }, scale: { value: 600 } }]),
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite, blending, fog: true,
    });
    this.mat.uniforms.map.value = tex;
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.p = [];
    for (let i = 0; i < max; i++) this.p.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s0: 1, s1: 1, a0: 1, r: 1, g: 1, b: 1, grav: 0, drag: 0, vr: 0, rot: 0 });
    this.next = 0;
  }

  emit(o) {
    const p = this.p[this.next]; this.next = (this.next + 1) % this.max;
    p.life = p.max = o.life; p.x = o.x; p.y = o.y; p.z = o.z; p.vx = o.vx; p.vy = o.vy; p.vz = o.vz;
    p.s0 = o.s0; p.s1 = o.s1 ?? o.s0; p.a0 = o.a ?? 1; p.r = o.r; p.g = o.g; p.b = o.b; p.grav = o.grav ?? 0; p.drag = o.drag ?? 0;
    p.rot = Math.random() * 6.28; p.vr = o.vr ?? 0;
  }

  update(dt, height) {
    this.mat.uniforms.scale.value = height * 0.55;
    for (let i = 0; i < this.max; i++) {
      const p = this.p[i];
      if (p.life <= 0) { this.alpha[i] = 0; this.size[i] = 0; continue; }
      p.life -= dt;
      const k = 1 - p.life / p.max;
      p.vy -= p.grav * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy *= d; p.vz *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.01 && p.grav > 0) { p.y = 0.01; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      p.rot += p.vr * dt;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.col[i * 3] = p.r; this.col[i * 3 + 1] = p.g; this.col[i * 3 + 2] = p.b;
      this.size[i] = p.s0 + (p.s1 - p.s0) * k;
      this.alpha[i] = p.a0 * (k < 0.1 ? k / 0.1 : 1 - (k - 0.1) / 0.9);
      this.rot[i] = p.rot;
    }
    for (const n of ['position', 'pcolor', 'size', 'alpha', 'rot']) this.geo.attributes[n].needsUpdate = true;
  }
}

export class Effects {
  constructor(renderer) {
    this.R = renderer;
    const scene = renderer.scene;
    this.scene = scene;
    this.sparks = new ParticleSystem(scene, 900, softTex(true), THREE.AdditiveBlending);
    this.smoke = new ParticleSystem(scene, 500, softTex(false), THREE.NormalBlending);
    // tracers
    this.tracers = [];
    const tg = new THREE.BoxGeometry(0.018, 0.018, 1); tg.translate(0, 0, -0.5);
    const tm = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    for (let i = 0; i < 60; i++) {
      const m = new THREE.Mesh(tg, tm); m.visible = false; m.frustumCulled = false; scene.add(m);
      this.tracers.push({ m, from: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, t: 0, speed: 0, len: 0 });
    }
    this.tIdx = 0;
    // decals
    this.decals = [];
    const dg = new THREE.PlaneGeometry(1, 1);
    const dm = new THREE.MeshBasicMaterial({ map: holeTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    for (let i = 0; i < 220; i++) { const m = new THREE.Mesh(dg, dm); m.visible = false; scene.add(m); this.decals.push(m); }
    this.dIdx = 0;
    this.scorches = [];
    const sm = new THREE.MeshBasicMaterial({ map: scorchTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    for (let i = 0; i < 16; i++) { const m = new THREE.Mesh(dg, sm); m.visible = false; m.rotation.x = -Math.PI / 2; scene.add(m); this.scorches.push(m); }
    this.sIdx = 0;
    // world muzzle flash for third-person shooters
    this.wFlash = [];
    const fm = new THREE.SpriteMaterial({ map: FLASH_TEX, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    for (let i = 0; i < 16; i++) { const s = new THREE.Sprite(fm); s.visible = false; scene.add(s); this.wFlash.push({ s, t: 0 }); }
    this.fIdx = 0;
    this.lightT = 0;
    this.explT = 0;
  }

  tracer(from, to, speed = 380) {
    const tr = this.tracers[this.tIdx++ % this.tracers.length];
    tr.from.copy(from); tr.dir.subVectors(to, from); tr.dist = tr.dir.length(); tr.dir.divideScalar(tr.dist || 1);
    tr.t = 0; tr.speed = speed; tr.len = Math.min(5, tr.dist * 0.3);
    tr.m.visible = true;
    tr.m.position.copy(from);
    tr.m.lookAt(_v.copy(from).add(tr.dir));
  }

  muzzle(pos, big = 1, sprite = true) {
    if (sprite) {
      const f = this.wFlash[this.fIdx++ % this.wFlash.length];
      f.s.position.copy(pos); f.s.scale.setScalar(0.5 * big); f.s.material.rotation = Math.random() * 6; f.s.visible = true; f.t = 0.05;
    }
    const L = this.R.flashLight;
    L.position.copy(pos); L.intensity = 22 * big; this.lightT = 0.05;
  }

  impact(point, normal, surface = 'concrete') {
    const n = surface === 'metal' ? 8 : 5;
    for (let i = 0; i < n; i++) {
      const sp = surface === 'metal' ? 6 : 3.5;
      this.sparks.emit({
        x: point.x, y: point.y, z: point.z,
        vx: normal.x * rand(1, 3) + rand(-sp, sp) * 0.5, vy: normal.y * rand(1, 3) + rand(0, sp), vz: normal.z * rand(1, 3) + rand(-sp, sp) * 0.5,
        life: rand(0.15, 0.4), s0: rand(0.03, 0.06), s1: 0.01, r: 1, g: surface === 'metal' ? 0.8 : 0.65, b: 0.4, grav: 12, drag: 1,
      });
    }
    const dc = surface === 'wood' ? [0.45, 0.33, 0.2] : surface === 'sand' || surface === 'ground' ? [0.6, 0.52, 0.4] : [0.55, 0.53, 0.5];
    for (let i = 0; i < 3; i++) {
      this.smoke.emit({
        x: point.x + normal.x * 0.05, y: point.y + normal.y * 0.05, z: point.z + normal.z * 0.05,
        vx: normal.x * rand(0.5, 1.5) + rand(-0.3, 0.3), vy: normal.y * rand(0.5, 1.5) + rand(0, 0.6), vz: normal.z * rand(0.5, 1.5) + rand(-0.3, 0.3),
        life: rand(0.35, 0.7), s0: 0.12, s1: rand(0.4, 0.65), a: 0.28, r: dc[0], g: dc[1], b: dc[2], drag: 2.5, vr: rand(-1, 1),
      });
    }
    // decal
    const d = this.decals[this.dIdx++ % this.decals.length];
    d.position.copy(point).addScaledVector(normal, 0.005);
    d.lookAt(_v.copy(point).add(normal));
    d.rotateZ(Math.random() * 6.28);
    d.scale.setScalar(rand(0.07, 0.11));
    d.visible = true;
  }

  blood(point, dir) {
    for (let i = 0; i < 7; i++) {
      this.smoke.emit({
        x: point.x, y: point.y, z: point.z,
        vx: dir.x * rand(0.5, 2) + rand(-0.6, 0.6), vy: rand(-0.2, 1), vz: dir.z * rand(0.5, 2) + rand(-0.6, 0.6),
        life: rand(0.3, 0.6), s0: 0.1, s1: rand(0.35, 0.6), a: 0.8, r: 0.45, g: 0.03, b: 0.03, drag: 3, grav: 2,
      });
    }
  }

  explosion(pos, size = 1) {
    for (let i = 0; i < 40 * size; i++) {
      const a = Math.random() * 6.28, u = rand(-0.2, 1), sp = rand(3, 14) * size;
      const c = Math.sqrt(1 - u * u);
      this.sparks.emit({
        x: pos.x, y: pos.y + 0.3, z: pos.z, vx: Math.cos(a) * c * sp, vy: u * sp + 2, vz: Math.sin(a) * c * sp,
        life: rand(0.4, 1.2), s0: rand(0.06, 0.12), s1: 0.02, r: 1, g: rand(0.5, 0.8), b: 0.25, grav: 12, drag: 1.2,
      });
    }
    for (let i = 0; i < 18 * size; i++) {
      const a = Math.random() * 6.28, sp = rand(1, 6) * size;
      this.sparks.emit({
        x: pos.x + rand(-0.5, 0.5), y: pos.y + rand(0.2, 1.4), z: pos.z + rand(-0.5, 0.5), vx: Math.cos(a) * sp, vy: rand(1, 5), vz: Math.sin(a) * sp,
        life: rand(0.25, 0.55), s0: rand(1.4, 2.6) * size, s1: rand(2.5, 4) * size, r: 1, g: rand(0.45, 0.7), b: 0.15, drag: 4, vr: rand(-2, 2),
      });
    }
    for (let i = 0; i < 18 * size; i++) {
      const a = Math.random() * 6.28, sp = rand(0.5, 4) * size;
      const sh = rand(0.08, 0.2);
      this.smoke.emit({
        x: pos.x + rand(-0.8, 0.8), y: pos.y + rand(0.3, 2), z: pos.z + rand(-0.8, 0.8), vx: Math.cos(a) * sp, vy: rand(0.8, 3.5), vz: Math.sin(a) * sp,
        life: rand(1.5, 3), s0: rand(1, 1.8) * size, s1: rand(3, 5) * size, a: 0.42, r: sh, g: sh, b: sh, drag: 1.4, vr: rand(-0.4, 0.4),
      });
    }
    const L = this.R.explLight; L.position.copy(pos).add(_v.set(0, 2, 0)); L.intensity = 450 * size; this.explT = 0.45; this.explPeak = 450 * size;
    const s = this.scorches[this.sIdx++ % this.scorches.length];
    s.position.set(pos.x, 0.02, pos.z); s.scale.setScalar(3.5 * size); s.rotation.z = Math.random() * 6; s.visible = true;
  }

  /** Thin wisp off a hot barrel. */
  gunSmoke(pos) {
    this.smoke.emit({ x: pos.x, y: pos.y, z: pos.z, vx: rand(-0.15, 0.15), vy: rand(0.3, 0.6), vz: rand(-0.15, 0.15), life: rand(0.6, 1.1), s0: 0.04, s1: 0.4, a: 0.12, r: 0.8, g: 0.8, b: 0.8, drag: 1.5 });
  }

  smokeTrail(pos) {
    this.smoke.emit({ x: pos.x, y: pos.y, z: pos.z, vx: rand(-0.3, 0.3), vy: rand(0.2, 0.6), vz: rand(-0.3, 0.3), life: rand(0.6, 1), s0: 0.2, s1: 0.9, a: 0.28, r: 0.7, g: 0.7, b: 0.7, drag: 1 });
    this.sparks.emit({ x: pos.x, y: pos.y, z: pos.z, vx: 0, vy: 0, vz: 0, life: 0.08, s0: 0.5, s1: 0.2, r: 1, g: 0.7, b: 0.3 });
  }

  update(dt, cameraHeightPx) {
    this.sparks.update(dt, cameraHeightPx);
    this.smoke.update(dt, cameraHeightPx);
    for (const tr of this.tracers) {
      if (!tr.m.visible) continue;
      tr.t += tr.speed * dt;
      if (tr.t >= tr.dist) { tr.m.visible = false; continue; }
      const head = Math.min(tr.dist, tr.t + tr.len);
      tr.m.position.copy(tr.from).addScaledVector(tr.dir, head);
      tr.m.scale.set(1, 1, Math.max(0.01, head - tr.t));
    }
    for (const f of this.wFlash) if (f.s.visible && (f.t -= dt) <= 0) f.s.visible = false;
    if (this.lightT > 0 && (this.lightT -= dt) <= 0) this.R.flashLight.intensity = 0;
    if (this.explT > 0) { this.explT -= dt; this.R.explLight.intensity = Math.max(0, this.explT / 0.45) ** 2 * this.explPeak; }
  }

  clear() {
    for (const d of this.decals) d.visible = false;
    for (const s of this.scorches) s.visible = false;
    for (const t of this.tracers) t.m.visible = false;
    for (const p of [...this.sparks.p, ...this.smoke.p]) p.life = 0;
  }
}

const _v = new THREE.Vector3();
