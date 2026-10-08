import { WEAPONS, PERKS } from '../game/weapons.js';

const starter = () => ({primary:'vx4',secondary:'p17',perks:['lightweight','fasthands','quickfix']});
export const CLASS_NAMES = ['ASSAULT','BREACHER','RECON','SUPPORT','CUSTOM'];
// Default kit per class: first unlocked weapon in each list wins, locked perks fall back to the starter perk.
const CLASS_PRESETS = [
  {primary:['vx4'],secondary:['p17'],perks:['lightweight','fasthands','quickfix']},
  {primary:['ranger','kestrel'],secondary:['hellcat','p17'],perks:['lightweight','fasthands','stalker']},
  {primary:['longbow','arbiter','kestrel'],secondary:['p17'],perks:['mountaineer','reserves','steady']},
  {primary:['brutus','viper','vx4'],secondary:['striker','p17'],perks:['marathon','grenadier','focus']},
  {primary:['kestrel'],secondary:['p17'],perks:['lightweight','fasthands','quickfix']},
];
const preset = (i, level) => {
  const p = CLASS_PRESETS[i], pick = ids => ids.find(id => WEAPONS[id].unlock<=level) || ids[ids.length-1];
  return {primary:pick(p.primary),secondary:pick(p.secondary),perks:[...p.perks]};
};
const isStarter = lo => !!lo && lo.primary==='vx4' && lo.secondary==='p17' && starter().perks.every((p,i)=>lo.perks?.[i]===p);

export function normalizeClasses(data) {
  const level = data.level || 1;   // rebirth relocks everything; kept loadouts (below) are exempt
  const clean = (lo = {}) => {
    const valid = (id,slot,fallback) => WEAPONS[id]?.slot===slot && WEAPONS[id].unlock<=level ? id : fallback;
    return {primary:valid(lo.primary,'primary','vx4'),secondary:valid(lo.secondary,'secondary','p17'),
      perks:[1,2,3].map((slot,i)=>PERKS[slot].some(p=>p.id===lo.perks?.[i] && p.unlock<=level) ? lo.perks[i] : starter().perks[i])};
  };
  const existing = Array.isArray(data.classes) ? data.classes : [];
  // Saves from before kept loadouts: players who had already rebirthed keep their first classes, one per rebirth
  if (data.keptV !== 1) {
    data.prestige = Math.min(data.prestige || 0, 5);
    if (!Array.isArray(data.kept) || !data.kept.length) data.kept = existing.slice(0, data.prestige).filter((c) => c?.loadout).map((c) => ({ name: c.name, loadout: c.loadout }));
    data.keptV = 1;
  }
  const exists = (id, slot) => WEAPONS[id]?.slot === slot;
  data.kept = (Array.isArray(data.kept) ? data.kept : []).filter((k) => k?.loadout && exists(k.loadout.primary, 'primary') && exists(k.loadout.secondary, 'secondary')).slice(0, 5)
    .map((k) => ({ name: String(k.name || 'KEPT').slice(0, 18), loadout: { primary: k.loadout.primary, secondary: k.loadout.secondary, perks: [1, 2, 3].map((slot, i) => (PERKS[slot].some((p) => p.id === k.loadout.perks?.[i]) ? k.loadout.perks[i] : starter().perks[i])) } }));
  // older saves seeded every class with the starter kit; give untouched ones their class preset
  const reseed = data.classPresets !== 1;
  data.classes = CLASS_NAMES.map((name,i)=>{
    let lo = existing[i]?.loadout || (i===0 ? data.loadout : null);
    if (!lo || (reseed && i>0 && isStarter(lo))) lo = preset(i, level);
    return {name: typeof existing[i]?.name==='string' ? existing[i].name.toUpperCase().replace(/[^A-Z0-9 _-]/g,'').trim().slice(0,18) || name : name,loadout:clean(lo)};
  });
  data.classPresets = 1;
  const all = [...data.classes, ...data.kept];
  data.activeClass = Number.isInteger(data.activeClass) ? Math.max(0,Math.min(all.length - 1,data.activeClass)) : 0;
  data.loadout = all[data.activeClass].loadout;
}
