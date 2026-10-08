import test from 'node:test';
import assert from 'node:assert/strict';
import { Input, PAD, controllerType } from '../src/engine/input.js';
import path from 'node:path';
import assets from '../electron/assets.cjs';

function pad(id, index = 0) {
  return { id, index, connected:true, mapping:'standard', axes:[0,0,0,0], buttons:Array.from({length:18},()=>({pressed:false,value:0})) };
}
function setup(initial) {
  globalThis.addEventListener = ()=>{};
  globalThis.document = {addEventListener:()=>{},querySelector:()=>null};
  let pads = initial;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{getGamepads:()=>pads}});
  const input = new Input();
  return { input, setPads: next=>{pads=next;} };
}

test('Xbox Wireless Controller is never mistaken for a PlayStation controller', () => {
  for (const id of ['Xbox Wireless Controller','Xbox One Controller (Vendor: 045e)','XInput STANDARD GAMEPAD']) assert.equal(controllerType(id),'xbox');
  for (const id of ['DualSense Wireless Controller','DualShock 4','Wireless Controller (Vendor: 054c)','PlayStation Controller']) assert.equal(controllerType(id),'ps');
});

test('haptics stop on suspension and unsupported or disconnected actuators fail safely', () => {
  const {input} = setup([]);
  input.lastDevice = 'pad'; let resets = 0;
  input.gamepad = {vibrationActuator:{playEffect:()=>{},reset:()=>{resets++;}}};
  input.rumble(); input.stopRumble(); assert.equal(resets,1);
  input.gamepad.vibrationActuator.playEffect = () => {throw Error('disconnected');};
  input.gamepad.vibrationActuator.reset = () => {throw Error('disconnected');};
  assert.doesNotThrow(()=>input.rumble()); assert.doesNotThrow(()=>input.stopRumble());
});

for (const id of ['Xbox Wireless Controller', 'DualSense Wireless Controller']) {
  test(`${id}: mapped actions cover combat, menus, objectives and streaks`, () => {
    const gp = pad(id), {input} = setup([gp]);
    for (const [button, action] of [[PAD.RT,'fireP'],[PAD.LT,'adsP'],[PAD.A,'jumpP'],[PAD.B,'crouchP'],[PAD.X,'reloadP'],[PAD.Y,'swapP'],[PAD.RB,'grenadeP'],[PAD.RS,'meleeP'],[PAD.START,'pauseP'],[PAD.BACK,'score']]) {
      gp.buttons[button].pressed = true; assert.equal(input.update()[action],true,action);
      gp.buttons[button].pressed = false; input.update();
    }
    gp.buttons[PAD.X].pressed = true; assert.equal(input.update().interact,true);
    gp.buttons[PAD.X].pressed = false; input.update();
    for (const [i,button] of [PAD.LEFT,PAD.UP,PAD.RIGHT].entries()) {
      gp.buttons[button].pressed = true; assert.equal(input.update().streakP[i],true);
      gp.buttons[button].pressed = false; input.update();
    }
    gp.buttons[PAD.A].pressed = true; assert.equal(input.update().menuOk,true);
    gp.buttons[PAD.B].pressed = true; assert.equal(input.update().menuBack,true);
    assert.equal(input.padLabel(PAD.A),id.startsWith('Xbox')?'A':'✕');
  });
}

test('controller loss clears every held combat action and reports loss once', () => {
  const gp = pad('Xbox Wireless Controller'), {input,setPads} = setup([gp]);
  gp.axes[1] = -1; gp.buttons[PAD.RT].pressed = gp.buttons[PAD.LT].pressed = true;
  assert.equal(input.update().fire,true);
  setPads([]); const lost = input.update();
  assert.equal(lost.controllerLost,true); assert.equal(lost.fire,false); assert.equal(lost.ads,false); assert.equal(lost.ly,0);
  assert.equal(input.update().controllerLost,false);
  setPads([gp]); assert.equal(input.update().fireP,true);
});

test('switching connected controllers updates glyphs and rebuilds action edges without reporting disconnection', () => {
  const xbox = pad('Xbox Wireless Controller'), ps = pad('DualSense Wireless Controller',1), {input} = setup([xbox,ps]);
  xbox.buttons[PAD.A].pressed = true; assert.equal(input.update().jumpP,true);
  xbox.buttons[PAD.A].pressed = false; ps.buttons[PAD.A].pressed = true;
  const a = input.update(); assert.equal(input.padType,'ps'); assert.equal(a.jumpP,true); assert.equal(a.controllerLost,false);
});

test('replacement at the same controller index updates identity and edges', () => {
  const xbox = pad('Xbox Wireless Controller'), {input,setPads} = setup([xbox]);
  xbox.buttons[PAD.X].pressed = true; input.update();
  const ps = pad('DualSense Wireless Controller'); ps.buttons[PAD.X].pressed = true;
  setPads([ps]); const a = input.update(); assert.equal(a.controllerLost,true); assert.equal(a.reloadP,true); assert.equal(input.padType,'ps');
});

test('adjustable radial deadzone removes drift while preserving usable stick range', () => {
  const gp = pad('Xbox'), {input} = setup([gp]); input.deadzone = 0.2;
  gp.axes[0] = 0.19; gp.axes[2] = -0.19;
  assert.equal(input.update().lx,0); assert.equal(input.update().padLookX,0);
  gp.axes[0] = 0.6; assert.ok(Math.abs(input.update().lx-0.5)<1e-8);
  gp.axes[0] = 1; assert.equal(input.update().lx,1);
});

test('held menu direction repeats after 350ms at bounded intervals and resets on release', () => {
  const gp = pad('Xbox'), {input} = setup([gp]); gp.axes[1] = 1;
  assert.equal(input.update(0).menuDown,true); assert.equal(input.update(200).menuDown,false);
  assert.equal(input.update(350).menuDown,true); assert.equal(input.update(400).menuDown,false);
  assert.equal(input.update(450).menuDown,true); gp.axes[1]=0; input.update(500);
  gp.axes[1]=1; assert.equal(input.update(550).menuDown,true);
});

test('manual prompt preference overrides automatic controller detection', () => {
  const gp = pad('Generic Gamepad'), {input} = setup([gp]); input.promptStyle='ps'; input.update();
  assert.equal(input.padLabel(PAD.A),'✕'); input.promptStyle='xbox'; input._detectPad(gp); assert.equal(input.padLabel(PAD.A),'A');
});

test('nonstandard controller mappings are not guessed as standard combat buttons', () => {
  const gp = pad('Raw HID'); gp.mapping=''; gp.buttons[0].pressed=true;
  const {input} = setup([gp]); assert.equal(input.update().fire,false); assert.equal(input.gamepad,null);
});

test('packaged asset requests resolve only within the game folder', () => {
  const root = path.resolve('dist');
  assert.equal(assets.resolveGameAsset(root,'app://game/index.html'),path.join(root,'index.html'));
  assert.equal(assets.resolveGameAsset(root,'app://game/assets/font%20name.ttf'),path.join(root,'assets','font name.ttf'));
  for (const url of ['app://other/index.html','https://game/index.html','app://game/%2e%2e%2fdist-sibling/file','app://game/%2e%2e%5csecret','app://game/%00file','app://game/%invalid']) assert.equal(assets.resolveGameAsset(root,url),null,url);
});
