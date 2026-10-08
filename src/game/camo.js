// Weapon camo materials. Patterns are procedural noise in each mesh's object space (the gun models are authored
// in metres with unscaled nodes), so they wrap real and procedural guns alike without UVs or textures.
// A camo material is a clone of the gun's own material with a patched shader; optics, lenses, sight dots and
// brass are left alone.
import * as THREE from 'three';
import { camoDef } from '../core/catalog.js';

const cache = new Map();

const GLSL = /* glsl */ `
uniform vec3 camoA, camoB, camoC, camoD;
uniform float camoScale, camoMetal, camoRough;
varying vec3 vCamoPos;
float cHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float cNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(cHash(i), cHash(i + vec3(1, 0, 0)), f.x), mix(cHash(i + vec3(0, 1, 0)), cHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(cHash(i + vec3(0, 0, 1)), cHash(i + vec3(1, 0, 1)), f.x), mix(cHash(i + vec3(0, 1, 1)), cHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float cFbm(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * cNoise(p); p *= 2.03; a *= 0.5; } return v; }
vec3 camoColor(vec3 p, vec3 n, inout vec3 glow) {
  float s = camoScale;
#if CAMO_TYPE == 0
  float v = cFbm(p * s);
  return v < 0.42 ? camoA : v < 0.5 ? camoB : v < 0.58 ? camoC : camoD;
#elif CAMO_TYPE == 1
  vec3 cell = floor(p * s * 4.0);
  float v = cFbm(cell / 4.0) + (cHash(cell) - 0.5) * 0.06;
  return v < 0.42 ? camoA : v < 0.5 ? camoB : v < 0.58 ? camoC : camoD;
#elif CAMO_TYPE == 2
  float w = cFbm(p * s * 0.6);
  float v = sin((p.z + p.y * 0.6) * s * 3.0 + w * 7.0);
  return v > 0.45 ? camoB : mix(camoA, camoC, smoothstep(0.3, 0.7, w));
#elif CAMO_TYPE == 3
  vec2 uv = vec2(p.z + p.x, p.y + p.x) * s;
  vec2 f = fract(uv), i = floor(uv);
  float sh = mod(i.x + i.y, 2.0) < 1.0 ? f.x : f.y;
  return mix(camoA, camoB, sin(sh * 3.14159));
#elif CAMO_TYPE == 4
  return mix(camoA, camoB, smoothstep(0.25, 0.75, cFbm(p * s)));
#elif CAMO_TYPE == 5
  return mix(camoA, camoB, smoothstep(0.3, 0.8, cFbm(p * s)));
#elif CAMO_TYPE == 6
  vec3 cell = floor(p * s);
  float h = cHash(cell);
  vec3 irid = 0.5 + 0.5 * cos(6.28318 * (h * 0.35 + n.x * 0.6 + n.y * 0.4 + vec3(0.0, 0.33, 0.67)));
  glow += vec3(1.6) * pow(cHash(cell + floor(n * 5.0)), 36.0);
  return mix(camoA, irid, 0.45);
#else
  vec3 q = p * s;
  float w = cFbm(q + cFbm(q * 0.5) * 2.0);
  glow += camoC * (1.0 - smoothstep(0.0, 0.025, abs(w - 0.55))) * 2.4;
  return mix(camoA, camoB, smoothstep(0.35, 0.75, w));
#endif
}
`;

function camoMaterial(base, id, c) {
  if (!base || !base.isMeshStandardMaterial || base.transparent || base.userData.noCamo || /Brass/i.test(base.name)) return base;
  const key = base.uuid + ':' + id;
  let m = cache.get(key);
  if (m) return m;
  m = base.clone();
  const col = (i) => new THREE.Color(c.colors[Math.min(i, c.colors.length - 1)]);
  const uniforms = {
    camoA: { value: col(0) }, camoB: { value: col(1) }, camoC: { value: col(2) }, camoD: { value: col(3) },
    camoScale: { value: c.scale || 10 }, camoMetal: { value: c.metal ?? -1 }, camoRough: { value: c.rough ?? -1 },
  };
  m.defines = { ...(base.defines || {}), CAMO_TYPE: c.type };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = 'varying vec3 vCamoPos;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCamoPos = transformed;');
    sh.fragmentShader = GLSL + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        vec3 camoGlow = vec3(0.0);
        vec3 cc = camoColor(vCamoPos, normal, camoGlow);
        float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        diffuseColor.rgb = cc * clamp(0.78 + lum * 1.4, 0.78, 1.2);
        totalEmissiveRadiance += camoGlow;
        if (camoMetal >= 0.0) metalnessFactor = camoMetal;
        if (camoRough >= 0.0) roughnessFactor = camoRough;
      }`);
  };
  m.customProgramCacheKey = () => 'camo' + c.type;
  cache.set(key, m);
  return m;
}

/** Re-skin a built weapon model with a camo. Subtrees flagged userData.noCamo (optics) are skipped. */
export function applyCamo(root, id) {
  const c = camoDef(id);
  if (!c || c.type === undefined) return;
  const walk = (o) => {
    if (o.userData.noCamo) return;
    if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map((m) => camoMaterial(m, id, c)) : camoMaterial(o.material, id, c);
    for (const ch of o.children) walk(ch);
  };
  walk(root);
}
