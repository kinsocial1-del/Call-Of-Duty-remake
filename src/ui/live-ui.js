// HTML building blocks for progression UI: rank badges, calling cards, challenge lists, progress bars, the season
// track and the supply drop calendar. Used by the menus and the after-action report.
import { profile, ACHIEVEMENTS, MAX_LEVEL, xpForLevel } from '../core/save.js';
import { cardDef, camoDef, PRESTIGE_COLORS, PRESTIGE_MAX, roman } from '../core/catalog.js';
import { challengeText, challengeMode, tierOf, tierReward, rewardLabel, TIER_XP, TIERS, seasonInfo, DROP_CYCLE, dropReward, nextDailyReset, nextWeeklyReset } from '../core/live.js';
import { fmtNum } from '../core/utils.js';

const MODE_TAG = { dom: 'DOMINATION', hp: 'HARDPOINT', kc: 'KILL CONFIRMED', survival: 'SURVIVAL', gun: 'GUN GAME' };

export const pct = (v, max) => Math.max(0, Math.min(100, max ? (v / max) * 100 : 0));
export const bar = (v, max, cls = '') => `<div class="pbar ${cls}"><i style="width:${pct(v, max)}%"></i></div>`;
/** Live countdown span; the menu updates every [data-until] once a second. */
export const until = (ts) => `<span data-until="${ts}"></span>`;

export function rankBadge(level = profile.data.level, prestige = profile.data.prestige, cls = '') {
  const col = PRESTIGE_COLORS[Math.min(prestige, PRESTIGE_COLORS.length - 1)];
  return `<div class="rank-badge ${cls}" style="--rc:${col}">${prestige ? `<small>${roman(prestige)}</small>` : ''}<b>${level}</b></div>`;
}

export function cardHtml(id = profile.data.cosmetics.card, extra = '', cls = '') {
  const c = cardDef(id, ACHIEVEMENTS);
  return `<div class="ccard ${cls}" style="background:${c.bg};--ca:${c.accent}"><svg class="emblem" viewBox="0 0 64 64"><path d="${c.emblem}"/></svg>${c.tag ? `<small>${c.tag}</small>` : ''}<b>${c.name}</b>${extra}</div>`;
}

/** The player's identity: calling card with rank, callsign, title and level progress. */
export function identityCard() {
  const d = profile.data, max = d.level >= MAX_LEVEL, need = xpForLevel(d.level);
  const c = cardDef(d.cosmetics.card, ACHIEVEMENTS);
  return `<div class="player-card" style="--card-bg:${c.bg}"><svg class="emblem" viewBox="0 0 64 64"><path d="${c.emblem}"/></svg>
    <div class="lvl">${rankBadge()}<div><div class="name">${d.name}</div><div class="ptitle">${d.cosmetics.title}</div></div></div>
    ${bar(max ? 1 : d.xp, max ? 1 : need, 'xp')}
    <div class="xptext"><span>${d.prestige ? `REBIRTH ${roman(d.prestige)} · ` : ''}${max ? 'MAX LEVEL' : `LEVEL ${d.level}`}</span><span>${max ? (d.prestige < PRESTIGE_MAX ? 'REBIRTH READY' : 'REBIRTH MASTER') : `${fmtNum(d.xp)} / ${fmtNum(need)} XP`}</span></div></div>`;
}

/** Challenge rows. session (optional) adds the current match's unsaved progress. */
export function challengeRows(list, session = null, opts = {}) {
  return list.map((c, i) => {
    const prog = session ? session.progress(c) : c.prog, done = c.done || prog >= c.target, mode = challengeMode(c);
    const gained = session ? prog - c.prog : 0;
    return `<div class="chal ${done ? 'done' : ''}">
      <div class="chal-top"><span class="chal-text">${done ? '✓ ' : ''}${challengeText(c)}${mode ? ` <em>${MODE_TAG[mode]}</em>` : ''}</span><span class="chal-xp">+${fmtNum(c.xp)} XP</span></div>
      ${bar(prog, c.target)}
      <div class="chal-meta"><span>${fmtNum(prog)} / ${fmtNum(c.target)}${gained > 0 ? ` <em>+${fmtNum(gained)}</em>` : ''}</span>${opts.swap && !done && i === opts.swapIndex ? '<span class="chal-swap">SWAP AVAILABLE</span>' : ''}</div>
    </div>`;
  }).join('');
}

export function challengePanel(session = null, { weekly = true } = {}) {
  const L = profile.data.live, doneD = L.daily.filter((c) => c.done).length, doneW = L.weekly.filter((c) => c.done).length;
  return `<div class="panel live-panel"><h3><span>DAILY CHALLENGES · ${doneD}/${L.daily.length}</span><span class="h3-right">RESETS IN ${until(nextDailyReset())}</span></h3>
    ${challengeRows(L.daily, session)}
    ${weekly ? `<h3 style="margin-top:16px"><span>WEEKLY CHALLENGES · ${doneW}/${L.weekly.length}</span><span class="h3-right">RESETS IN ${until(nextWeeklyReset())}</span></h3>${challengeRows(L.weekly, session)}` : ''}</div>`;
}

export function rewardIcon(r) {
  if (r.kind === 'camo') { const c = camoDef(r.id); return `<i class="ri camo" style="background:linear-gradient(135deg,${(c?.colors || ['#555', '#999']).slice(0, 3).join(',')})"></i>`; }
  if (r.kind === 'card') return `<i class="ri card" style="background:${cardDef(r.id).bg}"></i>`;
  if (r.kind === 'title') return '<i class="ri title">T</i>';
  if (r.kind === 'token') return '<i class="ri token">2×</i>';
  return '<i class="ri xp">XP</i>';
}

export function seasonSummary() {
  const s = seasonInfo(), xp = profile.data.live.season.xp, t = tierOf(xp), next = Math.min(TIERS, t + 1);
  const r = tierReward(s.n, next);
  return `<div class="season-sum"><div class="season-head"><span class="eyebrow">SEASON ${String(s.n).padStart(2, '0')} · ${s.name}</span><span class="h3-right">ENDS IN ${until(s.end)}</span></div>
    <div class="season-tier"><b>TIER ${t}</b><span>/ ${TIERS}</span></div>
    ${t < TIERS ? `${bar(xp - t * TIER_XP, TIER_XP)}<div class="season-next">${rewardIcon(r)}<span>NEXT · TIER ${next}: ${rewardLabel(r)}</span></div>` : bar(1, 1) + '<div class="season-next"><span>SEASON COMPLETE</span></div>'}</div>`;
}

export function seasonTrack() {
  const s = seasonInfo(), t = tierOf(profile.data.live.season.xp);
  let html = '';
  for (let i = 1; i <= TIERS; i++) {
    const r = tierReward(s.n, i), big = r.kind === 'camo' || r.kind === 'card' || r.kind === 'title';
    html += `<div class="tier ${i <= t ? 'got' : ''} ${i === t + 1 ? 'next' : ''} ${big ? 'big' : ''}" title="TIER ${i} · ${rewardLabel(r)}"><span>${i}</span>${rewardIcon(r)}<em>${rewardLabel(r)}</em></div>`;
  }
  return `<div class="tiers">${html}</div>`;
}

export function dropCalendar(state) {
  return `<div class="drop-days">${DROP_CYCLE.map((_, i) => {
    const r = dropReward(i), cls = i < state.day || (i === state.day && state.claimed) ? 'got' : i === state.day ? 'today' : '';
    return `<div class="drop-day ${cls}"><small>DAY ${i + 1}</small>${rewardIcon(r)}<span>${rewardLabel(r)}</span></div>`;
  }).join('')}</div>`;
}
