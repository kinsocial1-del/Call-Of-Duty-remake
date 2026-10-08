// Killstreaks: UAV recon, precision airstrike, automated sentry gun. Also the shared jet / UAV visuals.
import * as THREE from 'three';
import { audio } from '../engine/audio.js';
import { rand, dampAngle, damp, DEG, coneDirection } from '../core/utils.js';
import { WEAPONS } from './weapons.js';

export const STREAKS = [
  { id: 'uav', name: 'UAV', short: 'UAV', kills: 3, desc: 'Reveals enemies on the minimap for 30s.' },
  { id: 'airstrike', name: 'PRECISION AIRSTRIKE', short: 'AIR', kills: 5, desc: 'Choose a target and bombing direction on the tactical map, then confirm.' },
  { id: 'sentry', name: 'SENTRY GUN', short: 'SNT', kills: 7, desc: 'Deploy an automated turret for 45s.' },
];

const jetMat = new THREE.MeshStandardMaterial({ color: 0x5b6168, roughness: 0.5, metalness: 0.6 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x1f2226, roughness: 0.5, metalness: 0.5 });
const glowMat = new THREE.MeshBasicMaterial({ color: 0xff9a40 });

function makeJet() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 14, 12), jetMat); body.rotation.x = Math.PI / 2; g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.7, 3.5, 12), jetMat); nose.rotation.x = -Math.PI / 2; nose.position.z = -8.7; g.add(nose);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), darkMat); canopy.scale.set(1, 0.8, 2.4); canopy.position.set(0, 0.6, -4.5); g.add(canopy);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(12, 0.2, 3.6), jetMat); wing.position.z = 1; g.add(wing);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(5, 0.15, 1.8), jetMat); tail.position.z = 6.2; g.add(tail);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.6, 2), jetMat); fin.position.set(0, 1.3, 6); g.add(fin);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.6, 12), glowMat); glow.position.z = 7.05; g.add(glow);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function makeUAVPlane() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 4, 8), jetMat); body.rotation.x = Math.PI / 2; g.add(body);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(9, 0.1, 0.8), jetMat); g.add(wing);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 0.5), jetMat); tail.position.z = 1.9; g.add(tail);
  return g;
}

function makeSentry(color) {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 0.06), darkMat);
    const a = (i / 3) * Math.PI * 2;
    leg.position.set(Math.cos(a) * 0.3, 0.45, Math.sin(a) * 0.3);
    leg.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
    g.add(leg);
  }
  const head = new THREE.Group(); head.position.y = 1.0; g.add(head);
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.34, 0.6), jetMat); head.add(housing);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 8), darkMat); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0, -0.6); head.add(barrel);
  const shield = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.05), darkMat); shield.position.set(0, 0.05, -0.32); head.add(shield);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshBasicMaterial({ color })); light.position.set(0.15, 0.2, -0.1); head.add(light);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, -0.98); head.add(muzzle);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { g, head, muzzle };
}

export class StreakSystem {
  constructor(game) {
    this.game = game;
    this.uavUntil = {};      // team -> time
    this.uavPlanes = [];
    this.jets = [];
    this.sentries = [];
    this.pending = [];       // scheduled callbacks {t, fn}
  }

  reset() {
    const s = this.game.R.scene;
    for (const p of this.uavPlanes) s.remove(p.mesh);
    for (const j of this.jets) s.remove(j.mesh);
    for (const t of this.sentries) s.remove(t.g);
    this.uavPlanes = []; this.jets = []; this.sentries = []; this.pending = []; this.uavUntil = {};
  }

  uavActive(team) { return (this.uavUntil[team] || 0) > this.game.time; }

  schedule(delay, fn) { this.pending.push({ t: this.game.time + delay, fn }); }

  callUAV(owner) {
    const g = this.game;
    this.uavUntil[owner.team] = Math.max(this.uavUntil[owner.team] || 0, g.time) + 30;
    const existing = this.uavPlanes.find(u => u.team === owner.team);
    if (existing) existing.until = this.uavUntil[owner.team];
    else {
      const mesh = makeUAVPlane(); g.R.scene.add(mesh);
      this.uavPlanes.push({ mesh, team: owner.team, until: this.uavUntil[owner.team], a: rand(0, 6) });
    }
    const mine = owner.team === g.player.team;
    g.hud.toast(mine ? 'FRIENDLY UAV ONLINE' : 'ENEMY UAV ONLINE', mine ? 'ally' : 'enemy');
    audio.radio(mine ? 'ally' : 'enemy');
  }

  callAirstrike(owner, target, angle = rand(0, Math.PI * 2)) {
    const g = this.game;
    const mine = owner.team === g.player.team;
    g.hud.toast(mine ? 'AIRSTRIKE INBOUND' : 'ENEMY AIRSTRIKE INBOUND — TAKE COVER', mine ? 'ally' : 'enemy');
    audio.radio(mine ? 'ally' : 'enemy');
    const ang = angle;
    const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
    const start = target.clone().addScaledVector(dir, -260).setY(38);
    this.schedule(2.6, () => {
      const mesh = makeJet(); g.R.scene.add(mesh);
      mesh.position.copy(start); mesh.lookAt(start.clone().add(dir));
      mesh.rotateY(Math.PI);
      this.jets.push({ mesh, dir: dir.clone(), speed: 120, life: 4.5 });
      audio.jet();
      for (let i = 0; i < 6; i++) {
        const p = target.clone().addScaledVector(dir, (i - 2.5) * 4.2);
        p.x += rand(-1, 1); p.z += rand(-1, 1); p.y = 0;
        this.schedule(260 / 120 + 0.35 + i * 0.09, () => g.explode(p, owner, 8, 180, 'airstrike', 'AIRSTRIKE'));
      }
    });
  }

  placeSentry(owner, pos, yaw) {
    const g = this.game;
    const { g: mesh, head, muzzle } = makeSentry(owner.team === g.player.team ? 0x4fb3ff : 0xff4b3e);
    mesh.position.copy(pos); mesh.rotation.y = yaw;
    g.R.scene.add(mesh);
    this.sentries.push({ g: mesh, head, muzzle, owner, team: owner.team, until: g.time + 45, yaw, pitch: 0, target: null, nextFire: 0, scan: 0, pos: pos.clone() });
    g.hud.toast('SENTRY GUN DEPLOYED', 'ally');
    audio.reload('charge');
  }

  update(dt) {
    const g = this.game;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (g.time >= this.pending[i].t) { const p = this.pending.splice(i, 1)[0]; p.fn(); }
    }
    for (let i = this.uavPlanes.length - 1; i >= 0; i--) {
      const u = this.uavPlanes[i];
      u.a += dt * 0.12;
      u.mesh.position.set(Math.cos(u.a) * 70, 95, Math.sin(u.a) * 70);
      u.mesh.rotation.set(0, -u.a, 0.25);
      if (g.time > u.until) { g.R.scene.remove(u.mesh); this.uavPlanes.splice(i, 1); }
    }
    for (let i = this.jets.length - 1; i >= 0; i--) {
      const j = this.jets[i];
      j.mesh.position.addScaledVector(j.dir, j.speed * dt);
      j.life -= dt;
      if (j.life <= 0) { g.R.scene.remove(j.mesh); this.jets.splice(i, 1); }
    }
    const def = { ...WEAPONS.vx4, dmg: [20, 16], sound: { crack: 3200, decay: 0.06, body: 0.6, vol: 0.7, kick: 160, sample: 'turret' } };
    for (let i = this.sentries.length - 1; i >= 0; i--) {
      const s = this.sentries[i];
      if (g.time > s.until) { g.R.scene.remove(s.g); this.sentries.splice(i, 1); if (s.team === g.player.team) g.hud.toast('SENTRY GUN OFFLINE'); continue; }
      const eye = _e.copy(s.pos).setY(s.pos.y + 1.0);
      // acquire
      s.scan -= dt;
      if (s.scan <= 0) {
        s.scan = 0.25; s.target = null; let best = 42;
        for (const a of g.actors) {
          if (!a.alive || a.team === s.team) continue;
          const d = a.pos.distanceTo(s.pos);
          if (d < best && g.world.lineOfSight(eye, a.chest(_c))) { best = d; s.target = a; }
        }
      }
      let wantYaw = s.yaw + Math.sin(g.time * 0.8) * 0.8, wantPitch = 0;
      if (s.target && s.target.alive) {
        const c = s.target.chest(_c);
        wantYaw = Math.atan2(-(c.x - eye.x), -(c.z - eye.z));
        wantPitch = Math.atan2(c.y - eye.y, Math.hypot(c.x - eye.x, c.z - eye.z));
      }
      s.curYaw = dampAngle(s.curYaw ?? s.yaw, wantYaw, 5, dt);
      s.pitch = damp(s.pitch, wantPitch, 5, dt);
      s.head.rotation.set(s.pitch, s.curYaw - s.g.rotation.y, 0, 'YXZ');
      if (s.target && s.target.alive && g.time >= s.nextFire) {
        const fwd = _f.set(-Math.sin(s.curYaw) * Math.cos(s.pitch), Math.sin(s.pitch), -Math.cos(s.curYaw) * Math.cos(s.pitch));
        const want = _w.subVectors(s.target.chest(_c), eye).normalize();
        if (fwd.dot(want) > 0.985) {
          s.nextFire = g.time + 0.09;
          const dir = coneDirection(fwd, 1.6 * DEG, _d);
          const mz = s.muzzle.getWorldPosition(_m);
          g.fireBullet(s.owner, eye, dir, def, { muzzle: mz, tracer: true, weaponName: 'SENTRY GUN', sentry: true });
          g.fx.muzzle(mz, 0.4);
          audio.turret(mz);
        }
      }
    }
  }
}

const _e = new THREE.Vector3(), _c = new THREE.Vector3(), _f = new THREE.Vector3(), _w = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Vector3();
