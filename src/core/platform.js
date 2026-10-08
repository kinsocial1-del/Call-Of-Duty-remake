// A console host must inject this bridge before loading the game. This is a
// game-side contract, not an Xbox/PlayStation SDK or a rendering runtime.
export class Platform {
  constructor(host = globalThis.window?.ironfrontPlatform, env = globalThis) {
    this.host = host;
    this.env = env;
    this.pending = new Map();
    this.writing = null;
    this.saveError = null;
    this.listeners = new Set();
  }
  get console() { return ['xbox', 'playstation'].includes(this.host?.target); }
  get canQuit() { return !this.console && !!this.env.window?.native?.quit; }
  get canFullscreen() { return !this.console && !!this.env.window?.native?.setFullscreen; }
  loadSync(key) { return this.host ? null : this.env.localStorage?.getItem(key); }
  async load(key) {
    if (this.host) {
      if (!this.host.storage?.read || !this.host.storage?.write) throw new Error('Platform save storage is not connected');
      if (this.console && (!this.host.getGamepads || !this.host.onEvent)) throw new Error('Console input and lifecycle are not connected');
      return await this.host.storage.read(key);
    }
    return this.loadSync(key);
  }
  save(key, value) {
    this.pending.set(key, value);
    // Browser saves stay synchronous, including during pagehide/unload.
    if (!this.host) {
      try {
        if (!this.env.localStorage) throw new Error('Save storage unavailable');
        this.env.localStorage.setItem(key, value);
        this.pending.delete(key); this.saveError = null;
        return Promise.resolve(true);
      } catch (error) {
        this.saveError = error; this.emit({type:'save-error'});
        return Promise.resolve(false);
      }
    }
    return this.flush();
  }
  async flush() {
    if (this.writing) return this.writing;
    this.writing = this.drain();
    try { return await this.writing; } finally {
      this.writing = null;
      if (this.pending.size && !this.saveError) void this.flush();
    }
  }
  async drain() {
    await Promise.resolve();
    // Serialize writes so an older slow write cannot overwrite a newer profile.
    while (this.pending.size) {
      const [key, value] = this.pending.entries().next().value;
      try {
        if (this.host) await this.host.storage.write(key, value);
        else {
          if (!this.env.localStorage) throw new Error('Save storage unavailable');
          this.env.localStorage.setItem(key, value);
        }
        if (this.pending.get(key) === value) this.pending.delete(key);
        this.saveError = null;
      } catch (error) {
        this.saveError = error;
        this.emit({ type: 'save-error' });
        return false; // retain the newest snapshot for an explicit retry
      }
    }
    return true;
  }
  gamepads() {
    try { return this.host?.getGamepads ? this.host.getGamepads() : this.console ? [] : this.env.navigator?.getGamepads?.() || []; }
    catch { return []; }
  }
  async achievement(id) {
    try {
      if (this.host?.unlockAchievement) await this.host.unlockAchievement(id);
      else this.env.window?.steam?.activateAchievement(id);
    } catch { /* local unlock remains earned; sync on the next launch */ }
  }
  fullscreen(value) { if (this.canFullscreen) this.env.window.native.setFullscreen(value); }
  quit() { if (this.canQuit) this.env.window.native.quit(); }
  onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit(event) { for (const listener of this.listeners) listener(event); }
  connect() {
    if (this.host?.onEvent) this.host.onEvent((event) => this.emit(event));
  }
}

export const platform = new Platform();
