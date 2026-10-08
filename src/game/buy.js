// Buy stations: in-match shops placed on every map. Players earn cash during a match (kills, assists, objectives,
// survival waves) and spend it on ammo, grenades, armour, weapons, saved classes and scorestreaks.
// Cash only exists inside a match; it starts at START_CASH and is gone when the match ends.
// The shop is a HUD overlay: the match keeps running while you browse, so buy in cover.
import { WEAPONS, PRIMARIES, SECONDARIES } from './weapons.js';
import { WeaponState } from './actor.js';
import { audio } from '../engine/audio.js';
import { profile } from '../core/save.js';

export const START_CASH = 800;
/** Cash rewards, shared by every mode. */
export const CASH = { kill: 250, headshot: 100, assist: 100, medal: 50, capture: 300, confirm: 150, deny: 75, hardpointSec: 20, wave: 400 };
const REACH = 2.3;
const WEAPON_PRICE = {
  'ASSAULT RIFLE': 1400, 'BURST RIFLE': 1500, 'SUBMACHINE GUN': 1000, 'SHOTGUN': 1100, 'LIGHT MACHINE GUN': 1800,
  'MARKSMAN RIFLE': 1600, 'SNIPER RIFLE': 2000, 'PISTOL': 300, 'MACHINE PISTOL': 600, 'LAUNCHER': 1800,
};
const STREAK_PRICE = { uav: 1000, airstrike: 2500, sentry: 3500 };
const fmt = (n) => '$' + n.toLocaleString('en-US');

export class BuySystem {
  constructor(game) {
    this.game = game;
    this.open = false;
    this.sel = 0;
    this.el = document.getElementById('buy-menu');
    this.items = [];
    this._idle = null;
  }

  get enabled() { return this.game.mode && this.game.mode.id !== 'gun'; }

  /** Nearest station the player is standing at and roughly facing, or null. */
  near(p) {
    if (!this.enabled || !this.game.map) return null;
    for (const s of this.game.map.buyStations || []) {
      const dx = s.pos.x - p.pos.x, dz = s.pos.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d > REACH || Math.abs(s.pos.y - p.pos.y) > 1.5) continue;
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      if (d > 0.8 && (dx * fx + dz * fz) / d < 0.2) continue;   // must be looking at it
      return s;
    }
    return null;
  }

  earn(amount, label = '') {
    const g = this.game;
    if (!this.enabled || amount <= 0) return;
    g.cash += amount;
    g.hud.cash(g.cash, amount, label);
  }

  /** Every shop entry: { cat, name, desc, price, ok() -> '' or the reason it can't be bought, buy() }. */
  catalog() {
    const g = this.game, p = g.player, lvl = profile.unlockLevel;
    const forced = !!g.modifier?.loadout;   // modifier matches (e.g. snipers only) keep their fixed weapons
    const list = [];
    list.push({
      cat: 'SUPPLIES', name: 'AMMO RESUPPLY', desc: 'Refill every magazine and reserve', price: 300,
      ok: () => (p.weapons.every((w) => w.mag >= w.def.mag && w.reserve >= w.def.reserve) ? 'FULL' : ''),
      buy: () => { for (const w of p.weapons) { w.mag = w.def.mag; w.reserve = w.def.reserve * (p.perks.has('reserves') ? 1.5 : 1) | 0; } audio.reload('in'); },
    });
    list.push({
      cat: 'SUPPLIES', name: 'FRAG GRENADE', desc: '+1 frag (carry up to 4)', price: 250,
      ok: () => (p.grenades >= 4 ? 'FULL' : ''), buy: () => { p.grenades++; audio.pin(); },
    });
    list.push({
      cat: 'SUPPLIES', name: 'ARMOR VEST', desc: 'Ceramic plates: absorb 60% of incoming damage until broken (100)', price: 600,
      ok: () => (p.armor >= 100 ? 'EQUIPPED' : ''), buy: () => { p.armor = Math.max(p.armor, 100); audio.reload('charge'); },
    });
    list.push({
      cat: 'SUPPLIES', name: 'ARMOR PLATE', desc: '+50 armour on top of your vest (max 150)', price: 250,
      ok: () => (p.armor <= 0 ? 'NEEDS VEST' : p.armor >= 150 ? 'FULL' : ''), buy: () => { p.armor = Math.min(150, p.armor + 50); audio.reload('in'); },
    });
    if (g.playerStreaks?.length) {
      g.playerStreaks.forEach((s) => list.push({
        cat: 'SCORESTREAKS', name: s.name, desc: s.desc, price: STREAK_PRICE[s.id] ?? 2000,
        ok: () => (s.charges >= 2 ? 'MAX 2' : ''), buy: () => { s.charges++; s.ready = true; audio.radio('ally'); },
      }));
    }
    if (!forced) {
      profile.allClasses.forEach((c) => list.push({
        cat: 'LOADOUTS', name: c.kept ? `${c.name} (KEPT)` : c.name, desc: `${WEAPONS[c.loadout.primary]?.name} · ${WEAPONS[c.loadout.secondary]?.name} · kept for the rest of the match`, price: 1500,
        ok: () => '', buy: () => {
          g.boughtLoadout = { ...c.loadout, perks: [...c.loadout.perks] };
          p.setLoadout(g.boughtLoadout);
          if (p.perks.has('reserves')) for (const w of p.weapons) w.reserve = Math.round(w.reserve * 1.5);
          p.grenades = Math.max(p.grenades, p.perks.has('grenadier') ? 3 : 2);
          p._raise(p.def);
          audio.reload('charge');
        },
      }));
      for (const def of [...PRIMARIES, ...SECONDARIES]) {
        if (def.unlock > lvl) continue;
        const slot = def.slot === 'primary' ? 0 : 1;
        list.push({
          cat: def.slot === 'primary' ? 'PRIMARY WEAPONS' : 'SECONDARY WEAPONS', name: def.name, desc: `${def.cls} · until you die`, price: WEAPON_PRICE[def.cls] ?? 1500,
          ok: () => (p.weapons.some((w) => w.def === def) ? 'OWNED' : ''),
          buy: () => {
            const ws = new WeaponState(def);
            if (slot < p.weapons.length) p.weapons[slot] = ws; else p.weapons.push(ws);
            p.cur = Math.min(slot, p.weapons.length - 1);
            p._raise(def);
            audio.reload('charge');
          },
        });
      }
    }
    return list;
  }

  openShop() {
    if (this.open || !this.enabled) return;
    this.open = true; this.sel = 0; this.flashT = 0; this.msg = '';
    this.items = this.catalog();
    this.game.player.cancelInput();
    audio.click(0.25, 1800, 0.05);
    this.render();
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.el.classList.add('hidden');
  }

  /** Input that does nothing, so the player stands still while shopping (the world keeps going). */
  idle(a) {
    if (!this._idle) {
      this._idle = {};
      for (const [k, v] of Object.entries(a)) this._idle[k] = Array.isArray(v) ? v.map(() => false) : typeof v === 'number' ? 0 : typeof v === 'boolean' ? false : v;
    }
    return this._idle;
  }

  update(a) {
    if (!this.open) return;
    const p = this.game.player;
    if (!p.alive || this.game.over) { this.close(); return; }
    const n = this.items.length;
    if (a.menuUp || a.wheel < 0) this.sel = (this.sel - 1 + n) % n;
    if (a.menuDown || a.wheel > 0) this.sel = (this.sel + 1) % n;
    if (a.menuLeft || a.tabL) this.jumpCat(-1);
    if (a.menuRight || a.tabR) this.jumpCat(1);
    if (a.menuBack || a.interactP) { this.close(); return; }
    if (a.menuOk || a.fireP || a.jumpP) this.purchase(this.items[this.sel]);
    if (a.menuUp || a.menuDown || a.wheel || a.menuLeft || a.menuRight || a.tabL || a.tabR) audio.click(0.12, 2600, 0.02);
    this.render();
  }

  jumpCat(dir) {
    const cats = [...new Set(this.items.map((i) => i.cat))];
    const ci = cats.indexOf(this.items[this.sel].cat), next = cats[(ci + dir + cats.length) % cats.length];
    this.sel = this.items.findIndex((i) => i.cat === next);
  }

  purchase(it) {
    const g = this.game;
    if (!it) return;
    const why = it.ok();
    if (why) { this.msg = why; audio.dry(); return; }
    if (g.cash < it.price) { this.msg = 'NOT ENOUGH CASH'; audio.dry(); return; }
    g.cash -= it.price;
    it.buy();
    g.stats.spent = (g.stats.spent || 0) + it.price;
    this.msg = `BOUGHT ${it.name}`;
    audio.hit('body');
    g.hud.cash(g.cash, -it.price, '');
  }

  render() {
    const g = this.game, kbm = g.input.lastDevice !== 'pad';
    let html = `<div class="buy-head"><div><b>BUY STATION</b><small>SUPPLY · ARMORY · SCORESTREAKS</small></div><div class="buy-cash">${fmt(g.cash)}</div></div><div class="buy-list">`;
    let cat = '';
    this.items.forEach((it, i) => {
      if (it.cat !== cat) { cat = it.cat; html += `<div class="buy-cat">${cat}</div>`; }
      const why = it.ok(), poor = g.cash < it.price;
      html += `<div class="buy-item ${i === this.sel ? 'sel' : ''} ${why || poor ? 'off' : ''}" data-i="${i}"><div><b>${it.name}</b><small>${it.desc}</small></div><span>${why || fmt(it.price)}</span></div>`;
    });
    html += `</div><div class="buy-foot">${this.msg ? `<b>${this.msg}</b>` : ''}<span>${kbm ? 'W/S · WHEEL SELECT &nbsp; A/D CATEGORY &nbsp; CLICK/ENTER BUY &nbsp; F/ESC CLOSE' : `D-PAD SELECT &nbsp; ${g.input.padLabel(4)}/${g.input.padLabel(5)} CATEGORY &nbsp; ${g.input.padLabel(0)} BUY &nbsp; ${g.input.padLabel(1)} CLOSE`}</span></div>`;
    if (this.el._h !== html) {
      this.el.innerHTML = html; this.el._h = html;
      this.el.classList.remove('hidden');
      this.el.querySelector('.buy-item.sel')?.scrollIntoView({ block: 'nearest' });
    }
  }
}
