// Accuracy-aware geofence state machine (pure; no DOM).
//
// GPS fixes are noisy, so a naive "distance > radius" test produces phantom exits.
// We require the fix to clear the boundary by a buffer that grows with reported
// accuracy, and we need two agreeing fixes unless the first one is decisive.

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const bufferFor = (acc, radius) => Math.min(Math.max(10, acc * 0.6), Math.max(25, radius * 0.5));

/** Maximum gap (ms) between fixes for which a transition is considered "observed". */
const OBSERVED_GAP = 4 * 60_000;

export class Geofence {
  constructor(fence, state = {}) {
    this.fence = fence; // { lat, lng, radius }
    this.inside = state.inside ?? null; // null = unknown yet
    this.lastFix = state.lastFix ?? null; // last fix that agreed with current state
    this.pending = null; // candidate opposing fix
  }

  distance(fix) { return haversine(this.fence, fix); }

  /** Signed metres from the boundary: negative inside, positive outside. */
  margin(fix) { return this.distance(fix) - this.fence.radius; }

  /** Evaluate a fix. Returns a transition event or null. */
  update(fix) {
    const m = this.margin(fix);
    const buf = bufferFor(fix.acc ?? 30, this.fence.radius);
    let verdict = null;
    if (m > buf) verdict = false; // clearly outside
    else if (m < -Math.min(buf, this.fence.radius * 0.4) || (m < 0 && (fix.acc ?? 30) < 20)) verdict = true; // clearly inside
    fix.inside = verdict;

    if (verdict === null) return null; // ambiguous — wait for a better fix

    if (this.inside === null) {
      this.inside = verdict;
      this.lastFix = fix;
      return { type: 'init', inside: verdict, t: fix.t };
    }

    if (verdict === this.inside) {
      this.pending = null;
      this.lastFix = fix;
      return null;
    }

    const decisive = Math.abs(m) > buf * 2.5 && (fix.acc ?? 99) < 40;
    if (!this.pending && !decisive) {
      this.pending = fix;
      return null;
    }

    const first = this.pending ?? fix;
    const prev = this.lastFix;
    const gap = prev ? first.t - prev.t : Infinity;
    const inferred = gap > OBSERVED_GAP;
    // Best estimate of the crossing moment: just after the last agreeing fix when the
    // gap is small; the midpoint when we were blind for a while (e.g. app in background).
    const t = !prev ? first.t : inferred ? Math.round((prev.t + first.t) / 2) : first.t;

    this.inside = verdict;
    this.pending = null;
    this.lastFix = fix;
    return { type: verdict ? 'enter' : 'exit', t, inferred, lat: first.lat, lng: first.lng, window: prev ? [prev.t, first.t] : null };
  }

  snapshot() { return { inside: this.inside, lastFix: this.lastFix }; }
}

/**
 * How long to wait before the next location fix. Battery is dominated by GPS, so:
 *   - when the IMU says you are still, we barely poll (position can't change);
 *   - otherwise we poll just often enough to catch a crossing at the current pace.
 */
export function nextFixDelay({ marginM, motion, stillForMs, pending }) {
  if (pending) return 20_000;
  if (marginM == null) return 30_000;
  const dist = Math.abs(marginM);
  if (motion === 'still' && stillForMs > 2 * 60_000) return 15 * 60_000; // heartbeat only
  const speed = motion === 'run' ? 3.5 : motion === 'walk' ? 1.5 : motion === 'light' ? 1.2 : 0.8; // m/s
  const etaS = dist / speed;
  const cap = motion === 'still' ? 10 * 60_000 : 5 * 60_000; // light may be a vehicle — keep a cap
  return Math.round(Math.min(cap, Math.max(25_000, etaS * 500)));
}
