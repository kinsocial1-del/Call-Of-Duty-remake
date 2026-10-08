const fraction = value => Math.max(0,Math.min(1,Number.isFinite(value) ? value : 0));

export function combatDisplay(player) {
  const w=player.w,def=w.def;
  const duration=player.perks.has('marathon') ? 5.4 : 3.6;
  const recovery=player.perks.has('marathon') || player.perks.has('lightweight') ? 3 : 5;
  const sprint=!player.alive ? 0 : player.tac ? fraction(player.tacTime/duration) : fraction(1-player.tacCooldown/recovery);
  let label='READY',progress=-1,action='ready';
  if(!player.alive) {label='REDEPLOY';action='dead';}
  else if(player.mantle) {label='MANTLING';progress=fraction(player.mantle.t);action='mantle';}
  else if(player.reloadT>=0) {label=player.reloadEmpty && player.reloadT>=0.8 ? 'CHAMBERING' : 'RELOADING';progress=fraction(player.reloadT);action='reload';}
  else if(player.shellT>=0) {label='LOADING SHELL';progress=fraction(player.shellT);action='reload';}
  else if(player.swapT>=0) {label='SWITCHING';progress=fraction(player.swapT);action='swap';}
  else if(player.cycleT>=0) {label=def.mode==='bolt' ? 'CYCLING BOLT' : 'CYCLING';progress=fraction(player.cycleT);action='cycle';}
  else if(player.nadeT>=0) {label='THROWING FRAG';progress=fraction(player.nadeT);action='grenade';}
  else if(player.inspectT>=0) {label='INSPECTING';action='inspect';}
  else if(w.mag<=0) {label=w.reserve>0 ? 'EMPTY MAGAZINE' : 'OUT OF AMMO';action='empty';}
  return {ammo:fraction(w.mag/def.mag),label,progress,action,sprint,
    sprintLabel:!player.alive ? 'OFFLINE' : player.tac ? 'ACTIVE' : player.tacCooldown>0 ? 'RECHARGING' : 'READY'};
}

export function streakIcon(id) {
  const paths={
    uav:'<path d="M16 3V28M3 17L16 10L29 17M9 28L16 24L23 28"/>',
    airstrike:'<path d="M7 4L25 4L28 9L16 16L4 9ZM16 16V22M6 28L10 23M16 30V25M26 28L22 23"/>',
    sentry:'<path d="M7 9H24V17H7ZM24 12H30M14 17V22M14 22L5 29M14 22L22 29M14 22V29M9 6H21"/>',
  };
  return `<svg viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[id]||paths.uav}</svg>`;
}

export function weaponIcon(def) {
  const path=def.slot==='secondary' && !def.rocket ? '<path d="M4 11H26V17H17L14 26H8L11 17H4ZM20 8H26M4 8H14"/>' : '<path d="M2 13H9L12 10H25V13H31M9 13V20H3V16M13 13V20H18L16 27H21L24 20H27V13M15 7H23"/>';
  return `<svg viewBox="0 0 34 32" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round">${path}</svg>`;
}
