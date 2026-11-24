// Pure signal processing: turns a short burst of accelerometer readings into an
// activity classification. No DOM access — unit-testable in Node.
//
// Input readings: [{ t: ms, x, y, z, r? }] where x/y/z are accelerationIncludingGravity
// in m/s² and r (optional) is rotation-rate magnitude in deg/s.

const G = 9.80665;

export const CLASSES = ['still', 'light', 'walk', 'run'];

export const CLASS_META = {
  still: { label: 'Resting', color: 'var(--c-still)', met: 1.2 },
  light: { label: 'Light activity', color: 'var(--c-light)', met: 2.0 },
  walk: { label: 'Walking', color: 'var(--c-walk)', met: 3.5 },
  run: { label: 'Running', color: 'var(--c-run)', met: 8.0 },
};

const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const std = (a, m = mean(a)) => Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length || 1));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function smooth(a, k = 3) {
  if (a.length < k) return a.slice();
  const h = Math.floor(k / 2);
  return a.map((_, i) => {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - h); j <= Math.min(a.length - 1, i + h); j++) { s += a[j]; n++; }
    return s / n;
  });
}

/** Normalised autocorrelation of a zero-mean signal at `lag`. */
function acf(sig, lag) {
  let num = 0, d0 = 0, d1 = 0;
  for (let i = 0; i + lag < sig.length; i++) {
    num += sig[i] * sig[i + lag];
    d0 += sig[i] * sig[i];
    d1 += sig[i + lag] * sig[i + lag];
  }
  const den = Math.sqrt(d0 * d1);
  return den ? num / den : 0;
}

/**
 * Find the dominant step periodicity. Returns { cadence (steps/s), periodicity (0..1) }.
 * Walking produces one magnitude peak per step; the autocorrelation may lock onto the
 * stride (two steps), so we prefer the half-lag when it is nearly as strong.
 */
export function stepPeriodicity(sig, fs) {
  const minLag = Math.max(2, Math.floor(fs / 3.6)); // fastest: 3.6 steps/s
  const maxLag = Math.min(sig.length - 4, Math.ceil(fs / 0.6)); // slowest stride: 0.6 Hz
  const r = [];
  let globalBest = 0;
  for (let lag = minLag; lag <= maxLag; lag++) { r[lag] = acf(sig, lag); globalBest = Math.max(globalBest, r[lag]); }
  // Periodic signals correlate at every multiple of the period, so take the FIRST
  // local peak that is close to the global best rather than the global max itself.
  let best = 0, bestLag = 0;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1] && r[lag] >= globalBest * 0.85) { best = r[lag]; bestLag = lag; break; }
  }
  if (!bestLag) return { cadence: 0, periodicity: 0 };
  let lag = bestLag;
  const half = Math.round(bestLag / 2);
  if (half >= minLag) {
    const rh = Math.max(acf(sig, half), acf(sig, half + 1), acf(sig, half - 1));
    if (rh > best * 0.6) lag = half;
  }
  const cadence = fs / lag;
  return { cadence: cadence >= 0.9 && cadence <= 3.8 ? cadence : 0, periodicity: clamp(best, 0, 1) };
}

/** Extract features from a window of readings. */
export function extractFeatures(readings) {
  const n = readings.length;
  if (n < 8) return null;
  const durS = (readings[n - 1].t - readings[0].t) / 1000;
  if (durS <= 0.5) return null;
  const fs = (n - 1) / durS;
  const mag = readings.map((p) => Math.hypot(p.x, p.y, p.z) / G);
  const m = mean(mag);
  const sd = std(mag, m);
  const sig = smooth(mag.map((v) => v - m), fs > 40 ? 5 : 3);
  const { cadence, periodicity } = stepPeriodicity(sig, fs);
  const rots = readings.map((p) => p.r).filter((v) => Number.isFinite(v));
  const rot = rots.length ? mean(rots) : null;
  return { n, fs, durS, mean: m, std: sd, cadence, periodicity, rot };
}

/**
 * Classify a feature vector.
 * Thresholds tuned on phone-in-pocket / phone-in-hand traces:
 *   std(|a|) < ~0.01 g          → still (sitting, lying, phone on desk)
 *   periodic 1.3–2.6 Hz, ≥0.06 g → walking
 *   periodic ≥2.3 Hz, ≥0.30 g    → running
 *   otherwise moving             → light activity (standing, chores, fidgeting)
 */
export function classify(f) {
  if (!f) return null;
  const periodic = f.periodicity >= 0.4 && f.cadence > 0;
  let cls;
  if (periodic && f.cadence >= 2.3 && f.std >= 0.3) cls = 'run';
  else if (periodic && f.cadence >= 1.2 && f.cadence <= 2.7 && f.std >= 0.06) cls = 'walk';
  else if (f.std >= 0.018 || (f.rot ?? 0) >= 12) cls = 'light';
  else cls = 'still';

  // Intensity: log-scaled movement energy, 0 (dead still) .. 1 (vigorous).
  const intensity = clamp((Math.log10(Math.max(f.std, 1e-4)) + 2.3) / 2.0, 0, 1);
  return {
    cls,
    intensity: Math.round(intensity * 1000) / 1000,
    cadence: cls === 'walk' || cls === 'run' ? Math.round(f.cadence * 100) / 100 : 0,
    std: Math.round(f.std * 10000) / 10000,
  };
}
