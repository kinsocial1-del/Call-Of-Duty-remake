// Slow, bounded resolution changes absorb sustained rendering load without oscillation.
export class PerformanceScale {
  constructor() { this.reset(); }
  reset() { this.scale = 1; this.average = 1 / 60; this.slowTime = 0; this.fastTime = 0; this.cooldown = 2; }
  update(dt, active = true) {
    if (!active || !Number.isFinite(dt) || dt <= 0 || dt > 0.1) return false;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.average += (dt - this.average) * (1 - Math.exp(-dt * 2));
    this.slowTime = this.average > 0.020 ? this.slowTime + dt : 0;
    this.fastTime = this.average < 0.0145 ? this.fastTime + dt : 0;
    if (this.cooldown > 0) return false;
    let next = this.scale;
    if (this.slowTime > 1) next = Math.max(0.7, Math.round((this.scale - 0.1) * 10) / 10);
    else if (this.fastTime > 4) next = Math.min(1, Math.round((this.scale + 0.1) * 10) / 10);
    if (next === this.scale) return false;
    this.scale = next; this.cooldown = 2; this.slowTime = this.fastTime = 0;
    return true;
  }
}
