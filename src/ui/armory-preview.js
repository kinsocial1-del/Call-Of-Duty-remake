import * as THREE from 'three';
import {buildWeaponModel} from '../game/weapons.js';
import {equippedCamo} from '../core/cosmetics.js';

// Render each weapon once with the game's existing renderer and cache the image.
export class ArmoryPreview {
  constructor(renderer) { this.R=renderer; this.cache=new Map(); }
  image(def, camo=equippedCamo(def.id)) {
    const cacheKey=def.id+':'+(camo||'none');
    if(this.cache.has(cacheKey)) return this.cache.get(cacheKey);
    const r=this.R.r, scene=new THREE.Scene();
    scene.background=new THREE.Color(0x111c23);
    scene.environment=this.R.scene.environment;
    const {group}=buildWeaponModel(def,{camo}); scene.add(group);
    group.rotation.y=0.12; group.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(group), centre=box.getCenter(new THREE.Vector3());
    group.position.sub(centre);
    const size=box.getSize(new THREE.Vector3()); const span=Math.max(size.x,size.y,size.z,0.3);
    const width=960, height=320;
    const camera=new THREE.OrthographicCamera(-span*0.62,span*0.62,span*0.62/3,-span*0.62/3,0.01,20);
    camera.position.set(span*1.7,span*0.6,span*0.35); camera.lookAt(0,0,0);
    scene.add(new THREE.HemisphereLight(0xd7eaff,0x594638,3));
    const key=new THREE.DirectionalLight(0xffffff,4.5); key.position.set(2,4,1); scene.add(key);
    const rim=new THREE.DirectionalLight(0xf2b33d,2); rim.position.set(-2,1,-2); scene.add(rim);
    const target=new THREE.WebGLRenderTarget(width,height);
    target.texture.colorSpace=THREE.SRGBColorSpace;
    const oldTarget=r.getRenderTarget(), oldViewport=r.getViewport(new THREE.Vector4()), oldScissor=r.getScissor(new THREE.Vector4());
    const oldTest=r.getScissorTest(), oldClear=r.getClearColor(new THREE.Color()), oldAlpha=r.getClearAlpha();
    const pixels=new Uint8Array(width*height*4);
    try {
      r.setRenderTarget(target); r.setViewport(0,0,width,height); r.setScissorTest(false);
      r.clear(); r.render(scene,camera); r.readRenderTargetPixels(target,0,0,width,height,pixels);
    } finally {
      r.setRenderTarget(oldTarget); r.setViewport(oldViewport); r.setScissor(oldScissor); r.setScissorTest(oldTest);
      r.setClearColor(oldClear,oldAlpha); target.dispose();
    }
    const canvas=document.createElement('canvas'); canvas.width=width; canvas.height=height;
    const g=canvas.getContext('2d'), frame=g.createImageData(width,height);
    for(let y=0;y<height;y++) frame.data.set(pixels.subarray(y*width*4,(y+1)*width*4),(height-1-y)*width*4);
    g.putImageData(frame,0,0); const url=canvas.toDataURL(); this.cache.set(cacheKey,url); return url;
  }
}
