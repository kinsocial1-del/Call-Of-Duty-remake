// Persistent profile: progression, loadout, settings, achievements. Mirrors achievements to Steam when available.
import { normalizeClasses } from './loadouts.js';
import { platform } from './platform.js';
const KEY = 'ironfront.profile.v1';
export const MAX_LEVEL = 60;

const DEFAULT = {
  name: 'OPERATOR',
  xp: 0, level: 1,
  stats: { kills: 0, deaths: 0, wins: 0, losses: 0, headshots: 0, matches: 0, bestStreak: 0, shots: 0, hits: 0, timePlayed: 0, survivalBest: 0 },
  loadout: { primary: 'vx4', secondary: 'p17', perks: ['lightweight', 'fasthands', 'quickfix'] },
  settings: {
    sens: 1.0, adsSens: 0.85, padSens: 1.0, invertY: false, fov: 85, master: 0.8, sfx: 1.0, music: 0.45,
    quality: 'high', renderScale: 1, shadows: 'high', ao: false, detail: 'high', postFx: true, gfxV: 1, showFps: false, aimAssist: true, difficulty: 'regular', fullscreen: true, rumble: true, crosshair: true, killcam: true,
    cameraMotion: 1, screenShake: 1, filmGrain: true, chromaticAberration: true, reducedMotion: false,
    padDeadzone: 0.14, controllerPrompts: 'auto', hudSafeArea: 0,
  },
  achievements: {},
  prestige: 0,
  kept: [],          // loadouts kept through rebirths (one per rebirth): usable at any level, read-only
  // live operations (see live.js): rotations are rebuilt whenever the day, week or season changes
  live: {
    day: -1, daily: [], rerolls: 1, dailySweep: false,
    week: -1, weekly: [], weeklySweep: false,
    login: { last: -1, streak: 0, total: 0 },
    firstWin: -1, tokens: 0, tokenSeconds: 0,
    season: { id: '', xp: 0 },
  },
  // owned + equipped cosmetics (see cosmetics.js); weapon mastery camos come from weapon levels, not this list
  cosmetics: { camos: [], cards: ['default'], titles: ['RECRUIT'], card: 'default', title: 'RECRUIT', camo: {}, fresh: [] },
  weapons: {}, // id -> { xp (lifetime), kills }
  assignments: { active: 'assault', tracks: {} },
  matchRecords: { best: {}, history: [] },
};

export const ACHIEVEMENTS = {
  FIRST_BLOOD: { name: 'First Blood', desc: 'Get your first kill.' },
  HEADHUNTER: { name: 'Headhunter', desc: 'Land 100 headshot kills.' },
  WINNER: { name: 'Mission Accomplished', desc: 'Win a match.' },
  STREAK_5: { name: 'Air Superiority', desc: 'Earn a 5 kill streak.' },
  STREAK_10: { name: 'Unstoppable', desc: 'Earn a 10 kill streak.' },
  LEVEL_10: { name: 'Seasoned', desc: 'Reach level 10.' },
  LEVEL_50: { name: 'Legend', desc: 'Reach max level (60).' },
  SURVIVOR: { name: 'Last One Standing', desc: 'Reach wave 10 in Survival.' },
  KNIFE: { name: 'Up Close', desc: 'Get a melee kill.' },
  COLLATERAL: { name: 'Two for One', desc: 'Kill two enemies with one explosion.' },
};

export function xpForLevel(l) { return 900 + (l - 1) * 260; }

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function merge(base, over) {
  for (const k of Object.keys(over || {})) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && base[k] && typeof base[k] === 'object') merge(base[k], over[k]);
    else if (over[k] == null && base[k] && typeof base[k] === 'object') continue; // a corrupt null never replaces a default object
    else base[k] = over[k];
  }
  return base;
}

export class Profile {
  constructor(services = platform) {
    this.platform = services;
    this.ready = !services.host;
    this.data = clone(DEFAULT);
    try { const raw = services.loadSync(KEY); if (raw) merge(this.data, JSON.parse(raw)); } catch { /* fresh profile */ }
    normalizeClasses(this.data);
    this.listeners = [];
  }
  /** Custom classes (0-4, editable, level-locked) followed by kept rebirth loadouts (read-only). */
  get allClasses() { return [...this.data.classes, ...this.data.kept.map((k) => ({ ...k, kept: true }))]; }
  selectClass(index) {
    const all = this.allClasses;
    if (!Number.isInteger(index) || index < 0 || index >= all.length) return;
    this.data.activeClass = index; this.data.loadout = all[index].loadout; this.save();
  }
  get activeIsKept() { return this.data.activeClass >= this.data.classes.length; }
  get s() { return this.data.settings; }
  /** Level used for weapon/perk unlocks. Rebirth resets it; only kept loadouts ignore it. */
  get unlockLevel() { return this.data.level; }
  async initialize() {
    if (this.platform.host) {
      // A failed platform read must stop startup, never overwrite an unseen save.
      const raw = await this.platform.load(KEY);
      if (raw != null) {
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid platform profile');
        this.data = merge(clone(DEFAULT), data);
        normalizeClasses(this.data);
      }
      if (this.platform.console) {
        const savedSettings = raw == null ? {} : JSON.parse(raw).settings || {};
        if (savedSettings.hudSafeArea == null) this.data.settings.hudSafeArea = 3;
        if (savedSettings.controllerPrompts == null) this.data.settings.controllerPrompts = this.platform.host.target === 'playstation' ? 'ps' : 'xbox';
      }
    }
    this.ready = true;
    for (const id of Object.keys(this.data.achievements)) void this.platform.achievement(id);
  }
  save() { return this.ready ? this.platform.save(KEY, JSON.stringify(this.data)) : Promise.resolve(false); }

  /** Adds XP; returns array of levels gained. */
  addXP(n) {
    const d = this.data, gained = [];
    if (d.level >= MAX_LEVEL) return gained;
    d.xp += n;
    while (d.level < MAX_LEVEL && d.xp >= xpForLevel(d.level)) { d.xp -= xpForLevel(d.level); d.level++; gained.push(d.level); }
    if (d.level >= MAX_LEVEL) d.xp = 0;
    if (d.level >= 10) this.unlock('LEVEL_10');
    if (d.level >= MAX_LEVEL) this.unlock('LEVEL_50');
    return gained;
  }

  unlock(id) {
    if (this.data.achievements[id]) return false;
    this.data.achievements[id] = Date.now();
    this.save();
    void this.platform.achievement(id);
    this.listeners.forEach((f) => f(id));
    return true;
  }

  onAchievement(f) { this.listeners.push(f); }

  reset() { this.data = clone(DEFAULT); normalizeClasses(this.data); this.save(); }
}

export const profile = new Profile();
