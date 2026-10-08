// Match orchestration: actors, combat resolution, projectiles, modes (TDM / Domination / Hardpoint / Kill Confirmed /
// FFA / Gun Game / Survival), spawning, scoring, XP & medals, death cam, killcam, weapon drops.
import * as THREE from 'three';
import { World } from '../engine/physics.js';
import { audio } from '../engine/audio.js';
import { BuySystem, START_CASH, CASH } from './buy.js';
import { buildMap } from './map.js';
import { Effects } from './effects.js';
import { Viewmodel } from './viewmodel.js';
import { Player } from './player.js';
import { Bot, DIFFICULTY } from './bot.js';
import { damageAt, WEAPONS } from './weapons.js';
import { StreakSystem, STREAKS } from './streaks.js';
import { AirstrikeTargeting } from './airstrike-targeting.js';
import { createRewards, earnRewards, consumeReward, resetRewardProgress } from './streak-rewards.js';
import { Killcam } from './killcam.js';
import { Pickups } from './pickups.js';
import { spawnScore } from './spawn.js';
import { CALLSIGNS, shuffle, rand, pick, clamp, damp, wrapAngle, DEG, disposeModel } from '../core/utils.js';
import { profile } from '../core/save.js';
import { MatchSession, MODIFIERS } from '../core/live.js';

/** Gun Game weapon ladder: a kill with the last one wins. */
export const GUN_LADDER = ['p17', 'hellcat', 'kestrel', 'ranger', 'vx4', 'viper', 'brutus', 'arbiter', 'longbow', 'striker'];
const HP_RADIUS = 6, HP_ROTATE = 60;

export const MODES = {
  tdm: { id: 'tdm', name: 'TEAM DEATHMATCH', short: 'TDM', desc: 'Two squads of six. First team to the score limit wins.', limit: 60, time: 600, teams: true },
  dom: { id: 'dom', name: 'DOMINATION', short: 'DOM', desc: 'Capture and hold flags A, B and C. Held flags earn points over time.', limit: 200, time: 720, teams: true },
  hp: { id: 'hp', name: 'HARDPOINT', short: 'HP', desc: 'Hold the Hardpoint to score a point every second. The zone moves every 60 seconds; contested zones score nothing.', limit: 200, time: 600, teams: true },
  kc: { id: 'kc', name: 'KILL CONFIRMED', short: 'KC', desc: 'Kills drop dog tags. Collect enemy tags to score, grab friendly tags to deny.', limit: 45, time: 600, teams: true },
  ffa: { id: 'ffa', name: 'FREE-FOR-ALL', short: 'FFA', desc: 'Every operator for themselves. First to 30 kills wins.', limit: 30, time: 600, teams: false },
  gun: { id: 'gun', name: 'GUN GAME', short: 'GUN', desc: `Every kill upgrades your weapon through a ladder of ${GUN_LADDER.length}. Score a kill with the final weapon to win. Knife kills set the victim back a level.`, limit: GUN_LADDER.length, time: 600, teams: false },
  survival: { id: 'survival', name: 'SURVIVAL', short: 'SRV', desc: 'Hold out against endless, escalating waves of Korvax assault troops. One life.', limit: 0, time: 0, teams: true },
};

export const TEAM_NAMES = { A: 'IRONFRONT', B: 'KORVAX' };

export class Game {
  constructor(R, input, hud) {
    this.R = R; this.input = input; this.hud = hud;
    this.world = new World();
    this.fx = new Effects(R);
    this.vm = new Viewmodel(R);
    this.buy = new BuySystem(this);
    this.cash = 0;
    // sound occlusion: is there solid geometry between the listener and a sound source?
    const _occ = new THREE.Vector3();
    audio.occluded = (p) => this.world && !this.world.lineOfSight(this.R.camera.position, _occ.set(p.x, p.y + 0.9, p.z));
    // spent casings hit the ground a moment after they are thrown
    this.vm.onCasing = (shotgun) => setTimeout(() => audio._fx('shell', null, shotgun ? 0.14 : 0.1, 0, shotgun ? 0.85 : 1.6, 0.15), rand(380, 640));
    this.streaks = new StreakSystem(this);
    this.airstrikeTargeting = new AirstrikeTargeting(this);
    this.player = new Player(this, profile.data.name);
    this.actors = [];
    this.bots = [];
    this.projectiles = [];
    this.tags = [];
    this.time = 0;
    this.running = false;
    this.paused = false;
    this.shakeAmt = 0;
    this.shakeVec = new THREE.Vector3();
    this.map = null;
    this.onMatchEnd = null;
    this.navBudget = 3;
    this.timers = [];
    this.killcam = new Killcam(this);
    this.pickups = new Pickups(this);
    this.nadeMesh = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshStandardMaterial({ color: 0x3f4a32, roughness: 0.6 }));
    this.rocketMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8), new THREE.MeshStandardMaterial({ color: 0x47513b }));
    this.rocketMesh.geometry.rotateX(Math.PI / 2);
  }

  get ffa() { return this.mode && !this.mode.teams; }

  loadMap(id) {
    if (this.map) { this.R.scene.remove(this.map.group); disposeModel(this.map.group); } // keeps the shared prop geometry for the next map
    this.map = buildMap(id, this.R, this.world);
    this.R.scene.add(this.map.group);
    this.R.setTheme(this.map.theme);
    audio.defaultStep = 'sand';   // soft forest floor: the gritty steps read as dirt and needles
    this.flagObjs = [];
  }

  // ------------------------------------------------------------------ MATCH SETUP
  start(cfg) {
    this.cfg = cfg;
    this.mode = MODES[cfg.mode];
    this.cleanupMatch();
    if (!this.map || this.map.id !== cfg.map || this.map.detail !== this.R.detail) this.loadMap(cfg.map);
    else this.map.barrels.forEach((b) => this.resetBarrel(b));
    this.time = 0;
    this.running = true; this.paused = false; this.over = false;
    this.scores = { A: 0, B: 0 };
    this.timeLeft = this.mode.time;
    this.stats = { shots: 0, hits: 0, headshots: 0, kills: 0, deaths: 0, xp: 0, medals: [], bestStreak: 0, assists: 0 };
    this.lastKillTime = -99; this.multi = 0; this.firstBlood = false; this.lastKiller = null;
    this.lastKill = null; this.endMsgT = null; this.endT = 0; this.deathCam = null; this.timers = [];
    this.modifier = MODIFIERS[cfg.modifier] || null;
    this.session = new MatchSession(this);
    this.player.name = profile.data.name;
    this.player.maxHealth = this.modifier?.health || 100;
    this.player.setLoadout(this.playerLoadout());
    this.player.team = this.ffa ? 'P' : 'A';
    this.player.kills = this.player.deaths = this.player.score = this.player.assists = this.player.captures = this.player.confirms = 0;
    this.player.gunLevel = 0;
    if (this.mode.id === 'gun') this.player.setSingleWeapon(WEAPONS[GUN_LADDER[0]]);
    this.playerStreaks = this.mode.id === 'gun' ? [] : createRewards(STREAKS);
    this.boughtLoadout = null; this.buy.close();
    this.cash = this.mode.id === 'survival' ? 500 : START_CASH;
    this.hud.cash(this.cash, 0, '');
    document.getElementById('cash').hidden = this.mode.id === 'gun';   // no shopping in Gun Game
    this.actors = [this.player];
    this.bots = [];
    const names = shuffle([...CALLSIGNS]);
    const diff = cfg.difficulty || 'regular';
    if (this.mode.id === 'survival') {
      this.wave = 0; this.waveState = 'intermission'; this.waveT = 6; this.toSpawn = 0;
    } else if (this.mode.teams) {
      for (let i = 0; i < 5; i++) this.addBot(names.pop(), 'A', 'ironfront', diff);
      for (let i = 0; i < 6; i++) this.addBot(names.pop(), 'B', 'korvax', diff);
    } else {
      for (let i = 0; i < 7; i++) this.addBot(names.pop(), 'F' + i, Math.random() < 0.5 ? 'korvax' : 'ironfront', diff);
    }
    // objectives
    if (this.mode.id === 'dom') this.setupFlags();
    if (this.mode.id === 'hp') this.setupHardpoint();
    // spawn everyone
    for (const a of this.actors) this.spawnActor(a, true);
    this.R.camera.fov = profile.s.fov;
    this.vm.setVisible(true);
    this.hud.matchStart(this);
    const boosts = [this.modifier?.name, ...this.session.boost.list].filter(Boolean);
    if (boosts.length) this.after(3.2, () => this.hud.toast(boosts.join(' · '), 'gold'));
    audio.startMusic('match');
    audio.startAmbience();
    clearTimeout(this._musicT);
    this._musicT = setTimeout(() => { if (this.running) audio.stopMusic(); }, 9000);
  }

  /** The player's class, with weapons replaced when the match modifier forces them. */
  playerLoadout() {
    if (this.boughtLoadout && this.mode.id !== 'gun') return this.boughtLoadout;   // a class bought at a buy station
    const lo = profile.data.loadout, m = this.modifier;
    return m?.loadout && this.mode.id !== 'gun' ? { ...lo, ...m.loadout } : lo;
  }

  get botWeaponPool() { return this.modifier?.bots && this.mode?.id !== 'gun' ? this.modifier.bots : null; }

  addBot(name, team, faction, diff) {
    const b = new Bot(this, name, team, faction, diff);
    if (this.modifier?.health) b.maxHealth = this.modifier.health;
    // The HUD health marker supplies the callsign, avoiding duplicate floating labels.
    this.bots.push(b); this.actors.push(b);
    return b;
  }

  cleanupMatch() {
    this.airstrikeTargeting.close(false);
    for (const b of this.bots) { this.R.scene.remove(b.model.root); b.model.dispose(); }
    for (const p of this.projectiles) this.R.scene.remove(p.mesh);
    for (const t of this.tags) this.R.scene.remove(t.mesh);
    for (const f of this.flagObjs || []) this.R.scene.remove(f.group);
    if (this.hp) this.R.scene.remove(this.hp.group);
    this.flagObjs = []; this.flags = null; this.hp = null;
    this.projectiles = []; this.tags = []; this.timers = [];
    this.streaks.reset();
    this.killcam.reset();
    this.pickups.clear();
    this.fx.clear();
  }

  /** Run fn after `delay` seconds of match time. */
  after(delay, fn) { this.timers.push({ t: this.time + delay, fn }); }

  quit() {
    clearTimeout(this._musicT);
    this.buy.close();
    audio.stopAmbience();
    this.running = false;
    this.cleanupMatch();
    this.bots = []; this.actors = [this.player];
    this.player.alive = false;
    this.vm.setVisible(false);
  }

  setupFlags() {
    this.flags = this.map.flags.map((f) => ({ ...f, owner: null, progress: 0, capTeam: null, contested: false }));
    for (const f of this.flags) {
      const g = new THREE.Group();
      g.position.copy(f.pos);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.2, 8), new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8, roughness: 0.3 }));
      pole.position.y = 1.6; g.add(pole);
      const clothMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, side: THREE.DoubleSide, roughness: 0.8 });
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7, 6, 1), clothMat);
      cloth.position.set(0.58, 2.8, 0); g.add(cloth);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(new THREE.RingGeometry(4.6, 5, 48), ringMat);
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; g.add(ring);
      this.R.scene.add(g);
      f.group = g; f.cloth = cloth; f.clothMat = clothMat; f.ringMat = ringMat;
      this.flagObjs.push(f);
    }
  }

  setupHardpoint() {
    const g = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(HP_RADIUS - 0.3, HP_RADIUS, 64), ringMat);
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05;
    const wallMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(HP_RADIUS, HP_RADIUS, 2.2, 64, 1, true), wallMat);
    wall.position.y = 1.1;
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 40, 12, 1, true), beamMat);
    beam.position.y = 20;
    g.add(ring, wall, beam);
    this.R.scene.add(g);
    this.hp = { pts: this.map.hardpoints, idx: 0, t: HP_ROTATE, group: g, mats: [ringMat, wallMat, beamMat], owner: null, contested: false, tick: 0, xpAcc: 0, warned: false, playerIn: false };
    this.moveHardpoint(0);
  }

  moveHardpoint(i) {
    const h = this.hp;
    h.idx = i % h.pts.length; h.t = HP_ROTATE; h.warned = false; h.owner = null; h.tick = 0; h.contested = false;
    h.group.position.copy(h.pts[h.idx]);
    if (this.time > 1) { this.hud.toast('NEW HARDPOINT ONLINE'); audio.radio('ally'); }
    for (const b of this.bots) if (b.state === 'roam') b.pathT = Math.min(b.pathT, rand(0, 2.5));
  }

  get hpPos() { return this.hp ? this.hp.pts[this.hp.idx] : null; }

  updateHardpoint(dt) {
    const h = this.hp;
    if (!h) return;
    h.t -= dt;
    if (h.t <= 10 && !h.warned) { h.warned = true; this.hud.toast('HARDPOINT MOVING IN 10 SECONDS'); }
    if (h.t <= 0) this.moveHardpoint(h.idx + 1);
    const c = this.hpPos;
    let a = 0, b = 0;
    for (const o of this.actors) if (o.alive && Math.hypot(o.pos.x - c.x, o.pos.z - c.z) < HP_RADIUS && Math.abs(o.pos.y - c.y) < 4) { if (o.team === 'A') a++; else b++; }
    h.contested = a > 0 && b > 0;
    const p = this.player;
    h.playerIn = p.alive && Math.hypot(p.pos.x - c.x, p.pos.z - c.z) < HP_RADIUS && Math.abs(p.pos.y - c.y) < 4;
    const holder = h.contested ? h.owner : a ? 'A' : b ? 'B' : null;
    if (holder !== h.owner) {
      if (holder) {
        const mine = holder === p.team;
        this.hud.toast(mine ? 'HARDPOINT SECURED' : 'ENEMY HAS THE HARDPOINT', mine ? 'ally' : 'enemy');
        audio.radio(mine ? 'ally' : 'enemy');
      }
      h.owner = holder;
    }
    h.tick += dt;
    if (h.tick >= 1) {
      h.tick -= 1;
      if (holder && !h.contested) {
        this.scores[holder] += 1;
        for (const o of this.actors) if (o.alive && o.team === holder && Math.hypot(o.pos.x - c.x, o.pos.z - c.z) < HP_RADIUS) { o.score += 10; o.captures++; }
        if (h.playerIn && holder === p.team) {
          this.addXP(10); h.xpAcc += 10; this.session.event('hpTime'); this.buy.earn(CASH.hardpointSec, '');
          if (h.xpAcc >= 50) { this.hud.xp('HOLDING HARDPOINT', h.xpAcc); h.xpAcc = 0; }
        }
        this.checkWin();
      }
    }
    const col = h.contested ? 0xf2b33d : h.owner === null ? 0xffffff : h.owner === p.team ? 0x4fb3ff : 0xff4b3e;
    for (const m of h.mats) m.color.setHex(col);
    h.mats[0].opacity = 0.4 + Math.sin(this.time * 4) * 0.15;
  }

  // ------------------------------------------------------------------ GUN GAME
  applyGunLevel(a) {
    const def = WEAPONS[GUN_LADDER[Math.min(a.gunLevel, GUN_LADDER.length - 1)]];
    if (a.isPlayer) a.setSingleWeapon(def);
    else a.setWeapon(def);
  }

  gunKill(killer, victim, melee, suicide) {
    if ((melee || suicide) && victim.gunLevel > 0) {
      victim.gunLevel--;
      if (victim.isPlayer) this.hud.toast('SET BACK — YOU LOST A WEAPON LEVEL', 'enemy');
      else if (killer && killer.isPlayer) { this.hud.medal('HUMILIATION', '+100'); this.addXP(100); }
    }
    if (suicide || melee || !killer) return;
    killer.gunLevel++;
    if (killer.gunLevel >= GUN_LADDER.length) {
      this.end(killer.team, `${killer.isPlayer ? 'YOU' : killer.name} CLEARED THE LADDER`);
      return;
    }
    this.applyGunLevel(killer);
    if (killer.isPlayer) {
      const last = killer.gunLevel === GUN_LADDER.length - 1;
      this.hud.xp(last ? 'FINAL WEAPON' : 'WEAPON UPGRADE', 50); this.addXP(50); this.session.event('gunlevel');
      audio.radio('level');
    } else if (killer.gunLevel === GUN_LADDER.length - 1) this.hud.toast(`${killer.name} IS ON THE FINAL WEAPON`, 'enemy');
  }

  // ------------------------------------------------------------------ SPAWNING
  spawnActor(a, initial = false) {
    const m = this.map;
    let list;
    if (this.mode.id === 'survival') list = a.isPlayer ? [m.survivalSpawn || (m.id === 'outpost' ? new THREE.Vector3(0, 0, -16) : new THREE.Vector3(2, 0, 37))] : m.spawns.ffa;
    else if (this.ffa) list = m.spawns.ffa;
    else list = initial ? m.spawns[a.team] : (Math.random() < 0.75 ? m.spawns[a.team] : [...m.spawns[a.team], ...m.spawns.ffa]);
    const enemies = this.actors.filter((o) => o.alive && o !== a && a.isEnemy(o, this.ffa));
    const friends = this.actors.filter((o) => o.alive && o !== a && !a.isEnemy(o, this.ffa));
    let best = list[0], bestScore = -Infinity;
    for (const p of list) {
      const score = spawnScore(p, enemies, friends, this.world, rand(0, 6));
      if (score > bestScore) { bestScore = score; best = p; }
    }
    const p = best.clone();
    p.x += rand(-0.8, 0.8); p.z += rand(-0.8, 0.8);
    if (this.world.overlaps(p.x, p.y + 0.05, p.z, 0.4, 1.8) || this.actors.some((o) => o !== a && o.alive && o.pos.distanceTo(p) < 1.2)) p.copy(best);
    // face map centre
    const yaw = Math.atan2(p.x, p.z) + rand(-0.3, 0.3);
    if (a.isPlayer && this.mode.id !== 'gun') a.setLoadout(this.playerLoadout());
    a.spawn(p, yaw);
    a.damagers.clear();
    if (this.mode.id === 'gun') this.applyGunLevel(a);
  }

  // ------------------------------------------------------------------ COMBAT
  fireBullet(shooter, origin, dir, def, opts = {}) {
    const maxRange = 400;
    const hit = this.world.raycast(origin, dir, maxRange);
    let wallT = hit ? hit.t : maxRange;
    const wallHit = hit ? { point: hit.point.clone(), normal: hit.normal.clone(), surface: hit.surface, box: hit.box } : null;
    let victim = null, vt = wallT, part = null;
    for (const a of this.actors) {
      if (a === shooter || !a.alive) continue;
      if (!shooter.isEnemy(a, this.ffa)) continue;
      const r = a.hitTest(origin, dir, vt);
      if (r && r.t < vt) { vt = r.t; victim = a; part = r.part; }
    }
    const end = _end.copy(origin).addScaledVector(dir, victim ? vt : wallT);
    if (opts.tracer && opts.muzzle) this.fx.tracer(opts.muzzle, end, shooter.isPlayer ? 420 : 300);
    // near-miss crack for the player
    if (!shooter.isPlayer && this.player.alive && shooter.isEnemy(this.player, this.ffa) && victim !== this.player) {
      const md = this.player.missDistance(origin, dir, victim ? vt : wallT);
      if (md.dist < 1.6 && md.t > 2) { audio.whiz(_c.copy(origin).addScaledVector(dir, md.t)); this.hud.suppress(); }
    }
    // wallbang: a round that hits thin, soft cover (sheet metal, planks) carries on through it, weakened
    if (!victim && wallHit && wallHit.box && wallHit.box.min && !wallHit.box.barrel && !opts.penetrated) {
      const pen = this.penetrate(def, origin, dir, wallT, wallHit);
      if (pen) {
        this.fx.impact(wallHit.point, wallHit.normal, wallHit.surface);
        audio.impact(wallHit.point, wallHit.surface);
        const exitPt = _c.copy(origin).addScaledVector(dir, pen.exit + 0.02);
        return this.fireBullet(shooter, exitPt.clone(), dir, def, { ...opts, tracer: false, penetrated: true, distOff: pen.exit, dmgMul: (opts.dmgMul ?? 1) * pen.mul });
      }
    }
    if (victim) {
      const dist = vt + (opts.distOff || 0);
      let dmg = damageAt(def, dist) * (part === 'head' ? def.head : part === 'limb' ? def.limb : 1) * (opts.dmgMul ?? 1);
      if (part === 'head' && this.modifier?.headMul) dmg *= this.modifier.headMul;
      if (part === 'head' && def.cls === 'SNIPER RIFLE') dmg = Math.max(dmg, 200);
      this.fx.blood(end, dir);
      audio.impact(end, 'flesh');
      const wasAlive = victim.alive;
      this.lastHitInfo = { part, weapon: opts.weaponName || def.name, dist };
      victim.damage(dmg, shooter, origin, part === 'head' ? 'headshot' : 'bullet');
      this.lastHitInfo = null;
      const killed = wasAlive && !victim.alive;
      const kind = killed ? 'kill' : part === 'head' ? 'head' : 'body';
      this.killcam.shot(shooter, opts.muzzle || origin, def, { to: end, kind }, opts);
      if (shooter.isPlayer) {
        this.stats.hits++;
        const rank = { body: 0, head: 1, kill: 2 };
        // one marker/sound per frame (shotgun pellets) — keep the most important one
        if (this._hitFrame !== this.time || rank[kind] > rank[this._hitKind]) {
          this.hud.hitmarker(kind); audio.hit(kind);
          this._hitFrame = this.time; this._hitKind = kind;
        }
      }
      return { victim, part };
    }
    this.killcam.shot(shooter, opts.muzzle || origin, def, wallHit && wallT < 160 ? { to: end, kind: 'wall', normal: wallHit.normal, surface: wallHit.surface } : { to: end, kind: null }, opts);
    if (wallHit) {
      if (wallHit.box && wallHit.box.barrel) this.damageBarrel(wallHit.box.barrel, damageAt(def, wallT), shooter);
      if (wallT < 160) {
        this.fx.impact(wallHit.point, wallHit.normal, wallHit.surface);
        if (shooter.isPlayer || wallHit.point.distanceToSquared(this.R.camera.position) < 900) audio.impact(wallHit.point, wallHit.surface);
      }
    }
    return null;
  }

  /**
   * Can this round punch through the box it just hit? Returns { exit (ray distance), mul (damage left) } or null.
   * Resistance = thickness along the ray x material density; power comes from the weapon class.
   */
  penetrate(def, origin, dir, entryT, hit) {
    const density = { metal: 0.5, wood: 0.6, concrete: 3, sand: 8, ground: 99 }[hit.surface] ?? 3;
    const power = PEN_POWER[def.cls] ?? 0.2;
    if (density * 0.05 > power) return null;   // can't even start (sandbags, ground, concrete for weak guns)
    const b = hit.box;
    let tExit = Infinity;
    for (const ax of ['x', 'y', 'z']) {
      if (Math.abs(dir[ax]) < 1e-6) continue;
      const t1 = (b.min[ax] - origin[ax]) / dir[ax], t2 = (b.max[ax] - origin[ax]) / dir[ax];
      tExit = Math.min(tExit, Math.max(t1, t2));
    }
    const resist = (tExit - entryT) * density;
    if (!Number.isFinite(tExit) || resist > power) return null;
    return { exit: tExit, mul: Math.max(0.25, 0.75 - 0.5 * resist / power) };
  }

  damageBarrel(b, dmg, attacker) {
    if (!b.alive) return;
    b.hp -= dmg;
    if (b.hp <= 0) {
      b.alive = false; b.box.active = false; b.mesh.visible = false;
      setTimeout(() => { if (this.running) this.explode(b.pos.clone(), attacker, 7, 150, 'explosion', 'EXPLOSIVE BARREL'); }, 120);
    }
  }

  resetBarrel(b) { b.alive = true; b.hp = 40; b.box.active = true; b.mesh.visible = true; }

  explode(pos, owner, radius, maxDmg, cause = 'explosion', weaponName = 'FRAG GRENADE') {
    this.fx.explosion(pos, radius > 7 ? 1.4 : 1);
    this.killcam.boom(pos, radius > 7 ? 1.4 : 1);
    audio.explosion(pos, radius > 7 ? 1.3 : 1);
    const camDist = this.R.camera.position.distanceTo(pos);
    if (camDist < 40) { this.shake(clamp((40 - camDist) / 40, 0, 1) * 0.6); this.input.rumble(0.9, 0.7, 300); }
    if (camDist < 8) this.hud.flash(0.35 * (1 - camDist / 8));
    const center = _c.copy(pos).setY(pos.y + 0.6);
    let kills = 0;
    for (const a of this.actors) {
      if (!a.alive) continue;
      if (owner && a !== owner && !owner.isEnemy(a, this.ffa)) continue; // no friendly fire
      const d = a.chest(_t).distanceTo(center);
      if (d > radius) continue;
      let dmg = maxDmg * Math.pow(1 - d / radius, 1.1);
      if (!this.world.lineOfSight(center, _t)) dmg *= 0.3;
      if (a === owner) dmg *= 0.6;
      if (dmg < 2) continue;
      this.lastHitInfo = { part: 'body', weapon: weaponName, dist: owner ? owner.pos.distanceTo(a.pos) : 0 };
      const was = a.alive;
      a.damage(dmg, owner, pos, 'explosion');
      this.lastHitInfo = null;
      if (was && !a.alive && a !== owner) kills++;
      if (owner && owner.isPlayer && a !== owner) { this.hud.hitmarker(was && !a.alive ? 'kill' : 'body'); }
    }
    if (owner && owner.isPlayer && kills >= 2) profile.unlock('COLLATERAL');
    for (const b of this.map.barrels) if (b.alive && b.pos.distanceTo(pos) < radius * 0.7) this.damageBarrel(b, 999, owner);
  }

  throwGrenade(actor, target = null) {
    const eye = actor.eye(_t);
    const mesh = this.nadeMesh.clone(); mesh.castShadow = true;
    this.R.scene.add(mesh);
    let vel;
    if (target) {
      // ballistic solve with fixed flight time
      const T = clamp(actor.pos.distanceTo(target) / 14, 0.8, 1.8);
      vel = new THREE.Vector3((target.x - eye.x) / T, (target.y - eye.y + 0.5 * 18 * T * T) / T, (target.z - eye.z) / T);
    } else {
      const f = this.R.camera.getWorldDirection(new THREE.Vector3());
      vel = f.multiplyScalar(18).add(new THREE.Vector3(0, 4, 0)).add(actor.vel.clone().multiplyScalar(0.5));
    }
    const start = eye.clone();
    if (actor.isPlayer) start.add(_d.set(Math.cos(actor.yaw), 0, -Math.sin(actor.yaw)).multiplyScalar(-0.2));
    mesh.position.copy(start);
    this.projectiles.push({ type: 'nade', pos: start, vel, owner: actor, fuse: target ? 2.0 : 2.4, mesh, spin: new THREE.Vector3(rand(-9, 9), rand(-9, 9), 0) });
  }

  fireRocket(actor, pos, dir) {
    const mesh = this.rocketMesh.clone();
    this.R.scene.add(mesh);
    mesh.position.copy(pos);
    this.projectiles.push({ type: 'rocket', pos: pos.clone(), vel: dir.clone().multiplyScalar(55), owner: actor, life: 6, mesh });
    this.killcam.shot(actor, pos, actor.def, { to: pos, kind: null }, { rocket: true });
    this.onShotSound(actor, actor.pos);
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (p.type === 'nade') {
        p.fuse -= dt;
        p.vel.y -= 18 * dt;
        const step = p.vel.length() * dt;
        if (step > 1e-4) {
          _d.copy(p.vel).normalize();
          const hit = this.world.raycast(p.pos, _d, step + 0.06);
          if (hit) {
            p.pos.copy(hit.point).addScaledVector(hit.normal, 0.07);
            const vn = p.vel.dot(hit.normal);
            p.vel.addScaledVector(hit.normal, -2 * vn).multiplyScalar(0.42);
            if (Math.abs(vn) > 2) audio.bounce(p.pos);
            if (hit.normal.y > 0.7 && Math.abs(p.vel.y) < 1) { p.vel.y = 0; p.vel.x *= 0.85; p.vel.z *= 0.85; }
          } else p.pos.addScaledVector(p.vel, dt);
        }
        p.mesh.position.copy(p.pos);
        p.mesh.rotation.x += p.spin.x * dt; p.mesh.rotation.y += p.spin.y * dt;
        if (p.fuse <= 0) {
          this.R.scene.remove(p.mesh); this.projectiles.splice(i, 1);
          this.explode(p.pos.clone(), p.owner, 7, 150, 'explosion', 'FRAG GRENADE');
        }
      } else if (p.type === 'rocket') {
        p.life -= dt;
        const step = p.vel.length() * dt;
        _d.copy(p.vel).normalize();
        const hit = this.world.raycast(p.pos, _d, step);
        let hitT = hit ? hit.t : Infinity;
        let actorHit = false;
        for (const a of this.actors) {
          if (a === p.owner || !a.alive) continue;
          const r = a.hitTest(p.pos, _d, Math.min(step, hitT));
          if (r) { hitT = r.t; actorHit = true; }
        }
        if (hitT < Infinity || p.life <= 0) {
          const at = hitT < Infinity ? p.pos.clone().addScaledVector(_d, hitT) : p.pos.clone();
          if (hit && !actorHit) at.addScaledVector(hit.normal, 0.2);
          this.R.scene.remove(p.mesh); this.projectiles.splice(i, 1);
          this.explode(at, p.owner, 6.5, 160, 'explosion', 'STRIKER LAUNCHER');
          continue;
        }
        p.pos.addScaledVector(p.vel, dt);
        p.mesh.position.copy(p.pos); p.mesh.lookAt(_t.copy(p.pos).add(p.vel));
        p.smokeT = (p.smokeT || 0) + dt;
        if (p.smokeT >= 1 / 30) { p.smokeT %= 1 / 30; this.fx.smokeTrail(p.pos); }
      }
    }
  }

  meleeAttack(player) {
    const f = this.R.camera.getWorldDirection(_d).setY(0).normalize();
    let best = null, bd = 2.6;
    for (const a of this.actors) {
      if (!a.alive || !player.isEnemy(a, this.ffa)) continue;
      const to = _t.subVectors(a.pos, player.pos); to.y = 0;
      const d = to.length();
      if (d > bd || d < 0.01) continue;
      if (to.normalize().dot(f) < 0.6) continue;
      best = a; bd = d;
    }
    if (best) {
      this.lastHitInfo = { part: 'body', weapon: 'COMBAT KNIFE', dist: bd };
      best.damage(200, player, player.pos, 'melee');
      this.lastHitInfo = null;
      this.hud.hitmarker('kill'); audio.hit('kill'); audio.stab(best.chest(_t));
      this.fx.blood(best.chest(_t), f);
    }
  }

  onShotSound(shooter, pos) {
    for (const b of this.bots) b.hearShot(shooter, pos);
  }

  // ------------------------------------------------------------------ KILLS & SCORING
  onKill(killer, victim, info = {}) {
    if (!victim.alive) return;
    // lastHitInfo is set right before the damage() call that leads here and cleared right after it
    const hitInfo = this.lastHitInfo || { part: 'body', weapon: '' };
    const headshot = info.cause === 'headshot' || hitInfo.part === 'head';
    victim.alive = false;
    victim.deaths++;
    victim.streak = 0;
    const fromDir = killer ? _d.subVectors(victim.pos, killer.pos).setY(0).normalize().clone() : null;
    if (victim.die) victim.die(fromDir);
    victim.respawnT = this.mode.id === 'survival' ? Infinity : (victim.isPlayer ? 4.0 : rand(3, 5)) * (this.modifier?.respawn || 1);
    const suicide = !killer || killer === victim;
    const weaponName = info.cause === 'fall' ? 'FALL' : hitInfo.weapon;
    if (!suicide) this.lastKill = { killer, victim, t: this.time, weapon: weaponName };
    if (!suicide) {
      killer.kills++; killer.streak++; killer.score += 100;
      if (!this.ffa && this.mode.id === 'tdm') this.scores[killer.team]++;
      if (this.ffa && this.mode.id === 'ffa') { /* scores tracked per actor */ }
      // assists
      for (const [, d] of victim.damagers) {
        // assisters: anyone else who hurt the victim recently, never the victim itself (own grenade) or the killer's enemies
        if (d.a !== killer && d.a !== victim && (this.ffa || d.a.team === killer.team) && this.time - d.t < 8 && d.dmg >= 20) {
          d.a.assists++; d.a.score += 50;
          if (d.a.isPlayer) { this.hud.xp('ASSIST', 50); this.addXP(50); this.stats.assists++; this.session.event('assist'); this.buy.earn(CASH.assist, 'ASSIST'); }
        }
      }
      // bot killstreaks (team modes)
      if (!killer.isPlayer && !this.ffa && this.mode.id !== 'survival') {
        if (killer.streak === 3) this.streaks.callUAV(killer);
        if (killer.streak === 5) {
          const targets = this.actors.filter((a) => a.alive && a.team !== killer.team);
          if (targets.length) { const t = pick(targets).pos.clone(); t.x += rand(-4, 4); t.z += rand(-4, 4); this.streaks.callAirstrike(killer, t); }
        }
      }
    }
    if (victim.isPlayer) {
      this.buy.close();
      this.stats.deaths++;
      this.lastKiller = suicide ? null : killer;
      this.hud.showDeath(suicide ? null : killer, weaponName, hitInfo.dist, headshot, this.mode.id === 'survival');
      this.deathCam = { t: 0, from: this.R.camera.position.clone(), killer: suicide ? null : killer, killT: this.time, weapon: weaponName };
      this.vm.setVisible(false);
      resetRewardProgress(this.playerStreaks);
    }
    if (killer && killer.isPlayer && !suicide) this.playerKill(victim, headshot, info, hitInfo);
    // kill feed
    this.hud.killfeed(killer, victim, weaponName, headshot, this);
    // mode hooks
    if (this.mode.id === 'kc') this.dropTag(victim);
    if (this.mode.id === 'survival' && !victim.isPlayer) this.survivalKill(victim);
    // fallen enemies drop their gun
    if (!victim.isPlayer && this.mode.id !== 'gun' && victim.def && !victim.def.rocket) this.pickups.drop(victim.def, victim.pos, victim.def.mag, Math.round(victim.def.reserve * 0.4));
    if (this.mode.id === 'gun') this.gunKill(killer, victim, info.cause === 'melee', suicide);
    this.checkWin();
  }

  playerKill(victim, headshot, info, hitInfo) {
    const p = this.player;
    this.stats.kills++;
    this.stats.bestStreak = Math.max(this.stats.bestStreak, p.streak);
    let xp = 100;
    const medal = (name, amount) => { this.hud.medal(name, `+${amount}`); xp += amount; this.session.event('medal'); cash += CASH.medal; };
    let cash = CASH.kill + (headshot ? CASH.headshot : 0);
    this.hud.xp('KILL', 100);
    this.hud.elimination(victim.name,headshot,this.time);
    const longshot = hitInfo.dist > 45 && info.cause !== 'explosion';
    if (headshot) { this.stats.headshots++; this.hud.xp('HEADSHOT', 50); xp += 50; profile.data.stats.headshots++; if (profile.data.stats.headshots >= 100) profile.unlock('HEADHUNTER'); }
    if (info.cause === 'melee') { medal('BLADE MASTER', 75); profile.unlock('KNIFE'); }
    if (!this.firstBlood) { this.firstBlood = true; medal('FIRST BLOOD', 100); }
    if (longshot) medal('LONGSHOT', 50);
    if (this.lastKiller && victim === this.lastKiller) { medal('PAYBACK', 50); this.lastKiller = null; }
    if (victim.streak >= 3) medal('BUZZKILL', 50);
    if (this.time - this.lastKillTime < 4) this.multi++; else this.multi = 1;
    this.lastKillTime = this.time;
    const multiNames = { 2: 'DOUBLE KILL', 3: 'TRIPLE KILL', 4: 'FURY KILL', 5: 'FRENZY KILL', 6: 'MEGA KILL' };
    if (this.multi >= 2) { medal(multiNames[Math.min(6, this.multi)], this.multi * 50); this.session.event('multikill'); }
    if (p.streak === 5) { medal('5 KILL STREAK', 100); profile.unlock('STREAK_5'); this.session.event('streak5'); }
    if (p.streak === 10) { medal('10 KILL STREAK', 250); profile.unlock('STREAK_10'); }
    profile.unlock('FIRST_BLOOD');
    this.addXP(xp);
    this.buy.earn(cash, headshot ? 'HEADSHOT' : 'KILL');
    const weapon = this.lastKill?.weapon || hitInfo.weapon;
    this.session.kill(weapon, { headshot, longshot, melee: info.cause === 'melee', explosive: info.cause === 'explosion' && weapon !== 'AIRSTRIKE' });
    // Rewards repeat each ladder cycle; unused charges never overwrite one another.
    for (const {reward:s,index:i} of earnRewards(this.playerStreaks,p.streak)) {
      this.hud.toast(`${s.name} READY — PRESS ${this.input.lastDevice === 'pad' ? ['◀', '▲', '▶'][i] : ['3', '4', '5'][i]}`);
      audio.radio('ally');
    }
    if (p.perks.has('scavenger')) for (const w of p.weapons) w.reserve = Math.min(w.def.reserve, w.reserve + Math.ceil(w.def.mag * 0.5));
  }

  addXP(n) { this.stats.xp += n; }

  dropTag(victim) {
    const g = new THREE.Group();
    const col = victim.team === this.player.team ? 0x4fb3ff : 0xff4b3e;
    const m = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.2, metalness: 0.6, roughness: 0.3 });
    const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.32, 0.02), m); g.add(t1);
    const t2 = t1.clone(); t2.position.set(0.06, -0.04, 0.03); t2.rotation.z = 0.3; g.add(t2);
    g.position.copy(victim.pos).setY(victim.pos.y + 0.9);
    this.R.scene.add(g);
    this.tags.push({ mesh: g, team: victim.team, pos: g.position.clone(), t: 0 });
  }

  updateTags(dt) {
    for (let i = this.tags.length - 1; i >= 0; i--) {
      const tag = this.tags[i];
      tag.t += dt;
      tag.mesh.rotation.y += dt * 3;
      tag.mesh.position.y = tag.pos.y + Math.sin(tag.t * 3) * 0.1;
      let taken = null;
      for (const a of this.actors) if (a.alive && Math.hypot(a.pos.x - tag.pos.x, a.pos.z - tag.pos.z) < 1.4 && Math.abs(a.pos.y + 0.9 - tag.pos.y) < 2) { taken = a; break; }
      if (taken || tag.t > 30) {
        if (taken) {
          if (taken.team === tag.team) {
            if (taken.isPlayer) { this.hud.xp('KILL DENIED', 50); this.addXP(50); this.buy.earn(CASH.deny, 'DENIED'); }
          } else {
            this.scores[taken.team]++;
            taken.confirms++; taken.score += 100;
            if (taken.isPlayer) { this.hud.xp('KILL CONFIRMED', 100); this.addXP(100); this.session.event('confirm'); this.buy.earn(CASH.confirm, 'CONFIRMED'); }
          }
          audio.click(0.4, 3000, 0.05, null, tag.pos);
        }
        this.R.scene.remove(tag.mesh); this.tags.splice(i, 1);
      }
    }
    if (this.mode.id === 'kc') this.checkWin();
  }

  updateFlags(dt) {
    if (!this.flags) return;
    this.flagTick = (this.flagTick || 0) + dt;
    for (const f of this.flags) {
      let a = 0, b = 0;
      for (const o of this.actors) if (o.alive && Math.hypot(o.pos.x - f.pos.x, o.pos.z - f.pos.z) < 5 && Math.abs(o.pos.y - f.pos.y) < 3) { if (o.team === 'A') a++; else b++; }
      f.contested = a > 0 && b > 0;
      f.playerIn = this.player.alive && Math.hypot(this.player.pos.x - f.pos.x, this.player.pos.z - f.pos.z) < 5;
      if (!f.contested && (a || b)) {
        const team = a ? 'A' : 'B', n = Math.min(3, a || b);
        if (f.owner !== team) {
          if (f.capTeam !== team) { f.progress = Math.max(0, f.progress - dt * 0.5 * n); if (f.progress === 0) f.capTeam = team; }
          else {
            f.progress += dt * n / 7;
            if (f.progress >= 1) {
              const prev = f.owner;
              f.owner = team; f.progress = 0; f.capTeam = null;
              const mine = team === this.player.team;
              this.hud.toast(`${mine ? 'CAPTURED' : 'LOST'} ${f.name}`, mine ? 'ally' : 'enemy');
              audio.radio(mine ? 'ally' : 'enemy');
              for (const o of this.actors) if (o.alive && o.team === team && Math.hypot(o.pos.x - f.pos.x, o.pos.z - f.pos.z) < 5) {
                o.captures++; o.score += 150;
                if (o.isPlayer) { this.hud.xp(prev ? 'CAPTURE' : 'SECURE', 150); this.addXP(150); this.session.event('capture'); this.buy.earn(CASH.capture, 'CAPTURE'); }
              }
            }
          }
        }
      } else if (!a && !b && f.capTeam) f.progress = Math.max(0, f.progress - dt * 0.15);
      const col = f.owner === null ? 0xdddddd : f.owner === this.player.team ? 0x4fb3ff : 0xff4b3e;
      f.clothMat.color.setHex(col); f.ringMat.color.setHex(col);
      const pos = f.cloth.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) { const x = pos.getX(i) + 0.55; pos.setZ(i, Math.sin(this.time * 5 + x * 5) * 0.08 * x); }
      pos.needsUpdate = true;
    }
    if (this.flagTick >= 4) {
      this.flagTick = 0;
      for (const f of this.flags) if (f.owner) this.scores[f.owner] += 1;
      this.checkWin();
    }
  }

  // ------------------------------------------------------------------ SURVIVAL
  survivalKill() {
    this.waveKills++;
    this.player.score += 100;
  }

  updateSurvival(dt) {
    if (this.waveState === 'intermission') {
      this.waveT -= dt;
      if (this.waveT <= 0) {
        this.wave++;
        this.waveState = 'active';
        this.toSpawn = 4 + this.wave * 2;
        this.waveKills = 0; this.waveTotal = this.toSpawn;
        this.hud.center(`WAVE ${this.wave}`, 'HOSTILES INBOUND', 2.5);
        audio.radio('enemy');
        if (this.wave >= 10) profile.unlock('SURVIVOR');
      }
      return;
    }
    const alive = this.bots.filter((b) => b.alive).length;
    const diffKeys = Object.keys(DIFFICULTY);
    const diff = diffKeys[Math.min(3, Math.floor((this.wave - 1) / 3))];
    this.spawnCD = (this.spawnCD || 0) - dt;
    if (this.toSpawn > 0 && alive < Math.min(10, 3 + this.wave) && this.spawnCD <= 0) {
      this.spawnCD = 0.8;
      let b = this.bots.find((x) => !x.alive && x.deadT > 4);
      if (!b) b = this.addBot(pick(CALLSIGNS), 'B', 'korvax', diff);
      b.diff = DIFFICULTY[diff];
      // spawn far from the player
      const pts = this.map.spawns.ffa.filter((p) => p.distanceTo(this.player.pos) > 28);
      const p = pick(pts.length ? pts : this.map.spawns.ffa).clone();
      b.spawn(p, Math.atan2(p.x - this.player.pos.x, p.z - this.player.pos.z));
      b.health = b.maxHealth = 100 + Math.max(0, this.wave - 5) * 10;
      this.toSpawn--;
    }
    if (this.toSpawn === 0 && alive === 0) {
      this.waveState = 'intermission'; this.waveT = 9;
      const bonus = 150 * this.wave;
      this.hud.center('WAVE CLEARED', `+${bonus} XP`, 2.5);
      this.hud.xp('WAVE BONUS', bonus); this.addXP(bonus); this.session.event('wave');
      this.buy.earn(CASH.wave + this.wave * 50, 'WAVE CLEARED');
      const p = this.player;
      p.health = p.maxHealth; p.grenades = Math.min(4, p.grenades + 1);
      for (const w of p.weapons) w.reserve = w.def.reserve;
      audio.radio('level');
    }
  }

  // ------------------------------------------------------------------ BOT GOALS
  botGoal(bot) {
    const m = this.map;
    if (this.mode.id === 'survival') {
      const t = this.player.pos.clone(); t.x += rand(-6, 6); t.z += rand(-6, 6); return t;
    }
    if (this.mode.id === 'dom' && this.flags) {
      const others = this.flags.filter((f) => f.owner !== bot.team);
      let f;
      if (others.length && Math.random() < 0.8) {
        others.sort((a, b) => a.pos.distanceTo(bot.pos) - b.pos.distanceTo(bot.pos));
        f = Math.random() < 0.7 ? others[0] : pick(others);
      } else f = pick(this.flags);
      return f.pos.clone().add(new THREE.Vector3(rand(-3, 3), 0, rand(-3, 3)));
    }
    if (this.mode.id === 'hp' && this.hp && Math.random() < 0.85) {
      return this.hpPos.clone().add(new THREE.Vector3(rand(-4, 4), 0, rand(-4, 4)));
    }
    if (this.mode.id === 'kc') {
      let best = null, bd = 30;
      for (const t of this.tags) { const d = t.pos.distanceTo(bot.pos); if (d < bd) { bd = d; best = t; } }
      if (best) return best.pos.clone().setY(0);
    }
    const enemyUAV = !this.ffa && this.streaks.uavActive(bot.team);
    const enemies = this.actors.filter((a) => a.alive && bot.isEnemy(a, this.ffa));
    if (enemies.length && (enemyUAV || Math.random() < 0.45)) {
      const e = pick(enemies);
      return e.pos.clone().add(new THREE.Vector3(rand(-8, 8), 0, rand(-8, 8)));
    }
    return pick(m.roam).clone();
  }

  // ------------------------------------------------------------------ AIM ASSIST
  aimAssistTarget(p) {
    if (this._aaT && this.time - this._aaT < 0.05) return this._aa;
    this._aaT = this.time; this._aa = null;
    const eye = p.eye(_t);
    let best = null, bestA = Infinity;
    for (const a of this.actors) {
      if (!a.alive || !p.isEnemy(a, this.ffa)) continue;
      const c = a.chest(_c);
      const dx = c.x - eye.x, dy = c.y - eye.y, dz = c.z - eye.z, d = Math.hypot(dx, dy, dz);
      if (d > 70) continue;
      const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
      const ang = Math.hypot(wrapAngle(yaw - p.yaw), pitch - p.pitch);
      const lim = Math.atan(1.1 / d) + 1.5 * DEG;
      if (ang < lim && ang < bestA && this.world.lineOfSight(eye, c)) { bestA = ang; best = { yaw, pitch, actor: a }; }
    }
    this._aa = best;
    return best;
  }

  aimSnap(p) {
    const eye = p.eye(_t);
    let best = null, bestA = 9 * DEG;
    for (const a of this.actors) {
      if (!a.alive || !p.isEnemy(a, this.ffa)) continue;
      const c = a.chest(_c);
      const dx = c.x - eye.x, dy = c.y - eye.y, dz = c.z - eye.z;
      if (Math.hypot(dx, dz) > 60) continue;
      const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
      const ang = Math.hypot(wrapAngle(yaw - p.yaw), pitch - p.pitch);
      if (ang < bestA && this.world.lineOfSight(eye, c)) { bestA = ang; best = { yaw, pitch }; }
    }
    if (best) { p.yaw += wrapAngle(best.yaw - p.yaw) * 0.65; p.pitch += (best.pitch - p.pitch) * 0.65; }
  }

  // ------------------------------------------------------------------ STREAKS (player)
  useStreak(i) {
    const s = this.playerStreaks[i];
    const p = this.player;
    if (!s || s.charges <= 0 || !p.alive || this.airstrikeTargeting?.open) return;
    if (s.id === 'uav') this.streaks.callUAV(p);
    else if (s.id === 'airstrike') {
      this.airstrikeTargeting.begin(s);
      return;
    } else if (s.id === 'sentry') {
      const f = _d.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
      const pos = p.pos.clone().addScaledVector(f, 1.6);
      if (this.world.overlaps(pos.x, pos.y + 0.1, pos.z, 0.4, 1.2)) pos.copy(p.pos);
      this.streaks.placeSentry(p, pos, p.yaw);
    }
    consumeReward(s);
    this.session.event('streakUsed');
  }

  // ------------------------------------------------------------------ WIN CONDITIONS
  checkWin() {
    if (this.over || !this.running) return;
    const m = this.mode;
    if (m.id === 'survival') {
      if (!this.player.alive) this.end(null, `SURVIVED ${Math.max(0, this.wave - 1)} WAVES`);
      return;
    }
    if (m.id === 'gun') return; // decided in gunKill / on time
    if (m.teams) {
      if (this.scores.A >= m.limit) this.end('A');
      else if (this.scores.B >= m.limit) this.end('B');
    } else {
      const top = this.actors.reduce((x, y) => (y.kills > x.kills ? y : x));
      if (top.kills >= m.limit) this.end(top.team);
    }
  }

  end(winnerTeam, subtitle) {
    if (this.over) return;
    this.over = true;
    this.airstrikeTargeting.close(false);
    const win = this.mode.id === 'survival' ? null : winnerTeam === this.player.team;
    this.endT = 0;
    const outcome = this.mode.id === 'survival' ? 'survival' : win ? 'win' : winnerTeam === 'draw' ? 'draw' : 'lose';
    const bonus = outcome === 'win' ? 750 : outcome === 'survival' ? 0 : 300;
    if (bonus) { this.addXP(bonus); }
    this.result = { outcome, subtitle, bonus, winnerTeam };
    const showResult = () => {
      this.endMsgT = this.endT || 0;
      this.hud.center(outcome === 'win' ? 'VICTORY' : outcome === 'lose' ? 'DEFEAT' : outcome === 'draw' ? 'DRAW' : 'GAME OVER', subtitle || (outcome === 'win' ? 'MISSION ACCOMPLISHED' : 'MISSION FAILED'), 3.5);
      audio.radio(outcome === 'win' ? 'level' : 'enemy');
      this.after(4.2, () => { if (this.onMatchEnd) this.onMatchEnd(this.result); });
    };
    // final killcam: replay the kill that ended the match
    this.killcam.stop(true);
    const fk = this.lastKill;
    if (fk && this.time - fk.t < 4 && profile.s.killcam) {
      this.hud.center('MATCH OVER', 'FINAL KILLCAM', 1.1);
      this.after(1.2, () => { if (!this.killcam.start(fk.killer, fk.victim, fk.t, { final: true, weapon: fk.weapon, onDone: showResult })) showResult(); });
    } else showResult();
    // persist stats
    const st = profile.data.stats;
    st.kills += this.stats.kills; st.deaths += this.stats.deaths; st.matches++;
    st.shots += this.stats.shots; st.hits += this.stats.hits;
    st.bestStreak = Math.max(st.bestStreak, this.stats.bestStreak);
    if (outcome === 'win') { st.wins++; profile.unlock('WINNER'); } else if (outcome === 'lose') st.losses++;
    if (this.mode.id === 'survival') st.survivalBest = Math.max(st.survivalBest, this.wave - 1);
    this.result.report = this.session.commit(this.result);
    this.result.levelsGained = this.result.report.levels;
  }

  shake(a) { this.shakeAmt = Math.min(1, this.shakeAmt + a); }

  // ------------------------------------------------------------------ MAIN UPDATE
  update(dt, a) {
    if (!this.running || this.paused) return;
    this.time += dt;
    this.navBudget = 3;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (this.time >= this.timers[i].t) { const tm = this.timers.splice(i, 1)[0]; tm.fn(); }
    }
    const p = this.player;
    const kc = this.killcam;
    if (this.airstrikeTargeting.open && !p.alive) this.airstrikeTargeting.close(false);
    if (this.targetFireBlocked) {
      if (!a.fire) this.targetFireBlocked = false;
      else a = { ...a, fire: false, fireP: false };
    }
    // skip a playing killcam (needs a moment so the death-spam press doesn't skip it instantly)
    if (kc.active && a.jumpP && kc.kc.t - kc.kc.t0 > 0.5) kc.stop();
    if (!this.over) {
      if (p.alive && this.airstrikeTargeting.open) {
        this.airstrikeTargeting.update(dt, a);
        p.update(dt, this.buy.idle(a));
      } else if (p.alive && this.buy.open) {
        // shopping: the match keeps running, the player stands still
        this.buy.update(a);
        p.update(dt, this.buy.idle(a));
      } else if (p.alive) {
        p.update(dt, a);
        if (a.streakP[0]) this.useStreak(0);
        if (a.streakP[1]) this.useStreak(1);
        if (a.streakP[2]) this.useStreak(2);
      } else if (this.mode.id !== 'survival') {
        p.respawnT -= dt;
        const dc = this.deathCam;
        if (dc && !dc.kcTried && dc.t > 1.6) {
          dc.kcTried = true;
          if (dc.killer && kc.start(dc.killer, p, dc.killT, { weapon: dc.weapon })) this.hud.hideDeath();
        }
        if (!kc.active && (p.respawnT <= 0 || (p.respawnT < 2.5 && (a.jumpP || a.fireP)))) {
          this.spawnActor(p);
          this.deathCam = null;
          this.hud.hideDeath();
          this.vm.setVisible(true);
        }
      }
      for (const b of this.bots) {
        b.update(dt);
        if (!b.alive && this.mode.id !== 'survival') { b.respawnT -= dt; if (b.respawnT <= 0) this.spawnActor(b); }
      }
      if (!p.alive) this.airstrikeTargeting.close(false);
      // timer
      if (this.mode.time > 0) {
        this.timeLeft -= dt;
        if (this.timeLeft <= 0) {
          this.timeLeft = 0;
          if (this.mode.teams) this.end(this.scores.A === this.scores.B ? 'draw' : this.scores.A > this.scores.B ? 'A' : 'B', 'TIME LIMIT REACHED');
          else {
            const rankOf = (o) => (this.mode.id === 'gun' ? o.gunLevel * 1000 : 0) + o.kills;
            const top = this.actors.reduce((x, y) => (rankOf(y) > rankOf(x) ? y : x));
            this.end(top.team, 'TIME LIMIT REACHED');
          }
        }
      }
      if (this.mode.id === 'dom') this.updateFlags(dt);
      if (this.mode.id === 'hp') this.updateHardpoint(dt);
      if (this.mode.id === 'kc') this.updateTags(dt);
      if (this.mode.id === 'survival') this.updateSurvival(dt);
    } else {
      for (const b of this.bots) if (!b.alive) b.update(dt);
    }
    this.updateProjectiles(dt);
    this.streaks.update(dt);
    this.pickups.update(dt);
    kc.record(dt);
    this.fx.update(dt, this.R.r.domElement.height / this.R.r.getPixelRatio());

    // camera
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.8);
    const s = this.shakeAmt * this.shakeAmt * 0.06 * profile.s.screenShake;
    this.shakeVec.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s * 0.5);
    const cam = this.R.camera;
    if (kc.update(dt)) {
      // killcam drives the camera and viewmodel
    } else if (p.alive) {
      p.applyCamera(cam, dt);
      this.vm.update(p.vmState(dt));
    } else if (this.deathCam) {
      const dc = this.deathCam;
      dc.t += dt;
      const k = Math.min(1, dc.t / 1.2);
      cam.position.copy(dc.from);
      cam.position.y = dc.from.y + (p.pos.y + 0.35 - dc.from.y) * k;
      if (dc.killer) {
        const target = _t.copy(dc.killer.pos).setY(dc.killer.pos.y + 1.3);
        const m = _m4.lookAt(cam.position, target, _up);
        _q.setFromRotationMatrix(m);
        cam.quaternion.slerp(_q, Math.min(1, dt * 3));
      } else cam.rotation.z = damp(cam.rotation.z, 0.6, 2, dt);
      if (dc.t > 1.0 && dc.killer) cam.fov = damp(cam.fov, 45, 2, dt), cam.updateProjectionMatrix();
    }
    this.R.updateSun(cam.position);
    audio.setListener(cam);

    // post fx
    const fp = this.R.finalPass.uniforms;
    fp.damage.value = kc.active ? 0 : p.alive ? clamp(1 - p.health / 70, 0, 1) * 0.8 : 0.6;
    fp.desat.value = (kc.active ? 0.12 : p.alive ? 0 : 0.5);
  }
}

// how much cover a round can get through (thickness x density); sheet-metal walls are ~0.2, crates ~0.7
const PEN_POWER = { 'SNIPER RIFLE': 0.75, 'LIGHT MACHINE GUN': 0.5, 'MARKSMAN RIFLE': 0.5, 'ASSAULT RIFLE': 0.32, 'BURST RIFLE': 0.32, 'SUBMACHINE GUN': 0.16, 'MACHINE PISTOL': 0.12, PISTOL: 0.12, SHOTGUN: 0.06 };
const _end = new THREE.Vector3(), _c = new THREE.Vector3(), _t = new THREE.Vector3(), _d = new THREE.Vector3();
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);
