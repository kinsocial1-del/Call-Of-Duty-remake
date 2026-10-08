import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSIGNMENTS, AssignmentRun, assignmentState, assignmentView, nextOperation, recordMatch } from '../src/core/assignments.js';
import { MatchSession } from '../src/core/live.js';
import { profile } from '../src/core/save.js';

test('old profiles receive a playable permanent assignment without changing career stats', () => {
  const data = { stats: { kills: 42 } };
  const view = assignmentView(data);
  assert.equal(view.id, 'assault'); assert.equal(view.stage, 1); assert.equal(view.xp, 1200);
  assert.deepEqual(view.goals.map(goal => goal.progress), [0, 0]); assert.equal(data.stats.kills, 42);
});

test('unfinished-match events stay buffered and switching assignments keeps both tracks', () => {
  const data = {}, first = new AssignmentRun(data);
  first.event('kill', 7, 'tdm');
  assert.equal(first.preview(data).goals[0].progress, 7);
  assert.equal(assignmentView(data).goals[0].progress, 0);
  first.commit(data);
  data.assignments.active = 'precision';
  const second = new AssignmentRun(data); second.event('headshot', 2, 'tdm'); second.commit(data);
  assert.equal(assignmentView(data, 'assault').goals[0].progress, 7);
  assert.equal(assignmentView(data, 'precision').goals[1].progress, 2);
});

test('one match can claim only one stage and duplicate commits cannot pay again', () => {
  const data = {}, run = new AssignmentRun(data);
  run.event('kill', 1000, 'tdm'); run.event('match', 20, 'tdm');
  assert.equal(run.preview(data).ready, true);
  assert.equal(run.commit(data).earned, 1200); assert.equal(run.commit(data), null);
  assert.equal(assignmentView(data).stage, 2); assert.deepEqual(assignmentView(data).goals.map(goal => goal.progress), [0, 0]);
});

test('all six tracks can be mastered in five stages and stop awarding XP', () => {
  for (const [id, def] of Object.entries(ASSIGNMENTS)) {
    const data = {}; assignmentState(data).active = id;
    for (let stage = 1; stage <= 5; stage++) {
      const run = new AssignmentRun(data);
      for (const goal of run.view.goals) run.event(goal.stat, goal.target, def.mode);
      const report = run.commit(data);
      assert.equal(report.earned, 1200 + (stage - 1) * 400); assert.equal(report.mastered, stage === 5);
    }
    assert.equal(assignmentView(data).complete, true);
    const run = new AssignmentRun(data); run.event('kill', 100, def.mode); assert.equal(run.commit(data), null);
  }
});

test('objective progress requires its actual mode and invalid amounts do not advance goals', () => {
  const data = {}; assignmentState(data).active = 'domination';
  const run = new AssignmentRun(data);
  run.event('capture', 8, 'tdm'); run.event('capture', NaN, 'dom'); run.event('capture', -4, 'dom');
  assert.equal(run.preview(data).goals[0].progress, 0);
  run.event('capture', 2, 'dom'); assert.equal(run.preview(data).goals[0].progress, 2);
});

test('invalid saved track values normalize into bounded, playable progress', () => {
  const data = { assignments: { active: 'unknown', tracks: { assault: { stage: -20, progress: [Infinity, -1] } } } };
  const view = assignmentView(data); assert.equal(view.id, 'assault'); assert.equal(view.stage, 1);
  assert.deepEqual(view.goals.map(goal => goal.progress), [0, 0]);
});

test('personal bests celebrate improvements once and history retains the latest five matches', () => {
  const data = {}, game = { stats: { kills: 12, headshots: 3, bestStreak: 4, assists: 2, deaths: 8 }, player: {}, cfg: { map: 'dockyard' }, mode: { id: 'tdm' }, result: { outcome: 'win' } };
  assert.equal(recordMatch(data, game).length, 4); assert.equal(recordMatch(data, game).length, 0);
  game.stats.kills = 13; assert.deepEqual(recordMatch(data, game), [{ label: 'ELIMINATIONS', value: 13, previous: 12 }]);
  for (let i = 0; i < 8; i++) recordMatch(data, game);
  assert.equal(data.matchRecords.history.length, 5); assert.equal(data.matchRecords.best.tdm.kills, 13);
  game.mode.id = 'survival'; game.wave = 4; game.stats.kills = 50; recordMatch(data, game);
  assert.equal(data.matchRecords.best.tdm.kills, 13); assert.equal(data.matchRecords.best.survival.kills, 50);
});

test('next-operation rotation visits every competitive mode and alternates maps', () => {
  let cfg = {mode:'gun',map:'outpost',difficulty:'veteran',modifier:'hardcore',op:true};
  const modes = new Set();
  for (let i = 0; i < 6; i++) {
    const next = nextOperation(cfg); modes.add(next.mode);
    assert.notEqual(next.map, cfg.map); assert.equal(next.difficulty, 'veteran'); assert.equal(next.op, false); assert.equal(next.modifier, ''); cfg = next;
  }
  assert.equal(modes.size, 6); assert.equal(nextOperation().mode, 'tdm');
});

test('match completion grants assignment XP and mastery title exactly once', () => {
  const saved = structuredClone(profile.data);
  try {
    profile.reset(); const state = assignmentState(profile.data);
    state.tracks.assault.stage = 4;
    const game = { cfg:{mode:'tdm',map:'dockyard'}, mode:{id:'tdm'}, player:{}, time:300,
      stats:{kills:36,headshots:0,bestStreak:3,assists:0,deaths:8,xp:1000}, result:{outcome:'lose',bonus:0},
      hud:{challenge:()=>{},toast:()=>{}} };
    const session = new MatchSession(game); session.event('kill',36);
    const report = session.commit(game.result);
    assert.equal(report.assignment.earned,2800); assert.equal(report.assignment.mastered,true);
    assert.ok(profile.data.cosmetics.titles.includes('SPEARHEAD'));
    assert.ok(report.rows.some(([label,xp])=>label.startsWith('FIELD ASSIGNMENT') && xp===2800));
    const snapshot = JSON.stringify(profile.data);
    assert.equal(session.commit(game.result),report); assert.equal(JSON.stringify(profile.data),snapshot);
  } finally { profile.data = saved; }
});
