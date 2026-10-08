// The ladder repeats after its highest requirement. Unused rewards are banked.
export function createRewards(definitions) {
  const cycleKills=Math.max(1,...definitions.map(s=>s.kills));
  return definitions.map(s=>({...s,charges:0,ready:false,nextAt:s.kills,cycleKills}));
}

export function earnRewards(rewards, kills) {
  const earned=[];
  for(const reward of rewards) {
    let count=0;
    while(kills>=reward.nextAt) {
      reward.charges++; count++; reward.nextAt+=reward.cycleKills;
    }
    reward.ready=reward.charges>0;
    if(count) earned.push({reward,count,index:rewards.indexOf(reward)});
  }
  return earned;
}

export function consumeReward(reward) {
  if(!reward || reward.charges<=0) return false;
  reward.charges--; reward.ready=reward.charges>0; return true;
}

export function resetRewardProgress(rewards) {
  for(const reward of rewards) {reward.nextAt=reward.kills;reward.ready=reward.charges>0;}
}
