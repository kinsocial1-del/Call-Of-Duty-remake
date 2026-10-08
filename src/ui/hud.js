// In-game HUD (DOM overlay + minimap canvas).
import * as THREE from 'three';
import { formatTime, clamp, wrapAngle } from '../core/utils.js';
import { profile } from '../core/save.js';
import { TEAM_NAMES, GUN_LADDER } from '../game/game.js';
import { WEAPONS } from '../game/weapons.js';
import { HOLD_TIME } from '../game/pickups.js';
import { HealthBars } from './health-bars.js';
import { combatDisplay, streakIcon, weaponIcon } from './combat-display.js';

const $ = (id) => document.getElementById(id);
const PX_PER_DEG = 3.2;

export class HUD {
  constructor(input) {
    this.input = input;
    this.el = $('hud');
    this.healthBars = new HealthBars($('actor-healthbars'), $('player-health'));
    this.mm = $('minimap').getContext('2d');
    this.strip = $('compass-strip');
    let html = '';
    const card = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let d = -180; d <= 540; d += 15) {
      const n = ((d % 360) + 360) % 360;
      const x = d * PX_PER_DEG;
      if (card[n] !== undefined) html += `<span class="card" style="left:${x}px">${card[n]}</span>`;
      else html += `<span class="tick" style="left:${x}px">${n}</span>`;
    }
    this.strip.innerHTML = html;
    this.compassObj = document.createElement('div'); this.strip.parentElement.appendChild(this.compassObj);
    this.markers = [];
    this.markerRoot = document.createElement('div'); this.el.appendChild(this.markerRoot);
    this.assignmentTracker = document.createElement('div');
    this.assignmentTracker.id = 'assignment-tracker'; this.el.appendChild(this.assignmentTracker);
    this.nadeWarn = document.createElement('div');
    this.nadeWarn.style.cssText = 'position:absolute;left:50%;top:50%;width:0;height:0;display:none';
    this.nadeWarn.innerHTML = '<div style="position:absolute;left:-22px;top:-140px;width:44px;height:44px;border-radius:50%;background:rgba(0,0,0,.55);border:2px solid #ff4b3e;color:#ff4b3e;font-weight:700;display:grid;place-items:center;font-size:22px">!</div>';
    this.el.appendChild(this.nadeWarn);
    this.hmT = 0; this.flashV = 0; this.suppressT = 0;
    this.fpsAcc = 0; this.fpsN = 0;
    this.ch = { t: document.querySelector('.ch-t'), b: document.querySelector('.ch-b'), l: document.querySelector('.ch-l'), r: document.querySelector('.ch-r') };
    this.aimCheckT = 0; this.elimT = 0; this.elimChain = 0; this.lastElim = -Infinity;
    $('player-health').appendChild($('tac-panel'));
  }

  setHtml(el, html) {
    if (el._cachedHtml !== html) { el.innerHTML = html; el._cachedHtml = html; }
  }

  setText(el, text) {
    const value = String(text);
    if (el.textContent !== value) el.textContent = value;
  }

  show(v) { this.el.classList.toggle('hidden', !v); }

  matchStart(game) {
    $('killfeed').innerHTML = ''; $('xp-pops').innerHTML = ''; $('medals').innerHTML = ''; $('toasts').innerHTML = ''; $('center-msg').innerHTML = '';
    this.hideDeath();
    this.assignmentT = 0;
    this.assignmentComplete = false;
    this.healthBars.reset();
    this.elimT = 0; this.elimChain = 0; this.lastElim = -Infinity;
    $('elimination').classList.remove('on');
    this.show(true);
    this.el.classList.toggle('hardcore', !!game.modifier?.hardcore);
    this.markerRoot.innerHTML = ''; this.markers = [];
    $('minimap-label').textContent = game.map.name;
    const m = game.mode;
    this.center(m.name, m.id === 'survival' ? 'SURVIVE AS LONG AS YOU CAN' : m.teams ? `${TEAM_NAMES.A} VS ${TEAM_NAMES.B}` : 'TRUST NO ONE', 3);
  }

  // ------------------------------------------------------------------ EVENTS
  killfeed(killer, victim, weapon, headshot, game) {
    const cls = (a) => (a.isPlayer ? 'me' : game.ffa ? 'enemy' : a.team === game.player.team ? 'ally' : 'enemy');
    const div = document.createElement('div');
    div.className = 'kf';
    div.innerHTML = (killer && killer !== victim ? `<span class="${cls(killer)}">${killer.name}</span>` : '') +
      `<span class="w">[${weapon || 'KILLED'}]</span>${headshot ? '<span class="hs">⌖</span>' : ''}<span class="${cls(victim)}">${victim.name}</span>`;
    const kf = $('killfeed');
    kf.prepend(div);
    while (kf.children.length > 6) kf.lastChild.remove();
    setTimeout(() => div.remove(), 6500);
  }

  elimination(name,headshot=false,now=performance.now()/1000) {
    this.elimChain=now-this.lastElim<4 ? this.elimChain+1 : 1;
    this.lastElim=now; this.elimT=2.2;
    this.setText($('elim-label'),headshot ? 'HEADSHOT ELIMINATION' : 'ELIMINATED');
    this.setText($('elim-name'),name);
    this.setText($('elim-chain'),this.elimChain>1 ? '×'+this.elimChain : '');
    $('elimination').classList.add('on');
  }

  hitmarker(kind) {
    const h = $('hitmarker');
    h.className = kind === 'kill' ? 'kill' : kind === 'head' ? 'head' : '';
    this.hmT = kind === 'kill' ? 0.35 : 0.16;
    // pop: start large and snap in, bigger for heads and kills
    h.style.transition = 'none';
    h.style.transform = `scale(${kind === 'kill' ? 1.75 : kind === 'head' ? 1.45 : 1.25})`;
    void h.offsetWidth;
    h.style.transition = 'transform .11s cubic-bezier(.2,.9,.3,1)';
    h.style.transform = 'scale(1)';
  }

  xp(label, amount) {
    const d = document.createElement('div');
    d.className = 'xp'; d.innerHTML = `<b>+${amount}</b>${label}`;
    $('xp-pops').appendChild(d);
    setTimeout(() => d.remove(), 1600);
    const box = $('xp-pops'); while (box.children.length > 4) box.firstChild.remove();
  }

  medal(name, sub = '') {
    const d = document.createElement('div');
    d.className = 'medal'; d.innerHTML = `${name}<small>${sub}</small>`;
    const box = $('medals'); box.innerHTML = ''; box.appendChild(d);
    setTimeout(() => d.remove(), 2200);
  }

  /** Cash counter; delta > 0 flashes a green +$, delta < 0 a red -$ (purchases). */
  cash(total, delta, label) {
    $('cash-value').textContent = '$' + Math.round(total).toLocaleString('en-US');
    if (!delta) return;
    const d = $('cash-delta');
    // small passive trickles (hardpoint seconds) only update the total
    if (delta > 0 && delta < 50 && !label) return;
    d.textContent = `${delta > 0 ? '+' : '-'}$${Math.abs(delta)}${label ? ' ' + label : ''}`;
    d.className = 'on' + (delta < 0 ? ' neg' : '');
    clearTimeout(this._cashT);
    this._cashT = setTimeout(() => { d.className = delta < 0 ? 'neg' : ''; }, 1200);
  }

  /** Small text pop under the XP feed (pickups, ammo). */
  pop(text) {
    const d = document.createElement('div');
    d.className = 'xp'; d.textContent = text;
    $('xp-pops').appendChild(d);
    setTimeout(() => d.remove(), 1600);
    const box = $('xp-pops'); while (box.children.length > 4) box.firstChild.remove();
  }

  /** Killcam overlay. info = { final, killer, weapon, mine } or null to hide. */
  killcam(info) {
    this.el.classList.toggle('kc', !!info);
    const el = $('killcam');
    if (!info) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="bar top"></div><div class="bar bot"></div>
      <div class="kc-title"><i class="rec"></i>${info.final ? 'FINAL KILLCAM' : 'KILLCAM'}</div>
      <div class="kc-info"><div class="kc-sub">${info.mine ? 'YOUR KILL' : 'KILLED BY'}</div><div class="kc-name ${info.mine ? 'me' : ''}">${info.killer}</div><div class="kc-weap">${info.weapon || ''}</div></div>
      <div class="kc-skip">${this.input.prompt('jump')} SKIP</div>`;
  }

  /** Challenge completed mid-match (XP is paid out on the after-action report). */
  challenge(text, xp, scope) {
    const d = document.createElement('div');
    d.className = 'challenge-pop';
    d.innerHTML = `<small>${scope === 'weekly' ? 'WEEKLY' : 'DAILY'} CHALLENGE COMPLETE</small><b>${text}</b><span>+${xp.toLocaleString('en-US')} XP</span>`;
    $('toasts').appendChild(d);
    setTimeout(() => d.remove(), 4200);
  }

  weaponLevel(name, level) {
    const d = document.createElement('div');
    d.className = 'toast gold'; d.textContent = `${name} · WEAPON LEVEL ${level}`;
    $('toasts').appendChild(d);
    setTimeout(() => d.remove(), 3600);
  }

  toast(text, cls = '') {
    const d = document.createElement('div');
    d.className = 'toast ' + cls; d.textContent = text;
    $('toasts').appendChild(d);
    setTimeout(() => d.remove(), 3600);
  }

  center(big, sub = '', dur = 2.5) {
    const c = $('center-msg');
    c.innerHTML = `<div class="big">${big}</div><div class="sub">${sub}</div>`;
    c.style.opacity = 1;
    clearTimeout(this._cT);
    this._cT = setTimeout(() => { c.innerHTML = ''; }, dur * 1000);
  }

  damageIndicator(fromPos) {
    this._pendingDmg = this._pendingDmg || [];
    this._pendingDmg.push(fromPos.clone());
  }

  flash(v) { this.flashV = Math.max(this.flashV, v); }
  suppress() { this.suppressT = 0.5; }

  showDeath(killer, weapon, dist, headshot, final) {
    const d = $('death-screen');
    d.classList.remove('hidden');
    d.innerHTML = killer
      ? `<div class="killedby">KILLED BY</div><div class="killer">${killer.name}</div><div class="weap">${weapon}${headshot ? ' · HEADSHOT' : ''}${dist ? ` · ${Math.round(dist)}m` : ''}</div>`
      : `<div class="killer">K.I.A.</div>`;
    if (!final) d.innerHTML += `<div class="respawn" id="respawn-txt"></div>`;
  }
  hideDeath() { $('death-screen').classList.add('hidden'); }

  // ------------------------------------------------------------------ PER FRAME
  update(game, dt, frameDt = dt) {
    const p = game.player, cam = game.R.camera;
    const s = profile.s;
    this.assignmentTracker.hidden = game.over || game.killcam.active || this.assignmentComplete;
    this.assignmentT = (this.assignmentT || 0) - dt;
    if (this.assignmentT <= 0 && game.session?.assignment) {
      this.assignmentT = 0.5;
      const view = game.session.assignment.preview(profile.data);
      this.assignmentComplete = view.complete;
      this.assignmentTracker.hidden ||= view.complete;
      this.setHtml(this.assignmentTracker, `<div class="eyebrow">FIELD ASSIGNMENT · ${view.stage}/5</div><b>${view.name}</b>${view.goals.map((goal) => `<div class="tracker-goal"><span>${goal.label}</span><strong>${Math.floor(goal.progress)}/${goal.target}</strong></div>`).join('')}<small>${view.ready ? '✓ FINISH MATCH TO CLAIM' : view.goals.some((goal) => goal.mode && goal.mode !== game.mode.id) ? 'OBJECTIVE PROGRESS REQUIRES ' + view.mode.toUpperCase() : `STAGE REWARD +${view.xp} XP`}</small>`);
    }
    // fps
    this.fpsAcc += frameDt; this.fpsN++;
    if (this.fpsAcc > 0.5) { $('fps').textContent = Math.round(this.fpsN / this.fpsAcc) + ' FPS'; this.fpsAcc = 0; this.fpsN = 0; }
    $('fps').style.display = s.showFps ? 'block' : 'none';

    // hitmarker
    this.hmT -= dt; $('hitmarker').style.opacity = this.hmT > 0 ? 1 : 0;
    // flash / vignette
    this.flashV = Math.max(0, this.flashV - dt * 1.5);
    $('flash-overlay').style.opacity = this.flashV;
    this.suppressT = Math.max(0, this.suppressT - dt);
    const hurt = p.alive ? clamp(1 - p.health / 100, 0, 1) : 0;
    $('vignette').style.opacity = Math.max(hurt * 1.1, this.suppressT * 0.5);

    // damage indicators
    if (this._pendingDmg && this._pendingDmg.length) {
      const box = $('dmg-indicators');
      for (const fp of this._pendingDmg) {
        const el = document.createElement('div'); el.className = 'dmg-ind';
        el._src = fp; el._t = 1.4; box.appendChild(el);
      }
      this._pendingDmg.length = 0;
    }
    for (const el of [...$('dmg-indicators').children]) {
      el._t -= dt;
      if (el._t <= 0) { el.remove(); continue; }
      const yawTo = Math.atan2(-(el._src.x - p.pos.x), -(el._src.z - p.pos.z));
      const rel = wrapAngle(yawTo - p.yaw);
      el.style.transform = `rotate(${(-rel * 180) / Math.PI}deg)`;
      el.style.opacity = Math.min(1, el._t);
    }

    this.healthBars.update(game);
    this.elimT = Math.max(0, this.elimT-dt);
    $('elimination').classList.toggle('on',this.elimT>0 && p.alive && !game.killcam.active && !game.over);

    // weapon panel
    if (p.weapons.length) {
      const w = p.w, def = w.def;
      const state=combatDisplay(p),panel=$('weapon-info');
      panel.dataset.action=state.action;panel.classList.toggle('low-ammo',w.mag<=Math.ceil(def.mag*0.25));
      this.setText($('wi-class'),def.cls);this.setText($('wi-action'),state.label);
      $('ammo-fill').style.transform=`scaleX(${state.ammo})`;
      $('action-track').hidden=state.progress<0;
      $('action-fill').style.transform=`scaleX(${Math.max(0,state.progress)})`;
      $('tac-fill').style.transform=`scaleX(${state.sprint})`;
      this.setText($('tac-status'),state.sprintLabel);
      this.setText($('operator-name'),p.name);
      this.setText($('health-status'),!p.alive ? 'DOWN' : p.health<=p.maxHealth*0.3 ? 'CRITICAL' : p.health>(this._previousHealth ?? p.health) && p.health<p.maxHealth ? 'RECOVERING' : p.health<p.maxHealth ? 'INJURED' : 'STABLE');
      this._previousHealth=p.health;
      const ar = $('armor-row'), armor = Math.ceil(p.armor || 0);
      ar.hidden = !(p.alive && armor > 0);
      if (!ar.hidden) { this.setText($('armor-value'), String(armor)); $('armor-fill').style.transform = `scaleX(${Math.min(1, armor / 150)})`; }
      this.setHtml($('weapon-slots'),p.weapons.map((slot,i)=>`<div class="weapon-slot ${i===p.cur ? 'selected' : ''}"><kbd>${this.input.lastDevice==='pad' ? '' : i+1}</kbd>${weaponIcon(slot.def)}<span>${slot.def.name}</span></div>`).join(''));
      this.setText($('wi-name'), def.name);
      const magEl = $('wi-mag');
      this.setText(magEl, w.mag);
      magEl.classList.toggle('low', w.mag <= Math.ceil(def.mag * 0.25));
      this.setText($('wi-res'), '/ ' + w.reserve);
      const mode = def.mode === 'auto' ? (p._modeOverride ? 'SEMI' : 'AUTO') : def.mode === 'burst' ? 'BURST' : def.mode === 'bolt' ? 'BOLT' : def.mode === 'pump' ? 'PUMP' : 'SEMI';
      this.setText($('wi-mode'), mode);
      this.setHtml($('wi-nades'), '◆'.repeat(p.grenades) + '<span style="opacity:.3">' + '◆'.repeat(Math.max(0, 2 - p.grenades)) + '</span>');
    }

    // crosshair
    const chEl = $('crosshair');
    const showCh = p.alive && s.crosshair && p.adsT < 0.5 && !p.sprinting && !game.over && !game.killcam.active;
    chEl.style.opacity = showCh ? 1 : 0;
    if (showCh) {
      const pxPerDeg = innerHeight / cam.fov;
      const gap = 6 + p.spreadDeg() * pxPerDeg * 0.9;
      this.ch.t.style.top = `${-gap - 10}px`; this.ch.b.style.top = `${gap}px`;
      this.ch.l.style.left = `${-gap - 10}px`; this.ch.r.style.left = `${gap}px`;
      this.aimCheckT -= dt;
      if (this.aimCheckT <= 0) {
        this.aimCheckT = 0.08;
        const o = cam.position, d = cam.getWorldDirection(_d);
        const hit = game.world.raycast(o, d, 120);
        const maxT = hit ? hit.t : 120;
        let enemy = false;
        for (const a of game.actors) if (a !== p && a.alive && p.isEnemy(a, game.ffa) && a.hitTest(o, d, maxT)) { enemy = true; break; }
        chEl.classList.toggle('enemy', enemy);
      }
    }
    $('scope-overlay').classList.toggle('on', game.killcam.active ? !!game.killcam.scoped : p.alive && !!p.def?.scope && p.adsT > 0.85);

    // compass
    const bearing = ((-p.yaw * 180) / Math.PI % 360 + 360) % 360;
    this.strip.style.transform = `translateX(${260 - bearing * PX_PER_DEG}px)`;

    // scorebar
    this.scorebar(game);
    // objective / markers
    this.objectives(game, bearing);
    // streaks
    this.streakPanel(game);
    // minimap
    this.minimap(game);
    // prompts
    let prompt = '';
    if (!p.alive && !game.over && game.mode.id !== 'survival') {
      const t = Math.max(0, p.respawnT);
      const el = $('respawn-txt');
      if (el) el.innerHTML = t < 2.5 ? `PRESS ${this.input.prompt('respawn')} TO REDEPLOY` : `REDEPLOYING IN ${t.toFixed(1)}`;
    } else if (p.alive && p.station && !game.over && !game.buy.open) {
      const k = Math.min(1, p.useHold / 0.3);
      prompt = `HOLD ${this.input.prompt('interact')} OPEN <span style="color:#7be29b">BUY STATION</span> · $${game.cash.toLocaleString('en-US')}<div style="width:180px;height:4px;margin:6px auto 0;background:rgba(255,255,255,.15)"><div style="height:100%;width:${k * 100}%;background:#7be29b"></div></div>`;
    } else if (p.alive && p.pickup && !game.over) {
      const k = Math.min(1, p.useHold / HOLD_TIME);
      prompt = `HOLD ${this.input.prompt('interact')} SWAP FOR <span style="color:var(--accent)">${p.pickup.def.name}</span><div style="width:180px;height:4px;margin:6px auto 0;background:rgba(255,255,255,.15)"><div style="height:100%;width:${k * 100}%;background:var(--accent)"></div></div>`;
    } else if (p.alive && p.weapons.length) {
      const w = p.w;
      if (w.mag === 0 && w.reserve === 0) prompt = '<span style="color:#ff4b3e">NO AMMO</span>';
      else if (w.mag <= Math.ceil(w.def.mag * 0.25) && p.reloadT < 0 && p.shellT < 0 && w.reserve > 0) prompt = `${this.input.prompt('reload')} RELOAD`;
    }
    this.setHtml($('prompt'), prompt);
    // grenade warning
    let warn = null;
    for (const pr of game.projectiles) if (pr.type === 'nade' && pr.owner !== p && (game.ffa || pr.owner.team !== p.team) && pr.pos.distanceTo(p.pos) < 8) warn = pr;
    this.nadeWarn.style.display = warn && p.alive ? 'block' : 'none';
    if (warn) {
      const yawTo = Math.atan2(-(warn.pos.x - p.pos.x), -(warn.pos.z - p.pos.z));
      this.nadeWarn.style.transform = `rotate(${(-wrapAngle(yawTo - p.yaw) * 180) / Math.PI}deg)`;
    }
    // scoreboard
    const sbVisible = !game.killcam.active && ((this.input.a.score && game.running) || (game.over && game.endMsgT != null && game.endT > game.endMsgT + 1.5));
    $('scoreboard').classList.toggle('hidden', !sbVisible);
    if (sbVisible) this.scoreboard(game);
  }

  scorebar(game) {
    const sb = $('scorebar'), m = game.mode, p = game.player;
    let html = '';
    if (m.id === 'survival') {
      const left = game.waveState === 'active' ? (game.toSpawn + game.bots.filter((b) => b.alive).length) : 0;
      html = `<div class="sb-team sb-ally">${game.wave || 0}<div class="sb-label">WAVE</div></div><div class="sb-time">${game.waveState === 'intermission' ? Math.ceil(game.waveT) + 's' : left}<div class="sb-label">${game.waveState === 'intermission' ? 'NEXT WAVE' : 'HOSTILES'}</div></div><div class="sb-team sb-enemy">${p.kills}<div class="sb-label">KILLS</div></div>`;
    } else if (m.id === 'gun') {
      const lead = [...game.actors].filter((a) => a !== p).sort((a, b) => b.gunLevel - a.gunLevel || b.kills - a.kills)[0];
      html = `<div class="sb-team sb-ally">${p.gunLevel + 1}<div class="sb-label">YOU</div></div><div class="sb-time">${formatTime(game.timeLeft)}<div class="sb-label">GUN · ${GUN_LADDER.length}</div></div><div class="sb-team sb-enemy">${lead ? lead.gunLevel + 1 : 0}<div class="sb-label">LEADER</div></div>`;
    } else if (m.teams) {
      const my = p.team, en = my === 'A' ? 'B' : 'A';
      let flags = '';
      if (game.hp) { const h = game.hp; flags = `<div class="sb-flags"><div class="flag ${h.owner === my ? 'a' : h.owner ? 'e' : ''} ${h.contested ? 'c' : ''}"><b>${Math.ceil(h.t)}</b></div></div>`; }
      if (game.flags) flags = '<div class="sb-flags">' + game.flags.map((f) => `<div class="flag ${f.owner === my ? 'a' : f.owner ? 'e' : ''} ${f.contested || (f.capTeam && f.progress > 0) ? 'c' : ''}"><b>${f.name}</b></div>`).join('') + '</div>';
      html = `<div class="sb-team sb-ally">${game.scores[my]}</div><div class="sb-time">${formatTime(game.timeLeft)}<div class="sb-label">${m.short} · ${m.limit}</div></div><div class="sb-team sb-enemy">${game.scores[en]}</div>${flags}`;
    } else {
      const sorted = [...game.actors].sort((a, b) => b.kills - a.kills);
      const lead = sorted[0] === p ? sorted[1] : sorted[0];
      html = `<div class="sb-team sb-ally">${p.kills}</div><div class="sb-time">${formatTime(game.timeLeft)}<div class="sb-label">FFA · ${m.limit}</div></div><div class="sb-team sb-enemy">${lead ? lead.kills : 0}</div>`;
    }
    if (sb._html !== html) { sb.innerHTML = html; sb._html = html; }
  }

  objectives(game, bearing) {
    const p = game.player, cam = game.R.camera;
    const items = [];
    let obj = '';
    if (game.mode.id === 'dom' && game.flags) {
      for (const f of game.flags) {
        const col = f.owner === p.team ? '#4fb3ff' : f.owner ? '#ff4b3e' : '#ffffff';
        items.push({ pos: f.pos, y: 3.6, label: f.name, color: col, sub: f.contested ? 'CONTESTED' : '' });
      }
      const inside = game.flags.find((f) => f.playerIn);
      if (inside) {
        const prog = inside.owner === p.team ? 1 : inside.capTeam === p.team ? inside.progress : 0;
        obj = `${inside.contested ? 'CONTESTED' : inside.owner === p.team ? 'DEFENDING' : 'CAPTURING'} ${inside.name}<div style="width:200px;height:5px;background:rgba(255,255,255,.15);margin-top:4px"><div style="height:100%;width:${prog * 100}%;background:#4fb3ff"></div></div>`;
      } else obj = 'CAPTURE AND HOLD THE FLAGS';
    } else if (game.mode.id === 'hp' && game.hp) {
      const h = game.hp;
      const col = h.contested ? '#f2b33d' : h.owner === p.team ? '#4fb3ff' : h.owner ? '#ff4b3e' : '#ffffff';
      items.push({ pos: game.hpPos, y: 3, label: 'HP', color: col, sub: h.contested ? 'CONTESTED' : `${Math.ceil(h.t)}s` });
      const state = h.playerIn ? (h.contested ? 'CONTESTED' : 'HOLDING THE HARDPOINT') : h.owner === p.team ? 'DEFEND THE HARDPOINT' : 'CAPTURE THE HARDPOINT';
      obj = `${state}<div style="font-size:12px;color:var(--muted)">MOVES IN ${Math.ceil(h.t)}s</div>`;
    } else if (game.mode.id === 'gun') {
      const next = GUN_LADDER[p.gunLevel + 1];
      obj = next ? `LEVEL ${p.gunLevel + 1}/${GUN_LADDER.length} · NEXT: ${WEAPONS[next].name}` : 'FINAL WEAPON · ONE KILL TO WIN';
    } else if (game.mode.id === 'kc') {
      for (const t of game.tags) if (t.pos.distanceTo(p.pos) < 45) items.push({ pos: t.pos, y: 0.6, label: '◆', color: t.team === p.team ? '#4fb3ff' : '#ff4b3e', small: true });
      obj = 'COLLECT ENEMY DOG TAGS';
    } else if (game.mode.id === 'tdm') obj = 'ELIMINATE THE ENEMY TEAM';
    else if (game.mode.id === 'ffa') obj = 'BE THE FIRST TO ' + game.mode.limit + ' KILLS';
    else if (game.mode.id === 'survival') obj = game.waveState === 'intermission' ? 'PREPARE FOR THE NEXT WAVE' : 'ELIMINATE ALL HOSTILES';
    // nearby buy stations
    if (game.buy.enabled) for (const s of game.map.buyStations || []) if (s.pos.distanceTo(p.pos) < 40) items.push({ pos: s.pos, y: 2.3, label: '$', color: '#7be29b', sub: 'BUY' });
    this.setHtml($('objective'), `${obj}<small>${game.mode.name}</small>`);

    while (this.markers.length < items.length) {
      const d = document.createElement('div');
      d.style.cssText = 'position:absolute;transform:translate(-50%,-50%);text-align:center;font-weight:700;text-shadow:0 1px 3px #000;pointer-events:none';
      this.markerRoot.appendChild(d); this.markers.push(d);
    }
    let comp = '';
    this.markers.forEach((d, i) => {
      const it = items[i];
      if (!it) { d.style.display = 'none'; return; }
      _v.copy(it.pos); _v.y += it.y;
      const dist = p.pos.distanceTo(it.pos);
      _v.project(cam);
      let x = (_v.x * 0.5 + 0.5) * innerWidth, y = (-_v.y * 0.5 + 0.5) * innerHeight;
      if (_v.z > 1) { x = innerWidth - x; y = innerHeight - 40; }
      x = clamp(x, 40, innerWidth - 40); y = clamp(y, 90, innerHeight - 40);
      d.style.display = 'block';
      d.style.left = x + 'px'; d.style.top = y + 'px';
      d.style.color = it.color;
      const markerHtml = it.small ? `<div style="font-size:18px">${it.label}</div>` : `<div style="width:30px;height:30px;border:2px solid ${it.color};transform:rotate(45deg);display:grid;place-items:center;background:rgba(0,0,0,.35)"><span style="transform:rotate(-45deg);font-size:16px">${it.label}</span></div><div style="font-size:12px;margin-top:6px;color:#fff">${Math.round(dist)}m</div><div style="font-size:11px">${it.sub || ''}</div>`;
      this.setHtml(d, markerHtml);
      if (!it.small) {
        const brg = (Math.atan2(it.pos.x - p.pos.x, -(it.pos.z - p.pos.z)) * 180) / Math.PI;
        let rel = ((brg - bearing + 540) % 360) - 180;
        if (Math.abs(rel) < 80) comp += `<span class="obj" style="left:${260 + rel * PX_PER_DEG}px;color:${it.color};border-color:${it.color}">${it.label}</span>`;
      }
    });
    if (this.compassObj._h !== comp) {
      this.compassObj.innerHTML = comp; this.compassObj._h = comp;
      this.compassObj.style.cssText = 'position:absolute;inset:0';
      for (const s of this.compassObj.children) { s.style.position = 'absolute'; s.style.top = '18px'; s.style.transform = 'translateX(-50%)'; s.style.fontSize = '12px'; s.style.fontWeight = '700'; s.style.border = '1px solid'; s.style.padding = '0 4px'; s.style.background = 'rgba(0,0,0,.4)'; }
    }
  }

  streakPanel(game) {
    const p = game.player;
    const keys = this.input.lastDevice === 'pad' ? ['◀', '▲', '▶'] : ['3', '4', '5'];
    const html = game.playerStreaks.map((s, i) => {
      const remaining = Math.max(0, s.nextAt - p.streak);
      return `<div class="streak ${s.ready ? 'ready' : ''} ${s.id === 'uav' && game.streaks.uavActive(p.team) ? 'active' : ''}"><div class="meta"><b>${s.name}</b>${s.ready ? `READY ×${s.charges} [${keys[i]}]` : `${remaining} KILLS TO READY`}<small class="next-reward">${s.ready ? `NEXT IN ${remaining} KILLS` : `REPEAT EVERY ${s.cycleKills} KILLS`}</small></div><div class="ico" title="${s.name}">${streakIcon(s.id)}</div></div>`;
    }).join('') + `<div class="streak-progress">STREAK ${p.streak}</div>`;
    const el = $('streaks');
    if (el._h !== html) { el.innerHTML = html; el._h = html; }
  }

  minimap(game) {
    const g = this.mm, p = game.player, map = game.map;
    const W = 440, C = W / 2, scale = 4.6;
    g.clearRect(0, 0, W, W);
    g.save();
    g.translate(C, C);
    g.rotate(p.yaw);
    g.translate(-p.pos.x * scale, -p.pos.z * scale);
    const mm = map.minimap;
    g.globalAlpha = 0.9;
    g.drawImage(mm.canvas, map.bounds.minX * scale, map.bounds.minZ * scale, mm.canvas.width * scale / mm.ppm, mm.canvas.height * scale / mm.ppm);
    g.globalAlpha = 1;
    // flags
    if (game.flags) for (const f of game.flags) {
      g.save(); g.translate(f.pos.x * scale, f.pos.z * scale); g.rotate(-p.yaw);
      g.fillStyle = f.owner === p.team ? '#4fb3ff' : f.owner ? '#ff4b3e' : '#fff';
      g.font = 'bold 26px Rajdhani'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.strokeStyle = '#000'; g.lineWidth = 4; g.strokeText(f.name, 0, 0); g.fillText(f.name, 0, 0);
      g.restore();
    }
    if (game.hp) {
      const c = game.hpPos, h = game.hp;
      g.strokeStyle = h.contested ? '#f2b33d' : h.owner === p.team ? '#4fb3ff' : h.owner ? '#ff4b3e' : '#ffffff';
      g.lineWidth = 4; g.beginPath(); g.arc(c.x * scale, c.z * scale, 6 * scale, 0, Math.PI * 2); g.stroke();
    }
    // buy stations
    if (game.buy.enabled) for (const s of map.buyStations || []) {
      g.save(); g.translate(s.pos.x * scale, s.pos.z * scale); g.rotate(-p.yaw);
      g.fillStyle = '#7be29b'; g.font = 'bold 24px Rajdhani'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.strokeStyle = '#000'; g.lineWidth = 4; g.strokeText('$', 0, 0); g.fillText('$', 0, 0);
      g.restore();
    }
    // sentries / airstrike jets
    for (const s of game.streaks.sentries) { g.fillStyle = s.team === p.team ? '#4fb3ff' : '#ff4b3e'; g.fillRect(s.pos.x * scale - 6, s.pos.z * scale - 6, 12, 12); }
    const uav = game.streaks.uavActive(p.team);
    const pulse = (game.time * 0.8) % 1;
    for (const a of game.actors) {
      if (a === p || !a.alive) continue;
      const enemy = p.isEnemy(a, game.ffa);
      const firing = game.time - a.lastShotTime < 1.2;
      if (enemy && !uav && !firing) continue;
      const x = a.pos.x * scale, z = a.pos.z * scale;
      if (enemy) {
        g.fillStyle = `rgba(255,75,62,${uav ? 0.6 + (1 - pulse) * 0.4 : 1})`;
        g.beginPath(); g.arc(x, z, 8, 0, Math.PI * 2); g.fill();
      } else {
        g.save(); g.translate(x, z); g.rotate(-a.yaw);
        g.fillStyle = '#4fb3ff';
        g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 8); g.lineTo(-8, 8); g.closePath(); g.fill();
        g.restore();
      }
    }
    g.restore();
    // uav sweep
    if (uav) {
      g.strokeStyle = `rgba(255,75,62,${0.5 * (1 - pulse)})`; g.lineWidth = 3;
      g.beginPath(); g.arc(C, C, pulse * C, 0, Math.PI * 2); g.stroke();
    }
    // player arrow + view cone
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.beginPath(); g.moveTo(C, C); g.arc(C, C, C, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6); g.closePath(); g.fill();
    g.fillStyle = '#f2b33d';
    g.beginPath(); g.moveTo(C, C - 14); g.lineTo(C + 10, C + 10); g.lineTo(C, C + 5); g.lineTo(C - 10, C + 10); g.closePath(); g.fill();
  }

  scoreboard(game) {
    const p = game.player;
    const mid = game.mode.id;
    const extra = (a) => (mid === 'dom' ? a.captures : mid === 'hp' ? formatTime(a.captures) : mid === 'kc' ? a.confirms : mid === 'gun' ? a.gunLevel + 1 : a.streak);
    const row = (a) => `<tr class="${a.isPlayer ? 'me' : ''} ${a.alive ? '' : 'dead'}"><td class="tname ${a.isPlayer ? '' : game.ffa || a.team !== p.team ? 'enemy' : 'ally'}">${a.name}</td><td>${a.score}</td><td>${a.kills}</td><td>${a.deaths}</td><td>${a.assists}</td><td>${extra(a)}</td></tr>`;
    const head = `<tr><th>OPERATOR</th><th>SCORE</th><th>K</th><th>D</th><th>A</th><th>${mid === 'dom' ? 'CAPS' : mid === 'hp' ? 'TIME' : mid === 'kc' ? 'CONF' : mid === 'gun' ? 'GUN' : 'STREAK'}</th></tr>`;
    let html = `<h2>${game.mode.name}</h2><div class="sub">${game.map.name} · ${game.mode.time ? formatTime(game.timeLeft) + ' REMAINING' : 'WAVE ' + (game.wave || 0)}</div>`;
    if (game.mode.teams && game.mode.id !== 'survival') {
      for (const t of [p.team, p.team === 'A' ? 'B' : 'A']) {
        const list = game.actors.filter((a) => a.team === t).sort((a, b) => b.score - a.score);
        html += `<div style="display:flex;justify-content:space-between;font-weight:700;letter-spacing:3px;color:${t === p.team ? '#4fb3ff' : '#ff4b3e'}"><span>${TEAM_NAMES[t]}</span><span>${game.scores[t]}</span></div><table class="sb-table">${head}${list.map(row).join('')}</table>`;
      }
    } else {
      const list = [...game.actors].filter((a) => a.isPlayer || game.mode.id !== 'survival').sort((a, b) => (mid === 'gun' ? b.gunLevel - a.gunLevel : 0) || b.kills - a.kills || b.score - a.score);
      html += `<table class="sb-table">${head}${list.map(row).join('')}</table>`;
    }
    const sb = $('scoreboard');
    if (sb._h !== html) { sb.innerHTML = html; sb._h = html; }
  }
}

const _v = new THREE.Vector3(), _d = new THREE.Vector3();
