import * as THREE from 'three';
import { propParts, propSize } from './props.js';

function plane(B, mat, x, z, w, d, y = 0.01) {
  const geo = new THREE.PlaneGeometry(w, d);
  geo.rotateX(-Math.PI / 2);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 5, uv.getY(i) * d / 5);
  geo.translate(x, y, z); B._push(mat, geo, false);
}

function tree(B, x, z, height, solid = true) {
  const key = propParts('forest_canopy').length ? 'forest_canopy' : 'forest_sapling';
  if (propParts(key).length) B.inst(key, x, 0, z, B.rand(0, 6.28), height / propSize(key)[1]);
  else {
    B.cyl(x, 0, z, 0.28, height * 0.85, B.M.forestBark, { collide: false, seg: 7 });
    for (let i = 0; i < 3; i++) {
      const geo = new THREE.ConeGeometry(height * (0.17 - i * 0.035), height * 0.4, 8);
      geo.translate(x, height * (0.45 + i * 0.2), z); B._push(B.M.forestLeaves, geo);
    }
  }
  // Only the trunk blocks movement and rounds. Canopies remain passable beneath.
  if (solid) B.box(x, 0, z, 0.7, height * 0.8, 0.7, null, { surface: 'wood' });
}

function rock(B, x, z, w, h, d) {
  const key = 'boulder_b';
  if (propParts(key).length) {
    const size = propSize(key);
    B.inst(key, x, -0.08, z, 0, w / size[0], { sy: h / size[1], sz: d / size[2] });
  } else {
    const geo = new THREE.DodecahedronGeometry(1, 0);
    geo.setIndex(Array.from({ length: geo.attributes.position.count }, (_, i) => i));
    geo.scale(w / 2, h, d / 2); geo.translate(x, 0, z); B._push(B.M.wallDark, geo);
  }
  // Conservative solid core, aligned with the visible boulder.
  B.box(x, 0, z, w * 0.7, h * 0.85, d * 0.7, null, { surface: 'concrete' });
}

function cabin(B, x, z) {
  B.building(x, z, 12, 10, { floors: 1, roofAccess: false, mat: B.M.forestBark, parapet: 0.1,
    clutter: false, doors: [{ side: 'n', c: 0, w: 2.4 }, { side: 's', c: 0, w: 2.4 }] });
}

export function buildWoodland(B, map) {
  const camp = map.id === 'outpost', half = camp ? 120 : 110, M = B.M;
  map.bounds = { minX: -half, maxX: half, minZ: -half, maxZ: half };
  plane(B, M.forestGround, 0, 0, (half + 90) * 2, (half + 90) * 2, 0);
  // Three north/south routes and cross trails connect every combat clearing.
  for (const x of [-64, 0, 64]) plane(B, M.forestTrail, x, 0, x === 0 ? 10 : 7, half * 2);
  for (const z of [-65, 0, 65]) plane(B, M.forestTrail, 0, z, half * 2, 7, 0.012);
  const sites = [[0, 0], [-64, 0], [64, 0], [0, 65], [0, -65]];
  for (const [x, z] of sites) plane(B, M.forestTrail, x, z, 22, 22, 0.014);
  map.flags = [[0, 65], [0, 0], [0, -65]].map(([x, z], i) => ({ name: 'ABC'[i], pos: new THREE.Vector3(x, 0, z) }));
  map.hardpoints = sites.map(([x, z]) => new THREE.Vector3(x, 0, z));
  map.survivalSpawn = new THREE.Vector3(0, 0, 65);
  map.buySpots = [[-10, half - 16], [10, -half + 16], [64, 10]];
  if (camp) {
    for (const [x, z] of [[-24, 32], [24, -32], [-34, -42], [34, 42]]) cabin(B, x, z);
    for (const [x, z] of [[-18, -14], [18, 14]]) {
      B.sandbags(x, z, 8); B.crate(x + 5, z, 1.4); B.barrel(x - 5, z);
    }
    B.building(-64, 32, 10, 10, { floors: 2, roofAccess: true, mat: M.forestBark, clutter: false,
      doors: [{ side: 'n', c: 2, w: 2 }, { side: 's', c: 2, w: 2 }] });
  }
  // Stagger cover between lanes; short, open paths remain around every obstacle.
  for (const [x, z, w, h, d] of [[-18,18,9,3.2,5],[18,-18,9,3.2,5],[-42,55,10,3.8,6],[42,-55,10,3.8,6],
    [-83,30,8,3,6],[83,-30,8,3,6],[-42,-20,7,2.8,5],[42,20,7,2.8,5],[-18,-80,8,3,5],[18,80,8,3,5],
    [-88,-64,9,3.2,6],[88,64,9,3.2,6]]) rock(B, x, z, w, h, d);
  for (const [x, z] of [[-12,48],[12,-48],[-52,15],[52,-15],[-72,-42],[72,42]]) {
    if (propParts('forest_log').length) {
      const size = propSize('forest_log');
      B.inst('forest_log', x, 0, z, 0, 7 / size[0], { sy: 1.1 / size[1], sz: 1.3 / size[2] });
    } else B.box(x, 0, z, 7, 1.1, 1.3, M.forestBark, { collide: false });
    B.box(x, 0, z, 6.5, 0.95, 1, null, { surface: 'wood' });
  }
  const clear = (x, z) => Math.abs(x) < 7 || Math.abs(Math.abs(x) - 64) < 6 ||
    Math.abs(z) < 6 || Math.abs(Math.abs(z) - 65) < 6 || Math.abs(z) > half - 24 ||
    sites.some(([sx, sz]) => Math.hypot(x - sx, z - sz) < 15) || B.world.overlaps(x, 0.05, z, 3, 2);
  let trees = 0;
  for (let x = -half + 8; x < half - 8; x += 10) for (let z = -half + 8; z < half - 8; z += 10) {
    const tx = x + B.rand(-2.5, 2.5), tz = z + B.rand(-2.5, 2.5);
    if (clear(tx, tz)) continue;
    tree(B, tx, tz, B.rand(10, 18)); trees++;
    if (!B.low && propParts('forest_fern').length) B.inst('forest_fern', tx + 2, 0, tz + 2, B.rand(0, 6.28), 2.2, { shadow: false });
    if (!B.low && B.rng() < 0.25) tree(B, tx - 3, tz + 2, B.rand(4, 7), false);
  }
  // Dense distant treeline hides the edge without adding navigation obstacles.
  for (let row = 0; row < (B.low ? 2 : 3); row++) {
    const edge = half + 7 + row * 15;
    for (let t = -edge; t <= edge; t += 12) {
      for (const [x,z] of [[t,edge],[t,-edge],[edge,t],[-edge,t]]) tree(B, x + B.rand(-2,2), z + B.rand(-2,2), B.rand(15,23), false);
    }
  }
  for (const [x,z,w,d] of [[0,-half,half*2,1],[0,half,half*2,1],[-half,0,1,half*2],[half,0,1,half*2]])
    B.box(x,0,z,w,30,d,null,{noMinimap:true});
  for (let x = -80; x <= 80; x += 10) {
    map.spawns.A.push(new THREE.Vector3(x,0,half-12));
    map.spawns.B.push(new THREE.Vector3(x,0,-half+12));
  }
  map.spawns.ffa = [...map.spawns.A, ...map.spawns.B].map(p => p.clone());
  for (const x of [-64,0,64]) for (const z of [-65,0,65]) map.spawns.ffa.push(new THREE.Vector3(x,0,z));
  map.woodlandTrees = trees;
}
