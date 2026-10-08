import './style.css';
import * as THREE from 'three';
import { Renderer, GRAPHICS_PRESETS } from './engine/renderer.js';
import { Input } from './engine/input.js';
import { audio } from './engine/audio.js';
import { Game } from './game/game.js';
import { HUD } from './ui/hud.js';
import { Menu } from './ui/menu.js';
import { ArmoryPreview } from './ui/armory-preview.js';
import { profile, ACHIEVEMENTS } from './core/save.js';
import { loadWeaponAssets } from './game/weapons.js';
import { loadSoldierAssets, SoldierModel } from './game/soldier.js';
import { WEAPONS } from './game/weapons.js';
import { loadPropAssets } from './game/props.js';
import { refresh, dropState } from './core/live.js';
import { grant } from './core/cosmetics.js';
import { platform } from './core/platform.js';

const BASE = import.meta.env.BASE_URL;

async function loadFonts() {
  const fonts = [
    new FontFace('Rajdhani', `url(${BASE}assets/fonts/Rajdhani-Medium.ttf)`, { weight: '500' }),
    new FontFace('Rajdhani', `url(${BASE}assets/fonts/Rajdhani-Bold.ttf)`, { weight: '700' }),
    new FontFace('Stencil', `url(${BASE}assets/fonts/BlackOpsOne-Regular.ttf)`),
  ];
  await Promise.all(fonts.map((f) => f.load().then((ff) => document.fonts.add(ff)).catch(() => {})));
}

class App {
  async boot() {
    await profile.initialize();
    const fill = document.getElementById('load-fill'), txt = document.getElementById('load-text');
    const progress = (p, label) => { fill.style.width = `${Math.round(p * 100)}%`; txt.textContent = label; };
    await loadFonts();
    progress(0.03, 'PREPARING RENDERER');
    this.R = new Renderer();
    await this.R.load((p, label) => progress(0.03 + p * 0.27, label));
    progress(0.30, 'LOADING ARMORY · OPERATORS · WORLD · AUDIO');
    let loaded = 0;
    await Promise.all([loadWeaponAssets(BASE), loadSoldierAssets(BASE), loadPropAssets(BASE), audio.preload(BASE)].map(async (job) => {
      await job;
      progress(0.30 + (++loaded / 4) * 0.5, `ASSET GROUPS READY · ${loaded} / 4`);
    }));
    this.input = new Input();
    this.hud = new HUD(this.input);
    this.game = new Game(this.R, this.input, this.hud);
    this.armory = new ArmoryPreview(this.R);
    this.menu = new Menu(this);
    progress(0.85, 'BUILDING WORLD');
    await new Promise((r) => setTimeout(r, 30));
    this.applySettings();   // first: the map is built at the chosen world detail
    this.game.loadMap('dockyard');
    progress(0.94, 'PREPARING SHADERS');
    // compile shaders up-front to avoid hitches on first frame. No bots exist yet, so a stand-in soldier of each
    // faction (with a gun) is placed in front of the camera for the compile, then thrown away.
    const standIns = ['ironfront', 'korvax'].map((f) => new SoldierModel(f, Object.values(WEAPONS)[0]));
    for (const s of standIns) { s.root.position.copy(this.R.camera.position).add(this.R.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(4)); this.R.scene.add(s.root); }
    this.R.r.compile(this.R.scene, this.R.camera);
    for (const s of standIns) { this.R.scene.remove(s.root); s.dispose(); }
    refresh();
    this.showMain();
    progress(1, 'READY TO DEPLOY');
    document.getElementById('loading').classList.add('done');

    const unlockAudio = () => {
      if (!audio.ctx || audio.ctx.state === 'suspended') audio.init();
      if (!this.game.running && !audio._music) audio.startMusic('menu');
    };
    addEventListener('pointerdown', unlockAudio);
    addEventListener('keydown', unlockAudio);
    this.R.r.domElement.addEventListener('click', () => {
      if (this.game.running && !this.game.paused && !this.game.over) this.input.lock(this.R.r.domElement);
    });
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.game.running && !this.game.paused && !this.game.over && this.input.lastDevice === 'kbm' && !this.menu.open && !this.game.buy.open && !this.game.airstrikeTargeting.open) this.pause();
    });
    // A controller match must pause too when the player switches apps or hides the tab.
    const suspend = () => {
      if (this.game.running && !this.game.paused && !this.game.over) {
        this.game.buy.close();
        this.pause();
      }
      this.last = performance.now();
      this.input.clear();
      this.input.stopRumble();
      void profile.save();
      if (audio.ctx?.state === 'running') void audio.ctx.suspend().catch(() => {});
    };
    platform.onEvent((event) => {
      if (event.type === 'suspend' || event.type === 'user-change') {
        suspend();
        if (event.type === 'user-change') {
          this.userChanged = true;
          this.menu.replace({ build: () => ({
            title: 'PLAYER CHANGED', sub: 'Restart the game for the selected player.',
            rows: [], dim: true, card: false,
          }) });
        }
      }
      if (event.type === 'save-error') this.hud.toast('PROGRESS NOT SAVED · CHECK STORAGE AND RETRY', 'enemy');
    });
    platform.connect();
    addEventListener('pagehide', () => { suspend(); void platform.flush(); });
    addEventListener('blur', suspend);
    document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); });
    profile.onAchievement((id) => { grant('card', 'a-' + id); profile.save(); this.hud.toast(`ACHIEVEMENT UNLOCKED — ${ACHIEVEMENTS[id]?.name || id} · CALLING CARD`, 'ally'); });
    this.game.onMatchEnd = (res) => this.showEnd(res);

    this.orbit = 0;
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  /** Main menu, with today's supply drop on top when it hasn't been claimed yet. */
  showMain() {
    refresh();
    this.menu.replace(this.menu.mainScreen());
    if (!dropState().claimed) this.menu.push(this.menu.supplyDropScreen());
  }

  applySettings() {
    const s = profile.s;
    audio.vol.master = s.master; audio.vol.sfx = s.sfx; audio.vol.music = s.music;
    audio.applyVolumes();
    // profiles from before the individual graphics options: expand their old quality level into them once
    if (s.gfxV !== 2) { Object.assign(s, GRAPHICS_PRESETS[s.quality] || GRAPHICS_PRESETS.high); s.gfxV = 2; profile.save(); }
    const detailBefore = this.R.detail;
    this.R.applyGraphics({ renderScale: s.renderScale, shadows: s.shadows, ao: !!s.ao, detail: s.detail, postFx: !!s.postFx, native: s.quality === 'ultra' });
    this.R.finalPass.uniforms.grain.value = s.filmGrain ? 0.012 : 0;
    this.R.finalPass.uniforms.aberration.value = s.chromaticAberration ? 0.0015 : 0;
    document.documentElement.classList.toggle('reduce-motion', !!s.reducedMotion);
    this.input.deadzone = s.padDeadzone;
    this.input.promptStyle = s.controllerPrompts;
    if (this.input.gamepad) this.input._detectPad(this.input.gamepad);
    document.documentElement.style.setProperty('--hud-safe-area', `${s.hudSafeArea}vmin`);
    // world detail is baked into the map: rebuild the menu backdrop now, a running match picks it up next map load
    if (detailBefore && detailBefore !== this.R.detail && this.game.map && !this.game.running) this.game.loadMap(this.game.map.id);
    if (!s.rumble) this.input.rumble = () => {}; else delete this.input.rumble;
    platform.fullscreen(!!s.fullscreen);
  }

  previewMap(id) {
    if (this.game.running || this.game.map?.id === id) return;
    this.game.loadMap(id); this.orbit = id === 'outpost' ? 0.65 : 0.25;
    this.R.finalPass.uniforms.damage.value = 0;
    this.R.finalPass.uniforms.flash.value = 0;
  }

  startMatch(cfg) {
    if (this.userChanged) return;
    audio.init();
    audio.stopMusic();
    this.menu.close();
    this.input.clear();
    this.game.start(cfg);
    this.input.lock(this.R.r.domElement);
  }

  pause() {
    if (!this.game.running || this.game.over) return;
    this.game.paused = true;
    this.game.airstrikeTargeting.close(false);
    this.input.clear(); this.game.player.cancelInput();
    this.input.unlock();
    this.menu.replace(this.menu.pauseScreen());
  }

  resume() {
    if (this.userChanged) return;
    audio.init();
    void platform.flush();
    this.menu.close();
    this.input.clear();
    this.game.paused = false;
    this.input.lock(this.R.r.domElement);
  }

  leaveMatch() { this.toMainMenu(); }

  toMainMenu() {
    this.input.unlock();
    this.game.quit();
    this.hud.show(false);
    this.R.finalPass.uniforms.damage.value = 0;
    this.R.finalPass.uniforms.desat.value = 0.05;
    this.showMain();
    audio.startMusic('menu');
  }

  showEnd(result) {
    this.input.unlock();
    document.getElementById('scoreboard').classList.add('hidden');
    this.menu.replace(this.menu.endScreen(result, this.game));
  }

  loop(t) {
    requestAnimationFrame((tt) => this.loop(tt));
    const frameDt = Math.max(0, (t - this.last) / 1000);
    const dt = Math.min(0.1, frameDt);
    this.last = t;
    if (this.userChanged) { this.input.endFrame(); return; }
    if (document.hidden) { this.input.endFrame(); return; }
    const a = this.input.update();
    const g = this.game;
    if (a.controllerLost && g.running && !g.paused && !g.over) {
      g.buy.close(); this.pause();
      this.hud.toast('CONTROLLER DISCONNECTED · RECONNECT OR USE KEYBOARD TO RESUME', 'enemy');
    }
    const menuWasOpen = this.menu.open;
    if (menuWasOpen) this.menu.update(a);

    if (g.running) {
      if (g.paused && a.pauseP && !a.menuBack && this.menu.stack.length === 1 && performance.now() - this.menu.openedAt > 250) this.resume();
      else if (!g.paused && !g.over && a.pauseP && !menuWasOpen) { if (g.airstrikeTargeting.open) g.airstrikeTargeting.close(); else if (g.buy.open) g.buy.close(); else this.pause(); }
      else if (!g.paused && !menuWasOpen) {
        g.update(dt, a);
        this.hud.update(g, dt, frameDt);
        // mouse users must click to capture the cursor again
        if (!g.over && !g.airstrikeTargeting.open && this.input.lastDevice === 'kbm' && !this.input.locked && g.player.alive) this.hud.setHtml(document.getElementById('prompt'), 'CLICK TO FOCUS');
      }
      if (g.over) g.endT = (g.endT || 0) + dt;
    } else {
      // main menu: cinematic flyover
      this.orbit += profile.s.reducedMotion ? 0 : dt * 0.03;
      const cam = this.R.camera, map = g.map;
      const r = 82;
      cam.position.set(Math.cos(this.orbit) * r, 32 + Math.sin(this.orbit * 2.3) * 3, Math.sin(this.orbit) * r);
      cam.lookAt(0, 3, 0);
      cam.fov = 62; cam.updateProjectionMatrix();
      this.R.updateSun(_zero);
      this.R.vmScene.visible = false;
      g.fx.update(dt, innerHeight);
    }
    this.R.vmScene.visible = g.running;
    this.R.trackPerformance(frameDt, g.running && !g.paused && !menuWasOpen && !document.hidden);
    this.R.render(dt);
    this.input.endFrame();
  }
}

const _zero = new THREE.Vector3();
new App().boot().catch((e) => {
  console.error(e);
  document.getElementById('load-text').textContent = 'FAILED TO START: ' + e.message;
  const retry = document.getElementById('load-retry');
  retry.hidden = false;
  retry.addEventListener('click', () => location.reload());
});
