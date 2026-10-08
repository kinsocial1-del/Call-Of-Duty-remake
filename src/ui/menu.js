// Menu system: keyboard/mouse + full gamepad navigation (console style).
import { profile, ACHIEVEMENTS, MAX_LEVEL } from '../core/save.js';
import { platform } from '../core/platform.js';
import { ASSIGNMENTS, assignmentState, assignmentView, nextOperation } from '../core/assignments.js';
import { assignmentCard } from './assignment-display.js';
import { PRIMARIES, SECONDARIES, PERKS, WEAPONS } from '../game/weapons.js';
import { MODES } from '../game/game.js';
import { MAPS } from '../game/map.js';
import { DIFFICULTY } from '../game/bot.js';
import { audio } from '../engine/audio.js';
import { GRAPHICS_PRESETS } from '../engine/renderer.js';
import { formatCountdown, fmtNum } from '../core/utils.js';
import { cardDef, camoDef, roman, PRESTIGE_MAX } from '../core/catalog.js';
import { refresh, dailyOp, MODIFIERS, boosts, activateToken, dropState, claimDrop, reroll, seasonInfo, tierOf, TIERS, canPrestige, enterPrestige, nextDailyReset, DAILY_SWEEP_XP, FIRST_WIN_XP, dayIndex, TIER_XP } from '../core/live.js';
import { camoChoices, equipCamo, equippedCamo, weaponInfo, nextMastery, goldCount, freshCount, clearFresh, WEAPON_MAX } from '../core/cosmetics.js';
import { identityCard, rankBadge, challengePanel, challengeRows, seasonSummary, seasonTrack, dropCalendar, bar, until } from './live-ui.js';

const root = () => document.getElementById('menu-root');

export class Menu {
  constructor(app) {
    this.app = app;
    this.stack = [];
    this.focus = 0;
    this.rows = [];
    this.matchCfg = { mode: 'tdm', map: 'dockyard', difficulty: profile.s.difficulty, modifier: '' };
  }

  get open() { return this.stack.length > 0; }

  push(screen) { this.stack.push(screen); this.focus = 0; this.openedAt = performance.now(); this.render(); }
  pop() {
    if (this.stack.length <= 1) { const top = this.stack[0]; if (top && top.onBack) top.onBack(); return; }
    this.stack.pop(); this.focus = 0; audio.ui('back'); this.render();
  }
  replace(screen) { this.stack = [screen]; this.focus = 0; this.openedAt = performance.now(); this.render(); }
  close() { this.stack = []; root().innerHTML = ''; }

  // ------------------------------------------------------------------ RENDER
  render() {
    const active = root().contains(document.activeElement) ? document.activeElement : null;
    const activeRow = active?.closest('[data-row]')?.dataset.row;
    const activeDir = active?.dataset.dir;
    const sc = this.stack[this.stack.length - 1];
    if (!sc) { root().innerHTML = ''; return; }
    const restoreFocus = this.renderedScreen === sc;
    this.renderedScreen = sc;
    const def = sc.build();
    this.rows = def.rows;
    if (this.focus >= this.rows.length) this.focus = 0;
    const rowsHtml = def.rows.map((r, i) => this.rowHtml(r, i)).join('');
    const html = `<div class="screen ${def.dim ? 'dim' : ''} ${def.cls || ''}">
      <div class="side" style="${def.wide ? 'width:min(720px,100%)' : ''}">
        ${def.logo ? `<div class="logo">IRONFRONT</div><div class="logo-sub">ZERO HOUR</div>` : `<div class="title">${def.title}</div><div class="title-sub">${def.sub || ''}</div>`}
        <div class="btn-list">${rowsHtml}</div>
        ${def.after || ''}
      </div>
      ${def.panel ? `<div class="content" style="padding-left:0">${def.panel}</div>` : ''}
      ${def.card !== false ? this.playerCard() : ''}
      <div class="footer-hint">${this.hints(def)}</div>
    </div>`;
    root().innerHTML = html;
    this.hintDevice = `${this.app.input.lastDevice}:${this.app.input.padType}`;
    root().querySelectorAll('[data-row]').forEach((el) => {
      const i = +el.dataset.row;
      el.addEventListener('focusin', () => { this.focus = i; this.highlight(); });
      el.addEventListener('mouseenter', () => { if (this.focus !== i) { this.focus = i; this.highlight(false); audio.ui('move'); } });
      el.addEventListener('click', (e) => {
        const r = this.rows[i];
        if (e.target.closest('[data-dir]')) { this.adjust(r, +e.target.closest('[data-dir]').dataset.dir); return; }
        if (r.type === 'slider' || r.type === 'select') return;
        this.activate(r);
      });
      const range = el.querySelector('input[type=range]');
      if (range) range.addEventListener('input', () => { const r = this.rows[i]; r.set(parseFloat(range.value)); el.querySelector('.val').textContent = this.fmt(r); });
    });
    this.highlight();
    if (restoreFocus && activeRow !== undefined) {
      const row = root().querySelector(`[data-row="${activeRow}"]`);
      const control = activeDir !== undefined ? row?.querySelector(`[data-dir="${activeDir}"]`) : row?.querySelector('input') || row;
      control?.focus?.({ preventScroll: true });
    }
    this.tickCountdowns(true);
    sc.afterRender?.();
  }

  /** Update every live countdown on screen; when one runs out (midnight, new week/season) roll over and redraw. */
  tickCountdowns(force = false) {
    const now = Date.now();
    if (!force && now - (this._cdT || 0) < 1000) return;
    this._cdT = now;
    let expired = false;
    for (const el of root().querySelectorAll('[data-until]')) {
      const left = +el.dataset.until - now;
      if (left <= 0) expired = true;
      el.textContent = formatCountdown(left);
    }
    if (expired && !force && !this.app.game.running) { refresh(); this.render(); }
  }

  fmt(r) { return r.format ? r.format(r.get()) : r.get(); }

  rowHtml(r, i) {
    if (r.type === 'slider') {
      return `<div class="setting" data-row="${i}"><span>${r.label}</span><span style="display:flex;align-items:center;gap:12px"><input type="range" aria-label="${r.label}" min="${r.min}" max="${r.max}" step="${r.step}" value="${r.get()}"><span class="val">${this.fmt(r)}</span></span></div>`;
    }
    if (r.type === 'toggle') {
      return `<button type="button" class="setting" data-row="${i}" aria-pressed="${!!r.get()}" style="cursor:pointer;pointer-events:auto"><span>${r.label}</span><span class="val">${r.get() ? 'ON' : 'OFF'}</span></button>`;
    }
    if (r.type === 'cycle') {
      const o = r.options[r.index()];
      return `<div class="setting" data-row="${i}" style="pointer-events:auto"><span>${r.label}</span><span style="display:flex;align-items:center;gap:10px"><button type="button" class="cycle-arrow" data-dir="-1" aria-label="Previous ${r.label}">◀</button><span class="val" style="min-width:170px;text-align:center;${o.locked ? 'color:#8a5a50' : ''}">${o.label}</span><button type="button" class="cycle-arrow" data-dir="1" aria-label="Next ${r.label}">▶</button></span></div>`;
    }
    return `<button class="btn ${r.cls || ''} ${r.locked ? 'locked' : ''}" data-row="${i}">${r.label}${r.badge ? `<span class="badge">${r.badge}</span>` : ''}${r.sub ? `<small>${r.sub}</small>` : ''}</button>`;
  }

  highlight(scroll = true) {
    root().querySelectorAll('[data-row]').forEach((el) => el.classList.toggle('focus', +el.dataset.row === this.focus));
    if (scroll) root().querySelector(`[data-row="${this.focus}"]`)?.scrollIntoView?.({block:'nearest'});
    const r = this.rows[this.focus];
    const sc = this.stack[this.stack.length - 1];
    if (sc && sc.onFocus) sc.onFocus(r);
  }

  hints() {
    const pad = this.app.input.lastDevice === 'pad';
    const ps = this.app.input.padType === 'ps';
    return pad ? `<span>${ps ? '✕' : 'A'} SELECT</span><span>${ps ? '○' : 'B'} BACK</span><span>◀ ▶ ADJUST</span>` : `<span>ENTER / CLICK SELECT</span><span>ESC BACK</span><span>◀ ▶ ADJUST</span>`;
  }

  playerCard() { return identityCard(); }

  activate(r) {
    if (!r) return;
    if (r.type === 'toggle') { r.set(!r.get()); audio.ui('ok'); this.render(); return; }
    if (r.type === 'cycle') { this.adjust(r, 1); return; }
    if (r.type === 'slider') return;
    if (r.locked) { audio.ui('back'); return; }
    audio.ui('ok');
    r.action && r.action();
  }

  adjust(r, dir) {
    if (!r) return;
    if (r.type === 'slider') {
      const v = Math.min(r.max, Math.max(r.min, +(r.get() + dir * r.step).toFixed(3)));
      r.set(v); audio.ui('move'); this.render();
    } else if (r.type === 'cycle') {
      const n = r.options.length;
      r.setIndex((r.index() + dir + n) % n); audio.ui('move'); this.render();
    } else if (r.type === 'toggle') { r.set(!r.get()); audio.ui('move'); this.render(); }
  }

  /** Called every frame while a menu is open. */
  update(a) {
    if (!this.open) return;
    const device = `${this.app.input.lastDevice}:${this.app.input.padType}`;
    if (this.hintDevice !== device) {
      this.hintDevice = device;
      const footer = root().querySelector('.footer-hint');
      if (footer) footer.innerHTML = this.hints();
    }
    this.tickCountdowns();
    if (!this.rows.length) return;
    // Native controls process activation themselves; preserve Escape and menu navigation.
    const nativeFocus = this.app.input.lastDevice === 'kbm' && root().contains(document.activeElement);
    if (nativeFocus && document.activeElement.matches('button')) a.menuOk = false;
    if (nativeFocus && document.activeElement.matches('input[type=range]')) a.menuLeft = a.menuRight = false;
    if (document.activeElement?.id === 'class-name') {
      if (a.menuOk || a.pauseP) document.activeElement.blur();
      return;
    }
    if (a.menuUp) { this.focus = (this.focus - 1 + this.rows.length) % this.rows.length; this.highlight(); audio.ui('move'); }
    if (a.menuDown) { this.focus = (this.focus + 1) % this.rows.length; this.highlight(); audio.ui('move'); }
    if (nativeFocus && (a.menuUp || a.menuDown)) {
      const row = root().querySelector(`[data-row="${this.focus}"]`);
      (row?.querySelector('input, button') || row)?.focus();
    }
    const r = this.rows[this.focus];
    if (a.menuLeft) this.adjust(r, -1);
    if (a.menuRight) this.adjust(r, 1);
    const settled = performance.now() - (this.openedAt || 0) > 250;
    if (a.menuOk && settled) this.activate(r);
    if (a.menuBack && settled) this.pop();
  }

  // ------------------------------------------------------------------ SCREENS
  mainScreen() {
    const app = this.app;
    return {
      build: () => {
        refresh();
        const L = profile.data.live, op = dailyOp(), drop = dropState(), s = seasonInfo(), tier = tierOf(L.season.xp);
        const doneD = L.daily.filter((c) => c.done).length, doneW = L.weekly.filter((c) => c.done).length, fresh = freshCount();
        const opName = `${MODES[op.mode].name} · ${MAPS[op.map].name}`;
        return {
          logo: true, cls: 'main-screen',
          rows: [
            { label: 'PLAY', sub: 'Multiplayer vs AI · Survival', action: () => this.push(this.playScreen()) },
            { label: 'QUICK DEPLOY', sub: 'A fresh mode and map · Ready to play', action: () => {
              const last = profile.data.matchRecords?.history?.[0];
              app.startMatch(nextOperation({ ...last, difficulty: profile.s.difficulty }));
            } },
            { label: 'FIELD ASSIGNMENTS', sub: '6 career tracks · XP · Exclusive titles', action: () => this.push(this.assignmentsScreen()) },
            { label: 'DAILY OPERATION', cls: 'op-btn', badge: '+50% XP', sub: `${opName} · ${MODIFIERS[op.modifier].name}`, action: () => this.startDailyOp() },
            ...(!drop.claimed ? [{ label: 'SUPPLY DROP', cls: 'hot', badge: 'READY', sub: `Day ${drop.streak} reward waiting`, action: () => this.push(this.supplyDropScreen()) }] : []),
            ...(L.tokens > 0 && L.tokenSeconds <= 0 ? [{ label: 'ACTIVATE DOUBLE XP', badge: `×${L.tokens}`, sub: '30 minutes of 2× XP in matches', action: () => { activateToken(); audio.ui('ok'); this.render(); } }] : []),
            { label: 'CHALLENGES', badge: doneD < L.daily.length ? `${doneD}/${L.daily.length}` : '✓', sub: `Daily ${doneD}/${L.daily.length} · Weekly ${doneW}/${L.weekly.length}`, action: () => this.push(this.challengesScreen()) },
            { label: 'SEASON PASS', sub: `Season ${String(s.n).padStart(2, '0')} · Tier ${tier}/${TIERS}`, action: () => this.push(this.seasonScreen()) },
            { label: 'LOADOUT', sub: 'Weapons · Camos · Perks', action: () => this.push(this.loadoutScreen()) },
            { label: 'BARRACKS', badge: fresh ? `${fresh} NEW` : '', sub: 'Calling cards · Titles · Rebirth · Career', action: () => this.push(this.barracksScreen()) },
            { label: 'SETTINGS', sub: 'Controls · Audio · Graphics', action: () => this.push(this.settingsScreen()) },
            ...(platform.canQuit ? [{ label: 'QUIT', sub: 'Exit to desktop', action: () => platform.quit() }] : []),
          ],
          panel: this.hubHtml(op),
        };
      },
    };
  }

  /** Right-hand hub on the main menu: active boosts, today's operation, daily challenges, season progress. */
  hubHtml(op) {
    const L = profile.data.live, b = boosts({ op: true, opDay: op.day }), mod = MODIFIERS[op.modifier];
    const events = [];
    if (b.list.includes('DOUBLE XP WEEKEND')) events.push('<div class="event hot">DOUBLE XP WEEKEND · LIVE NOW</div>');
    if (L.tokenSeconds > 0) events.push(`<div class="event">DOUBLE XP TOKEN · ${Math.ceil(L.tokenSeconds / 60)} MIN LEFT</div>`);
    if (L.firstWin !== dayIndex()) events.push(`<div class="event">FIRST WIN OF THE DAY · +${fmtNum(FIRST_WIN_XP)} XP</div>`);
    return `<div class="hub">${events.join('')}
      ${assignmentCard(assignmentView(profile.data))}
      <div class="hub-card op-card"><div class="eyebrow">DAILY OPERATION · NEW IN ${until(nextDailyReset())}</div>
        <h2>${MODES[op.mode].name}</h2><div class="op-sub">${MAPS[op.map].name} · <b>${mod.name}</b></div><p>${mod.desc}</p>
        <div class="brief-tags"><span class="hot">+50% XP</span><span>${MODES[op.mode].short}</span><span>${DIFFICULTY[this.matchCfg.difficulty].label}</span></div></div>
      <div class="hub-card"><div class="hub-h"><span class="eyebrow">TODAY'S CHALLENGES</span><span class="h3-right">${until(nextDailyReset())}</span></div>
        ${challengeRows(L.daily)}${L.dailySweep ? '' : `<div class="hub-note">Finish all three for a +${fmtNum(DAILY_SWEEP_XP)} XP bonus</div>`}</div>
      <div class="hub-card">${seasonSummary()}</div>${this.recentMatchesHtml()}</div>`;
  }

  recentMatchesHtml() {
    const history = (profile.data.matchRecords?.history || []).filter((match) => MODES[match.mode] && MAPS[match.map]);
    return history.length ? `<div class="hub-card"><div class="eyebrow">RECENT OPERATIONS</div><div class="recent-matches">${history.map((match) => `<div><span class="result-chip ${match.outcome === 'win' ? 'win' : match.outcome === 'lose' ? 'lose' : ''}">${match.outcome === 'win' ? 'W' : match.outcome === 'lose' ? 'L' : '—'}</span><span><b>${MODES[match.mode].short} · ${MAPS[match.map].name}</b><small>${Number(match.kills) || 0} eliminations · ${Number(match.deaths) || 0} deaths</small></span></div>`).join('')}</div></div>` : '';
  }

  startDailyOp() {
    const op = dailyOp();
    this.app.startMatch({ mode: op.mode, map: op.map, modifier: op.modifier, difficulty: this.matchCfg.difficulty, op: true, opDay: op.day });
  }

  assignmentsScreen() {
    let selected = assignmentState(profile.data).active;
    return {
      build: () => {
        const state = assignmentState(profile.data), view = assignmentView(profile.data, selected);
        return {
          title: 'FIELD ASSIGNMENTS', sub: 'PERMANENT GOALS · PROGRESS AT YOUR PACE', cls: 'assignments-screen', card: false,
          rows: [
            ...Object.entries(ASSIGNMENTS).map(([id, def]) => {
              const track = assignmentView(profile.data, id);
              return { label: def.name, cls: id === state.active ? 'selected' : '', badge: track.complete ? 'MASTERED' : `${track.stage}/5`, sub: `${MODES[def.mode].short} recommended · ${def.title} title`, assignment: id, action: () => {
                if (!track.complete) { state.active = id; profile.save(); }
                selected = id; this.render();
              } };
            }),
            { label: 'DEPLOY FOR THIS ASSIGNMENT', cls: 'deploy-start', sub: MODES[view.mode].name, action: () => {
              const chosen = assignmentView(profile.data, selected);
              if (!chosen.complete) { state.active = selected; profile.save(); }
              this.matchCfg.mode = chosen.mode; this.matchCfg.modifier = ''; this.push(this.playScreen());
            } },
            { label: 'BACK', cls: 'back', action: () => this.pop() },
          ],
          panel: `<div class="assignment-detail">${assignmentCard(view, selected === state.active ? 'ACTIVE ASSIGNMENT' : 'ASSIGNMENT PREVIEW')}<div class="panel"><h3>YOUR NEXT MISSION</h3><p>Choose a track to activate it. You can switch freely; each track keeps its progress. Rewards are claimed when you finish a match.</p></div></div>`,
        };
      },
      onFocus: (row) => {
        if (row?.assignment && row.assignment !== selected) {
          selected = row.assignment;
          const panel = root().querySelector('.assignment-detail');
          const deploySub = root().querySelector('[data-row="6"] small');
          if (deploySub) deploySub.textContent = MODES[ASSIGNMENTS[selected].mode].name;
          if (panel) panel.innerHTML = `${assignmentCard(assignmentView(profile.data, selected), 'ASSIGNMENT PREVIEW')}<div class="panel"><h3>YOUR NEXT MISSION</h3><p>Select to activate. Every track keeps its progress when you switch.</p></div>`;
        }
      },
    };
  }

  playScreen() {
    const cfg = this.matchCfg;
    const modes = Object.values(MODES), maps = Object.values(MAPS), diffs = Object.keys(DIFFICULTY);
    const mods = ['', ...Object.keys(MODIFIERS)];
    let desc = '';
    return {
      build: () => {
        this.app.previewMap(cfg.map);
        const m = MODES[cfg.mode], mp = MAPS[cfg.map], mod = MODIFIERS[cfg.modifier];
        desc = `<b style="color:#fff;letter-spacing:2px">${m.name}</b><br>${m.desc}<br><br><b style="color:#fff;letter-spacing:2px">${mp.name}</b><br>${mp.desc}${mod ? `<br><br><b style="color:var(--accent);letter-spacing:2px">${mod.name}</b><br>${mod.desc}` : ''}`;
        return {
          title: 'DEPLOY', sub: 'CONFIGURE YOUR MATCH', cls: 'deploy-screen', card: false,
          panel: `<div class="map-brief"><div class="eyebrow">SELECTED OPERATION · WOODLAND</div><h2>${mp.name}</h2><p>${mp.desc}</p><div class="brief-tags"><span>${m.short}</span><span>${m.teams ? 'SQUAD COMBAT' : 'SOLO COMBAT'}</span><span>${DIFFICULTY[cfg.difficulty].label}</span>${mod ? `<span class="hot">${mod.name}</span>` : ''}</div><div class="deploy-class">${profile.activeIsKept ? 'KEPT LOADOUT' : `CLASS ${profile.data.activeClass + 1}`} · ${profile.allClasses[profile.data.activeClass].name}<b>${WEAPONS[profile.data.loadout.primary].name}</b></div></div>`,
          rows: [
            { type: 'cycle', label: 'MODE', options: modes.map((x) => ({ label: x.name })), index: () => modes.findIndex((x) => x.id === cfg.mode), setIndex: (i) => { cfg.mode = modes[i].id; } },
            { type: 'cycle', label: 'MAP', options: maps.map((x) => ({ label: x.name })), index: () => maps.findIndex((x) => x.id === cfg.map), setIndex: (i) => { cfg.map = maps[i].id; } },
            { type: 'cycle', label: 'MUTATOR', options: mods.map((k) => ({ label: k ? MODIFIERS[k].name : 'NONE' })), index: () => Math.max(0, mods.indexOf(cfg.modifier || '')), setIndex: (i) => { cfg.modifier = mods[i]; } },
            { type: 'cycle', label: 'AI DIFFICULTY', options: diffs.map((d) => ({ label: DIFFICULTY[d].label })), index: () => diffs.indexOf(cfg.difficulty), setIndex: (i) => { cfg.difficulty = diffs[i]; profile.s.difficulty = diffs[i]; profile.save(); } },
            { label: 'CHANGE CLASS', sub: 'Weapons and perks', action: () => this.push(this.loadoutScreen()) },
            { label: 'START MATCH', cls: 'deploy-start', sub: 'Deploy now', action: () => this.app.startMatch({ ...cfg, op: false }) },
            { label: 'BACK', cls: 'back', action: () => this.pop() },
          ],
          after: `<div class="mode-desc">${desc}</div>`,
        };
      },
    };
  }

  loadoutScreen() {
    const lvl = profile.unlockLevel;
    let lo = profile.data.loadout;
    const browse = {p:0,s:0,perks:[0,0,0],camo:{p:null,s:null}};
    let focusW, focusPerk = null, focusCamo = null;
    const sync = () => {
      lo = profile.data.loadout;
      browse.p = Math.max(0,PRIMARIES.findIndex(w=>w.id===lo.primary));
      browse.s = Math.max(0,SECONDARIES.findIndex(w=>w.id===lo.secondary));
      browse.perks = [1,2,3].map((slot,i)=>Math.max(0,PERKS[slot].findIndex(p=>p.id===lo.perks[i])));
      browse.camo = {p:null,s:null};
      focusW = WEAPONS[lo.primary]; focusPerk = null; focusCamo = null;
    };
    sync();
    const editable = () => !profile.activeIsKept;   // kept rebirth loadouts can be equipped but not changed
    const keptHas = item => !editable() && (lo.primary===item.id || lo.secondary===item.id || lo.perks.includes(item.id));
    const opt = item => { const locked = item.unlock>lvl && !keptHas(item); return {label:locked ? `LOCKED · ${item.name}` : item.name,locked}; };
    const classLabel = (c,i) => c.kept ? `KEPT ${roman(i-profile.data.classes.length+1)} · ${c.name}` : `${String(i+1).padStart(2,'0')} · ${c.name}`;
    const slotWeapon = slot => slot==='p' ? PRIMARIES[browse.p] : SECONDARIES[browse.s];
    const camoRow = (slot,label) => {
      const choices = () => camoChoices(slotWeapon(slot).id);
      const current = () => browse.camo[slot] ?? (equippedCamo(slotWeapon(slot).id) || 'none');
      return {type:'cycle',wslot:slot,camoRow:true,label,
        options:choices().map(c=>({label:c.lock ? `LOCKED · ${c.name}` : c.name,locked:!!c.lock})),
        index:()=>Math.max(0,choices().findIndex(c=>c.id===current())),
        setIndex:i=>{const c=choices()[i]; browse.camo[slot]=c.id; focusW=slotWeapon(slot); focusCamo=c.id; if(!c.lock && focusW.unlock<=lvl) equipCamo(focusW.id,c.id);}};
    };
    const icon = slot => `<svg class="perk-icon" viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8">${slot===1 ? '<path d="M5 23L13 15L9 10L16 5L22 10L19 16L27 21M5 8H11M2 14H8M1 20H6"/><path d="M13 15L17 20L10 28"/>' : slot===2 ? '<path d="M7 8H25V27H7ZM11 8V4H21V8M7 15H25M16 12V24M12 18H20"/>' : '<path d="M16 3L27 8V17L23 24L16 29L9 24L5 17V8Z"/><path d="M10 16L14 20L23 11"/>'}</svg>`;
    const perkCards = () => [1,2,3].map((slot,i)=>{
      const p=PERKS[slot].find(p=>p.id===lo.perks[i]);
      return `<div class="perk-card ${focusPerk?.id===p.id ? 'active' : ''}">${icon(slot)}<div><small>${['MOBILITY','EQUIPMENT','COMBAT'][i]}</small><b>${p.name}</b><p>${p.desc}</p></div></div>`;
    }).join('');
    const mastery = w => {
      const info = weaponInfo(w.id), next = nextMastery(w.id), max = info.level >= WEAPON_MAX;
      return `<div class="mastery"><div class="mastery-top"><span>WEAPON LEVEL <b>${info.level}</b>${max ? ' · MAX' : ''}</span><span>${fmtNum(info.kills)} KILLS</span></div>${bar(max ? 1 : info.into, max ? 1 : info.need)}<div class="mastery-next">${next ? `NEXT CAMO · ${next.name} AT LEVEL ${next.level}` : `GOLD ON ${goldCount()} WEAPONS · DIAMOND AT 5`}</div></div>`;
    };
    const panel = () => {
      const w=focusW;
      const camo = focusCamo ?? (equippedCamo(w.id) || 'none'), lock = camoChoices(w.id).find(c=>c.id===camo)?.lock;
      const bars=[['DAMAGE',Math.min(1,w.dmg[0]*(w.pellets||1)/120)],['FIRE RATE',w.rpm/1100],['RANGE',w.range[1]/100],['MOBILITY',(w.move-0.8)/0.3],['HANDLING',1-w.adsTime/0.45]];
      let image='';
      try { image=this.app.armory.image(w, camo==='none' ? null : camo); } catch(e) { console.warn('Armory preview unavailable',e); }
      return `<div class="armory-card"><div class="eyebrow">${w.cls} · ${w.id===lo.primary || w.id===lo.secondary ? 'EQUIPPED' : 'PREVIEW'}</div><h2>${w.name}</h2>${image ? `<img class="weapon-preview" src="${image}" alt="${w.name} model">` : ''}<div class="weapon-specs"><span>${w.mag} ROUNDS</span><span>${w.rpm} RPM</span><span>${w.mode.toUpperCase()}</span><span class="${lock ? 'locked-tag' : 'hot'}">${camoDef(camo)?.name || 'FACTORY'} CAMO${lock ? ` · ${lock}` : ''}</span></div>${mastery(w)}<div class="wstats">${bars.map(([n,v])=>`<div class="wstat"><span>${n}</span><div class="bar"><div style="width:${Math.max(4,Math.min(100,v*100))}%"></div></div></div>`).join('')}</div>${w.unlock>lvl ? `<div class="unlock-note">UNLOCKS AT LEVEL ${w.unlock}</div>` : ''}</div><div class="perk-grid">${perkCards()}</div>${focusPerk ? `<div class="perk-detail"><b>${focusPerk.name}</b><p>${focusPerk.desc}</p><small>${focusPerk.unlock>lvl ? 'UNLOCKS AT LEVEL '+focusPerk.unlock : lo.perks.includes(focusPerk.id) ? 'EQUIPPED' : 'AVAILABLE'}</small></div>` : ''}`;
    };
    const refreshPanel = () => { const el=root().querySelector('.content'); if(el) el.innerHTML=panel(); };
    const perkRow = (slot,i) => ({
      type:'cycle',pslot:i,label:['MOBILITY PERK','EQUIPMENT PERK','COMBAT PERK'][i],
      options:PERKS[slot].map(opt),index:()=>browse.perks[i],
      setIndex:index=>{browse.perks[i]=index; focusPerk=PERKS[slot][index]; if(focusPerk.unlock<=lvl && editable()) {lo.perks[i]=focusPerk.id; profile.save();}},
    });
    return {
      onFocus:r=>{
        if(!r) return;
        if(r.wslot) {focusW=slotWeapon(r.wslot); focusCamo=r.camoRow ? browse.camo[r.wslot] : null; focusPerk=null; refreshPanel();}
        else if(r.pslot!==undefined) {focusPerk=PERKS[r.pslot+1][browse.perks[r.pslot]];refreshPanel();}
      },
      afterRender:()=>{
        const input=root().querySelector('#class-name');
        input?.addEventListener('change',()=>{
          const name=input.value.toUpperCase().replace(/[^A-Z0-9 _-]/g,'').trim().slice(0,18);
          if(!editable()) return;
          if(name) {profile.data.classes[profile.data.activeClass].name=name; profile.save();}
          input.value=profile.data.classes[profile.data.activeClass].name;
          const label=`${String(profile.data.activeClass+1).padStart(2,'0')} · ${input.value}`;
          this.rows[0].options[profile.data.activeClass].label=label;
          const val=root().querySelector('[data-row="0"] .val'); if(val) val.textContent=label;
        });
      },
      build:()=>({
        title:'CREATE A CLASS',sub:editable() ? `CLASS ${profile.data.activeClass+1} · SAVED AUTOMATICALLY` : 'KEPT REBIRTH LOADOUT · USABLE AT ANY LEVEL · READ-ONLY',cls:'class-screen',card:false,
        rows:[
          {type:'cycle',label:'CLASS',options:profile.allClasses.map((c,i)=>({label:classLabel(c,i)})),index:()=>profile.data.activeClass,setIndex:i=>{profile.selectClass(i);sync();}},
          {type:'cycle',wslot:'p',label:'PRIMARY',options:PRIMARIES.map(opt),index:()=>browse.p,setIndex:i=>{browse.p=i;browse.camo.p=null;focusW=PRIMARIES[i];focusCamo=null;if(focusW.unlock<=lvl && editable()){lo.primary=focusW.id;profile.save();}}},
          camoRow('p','PRIMARY CAMO'),
          {type:'cycle',wslot:'s',label:'SECONDARY',options:SECONDARIES.map(opt),index:()=>browse.s,setIndex:i=>{browse.s=i;browse.camo.s=null;focusW=SECONDARIES[i];focusCamo=null;if(focusW.unlock<=lvl && editable()){lo.secondary=focusW.id;profile.save();}}},
          camoRow('s','SECONDARY CAMO'),
          perkRow(1,0),perkRow(2,1),perkRow(3,2),
          {label:'BACK',cls:'back',action:()=>this.pop()},
        ],
        after:`<div class="class-summary"><label for="class-name">CLASS NAME</label><input id="class-name" maxlength="18" value="${profile.allClasses[profile.data.activeClass].name}" aria-label="Class name" ${editable() ? '' : 'disabled'}><div><small>ACTIVE LOADOUT</small><b>${WEAPONS[lo.primary].name}</b><span>${WEAPONS[lo.secondary].name}</span></div><p>${this.app.game.running ? 'Changes apply on your next spawn. Gun Game uses its weapon ladder.' : 'Ready for your next deployment.'}</p></div>`,
        panel:panel(),
      }),
    };
  }

  // ------------------------------------------------------------------ LIVE SCREENS
  supplyDropScreen() {
    let result = null;
    return {
      build: () => {
        const st = dropState();
        const reveal = result ? `<div class="drop-reveal"><small>DAY ${result.streak} SUPPLY DROP</small><b>${result.reward}</b>${result.unlocks.map((u) => `<span>${u}</span>`).join('')}${result.levels.length ? `<span>LEVEL UP · ${result.levels[result.levels.length - 1]}</span>` : ''}</div>` : '';
        const note = st.claimed
          ? `<p class="drop-note">Come back in ${until(nextDailyReset())} for day ${st.streak + 1}. Miss a day and the streak starts over.</p>`
          : st.broken ? `<p class="drop-note warn">Your ${st.lost}-day streak ended. A new one starts today.</p>` : `<p class="drop-note">Log in every day to climb the 7-day ladder. Day 7 is an exclusive camo.</p>`;
        return {
          title: 'SUPPLY DROP', sub: `${st.streak}-DAY STREAK · ${profile.data.live.login.total + (st.claimed ? 0 : 1)} DROPS OPENED`, dim: true, card: false, cls: 'drop-screen',
          rows: [
            ...(!st.claimed ? [{ label: 'OPEN SUPPLY DROP', cls: 'deploy-start', sub: 'Claim today\'s reward', action: () => { result = claimDrop(); audio.ui('ok'); audio.radio?.('level'); this.render(); } }] : []),
            { label: st.claimed ? 'CONTINUE' : 'LATER', cls: st.claimed ? '' : 'back', action: () => this.pop() },
          ],
          panel: `<div class="drop-wrap">${dropCalendar(st)}${reveal}${note}</div>`,
        };
      },
    };
  }

  challengesScreen() {
    return {
      build: () => {
        refresh();
        const L = profile.data.live;
        return {
          title: 'CHALLENGES', sub: `${L.rerolls} FREE SWAP${L.rerolls === 1 ? '' : 'S'} LEFT TODAY`, wide: false,
          rows: [
            ...L.daily.map((c, i) => ({
              label: `DAILY ${i + 1}`, locked: c.done || L.rerolls <= 0,
              sub: c.done ? 'Complete' : L.rerolls > 0 ? 'Select to swap for a new challenge' : 'No swaps left today',
              action: () => { if (reroll(i)) this.render(); },
            })),
            { label: 'BACK', cls: 'back', action: () => this.pop() },
          ],
          after: `<div class="mode-desc">Challenges progress in every mode unless they name one. Rewards pay out at the end of the match.<br><br>Finish all 3 dailies: <b style="color:var(--accent)">+${fmtNum(DAILY_SWEEP_XP)} XP</b><br>Finish all 5 weeklies: <b style="color:var(--accent)">Weekly Veteran calling card</b></div>`,
          panel: `<div class="live-col">${challengePanel()}</div>`,
        };
      },
    };
  }

  seasonScreen() {
    return {
      build: () => {
        const s = seasonInfo(), L = profile.data.live;
        return {
          title: 'SEASON PASS', sub: `SEASON ${String(s.n).padStart(2, '0')} · ${s.name}`, cls: 'season-screen',
          rows: [
            ...(L.tokens > 0 && L.tokenSeconds <= 0 ? [{ label: 'ACTIVATE DOUBLE XP', badge: `×${L.tokens}`, sub: '30 minutes of 2× XP', action: () => { activateToken(); this.render(); } }] : []),
            { label: 'BACK', cls: 'back', action: () => this.pop() },
          ],
          after: '<div class="mode-desc">Every XP you earn counts toward the season: matches, challenges and supply drops. A new season with new camos, calling cards and titles starts on the 1st of every month. Rewards you earn are yours forever.</div>',
          panel: `<div class="live-col wide"><div class="panel">${seasonSummary()}</div>${seasonTrack()}</div>`,
        };
      },
    };
  }

  barracksScreen() {
    const C = profile.data.cosmetics;
    const freshIds = new Set(C.fresh);
    clearFresh();
    const isNew = (kind, id) => freshIds.has(`${kind}:${id}`) ? ' ★' : '';
    return {
      build: () => {
        const d = profile.data, golds = goldCount();
        const mastery = Object.values(WEAPONS).map((w) => {
          const info = weaponInfo(w.id), max = info.level >= WEAPON_MAX;
          return `<div class="mrow"><span>${w.name}</span><span class="mlv">${max ? '<b class="gold">GOLD</b>' : `LV ${info.level}`}</span>${bar(max ? 1 : info.into, max ? 1 : info.need)}<span class="mk">${fmtNum(info.kills)}</span></div>`;
        }).join('');
        return {
          title: 'BARRACKS', sub: 'IDENTITY · REBIRTH · SERVICE RECORD',
          rows: [
            { type: 'cycle', label: 'CALLING CARD', options: C.cards.map((id) => ({ label: cardDef(id, ACHIEVEMENTS).name + isNew('card', id) })), index: () => Math.max(0, C.cards.indexOf(C.card)), setIndex: (i) => { C.card = C.cards[i]; profile.save(); } },
            { type: 'cycle', label: 'TITLE', options: C.titles.map((t) => ({ label: t + isNew('title', t) })), index: () => Math.max(0, C.titles.indexOf(C.title)), setIndex: (i) => { C.title = C.titles[i]; profile.save(); } },
            ...(canPrestige() ? [{ label: `REBIRTH ${roman(d.prestige + 1)}`, cls: 'hot', sub: 'Back to level 1 · keep ONE loadout · earn a rebirth card and title',
              action: () => this.push(this.keepLoadoutScreen()) }] : []),
            { label: 'SERVICE RECORD', sub: 'Stats · Achievements · Callsign', action: () => this.push(this.careerScreen()) },
            { label: 'BACK', cls: 'back', action: () => this.pop() },
          ],
          after: `<div class="mode-desc">${d.level >= MAX_LEVEL ? (d.prestige < PRESTIGE_MAX ? `You are level ${MAX_LEVEL}. Rebirth to start again at level 1: weapons and perks lock again, but you keep one loadout of your choice for good.` : `Rebirth ${roman(PRESTIGE_MAX)}, level ${MAX_LEVEL}: the highest rank there is.`) : `Rebirth unlocks at level ${MAX_LEVEL}. Each rebirth relocks weapons and perks; you keep one loadout per rebirth (${d.kept.length} kept). Rebirth ${d.prestige} of ${PRESTIGE_MAX}.`}</div>`,
          panel: `<div class="live-col"><div class="panel"><h3><span>COLLECTION</span></h3>
              <div class="collect"><div><b>${C.cards.length}</b><small>CALLING CARDS</small></div><div><b>${C.titles.length}</b><small>TITLES</small></div><div><b>${C.camos.length}</b><small>SPECIAL CAMOS</small></div><div><b>${golds}/${Object.keys(WEAPONS).length}</b><small>GOLD WEAPONS</small></div></div></div>
            <div class="panel"><h3><span>WEAPON MASTERY</span><span class="h3-right">GOLD ON 5 → DIAMOND · GOLD ON ALL → DARK MATTER</span></h3>${mastery}</div></div>`,
        };
      },
    };
  }

  careerScreen() {
    return {
      build: () => {
        const s = profile.data.stats;
        const kd = s.deaths ? (s.kills / s.deaths).toFixed(2) : s.kills.toFixed(2);
        const acc = s.shots ? ((s.hits / s.shots) * 100).toFixed(1) + '%' : '—';
        const ach = Object.entries(ACHIEVEMENTS).map(([id, a]) => `<div class="stat-row" style="opacity:${profile.data.achievements[id] ? 1 : 0.4}"><span>${profile.data.achievements[id] ? '★ ' : '☆ '}${a.name}</span><span style="color:var(--muted);font-weight:500;font-size:14px">${a.desc}</span></div>`).join('');
        return {
          title: 'SERVICE RECORD', sub: 'STATS · ACHIEVEMENTS',
          rows: [
            { label: 'RESET PROGRESS', cls: 'sm', sub: 'Erase level, stats and unlocks', action: () => this.push(this.confirmScreen('RESET PROGRESS?', 'Erases your level, rebirths, stats and unlocks. This cannot be undone.', 'ERASE EVERYTHING', () => { profile.reset(); refresh(); this.pop(); })) },
            { label: 'BACK', cls: 'back', action: () => this.pop() },
          ],
          panel: `<div class="grid2" style="margin-top:calc(5vh + 140px);max-width:1000px"><div class="panel"><h3>COMBAT RECORD</h3>
            ${[['MATCHES', s.matches], ['WINS', s.wins], ['LOSSES', s.losses], ['KILLS', s.kills], ['DEATHS', s.deaths], ['K/D RATIO', kd], ['HEADSHOTS', s.headshots], ['ACCURACY', acc], ['BEST STREAK', s.bestStreak], ['SURVIVAL BEST', s.survivalBest + ' WAVES'], ['LOGIN STREAK', profile.data.live.login.streak + ' DAYS']].map(([k, v]) => `<div class="stat-row"><span>${k}</span><span>${v}</span></div>`).join('')}
            </div><div class="panel"><h3>ACHIEVEMENTS · EACH UNLOCKS A CALLING CARD</h3>${ach}</div></div>`,
          after: `<div class="panel" style="margin-top:3vh"><h3>CALLSIGN</h3><input id="callsign" maxlength="14" value="${profile.data.name}" style="pointer-events:auto;width:100%;background:#0c0f12;border:1px solid #444;color:#fff;font:700 22px Rajdhani;letter-spacing:2px;padding:6px 10px"></div>`,
        };
      },
      onFocus: () => {
        const inp = document.getElementById('callsign');
        if (inp && !inp._b) { inp._b = true; inp.addEventListener('change', () => { profile.data.name = inp.value.trim().toUpperCase().slice(0, 14) || 'OPERATOR'; profile.save(); }); inp.addEventListener('keydown', (e) => e.stopPropagation()); }
      },
    };
  }

  /** Rebirth step 1: pick the custom class to keep forever, then confirm. */
  keepLoadoutScreen() {
    const d = profile.data, next = roman(d.prestige + 1);
    return {
      build: () => ({
        title: `REBIRTH ${next}`, sub: 'CHOOSE ONE LOADOUT TO KEEP',
        rows: [
          ...d.classes.map((c, i) => ({
            label: c.name, sub: `${WEAPONS[c.loadout.primary].name} · ${WEAPONS[c.loadout.secondary].name}`,
            action: () => this.push(this.confirmScreen(`KEEP ${c.name}?`,
              `You go back to level 1 as Rebirth ${next}. Every weapon and perk locks again except <b>${c.name}</b> (${WEAPONS[c.loadout.primary].name}, ${WEAPONS[c.loadout.secondary].name}), which you keep at any level from now on${d.kept.length ? `, alongside your ${d.kept.length} earlier kept loadout${d.kept.length > 1 ? 's' : ''}` : ''}. Camos and cosmetics stay.`,
              'CONFIRM REBIRTH', () => { enterPrestige(i); audio.radio?.('level'); this.pop(); this.pop(); })),
          })),
          { label: 'CANCEL', cls: 'back', action: () => this.pop() },
        ],
        after: `<div class="mode-desc">${d.kept.length ? `Already kept: ${d.kept.map((k) => k.name).join(', ')}.` : 'This is your first rebirth.'}</div>`,
      }),
    };
  }

  /** Yes/no screen that works with mouse, keyboard and controller (replaces the browser's confirm()). */
  confirmScreen(title, text, yes, onYes) {
    return {
      build: () => ({
        title, sub: '', rows: [
          { label: yes, cls: 'hot', action: onYes },
          { label: 'CANCEL', cls: 'back', action: () => this.pop() },
        ],
        after: `<div class="mode-desc">${text}</div>`,
      }),
    };
  }

  settingsScreen() {
    const s = profile.s, app = this.app;
    const save = () => { profile.save(); app.applySettings(); };
    const presets = ['performance', 'low', 'medium', 'high', 'ultra', 'custom'];
    const shadowOpts = ['off', 'low', 'high', 'ultra'];
    const custom = () => { s.quality = 'custom'; };   // touching any single option leaves the preset
    return {
      build: () => ({
        title: 'SETTINGS', sub: 'CONTROLS · AUDIO · GRAPHICS · COMFORT', wide: true, cls: 'settings-screen',
        rows: [
          { type: 'slider', label: 'MOUSE SENSITIVITY', min: 0.1, max: 4, step: 0.05, get: () => s.sens, set: (v) => { s.sens = v; save(); }, format: (v) => v.toFixed(2) },
          { type: 'slider', label: 'ADS SENSITIVITY', min: 0.3, max: 1.5, step: 0.05, get: () => s.adsSens, set: (v) => { s.adsSens = v; save(); }, format: (v) => v.toFixed(2) },
          { type: 'slider', label: 'CONTROLLER SENSITIVITY', min: 0.3, max: 3, step: 0.05, get: () => s.padSens, set: (v) => { s.padSens = v; save(); }, format: (v) => v.toFixed(2) },
          { type: 'slider', label: 'CONTROLLER DEADZONE', min: 0.05, max: 0.3, step: 0.01, get: () => s.padDeadzone, set: (v) => { s.padDeadzone = v; save(); }, format: (v) => `${Math.round(v * 100)}%` },
          { type: 'cycle', label: 'CONTROLLER PROMPTS', options: [{label:'AUTO'},{label:'XBOX'},{label:'PLAYSTATION'}], index: () => ['auto','xbox','ps'].indexOf(s.controllerPrompts), setIndex: (i) => { s.controllerPrompts = ['auto','xbox','ps'][i]; save(); } },
          { type: 'slider', label: 'HUD SAFE AREA', min: 0, max: 5, step: 0.5, get: () => s.hudSafeArea, set: (v) => { s.hudSafeArea = v; save(); }, format: (v) => `${v}%` },
          { type: 'toggle', label: 'INVERT LOOK', get: () => s.invertY, set: (v) => { s.invertY = v; save(); } },
          { type: 'toggle', label: 'AIM ASSIST (CONTROLLER)', get: () => s.aimAssist, set: (v) => { s.aimAssist = v; save(); } },
          { type: 'toggle', label: 'VIBRATION', get: () => s.rumble, set: (v) => { s.rumble = v; save(); } },
          { type: 'slider', label: 'FIELD OF VIEW', min: 65, max: 110, step: 1, get: () => s.fov, set: (v) => { s.fov = v; save(); } },
          { type: 'cycle', label: 'GRAPHICS PRESET', options: presets.map((q) => ({ label: q.toUpperCase() })), index: () => Math.max(0, presets.indexOf(s.quality)),
            setIndex: (i) => { if (presets[i] === 'custom') return; s.quality = presets[i]; Object.assign(s, GRAPHICS_PRESETS[presets[i]]); save(); } },
          { type: 'slider', label: 'RENDER SCALE', min: 0.5, max: 1, step: 0.05, get: () => s.renderScale, set: (v) => { s.renderScale = v; custom(); save(); }, format: (v) => `${Math.round(v * 100)}%` },
          { type: 'cycle', label: 'SHADOWS', options: shadowOpts.map((q) => ({ label: q.toUpperCase() })), index: () => Math.max(0, shadowOpts.indexOf(s.shadows)), setIndex: (i) => { s.shadows = shadowOpts[i]; custom(); save(); } },
          { type: 'toggle', label: 'AMBIENT OCCLUSION', get: () => s.ao, set: (v) => { s.ao = v; custom(); save(); } },
          { type: 'cycle', label: 'WORLD DETAIL', options: [{ label: 'LOW' }, { label: 'HIGH' }], index: () => (s.detail === 'low' ? 0 : 1), setIndex: (i) => { s.detail = i ? 'high' : 'low'; custom(); save(); } },
          { type: 'toggle', label: 'BLOOM + ANTI-ALIASING', get: () => s.postFx, set: (v) => { s.postFx = v; custom(); save(); } },
          { type: 'toggle', label: 'CROSSHAIR', get: () => s.crosshair, set: (v) => { s.crosshair = v; save(); } },
          { type: 'toggle', label: 'KILLCAM', get: () => s.killcam, set: (v) => { s.killcam = v; save(); } },
          { type: 'slider', label: 'CAMERA MOTION', min: 0, max: 1, step: 0.1, get: () => s.cameraMotion, set: (v) => { s.cameraMotion = v; save(); }, format: (v) => `${Math.round(v * 100)}%` },
          { type: 'slider', label: 'SCREEN SHAKE', min: 0, max: 1, step: 0.1, get: () => s.screenShake, set: (v) => { s.screenShake = v; save(); }, format: (v) => `${Math.round(v * 100)}%` },
          { type: 'toggle', label: 'FILM GRAIN', get: () => s.filmGrain, set: (v) => { s.filmGrain = v; save(); } },
          { type: 'toggle', label: 'CHROMATIC ABERRATION', get: () => s.chromaticAberration, set: (v) => { s.chromaticAberration = v; save(); } },
          { type: 'toggle', label: 'REDUCED MENU MOTION', get: () => s.reducedMotion, set: (v) => { s.reducedMotion = v; save(); } },
          { type: 'toggle', label: 'SHOW FPS', get: () => s.showFps, set: (v) => { s.showFps = v; save(); } },
          ...(platform.canFullscreen ? [{ type: 'toggle', label: 'FULLSCREEN', get: () => s.fullscreen, set: (v) => { s.fullscreen = v; save(); } }] : []),
          { type: 'slider', label: 'MASTER VOLUME', min: 0, max: 1, step: 0.05, get: () => s.master, set: (v) => { s.master = v; save(); }, format: (v) => Math.round(v * 100) },
          { type: 'slider', label: 'EFFECTS VOLUME', min: 0, max: 1, step: 0.05, get: () => s.sfx, set: (v) => { s.sfx = v; save(); }, format: (v) => Math.round(v * 100) },
          { type: 'slider', label: 'MUSIC VOLUME', min: 0, max: 1, step: 0.05, get: () => s.music, set: (v) => { s.music = v; save(); }, format: (v) => Math.round(v * 100) },
          { label: 'RETRY SAVE', sub: 'Save current progress and settings', action: async () => {
            const saved = await profile.save();
            this.app.hud.toast(saved ? 'PROGRESS SAVED' : 'SAVE FAILED · CHECK AVAILABLE STORAGE', saved ? 'ally' : 'enemy');
          } },
          { label: 'BACK', cls: 'back', action: () => this.pop() },
        ],
        panel: this.controlsHtml(),
        card: false,
      }),
    };
  }

  controlsHtml() {
    const rows = [
      ['MOVE', 'W A S D', 'LEFT STICK'], ['LOOK', 'MOUSE', 'RIGHT STICK'], ['FIRE', 'LEFT MOUSE', 'RT / R2'], ['AIM DOWN SIGHTS', 'RIGHT MOUSE', 'LT / L2'],
      ['JUMP / MANTLE', 'SPACE', 'A / ✕'], ['CROUCH / SLIDE', 'C / CTRL', 'B / ○'], ['SPRINT · TACTICAL SPRINT', 'SHIFT · DOUBLE-TAP', 'L3 · L3 AGAIN'],
      ['RELOAD', 'R', 'X / □'], ['PICK UP WEAPON', 'HOLD F', 'HOLD X / □'], ['SWITCH WEAPON', 'Q / WHEEL / 1-2', 'Y / △'], ['FRAG GRENADE', 'G', 'RB / R1'], ['MELEE', 'V', 'R3'],
      ['FIRE MODE', 'B', 'D-PAD ▼'], ['INSPECT WEAPON', 'I', '—'], ['KILLSTREAKS', '3 · 4 · 5', 'D-PAD ◀ ▲ ▶'], ['SCOREBOARD', 'TAB', 'VIEW / TOUCHPAD'], ['PAUSE', 'ESC', 'MENU / OPTIONS'],
      ['BUY STATION', 'HOLD F NEAR STATION', 'HOLD X / □'], ['HOLD BREATH (SCOPED)', 'HOLD SHIFT', 'HOLD L3'],
    ];
    return `<div class="panel" style="margin-top:6vh;max-width:640px"><h3>FIELD MANUAL</h3><table class="controls-table"><thead><tr><th scope="col">ACTION</th><th scope="col">KEYBOARD / MOUSE</th><th scope="col">CONTROLLER</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody></table><p class="comfort-note">For a steadier view, lower Camera Motion and Screen Shake. Film Grain and Chromatic Aberration can be disabled independently. Settings save automatically.</p></div>`;
  }

  pauseScreen() {
    const app = this.app;
    return {
      onBack: () => app.resume(),
      build: () => ({
        title: 'PAUSED', sub: `${app.game.mode.name} · ${app.game.map.name}${app.game.modifier ? ' · ' + app.game.modifier.name : ''}`, dim: true,
        rows: [
          { label: 'RESUME', action: () => app.resume() },
          { label: 'LOADOUT', sub: 'Changes apply on next deploy', action: () => this.push(this.loadoutScreen()) },
          { label: 'SETTINGS', action: () => this.push(this.settingsScreen()) },
          { label: 'LEAVE MATCH', sub: 'Progress from this match is lost', action: () => app.leaveMatch() },
        ],
        card: false,
        panel: `<div class="live-col pause-col">${app.game.session ? assignmentCard(app.game.session.assignment.preview(profile.data)) + challengePanel(app.game.session) : ''}</div>`,
      }),
    };
  }

  /** After-action report: XP breakdown, level / season / weapon progress, challenges and unlocks. */
  endScreen(result, game) {
    const app = this.app;
    const st = game.stats, rep = result.report || { rows: [], challenges: [], weapons: [], unlocks: [], levels: [], total: st.xp };
    const kd = st.deaths ? (st.kills / st.deaths).toFixed(2) : st.kills.toFixed(2);
    const acc = st.shots ? Math.round((st.hits / st.shots) * 100) + '%' : '—';
    const banner = result.outcome === 'win' ? '<div class="end-banner win">VICTORY</div>' : result.outcome === 'lose' ? '<div class="end-banner lose">DEFEAT</div>' : result.outcome === 'draw' ? '<div class="end-banner">DRAW</div>' : '<div class="end-banner lose">K.I.A.</div>';
    const d = profile.data, lv = rep.level, ss = rep.season;
    const levelBlock = lv ? `<div class="aar-prog"><div class="aar-prog-top">${rankBadge(d.level, d.prestige, 'sm')}<div><b>${rep.levels.length ? `LEVEL UP · ${d.level}` : `LEVEL ${d.level}`}</b><small>${lv.max ? 'MAX LEVEL' : `${fmtNum(lv.xp)} / ${fmtNum(lv.need)} XP`}</small></div></div>${bar(lv.max ? 1 : lv.xp, lv.max ? 1 : lv.need, 'xp')}</div>` : '';
    const seasonBlock = ss ? `<div class="aar-prog"><div class="aar-prog-top"><div class="tier-chip">${ss.to}</div><div><b>SEASON ${String(ss.n).padStart(2, '0')} · TIER ${ss.to}</b><small>${ss.to > ss.from ? `+${ss.to - ss.from} TIER${ss.to - ss.from > 1 ? 'S' : ''} · ` : ''}${ss.to >= TIERS ? 'COMPLETE' : `${fmtNum(ss.xp % TIER_XP)} / ${fmtNum(TIER_XP)} XP`}</small></div></div>${bar(ss.to >= TIERS ? 1 : ss.xp % TIER_XP, ss.to >= TIERS ? 1 : TIER_XP)}</div>` : '';
    const weapons = rep.weapons.map((w) => `<div class="aar-weapon"><div class="aar-prog-top"><b>${w.name}</b><small>${w.to > w.from ? `LEVEL ${w.from} → ${w.to}` : `LEVEL ${w.to}`} · +${fmtNum(w.xp)} XP</small></div>${bar(w.to >= WEAPON_MAX ? 1 : w.into, w.to >= WEAPON_MAX ? 1 : w.need)}</div>`).join('');
    const chals = rep.challenges.filter((c) => c.gained > 0).sort((a, b) => b.done - a.done).slice(0, 6);
    const next = nextOperation(game.cfg);
    const primary = profile.data.loadout.primary, mastery = nextMastery(primary), primaryInfo = weaponInfo(primary);
    return {
      onBack: () => app.toMainMenu(),
      build: () => ({
        title: '', sub: '', dim: true, wide: true, cls: 'aar-screen', card: false,
        rows: [
          { label: 'NEXT OPERATION', cls: 'deploy-start', sub: `${MODES[next.mode].name} · ${MAPS[next.map].name}`, action: () => app.startMatch(next) },
          { label: 'PLAY AGAIN', sub: `${game.mode.name} · ${game.map.name}${game.modifier ? ' · ' + game.modifier.name : ''}`, action: () => app.startMatch({ ...game.cfg }) },
          { label: 'CHANGE LOADOUT', sub: 'Try a weapon or equip your new unlocks', action: () => this.push(this.loadoutScreen()) },
          { label: 'MAIN MENU', action: () => app.toMainMenu() },
        ],
        after: `<div style="margin-top:3vh">${banner}<div class="title-sub" style="margin:6px 0 0">${result.subtitle || game.mode.name}</div>
          ${rep.records?.length ? `<div class="panel personal-records"><h3>NEW PERSONAL BESTS</h3>${rep.records.map((record) => `<div class="record-row"><span>${record.label}</span><b>${record.value}</b><small>${record.previous ? `PREVIOUS ${record.previous}` : 'FIRST RECORD'}</small></div>`).join('')}</div>` : ''}
          ${rep.unlocks.length ? `<div class="panel unlocks" style="margin-top:14px"><h3>UNLOCKED</h3>${rep.unlocks.map((u) => `<div class="unlock-row">${u}</div>`).join('')}</div>` : ''}
          <div class="panel" style="margin-top:14px"><h3>MATCH REPORT</h3><div class="mini-stats">${[['KILLS', st.kills], ['DEATHS', st.deaths], ['ASSISTS', st.assists], ['K/D', kd], ['HEADSHOTS', st.headshots], ['ACCURACY', acc], ['BEST STREAK', st.bestStreak]].map(([k, v]) => `<div><b>${v}</b><small>${k}</small></div>`).join('')}</div></div></div>`,
        panel: `<div class="aar">${rep.assignment ? assignmentCard({ ...rep.assignment, claimed: !!rep.assignment.earned, complete: rep.assignment.complete || rep.assignment.mastered }, rep.assignment.mastered ? 'TRACK MASTERED · TITLE UNLOCKED' : rep.assignment.earned ? 'STAGE COMPLETE · XP CLAIMED' : 'FIELD ASSIGNMENT PROGRESS') : ''}<div class="panel"><h3><span>XP EARNED</span>${rep.boosts?.length ? `<span class="h3-right hot">${rep.boosts.join(' · ')}</span>` : ''}</h3>
            ${rep.rows.map(([k, v]) => `<div class="stat-row"><span>${k}</span><span>+${fmtNum(v)}</span></div>`).join('')}
            <div class="stat-row total"><span>TOTAL</span><span>+${fmtNum(rep.total)}</span></div>${levelBlock}${seasonBlock}</div>
          ${weapons ? `<div class="panel"><h3>WEAPON PROGRESS</h3>${weapons}</div>` : ''}
          ${mastery ? `<div class="panel next-unlock"><h3>NEXT WEAPON REWARD</h3><b>${mastery.name} CAMO</b><p>${WEAPONS[primary].name} · Weapon level ${primaryInfo.level} → ${mastery.level}</p><small>Keep using this weapon to build mastery. Camos can be equipped in Loadout.</small></div>` : ''}
          ${chals.length ? `<div class="panel"><h3>CHALLENGES</h3>${chals.map((c) => `<div class="chal ${c.done ? 'done' : ''}"><div class="chal-top"><span class="chal-text">${c.done ? '✓ ' : ''}${c.text}</span><span class="chal-xp">${c.done ? 'COMPLETE' : `+${fmtNum(c.gained)}`}</span></div>${bar(c.prog, c.target)}<div class="chal-meta"><span>${fmtNum(c.prog)} / ${fmtNum(c.target)} · ${c.scope.toUpperCase()}</span></div></div>`).join('')}</div>` : ''}</div>`,
      }),
    };
  }
}
