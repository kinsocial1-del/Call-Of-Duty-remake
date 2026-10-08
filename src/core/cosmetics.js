// Cosmetic ownership and weapon mastery. Weapons level up from kills; levels unlock that weapon's mastery camos
// (Woodland → Gold). Gold on enough weapons unlocks Diamond everywhere, and Gold on every weapon unlocks Dark Matter.
import { profile, ACHIEVEMENTS } from './save.js';
import { WEAPONS } from '../game/weapons.js';
import { CAMOS, MASTERY, DIAMOND_GOLDS, camoDef, cardDef, LEVEL_TITLES } from './catalog.js';

export const WEAPON_MAX = 20;
export const weaponXpFor = (l) => 500 + l * 150; // XP from weapon level l to l+1
export const KILL_WXP = 100, HEADSHOT_WXP = 50, LONGSHOT_WXP = 50;
const ALL_WEAPONS = () => Object.keys(WEAPONS);
const C = () => profile.data.cosmetics;

/** Level breakdown from lifetime weapon XP. */
export function weaponLevel(total) {
  let l = 1;
  while (l < WEAPON_MAX && total >= weaponXpFor(l)) { total -= weaponXpFor(l); l++; }
  return { level: l, into: l < WEAPON_MAX ? total : 0, need: l < WEAPON_MAX ? weaponXpFor(l) : 0 };
}
export const weaponXP = (id) => profile.data.weapons[id]?.xp || 0;
export const weaponInfo = (id) => ({ ...weaponLevel(weaponXP(id)), kills: profile.data.weapons[id]?.kills || 0 });
export const goldCount = () => ALL_WEAPONS().filter((id) => weaponLevel(weaponXP(id)).level >= WEAPON_MAX).length;

/** Requirement text if locked, or null if the camo is usable on this weapon. */
export function camoLock(wid, cid, golds = goldCount()) {
  if (!cid || cid === 'none') return null;
  const m = MASTERY.find(([id]) => id === cid);
  if (m) return weaponLevel(weaponXP(wid)).level >= m[1] ? null : `WEAPON LV ${m[1]}`;
  if (cid === 'diamond') return golds >= DIAMOND_GOLDS ? null : `GOLD ON ${DIAMOND_GOLDS} WEAPONS (${golds}/${DIAMOND_GOLDS})`;
  if (cid === 'darkmatter') { const n = ALL_WEAPONS().length; return golds >= n ? null : `GOLD ON ALL ${n} WEAPONS (${golds}/${n})`; }
  return C().camos.includes(cid) ? null : 'LOCKED';
}

/** Camo list for the loadout cycle: factory, the mastery ladder, then every universal camo the player owns. */
export function camoChoices(wid) {
  const golds = goldCount();
  const ids = ['none', ...MASTERY.map(([id]) => id), 'diamond', 'darkmatter', ...C().camos];
  return ids.map((id) => ({ id, name: camoDef(id)?.name || id, lock: camoLock(wid, id, golds) }));
}

/** Equipped camo id for a weapon, or null for factory finish. */
export function equippedCamo(wid) {
  const id = C().camo[wid];
  return id && id !== 'none' && camoDef(id) && !camoLock(wid, id) ? id : null;
}
export function equipCamo(wid, cid) { if (!camoLock(wid, cid)) { C().camo[wid] = cid; profile.save(); } }

/** Grant a universal cosmetic. Returns true if it was new. kind: camo | card | title */
export function grant(kind, id, quiet = false) {
  const c = C(), list = kind === 'camo' ? c.camos : kind === 'card' ? c.cards : c.titles;
  if (!id || list.includes(id)) return false;
  list.push(id);
  if (!quiet) c.fresh.push(`${kind}:${id}`);
  return true;
}
export const owns = (kind, id) => (kind === 'camo' ? C().camos : kind === 'card' ? C().cards : C().titles).includes(id);

export function cosmeticLabel(kind, id) {
  if (kind === 'camo') return `${camoDef(id)?.name || id} CAMO`;
  if (kind === 'card') return `${cardDef(id, ACHIEVEMENTS).name} CALLING CARD`;
  return `"${id}" TITLE`;
}

export const titleForLevel = (l) => LEVEL_TITLES[l];

/**
 * Add weapon XP after a match. Returns a summary with level change and any camos it unlocked,
 * including Diamond / Dark Matter when this weapon's Gold tipped the count.
 */
export function addWeaponXP(id, xp, kills = 0) {
  const w = (profile.data.weapons[id] ||= { xp: 0, kills: 0 });
  const goldsBefore = goldCount();
  const from = weaponLevel(w.xp).level;
  w.xp += xp; w.kills += kills;
  const after = weaponLevel(w.xp);
  const unlocks = [];
  for (const [cid, lv] of MASTERY) if (lv > from && lv <= after.level) unlocks.push(`${WEAPONS[id].name} · ${CAMOS[cid].name} CAMO`);
  const golds = goldCount(), n = ALL_WEAPONS().length;
  if (after.level >= WEAPON_MAX && from < WEAPON_MAX && grant('title', 'GOLDSMITH')) unlocks.push(cosmeticLabel('title', 'GOLDSMITH'));
  if (goldsBefore < DIAMOND_GOLDS && golds >= DIAMOND_GOLDS) { unlocks.push('DIAMOND CAMO · ALL WEAPONS'); grant('title', 'DIAMOND OPERATOR'); }
  if (goldsBefore < n && golds >= n) { unlocks.push('DARK MATTER CAMO · ALL WEAPONS'); grant('title', 'VOID WALKER'); }
  return { id, name: WEAPONS[id].name, xp, from, to: after.level, into: after.into, need: after.need, unlocks };
}

/** Next mastery camo for a weapon, for "next unlock" hints. */
export function nextMastery(wid) {
  const lv = weaponLevel(weaponXP(wid)).level;
  const m = MASTERY.find(([, l]) => l > lv);
  return m ? { name: CAMOS[m[0]].name, level: m[1] } : null;
}

export function freshCount() { return C().fresh.length; }
export function clearFresh() { if (C().fresh.length) { C().fresh = []; profile.save(); } }
