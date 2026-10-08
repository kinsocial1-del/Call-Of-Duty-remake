import * as THREE from 'three';
import { consumeReward } from './streak-rewards.js';

// A north-up map uses the same world coordinates as the minimap.
export class AirstrikeTargeting {
  constructor(game) {
    this.game = game;
    this.open = false;
    this.el = document.createElement('section');
    this.el.className = 'airstrike-targeting hidden';
    this.el.innerHTML = `<div class="airstrike-tablet"><header><span>TACTICAL SUPPORT</span><h2>PRECISION AIRSTRIKE</h2><p class="airstrike-help"></p></header><div class="airstrike-map"><canvas width="720" height="720" aria-label="Air strike target map"></canvas><span class="airstrike-north">N ↑</span></div><p class="airstrike-status" aria-live="polite"></p><footer><button type="button" class="airstrike-confirm">CONFIRM STRIKE</button><button type="button" class="airstrike-cancel">CANCEL</button></footer><small>The match continues. Choose your target from cover.</small></div>`;
    document.getElementById('hud').appendChild(this.el);
    this.canvas = this.el.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.canvas.addEventListener('pointermove', e => {
      if (!this.open) return;
      const r = this.canvas.getBoundingClientRect(), b = game.map.bounds;
      this.target.x = b.minX + (e.clientX - r.left) / r.width * (b.maxX - b.minX);
      this.target.z = b.minZ + (e.clientY - r.top) / r.height * (b.maxZ - b.minZ);
      game.input.lastDevice = 'kbm';
      this.clamp();
    });
    this.canvas.addEventListener('click', () => { this.confirm(); });
    this.el.querySelector('.airstrike-confirm').addEventListener('click', () => this.confirm());
    this.el.querySelector('.airstrike-cancel').addEventListener('click', () => this.close());
    this.el.addEventListener('contextmenu', e => { e.preventDefault(); this.close(); });
    this.el.addEventListener('wheel', e => { e.preventDefault(); this.angle += Math.sign(e.deltaY) * Math.PI / 12; }, { passive: false });
  }

  begin(reward) {
    const g = this.game, p = g.player;
    this.reward = reward;
    this.target = p.pos.clone().add(new THREE.Vector3(-Math.sin(p.yaw) * 25, 0, -Math.cos(p.yaw) * 25)).setY(0);
    this.angle = Math.atan2(-Math.cos(p.yaw), -Math.sin(p.yaw));
    this.clamp();
    this.open = true;
    p.cancelInput();
    this.el.classList.remove('hidden');
    g.input.unlock();
    this.draw();
  }

  clamp() {
    const b = this.game.map.bounds;
    this.target.x = Math.max(b.minX, Math.min(b.maxX, this.target.x));
    this.target.z = Math.max(b.minZ, Math.min(b.maxZ, this.target.z));
  }

  close(refocus = true) {
    if (!this.open) return;
    this.open = false;
    this.el.classList.add('hidden');
    this.game.targetFireBlocked = true;
    this.game.player.cancelInput();
    if (refocus && this.game.running && !this.game.paused && !this.game.over && this.game.player.alive) this.game.input.lock(this.game.R.r.domElement);
  }

  confirm() {
    const g = this.game;
    if (!this.open || g.paused || g.over || !g.player.alive || !consumeReward(this.reward)) return;
    g.streaks.callAirstrike(g.player, this.target.clone(), this.angle);
    g.session.event('streakUsed');
    this.close();
  }

  update(dt, a) {
    const g = this.game;
    if (!g.player.alive || g.over) { this.close(false); return; }
    if (a.menuBack || a.adsP || a.pauseP || a.streakP.some(Boolean)) { this.close(); return; }
    this.target.x += (a.lx + a.padLookX) * dt * 32;
    this.target.z += (-a.ly + a.padLookY) * dt * 32;
    const k = g.input.keys;
    this.target.x += ((k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0)) * dt * 32;
    this.target.z += ((k.has('ArrowDown') ? 1 : 0) - (k.has('ArrowUp') ? 1 : 0)) * dt * 32;
    this.angle += ((k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0)) * dt * 1.8;
    this.angle += ((a.tabR ? 1 : 0) - (a.tabL ? 1 : 0)) * Math.PI / 12;
    this.clamp();
    if (a.menuOk || a.fireP) { this.confirm(); return; }
    this.draw();
  }

  draw() {
    const g = this.game, c = this.ctx, b = g.map.bounds, W = 720;
    const sx = W / (b.maxX - b.minX), sz = W / (b.maxZ - b.minZ);
    const x = v => (v - b.minX) * sx, z = v => (v - b.minZ) * sz;
    c.clearRect(0, 0, W, W);
    c.drawImage(g.map.minimap.canvas, 0, 0, W, W);
    c.strokeStyle = 'rgba(150,190,185,.15)'; c.lineWidth = 1;
    for (let i = 0; i <= 6; i++) { c.beginPath(); c.moveTo(i * W / 6, 0); c.lineTo(i * W / 6, W); c.moveTo(0, i * W / 6); c.lineTo(W, i * W / 6); c.stroke(); }
    const marker = (pos, color, label, radius = 5) => {
      c.fillStyle = color; c.beginPath(); c.arc(x(pos.x), z(pos.z), radius, 0, Math.PI * 2); c.fill();
      if (label) { c.font = 'bold 18px sans-serif'; c.textAlign = 'center'; c.fillText(label, x(pos.x), z(pos.z) - 13); }
    };
    for (const f of g.flags || []) marker(f.pos, f.owner === g.player.team ? '#4fb3ff' : f.owner ? '#ff4b3e' : '#fff', f.name);
    if (g.hp) marker(g.hpPos, '#f2b33d', 'HP', 10);
    for (const actor of g.actors) {
      if (!actor.alive || actor === g.player) continue;
      const enemy = g.player.isEnemy(actor, g.ffa);
      if (enemy && !g.streaks.uavActive(g.player.team) && g.time - actor.lastShotTime >= 1.2) continue;
      marker(actor.pos, enemy ? '#ff4b3e' : '#4fb3ff');
    }
    marker(g.player.pos, '#fff', 'YOU', 7);
    // Match the six bomb centers and their 8 m damage radius.
    c.fillStyle = 'rgba(242,179,61,.08)'; c.strokeStyle = 'rgba(242,179,61,.45)'; c.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const offset = (i - 2.5) * 4.2;
      const px = x(this.target.x + Math.cos(this.angle) * offset), pz = z(this.target.z + Math.sin(this.angle) * offset);
      c.beginPath(); c.ellipse(px, pz, 8 * sx, 8 * sz, 0, 0, Math.PI * 2); c.fill(); c.stroke();
    }
    c.save(); c.translate(x(this.target.x), z(this.target.z)); c.rotate(this.angle);
    c.strokeStyle = '#f2b33d'; c.lineWidth = 3; c.beginPath(); c.moveTo(-14 * sx, 0); c.lineTo(14 * sx, 0); c.lineTo(14 * sx - 12, -9); c.moveTo(14 * sx, 0); c.lineTo(14 * sx - 12, 9); c.stroke(); c.restore();
    c.strokeStyle = '#fff'; c.lineWidth = 2;
    const tx = x(this.target.x), tz = z(this.target.z);
    c.beginPath(); c.arc(tx, tz, 12, 0, Math.PI * 2); c.moveTo(tx - 20, tz); c.lineTo(tx + 20, tz); c.moveTo(tx, tz - 20); c.lineTo(tx, tz + 20); c.stroke();
    this.el.querySelector('.airstrike-help').textContent = g.input.lastDevice === 'pad'
      ? `Stick: move • ${g.input.padLabel(4)} / ${g.input.padLabel(5)}: rotate • ${g.input.padLabel(0)} / ${g.input.padLabel(7)}: confirm • ${g.input.padLabel(1)}: cancel`
      : 'Mouse / WASD / arrows: move • Wheel / Q / E: rotate • Click / Enter: confirm • Right click / Esc: cancel';
    const distance = Math.hypot(this.target.x - g.player.pos.x, this.target.z - g.player.pos.z);
    this.el.querySelector('.airstrike-status').textContent = `TARGET ${Math.round(distance)} m AWAY · GOLD = BLAST AREA · ${distance < 20 ? 'DANGER CLOSE' : 'READY TO CONFIRM'}`;
  }
}
