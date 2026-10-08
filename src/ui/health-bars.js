import * as THREE from 'three';

export function healthState(actor) {
  const max=Number.isFinite(actor.maxHealth) && actor.maxHealth>0 ? actor.maxHealth : 100;
  const value=actor.alive && Number.isFinite(actor.health) ? Math.max(0,Math.min(max,actor.health)) : 0;
  return {value,max,ratio:value/max,low:value/max<=0.3};
}

export class HealthBars {
  constructor(root,player) {
    this.root=root;this.player=player;this.bars=new Map();
    this.playerFill=player.querySelector('.health-fill');this.playerValue=player.querySelector('.health-value');
  }
  reset() {this.root.replaceChildren();this.bars.clear();}
  update(game,width=innerWidth,height=innerHeight) {
    const p=game.player,cam=game.R.camera,own=healthState(p);
    cam.updateMatrixWorld();
    this.player.classList.toggle('low',own.low);
    this.playerFill.style.transform=`scaleX(${own.ratio})`;
    const label=`${Math.ceil(own.value)} / ${Math.ceil(own.max)}`;
    if(this.playerValue.textContent!==label) this.playerValue.textContent=label;
    this.player.setAttribute('aria-valuenow',Math.ceil(own.value));
    this.player.setAttribute('aria-valuemax',Math.ceil(own.max));
    const current=new Set(game.actors.map(a=>a.id));
    for(const [id,bar] of this.bars) if(!current.has(id)) {bar.el.remove();this.bars.delete(id);}
    for(const actor of game.actors) {
      if(actor===p) continue;
      let bar=this.bars.get(actor.id);
      if(!bar) {
        const el=document.createElement('div');el.className='actor-health';
        el.innerHTML='<div class="actor-label"><span class="actor-name"></span><span class="actor-value"></span></div><div class="health-track"><div class="health-fill"></div></div>';
        this.root.appendChild(el);
        bar={el,fill:el.querySelector('.health-fill'),name:el.querySelector('.actor-name'),value:el.querySelector('.actor-value')};this.bars.set(actor.id,bar);
      }
      const hidden=!actor.alive || !p.alive || game.killcam.active || game.over || actor.pos.distanceToSquared(cam.position)>60*60;
      if(hidden) {bar.el.hidden=true;continue;}
      actor.headPos(anchor);anchor.y+=0.38;
      screen.copy(anchor).project(cam);
      if(screen.z<-1 || screen.z>1 || Math.abs(screen.x)>1.03 || Math.abs(screen.y)>1.03) {bar.el.hidden=true;continue;}
      if(p.def?.scope && p.adsT>0.85 && Math.hypot(screen.x*width/2,screen.y*height/2)>height*0.33) {bar.el.hidden=true;continue;}
      // Use the body for occlusion: a marker must not reveal an operator through cover.
      const visible=game.world.lineOfSight(cam.position,actor.chest(chest));
      bar.el.hidden=!visible;if(!visible) continue;
      const state=healthState(actor),enemy=p.isEnemy(actor,game.ffa);
      bar.el.classList.toggle('enemy',enemy);bar.el.classList.toggle('low',state.low);
      bar.el.style.transform=`translate(${((screen.x+1)*width/2).toFixed(1)}px,${((1-screen.y)*height/2).toFixed(1)}px) translate(-50%,-100%)`;
      bar.fill.style.transform=`scaleX(${state.ratio})`;
      if(bar.name.textContent!==actor.name) bar.name.textContent=actor.name;
      const value=`${Math.ceil(state.value)}`;if(bar.value.textContent!==value) bar.value.textContent=value;
    }
  }
}

const anchor=new THREE.Vector3(),screen=new THREE.Vector3(),chest=new THREE.Vector3();
