// Orchestrates sensors, persistence and the tracking window.
//
// Power strategy
//   1. Nothing runs outside the configured window (default 08:00–18:00); a single timer
//      wakes the tracker when the window opens.
//   2. The IMU is duty-cycled (5 s bursts, 15–90 s apart, adaptive to activity).
//   3. GPS is gated by the IMU: while you are still we don't ask for position at all
//      (except a 15-min heartbeat); while moving we poll only as often as needed to
//      catch a crossing at your current pace, using coarse fixes far from the boundary.
//   4. Background gaps are recorded honestly as "unobserved" coverage, and on return to
//      the foreground we immediately re-sample motion + position to reconcile state.

import { db } from './db.js';
import { settings } from './settings.js';
import { dayKey, msUntilWindow, inWindow, windowFor } from './time.js';
import { Geofence, nextFixDelay } from './geofence.js';
import { MotionSampler, requestMotionPermission } from '../sensors/motion.js';
import { getFix, geoAvailable } from '../sensors/location.js';

export class Tracker extends EventTarget {
  constructor() {
    super();
    this.active = false;
    this.segment = null;
    this.fence = null;
    this.motion = null; // last motion sample
    this.stillSince = null;
    this.lastFix = null;
    this.fixTimer = null;
    this.windowTimer = null;
    this.wakeLock = null;
    this.motionOk = null;
    this.locationError = null;
    this.sampler = new MotionSampler({
      onWindow: (s) => this._onSample(s),
      onNoSensor: () => { this.motionOk = false; this._emit('status'); },
    });
    document.addEventListener('visibilitychange', () => this._onVisibility());
    settings.subscribe((s, patch) => this._onSettings(s, patch));
  }

  async init() {
    const s = settings.get();
    if (s.fence) this.fence = new Geofence(s.fence, await db.getKV('fenceState', {}));
    if (s.armed) this.tick();
  }

  /** Call from a user gesture: asks for permissions and arms the daily schedule. */
  async arm() {
    this.motionOk = await requestMotionPermission();
    if (settings.get().fence && geoAvailable()) {
      try { this._recordFix(await getFix({ high: true })); } catch (e) { this.locationError = e.message; }
    }
    await settings.set({ armed: true });
    this.tick();
  }

  async disarm() {
    await settings.set({ armed: false });
    this._stop();
    clearTimeout(this.windowTimer);
    this._emit('status');
  }

  /** Re-evaluate whether we should be sensing right now. */
  tick() {
    clearTimeout(this.windowTimer);
    const { armed, startHour, endHour } = settings.get();
    if (!armed) return;
    const now = Date.now();
    if (inWindow(now, startHour, endHour)) {
      if (document.visibilityState === 'visible') this._start();
      const untilEnd = windowFor(dayKey(now), startHour, endHour)[1] - now + 500;
      this.windowTimer = setTimeout(() => this.tick(), Math.min(untilEnd, 30 * 60_000));
    } else {
      this._stop();
      this.windowTimer = setTimeout(() => this.tick(), Math.min(msUntilWindow(now, startHour, endHour), 30 * 60_000));
    }
    this._emit('status');
  }

  get status() {
    const s = settings.get();
    const now = Date.now();
    return {
      armed: s.armed,
      active: this.active,
      inWindow: inWindow(now, s.startHour, s.endHour),
      nextWindowIn: msUntilWindow(now, s.startHour, s.endHour),
      motion: this.motion,
      motionOk: this.motionOk,
      stillSince: this.stillSince,
      fence: s.fence,
      inside: this.fence?.inside ?? null,
      lastFix: this.lastFix,
      distance: this.fence && this.lastFix ? this.fence.distance(this.lastFix) : null,
      locationError: this.locationError,
      wakeLock: !!this.wakeLock,
    };
  }

  // ---------------------------------------------------------------- internals

  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  _start() {
    if (this.active) return;
    this.active = true;
    const now = Date.now();
    this.segment = { id: now, day: dayKey(now), start: now, end: now, mode: settings.get().pocketMode ? 'pocket' : 'foreground' };
    db.put('coverage', this.segment);
    this.sampler.start();
    if (this.fence) this._scheduleFix(0);
    if (settings.get().pocketMode) this._acquireWakeLock();
  }

  _stop() {
    if (!this.active) return;
    this.active = false;
    this.sampler.stop();
    clearTimeout(this.fixTimer);
    this._closeSegment();
    this._releaseWakeLock();
  }

  _closeSegment() {
    if (!this.segment) return;
    const { startHour, endHour } = settings.get();
    const windowEnd = windowFor(this.segment.day, startHour, endHour)[1];
    this.segment.end = Math.max(this.segment.end, Math.min(Date.now(), windowEnd));
    db.put('coverage', this.segment);
    this.segment = null;
  }

  _onVisibility() {
    if (document.visibilityState === 'hidden') {
      this._stop();
    } else {
      this.tick();
      this.sampler.poke();
    }
  }

  async _onSample(s) {
    const day = dayKey(s.t);
    const rec = { ...s, day };
    this.motion = rec;
    if (s.cls === 'still') this.stillSince ??= s.t; else this.stillSince = null;
    if (this.motionOk == null) this.motionOk = true;
    await db.put('samples', rec);
    if (this.segment) {
      if (this.segment.day !== day) { this._closeSegment(); this._stop(); this.tick(); }
      else { this.segment.end = Date.now(); db.put('coverage', this.segment); }
    }
    this._emit('sample', rec);
    // Starting to move after a long rest: check position sooner.
    if (this.fence && s.cls !== 'still' && this._fixDue > Date.now() + 60_000) this._scheduleFix(15_000);
  }

  _scheduleFix(delay) {
    clearTimeout(this.fixTimer);
    this._fixDue = Date.now() + delay;
    this.fixTimer = setTimeout(() => this._takeFix(), delay);
  }

  async _takeFix() {
    if (!this.active || !this.fence) return;
    const margin = this.lastFix ? this.fence.margin(this.lastFix) : null;
    const high = margin == null || Math.abs(margin) < 150 || !!this.fence.pending;
    try {
      const fix = await getFix({ high, maxAge: high ? 10_000 : 60_000 });
      this.locationError = null;
      this._recordFix(fix);
    } catch (e) {
      this.locationError = e.message || 'Location unavailable';
      this._emit('status');
    }
    if (!this.active) return;
    const m = this.lastFix ? this.fence.margin(this.lastFix) : null;
    this._scheduleFix(nextFixDelay({
      marginM: m,
      motion: this.motion?.cls,
      stillForMs: this.stillSince ? Date.now() - this.stillSince : 0,
      pending: !!this.fence.pending,
    }));
  }

  _recordFix(fix) {
    if (!this.fence) return;
    this.lastFix = fix;
    const ev = this.fence.update(fix);
    db.put('fixes', { ...fix, day: dayKey(fix.t) });
    db.setKV('fenceState', this.fence.snapshot());
    if (ev && ev.type !== 'init') {
      const rec = { ...ev, day: dayKey(ev.t) };
      db.put('fence', rec);
      this._emit('fence', rec);
      this._notify(ev);
    }
    this._emit('fix', fix);
    this._emit('status');
  }

  _notify(ev) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    navigator.serviceWorker?.ready.then((reg) => reg.showNotification(ev.type === 'exit' ? 'You left your zone' : 'Back in your zone', {
      body: settings.get().fence?.name || 'Geofence',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: 'fence',
    })).catch(() => {});
  }

  _onSettings(s, patch) {
    if ('fence' in patch) {
      this.fence = s.fence ? new Geofence(s.fence) : null;
      this.lastFix = null;
      db.setKV('fenceState', {});
      if (this.active && this.fence) this._scheduleFix(0);
      if (!this.fence) clearTimeout(this.fixTimer);
    }
    if ('startHour' in patch || 'endHour' in patch) this.tick();
    if ('pocketMode' in patch) {
      if (s.pocketMode && this.active) this._acquireWakeLock(); else this._releaseWakeLock();
    }
    this._emit('status');
  }

  async _acquireWakeLock() {
    if (!('wakeLock' in navigator) || this.wakeLock) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => { this.wakeLock = null; this._emit('status'); });
    } catch { this.wakeLock = null; }
    this._emit('status');
  }

  _releaseWakeLock() { this.wakeLock?.release().catch(() => {}); this.wakeLock = null; }
}
