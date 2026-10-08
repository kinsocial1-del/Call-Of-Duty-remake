// Real CC0 prop models (Poly Haven scans converted by tools/convert_props.py): crates, drums, barriers, ammo cans,
// jerrycans. Maps fall back to their procedural box props if these fail to load.
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';
import { markShared } from '../core/utils.js';

let PROPS = null;

export async function loadPropAssets(base) {
  const dir = `${base}assets/models/props/`;
  try {
    const meta = await (await fetch(dir + 'meta.json')).json();
    const loader = new GLTFLoader();
    const out = {};
    await Promise.all(Object.entries(meta).map(async ([key, m]) => {
      const gltf = await loader.loadAsync(dir + m.file);
      gltf.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      markShared(gltf.scene);
      out[key] = { scene: gltf.scene, size: m.size };
    }));
    PROPS = out;
    // Optional woodland pack is isolated so a missing download cannot disable the existing props.
    try {
      const forestDir = `${base}assets/models/woodland/`;
      const forestMeta = await (await fetch(forestDir + 'meta.json')).json();
      await Promise.all(Object.entries(forestMeta).map(async ([key, m]) => {
        const gltf = await loader.loadAsync(forestDir + m.file);
        gltf.scene.traverse(o => {
          if (!o.isMesh) return;
          o.castShadow = true; o.receiveShadow = true;
          const materials = Array.isArray(o.material) ? o.material : [o.material];
          for (const mat of materials) if (mat.transparent) {
            mat.transparent = false; mat.alphaTest = 0.45; mat.depthWrite = true;
          }
        });
        markShared(gltf.scene);
        out[key] = { scene: gltf.scene, size: m.size };
      }));
      const textureLoader = new THREE.TextureLoader();
      const cards = await Promise.all([0, 1].map(i => textureLoader.loadAsync(`${base}assets/textures/woodland/fir_card_${i}.png`)));
      const canopy = new THREE.Group();
      cards.forEach((texture, i) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        const mat = new THREE.MeshBasicMaterial({ map: texture, color: 0xb6c3a9, side: THREE.DoubleSide, alphaTest: 0.4 });
        const card = new THREE.Mesh(new THREE.PlaneGeometry(0.53, 1), mat);
        card.position.y = 0.5; card.rotation.y = i * Math.PI / 2;
        canopy.add(card);
      });
      markShared(canopy);
      out.forest_canopy = { scene: canopy, size: [0.53, 1, 0.53] };
    } catch (e) { console.warn('woodland models unavailable, using fallback scenery', e); }
  } catch (e) { console.warn('prop models unavailable, using box props', e); }
}

export const hasProps = () => !!PROPS;

/** [width x, height y, depth z] of a prop at scale 1. */
export function propSize(key) { return PROPS[key].size; }

/** A fresh instance of a prop (origin at the bottom centre). */
export function propClone(key) { return PROPS && PROPS[key] ? PROPS[key].scene.clone(true) : null; }

/** The meshes of a prop with their transforms relative to its origin (for instanced placement). */
export function propParts(key) {
  const P = PROPS && PROPS[key];
  if (!P) return [];
  if (!P.parts) {
    P.scene.updateMatrixWorld(true);
    P.parts = [];
    P.scene.traverse((o) => { if (o.isMesh) P.parts.push({ geometry: o.geometry, material: o.material, matrix: o.matrixWorld.clone() }); });
  }
  return P.parts;
}
