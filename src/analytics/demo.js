// Generates realistic synthetic days so the analytics can be explored before real data exists.
import { dayKey, dayStart, shiftDay, MIN, HOUR } from '../core/time.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const CENTER = { lat: 51.5226, lng: -0.0857 };

/** A day script: list of [startHour, endHour, activity, outsideFence?] */
function script(r, weekday) {
  const j = (h, m = 0.25) => h + (r() - 0.5) * m; // jitter
  const lunch = j(12.2, 0.5);
  const lunchLen = 0.55 + r() * 0.4;
  const walkLunch = r() > 0.25;
  const lazy = r() < 0.35; // some days are simply more sedentary
  const mv = (cls) => (lazy && cls === 'walk' && r() < 0.6 ? 'light' : cls);
  const plan = [
    [8, j(8.45), 'light', true],
    [null, j(8.85), 'walk', true],
    [null, j(10.1, 0.6), 'still', false],
    [null, null, 'walk', false, 0.08],
    [null, j(11.6, 0.4), 'still', false],
    [null, null, 'light', false, 0.15],
    [null, lunch, 'still', false],
    [null, null, walkLunch ? 'walk' : 'light', true, 0.15],
    [null, null, 'light', true, lunchLen - 0.3],
    [null, null, 'walk', true, 0.15],
    [null, j(15.2, 0.8), 'still', false],
    [null, null, r() > 0.5 ? 'walk' : 'light', r() > 0.5, 0.25],
    [null, j(16.9, 0.4), 'still', false],
    [null, null, 'light', false, 0.2],
    [null, j(17.45, 0.2), 'still', false],
    [null, 18, weekday % 3 === 0 ? 'run' : 'walk', true],
  ];
  let t = 8;
  return plan.map(([, end, cls, out, len]) => {
    const from = t;
    t = end ?? from + len * (lazy ? 0.6 : 1);
    return { from, to: Math.max(from + 0.02, t), cls: mv(cls), out };
  });
}

export function generateDay(day, seed = 1) {
  const r = rng(seed);
  const base = dayStart(day);
  const wd = new Date(base).getDay();
  const blocks = script(r, wd);
  const samples = [];
  const fixes = [];
  const fence = [];
  const coverage = [];

  // Simulate a background gap (app hidden) mid-afternoon.
  const gapStart = base + (13.8 + r() * 0.5) * HOUR;
  const gapEnd = gapStart + (15 + r() * 25) * MIN;

  let t = base + 8 * HOUR + 3 * MIN;
  let stillStreak = 0;
  const blockAt = (tt) => blocks.find((b) => tt >= base + b.from * HOUR && tt < base + b.to * HOUR) ?? blocks[blocks.length - 1];
  while (t < base + 18 * HOUR) {
    if (t >= gapStart && t < gapEnd) { t = gapEnd + 5000; continue; }
    const b = blockAt(t);
    let cls = b.cls;
    if (cls === 'still' && r() < 0.06) cls = 'light'; // fidgets
    if (cls === 'light' && r() < 0.15) cls = 'walk';
    const intensity = { still: 0.05 + r() * 0.12, light: 0.3 + r() * 0.2, walk: 0.6 + r() * 0.15, run: 0.85 + r() * 0.15 }[cls];
    const cadence = cls === 'walk' ? 1.7 + r() * 0.3 : cls === 'run' ? 2.6 + r() * 0.3 : 0;
    const interval = cls === 'still' ? [30, 45, 60, 90][Math.min(3, Math.floor(++stillStreak / 3))] * 1000 : (stillStreak = 0, cls === 'light' ? 25000 : 15000);
    samples.push({ t, day, cls, intensity: +intensity.toFixed(3), cadence: +cadence.toFixed(2), std: 0, span: interval + 5000 });
    t += interval + 5000;
  }

  // Fence: build transitions from block "out" flags, with fixes around them.
  let inside = !blocks[0].out;
  const pt = (out, k) => {
    const ang = k * 2.39996;
    const d = out ? 260 + r() * 400 : r() * 80;
    return { lat: CENTER.lat + (d * Math.cos(ang)) / 111320, lng: CENTER.lng + (d * Math.sin(ang)) / (111320 * Math.cos((CENTER.lat * Math.PI) / 180)) };
  };
  fixes.push({ t: base + 8 * HOUR + 4 * MIN, day, ...pt(!inside, 0), acc: 25, inside });
  blocks.forEach((b, k) => {
    const now = !b.out;
    if (now !== inside) {
      const tt = base + b.from * HOUR + 2 * MIN;
      const inferred = tt > gapStart && tt < gapEnd;
      fence.push({ t: tt, day, type: now ? 'enter' : 'exit', inferred, ...pt(!now, k) });
      fixes.push({ t: tt, day, ...pt(!now, k), acc: 18, inside: now });
      inside = now;
    }
  });

  coverage.push({ id: base + 8 * HOUR, day, start: base + 8 * HOUR + 3 * MIN, end: gapStart, mode: 'foreground' });
  coverage.push({ id: gapEnd, day, start: gapEnd, end: base + 18 * HOUR, mode: 'pocket' });

  return { samples, fixes, fence, coverage, fenceConfig: { ...CENTER, radius: 200, name: 'Studio' } };
}

/** Seed `count` past days (ending yesterday) plus today-so-far into the db. */
export async function seedDemo(db, count = 14) {
  const today = dayKey();
  let fenceConfig;
  for (let i = count; i >= 0; i--) {
    const day = shiftDay(today, -i);
    const g = generateDay(day, 1000 + i * 7919);
    fenceConfig = g.fenceConfig;
    await db.deleteDay(day);
    const cut = i === 0 ? Date.now() : Infinity;
    await db.putMany('samples', g.samples.filter((s) => s.t < cut));
    await db.putMany('fixes', g.fixes.filter((s) => s.t < cut));
    await db.putMany('fence', g.fence.filter((s) => s.t < cut));
    await db.putMany('coverage', g.coverage.filter((c) => c.start < cut).map((c) => ({ ...c, end: Math.min(c.end, cut) })));
  }
  return fenceConfig;
}
