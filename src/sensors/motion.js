// Duty-cycled IMU sampler.
//
// The accelerometer is only subscribed for a short burst (BURST_MS) and then fully
// released. The gap between bursts adapts to what we observe: when you are sitting
// still the sampler backs off to ~90 s, when you move it tightens to ~15 s. Removing
// the 'devicemotion' listener lets the browser power the sensor down between bursts.

import { extractFeatures, classify } from './features.js';

const BURST_MS = 5000;
const INTERVALS = { run: 15_000, walk: 15_000, light: 25_000, still: [30_000, 45_000, 60_000, 90_000] };

export function motionPermissionNeeded() {
  return typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';
}

/** Must be called from a user gesture on iOS. Resolves true when motion is usable. */
export async function requestMotionPermission() {
  if (typeof DeviceMotionEvent === 'undefined') return false;
  if (!motionPermissionNeeded()) return true;
  try { return (await DeviceMotionEvent.requestPermission()) === 'granted'; } catch { return false; }
}

export class MotionSampler {
  constructor({ onWindow, onNoSensor } = {}) {
    this.onWindow = onWindow;
    this.onNoSensor = onNoSensor;
    this.running = false;
    this.timer = null;
    this.stillStreak = 0;
    this.emptyBursts = 0;
    this.last = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._burst();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this._detach?.();
  }

  /** Force a sample soon (e.g. after app returns to foreground). */
  poke() {
    if (!this.running) return;
    clearTimeout(this.timer);
    this._detach?.();
    this._burst();
  }

  nextInterval(cls) {
    if (cls === 'still') {
      this.stillStreak++;
      const s = INTERVALS.still;
      return s[Math.min(s.length - 1, Math.floor(this.stillStreak / 3))];
    }
    this.stillStreak = 0;
    return INTERVALS[cls] ?? 20_000;
  }

  _burst() {
    if (!this.running) return;
    const readings = [];
    const t0 = Date.now();
    const handler = (e) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x == null) return;
      const rr = e.rotationRate;
      const r = rr && rr.alpha != null ? Math.hypot(rr.alpha, rr.beta, rr.gamma) : undefined;
      readings.push({ t: performance.now(), x: a.x, y: a.y, z: a.z, r });
    };
    window.addEventListener('devicemotion', handler);
    this._detach = () => { window.removeEventListener('devicemotion', handler); this._detach = null; };

    this.timer = setTimeout(() => {
      this._detach?.();
      if (!this.running) return;
      const result = classify(extractFeatures(readings));
      if (!result) {
        this.emptyBursts++;
        if (this.emptyBursts === 2) this.onNoSensor?.();
        this.timer = setTimeout(() => this._burst(), 60_000);
        return;
      }
      this.emptyBursts = 0;
      const interval = this.nextInterval(result.cls);
      this.last = { t: t0, ...result, span: interval + BURST_MS };
      this.onWindow?.(this.last);
      this.timer = setTimeout(() => this._burst(), interval);
    }, BURST_MS);
  }
}
