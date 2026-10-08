// Weapon definitions + weapon models (shared by first-person viewmodel and third-person bots).
// Guns use real CC0 3D models (Flat Guns West/East, converted by tools/convert_guns.py); optics and the
// launcher are built procedurally, and every gun falls back to its procedural model if assets fail to load.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { applyCamo } from './camo.js';
import { markShared } from '../core/utils.js';

export const WEAPONS = {
  vx4: {
    id: 'vx4', name: 'VX-4 CARBINE', cls: 'ASSAULT RIFLE', slot: 'primary', unlock: 1,
    dmg: [30, 22], range: [28, 55], rpm: 760, mode: 'auto', mag: 30, reserve: 180, reload: 2.0, reloadEmpty: 2.5,
    adsTime: 0.22, zoom: 0.78, move: 0.96, hip: 3.4, adsSpread: 0.12, recoil: { up: 0.55, side: 0.28, kick: 0.035, roll: 1.2 },
    head: 1.4, limb: 0.9, sound: { crack: 2300, decay: 0.13, body: 1.0, kick: 120, sample: 'ar' }, model: 'ar', sight: 'dot', sightH: 0.112, bot: true,
  },
  kestrel: {
    id: 'kestrel', name: 'KESTREL SMG', cls: 'SUBMACHINE GUN', slot: 'primary', unlock: 1,
    dmg: [27, 15], range: [12, 30], rpm: 920, mode: 'auto', mag: 32, reserve: 224, reload: 1.7, reloadEmpty: 2.1,
    adsTime: 0.16, zoom: 0.85, move: 1.06, hip: 2.6, adsSpread: 0.2, recoil: { up: 0.42, side: 0.36, kick: 0.028, roll: 1.6 },
    head: 1.3, limb: 0.9, sound: { crack: 2900, decay: 0.09, body: 0.75, kick: 140, sample: 'smg' }, model: 'smg', sight: 'holo', sightH: 0.103, bot: true,
  },
  ranger: {
    id: 'ranger', name: 'RANGER 12', cls: 'SHOTGUN', slot: 'primary', unlock: 3,
    dmg: [16, 5], range: [7, 20], rpm: 75, mode: 'pump', mag: 7, reserve: 35, reload: 0.5, reloadEmpty: 0.5, shellReload: true,
    adsTime: 0.2, zoom: 0.88, move: 1.0, hip: 5.5, adsSpread: 4.2, pellets: 9, recoil: { up: 3.2, side: 0.8, kick: 0.09, roll: 3 },
    head: 1.2, limb: 1, sound: { crack: 1500, decay: 0.2, body: 1.6, kick: 90, vol: 1.2, sample: 'shotgun' }, model: 'shotgun', sight: 'iron', sightH: 0.076, bot: true,
  },
  longbow: {
    id: 'longbow', name: 'LONGBOW .338', cls: 'SNIPER RIFLE', slot: 'primary', unlock: 5,
    dmg: [115, 105], range: [60, 120], rpm: 48, mode: 'bolt', mag: 5, reserve: 30, reload: 2.9, reloadEmpty: 3.4,
    adsTime: 0.38, zoom: 0.24, move: 0.88, hip: 7, adsSpread: 0, recoil: { up: 3.8, side: 0.6, kick: 0.12, roll: 2 },
    head: 2.2, limb: 0.8, sound: { crack: 1700, decay: 0.28, body: 1.9, kick: 70, vol: 1.3, verb: 0.8, tail: 1.2, sample: 'sniper' }, model: 'sniper', sight: 'scope', sightH: 0.105, scope: true, bot: true,
  },
  viper: {
    id: 'viper', name: 'VIPER BR', cls: 'BURST RIFLE', slot: 'primary', unlock: 6,
    dmg: [34, 27], range: [32, 60], rpm: 920, mode: 'burst', burst: 3, burstDelay: 0.24, mag: 30, reserve: 180, reload: 2.2, reloadEmpty: 2.6,
    adsTime: 0.24, zoom: 0.74, move: 0.95, hip: 3.6, adsSpread: 0.08, recoil: { up: 0.5, side: 0.15, kick: 0.03, roll: 0.8 },
    head: 1.4, limb: 0.9, sound: { crack: 2100, decay: 0.12, body: 1.05, kick: 115, sample: 'akm' }, model: 'bullpup', sight: 'dot', sightH: 0.108, bot: true,
  },
  brutus: {
    id: 'brutus', name: 'BRUTUS LMG', cls: 'LIGHT MACHINE GUN', slot: 'primary', unlock: 9,
    dmg: [32, 25], range: [35, 65], rpm: 640, mode: 'auto', mag: 100, reserve: 300, reload: 4.6, reloadEmpty: 5.2,
    adsTime: 0.38, zoom: 0.74, move: 0.85, hip: 5, adsSpread: 0.22, recoil: { up: 0.48, side: 0.34, kick: 0.04, roll: 1.4 },
    head: 1.3, limb: 0.9, sound: { crack: 1900, decay: 0.15, body: 1.3, kick: 100, vol: 1.1, sample: 'lmg' }, model: 'lmg', sight: 'dot', sightH: 0.13, bot: true,
  },
  arbiter: {
    id: 'arbiter', name: 'ARBITER DMR', cls: 'MARKSMAN RIFLE', slot: 'primary', unlock: 12,
    dmg: [52, 44], range: [45, 90], rpm: 330, mode: 'semi', mag: 15, reserve: 90, reload: 2.4, reloadEmpty: 2.8,
    adsTime: 0.3, zoom: 0.5, move: 0.92, hip: 4.2, adsSpread: 0.02, recoil: { up: 1.4, side: 0.3, kick: 0.06, roll: 1.4 },
    head: 1.75, limb: 0.9, sound: { crack: 1800, decay: 0.18, body: 1.4, kick: 85, vol: 1.15, sample: 'dmr' }, model: 'dmr', sight: 'acog', sightH: 0.112, bot: false,
  },
  p17: {
    id: 'p17', name: 'P-17 SIDEARM', cls: 'PISTOL', slot: 'secondary', unlock: 1,
    dmg: [34, 20], range: [12, 28], rpm: 420, mode: 'semi', mag: 15, reserve: 75, reload: 1.4, reloadEmpty: 1.7,
    adsTime: 0.13, zoom: 0.88, move: 1.08, hip: 2.4, adsSpread: 0.25, recoil: { up: 1.1, side: 0.3, kick: 0.05, roll: 2 },
    head: 1.5, limb: 0.9, sound: { crack: 2600, decay: 0.1, body: 0.75, kick: 150, vol: 0.85, sample: 'pistol' }, model: 'pistol', sight: 'iron', sightH: 0.065,
  },
  hellcat: {
    id: 'hellcat', name: 'HELLCAT MP', cls: 'MACHINE PISTOL', slot: 'secondary', unlock: 4,
    dmg: [22, 13], range: [9, 22], rpm: 1100, mode: 'auto', mag: 22, reserve: 110, reload: 1.5, reloadEmpty: 1.8,
    adsTime: 0.12, zoom: 0.9, move: 1.08, hip: 2.4, adsSpread: 0.5, recoil: { up: 0.5, side: 0.5, kick: 0.03, roll: 2 },
    head: 1.3, limb: 0.9, sound: { crack: 3000, decay: 0.08, body: 0.6, kick: 160, vol: 0.85, sample: 'mpistol' }, model: 'mpistol', sight: 'iron', sightH: 0.067,
  },
  striker: {
    id: 'striker', name: 'STRIKER LAUNCHER', cls: 'LAUNCHER', slot: 'secondary', unlock: 14,
    dmg: [150, 150], range: [0, 0], rpm: 40, mode: 'semi', mag: 1, reserve: 2, reload: 3.2, reloadEmpty: 3.2,
    adsTime: 0.4, zoom: 0.7, move: 0.9, hip: 1.5, adsSpread: 0, recoil: { up: 4, side: 1, kick: 0.15, roll: 3 },
    head: 1, limb: 1, rocket: true, sound: { crack: 600, decay: 0.4, body: 2, kick: 60, vol: 1.2, verb: 0.8 }, model: 'launcher', sight: 'iron', sightH: 0.13,
  },
  // ---------------------------------------------------------------- expansion arsenal (unlocks spread over levels 2-59)
  vandal: {
    id: 'vandal', name: 'VANDAL 9', cls: 'PISTOL', slot: 'secondary', unlock: 2,
    dmg: [28, 18], range: [11, 26], rpm: 520, mode: 'semi', mag: 17, reserve: 85, reload: 1.3, reloadEmpty: 1.6,
    adsTime: 0.12, zoom: 0.9, move: 1.08, hip: 2.3, adsSpread: 0.45, recoil: { up: 1.0, side: 0.35, kick: 0.045, roll: 2 },
    head: 1.5, limb: 0.9, sound: { crack: 2700, decay: 0.09, body: 0.7, kick: 155, vol: 0.8, sample: 'pistol' }, model: 'pistol', sight: 'iron', sightH: 0.065,
  },
  hornet: {
    id: 'hornet', name: 'HORNET SMG', cls: 'SUBMACHINE GUN', slot: 'primary', unlock: 7,
    dmg: [24, 14], range: [10, 26], rpm: 1050, mode: 'auto', mag: 30, reserve: 210, reload: 1.6, reloadEmpty: 2.0,
    adsTime: 0.15, zoom: 0.86, move: 1.07, hip: 2.5, adsSpread: 0.22, recoil: { up: 0.38, side: 0.4, kick: 0.026, roll: 1.7 },
    head: 1.3, limb: 0.9, sound: { crack: 3000, decay: 0.08, body: 0.7, kick: 145, sample: 'smg' }, model: 'smg', sight: 'holo', sightH: 0.1, bot: true,
  },
  huntsman: {
    id: 'huntsman', name: 'HUNTSMAN PUMP', cls: 'SHOTGUN', slot: 'primary', unlock: 10,
    dmg: [18, 6], range: [8, 22], rpm: 70, mode: 'pump', mag: 6, reserve: 30, reload: 0.5, reloadEmpty: 0.5, shellReload: true,
    adsTime: 0.22, zoom: 0.88, move: 0.98, hip: 5.2, adsSpread: 3.8, pellets: 8, recoil: { up: 3.4, side: 0.8, kick: 0.095, roll: 3 },
    head: 1.2, limb: 1, sound: { crack: 1450, decay: 0.22, body: 1.7, kick: 85, vol: 1.25, sample: 'shotgun' }, model: 'shotgun', sight: 'iron', sightH: 0.076, bot: true,
  },
  orion: {
    id: 'orion', name: 'ORION M4', cls: 'ASSAULT RIFLE', slot: 'primary', unlock: 13,
    dmg: [28, 21], range: [26, 52], rpm: 830, mode: 'auto', mag: 30, reserve: 180, reload: 1.9, reloadEmpty: 2.4,
    adsTime: 0.2, zoom: 0.78, move: 0.98, hip: 3.2, adsSpread: 0.12, recoil: { up: 0.5, side: 0.32, kick: 0.032, roll: 1.2 },
    head: 1.4, limb: 0.9, sound: { crack: 2400, decay: 0.12, body: 0.95, kick: 125, sample: 'ar' }, model: 'ar', sight: 'holo', sightH: 0.11, bot: true,
  },
  komisar: {
    id: 'komisar', name: 'KOMISAR TT', cls: 'PISTOL', slot: 'secondary', unlock: 16,
    dmg: [42, 26], range: [13, 28], rpm: 320, mode: 'semi', mag: 8, reserve: 48, reload: 1.5, reloadEmpty: 1.8,
    adsTime: 0.14, zoom: 0.9, move: 1.06, hip: 2.6, adsSpread: 0.4, recoil: { up: 1.5, side: 0.4, kick: 0.06, roll: 2.4 },
    head: 1.5, limb: 0.9, sound: { crack: 2400, decay: 0.12, body: 0.9, kick: 140, vol: 0.95, sample: 'pistol' }, model: 'pistol', sight: 'iron', sightH: 0.065,
  },
  jackal: {
    id: 'jackal', name: 'JACKAL SMG', cls: 'SUBMACHINE GUN', slot: 'primary', unlock: 18,
    dmg: [31, 18], range: [14, 32], rpm: 760, mode: 'auto', mag: 30, reserve: 210, reload: 1.8, reloadEmpty: 2.2,
    adsTime: 0.17, zoom: 0.85, move: 1.05, hip: 2.7, adsSpread: 0.18, recoil: { up: 0.45, side: 0.3, kick: 0.03, roll: 1.4 },
    head: 1.3, limb: 0.9, sound: { crack: 2800, decay: 0.1, body: 0.8, kick: 135, sample: 'smg' }, model: 'smg', sight: 'dot', sightH: 0.1, bot: true,
  },
  warden: {
    id: 'warden', name: 'WARDEN BOLT', cls: 'SNIPER RIFLE', slot: 'primary', unlock: 20,
    dmg: [100, 90], range: [55, 110], rpm: 55, mode: 'bolt', mag: 6, reserve: 36, reload: 2.6, reloadEmpty: 3.1,
    adsTime: 0.34, zoom: 0.28, move: 0.9, hip: 6.5, adsSpread: 0, recoil: { up: 3.4, side: 0.6, kick: 0.11, roll: 2 },
    head: 2.1, limb: 0.8, sound: { crack: 1750, decay: 0.26, body: 1.8, kick: 72, vol: 1.25, verb: 0.8, tail: 1.1, sample: 'sniper' }, model: 'sniper', sight: 'scope', sightH: 0.105, scope: true, bot: true,
  },
  breaker: {
    id: 'breaker', name: 'BREAKER AUTO-12', cls: 'SHOTGUN', slot: 'primary', unlock: 23,
    dmg: [13, 4], range: [6, 16], rpm: 260, mode: 'semi', mag: 8, reserve: 32, reload: 2.4, reloadEmpty: 2.9,
    adsTime: 0.22, zoom: 0.88, move: 0.97, hip: 5.6, adsSpread: 4.5, pellets: 8, recoil: { up: 2.6, side: 0.9, kick: 0.08, roll: 2.6 },
    head: 1.2, limb: 1, sound: { crack: 1550, decay: 0.18, body: 1.5, kick: 95, vol: 1.15, sample: 'shotgun' }, model: 'shotgun', sight: 'iron', sightH: 0.076,
  },
  krait: {
    id: 'krait', name: 'KRAIT BR-7', cls: 'ASSAULT RIFLE', slot: 'primary', unlock: 26,
    dmg: [40, 31], range: [32, 62], rpm: 560, mode: 'auto', mag: 20, reserve: 140, reload: 2.3, reloadEmpty: 2.8,
    adsTime: 0.27, zoom: 0.76, move: 0.92, hip: 3.8, adsSpread: 0.1, recoil: { up: 0.85, side: 0.3, kick: 0.05, roll: 1.5 },
    head: 1.4, limb: 0.9, sound: { crack: 2000, decay: 0.15, body: 1.25, kick: 105, vol: 1.1, sample: 'akm' }, model: 'ar', sight: 'dot', sightH: 0.11, bot: true,
  },
  strelka: {
    id: 'strelka', name: 'STRELKA AK', cls: 'ASSAULT RIFLE', slot: 'primary', unlock: 29,
    dmg: [35, 27], range: [28, 58], rpm: 620, mode: 'auto', mag: 30, reserve: 180, reload: 2.3, reloadEmpty: 2.8,
    adsTime: 0.25, zoom: 0.8, move: 0.95, hip: 3.6, adsSpread: 0.13, recoil: { up: 0.72, side: 0.4, kick: 0.045, roll: 1.6 },
    head: 1.4, limb: 0.9, sound: { crack: 2100, decay: 0.13, body: 1.1, kick: 110, sample: 'akm' }, model: 'ar', sight: 'iron', sightH: 0.1, bot: true,
  },
  wasp: {
    id: 'wasp', name: 'WASP PDW', cls: 'SUBMACHINE GUN', slot: 'primary', unlock: 32,
    dmg: [26, 17], range: [15, 34], rpm: 900, mode: 'auto', mag: 50, reserve: 250, reload: 2.1, reloadEmpty: 2.6,
    adsTime: 0.17, zoom: 0.85, move: 1.05, hip: 2.6, adsSpread: 0.2, recoil: { up: 0.4, side: 0.34, kick: 0.028, roll: 1.5 },
    head: 1.3, limb: 0.9, sound: { crack: 2900, decay: 0.09, body: 0.75, kick: 140, sample: 'smg' }, model: 'smg', sight: 'holo', sightH: 0.1,
  },
  sentinel: {
    id: 'sentinel', name: 'SENTINEL DMR', cls: 'MARKSMAN RIFLE', slot: 'primary', unlock: 35,
    dmg: [48, 40], range: [42, 85], rpm: 380, mode: 'semi', mag: 20, reserve: 100, reload: 2.2, reloadEmpty: 2.7,
    adsTime: 0.28, zoom: 0.55, move: 0.93, hip: 4, adsSpread: 0.03, recoil: { up: 1.2, side: 0.28, kick: 0.055, roll: 1.3 },
    head: 1.7, limb: 0.9, sound: { crack: 1850, decay: 0.17, body: 1.35, kick: 88, vol: 1.1, sample: 'dmr' }, model: 'dmr', sight: 'acog', sightH: 0.112,
  },
  vigil: {
    id: 'vigil', name: 'VIGIL M1', cls: 'SHOTGUN', slot: 'primary', unlock: 38,
    dmg: [14, 5], range: [7, 18], rpm: 220, mode: 'semi', mag: 7, reserve: 35, reload: 0.45, reloadEmpty: 0.45, shellReload: true,
    adsTime: 0.21, zoom: 0.88, move: 0.98, hip: 5.4, adsSpread: 4.2, pellets: 8, recoil: { up: 2.8, side: 0.8, kick: 0.085, roll: 2.8 },
    head: 1.2, limb: 1, sound: { crack: 1500, decay: 0.2, body: 1.6, kick: 92, vol: 1.2, sample: 'shotgun' }, model: 'shotgun', sight: 'iron', sightH: 0.07,
  },
  warhawk: {
    id: 'warhawk', name: 'WARHAWK .50', cls: 'PISTOL', slot: 'secondary', unlock: 41,
    dmg: [60, 42], range: [14, 30], rpm: 200, mode: 'semi', mag: 7, reserve: 35, reload: 1.8, reloadEmpty: 2.2,
    adsTime: 0.16, zoom: 0.88, move: 1.03, hip: 3, adsSpread: 0.5, recoil: { up: 3.2, side: 0.8, kick: 0.1, roll: 3.2 },
    head: 1.6, limb: 0.9, sound: { crack: 2000, decay: 0.16, body: 1.3, kick: 110, vol: 1.25, sample: 'pistol' }, model: 'pistol', sight: 'iron', sightH: 0.07,
  },
  rpk: {
    id: 'rpk', name: 'STRELKA RPK', cls: 'LIGHT MACHINE GUN', slot: 'primary', unlock: 44,
    dmg: [36, 28], range: [34, 64], rpm: 600, mode: 'auto', mag: 45, reserve: 225, reload: 3.0, reloadEmpty: 3.6,
    adsTime: 0.32, zoom: 0.76, move: 0.88, hip: 4.8, adsSpread: 0.18, recoil: { up: 0.62, side: 0.38, kick: 0.042, roll: 1.5 },
    head: 1.3, limb: 0.9, sound: { crack: 1950, decay: 0.15, body: 1.25, kick: 100, vol: 1.1, sample: 'lmg' }, model: 'lmg', sight: 'iron', sightH: 0.11, bot: true,
  },
  marshal: {
    id: 'marshal', name: 'MARSHAL MK II', cls: 'SUBMACHINE GUN', slot: 'primary', unlock: 47,
    dmg: [32, 20], range: [12, 28], rpm: 550, mode: 'auto', mag: 32, reserve: 192, reload: 2.0, reloadEmpty: 2.4,
    adsTime: 0.18, zoom: 0.86, move: 1.04, hip: 2.8, adsSpread: 0.22, recoil: { up: 0.42, side: 0.25, kick: 0.03, roll: 1.2 },
    head: 1.3, limb: 0.9, sound: { crack: 2600, decay: 0.1, body: 0.85, kick: 130, sample: 'smg' }, model: 'smg', sight: 'iron', sightH: 0.09,
  },
  titan: {
    id: 'titan', name: 'TITAN .50 AMR', cls: 'SNIPER RIFLE', slot: 'primary', unlock: 50,
    dmg: [125, 115], range: [60, 130], rpm: 90, mode: 'semi', mag: 5, reserve: 25, reload: 3.2, reloadEmpty: 3.8,
    adsTime: 0.44, zoom: 0.22, move: 0.82, hip: 8, adsSpread: 0, recoil: { up: 5.2, side: 1.0, kick: 0.17, roll: 3 },
    head: 2.0, limb: 0.85, sound: { crack: 1500, decay: 0.32, body: 2.2, kick: 60, vol: 1.5, verb: 0.9, tail: 1.4, sample: 'sniper' }, model: 'sniper', sight: 'scope', sightH: 0.105, scope: true,
  },
  magistrate: {
    id: 'magistrate', name: 'MAGISTRATE M93', cls: 'MACHINE PISTOL', slot: 'secondary', unlock: 53,
    dmg: [26, 16], range: [10, 24], rpm: 1100, mode: 'burst', burst: 3, burstDelay: 0.2, mag: 18, reserve: 90, reload: 1.5, reloadEmpty: 1.8,
    adsTime: 0.13, zoom: 0.9, move: 1.07, hip: 2.4, adsSpread: 0.4, recoil: { up: 0.8, side: 0.4, kick: 0.04, roll: 2 },
    head: 1.3, limb: 0.9, sound: { crack: 2900, decay: 0.08, body: 0.65, kick: 155, vol: 0.85, sample: 'mpistol' }, model: 'pistol', sight: 'iron', sightH: 0.065,
  },
  tempest: {
    id: 'tempest', name: 'TEMPEST S12', cls: 'SHOTGUN', slot: 'primary', unlock: 56,
    dmg: [11, 3], range: [5, 14], rpm: 330, mode: 'auto', mag: 10, reserve: 40, reload: 2.6, reloadEmpty: 3.1,
    adsTime: 0.24, zoom: 0.88, move: 0.95, hip: 6, adsSpread: 5, pellets: 8, recoil: { up: 2.2, side: 1.0, kick: 0.07, roll: 2.4 },
    head: 1.2, limb: 1, sound: { crack: 1600, decay: 0.16, body: 1.4, kick: 98, vol: 1.1, sample: 'shotgun' }, model: 'shotgun', sight: 'iron', sightH: 0.076,
  },
  reaper: {
    id: 'reaper', name: 'REAPER .50 BOLT', cls: 'SNIPER RIFLE', slot: 'primary', unlock: 59,
    dmg: [160, 150], range: [70, 140], rpm: 38, mode: 'bolt', mag: 5, reserve: 20, reload: 3.4, reloadEmpty: 4.0,
    adsTime: 0.46, zoom: 0.2, move: 0.8, hip: 8.5, adsSpread: 0, recoil: { up: 6, side: 1.2, kick: 0.19, roll: 3.2 },
    head: 2.0, limb: 0.85, sound: { crack: 1400, decay: 0.34, body: 2.3, kick: 58, vol: 1.6, verb: 0.95, tail: 1.5, sample: 'sniper' }, model: 'sniper', sight: 'scope', sightH: 0.105, scope: true,
  },
};

// menus list weapons in unlock order
export const PRIMARIES = Object.values(WEAPONS).filter((w) => w.slot === 'primary').sort((a, b) => a.unlock - b.unlock);
export const SECONDARIES = Object.values(WEAPONS).filter((w) => w.slot === 'secondary').sort((a, b) => a.unlock - b.unlock);
export const BOT_WEAPONS = ['vx4', 'vx4', 'kestrel', 'kestrel', 'viper', 'brutus', 'ranger', 'longbow', 'orion', 'strelka', 'krait', 'hornet', 'jackal', 'huntsman', 'warden', 'rpk'];

export const PERKS = {
  1: [
    { id: 'lightweight', name: 'LIGHTWEIGHT', desc: '+8% movement speed, faster tactical sprint recharge.', unlock: 1 },
    { id: 'marathon', name: 'MARATHON', desc: '50% longer tactical sprint and 40% shorter recharge.', unlock: 4 },
    { id: 'mountaineer', name: 'MOUNTAINEER', desc: '50% less fall damage and 25% faster mantling.', unlock: 6 },
    { id: 'scavenger', name: 'SCAVENGER', desc: 'Resupply ammo from fallen enemies.', unlock: 7 },
  ],
  2: [
    { id: 'fasthands', name: 'FAST HANDS', desc: 'Reload and swap weapons 35% faster.', unlock: 1 },
    { id: 'reserves', name: 'DEEP RESERVES', desc: 'Spawn with 50% more reserve ammunition.', unlock: 3 },
    { id: 'grenadier', name: 'GRENADIER', desc: 'Spawn with one extra frag grenade.', unlock: 5 },
    { id: 'flak', name: 'FLAK JACKET', desc: 'Take 55% less explosive damage.', unlock: 8 },
  ],
  3: [
    { id: 'quickfix', name: 'QUICK FIX', desc: 'Health regenerates sooner and faster.', unlock: 1 },
    { id: 'stalker', name: 'STALKER', desc: '15% faster movement while aiming down sights.', unlock: 2 },
    { id: 'focus', name: 'FOCUS', desc: '60% less camera shake when taking damage.', unlock: 9 },
    { id: 'steady', name: 'STEADY AIM', desc: '35% tighter hip-fire spread, faster ADS.', unlock: 10 },
  ],
};

export function damageAt(def, dist) {
  const [n, f] = def.dmg, [r0, r1] = def.range;
  if (dist <= r0) return n;
  if (dist >= r1) return f;
  return n + (f - n) * ((dist - r0) / (r1 - r0));
}

// ------------------------------------------------------------------ MODELS
let MAT = null;
function mats() {
  if (MAT) return MAT;
  MAT = {
    metal: new THREE.MeshStandardMaterial({ color: 0x2b2e31, roughness: 0.38, metalness: 0.75 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x17191b, roughness: 0.55, metalness: 0.35 }),
    poly: new THREE.MeshStandardMaterial({ color: 0x232527, roughness: 0.75, metalness: 0.05 }),
    tan: new THREE.MeshStandardMaterial({ color: 0x8a7656, roughness: 0.7, metalness: 0.05 }),
    od: new THREE.MeshStandardMaterial({ color: 0x47513b, roughness: 0.7, metalness: 0.05 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x5e3b22, roughness: 0.55 }),
    metalDS: new THREE.MeshStandardMaterial({ color: 0x24272a, roughness: 0.45, metalness: 0.7, side: THREE.DoubleSide }),
    lens: new THREE.MeshStandardMaterial({ color: 0x9fd0ff, roughness: 0, metalness: 0.2, transparent: true, opacity: 0.1, depthWrite: false }),
    dot: new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.35, 0.2), toneMapped: false }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc8a14a, roughness: 0.3, metalness: 1, userData: { noCamo: true } }),
    olive: new THREE.MeshStandardMaterial({ color: 0x5a5f3c, roughness: 0.8 }),
  };
  return MAT;
}

function bx(g, w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0, name) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  if (name) m.name = name;
  g.add(m); return m;
}
function cy(g, r, len, mat, x, y, z, axis = 'z', seg = 12, name, r2) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r2 ?? r, r, len, seg), mat);
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  m.position.set(x, y, z);
  if (name) m.name = name;
  g.add(m); return m;
}

function railTop(g, M, z0, z1, y) {
  const len = z1 - z0;
  bx(g, 0.026, 0.012, len, M.dark, 0, y, (z0 + z1) / 2);
  for (let z = z0 + 0.01; z < z1; z += 0.012) bx(g, 0.03, 0.006, 0.005, M.dark, 0, y + 0.008, z);
}

function tube(g, M, r, len, h, z) {
  const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 24, 1, true), M.metalDS);
  t.rotation.x = Math.PI / 2; t.position.set(0, h, z); g.add(t);
  for (const s of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.16, 6, 24), M.metal);
    ring.position.set(0, h, z + (s * len) / 2); g.add(ring);
  }
}

/**
 * Optics / iron sights. h is the exact sight-line height (the camera sits on it when aiming),
 * z is the sight position, frontZ the front-post position for irons. Nothing may cross the line at h.
 */
function sight(parent, M, type, h, z, frontZ = -0.5, postH = 0.012) {
  const g = new THREE.Group(); g.userData.noCamo = true; parent.add(g); // optics keep their finish under camos
  if (type === 'dot') {
    bx(g, 0.026, 0.016, 0.055, M.dark, 0, h - 0.028, z);           // mount
    bx(g, 0.012, 0.012, 0.03, M.dark, 0, h - 0.02, z);
    tube(g, M, 0.018, 0.045, h, z);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.0175, 24), M.lens); lens.position.set(0, h, z - 0.02); lens.renderOrder = 2; g.add(lens);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0008, 8, 6), M.dot); dot.position.set(0, h, z - 0.012); g.add(dot);
    bx(g, 0.008, 0.008, 0.012, M.dark, 0.021, h, z + 0.005);        // brightness knob
  } else if (type === 'holo') {
    bx(g, 0.04, 0.012, 0.075, M.dark, 0, h - 0.027, z);
    bx(g, 0.004, 0.044, 0.05, M.dark, -0.021, h, z);
    bx(g, 0.004, 0.044, 0.05, M.dark, 0.021, h, z);
    bx(g, 0.046, 0.005, 0.05, M.dark, 0, h + 0.024, z);
    const glass = bx(g, 0.038, 0.04, 0.001, M.lens, 0, h, z - 0.015); glass.renderOrder = 2;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0045, 0.00045, 4, 28), M.dot);
    ring.position.set(0, h, z - 0.016); g.add(ring);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0006, 6, 6), M.dot); dot.position.copy(ring.position); g.add(dot);
  } else if (type === 'acog') {
    bx(g, 0.028, 0.016, 0.06, M.dark, 0, h - 0.032, z);
    tube(g, M, 0.02, 0.11, h, z);
    tube(g, M, 0.025, 0.03, h, z - 0.07);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.024, 24), M.lens); lens.position.set(0, h, z - 0.08); lens.renderOrder = 2; g.add(lens);
    const chevron = new THREE.Mesh(new THREE.ConeGeometry(0.0011, 0.0028, 3), M.dot); chevron.position.set(0, h - 0.0014, z - 0.06); g.add(chevron);
    const post = bx(g, 0.0004, 0.012, 0.0004, M.dark, 0, h - 0.0088, z - 0.06); post.renderOrder = 1;
  } else if (type === 'scope') {
    bx(g, 0.025, 0.03, 0.03, M.dark, 0, h - 0.022, z - 0.05);
    bx(g, 0.025, 0.03, 0.03, M.dark, 0, h - 0.022, z + 0.06);
    cy(g, 0.02, 0.24, M.metal, 0, h, z, 'z', 18);
    cy(g, 0.03, 0.06, M.metal, 0, h, z - 0.14, 'z', 18, null, 0.022);
    cy(g, 0.026, 0.04, M.metal, 0, h, z + 0.13, 'z', 18);
    cy(g, 0.008, 0.03, M.metal, 0, h + 0.023, z, 'y');
  } else if (type === 'iron') {
    // rear notch: two posts whose tops sit exactly on the sight line
    bx(g, 0.022, 0.005, 0.01, M.dark, 0, h - 0.0115, z);
    bx(g, 0.006, 0.014, 0.01, M.dark, -0.0065, h - 0.007, z);
    bx(g, 0.006, 0.014, 0.01, M.dark, 0.0065, h - 0.007, z);
    // front post, top on the sight line, with a bright dot
    bx(g, 0.003, postH, 0.004, M.dark, 0, h - postH / 2, frontZ);
    const fd = new THREE.Mesh(new THREE.SphereGeometry(0.0012, 6, 6), M.fiber || (M.fiber = new THREE.MeshBasicMaterial({ color: 0x9dff6a }))); fd.position.set(0, h - 0.0012, frontZ + 0.0021); g.add(fd);
  }
}

const builders = {
  ar(g, M, def) {
    bx(g, 0.052, 0.07, 0.34, M.metal, 0, 0.04, -0.06);             // upper receiver
    bx(g, 0.048, 0.05, 0.2, M.metal, 0, -0.005, -0.03);             // lower
    bx(g, 0.06, 0.062, 0.3, M.poly, 0, 0.045, -0.38);               // handguard
    for (let i = 0; i < 4; i++) bx(g, 0.062, 0.012, 0.03, M.dark, 0, 0.03, -0.29 - i * 0.065); // vents
    cy(g, 0.011, 0.24, M.dark, 0, 0.05, -0.62);                     // barrel
    cy(g, 0.017, 0.06, M.dark, 0, 0.05, -0.74, 'z', 8, 'muzzleBrake');
    bx(g, 0.034, 0.17, 0.075, M.poly, 0, -0.08, -0.1, 0.22, 0, 0, 'mag'); // mag
    bx(g, 0.034, 0.1, 0.05, M.poly, 0, -0.07, 0.07, -0.35);         // grip
    bx(g, 0.012, 0.03, 0.08, M.dark, 0, -0.015, 0.02);              // trigger guard
    bx(g, 0.04, 0.03, 0.18, M.poly, 0, 0.045, 0.2);                 // buffer tube
    bx(g, 0.046, 0.085, 0.12, M.poly, 0, 0.02, 0.26);               // stock
    bx(g, 0.012, 0.02, 0.05, M.dark, 0.03, 0.05, -0.02, 0, 0, 0, 'bolt'); // charging handle
    railTop(g, M, -0.5, 0.08, 0.08);
    sight(g, M, 'dot', def.sightH, -0.02);
    bx(g, 0.022, 0.06, 0.03, M.poly, 0, -0.005, -0.38);             // vertical grip
    return { muzzle: -0.78, gripZ: 0.07, foreZ: -0.38, foreY: -0.01 };
  },
  smg(g, M, def) {
    bx(g, 0.05, 0.075, 0.28, M.poly, 0, 0.035, -0.05);
    bx(g, 0.055, 0.05, 0.16, M.poly, 0, 0.03, -0.26);
    cy(g, 0.016, 0.12, M.dark, 0, 0.045, -0.39, 'z', 10);           // suppressor-ish shroud
    bx(g, 0.03, 0.22, 0.045, M.dark, 0, -0.11, -0.12, 0.05, 0, 0, 'mag');
    bx(g, 0.032, 0.1, 0.045, M.poly, 0, -0.06, 0.06, -0.3);
    bx(g, 0.012, 0.012, 0.22, M.dark, 0.02, 0.03, 0.2);             // folding stock rods
    bx(g, 0.012, 0.012, 0.22, M.dark, -0.02, 0.03, 0.2);
    bx(g, 0.05, 0.07, 0.02, M.poly, 0, 0.02, 0.31);
    bx(g, 0.012, 0.02, 0.04, M.dark, -0.03, 0.05, -0.16, 0, 0, 0, 'bolt');
    railTop(g, M, -0.3, 0.05, 0.077);
    sight(g, M, 'holo', def.sightH, -0.04);
    return { muzzle: -0.46, gripZ: 0.06, foreZ: -0.26, foreY: 0.0 };
  },
  shotgun(g, M, def) {
    bx(g, 0.05, 0.07, 0.24, M.metal, 0, 0.03, -0.02);
    cy(g, 0.014, 0.62, M.dark, 0, 0.055, -0.43, 'z', 12);           // barrel
    cy(g, 0.015, 0.5, M.dark, 0, 0.022, -0.38, 'z', 12);            // mag tube
    const pump = bx(g, 0.05, 0.05, 0.16, M.poly, 0, 0.022, -0.32, 0, 0, 0, 'pump');
    for (let i = 0; i < 5; i++) bx(pump, 0.052, 0.006, 0.01, M.dark, 0, -0.01, -0.06 + i * 0.03);
    bx(g, 0.034, 0.1, 0.05, M.poly, 0, -0.06, 0.1, -0.4);
    bx(g, 0.044, 0.07, 0.24, M.poly, 0, 0.0, 0.24, -0.1);           // stock
    sight(g, M, 'iron', def.sightH, 0.08, -0.72);
    bx(g, 0.024, 0.012, 0.06, M.dark, 0, 0.002, -0.06, 0, 0, 0, 'mag');
    return { muzzle: -0.74, gripZ: 0.1, foreZ: -0.32, foreY: -0.01 };
  },
  sniper(g, M, def) {
    bx(g, 0.05, 0.065, 0.36, M.metal, 0, 0.03, -0.06);
    cy(g, 0.014, 0.66, M.dark, 0, 0.045, -0.56, 'z', 12, null, 0.011);
    cy(g, 0.022, 0.08, M.dark, 0, 0.045, -0.92, 'z', 8, 'muzzleBrake');
    bx(g, 0.06, 0.06, 0.48, M.od, 0, 0.0, -0.22);                    // chassis
    bx(g, 0.03, 0.08, 0.04, M.poly, 0, -0.075, -0.06, 0, 0, 0, 'mag');
    bx(g, 0.036, 0.11, 0.05, M.poly, 0, -0.07, 0.1, -0.35);
    bx(g, 0.05, 0.1, 0.3, M.od, 0, 0.0, 0.3);
    bx(g, 0.052, 0.03, 0.12, M.poly, 0, 0.06, 0.3);                  // cheek rest
    const bolt = new THREE.Group(); bolt.name = 'bolt'; bolt.position.set(0.03, 0.045, 0.06); g.add(bolt);
    cy(bolt, 0.006, 0.05, M.metal, 0.02, 0, 0, 'x');
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), M.metal); knob.position.set(0.045, 0, 0); bolt.add(knob);
    sight(g, M, 'scope', def.sightH, -0.05);
    bx(g, 0.012, 0.012, 0.2, M.dark, 0.02, -0.04, -0.55, 0.1);       // folded bipod
    bx(g, 0.012, 0.012, 0.2, M.dark, -0.02, -0.04, -0.55, 0.1);
    return { muzzle: -0.97, gripZ: 0.1, foreZ: -0.36, foreY: -0.02 };
  },
  bullpup(g, M, def) {
    bx(g, 0.058, 0.09, 0.56, M.tan, 0, 0.02, -0.02);
    bx(g, 0.062, 0.03, 0.2, M.poly, 0, 0.08, -0.2);
    cy(g, 0.012, 0.16, M.dark, 0, 0.04, -0.38, 'z');
    cy(g, 0.018, 0.05, M.dark, 0, 0.04, -0.48, 'z', 8, 'muzzleBrake');
    bx(g, 0.032, 0.15, 0.07, M.poly, 0, -0.09, 0.12, 0.18, 0, 0, 'mag');
    bx(g, 0.034, 0.1, 0.05, M.poly, 0, -0.07, -0.08, -0.25);
    bx(g, 0.05, 0.05, 0.02, M.poly, 0, -0.045, -0.11);              // trigger guard block
    bx(g, 0.03, 0.06, 0.06, M.tan, 0, -0.01, -0.22);
    railTop(g, M, -0.26, 0.15, 0.072);
    sight(g, M, 'dot', def.sightH, -0.08);
    bx(g, 0.012, 0.02, 0.05, M.dark, -0.034, 0.05, -0.12, 0, 0, 0, 'bolt');
    return { muzzle: -0.51, gripZ: -0.08, foreZ: -0.22, foreY: -0.03 };
  },
  lmg(g, M, def) {
    bx(g, 0.07, 0.09, 0.4, M.metal, 0, 0.04, -0.06);
    bx(g, 0.074, 0.03, 0.26, M.dark, 0, 0.1, -0.08);                 // feed cover
    bx(g, 0.07, 0.07, 0.3, M.poly, 0, 0.04, -0.42);
    cy(g, 0.016, 0.34, M.dark, 0, 0.05, -0.72, 'z', 12);
    cy(g, 0.022, 0.08, M.dark, 0, 0.05, -0.9, 'z', 8, 'muzzleBrake');
    const box = bx(g, 0.1, 0.13, 0.12, M.od, -0.02, -0.08, -0.12, 0, 0, 0, 'mag');
    bx(box, 0.104, 0.02, 0.124, M.dark, 0, 0.03, 0);
    bx(g, 0.036, 0.11, 0.05, M.poly, 0, -0.07, 0.08, -0.35);
    bx(g, 0.05, 0.1, 0.24, M.poly, 0, 0.02, 0.28);
    bx(g, 0.012, 0.03, 0.12, M.dark, 0.05, 0.07, -0.3);               // side carry handle (clear of the optic)
    bx(g, 0.012, 0.012, 0.22, M.dark, 0.025, -0.02, -0.68, 0.12);
    bx(g, 0.012, 0.012, 0.22, M.dark, -0.025, -0.02, -0.68, 0.12);
    railTop(g, M, -0.2, 0.08, 0.115);
    sight(g, M, 'dot', def.sightH, -0.03);
    bx(g, 0.012, 0.02, 0.05, M.dark, 0.04, 0.05, -0.15, 0, 0, 0, 'bolt');
    return { muzzle: -0.95, gripZ: 0.08, foreZ: -0.42, foreY: -0.01 };
  },
  dmr(g, M, def) {
    bx(g, 0.054, 0.075, 0.36, M.metal, 0, 0.04, -0.06);
    bx(g, 0.05, 0.05, 0.2, M.metal, 0, -0.005, -0.03);
    bx(g, 0.062, 0.066, 0.36, M.tan, 0, 0.045, -0.42);
    cy(g, 0.012, 0.32, M.dark, 0, 0.05, -0.74);
    cy(g, 0.019, 0.07, M.dark, 0, 0.05, -0.92, 'z', 8, 'muzzleBrake');
    bx(g, 0.034, 0.13, 0.07, M.poly, 0, -0.07, -0.1, 0.12, 0, 0, 'mag');
    bx(g, 0.034, 0.1, 0.05, M.tan, 0, -0.07, 0.07, -0.35);
    bx(g, 0.048, 0.09, 0.26, M.tan, 0, 0.02, 0.24);
    bx(g, 0.012, 0.02, 0.05, M.dark, 0.03, 0.05, -0.02, 0, 0, 0, 'bolt');
    railTop(g, M, -0.55, 0.08, 0.085);
    sight(g, M, 'acog', def.sightH, -0.02);
    return { muzzle: -0.96, gripZ: 0.07, foreZ: -0.4, foreY: -0.01 };
  },
  pistol(g, M, def) {
    bx(g, 0.03, 0.035, 0.19, M.metal, 0, 0.04, -0.07, 0, 0, 0, 'slide');
    bx(g, 0.028, 0.03, 0.15, M.poly, 0, 0.012, -0.06);
    bx(g, 0.03, 0.11, 0.045, M.poly, 0, -0.045, 0.0, -0.22, 0, 0, 'mag');
    bx(g, 0.008, 0.025, 0.05, M.poly, 0, -0.005, -0.04);
    sight(g, M, 'iron', def.sightH, 0.01, -0.155);
    return { muzzle: -0.17, gripZ: 0.0, foreZ: 0.0, foreY: -0.05, pistol: true };
  },
  mpistol(g, M, def) {
    bx(g, 0.032, 0.04, 0.2, M.dark, 0, 0.04, -0.07, 0, 0, 0, 'slide');
    bx(g, 0.03, 0.03, 0.16, M.poly, 0, 0.012, -0.06);
    cy(g, 0.012, 0.08, M.dark, 0, 0.04, -0.2, 'z');
    bx(g, 0.03, 0.18, 0.045, M.poly, 0, -0.07, 0.0, -0.22, 0, 0, 'mag');
    bx(g, 0.02, 0.05, 0.02, M.poly, 0, -0.02, -0.12);
    sight(g, M, 'iron', def.sightH, 0.01, -0.16);
    return { muzzle: -0.24, gripZ: 0.0, foreZ: 0.0, foreY: -0.05, pistol: true };
  },
  launcher(g, M, def) {
    cy(g, 0.055, 0.9, M.od, 0, 0.06, -0.2, 'z', 16);
    cy(g, 0.065, 0.1, M.dark, 0, 0.06, -0.66, 'z', 16);
    cy(g, 0.06, 0.1, M.dark, 0, 0.06, 0.25, 'z', 16);
    const rk = cy(g, 0.04, 0.18, M.od, 0, 0.06, -0.74, 'z', 10, 'mag');
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 10), M.olive);
    rk.add(tip); tip.rotation.set(Math.PI, 0, 0); tip.position.set(0, -0.15, 0);
    bx(g, 0.034, 0.1, 0.05, M.poly, 0, -0.04, 0.0, -0.3);
    bx(g, 0.034, 0.1, 0.05, M.poly, 0, -0.04, -0.3, 0.1);
    bx(g, 0.03, 0.06, 0.08, M.dark, -0.07, 0.1, -0.1);
    sight(g, M, 'iron', def.sightH, 0.05, -0.5);
    return { muzzle: -0.8, gripZ: 0.0, foreZ: -0.3, foreY: -0.02 };
  },
};

// ------------------------------------------------------------------ REAL MODELS
const GUN_ASSETS = {};   // weapon id -> { scene, meta }
const OPTIC_RISE = { dot: 0.036, holo: 0.033, acog: 0.04, scope: 0.037 }; // optic sight line above its mount

function opticFor(def, m) { return OPTIC_RISE[def.sight] !== undefined && m.points.Attach_Scope ? def.sight : null; }

function assetSightH(def, m) {
  const optic = opticFor(def, m);
  if (optic) return m.points.Attach_Scope[1] + (m.opticRiser || 0) + OPTIC_RISE[optic];
  if (m.tops['Rear Sights'] !== undefined) return m.tops['Rear Sights'] - 0.004;
  return Math.max(m.tops.Slide ?? -1, m.tops.Body) + 0.008;
}

/** Load the converted gun models. Safe to skip: anything missing keeps its procedural model. */
export async function loadWeaponAssets(base, onProgress) {
  const dir = `${base}assets/models/guns/`;
  let meta;
  try { meta = await (await fetch(dir + 'meta.json')).json(); } catch { return; }
  const loader = new GLTFLoader();
  try {
    DETAIL = await new THREE.TextureLoader().loadAsync(`${base}assets/textures/metal_rough.jpg`);
    DETAIL.wrapS = DETAIL.wrapT = THREE.RepeatWrapping; DETAIL.colorSpace = THREE.NoColorSpace;
  } catch { DETAIL = null; }
  const ids = Object.keys(meta).filter((id) => WEAPONS[id]);
  let done = 0;
  await Promise.all(ids.map(async (id) => {
    try {
      const gltf = await loader.loadAsync(dir + meta[id].file);
      gltf.scene.traverse((o) => { if (o.isMesh) { for (const material of Array.isArray(o.material) ? o.material : [o.material]) tuneMaterial(material); } });
      markShared(gltf.scene);
      GUN_ASSETS[id] = { scene: gltf.scene, meta: meta[id] };
      WEAPONS[id].sightH = assetSightH(WEAPONS[id], meta[id]);
    } catch (e) { console.warn('weapon model failed to load:', id, e); }
    if (onProgress) onProgress(++done / ids.length);
  }));
}

let DETAIL = null;   // greyscale wear texture, projected onto the untextured gun models

/**
 * Untextured guns read as smooth plastic. Project a real worn-metal roughness scan onto them (triplanar, in model
 * space so it sticks to the gun) and use it to vary roughness and, faintly, the albedo: handling marks, edge wear.
 */
function addWear(m) {
  if (!DETAIL) return;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.wearMap = { value: DETAIL };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWearPos; varying vec3 vWearN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWearPos = position; vWearN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D wearMap; varying vec3 vWearPos; varying vec3 vWearN;
float wear() {
  vec3 w = abs(normalize(vWearN)); w /= (w.x + w.y + w.z);
  vec3 p = vWearPos * 7.0;
  return texture2D(wearMap, p.yz).r * w.x + texture2D(wearMap, p.xz).r * w.y + texture2D(wearMap, p.xy).r * w.z;
}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\nfloat wearT = wear();\ndiffuseColor.rgb *= 0.86 + 0.28 * wearT;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * (0.6 + wearT * 0.85), 0.05, 1.0);');
  };
  m.customProgramCacheKey = () => 'gun-wear';
}

// the source models use flat colours; give them believable gunmetal / polymer / wood / brass responses
function tuneMaterial(m) {
  if (!m || m._tuned) return;
  m._tuned = true;
  // Keep the authored PBR maps on textured assets.
  if (m.map || m.normalMap || m.metalnessMap || m.roughnessMap) { m.envMapIntensity = 1.0; return; }
  addWear(m);
  const n = m.name || '';
  if (/Brass/.test(n)) { m.metalness = 1; m.roughness = 0.32; }
  else if (/Brown/.test(n)) { m.metalness = 0; m.roughness = 0.6; }
  else if (/Black|Grey/.test(n)) {
    m.metalness = /Lighter|Light/.test(n) ? 0.35 : 0.55; m.roughness = 0.42;
    const l = m.color.r + m.color.g + m.color.b;
    if (l < 0.03) m.color.setRGB(0.011, 0.012, 0.013);
  } else { m.metalness = 0.1; m.roughness = 0.6; }
  m.envMapIntensity = 1.1;
}

function buildFromAsset(g, M, def, A) {
  const model = A.scene.clone(true);
  g.add(model);
  model.updateMatrixWorld(true);
  const m = A.meta, P = m.points;
  const find = (n) => model.getObjectByName(n.replace(/ /g, '_')) || model.getObjectByName(n);
  const optic = opticFor(def, m), h = def.sightH;
  const muz = P.Attach_Muzzle;
  if (optic) {
    // folded back-up irons under the optic
    for (const n of ['Rear Sights', 'Front Sights']) { const o = find(n); if (o) o.visible = false; }
    if (m.opticRiser) bx(g, 0.028, m.opticRiser, 0.055, M.dark, 0, P.Attach_Scope[1] + m.opticRiser / 2, P.Attach_Scope[2]);
    sight(g, M, optic, h, P.Attach_Scope[2] - (optic === 'scope' ? 0.02 : 0.005));
  } else if (m.tops['Rear Sights'] === undefined) {
    const rearZ = P.Attach_Scope ? P.Attach_Scope[2] : 0.02;
    const frontTop = def.model === 'shotgun' ? muz[1] + 0.02 : h - 0.012;
    sight(g, M, 'iron', h, rearZ, muz[2] + 0.025, Math.max(0.012, h - frontTop));
  }
  const pistol = def.model === 'pistol' || def.model === 'mpistol';
  const trig = P.Trigger || [0, 0, 0];
  let foreZ = 0, foreY = -0.05;
  if (!pistol) {
    const pump = find('Pump');
    if (pump) {
      const b = new THREE.Box3().setFromObject(pump);
      foreZ = (b.min.z + b.max.z) / 2; foreY = b.min.y + 0.03;
    } else {
      const rb = P['Attach_Rail.Bottom'];
      foreZ = Math.max(rb ? rb[2] : muz[2] * 0.6, muz[2] * 0.62);
      foreY = (rb ? rb[1] : 0) + 0.02;
    }
  }
  const bolt = def.mode === 'bolt' ? find('Bolt') : find('Charging Handle') || find('Bolt');
  const parts = { mag: find('Magazine'), bolt, pump: find('Pump'), slide: find('Slide') };
  for (const [k, o] of Object.entries(parts)) if (o) { o.name = k; }
  const shell = find('Shell'); if (shell) shell.visible = false;
  return { muzzle: muz[2], muzzleY: muz[1], gripZ: trig[2] + (pistol ? 0.035 : 0.05), foreZ: pistol ? trig[2] + 0.035 : foreZ, foreY, pistol, real: true };
}

/** Build a weapon model. Returns { group, info } where info has muzzle Object3D and named parts. */
export function buildWeaponModel(def, { shadows = false, camo = null } = {}) {
  const M = mats();
  const g = new THREE.Group();
  const A = GUN_ASSETS[def.id];
  const info = A ? buildFromAsset(g, M, def, A) : builders[def.model](g, M, def);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, info.muzzleY ?? 0.05, info.muzzle);
  if (info.muzzleY === undefined && (def.model === 'pistol' || def.model === 'mpistol')) muzzle.position.y = 0.04;
  if (info.muzzleY === undefined && def.model === 'launcher') muzzle.position.y = 0.06;
  g.add(muzzle);
  info.muzzleObj = muzzle;
  info.mag = g.getObjectByName('mag');
  info.bolt = g.getObjectByName('bolt');
  info.pump = g.getObjectByName('pump');
  info.slide = g.getObjectByName('slide');
  if (info.mag) { info.magHome = info.mag.position.clone(); info.magRotation = info.mag.rotation.clone(); }
  if (info.pump) info.pumpHome = info.pump.position.clone();
  if (info.slide) info.slideHome = info.slide.position.clone();
  if (info.bolt) info.boltHome = info.bolt.position.clone();
  if (camo) applyCamo(g, camo);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = shadows; o.receiveShadow = false; } });
  return { group: g, info };
}

export function weaponMaterials() { return mats(); }
