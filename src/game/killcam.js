// Killcam: keeps a rolling recording of every combatant (poses, shots, explosions) and replays the seconds
// before a kill from the killer's eyes, with stand-in "ghost" soldier models so the live match can keep running.
import * as THREE from 'three';
import { SoldierModel } from './soldier.js';
import { audio } from '../engine/audio.js';
import { clamp, damp, lerp, wrapAngle } from '../core/utils.js';
import { profile } from '../core/save.js';

const STEP = 1 / 30;           // recording rate
const KEEP = 14;               // seconds of history kept
export const KC_PRE = 4.5;     // seconds replayed before the kill
export const KC_POST = 1.4;    // ...and after it

export class Killcam {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.visible = false;
    game.R.scene.add(this.group);
    this.ghosts = new Map();     // actor -> { model, def, wasAlive, deadT, seen }
    this.kc = null;
    this.reset();
  }

  get active() { return !!this.kc; }

  reset() {
    this.stop(true);
    this.frames = []; this.events = []; this.acc = STEP; this.spare = [];
    for (const gh of this.ghosts.values()) { this.group.remove(gh.model.root); gh.model.dispose(); }
    this.ghosts.clear();
  }

  // ------------------------------------------------------------------ RECORDING
  record(dt) {
    const g = this.game;
    if (!profile.s.killcam) { if (this.frames.length) { this.frames = []; this.events = []; } return; } // nothing will ever be replayed
    this.acc += dt;
    if (this.acc < STEP) return;
    this.acc = 0;
    // frames that fell out of the window are recycled, so recording allocates nothing in steady state
    const frame = this.spare.pop() || { t: 0, list: [] }, list = frame.list;
    frame.t = g.time;
    let n = 0;
    for (const a of g.actors) {
      const e = list[n] || (list[n] = {});
      n++;
      e.a = a; e.x = a.pos.x; e.y = a.pos.y; e.z = a.pos.z; e.yaw = a.yaw; e.pitch = a.pitch;
      e.crouch = Math.min(1, a.crouch); e.alive = a.alive;
      e.def = a.isPlayer ? (a.weapons.length ? a.def : null) : a.def;
      e.ads = a.isPlayer ? a.adsT : a.state === 'engage' && a.targetVisible ? 1 : 0;
    }
    list.length = n;
    this.frames.push(frame);
    const cut = g.time - KEEP;
    while (this.frames.length && this.frames[0].t < cut) this.spare.push(this.frames.shift());
    while (this.events.length && this.events[0].t < cut) this.events.shift();
  }

  /** end = { to, kind: null | 'wall' | 'body' | 'head' | 'kill', normal?, surface? } */
  shot(shooter, from, def, end, opts = {}) {
    const g = this.game, last = this.events[this.events.length - 1];
    const e = { to: end.to.clone(), kind: end.kind, normal: end.normal ? end.normal.clone() : null, surface: end.surface };
    // shotgun pellets fired in the same frame become one event with several impacts
    if (last && last.type === 'shot' && last.t === g.time && last.a === shooter && last.sentry === !!opts.sentry) { last.ends.push(e); return; }
    this.events.push({ type: 'shot', t: g.time, a: shooter, from: from.clone(), def, ends: [e], sentry: !!opts.sentry, rocket: !!opts.rocket });
  }

  boom(pos, size) { this.events.push({ type: 'boom', t: this.game.time, pos: pos.clone(), size }); }

  // ------------------------------------------------------------------ PLAYBACK
  /** Starts replaying `killer`'s view around time `killT`. Returns false if there is not enough footage. */
  start(killer, victim, killT, opts = {}) {
    if (!killer || !profile.s.killcam || !this.frames.length) return false;
    const t0 = Math.max(killT - KC_PRE, this.frames[0].t);
    if (killT - t0 < 1.2) return false;
    if (!this.frames.some((f) => f.t >= t0 && f.list.some((e) => e.a === killer && e.alive))) return false;
    this.stop(true);
    this.kc = { killer, victim, t0, t: t0, t1: killT + KC_POST, final: !!opts.final, onDone: opts.onDone, def: null, ads: 0 };
    for (const gh of this.ghosts.values()) { gh.wasAlive = false; gh.deadT = 0; if (gh.model.dead) gh.model.reset(); gh.model.root.visible = false; }
    this.group.visible = true;
    this.game.hud.killcam({ final: !!opts.final, killer: killer.name, weapon: opts.weapon || '', mine: killer.isPlayer });
    return true;
  }

  stop(silent = false) {
    const k = this.kc;
    this.kc = null; this.scoped = false;
    this.group.visible = false;
    if (!k) return;
    const g = this.game;
    for (const b of g.bots) b.model.root.visible = b.alive || b.deadT <= 6;
    const p = g.player;
    if (p.alive && p.weapons.length) { g.vm.setWeapon(p.def); g.vm.setVisible(true); } else g.vm.setVisible(false);
    g.hud.killcam(null);
    if (!silent && k.onDone) k.onDone();
  }

  /** Drives the camera while a killcam is playing. Returns true if it did. */
  update(dt) {
    const k = this.kc;
    if (!k) return false;
    const g = this.game, cam = g.R.camera, fr = this.frames;
    const prevT = k.t;
    k.t += dt;
    if (k.t >= k.t1 || !fr.length) { this.stop(); return false; }
    // bracketing frames
    let lo = 0, hi = fr.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (fr[mid].t <= k.t) lo = mid; else hi = mid - 1; }
    const A = fr[lo], B = fr[Math.min(lo + 1, fr.length - 1)];
    const span = B.t - A.t, f = span > 0 ? clamp((k.t - A.t) / span, 0, 1) : 0;

    for (const b of g.bots) b.model.root.visible = false; // the live match keeps running underneath
    for (const gh of this.ghosts.values()) gh.seen = false;
    let me = null;
    for (const ea of A.list) {
      const eb = B.list.find((e) => e.a === ea.a) || ea;
      const x = lerp(ea.x, eb.x, f), y = lerp(ea.y, eb.y, f), z = lerp(ea.z, eb.z, f);
      const yaw = ea.yaw + wrapAngle(eb.yaw - ea.yaw) * f, pitch = lerp(ea.pitch, eb.pitch, f);
      const crouch = lerp(ea.crouch, eb.crouch, f);
      const speed = span > 0 ? Math.hypot(eb.x - ea.x, eb.z - ea.z) / span : 0;
      if (ea.a === k.killer) { me = { x, y, z, yaw, pitch, crouch, speed, def: ea.def, ads: ea.ads }; continue; }
      this.pose(ea, x, y, z, yaw, pitch, crouch, speed, dt);
    }
    for (const gh of this.ghosts.values()) if (!gh.seen) gh.model.root.visible = false;
    if (!me || !me.def) { this.stop(); return false; }

    // killer's eyes
    const def = me.def;
    if (def !== k.def) { g.vm.setWeapon(def, k.killer.isPlayer ? undefined : null); k.def = def; }
    k.ads = damp(k.ads, me.ads > 0.5 ? 1 : 0, 9, dt);
    this.scoped = !!def.scope && k.ads > 0.85;
    cam.position.set(me.x, me.y + 1.62 - me.crouch * 0.55, me.z);
    cam.rotation.set(me.pitch, me.yaw, 0, 'YXZ');
    cam.fov = profile.s.fov * (this.scoped ? def.zoom : lerp(1, def.scope ? 0.65 : def.zoom, k.ads));
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    g.R.vmCamera.fov = lerp(58, 46, k.ads); g.R.vmCamera.updateProjectionMatrix();
    g.vm.setVisible(true);
    g.vm.update({
      dt, ads: k.ads, speed: me.speed / 5, sprint: false, tac: false, grounded: true, crouch: me.crouch > 0.5, slide: false,
      lookX: 0, lookY: 0, reload: -1, reloadEmpty: false, swap: 0, melee: -1, nade: -1, cycle: -1, shellLoad: -1, hidden: this.scoped,
    });

    // shots & explosions that happened during this slice of the replay
    for (const ev of this.events) {
      if (ev.t <= prevT || ev.t > k.t) continue;
      if (ev.type === 'boom') {
        g.fx.explosion(ev.pos, ev.size); audio.explosion(ev.pos, ev.size);
        const d = cam.position.distanceTo(ev.pos);
        if (d < 40) g.shake(clamp((40 - d) / 40, 0, 1) * 0.5);
        continue;
      }
      const mine = ev.a === k.killer && !ev.sentry;
      let from;
      if (mine) {
        g.vm.kick(ev.def);
        from = g.vm.muzzleWorld(cam, _m);
        g.fx.muzzle(from, ev.def.rocket ? 2 : 0.6, false);
        audio.shot(ev.def.sound, null, false);
      } else {
        const gh = this.ghosts.get(ev.a);
        from = !ev.sentry && gh && gh.model.root.visible ? gh.model.muzzleWorld(_m) : _m.copy(ev.from);
        g.fx.muzzle(from, 0.5);
        audio.shot(ev.def.sound, from, false);
      }
      if (ev.rocket) continue;
      let best = null;
      const rank = { body: 1, head: 2, kill: 3 };
      ev.ends.forEach((en, i) => {
        if (i === 0 || Math.random() < 0.3) g.fx.tracer(from, en.to, 420);
        if (en.kind === 'wall') g.fx.impact(en.to, en.normal, en.surface);
        else if (en.kind) {
          g.fx.blood(en.to, _d.subVectors(en.to, ev.from).normalize());
          if (!best || rank[en.kind] > rank[best]) best = en.kind;
        }
      });
      if (mine && best) { g.hud.hitmarker(best); audio.hit(best); }
    }
    return true;
  }

  pose(e, x, y, z, yaw, pitch, crouch, speed, dt) {
    if (!e.def) return;
    const a = e.a;
    let gh = this.ghosts.get(a);
    if (!gh) {
      const faction = a.faction || (a.team === 'B' ? 'korvax' : 'ironfront');
      const model = new SoldierModel(faction, e.def);
      model.root.visible = false;
      this.group.add(model.root);
      gh = { model, def: e.def, wasAlive: false, deadT: 0, seen: false };
      this.ghosts.set(a, gh);
    }
    gh.seen = true;
    const m = gh.model;
    if (gh.def !== e.def) { m.setWeapon(e.def); gh.def = e.def; }
    if (e.alive) {
      if (m.dead) m.reset();
      gh.deadT = 0;
      m.root.visible = true;
      m.root.position.set(x, y, z);
      m.root.rotation.y = yaw;
      m.animate({ dt, speed, crouch: crouch > 0.5, pitch });
    } else if (gh.wasAlive || m.dead) {
      // died during the replay: play the fall where they stood
      if (!m.dead) m.die(null);
      gh.deadT += dt;
      m.root.visible = gh.deadT < 6;
      m.animate({ dt });
    } else m.root.visible = false; // already dead when the replay began
    gh.wasAlive = e.alive || (gh.wasAlive && m.dead);
  }
}

const _m = new THREE.Vector3(), _d = new THREE.Vector3();
