import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AirstrikeTargeting } from '../src/game/airstrike-targeting.js';
import { StreakSystem } from '../src/game/streaks.js';
import { Input } from '../src/engine/input.js';
import { audio } from '../src/engine/audio.js';

audio.radio = () => {};
globalThis.document = { createElement: () => ({ getContext: () => ({
  createRadialGradient: () => ({ addColorStop() {} }), createLinearGradient: () => ({ addColorStop() {} }),
  fillRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, beginPath() {}, moveTo() {}, lineTo() {}, fill() {},
}) }) };
const { Game } = await import('../src/game/game.js');
function fixture() {
  const calls = [];
  const reward = { id: 'airstrike', charges: 2, ready: true };
  const game = {
    running: true, paused: false, over: false,
    player: { alive: true, pos: new THREE.Vector3(59, 0, 59), yaw: Math.PI, cancelInput() {} },
    playerStreaks: [reward], map: { bounds: { minX: -60, maxX: 60, minZ: -60, maxZ: 60 } },
    input: { keys: new Set(), unlock() {}, lock() {} }, R: { r: { domElement: {} } },
    streaks: { callAirstrike(...args) { calls.push(args); } },
    session: { event(name) { calls.push(name); } },
  };
  const selector = Object.assign(Object.create(AirstrikeTargeting.prototype), {
    game, open: false, el: { classList: { add() {}, remove() {} } }, draw() {},
  });
  game.airstrikeTargeting = selector;
  return { game, selector, reward, calls };
}
const blank = overrides => ({ ...Input.prototype._blank(), ...overrides });

test('activating air strike opens the map without spending a charge or launching', () => {
  const { game, selector, reward, calls } = fixture();
  Game.prototype.useStreak.call(game, 0);
  assert.equal(selector.open, true);
  assert.equal(reward.charges, 2);
  assert.deepEqual(calls, []);
  assert.equal(selector.target.z, 60);
});

test('confirm uses the selected position and direction exactly once', () => {
  const { game, selector, reward, calls } = fixture();
  selector.begin(reward);
  selector.target.set(12, 0, -18); selector.angle = 0.7;
  selector.confirm(); selector.confirm();
  assert.equal(reward.charges, 1);
  assert.equal(selector.open, false);
  assert.equal(game.targetFireBlocked, true);
  assert.deepEqual(calls[0][1], new THREE.Vector3(12, 0, -18));
  assert.equal(calls[0][2], 0.7);
  assert.equal(calls[1], 'streakUsed');
  assert.equal(calls.length, 2);
});

test('cancel and death preserve the reward; dead players cannot confirm', () => {
  const { game, selector, reward, calls } = fixture();
  selector.begin(reward); selector.update(0.1, blank({ menuBack: true }));
  assert.equal(selector.open, false); assert.equal(reward.charges, 2);
  selector.begin(reward); game.player.alive = false; selector.confirm();
  selector.update(0.1, blank());
  assert.equal(selector.open, false); assert.equal(reward.charges, 2);
  assert.deepEqual(calls, []);
});

test('controller moves and rotates the target, clamps to bounds, and confirms', () => {
  const { selector, reward, calls } = fixture();
  selector.begin(reward); selector.target.set(0, 0, 0); const angle = selector.angle;
  selector.update(0.5, blank({ lx: 1, ly: 1, tabR: true }));
  assert.equal(selector.target.x, 16); assert.equal(selector.target.z, -16);
  assert.ok(selector.angle > angle);
  selector.update(10, blank({ lx: 1, ly: -1 }));
  assert.equal(selector.target.x, 60); assert.equal(selector.target.z, 60);
  selector.update(0.1, blank({ menuOk: true }));
  assert.equal(reward.charges, 1); assert.equal(calls.length, 2);
});

test('the aircraft uses the direction chosen in the preview', () => {
  const scheduled = [];
  const game = { player: { team: 'A' }, hud: { toast() {} }, time: 0 };
  const streaks = new StreakSystem(game);
  streaks.schedule = (delay, fn) => scheduled.push(fn);
  const scene = new THREE.Scene(); game.R = { scene }; audio.jet = () => {};
  streaks.callAirstrike({ team: 'A' }, new THREE.Vector3(), Math.PI / 2);
  scheduled[0]();
  assert.ok(Math.abs(streaks.jets[0].dir.x) < 1e-8);
  assert.equal(streaks.jets[0].dir.z, 1);
  assert.equal(scheduled.length, 7);
});
