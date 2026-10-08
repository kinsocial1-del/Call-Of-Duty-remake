// Live operations: everything that changes from day to day.
// Daily + weekly challenges, the daily supply drop and login streak, the Daily Operation, Double XP (weekends and
// tokens), first win of the day, the monthly season pass and Rebirth (stored as `prestige`). Rotations are seeded from the local calendar
// date, so every player gets the same challenges and the same Daily Operation on the same day.
// Match progress is buffered in a MatchSession and only committed when a match ends, so leaving a match early
// keeps the existing "progress from this match is lost" rule.
import { profile, MAX_LEVEL, xpForLevel } from './save.js';
import { normalizeClasses } from './loadouts.js';
import { AssignmentRun, recordMatch } from './assignments.js';
import { WEAPONS, PERKS } from '../game/weapons.js';
import { seeded } from './utils.js';
import { seasonName, DROP_CAMOS, DROP_CARDS, PRESTIGE_MAX, roman } from './catalog.js';
import { grant, owns, cosmeticLabel, titleForLevel, addWeaponXP, weaponLevel, weaponXP, KILL_WXP, HEADSHOT_WXP, LONGSHOT_WXP } from './cosmetics.js';

const DAY_MS = 86400000;
export const DAILY_XP = 2500, WEEKLY_XP = 10000, DAILY_SWEEP_XP = 5000, FIRST_WIN_XP = 2000, TOKEN_SECONDS = 1800;
export const TIER_XP = 7500, TIERS = 50;

// ------------------------------------------------------------------ CALENDAR
/** Local calendar day number (days since 1970-01-01 in the player's timezone). */
export const dayIndex = (d = new Date()) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
/** Monday-based week number. */
export const weekIndex = (d = new Date()) => Math.floor((dayIndex(d) + 3) / 7);
export function nextDailyReset() { const d = new Date(); d.setHours(24, 0, 0, 0); return d.getTime(); }
export function nextWeeklyReset() { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 8 - (d.getDay() || 7)); return d.getTime(); }
export const isWeekend = (d = new Date()) => d.getDay() === 0 || d.getDay() === 6;
export function seasonInfo(d = new Date()) {
  const n = Math.max(1, (d.getFullYear() - 2026) * 12 + d.getMonth() - 8);
  return { n, id: 's' + n, name: seasonName(n), end: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() };
}

// ------------------------------------------------------------------ CHALLENGES
const rifle = (c) => c.cls === 'ASSAULT RIFLE' || c.cls === 'BURST RIFLE';
const smg = (c) => c.cls === 'SUBMACHINE GUN' || c.cls === 'MACHINE PISTOL';
const scoped = (c) => c.cls === 'SNIPER RIFLE' || c.cls === 'MARKSMAN RIFLE';
/** d / w: daily and weekly targets (0 = not offered in that rotation). mode: only progresses in that mode. */
export const CHALLENGES = [
  { id: 'kills', stat: 'kill', d: 15, w: 120, text: (n) => `Get ${n} kills` },
  { id: 'heads', stat: 'kill', when: (c) => c.headshot, d: 5, w: 40, text: (n) => `Get ${n} headshot kills` },
  { id: 'wins', stat: 'win', d: 2, w: 12, text: (n) => `Win ${n} matches` },
  { id: 'play', stat: 'match', d: 3, w: 15, text: (n) => `Finish ${n} matches` },
  { id: 'rifle', stat: 'kill', when: rifle, d: 12, w: 70, text: (n) => `Get ${n} kills with assault or burst rifles` },
  { id: 'smg', stat: 'kill', when: smg, d: 12, w: 70, text: (n) => `Get ${n} kills with SMGs or machine pistols` },
  { id: 'shotgun', stat: 'kill', when: (c) => c.cls === 'SHOTGUN', d: 6, w: 40, text: (n) => `Get ${n} shotgun kills` },
  { id: 'scoped', stat: 'kill', when: scoped, d: 6, w: 40, text: (n) => `Get ${n} kills with sniper or marksman rifles` },
  { id: 'lmg', stat: 'kill', when: (c) => c.cls === 'LIGHT MACHINE GUN', d: 8, w: 50, text: (n) => `Get ${n} LMG kills` },
  { id: 'pistol', stat: 'kill', when: (c) => c.cls === 'PISTOL', d: 5, w: 30, text: (n) => `Get ${n} pistol kills` },
  { id: 'long', stat: 'kill', when: (c) => c.longshot, d: 3, w: 20, text: (n) => `Get ${n} longshot kills (45m+)` },
  { id: 'multi', stat: 'multikill', d: 2, w: 15, text: (n) => `Get ${n} multi-kills` },
  { id: 'blade', stat: 'kill', when: (c) => c.melee, d: 2, w: 12, text: (n) => `Get ${n} knife kills` },
  { id: 'boom', stat: 'kill', when: (c) => c.explosive, d: 3, w: 20, text: (n) => `Get ${n} kills with grenades, launchers or barrels` },
  { id: 'streak5', stat: 'streak5', d: 1, w: 6, text: (n) => (n === 1 ? 'Reach a 5 kill streak' : `Reach a 5 kill streak ${n} times`) },
  { id: 'callins', stat: 'streakUsed', d: 2, w: 12, text: (n) => `Call in ${n} killstreaks` },
  { id: 'assists', stat: 'assist', d: 6, w: 40, text: (n) => `Get ${n} assists` },
  { id: 'medals', stat: 'medal', d: 10, w: 80, text: (n) => `Earn ${n} medals` },
  { id: 'caps', stat: 'capture', mode: 'dom', d: 4, w: 25, text: (n) => `Capture ${n} flags in Domination` },
  { id: 'hold', stat: 'hpTime', mode: 'hp', d: 60, w: 400, text: (n) => `Hold the Hardpoint for ${n} seconds` },
  { id: 'tags', stat: 'confirm', mode: 'kc', d: 8, w: 50, text: (n) => `Confirm ${n} kills in Kill Confirmed` },
  { id: 'waves', stat: 'wave', mode: 'survival', d: 5, w: 30, text: (n) => `Clear ${n} Survival waves` },
  { id: 'ladder', stat: 'gunlevel', mode: 'gun', d: 10, w: 60, text: (n) => `Climb ${n} Gun Game levels` },
];
const BY_ID = Object.fromEntries(CHALLENGES.map((c) => [c.id, c]));
export const challengeText = (c) => BY_ID[c.id]?.text(c.target) || c.id;
export const challengeMode = (c) => BY_ID[c.id]?.mode || null;

function makeChallenge(def, scope) {
  return { id: def.id, scope, target: scope === 'daily' ? def.d : def.w, prog: 0, done: false, xp: scope === 'daily' ? DAILY_XP : WEEKLY_XP };
}
/** Pick `count` distinct challenges; at most `modeSlots` are mode-specific so every set is playable in any mode. */
function pickChallenges(seed, scope, count, modeSlots, exclude = []) {
  const r = seeded(seed), key = scope === 'daily' ? 'd' : 'w';
  const pool = CHALLENGES.filter((c) => c[key] && !exclude.includes(c.id));
  const out = [];
  let modes = 0;
  while (out.length < count && pool.length) {
    const i = Math.floor(r() * pool.length), c = pool.splice(i, 1)[0];
    if (c.mode && modes >= modeSlots) continue;
    if (c.mode) modes++;
    out.push(makeChallenge(c, scope));
  }
  return out;
}

// ------------------------------------------------------------------ MODIFIERS + DAILY OP
/** Match mutators. Also selectable for custom matches. */
export const MODIFIERS = {
  hardcore: { name: 'HARDCORE', desc: '30 health, no minimap and no health bars. Every bullet counts.', health: 30, hardcore: true },
  snipers: { name: 'SNIPER DUEL', desc: 'Everyone carries the Longbow .338 and P-17.', loadout: { primary: 'longbow', secondary: 'p17' }, bots: ['longbow'] },
  cqb: { name: 'CLOSE QUARTERS', desc: 'Close-range weapons only: Ranger 12 shotguns, SMGs and machine pistols.', loadout: { primary: 'ranger', secondary: 'hellcat' }, bots: ['ranger', 'kestrel'] },
  heavy: { name: 'HEAVY METAL', desc: 'Brutus LMGs and Striker launchers for everyone.', loadout: { primary: 'brutus', secondary: 'striker' }, bots: ['brutus'] },
  blitz: { name: 'BLITZ', desc: 'Redeploys are near instant. Non-stop action.', respawn: 0.3 },
  headhunter: { name: 'HEADHUNTER', desc: 'Headshots deal double damage. Aim high.', headMul: 2 },
};
const OP_MODES = ['tdm', 'dom', 'hp', 'kc', 'ffa'], OP_MAPS = ['dockyard', 'outpost'];
export function dailyOp(day = dayIndex()) {
  const r = seeded('op' + day), pickR = (a) => a[Math.floor(r() * a.length)];
  return { mode: pickR(OP_MODES), map: pickR(OP_MAPS), modifier: pickR(Object.keys(MODIFIERS)), day };
}

/** XP boosts that apply to a match started now with this config. */
export function boosts(cfg = {}) {
  const L = profile.data.live, list = [];
  let mult = 1;
  if (isWeekend()) { mult += 1; list.push('DOUBLE XP WEEKEND'); }
  if (L.tokenSeconds > 0) { mult += 1; list.push('DOUBLE XP TOKEN'); }
  if (cfg.op && cfg.opDay === dayIndex()) { mult += 0.5; list.push('DAILY OP +50%'); }
  return { mult, list, token: L.tokenSeconds > 0 };
}
export function activateToken() {
  const L = profile.data.live;
  if (L.tokens <= 0) return false;
  L.tokens--; L.tokenSeconds += TOKEN_SECONDS; profile.save();
  return true;
}

// ------------------------------------------------------------------ REFRESH
/** Roll over the daily / weekly / season state when the calendar moves. Safe to call any time. */
export function refresh() {
  const d = profile.data, L = d.live, today = dayIndex(), wk = weekIndex(), s = seasonInfo();
  let changed = false;
  if (L.day !== today || !L.daily.length) { L.day = today; L.daily = pickChallenges('daily' + today, 'daily', 3, 1); L.rerolls = 1; L.dailySweep = false; changed = true; }
  if (L.week !== wk || !L.weekly.length) { L.week = wk; L.weekly = pickChallenges('weekly' + wk, 'weekly', 5, 2); L.weeklySweep = false; changed = true; }
  if (L.season.id !== s.id) { L.season = { id: s.id, xp: 0 }; changed = true; }
  // retro-grant level titles for existing profiles (quietly: they're not "new")
  for (let l = 1; l <= (d.prestige > 0 ? MAX_LEVEL : d.level); l++) if (titleForLevel(l) && grant('title', titleForLevel(l), true)) changed = true;
  for (const id of Object.keys(d.achievements)) if (grant('card', 'a-' + id, true)) changed = true;
  // Prestige was renamed Rebirth: carry earned titles over under their new names
  const C = d.cosmetics, ren = (t) => (typeof t === 'string' && t.startsWith('PRESTIGE ') ? 'REBIRTH ' + t.slice(9) : t);
  if (C.titles.some((t) => t !== ren(t)) || C.title !== ren(C.title)) { C.titles = [...new Set(C.titles.map(ren))]; C.title = ren(C.title); changed = true; }
  if (changed) profile.save();
}

/** Swap one unfinished daily challenge for another. One free swap per day. */
export function reroll(i) {
  const L = profile.data.live, c = L.daily[i];
  if (!c || c.done || L.rerolls <= 0) return false;
  const [next] = pickChallenges(`reroll${L.day}:${i}:${c.id}`, 'daily', 1, 1, L.daily.map((x) => x.id));
  if (!next) return false;
  L.daily[i] = next; L.rerolls--; profile.save();
  return true;
}

// ------------------------------------------------------------------ SEASON PASS
export const tierOf = (xp) => Math.min(TIERS, Math.floor(xp / TIER_XP));
export function tierReward(n, t) {
  if (t === 10) return { kind: 'camo', id: `s${n}c1` };
  if (t === 25) return { kind: 'camo', id: `s${n}c2` };
  if (t === 50) return { kind: 'camo', id: `s${n}c3` };
  if (t === 15) return { kind: 'title', id: `${seasonName(n)} VETERAN` };
  if (t === 40) return { kind: 'title', id: `${seasonName(n)} ELITE` };
  if (t % 5 === 0) return { kind: 'card', id: `s${n}k${t}` };
  if (t % 5 === 3) return { kind: 'token', n: 1 };
  return { kind: 'xp', n: 1000 };
}
export function rewardLabel(r) {
  if (r.kind === 'xp') return `${r.n.toLocaleString('en-US')} XP`;
  if (r.kind === 'token') return r.n > 1 ? `${r.n} DOUBLE XP TOKENS` : 'DOUBLE XP TOKEN';
  return cosmeticLabel(r.kind, r.id);
}

/** Apply a reward. XP rewards from the season itself skip the season track so tiers can't chain. */
function applyReward(r, out, fromSeason = false) {
  if (r.kind === 'xp') { if (fromSeason) addLevels(out, profile.addXP(r.n)); else mergeGain(out, gainXP(r.n)); }
  else if (r.kind === 'token') profile.data.live.tokens += r.n;
  else grant(r.kind, r.id);
}

function addLevels(out, levels) {
  out.levels.push(...levels);
  for (const l of levels) {
    const t = titleForLevel(l);
    if (t && grant('title', t)) out.unlocks.push(cosmeticLabel('title', t));
    // every rebirth climbs the unlock ladder again
    for (const w of Object.values(WEAPONS)) if (w.unlock === l) out.unlocks.push(w.name);
    for (const s of Object.values(PERKS)) for (const p of s) if (p.unlock === l) out.unlocks.push(`${p.name} PERK`);
  }
  if (profile.data.level >= MAX_LEVEL && levels.includes(MAX_LEVEL) && profile.data.prestige < PRESTIGE_MAX) out.unlocks.push('REBIRTH AVAILABLE IN BARRACKS');
}
function mergeGain(out, g) { out.levels.push(...g.levels); out.tiers.push(...g.tiers); out.unlocks.push(...g.unlocks); }

/** Earn XP: player level and season tiers. Returns { levels, tiers, unlocks }. */
export function gainXP(n) {
  const out = { levels: [], tiers: [], unlocks: [] };
  addLevels(out, profile.addXP(n));
  const S = profile.data.live.season, s = seasonInfo();
  if (S.id !== s.id) { S.id = s.id; S.xp = 0; }
  const before = tierOf(S.xp);
  S.xp += n;
  for (let t = before + 1; t <= tierOf(S.xp); t++) {
    const r = tierReward(s.n, t);
    out.tiers.push(t); out.unlocks.push(`TIER ${t} · ${rewardLabel(r)}`);
    applyReward(r, out, true);
  }
  return out;
}

// ------------------------------------------------------------------ SUPPLY DROP (daily login)
export const DROP_CYCLE = [{ kind: 'xp', n: 1500 }, { kind: 'token', n: 1 }, { kind: 'xp', n: 2500 }, { kind: 'card' }, { kind: 'xp', n: 3500 }, { kind: 'token', n: 1 }, { kind: 'camo' }];
export function dropState() {
  const L = profile.data.live.login, today = dayIndex();
  const claimed = L.last === today;
  const streak = claimed ? L.streak : L.last === today - 1 ? L.streak + 1 : 1;
  return { claimed, streak, day: (streak - 1) % 7, broken: !claimed && L.last >= 0 && L.last < today - 1 && L.streak > 1, lost: L.streak };
}
export function dropReward(day) {
  const base = DROP_CYCLE[day];
  if (base.kind === 'card') { const id = DROP_CARDS.find((c) => !owns('card', c)); return id ? { kind: 'card', id } : { kind: 'xp', n: 5000 }; }
  if (base.kind === 'camo') { const id = DROP_CAMOS.find((c) => !owns('camo', c)); return id ? { kind: 'camo', id } : { kind: 'xp', n: 7500 }; }
  return base;
}
export function claimDrop() {
  const st = dropState();
  if (st.claimed) return null;
  const L = profile.data.live.login;
  L.last = dayIndex(); L.streak = st.streak; L.total++;
  const r = dropReward(st.day), out = { levels: [], tiers: [], unlocks: [], reward: rewardLabel(r), streak: st.streak };
  applyReward(r, out);
  for (const [n, t] of [[7, 'LOYALIST'], [30, 'IRON WILL'], [100, 'CENTURION']]) if ((n === 100 ? L.total : L.streak) >= n && grant('title', t)) out.unlocks.push(cosmeticLabel('title', t));
  profile.save();
  return out;
}

// ------------------------------------------------------------------ REBIRTH (max level 60 -> level 1, rebirth +1)
export const canPrestige = () => profile.data.level >= MAX_LEVEL && profile.data.prestige < PRESTIGE_MAX;
/**
 * Rebirth: back to level 1 with every weapon and perk locked again, except the loadout chosen here (custom class
 * index), which is kept for good alongside the ones kept at earlier rebirths. That loadout becomes the active one.
 */
export function enterPrestige(keepIndex = 0) {
  if (!canPrestige()) return false;
  const d = profile.data, c = d.classes[keepIndex] || d.classes[0];
  d.kept.push({ name: c.name, loadout: { ...c.loadout, perks: [...c.loadout.perks] } });
  d.prestige++; d.level = 1; d.xp = 0;
  normalizeClasses(d);   // custom classes fall back to what level 1 allows
  profile.selectClass(d.classes.length + d.kept.length - 1);
  grant('card', 'p' + d.prestige); grant('title', `REBIRTH ${roman(d.prestige)}`);
  if (d.prestige === PRESTIGE_MAX) grant('title', 'REBIRTH MASTER');
  profile.save();
  return true;
}

// ------------------------------------------------------------------ MATCH SESSION
const WEAPON_BY_NAME = Object.fromEntries(Object.values(WEAPONS).map((w) => [w.name, w]));

/** Buffers one match's challenge, weapon and XP progress; commit() applies it when the match ends. */
export class MatchSession {
  constructor(game) {
    refresh();
    this.game = game;
    this.assignment = new AssignmentRun(profile.data);
    this.delta = new Map();   // challenge object -> progress this match
    this.toasted = new Set();
    this.weaponXP = {}; this.weaponKills = {};
    this.boost = boosts(game.cfg);
    // pinned at match start: a match that runs past midnight still counts toward the challenges and day it started on
    const L = profile.data.live;
    this.day = dayIndex();
    this.list = [...L.daily, ...L.weekly];
  }

  get challenges() { return this.list; }
  progress(c) { return Math.min(c.target, c.prog + (this.delta.get(c) || 0)); }

  event(stat, n = 1, ctx = {}) {
    const mode = this.game.mode?.id;
    this.assignment.event(stat, n, mode);
    if (stat === 'kill' && ctx.headshot) this.assignment.event('headshot', n, mode);
    if (!this.assignmentNotified && this.assignment.preview(profile.data).ready) {
      this.assignmentNotified = true;
      this.game.hud.toast('FIELD ASSIGNMENT READY · FINISH THE MATCH TO CLAIM', 'gold');
    }
    for (const c of this.challenges) {
      const def = BY_ID[c.id];
      if (!def || c.done || def.stat !== stat || (def.mode && def.mode !== mode) || (def.when && !def.when(ctx))) continue;
      this.delta.set(c, (this.delta.get(c) || 0) + n);
      if (!this.toasted.has(c) && this.progress(c) >= c.target) { this.toasted.add(c); this.game.hud.challenge(challengeText(c), c.xp, c.scope); }
    }
  }

  /** A player kill. weaponName is the kill-feed weapon; ctx carries headshot / melee / explosive / longshot. */
  kill(weaponName, ctx) {
    const def = WEAPON_BY_NAME[weaponName];
    if (def) {
      ctx.cls = def.cls;
      const before = weaponLevel(weaponXP(def.id) + (this.weaponXP[def.id] || 0)).level;
      this.weaponXP[def.id] = (this.weaponXP[def.id] || 0) + KILL_WXP + (ctx.headshot ? HEADSHOT_WXP : 0) + (ctx.longshot ? LONGSHOT_WXP : 0);
      this.weaponKills[def.id] = (this.weaponKills[def.id] || 0) + 1;
      const after = weaponLevel(weaponXP(def.id) + this.weaponXP[def.id]).level;
      if (after > before) this.game.hud.weaponLevel(def.name, after);
    }
    this.event('kill', 1, ctx);
  }

  commit(result) {
    if (this.report) return this.report;
    const g = this.game, d = profile.data, L = d.live, st = g.stats;
    this.event('match');
    if (result.outcome === 'win') this.event('win');
    const rep = { rows: [], challenges: [], weapons: [], unlocks: [], levels: [], tiers: [], boosts: this.boost.list, mult: this.boost.mult };
    const lvlFrom = { level: d.level, xp: d.xp, prestige: d.prestige }, tierFrom = tierOf(L.season.xp);
    // challenges
    let chXP = 0;
    for (const [c, n] of this.delta) {
      if (c.done) continue;
      c.prog = Math.min(c.target, c.prog + n);
      if (c.prog >= c.target) { c.done = true; chXP += c.xp; }
    }
    rep.challenges = this.challenges.map((c) => ({ text: challengeText(c), scope: c.scope, prog: c.prog, target: c.target, done: c.done, gained: this.delta.get(c) || 0, xp: c.xp, mode: challengeMode(c) }));
    // XP breakdown
    const bonus = result.bonus || 0;
    rep.rows.push(['SCORE', st.xp - bonus]);
    if (bonus) rep.rows.push([result.outcome === 'win' ? 'VICTORY BONUS' : 'MATCH BONUS', bonus]);
    let total = Math.round(st.xp * this.boost.mult);
    if (this.boost.mult > 1) rep.rows.push([`BOOST ×${this.boost.mult}`, total - st.xp]);
    if (result.outcome === 'win' && L.firstWin !== this.day) { L.firstWin = this.day; rep.rows.push(['FIRST WIN OF THE DAY', FIRST_WIN_XP]); total += FIRST_WIN_XP; }
    if (chXP) { rep.rows.push(['CHALLENGES', chXP]); total += chXP; }
    rep.assignment = this.assignment.commit(d);
    if (rep.assignment?.earned) { rep.rows.push(['FIELD ASSIGNMENT · STAGE ' + rep.assignment.stage, rep.assignment.earned]); total += rep.assignment.earned; }
    if (rep.assignment?.mastered && grant('title', rep.assignment.title)) rep.unlocks.push(cosmeticLabel('title', rep.assignment.title));
    rep.records = recordMatch(d, g);
    if (L.daily.length && L.daily.every((c) => c.done) && !L.dailySweep) { L.dailySweep = true; rep.rows.push(['ALL DAILIES COMPLETE', DAILY_SWEEP_XP]); total += DAILY_SWEEP_XP; }
    if (L.weekly.length && L.weekly.every((c) => c.done) && !L.weeklySweep) {
      L.weeklySweep = true;
      if (grant('card', 'w' + L.week)) rep.unlocks.push(cosmeticLabel('card', 'w' + L.week));
    }
    rep.total = total;
    if (this.boost.token) L.tokenSeconds = Math.max(0, L.tokenSeconds - g.time);
    // weapons
    for (const [id, xp] of Object.entries(this.weaponXP)) {
      const w = addWeaponXP(id, xp, this.weaponKills[id] || 0);
      rep.weapons.push(w); rep.unlocks.push(...w.unlocks);
    }
    // player level + season
    mergeGain(rep, gainXP(total));
    rep.level = { from: lvlFrom, to: d.level, xp: d.xp, need: xpForLevel(d.level), max: d.level >= MAX_LEVEL };
    rep.season = { from: tierFrom, to: tierOf(L.season.xp), xp: L.season.xp, ...seasonInfo() };
    refresh();
    profile.save();
    this.report = rep;
    return rep;
  }
}
