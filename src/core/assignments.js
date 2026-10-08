// Permanent, player-selected goals. Match progress is buffered until completion.
export const ASSIGNMENT_STAGES = 5;
export const ASSIGNMENTS = {
  assault: { name: 'ASSAULT SPECIALIST', title: 'SPEARHEAD', desc: 'Push the frontline and finish the fight.', mode: 'tdm', goals: [{ stat: 'kill', label: 'Eliminations', base: 12, step: 6 }, { stat: 'match', label: 'Matches finished', base: 1, step: 0 }] },
  precision: { name: 'PRECISION OPERATOR', title: 'DEADEYE', desc: 'Make every shot count with clean headshots.', mode: 'tdm', goals: [{ stat: 'kill', label: 'Eliminations', base: 8, step: 4 }, { stat: 'headshot', label: 'Headshot eliminations', base: 3, step: 2 }] },
  support: { name: 'SQUAD SUPPORT', title: 'FORCE MULTIPLIER', desc: 'Help your squad secure the win.', mode: 'tdm', goals: [{ stat: 'assist', label: 'Assists', base: 3, step: 2 }, { stat: 'win', label: 'Victories', base: 1, step: 0 }] },
  domination: { name: 'FLAG RUNNER', title: 'STANDARD BEARER', desc: 'Take ground and keep the pressure on.', mode: 'dom', goals: [{ stat: 'capture', label: 'Flags captured', base: 2, step: 1, mode: 'dom' }, { stat: 'kill', label: 'Eliminations', base: 8, step: 4 }] },
  hardpoint: { name: 'ZONE DEFENDER', title: 'ANCHOR', desc: 'Hold the zone while your squad covers you.', mode: 'hp', goals: [{ stat: 'hpTime', label: 'Seconds on the Hardpoint', base: 30, step: 15, mode: 'hp' }, { stat: 'kill', label: 'Eliminations', base: 8, step: 4 }] },
  confirmed: { name: 'TAG COLLECTOR', title: 'CLEAN SWEEP', desc: 'Finish what you start. Collect the tags.', mode: 'kc', goals: [{ stat: 'confirm', label: 'Enemy tags confirmed', base: 4, step: 2, mode: 'kc' }, { stat: 'kill', label: 'Eliminations', base: 8, step: 4 }] },
};

export function assignmentState(data) {
  if (!data.assignments || typeof data.assignments !== 'object' || Array.isArray(data.assignments)) data.assignments = {};
  const state = data.assignments;
  if (!ASSIGNMENTS[state.active]) state.active = 'assault';
  if (!state.tracks || typeof state.tracks !== 'object' || Array.isArray(state.tracks)) state.tracks = {};
  for (const [id, def] of Object.entries(ASSIGNMENTS)) {
    const old = state.tracks[id] && typeof state.tracks[id] === 'object' && !Array.isArray(state.tracks[id]) ? state.tracks[id] : {};
    const stage = Number.isInteger(old.stage) ? Math.max(0, Math.min(ASSIGNMENT_STAGES, old.stage)) : 0;
    old.progress = def.goals.map((goal, i) => Math.max(0, Math.min(goal.base + goal.step * stage, Number.isFinite(old.progress?.[i]) ? old.progress[i] : 0)));
    old.stage = stage; state.tracks[id] = old;
  }
  return state;
}

export function assignmentView(data, id = assignmentState(data).active, delta = []) {
  const state = assignmentState(data), def = ASSIGNMENTS[id], track = state.tracks[id];
  const complete = track.stage >= ASSIGNMENT_STAGES;
  const goals = def.goals.map((goal, i) => {
    const target = goal.base + goal.step * Math.min(track.stage, ASSIGNMENT_STAGES - 1);
    return { ...goal, target, progress: complete ? target : Math.min(target, track.progress[i] + (delta[i] || 0)) };
  });
  return { id, ...def, stage: Math.min(track.stage + 1, ASSIGNMENT_STAGES), complete, goals, xp: complete ? 0 : 1200 + track.stage * 400, ready: !complete && goals.every((goal) => goal.progress >= goal.target) };
}

export class AssignmentRun {
  constructor(data) {
    this.id = assignmentState(data).active;
    this.view = assignmentView(data, this.id);
    this.delta = this.view.goals.map(() => 0);
    this.committed = false;
  }
  event(stat, n, mode) {
    if (this.view.complete || this.committed || !Number.isFinite(n) || n <= 0) return;
    this.view.goals.forEach((goal, i) => {
      if (goal.stat === stat && (!goal.mode || goal.mode === mode)) this.delta[i] = Math.min(goal.target, this.delta[i] + n);
    });
  }
  preview(data) { return assignmentView(data, this.id, this.committed ? [] : this.delta); }
  commit(data) {
    if (this.committed) return null;
    this.committed = true;
    const state = assignmentState(data), track = state.tracks[this.id];
    if (this.view.complete || track.stage !== this.view.stage - 1) return null;
    const before = assignmentView(data, this.id);
    track.progress = before.goals.map((goal, i) => Math.min(goal.target, goal.progress + this.delta[i]));
    const finished = assignmentView(data, this.id);
    const result = { ...finished, earned: finished.ready ? finished.xp : 0, gained: this.delta.slice() };
    if (finished.ready) { track.stage++; track.progress.fill(0); }
    result.mastered = finished.ready && track.stage === ASSIGNMENT_STAGES;
    return result;
  }
}

export function recordMatch(data, game) {
  const career = data.matchRecords ||= { best: {}, history: [] };
  career.best ||= {}; career.history = Array.isArray(career.history) ? career.history : [];
  const best = career.best[game.mode.id] ||= {};
  const st = game.stats;
  const metrics = { kills: ['ELIMINATIONS', st.kills], headshots: ['HEADSHOTS', st.headshots], streak: ['KILL STREAK', st.bestStreak], assists: ['ASSISTS', st.assists] };
  // Compare objective records within their mode, rather than against unrelated modes.
  if (game.mode.id === 'dom') metrics.captures = ['FLAGS CAPTURED', game.player.captures || 0];
  if (game.mode.id === 'kc') metrics.confirms = ['TAGS CONFIRMED', game.player.confirms || 0];
  if (game.mode.id === 'survival') metrics.waves = ['WAVES CLEARED', Math.max(0, game.wave - 1)];
  const records = [];
  for (const [key, [label, value]] of Object.entries(metrics)) {
    if (Number.isFinite(value) && value > (best[key] || 0)) {
      records.push({ label, value, previous: best[key] || 0 }); best[key] = value;
    }
  }
  career.history.unshift({ mode: game.mode.id, map: game.cfg.map, kills: st.kills, deaths: st.deaths, outcome: game.result.outcome });
  career.history = career.history.slice(0, 5);
  return records;
}

const ROTATION = ['tdm', 'kc', 'dom', 'hp', 'ffa', 'gun'];
export function nextOperation(cfg = {}) {
  return { mode: ROTATION[(ROTATION.indexOf(cfg.mode) + 1) % ROTATION.length], map: cfg.map === 'dockyard' ? 'outpost' : 'dockyard', difficulty: cfg.difficulty || 'regular', modifier: '', op: false };
}
