import * as THREE from 'three';
import { hasProps } from './props.js';

const signs = new Map();
function signMaterial(title, subtitle, color = '#e4b647') {
  const key = title + subtitle + color;
  if (signs.has(key)) return signs.get(key);
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
  const g = canvas.getContext('2d');
  g.fillStyle = '#18252b'; g.fillRect(0, 0, 512, 256);
  g.fillStyle = color; g.fillRect(0, 0, 512, 14); g.fillRect(22, 38, 9, 160);
  g.fillStyle = '#edf2ed'; g.font = 'bold 46px Rajdhani, sans-serif'; g.fillText(title, 50, 110);
  g.fillStyle = color; g.font = '26px Rajdhani, sans-serif'; g.fillText(subtitle, 50, 155);
  g.fillStyle = '#72878a'; g.font = '18px monospace'; g.fillText('IRONFRONT / OPERATIONS', 50, 210);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({map:texture,roughness:0.7,metalness:0.25,side:THREE.DoubleSide});
  signs.set(key, material); return material;
}

function sign(B, x, y, z, title, subtitle, yaw = 0) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.4), signMaterial(title, subtitle));
  mesh.position.set(x, y, z); mesh.rotation.y = yaw; mesh.receiveShadow = true;
  B.group.add(mesh);
}

function staging(B, x, z, title) {
  if (B.world.overlaps(x, 0.05, z, 2.2, 3)) return;
  const M = B.M;
  for (const dx of [-1.8,1.8]) for (const dz of [-1.1,1.1]) B.box(x+dx,0,z+dz,0.075,2.65,0.075,M.trim,{surface:'metal'});
  B.box(x,2.6,z,3.8,0.06,2.4,M.sandbag,{collide:false});
  B.crate(x-0.9,z,0.85); B.crate(x-0.9,z,0.7,0.85); B.crate(x+0.75,z+0.2,1.0);
  if (hasProps()) {
    B.prop('ammo_box',x+0.7,1,z+0.15,0.3);
    B.prop('jerrycan',x+1.25,0,z-0.8,-0.2);
  }
  sign(B,x,2.15,z-1.12,title,'STAGING AREA / 01');
}

export function addMapPolish(B,map) {
  const half = map.bounds.maxZ;
  staging(B,-30,half-20,'RANGER STAGING'); staging(B,30,-half+20,'FOREST CHECKPOINT');
  sign(B,-8,2,66,'SOUTH CLEARING','TRAIL A / FIELD SUPPORT');
  sign(B,8,2,-66,'NORTH CLEARING','TRAIL C / CHECKPOINT',Math.PI);
  sign(B,64,2,13,'EAST TRAIL','FLANK ROUTE / CAMP');
}
