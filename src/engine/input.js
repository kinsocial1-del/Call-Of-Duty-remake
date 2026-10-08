// Unified keyboard/mouse + gamepad input (Xbox, PlayStation, Steam Deck / generic XInput).
// Gamepads use the W3C "standard" mapping, which Chromium/Electron provides for Xbox & DualShock/DualSense pads.

const DEADZONE = 0.14;
import { platform } from '../core/platform.js';

export const PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, HOME: 16, TOUCHPAD: 17,
};

const PAD_LABELS = {
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'VIEW', 'MENU', 'LS', 'RS', '▲', '▼', '◀', '▶'],
  ps: ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'SHARE', 'OPTIONS', 'L3', 'R3', '▲', '▼', '◀', '▶'],
};

export function controllerType(id = '') {
  id = id.toLowerCase();
  if (/045e|xbox|xinput/.test(id)) return 'xbox';
  return /054c|playstation|dualsense|dualshock|wireless controller/.test(id) ? 'ps' : 'xbox';
}

function radial(x, y, deadzone = DEADZONE) {
  const m = Math.hypot(x, y);
  if (m <= deadzone) return [0, 0];
  const s = Math.min(1, (m - deadzone) / (1 - deadzone)) / m;
  return [x * s, y * s];
}

export class Input {
  constructor() {
    this.keys = new Set();
    this.down = new Set();      // pressed this frame
    this.mouse = { dx: 0, dy: 0, left: false, right: false, wheel: 0, leftDown: false, rightDown: false };
    this.padIndex = -1;
    this.padType = platform.host?.target === 'playstation' ? 'ps' : 'xbox';
    this.deadzone = DEADZONE;
    this.promptStyle = 'auto';
    this.padPrev = [];
    this.padState = [];
    this.lastDevice = platform.console ? 'pad' : 'kbm';
    this.locked = false;
    this.enabled = true;
    this.bind = {
      forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', crouch: 'KeyC', crouch2: 'ControlLeft',
      sprint: 'ShiftLeft', reload: 'KeyR', interact: 'KeyF', grenade: 'KeyG', melee: 'KeyV', swap: 'KeyQ',
      w1: 'Digit1', w2: 'Digit2', s1: 'Digit3', s2: 'Digit4', s3: 'Digit5', score: 'Tab', pause: 'Escape', firemode: 'KeyB', inspect: 'KeyI',
    };
    this.a = this._blank();

    addEventListener('keydown', (e) => {
      if (e.code === 'Space' && e.target?.matches?.('button')) return;
      if (e.code.startsWith('Arrow') && e.target?.matches?.('input[type=range]')) return;
      if (e.target?.matches?.('input:not([type=range]), textarea, select, [contenteditable=true]') && e.code !== 'Enter' && e.code !== 'Escape') return;
      if (e.code === 'Tab' && document.querySelector('#menu-root:not(:empty)')) return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!this.keys.has(e.code)) this.down.add(e.code);
      this.keys.add(e.code);
      this.lastDevice = 'kbm';
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.clear());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX; this.mouse.dy += e.movementY;
      this.lastDevice = 'kbm';
    });
    addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftDown = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightDown = true; }
      this.lastDevice = 'kbm';
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    addEventListener('wheel', (e) => { if (this.locked) this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = !!document.pointerLockElement;
      if (!this.locked) this.clear();
    });
    addEventListener('gamepadconnected', (e) => this._detectPad(e.gamepad));
  }

  clear() {
    this.keys.clear(); this.down.clear();
    this.mouse.dx = this.mouse.dy = this.mouse.wheel = 0;
    this.mouse.left = this.mouse.right = this.mouse.leftDown = this.mouse.rightDown = false;
    this.a = this._blank();
  }

  _blank() {
    return {
      mx: 0, my: 0, lx: 0, ly: 0, padLookX: 0, padLookY: 0,
      fire: false, fireP: false, ads: false, adsP: false, jumpP: false, jump: false, crouchP: false, crouch: false,
      sprintP: false, sprint: false, reloadP: false, interact: false, interactP: false, grenadeP: false, grenade: false, meleeP: false, swapP: false,
      w1P: false, w2P: false, streakP: [false, false, false], score: false, pauseP: false, firemodeP: false, inspectP: false,
      menuUp: false, menuDown: false, menuLeft: false, menuRight: false, menuOk: false, menuBack: false, tabL: false, tabR: false,
      controllerLost: false,
    };
  }

  _detectPad(gp) {
    this.padType = this.promptStyle === 'auto' ? controllerType(gp.id) : this.promptStyle;
  }

  lock(el) {
    if (platform.console) return;
    if (document.pointerLockElement) return;
    try {
      const p = el.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { el.requestPointerLock(); } catch { /* ignore */ } });
    } catch { try { el.requestPointerLock(); } catch { /* ignore */ } }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  padLabel(btn) { return PAD_LABELS[this.padType][btn]; }

  /** Returns HTML for a button prompt matching the active device. */
  prompt(action) {
    const kb = { reload: 'R', interact: 'F', grenade: 'G', melee: 'V', jump: 'SPACE', crouch: 'C', sprint: 'SHIFT', s1: '3', s2: '4', s3: '5', respawn: 'SPACE', score: 'TAB' };
    const pad = { reload: PAD.X, interact: PAD.X, grenade: PAD.RB, melee: PAD.RS, jump: PAD.A, crouch: PAD.B, sprint: PAD.LS, s1: PAD.LEFT, s2: PAD.UP, s3: PAD.RIGHT, respawn: PAD.A, score: PAD.BACK };
    if (this.lastDevice === 'pad') return `<span class="key pad">${this.padLabel(pad[action])}</span>`;
    return `<span class="key">${kb[action]}</span>`;
  }

  update(time = performance.now()) {
    const k = this.keys, d = this.down, b = this.bind, a = this._blank();
    // keyboard + mouse
    a.lx = (k.has(b.right) ? 1 : 0) - (k.has(b.left) ? 1 : 0);
    a.ly = (k.has(b.forward) ? 1 : 0) - (k.has(b.back) ? 1 : 0);
    a.mx = this.mouse.dx; a.my = this.mouse.dy;
    a.fire = this.mouse.left; a.fireP = this.mouse.leftDown;
    a.ads = this.mouse.right; a.adsP = this.mouse.rightDown;
    a.jump = k.has(b.jump); a.jumpP = d.has(b.jump);
    a.crouch = k.has(b.crouch) || k.has(b.crouch2); a.crouchP = d.has(b.crouch) || d.has(b.crouch2);
    a.sprint = k.has(b.sprint); a.sprintP = d.has(b.sprint);
    a.reloadP = d.has(b.reload);
    a.interact = k.has(b.interact); a.interactP = d.has(b.interact);
    a.grenade = k.has(b.grenade); a.grenadeP = d.has(b.grenade);
    a.meleeP = d.has(b.melee);
    a.swapP = d.has(b.swap) || this.mouse.wheel !== 0;
    a.wheel = this.mouse.wheel;
    a.w1P = d.has(b.w1); a.w2P = d.has(b.w2);
    a.streakP = [d.has(b.s1), d.has(b.s2), d.has(b.s3)];
    a.score = k.has(b.score);
    a.pauseP = d.has(b.pause) || d.has('KeyP');
    a.firemodeP = d.has(b.firemode);
    a.inspectP = d.has(b.inspect);
    a.menuUp = d.has('ArrowUp') || d.has('KeyW'); a.menuDown = d.has('ArrowDown') || d.has('KeyS');
    a.menuLeft = d.has('ArrowLeft') || d.has('KeyA'); a.menuRight = d.has('ArrowRight') || d.has('KeyD');
    a.menuOk = d.has('Enter'); a.menuBack = d.has('Escape') || d.has('Backspace');

    // gamepad
    const pads = platform.gamepads();
    const available = [...pads].filter((p) => p && p.connected && p.mapping === 'standard');
    let gp = available.find((p) => p.index === this.padIndex && p.id === this.padId) || available[0] || null;
    // Only change controllers when the other pad is being used and the selected one is idle.
    const active = (p) => p.buttons.some((button) => button.pressed || button.value > 0.35) || p.axes.some((axis) => Math.abs(axis) > this.deadzone);
    if (gp && !active(gp)) gp = available.find(active) || gp;
    a.controllerLost = !!this.gamepad && this.lastDevice === 'pad' && !available.some((p) => p.index === this.padIndex && p.id === this.padId);
    if (gp) {
      if (this.padIndex !== gp.index || this.padId !== gp.id) {
        this.padIndex = gp.index; this.padId = gp.id; this.padPrev = []; this._detectPad(gp);
        this._su = this._sd = this._sl = this._sr = false;
        this.menuRepeatDirection = ''; this.menuRepeatAt = 0;
      }
      const btn = (i) => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.35));
      const now = [];
      for (let i = 0; i < 18; i++) now[i] = btn(i);
      const pr = (i) => now[i] && !this.padPrev[i];
      const [lx, ly] = radial(gp.axes[0] || 0, gp.axes[1] || 0, this.deadzone);
      const [rx, ry] = radial(gp.axes[2] || 0, gp.axes[3] || 0, this.deadzone);
      const any = now.some(Boolean) || lx || ly || rx || ry;
      if (any) this.lastDevice = 'pad';
      if (this.lastDevice === 'pad') {
        a.lx += lx; a.ly += -ly;
        a.padLookX = rx; a.padLookY = ry;
        a.fire = a.fire || now[PAD.RT]; a.fireP = a.fireP || pr(PAD.RT);
        a.ads = a.ads || now[PAD.LT]; a.adsP = a.adsP || pr(PAD.LT);
        a.jump = a.jump || now[PAD.A]; a.jumpP = a.jumpP || pr(PAD.A);
        a.crouch = a.crouch || now[PAD.B]; a.crouchP = a.crouchP || pr(PAD.B);
        a.sprint = a.sprint || now[PAD.LS]; a.sprintP = a.sprintP || pr(PAD.LS);
        a.reloadP = a.reloadP || pr(PAD.X);
        a.interact = a.interact || now[PAD.X]; a.interactP = a.interactP || pr(PAD.X);
        a.grenade = a.grenade || now[PAD.RB]; a.grenadeP = a.grenadeP || pr(PAD.RB);
        a.meleeP = a.meleeP || pr(PAD.RS);
        a.swapP = a.swapP || pr(PAD.Y);
        a.streakP = [a.streakP[0] || pr(PAD.LEFT), a.streakP[1] || pr(PAD.UP), a.streakP[2] || pr(PAD.RIGHT)];
        a.score = a.score || now[PAD.BACK] || now[PAD.TOUCHPAD];
        a.pauseP = a.pauseP || pr(PAD.START);
        a.firemodeP = a.firemodeP || pr(PAD.DOWN);
      }
      // menu navigation (stick edge detection)
      const sy = gp.axes[1] || 0, sx = gp.axes[0] || 0;
      const stickUp = sy < -0.6, stickDown = sy > 0.6, stickL = sx < -0.6, stickR = sx > 0.6;
      a.menuUp = a.menuUp || pr(PAD.UP) || (stickUp && !this._su);
      a.menuDown = a.menuDown || pr(PAD.DOWN) || (stickDown && !this._sd);
      a.menuLeft = a.menuLeft || pr(PAD.LEFT) || (stickL && !this._sl);
      a.menuRight = a.menuRight || pr(PAD.RIGHT) || (stickR && !this._sr);
      const direction = stickUp || now[PAD.UP] ? 'menuUp' : stickDown || now[PAD.DOWN] ? 'menuDown' : '';
      if (direction !== this.menuRepeatDirection) { this.menuRepeatDirection = direction; this.menuRepeatAt = time + 350; }
      else if (direction && time >= this.menuRepeatAt) { a[direction] = true; this.menuRepeatAt = time + 100; }
      a.menuOk = a.menuOk || pr(PAD.A);
      a.menuBack = a.menuBack || pr(PAD.B);
      a.tabL = pr(PAD.LB); a.tabR = pr(PAD.RB);
      this._su = stickUp; this._sd = stickDown; this._sl = stickL; this._sr = stickR;
      this.padPrev = now;
      this.gamepad = gp;
    } else {
      this.gamepad = null; this.padIndex = -1; this.padId = undefined; this.padPrev = [];
      this.menuRepeatDirection = ''; this.menuRepeatAt = 0;
      this._su = this._sd = this._sl = this._sr = false;
    }
    a.lx = Math.max(-1, Math.min(1, a.lx));
    a.ly = Math.max(-1, Math.min(1, a.ly));
    this.a = a;
    return a;
  }

  rumble(strong = 0.5, weak = 0.5, ms = 120) {
    const gp = this.gamepad;
    if (!gp || this.lastDevice !== 'pad') return;
    const act = gp.vibrationActuator;
    try {
      if (act?.playEffect) Promise.resolve(act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak })).catch(() => {});
    } catch { /* disconnected or unsupported actuator */ }
  }

  stopRumble() {
    try { Promise.resolve(this.gamepad?.vibrationActuator?.reset?.()).catch(() => {}); } catch { /* disconnected */ }
  }

  endFrame() {
    this.down.clear();
    this.mouse.dx = this.mouse.dy = 0;
    this.mouse.wheel = 0;
    this.mouse.leftDown = this.mouse.rightDown = false;
  }
}
