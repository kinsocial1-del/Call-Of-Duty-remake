import { bar } from './live-ui.js';

export function assignmentCard(view, heading = 'ACTIVE FIELD ASSIGNMENT') {
  return `<div class="assignment-card ${view.complete ? 'mastered' : ''}"><div class="eyebrow">${heading} · ${view.complete ? 'MASTERED' : `STAGE ${view.stage} / 5`}</div><h3>${view.name}</h3><p>${view.desc}</p>
    ${view.goals.map((goal) => `<div class="assignment-goal"><div><span>${goal.label}</span><b>${Math.floor(goal.progress)} / ${goal.target}</b></div>${bar(goal.progress, goal.target)}</div>`).join('')}
    <div class="assignment-reward">${view.complete ? `TITLE EARNED · ${view.title}` : view.claimed ? `✓ STAGE REWARD CLAIMED · +${view.earned.toLocaleString('en-US')} XP` : view.ready ? '✓ READY · FINISH THE MATCH TO CLAIM' : `STAGE REWARD · +${view.xp.toLocaleString('en-US')} XP`}</div>
    ${!view.complete ? `<small>Finish all 5 stages to earn the ${view.title} title. No expiry.</small>` : ''}</div>`;
}
