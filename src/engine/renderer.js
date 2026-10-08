import * as THREE from 'three';
import { PerformanceScale } from './performance-scale.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

const ASSET = (p) => `${import.meta.env.BASE_URL}assets/${p}`;

/** Graphics presets. Each one just fills in the individual graphics settings, which players can then adjust. */
export const GRAPHICS_PRESETS = {
  performance: { renderScale: 0.7, shadows: 'off', ao: false, detail: 'low', postFx: false },
  low: { renderScale: 0.85, shadows: 'low', ao: false, detail: 'low', postFx: false },
  medium: { renderScale: 1, shadows: 'low', ao: false, detail: 'high', postFx: true },
  high: { renderScale: 1, shadows: 'high', ao: false, detail: 'high', postFx: true },
  ultra: { renderScale: 1, shadows: 'ultra', ao: true, detail: 'high', postFx: true },
};
const SHADOW_SIZE = { low: 1024, high: 2048, ultra: 4096 };

// Combined vignette + chromatic aberration + film grain + damage tint + flashbang.
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null }, time: { value: 0 }, damage: { value: 0 }, vignette: { value: 0.18 },
    aberration: { value: 0.0015 }, grain: { value: 0.012 }, flash: { value: 0 }, desat: { value: 0 },
    contrast: { value: 1.06 }, saturation: { value: 0.94 }, tint: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, damage, vignette, aberration, grain, flash, desat, contrast, saturation; uniform vec3 tint; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + time*7.0) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5; float r = length(c);
      float ab = aberration * (1.0 + damage * 4.0) * r;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + c * ab).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - c * ab).b;
      // grade: gentle contrast around mid grey, slightly muted saturation, per-map tint
      col = clamp((col - 0.5) * contrast + 0.5, 0.0, 1.0);
      float l = dot(col, vec3(0.299,0.587,0.114));
      col = mix(vec3(l), col, saturation) * tint;
      col = mix(col, vec3(l), clamp(desat + damage*0.6, 0.0, 1.0));
      col *= 1.0 - smoothstep(0.35, 0.95, r) * (vignette + damage*0.5);
      col = mix(col, col * vec3(1.15, 0.55, 0.5), damage * smoothstep(0.2, 0.8, r));
      col += (hash(vUv*vec2(1920.0,1080.0)) - 0.5) * grain;
      col = mix(col, vec3(1.0), flash);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// GTAO that also leaves out transparent and alpha-cut surfaces (smoke, decals, tracers, foliage cards, sprites):
// they would otherwise write solid normals and cast blocky dark halos.
class GameAOPass extends GTAOPass {
  // AO is low-frequency: computing it at half resolution costs a quarter as much and looks almost the same
  setSize(width, height) { super.setSize(Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2))); }

  _overrideVisibility() {
    const cache = this._visibilityCache;
    this.scene.traverse((o) => {
      if (!o.visible) return;
      const m = o.material;
      if (o.isPoints || o.isLine || o.isSprite || o.userData.noAO || (m && !Array.isArray(m) && (m.transparent || m.alphaTest > 0 || m.blending !== THREE.NormalBlending))) {
        o.visible = false; cache.push(o);
      }
    });
  }
}

export class Renderer {
  constructor() {
    const r = this.r = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    r.domElement.id = 'game';
    document.getElementById('app').prepend(r.domElement);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.autoClear = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(80, innerWidth / innerHeight, 0.05, 900);
    this.scene.add(this.camera);
    // viewmodel scene rendered on top with depth cleared
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.01, 20);
    this.vmScene.add(this.vmCamera);

    this.tex = {};
    this.mats = {};
    this.quality = 'high';
    this.performanceScale = new PerformanceScale(); this.basePixelRatio = 1;
    this.baseFov = 80;
    this.loader = new THREE.TextureLoader();
    addEventListener('resize', () => this.resize());
  }

  async load(onProgress) {
    const names = ['wall', 'crate', 'floor', 'sand'];
    const maps = ['diff', 'nor', 'rough'];
    const total = names.length * maps.length + 2 + 2 + 3;
    let done = 0;
    const tick = (label) => { done++; onProgress && onProgress(done / total, label); };
    const aniso = this.r.capabilities.getMaxAnisotropy();
    const jobs = [];
    this.tex.forest = {};
    for (const [file, key] of [['diff', 'diff'], ['normal', 'nor'], ['rough', 'rough']]) {
      jobs.push(this.loader.loadAsync(ASSET(`textures/woodland/${file}.jpg`)).then(t => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(8, aniso);
        if (key === 'diff') t.colorSpace = THREE.SRGBColorSpace;
        this.tex.forest[key] = t; tick('FOREST FLOOR');
      }).catch(() => tick('missing forest texture')));
    }
    for (const n of names) {
      this.tex[n] = {};
      for (const m of maps) {
        jobs.push(this.loader.loadAsync(ASSET(`textures/${n}_${m}.jpg`)).then((t) => {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.anisotropy = Math.min(8, aniso);
          if (m === 'diff') t.colorSpace = THREE.SRGBColorSpace;
          this.tex[n][m] = t;
          tick(`TEXTURE ${n.toUpperCase()}`);
        }).catch(() => tick('missing ' + n)));
      }
    }
    // single maps: wall grime streaks
    for (const n of ['grime_a', 'grime_b']) {
      jobs.push(this.loader.loadAsync(ASSET(`textures/${n}.jpg`)).then((t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(8, aniso);
        t.colorSpace = THREE.SRGBColorSpace;
        this.tex[n] = t; tick('TEXTURE');
      }).catch(() => tick('missing ' + n)));
    }
    // Real skies (Poly Haven pure-sky HDRIs): a 1k HDR lights the scene, a sharp 4k JPEG is the visible sky.
    this.skies = {};
    let skyMeta = {};
    try { skyMeta = await (await fetch(ASSET('hdri/meta.json'))).json(); } catch { /* no skies: flat colour fallback */ }
    for (const [key, m] of Object.entries(skyMeta)) {
      const sky = this.skies[key] = { bgScale: m.bgScale };
      jobs.push(new HDRLoader().loadAsync(ASSET('hdri/' + m.env)).then((hdr) => {
        hdr.mapping = THREE.EquirectangularReflectionMapping;
        Object.assign(sky, analyseSky(hdr));
        const pm = new THREE.PMREMGenerator(this.r);
        sky.env = pm.fromEquirectangular(hdr).texture;
        pm.dispose(); hdr.dispose();
        tick('ENVIRONMENT');
      }).catch((e) => { console.warn('hdr failed', e); tick('ENV'); }));
      jobs.push(this.loader.loadAsync(ASSET('hdri/' + m.bg)).then((t) => {
        t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
        t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; // a 4k sky never needs mips; saves a third of its memory
        sky.bg = t; tick('SKY');
      }).catch(() => tick('SKY')));
    }
    await Promise.all(jobs);
    for (const [k, s] of Object.entries(this.skies)) if (!s.env) delete this.skies[k];
    const sky = Object.values(this.skies)[0];
    if (sky) this.envMap = sky.env;
    this._buildMaterials();
    this._setupLights();
    this._setupPost();
    this.resize();
  }

  _pbr(name, opts = {}) {
    const t = this.tex[name] || {};
    const m = new THREE.MeshStandardMaterial({
      map: t.diff || null, normalMap: t.nor || null, roughnessMap: t.rough || null,
      roughness: opts.roughness ?? 1, metalness: opts.metalness ?? 0, color: opts.color ?? 0xffffff,
      envMapIntensity: opts.env ?? 0.6,
    });
    if (m.normalMap) m.normalScale.set(opts.normal ?? 1, opts.normal ?? 1);
    return m;
  }

  _buildMaterials() {
    const M = this.mats;
    M.forestGround = this._pbr('forest', { color: 0xaaa58f });
    M.forestTrail = this._pbr('forest', { color: 0xc0ad88 });
    M.forestBark = this._pbr('crate', { color: 0x66543e });
    M.forestLeaves = new THREE.MeshStandardMaterial({ color: 0x294735, roughness: 1 });
    M.wall = this._pbr('wall', { color: 0xd8d4cc });
    M.wallDark = this._pbr('wall', { color: 0x8d8a85 });
    M.floor = this._pbr('floor', { color: 0xbdb8b0 });
    M.crate = this._pbr('crate', { color: 0xc8a273 });
    M.sandbag = this._pbr('sand', { color: 0x9c8b66, normal: 2 });
    M.trim = new THREE.MeshStandardMaterial({ color: 0x2d3033, roughness: 0.6, metalness: 0.5 });
    M.barrel = new THREE.MeshStandardMaterial({ color: 0xa3261c, roughness: 0.45, metalness: 0.55 });
    // rain/grime streaks under roof lines, multiplied over the wall so they work in sun and shade alike
    const grime = (t) => new THREE.MeshBasicMaterial({ map: t || null, transparent: true, blending: THREE.MultiplyBlending, premultipliedAlpha: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: false, toneMapped: false });
    M.grimeA = grime(this.tex.grime_a); M.grimeB = grime(this.tex.grime_b);
  }

  _setupLights() {
    const s = this.scene;
    if (this.envMap) { s.environment = this.envMap; s.environmentIntensity = 0.9; }
    s.background = new THREE.Color(0x8fa3b5);
    s.fog = new THREE.Fog(0xc6e3f6, 40, 900);
    // the HDRI does the sky light now; this only lifts the darkest crevices a touch
    this.hemi = new THREE.HemisphereLight(0xcfe0f0, 0x5a4e3e, 0.12);
    s.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xffe6c4, 2.8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 300;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    this.sunOffset = new THREE.Vector3(-60, 110, -45);
    s.add(sun); s.add(sun.target);

    // viewmodel lighting
    const vs = this.vmScene;
    vs.environment = this.envMap || null;
    vs.environmentIntensity = 0.9;
    this.vmHemi = new THREE.HemisphereLight(0xdde8f5, 0x403830, 0.35);
    vs.add(this.vmHemi);
    const vsun = this.vmSun = new THREE.DirectionalLight(0xffe6c4, 2.2);
    vsun.position.set(-1, 2, 1); vs.add(vsun);
    // muzzle flash lights (fixed count avoids shader recompiles)
    this.flashLight = new THREE.PointLight(0xffb060, 0, 9, 2);
    s.add(this.flashLight);
    this.vmFlashLight = new THREE.PointLight(0xffb060, 0, 3, 2);
    this.vmCamera.add(this.vmFlashLight);
    this.vmFlashLight.position.set(0.1, -0.05, -0.8);
    this.explLight = new THREE.PointLight(0xff8a3a, 0, 40, 2);
    s.add(this.explLight);
  }

  setTheme(theme) {
    // per-map atmosphere, driven by that map's real sky
    const s = this.scene;
    const sky = this.skies && (this.skies[theme] || Object.values(this.skies)[0]);
    if (sky) {
      const n = sky.norm;   // brings every HDRI to the same overall sky brightness
      s.environment = sky.env; this.vmScene.environment = sky.env;
      s.environmentIntensity = 0.95 * n; this.vmScene.environmentIntensity = 0.95 * n;
      const h = sky.horizon;
      if (sky.bg) { s.background = sky.bg; s.backgroundIntensity = sky.bgScale * n; } else s.background = new THREE.Color().setRGB(h.r * n, h.g * n, h.b * n);
      // haze takes the sky's own horizon colour, so distant geometry melts into the backdrop
      s.fog.color.setRGB(h.r * n, h.g * n, h.b * n);
      this.sunOffset.copy(sky.sunDir).multiplyScalar(150);
      if (this.sunOffset.y < 45) this.sunOffset.y = 45; // keep shadows readable even when the HDRI sun is low
      this.sun.color.copy(sky.sunColor);
    }
    // woodland haze: a green-grey fog that closes in under the canopy
    s.fog.near = 65; s.fog.far = 310;
    s.fog.color.set(0x9daea0);
    this.sun.intensity = 2.4;
    this.hemi.intensity = 0.12;
    this.hemi.groundColor.set(0x4d5a3d);
    this.r.toneMappingExposure = 1.0;
    if (this.finalPass) {
      const u = this.finalPass.uniforms;
      u.desat.value = 0;
      u.tint.value.set(0.98, 1.0, 1.02);
    }
  }

  _setupPost() {
    const size = new THREE.Vector2(innerWidth, innerHeight);
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 0 });
    const comp = this.composer = new EffectComposer(this.r, rt);
    this.worldPass = new RenderPass(this.scene, this.camera);
    comp.addPass(this.worldPass);
    // ambient occlusion on the world only (before the viewmodel is drawn on top)
    this.ao = new GameAOPass(this.scene, this.camera, size.x, size.y);
    this.ao.blendIntensity = 0.85;
    this.ao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.2, scale: 1, samples: 8 });
    this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 8 });
    this.ao.enabled = false;
    comp.addPass(this.ao);
    const vm = this.vmPass = new RenderPass(this.vmScene, this.vmCamera);
    vm.clear = false; vm.clearDepth = true;
    comp.addPass(vm);
    this.bloom = new UnrealBloomPass(size, 0.18, 0.4, 1.05);
    comp.addPass(this.bloom);
    comp.addPass(new OutputPass());
    this.finalPass = new ShaderPass(FinalShader);
    comp.addPass(this.finalPass);
    this.smaa = new SMAAPass();
    comp.addPass(this.smaa);
  }

  /**
   * g: { renderScale 0.5..1, shadows 'off'|'low'|'high'|'ultra', ao, detail 'low'|'high', postFx, native }.
   * native renders at the screen's full pixel density (Ultra only); otherwise at most 1 pixel per CSS pixel.
   */
  applyGraphics(g) {
    const key = JSON.stringify(g);
    if (key === this._gfxKey) return;
    const prev = this.gfx || {};
    this._gfxKey = key; this.gfx = { ...g };
    this.detail = g.detail;
    const pr = Math.min(devicePixelRatio, 2);
    this.performanceScale.reset();
    this.basePixelRatio = (g.native ? pr : Math.min(pr, 1)) * g.renderScale;
    this.r.setPixelRatio(this.basePixelRatio);
    const shadowsOn = g.shadows !== 'off';
    this.r.shadowMap.enabled = shadowsOn;
    if (this.sun) {
      this.sun.castShadow = shadowsOn;
      const sm = SHADOW_SIZE[g.shadows] || 2048;
      if (this.sun.shadow.mapSize.x !== sm) {
        this.sun.shadow.mapSize.set(sm, sm);
        if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
      }
    }
    if (this.bloom) this.bloom.enabled = !!g.postFx;
    if (this.smaa) this.smaa.enabled = !!g.postFx;
    if (this.ao) this.ao.enabled = !!g.ao;
    // switching shadows on/off changes every lit shader: recompile once, only when it actually changed
    if ((prev.shadows === 'off') !== (g.shadows === 'off') || prev.shadows === undefined) {
      this.scene.traverse((o) => {
        const materials = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const material of materials) material.needsUpdate = true;
      });
    }
    this.resize();
  }

  trackPerformance(frameDt, active) {
    if (!this.performanceScale.update(frameDt, active)) return;
    this.r.setPixelRatio(this.basePixelRatio * this.performanceScale.scale);
    this.resize();
  }

  setFov(f) { this.baseFov = f; }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.r.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h; this.vmCamera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.r.getPixelRatio());
      this.composer.setSize(w, h);
    }
  }

  updateSun(focus) {
    // keep a high-res shadow frustum centred on the player, snapped to texels to avoid shimmering
    const sun = this.sun;
    const texel = 140 / sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    sun.target.position.set(fx, 0, fz);
    sun.position.set(fx + this.sunOffset.x, this.sunOffset.y, fz + this.sunOffset.z);
    this.vmSun.position.copy(this.sunOffset).normalize();
  }

  render(dt) {
    this.finalPass.uniforms.time.value += dt;
    this.r.clear();
    this.composer.render(dt);
  }
}

/** Box geometry whose UVs are scaled to world units (texture tiles every `tile` meters). */
export function worldBox(w, h, d, tile = 2) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // faces: +x, -x, +y, -y, +z, -z (4 verts each)
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, uv.getX(idx) * dims[f][0] / tile, uv.getY(idx) * dims[f][1] / tile);
    }
  }
  return g;
}

/**
 * Reads an equirect HDR once at load: the sun's direction and colour (its brightest spot), the average horizon
 * colour (for fog) and a normalising factor that brings any HDRI to the same overall sky brightness.
 */
function analyseSky(hdr) {
  const { data, width: W, height: H } = hdr.image;
  const f = data instanceof Uint16Array ? THREE.DataUtils.fromHalfFloat : (v) => v;
  const px = (x, y, c) => f(data[(y * W + x) * 4 + c]);
  let best = -1, bx = 0, by = 0, sum = 0, n = 0, hn = 0;
  const hr = [0, 0, 0];
  for (let y = 0; y < H / 2; y++) {           // rows run top-down: the upper half is the sky
    for (let x = 0; x < W; x += 2) {
      const r = px(x, y, 0), g = px(x, y, 1), b = px(x, y, 2), l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (l > best) { best = l; bx = x; by = y; }
      sum += Math.min(l, 8); n++;
      if (y > H * 0.44) { hr[0] += r; hr[1] += g; hr[2] += b; hn++; }   // a band just above the horizon
    }
  }
  const u = (bx + 0.5) / W, v = 1 - (by + 0.5) / H;
  const phi = (u - 0.5) * Math.PI * 2, lat = (v - 0.5) * Math.PI;
  const sunDir = new THREE.Vector3(Math.cos(phi) * Math.cos(lat), Math.sin(lat), Math.sin(phi) * Math.cos(lat)).normalize();
  // sun colour from the ring around the hot spot (the core itself is clipped white)
  const sc = [0, 0, 0];
  for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
    const x = (bx + dx + W) % W, y = Math.min(H - 1, Math.max(0, by + dy));
    for (let c = 0; c < 3; c++) sc[c] += px(x, y, c);
  }
  const sm = Math.max(sc[0], sc[1], sc[2]) || 1;
  const sunColor = new THREE.Color(0.75 + 0.25 * sc[0] / sm, 0.75 + 0.25 * sc[1] / sm, 0.75 + 0.25 * sc[2] / sm);
  const norm = 1.1 / (sum / n || 1);
  const horizon = new THREE.Color(hr[0] / hn, hr[1] / hn, hr[2] / hn);
  return { sunDir, sunColor, norm, horizon };
}
