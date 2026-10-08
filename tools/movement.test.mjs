import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Player } from '../src/game/player.js';
import { WeaponState } from '../src/game/actor.js';
import { WEAPONS } from '../src/game/weapons.js';
import { World } from '../src/engine/physics.js';
import { Input } from '../src/engine/input.js';
import { profile } from '../src/core/save.js';
import { audio } from '../src/engine/audio.js';
import { spawnScore } from '../src/game/spawn.js';

for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(audio))) {
  if (name !== 'constructor' && typeof audio[name] === 'function') audio[name] = () => {};
}
const noop = () => {};
const blank = overrides => ({ ...Input.prototype._blank(), ...overrides });
function player(weapon = 'vx4') {
  const game = {
    world: new World(), time: 10, mode: { id: 'tdm' }, input: { lastDevice: 'kbm', rumble: noop },
    map: { bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 } },
    pickups: { near: () => null }, vm: { setWeapon: noop, kick: noop, jump: noop, land: noop, muzzleWorld: (cam, out) => out.copy(cam.position) },
    buy: { near: () => null, close: noop },
    R: { camera: new THREE.PerspectiveCamera(85, 1, 0.01, 100), vmCamera: new THREE.PerspectiveCamera(58, 1, 0.01, 100) },
    shakeVec: new THREE.Vector3(), shake: noop, aimAssistTarget: () => null, aimSnap: noop,
    hud: { damageIndicator: noop }, onKill: (attacker, victim) => { victim.alive = false; },
    meleeAttack: noop, throwGrenade: noop, stats: { shots: 0 }, onShotSound: noop,
    fx: { muzzle: noop }, fireBullet: noop,
  };
  const p = new Player(game, 'TEST'); game.player = p;
  p.setLoadout({ primary: weapon, secondary: 'p17', perks: [] });
  p.spawn(new THREE.Vector3(), 0); p.swapT = -1;
  return p;
}
function tick(p, input = {}, dt = 1 / 60) {
  p.game.time += dt; p.update(dt, blank(input)); p.applyCamera(p.game.R.camera, dt);
}
function run(p, input, seconds = 1, fps = 60) {
  for (let i = 0; i < Math.round(seconds * fps); i++) tick(p, input, 1 / fps);
  return p;
}
function close(a,b,tolerance = 1e-6) { assert.ok(Math.abs(a-b) <= tolerance, `${a} differs from ${b}`); }

test('respawn favors cover over an exposed location farther from the enemy', () => {
  const world = new World(); world.add(-2,0,5,2,3,7);
  const enemy = { pos:new THREE.Vector3(), eyeH:1.6 };
  const covered = new THREE.Vector3(0,0,15), exposed = new THREE.Vector3(30,0,0);
  assert.ok(spawnScore(covered,[enemy],[],world) > spawnScore(exposed,[enemy],[],world,6));
});

test('respawn rejects crowded and obstructed points even with favorable variation', () => {
  const world = new World(), safe = new THREE.Vector3(10,0,0), blocked = new THREE.Vector3();
  world.add(-1,0,-1,1,3,1);
  assert.ok(spawnScore(safe,[],[],world) > spawnScore(blocked,[],[],world,6));
  const friend = {pos:safe.clone()};
  assert.ok(spawnScore(new THREE.Vector3(20,0,0),[],[friend],world) > spawnScore(safe,[],[friend],world,6));
});

test('respawn strongly discourages nearby enemies even behind cover', () => {
  const world = new World(), enemy = {pos:new THREE.Vector3()};
  const near = new THREE.Vector3(2,0,0), far = new THREE.Vector3(25,0,0);
  assert.ok(spawnScore(far,[enemy],[],world) > spawnScore(near,[enemy],[],world,6));
});

test('camera comfort removes walking bob, roll, landing dip and sprint FOV changes', () => {
  const previous = profile.s.cameraMotion;
  try {
    profile.s.cameraMotion = 0;
    const p = player(); p.speed = 8; p.camBob = 1; p.roll = 0.05; p.landDip = 0.2; p.sprinting = true;
    p.applyCamera(p.game.R.camera,1/60);
    close(p.game.R.camera.position.x,p.pos.x); close(p.game.R.camera.position.y,p.pos.y+p.eyeH);
    close(p.game.R.camera.rotation.z,0); close(p.game.R.camera.fov,profile.s.fov);
    run(p,{ads:true},1); close(p.game.R.camera.fov,profile.s.fov*p.def.zoom);
  } finally { profile.s.cameraMotion = previous; }
});

test('menu clicks and scrolling cannot fire or swap weapons without mouse capture', () => {
  const listeners = new Map(); globalThis.addEventListener = (name,fn) => listeners.set(name,fn);
  globalThis.document = {addEventListener:noop,querySelector:()=>null};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{getGamepads:()=>[]}});
  const input = new Input(); listeners.get('mousedown')({button:0}); listeners.get('wheel')({deltaY:1});
  assert.equal(input.update().fire,false); assert.equal(input.update().swapP,false);
  input.locked = true; listeners.get('mousedown')({button:0}); listeners.get('wheel')({deltaY:1});
  assert.equal(input.update().fireP,true); assert.equal(input.update().swapP,true);
});

test('Tab remains available for native menu focus navigation', () => {
  const listeners = new Map(); globalThis.addEventListener = (name,fn) => listeners.set(name,fn);
  globalThis.document = {addEventListener:noop,querySelector:()=>({})};
  const input = new Input(); let prevented = false;
  listeners.get('keydown')({code:'Tab',preventDefault:()=>{prevented=true;}});
  assert.equal(prevented,false); assert.equal(input.keys.has('Tab'),false);
});

test('focused sliders keep native arrow adjustment and buttons keep Space activation', () => {
  const listeners = new Map(); globalThis.addEventListener = (name,fn) => listeners.set(name,fn);
  globalThis.document = {addEventListener:noop,querySelector:()=>({})};
  const input = new Input(); let prevented = false;
  for (const [code,selector] of [['ArrowRight','input[type=range]'],['Space','button']]) {
    listeners.get('keydown')({code,target:{matches:s=>s===selector},preventDefault:()=>{prevented=true;}});
    assert.equal(input.down.has(code),false);
  }
  assert.equal(prevented,false);
});

test('forward, backward, strafe and diagonal have equal speed', () => {
  const speeds = [{ly:1},{ly:-1},{lx:1},{lx:-1},{lx:1,ly:1}].map(a => run(player(),a,2).speed);
  for (const speed of speeds) close(speed, 5.4 * WEAPONS.vx4.move);
});
test('movement follows yaw and ignores vertical look angle', () => {
  const p = player(); p.yaw = Math.PI / 2; p.pitch = 1;
  run(p,{ly:1}); assert.ok(p.pos.x < -4); close(p.pos.z,0); close(p.pos.y,0);
});
test('analog movement preserves partial stick speed', () => {
  close(run(player(),{ly:0.3},2).speed, run(player(),{ly:1},2).speed * 0.3);
});
test('walking stops promptly without drift', () => {
  const p = run(player(),{ly:1}); run(p,{},1); assert.ok(p.speed < 0.001);
});
test('walk distance agrees at 30, 60, 120 and 144 FPS', () => {
  const distances = [30,60,120,144].map(fps => -run(player(),{ly:1},2,fps).pos.z);
  assert.ok(Math.max(...distances)-Math.min(...distances) < 0.025, String(distances));
});
test('ADS reaches its endpoint and reduces movement speed', () => {
  const p = run(player(),{ads:true,ly:1},2);
  close(p.adsT,1); close(p.speed,5.4 * p.def.move * 0.7,0.0001);
  run(p,{}); close(p.adsT,0);
});
test('crouch reduces body height and movement speed', () => {
  const p = player(); tick(p,{crouchP:true}); run(p,{ly:1},2);
  close(p.crouch,1); close(p.height,1.2); close(p.speed,5.4*p.def.move*0.5,0.0001);
});
test('sprint requires forward movement and cancels for ADS', () => {
  const p = run(player(),{ly:1,sprint:true},1); assert.equal(p.sprinting,true);
  close(p.speed,7.7*p.def.move,0.0001); tick(p,{ly:1,sprint:true,ads:true}); assert.equal(p.sprinting,false);
  for (const a of [{ly:-1,sprint:true},{lx:1,sprint:true},{}]) { tick(p,a); assert.equal(p.sprinting,false); }
});
test('tactical sprint double tap, exhaustion and recovery', () => {
  const p = player(); tick(p,{ly:1,sprint:true,sprintP:true}); tick(p,{ly:1,sprint:true}); tick(p,{ly:1,sprint:true,sprintP:true});
  assert.equal(p.tac,true); run(p,{ly:1,sprint:true},1); close(p.speed,9.7*p.def.move,0.0001);
  run(p,{ly:1,sprint:true},3); assert.equal(p.tac,false); assert.ok(p.tacCooldown > 0);
});
test('tactical sprint uses its longer fire recovery', () => {
  const p = player(); p.sprinting = p.tac = true; p.tacTime = 2;
  tick(p,{fire:true},1/60); assert.ok(p.sprintOutT > 0.15); assert.ok(p.tacCooldown > 4);
});
test('single semi-auto tap during sprint recovery still fires once', () => {
  const p = player('p17'); p.sprinting = true; let shots = 0; p.shoot = () => shots++;
  tick(p,{fire:true,fireP:true}); assert.equal(shots,0); run(p,{},0.5); assert.equal(shots,1);
});
test('controller sprint toggle and second click tactical sprint', () => {
  const p = player(); p.game.input.lastDevice = 'pad';
  tick(p,{ly:1,sprintP:true}); tick(p,{ly:1}); assert.equal(p.sprinting,true);
  tick(p,{ly:1,sprintP:true}); assert.equal(p.tac,true);
  tick(p,{ly:1,ads:true}); assert.equal(p.sprintToggle,false);
});
test('slide starts from sprint, expires into crouch and consumes tactical sprint', () => {
  const p = run(player(),{ly:1,sprint:true}); p.tac = true; p.tacTime = 2;
  tick(p,{ly:1,sprint:true,crouchP:true}); assert.ok(p.slideT > 0); assert.equal(p.sprinting,false);
  assert.ok(p.tacCooldown > 0); run(p,{},1); assert.equal(p.crouchWanted,true);
});
test('slide jump preserves forward momentum and ends slide', () => {
  const p = run(player(),{ly:1,sprint:true}); tick(p,{ly:1,sprint:true,crouchP:true}); tick(p,{ly:1,jumpP:true});
  assert.equal(p.slideT,0); assert.equal(p.grounded,false); assert.ok(p.vel.y > 0); assert.ok(p.speed > 8);
});
test('crouch press cancels slide into standing', () => {
  const p = run(player(),{ly:1,sprint:true}); tick(p,{ly:1,sprint:true,crouchP:true}); tick(p,{crouchP:true});
  assert.equal(p.slideT,0); assert.equal(p.crouchWanted,false);
});
test('standing jump has consistent apex and lands at all supported frame rates', () => {
  const heights = [30,60,120,144].map(fps => {
    const p = player(); tick(p,{jumpP:true},1/fps); let apex = p.pos.y;
    for(let i=0;i<fps;i++) { tick(p,{},1/fps); apex = Math.max(apex,p.pos.y); }
    assert.equal(p.grounded,true); close(p.pos.y,0); return apex;
  });
  assert.ok(Math.max(...heights)-Math.min(...heights)<0.02,String(heights));
});
test('no double jump and crouch jump first requests standing', () => {
  const p = player(); tick(p,{jumpP:true}); const vy = p.vel.y; tick(p,{jumpP:true}); assert.ok(p.vel.y < vy);
  const q = player(); tick(q,{crouchP:true}); run(q,{}); tick(q,{jumpP:true}); assert.equal(q.crouchWanted,false); assert.equal(q.grounded,true);
});
test('ceiling prevents standing, sprinting and jumping through it', () => {
  const p = player(); p.crouchWanted = true; p.crouch = 1;
  p.game.world.add(-3,1.3,-3,3,2,3);
  tick(p,{crouchP:true,ly:1,sprint:true}); close(p.crouch,1); assert.equal(p.sprinting,false);
  run(p,{},0.2); assert.ok(p.game.R.camera.position.y < 1.3);
  tick(p,{jumpP:true}); run(p,{},1); assert.ok(p.pos.y+p.height <= 1.301);
});
test('camera remains below collision height while crouching and sliding', () => {
  const p = player(); tick(p,{crouchP:true});
  for(let i=0;i<20;i++) { tick(p,{}); assert.ok(p.game.R.camera.position.y < p.pos.y+p.height); }
});
for (const state of ['swapT','reloadT','meleeT','nadeT']) {
  test(`slide cannot bypass ADS lock during ${state}`, () => {
    const p = player(); p.slideT = 0.5; p[state] = 0;
    tick(p,{ads:true}); close(p.adsT,0);
  });
}
test('ADS is allowed during a free slide but blocked during mantle', () => {
  const p = player(); p.slideT = 0.5; tick(p,{ads:true}); assert.ok(p.adsT > 0);
  p.adsT = 0; p.mantle = { t:0,dur:1,from:p.pos.clone(),to:new THREE.Vector3(0,1,-1) };
  tick(p,{ads:true}); close(p.adsT,0);
});
test('weapon action inputs interrupt sprint and ADS immediately', () => {
  for (const action of ['reloadP','meleeP','grenadeP','swapP']) {
    const p = player(); p.sprinting = true; p.adsT = 1; p.w.mag--;
    tick(p,{ly:1,sprint:true,ads:true,[action]:true}); assert.equal(p.sprinting,false); assert.ok(p.adsT < 1);
  }
});
test('mantle climbs a supported ledge without overlapping it', () => {
  const p = player(); p.game.world.add(-2,0,-3,2,1,-0.5);
  tick(p,{jumpP:true}); assert.ok(p.mantle);
  for(let i=0;i<40;i++) { tick(p,{}); assert.equal(p.game.world.overlaps(p.pos.x,p.pos.y+0.001,p.pos.z,0.34,p.height),null); }
  assert.equal(p.mantle,null); assert.equal(p.grounded,true); close(p.pos.y,1,0.015);
});
test('mantle refuses an obstructed route and unsupported landing', () => {
  const p = player(); p.game.world.add(-2,0,-3,2,1,-0.5); p.game.world.add(-2,2,-3,2,3,1);
  assert.equal(p.tryMantle(),false);
  const q = player(); q.game.world.add(-2,0,-0.7,2,1,-0.5); assert.equal(q.tryMantle(),false);
});
test('map boundaries remove outward momentum', () => {
  const p = player(); p.game.map.bounds.maxX = 1; run(p,{lx:1}); close(p.pos.x,0.5); close(p.vel.x,0);
});
test('stationary and fast rooftop contact stays grounded', () => {
  const w = new World(); w.add(-10,0,-10,10,2,10,'metal');
  for(const speed of [0,10]) {
    const pos = new THREE.Vector3(0,2,0), vel = new THREE.Vector3(speed,-1,0);
    const res = w.move(pos,vel,0.05,0.34,1.8,{grounded:true});
    assert.equal(res.grounded,true); assert.equal(res.surface,'metal'); close(pos.y,2);
  }
});
test('stairs step up and down; tall walls block and permit strafe', () => {
  const w = new World(); w.add(0.5,0,-2,2,0.3,2); const pos = new THREE.Vector3(), vel = new THREE.Vector3(4,-1,0);
  assert.equal(w.move(pos,vel,0.2,0.34,1.8,{grounded:true}).grounded,true); close(pos.y,0.3);
  pos.x = 2.5; vel.set(0,-0.1,0); assert.equal(w.move(pos,vel,0.02,0.34,1.8,{grounded:true}).grounded,true); close(pos.y,0);
  w.add(3,0,-3,4,4,3); vel.set(8,-1,3); w.move(pos,vel,0.2,0.34,1.8,{grounded:true}); assert.ok(pos.x < 2.661); assert.ok(pos.z > 0); close(vel.x,0);
});
test('ceiling collision stops ascent without treating ceiling as ground', () => {
  const w = new World(); w.add(-2,2,-2,2,3,2); const pos = new THREE.Vector3(), vel = new THREE.Vector3(0,7.2,0);
  const result = w.move(pos,vel,0.1,0.34,1.8); assert.equal(result.ceiling,true); assert.equal(result.grounded,false); assert.ok(pos.y+1.8 < 2);
});
test('shots use current mouse direction and position', () => {
  const p = player('longbow'); p.adsT = 1; p.pos.set(4,0,6); let shot;
  p.spreadDeg = () => 0; // isolate pose correctness from random weapon dispersion
  p.game.fireBullet = (who,origin,dir) => { shot = { origin:origin.clone(),dir:dir.clone() }; };
  tick(p,{mx:100,ads:true,fire:true,fireP:true}); assert.ok(shot);
  close(shot.dir.x,Math.sin(100 * 0.0021 * profile.s.adsSens * p.def.zoom - p.scopeSway.x) * Math.cos(p.scopeSway.y));
  assert.ok(shot.origin.distanceTo(p.pos) < 2);
});
test('scoped zoom transitions continuously through overlay threshold', () => {
  const p = player('longbow'); p.adsT = 0.849; p.game.R.camera.fov = 50; p.applyCamera(p.game.R.camera,1/120);
  const before = p.game.R.camera.fov; p.adsT = 0.851; p.applyCamera(p.game.R.camera,1/120);
  assert.ok(Math.abs(before-p.game.R.camera.fov) < 4);
});
test('respawn clears movement, view and weapon cycle state', () => {
  const p = player(); p.grounded = false; p.speed = 10; p.lookDX = 100; p.sprintToggle = true;
  p.w.needsCycle = true; p.w.nextFire = 999; p.w.burstLeft = 3;
  p.spawn(new THREE.Vector3(),0); assert.equal(p.grounded,true); close(p.speed,0); close(p.lookDX,0);
  assert.equal(p.sprintToggle,false); assert.equal(p.w.needsCycle,false); close(p.w.nextFire,0); close(p.w.burstLeft,0);
});
test('pause clears sprint and queued shot state', () => {
  const p = player(); p.sprinting = p.tac = p.sprintToggle = true; p.pendingFireUntil = 99;
  p.cancelInput(); assert.equal(p.sprinting,false); assert.equal(p.tac,false); assert.equal(p.sprintToggle,false); assert.ok(p.pendingFireUntil < 0);
});
test('mouse sensitivity decreases with ADS and pitch stays bounded', () => {
  const hip = player(), ads = player(); ads.adsT = 1;
  tick(hip,{mx:50,my:1e6}); tick(ads,{mx:50,ads:true}); assert.ok(Math.abs(ads.yaw)<Math.abs(hip.yaw)); assert.ok(Math.abs(hip.pitch)<=1.5);
});
test('controller look agrees across frame rates', () => {
  const yaws = [30,60,120,144].map(fps => run(player(),{padLookX:0.5},1,fps).yaw);
  for(const yaw of yaws) close(yaw,yaws[0]);
});
test('input focus loss clears held keys, clicks, deltas and action edges', () => {
  const listeners = new Map(); globalThis.addEventListener = (name,fn) => listeners.set(name,fn);
  globalThis.document = { pointerLockElement:null, addEventListener:(name,fn) => listeners.set(name,fn) };
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{getGamepads:()=>[]}});
  const input = new Input(); listeners.get('keydown')({code:'KeyW'}); listeners.get('mousedown')({button:2}); input.mouse.dx = 90;
  listeners.get('blur')(); const a = input.update(); close(a.ly,0); close(a.mx,0); assert.equal(a.ads,false); assert.equal(input.down.size,0);
});
test('gamepad disconnect and reconnect rebuilds button edges', () => {
  globalThis.addEventListener = noop; globalThis.document = {addEventListener:noop};
  const gp = {index:0,connected:true,mapping:'standard',axes:[0,-1,0,0],buttons:Array.from({length:18},()=>({pressed:false,value:0}))};
  gp.buttons[10].pressed = true; let pads = [gp];
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{getGamepads:()=>pads}});
  const input = new Input(); assert.equal(input.update().sprintP,true); assert.equal(input.update().sprintP,false);
  pads=[]; input.update(); assert.equal(input.padIndex,-1); pads=[gp]; assert.equal(input.update().sprintP,true);
});

for (const weapon of Object.keys(WEAPONS)) {
  test(`${weapon}: ADS, crouch aim, reload and sprint transitions`, () => {
    const p = player(weapon); run(p,{ads:true,ly:1}); close(p.adsT,1);
    tick(p,{ads:true,crouchP:true}); run(p,{ads:true},0.5); close(p.adsT,1); assert.ok(p.crouch > 0.99);
    tick(p,{ly:1,sprint:true}); assert.equal(p.sprinting,true); assert.ok(p.adsT < 1);
    p.w.mag--; tick(p,{reloadP:true}); assert.equal(p.sprinting,false);
    if (p.def.shellReload) { assert.ok(p.shellT >= 0); } else { assert.ok(p.reloadT >= 0); }
  });
}
test('falling from a high ledge deals damage and lands', () => {
  const p = player(); p.spawnTime = -99; p.pos.y = 10; p.grounded = false;
  run(p,{},1.5); assert.equal(p.grounded,true); close(p.pos.y,0); assert.ok(p.health < 100);
});
test('jumping onto a roof and walking off a tall edge behave correctly', () => {
  const w = new World(); w.add(-2,0,-2,2,2,2); const pos = new THREE.Vector3(0,3,0), vel = new THREE.Vector3(0,-8,0);
  assert.equal(w.move(pos,vel,0.2,0.34,1.8).grounded,true); close(pos.y,2);
  pos.x = 2.5; vel.set(0,-1,0); assert.equal(w.move(pos,vel,0.05,0.34,1.8,{grounded:true}).grounded,false); assert.ok(pos.y > 1.9);
});
test('controller deadzone suppresses drift and normalizes full diagonal', () => {
  globalThis.addEventListener = noop; globalThis.document = {addEventListener:noop};
  const gp = {index:0,connected:true,mapping:'standard',axes:[0.03,-0.02,0.05,0.05],buttons:[]};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{getGamepads:()=>[gp]}});
  const input = new Input(); let a = input.update(); close(a.lx,0); close(a.ly,0); close(a.padLookX,0);
  gp.axes = [1,-1,0,0]; a = input.update(); close(Math.hypot(a.lx,a.ly),1);
});
test('ADS sight stays centered through movement, look sway, slide and sprint recovery', async () => {
  const gradient = {addColorStop:noop};
  const context = new Proxy({createRadialGradient:()=>gradient,createLinearGradient:()=>gradient}, {get:(obj,key)=>obj[key] || noop});
  globalThis.document = {createElement:()=>({width:128,height:128,getContext:()=>context})};
  const {Viewmodel} = await import('../src/game/viewmodel.js');
  const p = player(); const vm = new Viewmodel({...p.game.R,vmFlashLight:{intensity:0}}); vm.setWeapon(p.def);
  vm.sprintT = vm.tacT = vm.slideT = 1;
  for (let i = 0; i < 60; i++) {
    vm.update({...p.vmState(1/60),ads:1,speed:1,sprint:false,tac:false,slide:true,lookX:50,lookY:30,dt:1/60});
    vm.root.updateMatrixWorld(true);
    const sight = vm.root.localToWorld(new THREE.Vector3(0,p.def.sightH,-0.02));
    close(sight.x,0); close(sight.y,0);
  }
});
test('recoil springs agree across frame rates and settle safely', async () => {
  const {Viewmodel} = await import('../src/game/viewmodel.js');
  const poses = [30,60,120,144].map(fps => {
    const p = player(); const vm = new Viewmodel({...p.game.R,vmFlashLight:{intensity:0}});
    vm.springs.kz.v = 2;
    for(let i=0;i<Math.round(fps*0.1);i++) vm.springs.kz.update(1/fps);
    return vm.springs.kz.x;
  });
  assert.ok(Math.max(...poses)-Math.min(...poses) < 0.003,String(poses));
});
test('mantle freezes stance and blocks melee, grenades and weapon swaps', () => {
  const p = player(); p.crouch = 1; p.crouchWanted = false;
  p.mantle = {t:0,dur:1,from:p.pos.clone(),to:new THREE.Vector3(0,1,-1)};
  tick(p,{meleeP:true,grenadeP:true,swapP:true,crouchP:true});
  close(p.crouch,1); assert.ok(p.meleeT < 0); assert.ok(p.nadeT < 0); assert.ok(p.swapT < 0);
});
test('slide keeps the direction of existing sprint momentum', () => {
  const p = player(); p.sprinting = true; p.vel.set(5,0,-5);
  tick(p,{ly:1,sprint:true,crouchP:true}); assert.ok(p.slideT > 0); assert.ok(p.vel.x > 6); assert.ok(p.vel.z < -6);
});
test('slide distance is consistent across frame rates', () => {
  const distances = [30,60,120,144].map(fps => {
    const p = player(); p.slideT = 0.8; p.vel.z = -10.5; run(p,{},0.5,fps); return -p.pos.z;
  });
  assert.ok(Math.max(...distances)-Math.min(...distances)<0.025,String(distances));
});

test('movement reaches near full speed within 50ms and stops within 50ms', () => {
  for (const fps of [60,120]) {
    const p = run(player(),{ly:1},0.05,fps);
    assert.ok(p.speed >= 5.4*p.def.move*0.94);
    run(p,{},0.05,fps); assert.ok(p.speed < 0.08);
  }
});
test('direction reversal responds within 50ms', () => {
  const p = run(player(),{lx:1}); run(p,{lx:-1},0.05,120);
  assert.ok(p.vel.x < -5.4*p.def.move*0.85);
});
test('carbine and SMG ADS finish within 150ms and 110ms', () => {
  const rifle = run(player('vx4'),{ads:true},0.15,120);
  const smg = run(player('kestrel'),{ads:true},0.11,120);
  close(rifle.adsT,1); close(smg.adsT,1);
});
test('ADS release lowers the carbine within 110ms', () => {
  const p = run(player(),{ads:true}); run(p,{},0.11,120); close(p.adsT,0);
});
test('camera zoom follows ADS without an extra smoothing delay', () => {
  const p = player();
  for(let i=0;i<12;i++) {
    tick(p,{ads:true}); close(p.game.R.camera.fov, profile.s.fov * (1 + (p.def.zoom-1)*p.adsT));
  }
});
test('ADS changes movement speed on the same input frame', () => {
  const hip = run(player(),{ly:1}), ads = run(player(),{ly:1});
  tick(hip,{ly:1}); tick(ads,{ly:1,ads:true});
  assert.ok(ads.speed < hip.speed - 0.05);
});


test('jump pressed just before landing is buffered into the next jump', () => {
  const p = player(); p.pos.y = 0.04; p.vel.y = -2; p.grounded = false;
  tick(p,{jumpP:true}); tick(p,{}); tick(p,{});
  assert.equal(p.grounded,false); assert.ok(p.vel.y > 6);
});
test('jump just after leaving a ledge succeeds but cannot double jump', () => {
  const p = player(); p.pos.y = 2; p.grounded = false; p.lastGroundedTime = p.game.time;
  tick(p,{jumpP:true}); assert.ok(p.vel.y > 6);
  const velocity = p.vel.y; tick(p,{jumpP:true}); assert.ok(p.vel.y < velocity);
});
test('jump forgiveness expires instead of allowing an air jump', () => {
  const p = player(); p.pos.y = 2; p.grounded = false; p.lastGroundedTime = p.game.time - 0.2;
  tick(p,{jumpP:true}); assert.ok(p.vel.y < 0);
});
test('jumping with no movement input preserves horizontal momentum', () => {
  const p = run(player(),{ly:1,sprint:true}); const speed = p.speed;
  tick(p,{jumpP:true}); run(p,{},0.25); close(p.speed,speed); assert.equal(p.grounded,false);
});
test('ADS removes locomotion bob without delaying mouse look', () => {
  const p = run(player(),{ly:1,ads:true}); p.camBob = 1;
  p.positionCamera(p.game.R.camera);
  close(p.game.R.camera.position.x,p.pos.x);
  close(p.game.R.camera.position.y,p.pos.y+p.eyeH-p.landDip);
  const yaw = p.yaw; tick(p,{ads:true,mx:10}); assert.notEqual(p.yaw,yaw);
});
test('stair presentation smooths camera without delaying collision step-up', () => {
  const p = player(); p.game.world.add(-2,0,-2,2,0.3,-0.45);
  let stepped = false;
  for(let i=0;i<30;i++) {
    const old = p.game.R.camera.position.y;
    tick(p,{ly:1});
    if(p.pos.y > 0.2 && p.stairOffset < -0.01) {
      assert.ok(p.game.R.camera.position.y-old < 0.15); stepped = true; break;
    }
  }
  assert.equal(stepped,true);
});
test('slide cancellation under a ceiling keeps a safe crouched body', () => {
  const p = player(); p.slideT = 0.4; p.crouch = 1.25;
  p.game.world.add(-3,1.2,-3,3,2,3);
  tick(p,{crouchP:true}); run(p,{},0.3);
  assert.equal(p.slideT,0); assert.ok(p.height < 1.2);
});
test('adaptive rendering responds to sustained load, stays bounded, and recovers slowly', async () => {
  const {PerformanceScale} = await import('../src/engine/performance-scale.js');
  const perf = new PerformanceScale();
  for(let i=0;i<900;i++) perf.update(1/30);
  close(perf.scale,0.7);
  for(let i=0;i<3600;i++) perf.update(1/120);
  close(perf.scale,1);
});
test('adaptive rendering ignores isolated hitches and paused frames', async () => {
  const {PerformanceScale} = await import('../src/engine/performance-scale.js');
  const perf = new PerformanceScale();
  for(let i=0;i<300;i++) perf.update(1/60);
  perf.update(0.08); perf.update(5);
  for(let i=0;i<300;i++) perf.update(1/60);
  close(perf.scale,1);
  for(let i=0;i<300;i++) perf.update(1/30,false);
  close(perf.scale,1);
});
test('unchanged HUD text and HTML are written only once', async () => {
  const {HUD} = await import('../src/ui/hud.js');
  const hud = Object.create(HUD.prototype); let htmlWrites = 0, textWrites = 0, html = '', text = '';
  const el = {get innerHTML(){return html;},set innerHTML(v){html=v;htmlWrites++;},get textContent(){return text;},set textContent(v){text=v;textWrites++;}};
  for(let i=0;i<120;i++) { hud.setHtml(el,'<span>2</span>'); hud.setText(el,30); }
  assert.equal(htmlWrites,1); assert.equal(textWrites,1);
  hud.setHtml(el,'<span>1</span>'); hud.setText(el,29); assert.equal(htmlWrites,2); assert.equal(textWrites,2);
});

test('inspection starts, completes, and cancels immediately for ADS or firing', () => {
  const p = player(); tick(p,{inspectP:true}); assert.ok(p.inspectT >= 0);
  tick(p,{ads:true}); assert.equal(p.inspectT,-1);
  run(p,{},0.3); tick(p,{inspectP:true}); assert.ok(p.inspectT >= 0);
  tick(p,{fire:true}); assert.equal(p.inspectT,-1);
  tick(p,{inspectP:true}); run(p,{},2); assert.equal(p.inspectT,-1);
});
test('inspection is blocked while reloading or sprinting', () => {
  const p = player(); p.w.mag--; tick(p,{reloadP:true}); tick(p,{inspectP:true}); assert.equal(p.inspectT,-1);
  const q = run(player(),{ly:1,sprint:true}); tick(q,{ly:1,sprint:true,inspectP:true}); assert.equal(q.inspectT,-1);
});
test('sprint cancellation before magazine insertion preserves ammo', () => {
  const p = player(); p.w.mag = 8; const reserve = p.w.reserve;
  tick(p,{reloadP:true}); run(p,{},0.3); tick(p,{ly:1,sprint:true});
  assert.equal(p.reloadT,-1); assert.equal(p.sprinting,true); assert.equal(p.w.mag,8); assert.equal(p.w.reserve,reserve);
});
test('sprint cancellation after magazine insertion keeps transferred ammo exactly once', () => {
  const p = player(); p.w.mag = 8; const reserve = p.w.reserve;
  tick(p,{reloadP:true}); run(p,{},1.3); assert.equal(p.w.mag,p.def.mag);
  tick(p,{ly:1,sprint:true}); run(p,{ly:1,sprint:true},0.3);
  assert.equal(p.reloadT,-1); assert.equal(p.w.reserve,reserve-(p.def.mag-8));
});
test('empty reload waits for the chambering stage before granting ammo', () => {
  const p = player(); p.w.mag = 0; const reserve = p.w.reserve;
  tick(p,{reloadP:true}); run(p,{},1.8); assert.equal(p.w.mag,0);
  run(p,{},0.3); assert.equal(p.w.mag,p.def.mag); assert.equal(p.w.reserve,reserve-p.def.mag);
});
test('support hand and magazine remain finite throughout reload choreography', async () => {
  const {Viewmodel} = await import('../src/game/viewmodel.js'); const p = player();
  const vm = new Viewmodel({...p.game.R,vmFlashLight:{intensity:0}}); vm.setWeapon(p.def);
  for(let i=0;i<=120;i++) {
    vm.update({...p.vmState(1/120),reload:i/120,dt:1/120});
    for(const vector of [vm.info.mag.position,vm.arms.L.hand.position,vm.root.position]) assert.ok(vector.toArray().every(Number.isFinite));
  }
});
test('textured carbine asset has PBR maps, separate moving parts, and plausible bounds', async () => {
  const {readFile} = await import('node:fs/promises');
  const meta=JSON.parse(await readFile(new URL('../public/assets/models/guns/meta.json',import.meta.url),'utf8')).vx4;
  const data=await readFile(new URL('../public/assets/models/guns/'+meta.file,import.meta.url));
  assert.equal(data.readUInt32LE(0),0x46546c67);
  const len=data.readUInt32LE(12); const gltf=JSON.parse(data.subarray(20,20+len).toString());
  const names=gltf.nodes.map(node=>node.name);
  assert.ok(names.includes('Magazine')); assert.ok(names.includes('Charging Handle'));
  const material=gltf.materials[0]; assert.ok(material.pbrMetallicRoughness.baseColorTexture);
  assert.ok(material.pbrMetallicRoughness.metallicRoughnessTexture); assert.ok(material.normalTexture);
  assert.ok(meta.max[0]-meta.min[0]<0.2,JSON.stringify(meta));
  assert.ok(meta.max[2]-meta.min[2]<1.1,JSON.stringify(meta));
  assert.equal(meta.license,'CC0');
});

test('detailed maps preserve safe spawns and walkable objectives with bounded draw calls', async () => {
  const {buildMap} = await import('../src/game/map.js');
  const materials = new Map();
  const mats = new Proxy({}, {get:(_,key)=>{
    if(!materials.has(key)) materials.set(key,new THREE.MeshStandardMaterial());
    return materials.get(key);
  }});
  const context = new Proxy({}, {get:()=>noop,set:()=>true});
  globalThis.document = {createElement:()=>({width:0,height:0,getContext:()=>context})};
  for(const id of ['dockyard','outpost']) {
    const world = new World(); const map = buildMap(id,{mats},world);
    for(const side of ['A','B','ffa']) {
      assert.ok(map.spawns[side].length>=8,`${id} ${side} spawns`);
      for(const p of map.spawns[side]) assert.equal(world.overlaps(p.x,0.05,p.z,0.6,1.8),null);
    }
    for(const f of map.flags) assert.ok(map.nav.walkableAt(f.pos.x,f.pos.z),`${id} flag ${f.name}`);
    assert.ok(map.hardpoints.length>=3);
    for(const p of map.hardpoints) assert.ok(map.nav.walkableAt(p.x,p.z));
    assert.ok(map.bounds.maxX-map.bounds.minX>=220,'replacement map has a larger playable area');
    // All spawn groups, objectives and shops must belong to one navigable region.
    const nav=map.nav, visited=new Uint8Array(nav.block.length), queue=[nav.idx(0,0)];visited[queue[0]]=1;
    for(let head=0;head<queue.length;head++) {
      const i=queue[head],x=i%nav.w,z=Math.floor(i/nav.w);
      for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx=x+dx,nz=z+dz,j=nx+nz*nav.w;
        if(nx>=0 && nx<nav.w && nz>=0 && nz<nav.h && !visited[j] && !nav.block[j]) {visited[j]=1;queue.push(j);}
      }
    }
    for(const p of [...map.spawns.A,...map.spawns.B,...map.spawns.ffa,...map.hardpoints])
      assert.ok(visited[nav.idx(p.x,p.z)],`${id}: unreachable play location ${p.x},${p.z}`);
    for(const shop of map.buyStations) {
      const access=nav.nearestWalkable(shop.pos.x,shop.pos.z,2);
      assert.ok(access>=0 && visited[access],`${id}: unreachable buy station`);
      assert.ok(nav.center(access).distanceTo(shop.pos)<2.3,'shop can be reached within interaction range');
    }
    assert.ok(map.group.children.filter(m=>m.material?.map?.isCanvasTexture).length>=4);
    assert.ok(map.group.children.length<100,`${id} static geometry remains batched`);
    for(const mesh of map.group.children) {
      const pos=mesh.geometry?.attributes.position;
      if(pos) assert.ok(pos.array.every(Number.isFinite));
    }
  }
});


test('legacy loadouts migrate to five independent saved classes and preserve custom names', async()=>{
  const {normalizeClasses}=await import('../src/core/loadouts.js');
  const data={level:10,loadout:{primary:'kestrel',secondary:'hellcat',perks:['scavenger','flak','steady']}};
  normalizeClasses(data); assert.equal(data.classes.length,5); assert.equal(data.loadout.primary,'kestrel');
  data.classes[1].loadout.perks[0]='marathon'; assert.equal(data.classes[0].loadout.perks[0],'scavenger');
  data.classes[1].name='MY CLASS'; data.activeClass=1; normalizeClasses(data);
  assert.equal(data.loadout.perks[0],'marathon'); assert.equal(data.classes[1].name,'MY CLASS');
  data.classes[1].loadout.primary='missing'; data.classes[1].loadout.perks=['missing']; normalizeClasses(data);
  assert.equal(data.loadout.primary,'vx4'); assert.deepEqual(data.loadout.perks,['lightweight','fasthands','quickfix']);
});
test('new ammunition and grenade perks apply on spawn without stacking across respawns',()=>{
  const p=player(); p.perks=new Set(['reserves','grenadier']);
  for(let i=0;i<3;i++) {p.spawn(new THREE.Vector3(),0);assert.equal(p.w.reserve,Math.round(p.def.reserve*1.5));assert.equal(p.grenades,3);}
  p.game.mode.id='gun'; p.spawn(new THREE.Vector3(),0); assert.equal(p.grenades,0);
});
test('marathon extends tactical sprint and shortens recovery',()=>{
  const p=player(); p.perks=new Set(['marathon']); tick(p,{ly:1,sprint:true,sprintP:true});run(p,{ly:1,sprint:true},0.1);tick(p,{ly:1,sprint:true,sprintP:true});
  assert.ok(p.tacTime>5);run(p,{ly:1,sprint:true},4);assert.equal(p.tac,true);
  tick(p,{ads:true});assert.ok(p.tacCooldown<=3 && p.tacCooldown>2.9);
});
test('stalker increases ADS strafe speed by fifteen percent without altering walking',()=>{
  const base=player(),p=player(); p.perks=new Set(['stalker']);
  run(base,{lx:1,ads:true});run(p,{lx:1,ads:true});close(p.speed/base.speed,1.15,0.005);
  const q=player(),r=player();r.perks=new Set(['stalker']);run(q,{lx:1});run(r,{lx:1});close(q.speed,r.speed);
});
test('mountaineer reduces fall damage and speeds up a safe mantle',()=>{
  const base=player(),p=player();p.perks=new Set(['mountaineer']);base.damage(40,null,null,'fall');p.damage(40,null,null,'fall');assert.equal(p.health,80);assert.equal(base.health,60);
  for(const actor of [base,p]) actor.game.world.add(-2,0,-2,2,1,-0.5);
  assert.equal(base.tryMantle(),true);assert.equal(p.tryMantle(),true);close(p.mantle.dur/base.mantle.dur,0.75);
});
test('focus reduces damage shake without reducing bullet damage',()=>{
  const base=player(),p=player();base.spawnTime=p.spawnTime=0;p.perks=new Set(['focus']);let normal=0,reduced=0;
  base.game.shake=v=>normal=v;p.game.shake=v=>reduced=v;base.damage(25,null,null,'bullet');p.damage(25,null,null,'bullet');
  assert.equal(base.health,p.health);close(reduced/normal,0.4);
});
test('deploy selection updates preview and briefing, and class selection restores its saved weapons',async()=>{
  const {Menu}=await import('../src/ui/menu.js'); const previews=[];
  const app={previewMap:id=>previews.push(id),game:{running:false},armory:{image:()=>''}};
  const menu=new Menu(app),play=menu.playScreen();let def=play.build();assert.ok(def.panel.includes('PINE RIDGE'));
  def.rows[1].setIndex(1);def=play.build();assert.equal(previews.at(-1),'outpost');assert.ok(def.panel.includes('TIMBER CAMP'));
  const old=profile.data;try {
    profile.reset();const screen=menu.loadoutScreen();def=screen.build();def.rows[0].setIndex(1);def=screen.build();def.rows[1].setIndex(1);
    const changed=profile.data.loadout.primary;def.rows[0].setIndex(0);assert.equal(profile.data.loadout.primary,'vx4');
    def=screen.build();def.rows[0].setIndex(1);assert.equal(profile.data.loadout.primary,changed);
    assert.equal(def.rows.length,9); // class, primary, primary camo, secondary, secondary camo, 3 perks, back
  } finally {profile.data=old;}
});



test('class changes leave the current life intact and apply on the next player spawn',async()=>{
  const {Game}=await import('../src/game/game.js');const p=player(),g=p.game;
  const old=profile.data.loadout;try {
    profile.data.loadout={primary:'kestrel',secondary:'p17',perks:['marathon','reserves','stalker']};
    assert.equal(p.def.id,'vx4');assert.equal(p.perks.has('marathon'),false);
    g.map.spawns={A:[new THREE.Vector3()],ffa:[new THREE.Vector3()]};g.actors=[p];g.mode={id:'tdm',teams:true};g.ffa=false;g.playerLoadout=Game.prototype.playerLoadout;
    Game.prototype.spawnActor.call(g,p,true);
    assert.equal(p.def.id,'kestrel');assert.equal(p.perks.has('marathon'),true);assert.equal(p.w.reserve,Math.round(p.def.reserve*1.5));
  } finally {profile.data.loadout=old;}
});
test('typing a class name does not create movement or menu key presses',()=>{
  const listeners=new Map();globalThis.addEventListener=(name,fn)=>listeners.set(name,fn);
  globalThis.document={addEventListener:noop};const input=new Input();let prevented=false;
  listeners.get('keydown')({code:'Space',target:{matches:()=>true},preventDefault:()=>{prevented=true;}});
  assert.equal(input.keys.size,0);assert.equal(input.down.size,0);assert.equal(prevented,false);
  globalThis.addEventListener=noop;
});


test('streak ladder repeats without death and banks every earned reward',async()=>{
  const {createRewards,earnRewards,consumeReward}=await import('../src/game/streak-rewards.js');
  const {STREAKS}=await import('../src/game/streaks.js');const rewards=createRewards(STREAKS);
  for(let kills=1;kills<=21;kills++) earnRewards(rewards,kills);
  assert.deepEqual(rewards.map(r=>r.charges),[3,3,3]);
  assert.equal(consumeReward(rewards[0]),true);assert.equal(rewards[0].charges,2);assert.equal(rewards[0].ready,true);
  consumeReward(rewards[0]);consumeReward(rewards[0]);assert.equal(rewards[0].ready,false);assert.equal(consumeReward(rewards[0]),false);
  earnRewards(rewards,24);assert.equal(rewards[0].charges,1);assert.equal(rewards[0].ready,true);
  earnRewards(rewards,24);assert.equal(rewards[0].charges,1);
});
test('death resets earning progress but preserves unused rewards',async()=>{
  const {createRewards,earnRewards}=await import('../src/game/streak-rewards.js');
  const {STREAKS}=await import('../src/game/streaks.js');const {Game}=await import('../src/game/game.js');
  const p=player(),g=p.game;g.playerStreaks=createRewards(STREAKS);earnRewards(g.playerStreaks,7);
  g.stats.deaths=0;g.hud.showDeath=noop;g.hud.killfeed=noop;g.vm.setVisible=noop;g.checkWin=noop;g.mode={id:'tdm'};
  Game.prototype.onKill.call(g,null,p,{cause:'fall'});
  assert.deepEqual(g.playerStreaks.map(r=>r.charges),[1,1,1]);assert.deepEqual(g.playerStreaks.map(r=>r.nextAt),[3,5,7]);
  assert.ok(g.playerStreaks.every(r=>r.ready));
  earnRewards(g.playerStreaks,3);assert.equal(g.playerStreaks[0].charges,2);
});
test('calling a banked UAV consumes one charge and can be repeated while alive',async()=>{
  const {createRewards,earnRewards}=await import('../src/game/streak-rewards.js');
  const {STREAKS}=await import('../src/game/streaks.js');const {Game}=await import('../src/game/game.js');
  const p=player(),g=p.game;g.playerStreaks=createRewards(STREAKS);earnRewards(g.playerStreaks,10);
  let calls=0,used=0;g.streaks={callUAV:()=>calls++};g.session={event:id=>{if(id==='streakUsed')used++;}};Game.prototype.useStreak.call(g,0);Game.prototype.useStreak.call(g,0);Game.prototype.useStreak.call(g,0);
  assert.equal(calls,2);assert.equal(used,2);assert.equal(g.playerStreaks[0].charges,0);assert.equal(g.playerStreaks[0].ready,false);
  earnRewards(g.playerStreaks,17);p.alive=false;Game.prototype.useStreak.call(g,0);assert.equal(calls,2);assert.equal(g.playerStreaks[0].charges,1);
});
test('health bar values clamp, handle death, and scale to survival health',async()=>{
  const {healthState}=await import('../src/ui/health-bars.js');
  assert.deepEqual(healthState({alive:true,health:150,maxHealth:200}),{value:150,max:200,ratio:0.75,low:false});
  assert.equal(healthState({alive:true,health:25,maxHealth:100}).low,true);
  assert.equal(healthState({alive:false,health:100,maxHealth:100}).ratio,0);
  assert.equal(healthState({alive:true,health:-20,maxHealth:100}).value,0);
  assert.equal(healthState({alive:true,health:500,maxHealth:100}).ratio,1);
});
test('operator health markers hide behind cover, offscreen, on death and in killcams; nodes are reused',async()=>{
  const {HealthBars}=await import('../src/ui/health-bars.js');
  const element=()=>({style:{},textContent:'',hidden:false,classList:{toggle:noop},setAttribute:noop,remove(){this.removed=true;},querySelector(selector){return this.refs[selector];},refs:{}});
  const previous=document;globalThis.document={createElement:()=>{const el=element();for(const selector of ['.health-fill','.actor-name','.actor-value']) el.refs[selector]=element();return el;}};
  try {
    const root={children:[],appendChild(el){this.children.push(el);},replaceChildren(){this.children=[];}},own=element();own.refs['.health-fill']=element();own.refs['.health-value']=element();
    const bars=new HealthBars(root,own),p=player(),bot=player();bot.id=999;bot.name='TARGET';bot.team='B';bot.pos.set(0,0,-10);
    const g=p.game;g.R.camera.position.set(0,1.62,0);g.R.camera.updateMatrixWorld();g.actors=[p,bot];g.killcam={active:false};
    bars.update(g,1280,720);const marker=bars.bars.get(999);assert.equal(marker.el.hidden,false);assert.equal(marker.value.textContent,'100');
    bot.health=25;bars.update(g,1280,720);assert.equal(root.children.length,1);assert.equal(marker.fill.style.transform,'scaleX(0.25)');
    g.world.add(-2,0,-6,2,4,-5);bars.update(g,1280,720);assert.equal(marker.el.hidden,true);
    g.world.clear();bot.pos.z=10;bars.update(g,1280,720);assert.equal(marker.el.hidden,true);
    bot.pos.z=-10;g.killcam.active=true;bars.update(g,1280,720);assert.equal(marker.el.hidden,true);
    g.killcam.active=false;bot.alive=false;bars.update(g,1280,720);assert.equal(marker.el.hidden,true);
    g.actors=[p];bars.update(g,1280,720);assert.equal(bars.bars.size,0);assert.equal(marker.el.removed,true);
  } finally {globalThis.document=previous;}
});


test('calling another UAV extends its flight and radar without duplicate planes',async()=>{
  const {StreakSystem}=await import('../src/game/streaks.js');const p=player(),g=p.game;
  g.R.scene=new THREE.Scene();g.hud.toast=noop;const system=new StreakSystem(g);
  system.callUAV(p);system.callUAV(p);
  assert.equal(system.uavUntil[p.team],g.time+60);assert.equal(system.uavPlanes.length,1);assert.equal(system.uavPlanes[0].until,g.time+60);
  g.time+=31;system.update(0.016);assert.equal(system.uavPlanes.length,1);assert.equal(system.uavActive(p.team),true);
  g.time+=30;system.update(0.016);assert.equal(system.uavPlanes.length,0);assert.equal(system.uavActive(p.team),false);
});


test('combat display follows actual reload progress and clears immediately when sprint cancels',async()=>{
  const {combatDisplay}=await import('../src/ui/combat-display.js');const p=player();p.w.mag=10;
  tick(p,{reloadP:true});run(p,{},0.95);let display=combatDisplay(p);
  assert.equal(display.label,'RELOADING');assert.ok(display.progress>0.4 && display.progress<0.6);close(display.ammo,1/3);
  tick(p,{ly:1,sprint:true});display=combatDisplay(p);assert.equal(display.progress,-1);assert.equal(display.action,'ready');
  p.reloadT=0.85;p.reloadEmpty=true;assert.equal(combatDisplay(p).label,'CHAMBERING');
});
test('tactical meter shows drain, perk-adjusted recharge, readiness and death',async()=>{
  const {combatDisplay}=await import('../src/ui/combat-display.js');const p=player();p.tac=true;p.tacTime=1.8;
  close(combatDisplay(p).sprint,0.5);assert.equal(combatDisplay(p).sprintLabel,'ACTIVE');
  p.tac=false;p.tacCooldown=2.5;close(combatDisplay(p).sprint,0.5);assert.equal(combatDisplay(p).sprintLabel,'RECHARGING');
  p.perks=new Set(['marathon']);p.tacCooldown=1.5;close(combatDisplay(p).sprint,0.5);
  p.tac=true;p.tacTime=2.7;close(combatDisplay(p).sprint,0.5);
  p.tac=false;p.tacCooldown=0;assert.equal(combatDisplay(p).sprintLabel,'READY');
  p.alive=false;assert.equal(combatDisplay(p).sprint,0);assert.equal(combatDisplay(p).sprintLabel,'OFFLINE');
});
test('action display handles shell loading, cycling and empty ammo safely',async()=>{
  const {combatDisplay}=await import('../src/ui/combat-display.js');const p=player('ranger');p.shellT=0.4;
  assert.equal(combatDisplay(p).label,'LOADING SHELL');p.shellT=-1;p.cycleT=0.2;assert.equal(combatDisplay(p).action,'cycle');
  p.cycleT=-1;p.w.mag=0;p.w.reserve=0;assert.equal(combatDisplay(p).label,'OUT OF AMMO');assert.equal(combatDisplay(p).ammo,0);
});
test('elimination ribbon groups rapid kills, distinguishes headshots and uses safe text insertion',async()=>{
  const {HUD}=await import('../src/ui/hud.js');const previous=document;
  const elements=new Map();globalThis.document={getElementById:id=>{if(!elements.has(id)) elements.set(id,{textContent:'',classList:{add:noop}});return elements.get(id);}};
  try {
    const hud=Object.create(HUD.prototype);hud.lastElim=-Infinity;hud.elimChain=0;
    hud.elimination('<operator>',false,10);assert.equal(elements.get('elim-name').textContent,'<operator>');assert.equal(hud.elimChain,1);
    hud.elimination('Second',true,12);assert.equal(elements.get('elim-label').textContent,'HEADSHOT ELIMINATION');assert.equal(elements.get('elim-chain').textContent,'×2');
    hud.elimination('Third',false,20);assert.equal(hud.elimChain,1);assert.equal(elements.get('elim-chain').textContent,'');
  } finally {globalThis.document=previous;}
});

