// Dropped weapons: fallen enemies leave their gun behind. Walk over a matching gun to scavenge ammo,
// or hold interact to swap it for the weapon in your hands.
import * as THREE from 'three';
import { buildWeaponModel } from './weapons.js';
import { rand, disposeModel } from '../core/utils.js';
import { audio } from '../engine/audio.js';

const MAX = 10, LIFE = 35, REACH = 1.7;
export const HOLD_TIME = 0.32;

export class Pickups {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  clear() {
    for (const p of this.list) this._free(p);
    this.list = [];
  }

  drop(def, pos, mag, reserve) {
    if (!def) return;
    const g = this.game;
    while (this.list.length >= MAX) this.remove(this.list[0]);
    const { group } = buildWeaponModel(def, { shadows: true });
    const mesh = new THREE.Group();
    group.rotation.set(0, 0, Math.PI / 2); // lying on its side
    mesh.add(group);
    // glint so it reads at a distance
    const glint = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.36, 24), new THREE.MeshBasicMaterial({ color: 0xf2b33d, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
    glint.rotation.x = -Math.PI / 2; glint.position.y = -0.04;
    mesh.add(glint);
    const ground = g.world.groundBelow(pos.x, pos.y + 0.3, pos.z, 0.05, 3);
    const y = Number.isFinite(ground) ? ground : pos.y;
    mesh.position.set(pos.x + rand(-0.3, 0.3), y + 0.06, pos.z + rand(-0.3, 0.3));
    mesh.rotation.y = rand(0, Math.PI * 2);
    g.R.scene.add(mesh);
    this.list.push({ def, mesh, glint, pos: mesh.position, mag, reserve, t: 0 });
  }

  _free(p) {
    this.game.R.scene.remove(p.mesh);
    disposeModel(p.mesh);
    p.glint.material.dispose();
  }

  remove(p) {
    this._free(p);
    const i = this.list.indexOf(p);
    if (i >= 0) this.list.splice(i, 1);
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.t += dt;
      p.glint.material.opacity = 0.2 + Math.sin(p.t * 4) * 0.15;
      if (p.t > LIFE) this.remove(p);
    }
  }

  /**
   * Player proximity: auto-collects ammo from matching guns, returns the nearest swappable pickup (or null).
   */
  near(player) {
    let best = null, bd = REACH;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      const d = Math.hypot(p.pos.x - player.pos.x, p.pos.z - player.pos.z);
      if (d > REACH || Math.abs(p.pos.y - player.pos.y) > 1.3) continue;
      const own = player.weapons.find((w) => w.def.id === p.def.id);
      if (own) {
        if (own.reserve < own.def.reserve) {
          own.reserve = Math.min(own.def.reserve, own.reserve + p.mag + p.reserve);
          audio.reload('in');
          this.game.hud.pop(`+AMMO · ${p.def.name}`);
          this.remove(p);
        }
        continue;
      }
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /** Swap the player's current weapon for pickup `p`; the old gun is dropped in its place. */
  take(player, p) {
    const g = this.game;
    const old = player.w;
    this.remove(p);
    player.replaceWeapon(p.def, p.mag, p.reserve);
    this.drop(old.def, player.pos, old.mag, old.reserve);
    audio.reload('charge');
    g.hud.pop(`PICKED UP · ${p.def.name}`);
  }
}
