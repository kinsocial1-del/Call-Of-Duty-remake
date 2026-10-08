// Positional audio engine (WebAudio). Gunshots, reloads, footsteps, impacts, explosions and jets play real CC0
// recordings (Free Firearm Sound Library, Freesound, Kenney Impact Sounds); anything missing falls back to synthesis.
import * as THREE from 'three';
import { rand } from '../core/utils.js';

const MAX_VOICES = 48;
const PRIO_VOICES = 16; // extra headroom only gunshots and the player's own sounds may use, so firefights never go silent

export class Audio {
  constructor() {
    this.ctx = null;
    this.voices = 0;
    this.listenerPos = new THREE.Vector3();
    this.vol = { master: 0.8, sfx: 1, music: 0.5 };
    this.samples = {};      // gunshots: key -> { near: AudioBuffer[], far: AudioBuffer[] }
    this.fxBank = {};       // foley:    key -> AudioBuffer[]
    this.defaultStep = 'concrete';
    this._raw = null;       // fetched-but-undecoded sample data (decoded once the AudioContext exists)
    this._lastPick = {};
  }

  /** Fetch recorded sample banks. Decoding waits for init() because an AudioContext needs a user gesture. */
  async preload(base) {
    this._base = base;
    const raw = [];
    const bank = async (sub, kind) => {
      const dir = `${base}assets/audio/${sub}/`;
      try {
        const manifest = await (await fetch(dir + 'manifest.json')).json();
        await Promise.all(Object.entries(manifest).flatMap(([key, files]) => files.map(async (f) => {
          const r = await fetch(dir + f.file);
          if (r.ok) raw.push({ kind, key, far: f.far, data: await r.arrayBuffer() });
        })));
      } catch (e) { console.warn(`${sub} samples unavailable, using synthesis`, e); }
    };
    await Promise.all([bank('guns', 'gun'), bank('sfx', 'fx')]);
    this._raw = raw;
    if (this.ctx) this._decode();
  }

  _decode() {
    const raw = this._raw; this._raw = null;
    if (!raw) return;
    for (const r of raw) {
      this.ctx.decodeAudioData(r.data).then((buf) => {
        if (r.kind === 'fx') { (this.fxBank[r.key] || (this.fxBank[r.key] = [])).push(buf); return; }
        const bank = this.samples[r.key] || (this.samples[r.key] = { near: [], far: [] });
        bank[r.far ? 'far' : 'near'].push(buf);
      }).catch(() => {});
    }
  }

  _pick(key, far) {
    const bank = this.samples[key];
    if (!bank) return null;
    const list = far && bank.far.length ? bank.far : bank.near.length ? bank.near : bank.far;
    if (!list.length) return null;
    let i = Math.floor(Math.random() * list.length);
    const id = key + far;
    if (list.length > 1 && i === this._lastPick[id]) i = (i + 1) % list.length;
    this._lastPick[id] = i;
    return list[i];
  }

  /** Play a recorded effect from the foley bank. Returns false if it isn't loaded (caller synthesises instead). */
  _fx(key, pos, vol = 1, reverb = 0.1, rate = 1, vary = 0.05) {
    const list = this.ctx && this.fxBank[key];
    if (!list || !list.length) return false;
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === this._lastPick[key]) i = (i + 1) % list.length;
    this._lastPick[key] = i;
    const buf = list[i];
    const r = rate * rand(1 - vary, 1 + vary);
    const out = this._out(pos, vol, reverb, buf.duration / r);
    if (!out) return true;
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.playbackRate.value = r;
    src.connect(out); src.start();
    return true;
  }

  /** Play a recorded gunshot. Returns false if no sample is loaded for this weapon. */
  _sampleShot(p, pos, suppressed) {
    const dist = pos ? pos.distanceTo(this.listenerPos) : 0;
    const buf = this._pick(p.sample, dist > 32);
    if (!buf) return false;
    const ctx = this.ctx, t = ctx.currentTime;
    const vol = (pos ? 1.0 : 0.8) * (p.vol ?? 1) * (suppressed ? 0.3 : 1);
    const out = this._out(pos, vol, suppressed ? 0.1 : (p.verb ?? 0.35) * 0.6, buf.duration, true);
    if (!out) return true;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rand(0.96, 1.04);
    src.connect(out); src.start(t);
    if (!pos) {
      // shooter-side punch: a short sub thump under the recording, plus the mechanical click
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime((p.kick ?? 120) * 0.8, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.1);
      const og = ctx.createGain(); this._env(og.gain, t, (p.body ?? 1) * 0.45, 0.002, 0.12);
      o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.25);
      this.click(0.14, 3200, 0.02, t + 0.01);
    }
    return true;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.knee.value = 12; this.comp.ratio.value = 6;
    this.comp.attack.value = 0.002; this.comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.sfx = ctx.createGain();
    this.music = ctx.createGain();
    this.sfx.connect(this.comp); this.music.connect(this.comp);
    this.comp.connect(this.master); this.master.connect(ctx.destination);
    // outdoor reverb tail
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(2.4, 2.8);
    this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 0.32;
    this.reverbSend.connect(this.reverb); this.reverb.connect(this.sfx);
    // shared noise buffers
    this.noise = this._noiseBuffer(2, false);
    this.brown = this._noiseBuffer(3, true);
    this.applyVolumes();
    this._decode();
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.vol.master;
    this.sfx.gain.value = this.vol.sfx;
    this.music.gain.value = this.vol.music * 0.5;
  }

  _noiseBuffer(sec, brown) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }

  _impulse(sec, decay) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // sparse early reflections + diffuse tail
        const er = (i % 997 === 0 && t < 0.15) ? 0.8 : 0;
        d[i] = ((Math.random() * 2 - 1) * 0.6 + er) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  setListener(camera) {
    if (!this.ctx) return;
    const l = this.ctx.listener, p = camera.getWorldPosition(_v), f = camera.getWorldDirection(_f);
    this.listenerPos.copy(p);
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, t, 0.01); l.positionY.setTargetAtTime(p.y, t, 0.01); l.positionZ.setTargetAtTime(p.z, t, 0.01);
      l.forwardX.setTargetAtTime(f.x, t, 0.01); l.forwardY.setTargetAtTime(f.y, t, 0.01); l.forwardZ.setTargetAtTime(f.z, t, 0.01);
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(p.x, p.y, p.z); l.setOrientation(f.x, f.y, f.z, 0, 1, 0);
    }
  }

  /** Creates the output chain: [gain -> (panner) -> sfx (+reverb)]. Returns entry node or null if voice-limited. */
  _out(pos, gain = 1, reverb = 0.3, life = 1, prio = false) {
    if (!this.ctx || this.voices >= MAX_VOICES + (prio || !pos ? PRIO_VOICES : 0)) return null;
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = gain;
    let tail = g;
    if (pos) {
      const dist = pos.distanceTo(this.listenerPos);
      if (dist > 160) return null;
      // distant sounds lose high frequencies; anything behind a wall is muffled further
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      const blocked = dist > 2 && this.occluded && this.occluded(pos);
      lp.frequency.value = Math.max(blocked ? 350 : 700, 18000 / (1 + dist * 0.09)) * (blocked ? 0.22 : 1);
      if (blocked) g.gain.value *= 0.62;
      const p = ctx.createPanner();
      p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 4; p.rolloffFactor = 1.1; p.maxDistance = 200;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(lp); lp.connect(p); tail = p;
    }
    tail.connect(this.sfx);
    if (reverb > 0) {
      const rs = ctx.createGain(); rs.gain.value = reverb; tail.connect(rs); rs.connect(this.reverbSend);
    }
    this.voices++;
    setTimeout(() => { this.voices--; try { g.disconnect(); } catch { /* */ } }, life * 1000 + 200);
    return g;
  }

  _noiseSrc(buf = this.noise) {
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true;
    // start every burst at a random offset so repeated shots never sound identical
    const start = s.start.bind(s), off = rand(0, Math.max(0, buf.duration - 0.6));
    s.start = (t, dur) => (dur === undefined ? start(t, off) : start(t, off, dur));
    return s;
  }

  _env(param, t, peak, attack, decay, sustainTo = 0.0001) {
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(sustainTo, t + attack + decay);
  }

  /** Gunshot. p = sound profile from weapon def; pos null = local player (no panning). */
  /** Gunshot; far shots arrive late (sound travels ~343 m/s), so you see a distant muzzle flash before you hear it. */
  shot(p, pos = null, suppressed = false) {
    if (!this.ctx) return;
    const d = pos ? pos.distanceTo(this.listenerPos) : 0;
    if (d > 12) { const at = pos.clone(); setTimeout(() => this._shotNow(p, at, suppressed), (d / 343) * 1000); return; }
    this._shotNow(p, pos, suppressed);
  }

  _shotNow(p, pos = null, suppressed = false) {
    const ctx = this.ctx; if (!ctx) return;
    if (p.sample && this._sampleShot(p, pos, suppressed)) return;
    const t = ctx.currentTime;
    const vol = (pos ? 1.0 : 0.7) * (p.vol ?? 1) * (suppressed ? 0.3 : 1);
    const out = this._out(pos, vol, suppressed ? 0.1 : (p.verb ?? 0.45), p.tail ?? 0.6, true);
    if (!out) return;
    // crack: bright filtered noise
    const n = this._noiseSrc();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = (p.crack ?? 2400) * rand(0.9, 1.1); bp.Q.value = 0.7;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 300;
    const ng = ctx.createGain();
    this._env(ng.gain, t, 1.0, 0.001, p.decay ?? 0.12);
    n.connect(hp); hp.connect(bp); bp.connect(ng); ng.connect(out);
    n.start(t); n.stop(t + (p.decay ?? 0.12) + 0.3);
    // body: low noise thump
    const n2 = this._noiseSrc(this.brown);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = suppressed ? 500 : 900;
    const g2 = ctx.createGain();
    this._env(g2.gain, t, (p.body ?? 1) * 1.6, 0.002, (p.decay ?? 0.12) * 2.2);
    n2.connect(lp); lp.connect(g2); g2.connect(out);
    n2.start(t); n2.stop(t + 0.8);
    // sub kick
    if (!suppressed) {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(p.kick ?? 120, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.12);
      const og = ctx.createGain(); this._env(og.gain, t, (p.body ?? 1) * 0.9, 0.002, 0.16);
      o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.3);
    }
    // mechanical click for the shooter
    if (!pos) this.click(0.18, 3200, 0.02, t + 0.01);
  }

  click(vol = 0.3, freq = 2500, dur = 0.03, t0 = null, pos = null) {
    const ctx = this.ctx; if (!ctx) return;
    const t = t0 ?? ctx.currentTime;
    const out = this._out(pos, vol, 0.05, 0.2); if (!out) return;
    const n = this._noiseSrc();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 4;
    const g = ctx.createGain(); this._env(g.gain, t, 1, 0.001, dur);
    n.connect(bp); bp.connect(g); g.connect(out); n.start(t); n.stop(t + dur + 0.05);
  }

  /** stage: 'out' | 'in' | 'bolt' | 'charge' | 'pump' | 'shell'; def picks pistol vs rifle foley. */
  reload(stage, def = null) {
    if (this.ctx) {
      const pistol = def && (def.model === 'pistol' || def.model === 'mpistol');
      const key = { out: 'mag_out', in: pistol ? 'pistol_in' : 'mag_in', bolt: 'bolt', charge: pistol ? 'pistol_slide' : 'charge', pump: 'pump', shell: 'shell' }[stage];
      const vol = { out: 0.45, in: 0.55, bolt: 0.6, charge: 0.55, pump: 0.65, shell: 0.25 }[stage] ?? 0.5;
      const rate = stage === 'bolt' ? 1.25 : stage === 'out' && pistol ? 1.3 : 1;
      if (key && this._fx(key, null, vol, 0.05, rate)) return;
    }
    // stage: 'out' | 'in' | 'bolt' | 'pump' | 'shell'
    const map = { out: [0.35, 1400, 0.05], in: [0.45, 1900, 0.04], bolt: [0.5, 2600, 0.03], charge: [0.5, 2600, 0.03], pump: [0.6, 900, 0.08], shell: [0.3, 2200, 0.03] };
    const [v, f, d] = map[stage] || map.in;
    this.click(v, f, d);
    if (stage === 'bolt' || stage === 'charge' || stage === 'pump') this.click(v * 0.8, f * 1.4, d, this.ctx && this.ctx.currentTime + 0.09);
  }

  dry() { if (!this._fx('dryfire', null, 0.45, 0)) this.click(0.3, 3800, 0.015); }

  hit(kind = 'body') {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const out = this._out(null, kind === 'kill' ? 0.5 : 0.32, 0, 0.3); if (!out) return;
    const o = ctx.createOscillator(); o.type = 'square';
    o.frequency.value = kind === 'head' ? 1750 : kind === 'kill' ? 900 : 1300;
    const g = ctx.createGain(); this._env(g.gain, t, 0.5, 0.001, kind === 'kill' ? 0.12 : 0.05);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 600;
    o.connect(hp); hp.connect(g); g.connect(out); o.start(t); o.stop(t + 0.2);
    if (kind === 'kill' || kind === 'head') this.click(0.5, 5000, 0.04, t);
  }

  impact(pos, surface = 'concrete') {
    const kind = surface === 'metal' ? 'metal' : surface === 'wood' ? 'wood' : surface === 'flesh' ? 'flesh' : 'concrete';
    if (this._fx('hit_' + kind, pos, kind === 'flesh' ? 0.55 : 0.4, 0.08, kind === 'concrete' ? 1.25 : 1, 0.1)) return;
    const f = surface === 'metal' ? 4200 : surface === 'wood' ? 900 : surface === 'flesh' ? 500 : 1800;
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const out = this._out(pos, 0.35, 0.1, 0.3); if (!out) return;
    const n = this._noiseSrc();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * rand(0.8, 1.2); bp.Q.value = surface === 'metal' ? 8 : 1.5;
    const g = ctx.createGain(); this._env(g.gain, t, 0.9, 0.001, surface === 'metal' ? 0.18 : 0.06);
    n.connect(bp); bp.connect(g); g.connect(out); n.start(t); n.stop(t + 0.3);
  }

  whiz(pos) {
    const ctx = this.ctx; if (!ctx) return;
    if (this._fx('flyby', pos, 0.7, 0, 1, 0.12)) return;
    const t = ctx.currentTime;
    const out = this._out(pos, 0.5, 0, 0.25); if (!out) return;
    const n = this._noiseSrc();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
    bp.frequency.setValueAtTime(5200, t); bp.frequency.exponentialRampToValueAtTime(1800, t + 0.15);
    const g = ctx.createGain(); this._env(g.gain, t, 1, 0.01, 0.14);
    n.connect(bp); bp.connect(g); g.connect(out); n.start(t); n.stop(t + 0.25);
  }

  explosion(pos, size = 1) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    if (this.fxBank.explosion) {
      this._fx('explosion', pos, 1.5 * size, 0.6, size > 1 ? 0.88 : 1, 0.06);
      // sub-bass weight under the recording
      const out = this._out(pos, 1.1 * size, 0, 1.2);
      if (out) {
        const o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(24, t + 0.8);
        const og = ctx.createGain(); this._env(og.gain, t, 1.4, 0.005, 0.9);
        o.connect(og); og.connect(out); o.start(t); o.stop(t + 1.0);
      }
      return;
    }
    const out = this._out(pos, 1.4 * size, 0.7, 2.5); if (!out) return;
    const n = this._noiseSrc(this.brown);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3000, t); lp.frequency.exponentialRampToValueAtTime(140, t + 1.6);
    const g = ctx.createGain(); this._env(g.gain, t, 2.2, 0.005, 1.8);
    n.connect(lp); lp.connect(g); g.connect(out); n.start(t); n.stop(t + 2.2);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(25, t + 0.8);
    const og = ctx.createGain(); this._env(og.gain, t, 1.6, 0.005, 0.9);
    o.connect(og); og.connect(out); o.start(t); o.stop(t + 1.0);
    // debris crackle
    const n2 = this._noiseSrc();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    const g2 = ctx.createGain(); this._env(g2.gain, t + 0.05, 0.35, 0.02, 0.8);
    n2.connect(hp); hp.connect(g2); g2.connect(out); n2.start(t); n2.stop(t + 1.2);
  }

  footstep(pos = null, run = false, surface = 'concrete') {
    const ctx = this.ctx; if (!ctx) return;
    const kind = surface === 'metal' || surface === 'wood' ? surface : this.defaultStep;
    if (this._fx('step_' + kind, pos, (pos ? 0.7 : 0.32) * (run ? 1.25 : 1) * (kind === 'metal' ? 0.6 : 1), 0.04, 1, 0.08)) return;
    const t = ctx.currentTime;
    const out = this._out(pos, (pos ? 0.55 : 0.22) * (run ? 1.3 : 1), 0.05, 0.2); if (!out) return;
    const n = this._noiseSrc();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = (surface === 'metal' ? 1600 : surface === 'wood' ? 500 : 750) * rand(0.85, 1.15); bp.Q.value = 1.2;
    const g = ctx.createGain(); this._env(g.gain, t, 1, 0.004, 0.07);
    n.connect(bp); bp.connect(g); g.connect(out); n.start(t); n.stop(t + 0.15);
    if (surface === 'metal') this.click(0.15 * (pos ? 2 : 1), 3500, 0.05, t, pos);
  }

  land() { this.footstep(null, true); this.click(0.2, 400, 0.08); }

  bounce(pos) { if (!this._fx('bounce', pos, 0.6, 0.05, 1, 0.1)) this.click(0.6, 2800, 0.06, null, pos); }

  /** Knife connecting with a body. */
  stab(pos) { if (!this._fx('knife', pos, 0.8, 0.05)) this.impact(pos, 'flesh'); this._fx('melee_hit', pos, 0.6, 0.05); }

  pin() { this.click(0.4, 4200, 0.02); this.click(0.3, 2600, 0.04, this.ctx && this.ctx.currentTime + 0.12); }

  melee() {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const out = this._out(null, 0.5, 0.05, 0.3); if (!out) return;
    const n = this._noiseSrc();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.5;
    bp.frequency.setValueAtTime(600, t); bp.frequency.exponentialRampToValueAtTime(3000, t + 0.18);
    const g = ctx.createGain(); this._env(g.gain, t, 0.8, 0.05, 0.15);
    n.connect(bp); bp.connect(g); g.connect(out); n.start(t); n.stop(t + 0.3);
  }

  jet(pos) {
    const ctx = this.ctx; if (!ctx) return;
    if (this._fx('jet', null, 1.1, 0.3, 1.15, 0.03)) return;
    const t = ctx.currentTime;
    const out = this._out(null, 0.9, 0.5, 4.5); if (!out) return;
    const n = this._noiseSrc(this.brown);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(300, t); bp.frequency.linearRampToValueAtTime(1600, t + 1.4); bp.frequency.exponentialRampToValueAtTime(200, t + 4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(2.2, t + 1.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 4.2);
    n.connect(bp); bp.connect(g); g.connect(out); n.start(t); n.stop(t + 4.4);
  }

  turret(pos) { this.shot({ crack: 3200, decay: 0.06, body: 0.6, vol: 0.7, kick: 160, sample: 'turret' }, pos); }

  /** Radio style beep tones for announcements */
  radio(type = 'ally') {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const out = this._out(null, 0.25, 0, 0.8); if (!out) return;
    const notes = type === 'enemy' ? [660, 520, 440] : type === 'level' ? [523, 659, 784, 1046] : [880, 1100];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = type === 'level' ? 'triangle' : 'square'; o.frequency.value = f;
      const g = ctx.createGain(); this._env(g.gain, t + i * 0.11, 0.35, 0.005, 0.1);
      o.connect(g); g.connect(out); o.start(t + i * 0.11); o.stop(t + i * 0.11 + 0.15);
    });
  }

  ui(kind = 'move') {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const out = this._out(null, kind === 'ok' ? 0.22 : 0.1, 0, 0.2); if (!out) return;
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(kind === 'ok' ? 520 : kind === 'back' ? 300 : 900, t);
    if (kind === 'ok') o.frequency.exponentialRampToValueAtTime(1040, t + 0.08);
    const g = ctx.createGain(); this._env(g.gain, t, 0.5, 0.003, 0.08);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.15);
  }

  heartbeat() {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const out = this._out(null, 0.5, 0, 0.6); if (!out) return;
    [0, 0.16].forEach((d, i) => {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(70 - i * 10, t + d); o.frequency.exponentialRampToValueAtTime(35, t + d + 0.12);
      const g = ctx.createGain(); this._env(g.gain, t + d, 0.9 - i * 0.3, 0.01, 0.13);
      o.connect(g); g.connect(out); o.start(t + d); o.stop(t + d + 0.2);
    });
  }

  // ---------- AMBIENCE: real field recordings (CC0, Freesound) looped under the match ----------
  async _ambBuffer(name) {
    this._amb = this._amb || {};
    if (!this._amb[name]) {
      this._amb[name] = fetch(`${this._base || './'}assets/audio/ambience/${name}.ogg`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
        .then((d) => this.ctx.decodeAudioData(d))
        .catch(() => null);
    }
    return this._amb[name];
  }

  /** Woodland bed: recorded wind, synthesized birdsong and a far-off battle layer, faded in. */
  async startAmbience() {
    if (!this.ctx) return;
    this.stopAmbience();
    const token = this._ambToken = {};
    const [bed, war] = await Promise.all([this._ambBuffer('wind'), this._ambBuffer('battle')]);
    if (this._ambToken !== token) return;   // stopped or restarted while loading
    const ctx = this.ctx, t = ctx.currentTime, nodes = [];
    const bus = ctx.createGain(); bus.gain.setValueAtTime(0.0001, t); bus.gain.exponentialRampToValueAtTime(1, t + 4); bus.connect(this.sfx);
    const layer = (buf, vol, lowpass) => {
      if (!buf) return;
      const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
      const g = ctx.createGain(); g.gain.value = vol;
      let tail = s;
      if (lowpass) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = lowpass; s.connect(lp); tail = lp; }
      tail.connect(g); g.connect(bus);
      s.start(t, Math.random() * buf.duration); nodes.push(s);
    };
    layer(bed, 0.55, 5000);  // softened: wind moving through the pines
    layer(war, 0.2, 1400);   // muffled: a fight somewhere beyond the treeline
    this._ambience = { bus, nodes };
    this._birds(bus, token);
  }

  /** Occasional birdsong: short chirped phrases from random directions, every few seconds while the bed plays. */
  _birds(bus, token) {
    const ctx = this.ctx;
    const phrase = () => {
      if (this._ambToken !== token) return;
      this._birdT = setTimeout(phrase, rand(3, 11) * 1000);
      if (ctx.state !== 'running') return;   // paused: don't pile up phrases that would all play on resume
      let t = ctx.currentTime + 0.05;
      const pan = ctx.createStereoPanner(); pan.pan.value = rand(-0.9, 0.9);
      const g = ctx.createGain(); g.gain.value = rand(0.025, 0.06);
      g.connect(pan); pan.connect(bus);
      const base = rand(2400, 4200), notes = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < notes; i++) {
        const len = rand(0.05, 0.14), f = base * rand(0.85, 1.2);
        const o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * rand(0.7, 1.4), t + len);
        const e = ctx.createGain(); this._env(e.gain, t, 1, 0.01, len);
        o.connect(e); e.connect(g); o.start(t); o.stop(t + len + 0.05);
        t += len + rand(0.04, 0.12);
      }
      setTimeout(() => { try { pan.disconnect(); } catch { /* */ } }, (t - ctx.currentTime + 0.5) * 1000);
    };
    this._birdT = setTimeout(phrase, rand(1, 4) * 1000);
  }

  stopAmbience() {
    this._ambToken = null;
    clearTimeout(this._birdT);
    const a = this._ambience; if (!a || !this.ctx) return;
    const t = this.ctx.currentTime;
    a.bus.gain.cancelScheduledValues(t); a.bus.gain.setValueAtTime(Math.max(0.0001, a.bus.gain.value), t);
    a.bus.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    setTimeout(() => { a.nodes.forEach((n) => { try { n.stop(); } catch { /* */ } }); try { a.bus.disconnect(); } catch { /* */ } }, 1400);
    this._ambience = null;
  }

  // ---------- MUSIC: generative tension score ----------
  startMusic(mood = 'menu') {
    if (!this.ctx) return;
    this.stopMusic();
    const ctx = this.ctx;
    const bus = ctx.createGain(); bus.gain.value = 0.0001; bus.connect(this.music);
    bus.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 3);
    const nodes = [];
    const root = mood === 'menu' ? 55 : 49; // A1 / G1
    // drone pad: detuned saws through a slow moving lowpass
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = 4; lp.connect(bus);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05; const lfoG = ctx.createGain(); lfoG.gain.value = 380;
    lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start(); nodes.push(lfo);
    [1, 1.5, 2, 2.997, 4.01].forEach((m, i) => {
      const o = ctx.createOscillator(); o.type = i < 2 ? 'sawtooth' : 'triangle'; o.frequency.value = root * m; o.detune.value = rand(-9, 9);
      const g = ctx.createGain(); g.gain.value = [0.16, 0.08, 0.07, 0.04, 0.03][i];
      o.connect(g); g.connect(lp); o.start(); nodes.push(o);
    });
    // pulse: rhythmic low hits + ticking hats
    const bpm = mood === 'menu' ? 84 : 112, beat = 60 / bpm;
    let next = ctx.currentTime + 0.5, step = 0;
    const minor = [0, 3, 5, 7, 10, 12];
    const sched = () => {
      while (next < ctx.currentTime + 0.3) {
        if (step % 4 === 0 || step % 16 === 10) {
          const o = ctx.createOscillator(); o.type = 'sine';
          o.frequency.setValueAtTime(root * 1.0, next); o.frequency.exponentialRampToValueAtTime(root * 0.6, next + 0.3);
          const g = ctx.createGain(); this._env(g.gain, next, 0.55, 0.005, 0.5);
          o.connect(g); g.connect(bus); o.start(next); o.stop(next + 0.6);
        }
        if (step % 2 === 1) {
          const n = this._noiseSrc(); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
          const g = ctx.createGain(); this._env(g.gain, next, step % 4 === 3 ? 0.08 : 0.04, 0.001, 0.04);
          n.connect(hp); hp.connect(g); g.connect(bus); n.start(next); n.stop(next + 0.08);
        }
        if (step % 8 === 0 && Math.random() < 0.7) {
          const f = root * 4 * Math.pow(2, minor[Math.floor(Math.random() * minor.length)] / 12);
          const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
          const g = ctx.createGain(); this._env(g.gain, next, 0.06, 0.3, beat * 6);
          const dl = ctx.createDelay(); dl.delayTime.value = beat * 0.75; const fb = ctx.createGain(); fb.gain.value = 0.35;
          o.connect(g); g.connect(bus); g.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(bus);
          o.start(next); o.stop(next + beat * 7);
        }
        next += beat / 2; step++;
      }
    };
    const iv = setInterval(sched, 100);
    this._music = { bus, nodes, iv };
  }

  stopMusic() {
    const m = this._music; if (!m || !this.ctx) return;
    clearInterval(m.iv);
    const t = this.ctx.currentTime;
    m.bus.gain.cancelScheduledValues(t);
    m.bus.gain.setValueAtTime(m.bus.gain.value || 0.0001, t);
    m.bus.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    setTimeout(() => { m.nodes.forEach((n) => { try { n.stop(); } catch { /* */ } }); try { m.bus.disconnect(); } catch { /* */ } }, 1700);
    this._music = null;
  }
}

const _v = new THREE.Vector3(), _f = new THREE.Vector3();
export const audio = new Audio();
