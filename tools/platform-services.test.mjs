import test from 'node:test';
import assert from 'node:assert/strict';
import { Platform } from '../src/core/platform.js';
import { Profile } from '../src/core/save.js';

test('platform save writes remain ordered and preserve the newest snapshot during a slow write', async () => {
  let release;
  const writes = [];
  const p = new Platform({ storage: { write: async (key, value) => {
    writes.push(value);
    if (value === 'first') await new Promise(r => { release = r; });
  } } });
  const first = p.save('profile', 'first');
  await Promise.resolve();
  p.save('profile', 'second'); p.save('profile', 'latest');
  release(); await first; await p.flush();
  assert.deepEqual(writes, ['first', 'latest']);
  assert.equal(p.pending.size, 0);
});

test('failed storage retains the newest save and reports failure; retry recovers it', async () => {
  let fail = true;
  const events = [], writes = [];
  const p = new Platform({ storage: { write: async (key, value) => {
    if (fail) throw new Error('disk full'); writes.push(value);
  } } });
  p.onEvent(e => events.push(e.type));
  assert.equal(await p.save('profile', 'progress'), false);
  assert.equal(p.pending.get('profile'), 'progress');
  assert.deepEqual(events, ['save-error']);
  fail = false;
  assert.equal(await p.flush(), true);
  assert.deepEqual(writes, ['progress']); assert.equal(p.saveError, null);
});

test('unavailable or failed console reads never fall back to another local profile', async () => {
  const env = {localStorage:{getItem:()=> 'wrong-user'}};
  assert.equal(new Platform({target:'xbox'},env).loadSync('profile'),null);
  await assert.rejects(new Platform({target:'xbox'},env).load('profile'),/not connected/);
  await assert.rejects(new Platform({storage:{read:async()=>{throw Error('offline');},write:()=>{}}},env).load('profile'),/offline/);
});

test('desktop storage works without a host and rejects unavailable storage', async () => {
  const data = new Map();
  const p = new Platform(null,{localStorage:{getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)}});
  await p.save('p','one'); await p.save('p','two');
  p.save('p','unload'); assert.equal(data.get('p'),'unload');
  assert.equal(await p.load('p'),'unload');
  assert.equal(await new Platform(null,{}).save('p','data'),false);
});

test('console host supplies owned controllers and console menus omit desktop actions', () => {
  const owned = [{id:'DualSense',mapping:'standard'}];
  let fullscreen = false, quit = false;
  const env = {window:{native:{setFullscreen:()=>{fullscreen=true;},quit:()=>{quit=true;}}},navigator:{getGamepads:()=>['other-user']}};
  for (const target of ['xbox','playstation']) {
    const p = new Platform({target,getGamepads:()=>owned},env);
    assert.equal(p.console,true); assert.equal(p.canQuit,false); assert.equal(p.canFullscreen,false);
    assert.equal(p.gamepads(),owned); p.fullscreen(true); p.quit();
  }
  assert.equal(fullscreen,false); assert.equal(quit,false);
  const desktop = new Platform(null,env); desktop.fullscreen(true); desktop.quit();
  assert.equal(fullscreen,true); assert.equal(quit,true);
});

test('host suspend events reach the game and achievement failures do not discard local progress', async () => {
  let notify;
  const p = new Platform({onEvent:f=>{notify=f;},unlockAchievement:async()=>{throw Error('offline');}});
  const seen = []; const remove = p.onEvent(e=>seen.push(e.type)); p.connect();
  notify({type:'suspend'}); notify({type:'user-change'});
  assert.deepEqual(seen,['suspend','user-change']); remove(); notify({type:'resume'});
  assert.equal(seen.length,2); await p.achievement('FIRST_BLOOD');
});

test('console profile waits for the signed-in save and preserves progression while adding console defaults', async () => {
  const writes = [], achievements = [];
  const p = new Platform({target:'playstation',getGamepads:()=>[],onEvent:()=>{},
    storage:{read:async()=>JSON.stringify({level:12,xp:42,achievements:{FIRST_BLOOD:123}}),write:async(k,v)=>writes.push(JSON.parse(v))},
    unlockAchievement:id=>achievements.push(id)});
  const profile = new Profile(p);
  assert.equal(await profile.save(),false); assert.equal(writes.length,0);
  await profile.initialize();
  assert.equal(profile.data.level,12); assert.equal(profile.data.xp,42);
  assert.equal(profile.s.controllerPrompts,'ps'); assert.equal(profile.s.hudSafeArea,3);
  assert.deepEqual(achievements,['FIRST_BLOOD']);
  await profile.save(); assert.equal(writes[0].level,12);
});

test('a broken host profile stops initialization and cannot overwrite its existing data', async () => {
  let writes = 0;
  const p = new Platform({storage:{read:async()=>'{invalid',write:()=>{writes++;}}});
  const profile = new Profile(p);
  await assert.rejects(profile.initialize());
  assert.equal(await profile.save(),false); assert.equal(writes,0);
});

test('console profile preserves explicitly saved comfort settings and ignores prototype keys', async () => {
  const p = new Platform({target:'xbox',getGamepads:()=>[],onEvent:()=>{},storage:{
    read:async()=>'{"settings":{"hudSafeArea":1,"controllerPrompts":"auto"},"__proto__":{"polluted":true}}',write:()=>{}}});
  const profile = new Profile(p); await profile.initialize();
  assert.equal(profile.s.hudSafeArea,1); assert.equal(profile.s.controllerPrompts,'auto');
  assert.equal(profile.data.polluted,undefined); assert.equal({}.polluted,undefined);
});
