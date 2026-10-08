// Cosmetic catalog: camos, calling cards, titles and seasons. Pure data and generators, no game state.
// Season and weekly items are generated from their id, so every new season and week ships a fresh set of
// rewards without new data files, and an item looks the same on every machine.
import { seeded } from './utils.js';

// ------------------------------------------------------------------ SEASONS
// A season is one calendar month. October 2026 is Season 1.
export const SEASONS = [
  { name: 'ZERO HOUR', pal: ['#2c3a46', '#f2b33d', '#11161b', '#5d6f7d'] },
  { name: 'IRON TIDE', pal: ['#1d3b4f', '#4f8fb3', '#0c1a24', '#a9c9d8'] },
  { name: 'DEAD WINTER', pal: ['#c9d4dc', '#7f94a3', '#3e4c57', '#f4f8fb'] },
  { name: 'BLACK SANDS', pal: ['#2a241c', '#8a6a3d', '#14110d', '#c9a46a'] },
  { name: 'RED HARBOR', pal: ['#3a0f12', '#b3262c', '#170809', '#e4685a'] },
  { name: 'STORMFRONT', pal: ['#2b2f45', '#6e74b8', '#14162a', '#c3c8f2'] },
  { name: 'NIGHTFALL', pal: ['#0d0f1a', '#3b2a6b', '#1b1f3a', '#9b7bff'] },
  { name: 'HIGH GROUND', pal: ['#3b4a2a', '#8fa35a', '#20281a', '#d2d8a8'] },
  { name: 'SCORCHED EARTH', pal: ['#2a1408', '#d1541a', '#120804', '#f2a33d'] },
  { name: 'DEEP STRIKE', pal: ['#06232a', '#0f8a8a', '#031418', '#7fe3d2'] },
  { name: 'LAST LIGHT', pal: ['#3a2a1a', '#f2c46d', '#1a1410', '#fff2c8'] },
  { name: 'IRON CROWN', pal: ['#1d1d1f', '#c9a227', '#38383c', '#f6e08a'] },
];
export const seasonOf = (n) => SEASONS[(Math.max(1, n) - 1) % SEASONS.length];
export const seasonName = (n) => seasonOf(n).name;

// ------------------------------------------------------------------ CAMOS
// type: 0 blotch · 1 digital · 2 stripes · 3 carbon weave · 4 solid · 5 gold · 6 diamond · 7 dark matter
export const CAMOS = {
  none: { name: 'FACTORY' },
  // weapon mastery (per weapon, by weapon level)
  woodland: { name: 'WOODLAND', type: 0, colors: ['#3b4a2a', '#56653a', '#24241a', '#76664a'], scale: 14 },
  desert: { name: 'DESERT', type: 0, colors: ['#a68a5d', '#c2a878', '#7d6340', '#ddcba4'], scale: 12 },
  digital: { name: 'DIGITAL', type: 1, colors: ['#4f5a63', '#6f7b84', '#2f363c', '#9aa4ab'], scale: 10 },
  urban: { name: 'URBAN', type: 0, colors: ['#55595d', '#878b8f', '#26282b', '#c2c5c8'], scale: 16 },
  tiger: { name: 'TIGER', type: 2, colors: ['#c98a2e', '#16110d', '#e2ab4c', '#000000'], scale: 9 },
  carbon: { name: 'CARBON', type: 3, colors: ['#15171a', '#3a3e43'], scale: 90, metal: 0.35, rough: 0.32 },
  gold: { name: 'GOLD', type: 5, colors: ['#c9962f', '#f6d77a'], scale: 6, metal: 1, rough: 0.2 },
  diamond: { name: 'DIAMOND', type: 6, colors: ['#e6f4ff', '#9fd8ff'], scale: 34, metal: 0.85, rough: 0.07 },
  darkmatter: { name: 'DARK MATTER', type: 7, colors: ['#08040f', '#2a0f4a', '#b14dff'], scale: 7, metal: 0.6, rough: 0.3 },
  // supply drop exclusives (shared by every weapon)
  crimson: { name: 'CRIMSON', type: 4, colors: ['#8e1b20', '#5a0f13'], scale: 8, metal: 0.4, rough: 0.35 },
  arctic: { name: 'ARCTIC', type: 0, colors: ['#e8eef2', '#b9c7d1', '#8197a6', '#ffffff'], scale: 13 },
  cobalt: { name: 'COBALT', type: 4, colors: ['#1d4fa8', '#0f2d66'], scale: 8, metal: 0.8, rough: 0.25 },
  jade: { name: 'JADE', type: 0, colors: ['#1f6b4f', '#2f8f69', '#0f3a2b', '#7fd1a8'], scale: 11, metal: 0.3, rough: 0.3 },
  obsidian: { name: 'OBSIDIAN', type: 3, colors: ['#050506', '#1d1e22'], scale: 110, metal: 0.5, rough: 0.12 },
  sunset: { name: 'SUNSET', type: 2, colors: ['#ff7a1a', '#3a1450', '#ffb347', '#000000'], scale: 8 },
  neon: { name: 'NEON', type: 1, colors: ['#ff2fa8', '#21e6ff', '#14101f', '#8a2be2'], scale: 9 },
  ember: { name: 'EMBER', type: 7, colors: ['#120604', '#3a120a', '#ff6a1a'], scale: 6, metal: 0.4, rough: 0.4 },
  sandstorm: { name: 'SANDSTORM', type: 1, colors: ['#b59c6e', '#d6c194', '#8a7550', '#efe2c0'], scale: 9 },
  nightops: { name: 'NIGHT OPS', type: 0, colors: ['#14181d', '#232a31', '#0a0c0e', '#323b44'], scale: 15 },
};
export const MASTERY = [['woodland', 2], ['desert', 4], ['digital', 6], ['urban', 9], ['tiger', 12], ['carbon', 16], ['gold', 20]];
export const DIAMOND_GOLDS = 5;
export const DROP_CAMOS = ['crimson', 'arctic', 'cobalt', 'jade', 'obsidian', 'sunset', 'neon', 'ember', 'sandstorm', 'nightops'];

/** Season camos are "s<season>c<1-3>": FIELD, ELITE and LEGEND variants in the season's palette. */
export function camoDef(id) {
  if (CAMOS[id]) return CAMOS[id];
  const m = /^s(\d+)c([123])$/.exec(id || '');
  if (!m) return null;
  const n = +m[1], k = +m[2], s = seasonOf(n), r = seeded(id);
  const type = k === 1 ? [0, 1][Math.floor(r() * 2)] : k === 2 ? [2, 3][Math.floor(r() * 2)] : 7;
  const p = s.pal;
  const colors = type === 7 ? [p[2], p[0], p[1]] : type === 3 ? [p[2], p[0]] : [p[0], p[1], p[2], p[3]];
  return { name: `${s.name} ${['FIELD', 'ELITE', 'LEGEND'][k - 1]}`, type, colors, scale: type === 3 ? 90 : 8 + r() * 6, metal: type === 7 ? 0.6 : undefined, rough: type === 7 ? 0.3 : undefined, season: n };
}

// ------------------------------------------------------------------ CALLING CARDS
const EMBLEMS = [
  'M32 6l7.6 15.4 17 2.5-12.3 12 2.9 16.9L32 44.8 16.8 52.8l2.9-16.9-12.3-12 17-2.5z',                 // star
  'M8 20l24-12 24 12v8L32 16 8 28zm0 16l24-12 24 12v8L32 32 8 44zm0 16l24-12 24 12v6L32 48 8 58z',   // chevrons
  'M30 4h4v14h-4zm0 42h4v14h-4zM4 30h14v4H4zm42 0h14v4H46zM32 14a18 18 0 1 1 0 36 18 18 0 0 1 0-36zm0 4a14 14 0 1 0 0 28 14 14 0 0 0 0-28z', // crosshair
  'M32 18c6 0 10 4 10 10v6l18-10-6 14 8 2-18 6-12 10-12-10-18-6 8-2-6-14 18 10v-6c0-6 4-10 10-10z',     // wings
  'M32 4l24 10v16c0 16-10 26-24 32C18 56 8 46 8 30V14z',                                            // shield
  'M32 6a26 26 0 1 1 0 52 26 26 0 0 1 0-52zm0 8l-6 14h-14l11 9-4 15 13-9 13 9-4-15 11-9h-14z',     // medal
  'M30 4h4v8a20 20 0 0 1 16 24h8v4h-8.5A20 20 0 0 1 34 54v6h-4v-6a20 20 0 0 1-15.5-14H6v-4h8.5A20 20 0 0 1 30 12z', // anchor-ish compass
  'M10 54L32 8l22 46-22-12z',                                                                          // arrowhead
];
const CARD_NAMES = {
  default: 'IRONFRONT',
  d1: 'RECON SWEEP', d2: 'HOT ZONE', d3: 'IRON SIGHTS', d4: 'DUST OFF', d5: 'NIGHT WATCH', d6: 'STEEL RAIN',
  d7: 'DEAD DROP', d8: 'HIGH VALUE', d9: 'LONG WATCH', d10: 'BREACH & CLEAR', d11: 'CLEAN SWEEP', d12: 'FINAL STAND',
};
export const DROP_CARDS = Object.keys(CARD_NAMES).filter((k) => k[0] === 'd');
const SEASON_CARD_NAMES = ['INSIGNIA', 'VANGUARD', 'OUTRIDER', 'SENTINEL', 'WARDEN', 'SPEARHEAD', 'BULWARK', 'HARBINGER', 'PHANTOM', 'APEX'];
export const PRESTIGE_MAX = 5;   // rebirths (stored as prestige); Rebirth V at level 60 is the top rank
export const PRESTIGE_COLORS = ['#f2b33d', '#4fb3ff', '#79d9be', '#b48cff', '#ff7a5c', '#e8e8e8', '#57e389', '#ff5ca8', '#5ce1ff', '#ffd84a', '#ff3b3b'];
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export const roman = (n) => ROMAN[n] || String(n);

/** HSL → #rrggbb (hex so an alpha suffix can be appended). */
function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l), k = (n) => (n + h / 30) % 12;
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))).toString(16).padStart(2, '0');
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Calling card visual + name. ids: default, d<n> supply drops, p<n> prestige, a-<ACHIEVEMENT>, s<season>k<tier>,
 * w<week> weekly sweep rewards.
 */
export function cardDef(id, achievements = {}) {
  const r = seeded('card:' + id);
  let name = CARD_NAMES[id], pal = null, glyph = Math.floor(r() * EMBLEMS.length), tag = '';
  let m;
  if ((m = /^p(\d+)$/.exec(id))) { const n = +m[1]; name = `REBIRTH ${roman(n)}`; pal = [PRESTIGE_COLORS[n], '#101317', '#05070a', '#fff']; glyph = 5; tag = 'REBIRTH'; }
  else if ((m = /^s(\d+)k(\d+)$/.exec(id))) { const s = seasonOf(+m[1]); name = `${s.name} ${SEASON_CARD_NAMES[(+m[2] / 5 - 1) % SEASON_CARD_NAMES.length]}`; pal = s.pal; tag = `SEASON ${String(+m[1]).padStart(2, '0')}`; }
  else if ((m = /^w(\d+)$/.exec(id))) { const d = new Date((+m[1] * 7 - 3) * 86400000); name = `WEEKLY VETERAN ${d.toISOString().slice(5, 10).replace('-', '.')}`; tag = 'WEEKLY'; glyph = 1; }
  else if (id.startsWith('a-')) { name = (achievements[id.slice(2)]?.name || id.slice(2)).toUpperCase(); tag = 'ACHIEVEMENT'; glyph = 5; }
  else if (/^d\d+$/.test(id)) tag = 'SUPPLY DROP';
  if (!pal) { const h = r() * 360; pal = [hsl(h, 35, 22), hsl(h + 30, 70, 48), hsl(h - 20, 30, 9), hsl(h + 30, 90, 78)]; }
  const ang = Math.floor(r() * 180), gap = 6 + Math.floor(r() * 10);
  const bg = `repeating-linear-gradient(${ang}deg,rgba(255,255,255,.05) 0 2px,transparent 2px ${gap}px),` +
    `radial-gradient(circle at ${Math.floor(20 + r() * 60)}% ${Math.floor(r() * 100)}%,${pal[1]}99,transparent 62%),` +
    `linear-gradient(${ang + 90}deg,${pal[0]},${pal[2]})`;
  return { id, name: name || id.toUpperCase(), bg, emblem: EMBLEMS[glyph], accent: pal[3], tag };
}

// ------------------------------------------------------------------ TITLES
export const LEVEL_TITLES = { 1: 'RECRUIT', 5: 'PRIVATE', 10: 'CORPORAL', 15: 'SERGEANT', 20: 'STAFF SERGEANT', 25: 'LIEUTENANT', 30: 'CAPTAIN', 35: 'MAJOR', 40: 'COLONEL', 45: 'BRIGADIER', 50: 'GENERAL', 55: 'FIELD MARSHAL', 60: 'LEGEND' };
