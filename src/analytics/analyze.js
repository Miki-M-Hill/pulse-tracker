// Day analytics (pure). Converts raw duty-cycled samples into a minute-resolution
// timeline, then derives activity, rest, rhythm and geofence statistics.

import { windowFor, MIN, HOUR, clock, duration } from '../core/time.js';

const MAX_SPAN = 3 * MIN; // a sample never vouches for more than 3 minutes
const ACTIVE = new Set(['walk', 'run']);
const MOVING = new Set(['light', 'walk', 'run']);

/** Build a per-minute grid: { cls: string|null, intensity: number } for each minute in window. */
export function minuteGrid(samples, ws, we) {
  const n = Math.round((we - ws) / MIN);
  const grid = Array.from({ length: n }, () => ({ cls: null, intensity: 0, w: 0 }));
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  sorted.forEach((s, i) => {
    const next = sorted[i + 1];
    const span = Math.min(s.span ?? MAX_SPAN, MAX_SPAN, next ? next.t - s.t : MAX_SPAN);
    const a = Math.max(ws, s.t);
    const b = Math.min(we, s.t + span);
    if (b <= a) return;
    for (let m = Math.floor((a - ws) / MIN); m < Math.ceil((b - ws) / MIN) && m < n; m++) {
      const ms = ws + m * MIN;
      const overlap = Math.min(b, ms + MIN) - Math.max(a, ms);
      if (overlap <= 0) continue;
      const cell = grid[m];
      // The class with the most evidence in a minute wins; movement beats stillness on ties.
      if (overlap > cell.w || (overlap === cell.w && MOVING.has(s.cls))) { cell.cls = s.cls; cell.w = overlap; }
      cell.intensity = Math.max(cell.intensity, s.intensity);
    }
  });
  return grid;
}

/** Run-length encode the grid into segments { cls, start, end } (ms). Short gaps between equal classes are bridged. */
export function segmentsFrom(grid, ws) {
  const segs = [];
  grid.forEach((c, m) => {
    const cls = c.cls ?? 'gap';
    const last = segs[segs.length - 1];
    if (last && last.cls === cls) last.end = ws + (m + 1) * MIN;
    else segs.push({ cls, start: ws + m * MIN, end: ws + (m + 1) * MIN });
  });
  // Bridge ≤2 min gaps flanked by the same class.
  for (let i = 1; i < segs.length - 1; i++) {
    const s = segs[i];
    if (s.cls === 'gap' && s.end - s.start <= 2 * MIN && segs[i - 1].cls === segs[i + 1].cls) {
      segs[i - 1].end = segs[i + 1].end;
      segs.splice(i, 2);
      i--;
    }
  }
  return segs;
}

/** Rest periods: still stretches ≥ minMinutes, tolerating ≤2-min fidget/gap blips inside. */
export function restPeriods(segs, minMinutes) {
  const out = [];
  let cur = null;
  for (const s of segs) {
    const len = s.end - s.start;
    if (s.cls === 'still') {
      if (cur) cur.end = s.end; else cur = { start: s.start, end: s.end, blips: 0 };
    } else if (cur && (s.cls === 'light' || s.cls === 'gap') && len <= 2 * MIN) {
      cur.end = s.end; cur.blips++;
    } else {
      if (cur) out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out
    .map((r) => {
      // trim trailing blips
      const tail = [...segs].reverse().find((s) => s.cls === 'still' && s.end <= r.end && s.start >= r.start);
      return { ...r, end: tail ? tail.end : r.end };
    })
    .filter((r) => r.end - r.start >= minMinutes * MIN);
}

function fenceTrips({ fixes, events, ws, we, now }) {
  const sortedFixes = [...fixes].filter((f) => f.inside != null).sort((a, b) => a.t - b.t);
  const evs = [...events].filter((e) => e.type === 'exit' || e.type === 'enter').sort((a, b) => a.t - b.t);
  const firstKnown = sortedFixes[0];
  if (!firstKnown && !evs.length) return null;

  // Initial state: the state before the first transition, or the first fix.
  let inside = evs.length ? evs[0].type === 'exit' : firstKnown.inside;
  const end = Math.min(we, now);
  const trips = [];
  let open = inside ? null : { start: Math.max(ws, firstKnown?.t ?? ws), startedOutside: true, inferredStart: false };
  for (const e of evs) {
    if (e.t < ws || e.t > we) continue;
    if (e.type === 'exit' && !open) open = { start: e.t, inferredStart: !!e.inferred };
    else if (e.type === 'enter' && open) {
      trips.push({ ...open, end: e.t, inferredEnd: !!e.inferred });
      open = null;
    }
  }
  if (open && end > open.start) trips.push({ ...open, end, ongoing: now < we, untilWindowEnd: now >= we });
  trips.forEach((t) => { t.duration = t.end - t.start; });
  return { trips, startedInside: inside };
}

/**
 * Analyse one day.
 * @param {object} p { day, samples, fixes, fence, coverage, settings, now }
 */
export function analyzeDay({ day, samples = [], fixes = [], fence = [], coverage = [], settings, now = Date.now() }) {
  const { startHour = 8, endHour = 18, restMinutes = 20 } = settings || {};
  const [ws, we] = windowFor(day, startHour, endHour);
  const elapsedEnd = Math.min(we, Math.max(ws, now));
  const grid = minuteGrid(samples, ws, we);
  const segs = segmentsFrom(grid, ws);

  const minutes = { still: 0, light: 0, walk: 0, run: 0 };
  grid.forEach((c) => { if (c.cls) minutes[c.cls]++; });
  const observed = minutes.still + minutes.light + minutes.walk + minutes.run;
  const elapsedMin = Math.max(1, Math.round((elapsedEnd - ws) / MIN));
  const activeMin = minutes.walk + minutes.run;
  const movingMin = activeMin + minutes.light;

  // Steps: cadence × the time each walking sample represents.
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  let steps = 0;
  sorted.forEach((s, i) => {
    if (!ACTIVE.has(s.cls) || !s.cadence) return;
    const span = Math.min(s.span ?? MAX_SPAN, MAX_SPAN, sorted[i + 1] ? sorted[i + 1].t - s.t : MAX_SPAN);
    steps += s.cadence * (span / 1000);
  });
  steps = Math.round(steps);

  // Hourly profile.
  const hours = [];
  for (let h = startHour; h < endHour; h++) {
    const from = Math.round((h - startHour) * 60);
    const cells = grid.slice(from, from + 60);
    const row = { hour: h, still: 0, light: 0, walk: 0, run: 0, observed: 0, intensity: 0 };
    cells.forEach((c) => { if (c.cls) { row[c.cls]++; row.observed++; row.intensity += c.intensity; } });
    row.intensity = row.observed ? row.intensity / row.observed : 0;
    row.active = row.walk + row.run;
    row.moving = row.active + row.light;
    hours.push(row);
  }
  const observedHours = hours.filter((h) => h.observed >= 10);
  const peakHour = observedHours.reduce((b, h) => (!b || h.moving + h.active > b.moving + b.active ? h : b), null);
  const rate = (h) => h.moving / h.observed;
  const quietHour = observedHours.filter((h) => h.observed >= 30).reduce((b, h) => (!b || rate(h) < rate(b) ? h : b), null);

  // Most energetic 30-minute window (sliding sum of intensity weighted by class).
  const weight = { still: 0, light: 0.4, walk: 1, run: 1.6 };
  const score = grid.map((c) => (c.cls ? weight[c.cls] * (0.5 + c.intensity) : 0));
  let best = { sum: 0, i: -1 };
  let acc = 0;
  for (let i = 0; i < score.length; i++) {
    acc += score[i];
    if (i >= 30) acc -= score[i - 30];
    if (i >= 29 && acc > best.sum) best = { sum: acc, i: i - 29 };
  }
  const peakWindow = best.i >= 0 && best.sum > 3 ? { start: ws + best.i * MIN, end: ws + (best.i + 30) * MIN } : null;

  const rests = restPeriods(segs, restMinutes);
  const longestRest = rests.reduce((b, r) => (!b || r.end - r.start > b.end - b.start ? r : b), null);
  const stillRuns = restPeriods(segs, 1);
  // A "move break" = getting up after ≥30 min still.
  const moveBreaks = stillRuns.filter((r) => r.end - r.start >= 30 * MIN && r.end < elapsedEnd - MIN).length;

  // Rhythm: share of movement in morning / midday / afternoon.
  const part = (a, b) => hours.filter((h) => h.hour >= a && h.hour < b).reduce((s, h) => s + h.moving, 0);
  const rhythm = [
    { key: 'Morning', from: startHour, to: 12, value: part(startHour, 12) },
    { key: 'Midday', from: 12, to: 14, value: part(12, 14) },
    { key: 'Afternoon', from: 14, to: endHour, value: part(14, endHour) },
  ].filter((r) => r.to > r.from);

  const sedentaryShare = observed ? minutes.still / observed : 0;
  const longestRestMin = longestRest ? (longestRest.end - longestRest.start) / MIN : 0;
  const activityScore = observed
    ? Math.round(100 * (0.4 * Math.min(1, activeMin / 75) + 0.3 * Math.min(1, steps / 9000) + 0.3 * (1 - Math.min(1, Math.max(0, longestRestMin - 30) / 120))))
    : 0;

  const fenceStats = (() => {
    const r = fenceTrips({ fixes, events: fence, ws, we, now });
    if (!r) return null;
    const { trips } = r;
    const outside = trips.reduce((s, t) => s + t.duration, 0);
    const exits = trips.filter((t) => !t.startedOutside).length;
    trips.forEach((t) => {
      const from = Math.max(0, Math.floor((t.start - ws) / MIN));
      const to = Math.min(grid.length, Math.ceil((t.end - ws) / MIN));
      const cells = grid.slice(from, to);
      t.activeMin = cells.filter((c) => ACTIVE.has(c.cls)).length;
      t.movingMin = cells.filter((c) => MOVING.has(c.cls)).length;
    });
    const longest = trips.reduce((b, t) => (!b || t.duration > b.duration ? t : b), null);
    return {
      trips,
      exits,
      outsideMs: outside,
      insideMs: Math.max(0, elapsedEnd - ws - outside),
      outsideShare: outside / Math.max(1, elapsedEnd - ws),
      longest,
      avgTrip: trips.length ? outside / trips.length : 0,
      firstExit: trips.find((t) => !t.startedOutside)?.start ?? null,
      lastReturn: [...trips].reverse().find((t) => !t.ongoing)?.end ?? null,
      inferred: trips.filter((t) => t.inferredStart || t.inferredEnd).length,
      startedInside: r.startedInside,
    };
  })();

  const coverageMs = coverage.reduce((s, c) => s + Math.max(0, Math.min(c.end, we) - Math.max(c.start, ws)), 0);

  const report = {
    day, ws, we, elapsedEnd, grid, segs, hours, minutes, observed, elapsedMin,
    coverage: Math.min(1, observed / elapsedMin),
    coverageMs,
    activeMin, movingMin, steps, sedentaryShare,
    peakHour, quietHour, peakWindow,
    rests, longestRest, moveBreaks, rhythm, activityScore,
    fence: fenceStats,
  };
  report.insights = buildInsights(report);
  return report;
}

function buildInsights(r) {
  const out = [];
  if (!r.observed) return out;
  if (r.peakWindow) {
    out.push({ icon: 'bolt', tone: 'walk', title: 'Peak energy', text: `Your most active half-hour was ${clock(r.peakWindow.start)}–${clock(r.peakWindow.end)}.` });
  }
  if (r.longestRest) {
    const len = r.longestRest.end - r.longestRest.start;
    out.push({
      icon: 'couch', tone: 'still', title: 'Longest rest',
      text: `You stayed still for ${duration(len)} from ${clock(r.longestRest.start)}${len > 90 * MIN ? ' — a short walk every hour helps circulation and focus.' : '.'}`,
    });
  }
  const top = [...r.rhythm].sort((a, b) => b.value / (b.to - b.from) - a.value / (a.to - a.from))[0];
  if (top && top.value > 5) out.push({ icon: 'sun', tone: 'light', title: `${top.key} mover`, text: `You moved most per hour in the ${top.key.toLowerCase()}.` });
  if (r.quietHour && r.peakHour && r.quietHour.hour !== r.peakHour.hour) {
    out.push({ icon: 'moon', tone: 'still', title: 'Quietest hour', text: `${fmtHour(r.quietHour.hour)} was your calmest hour — just ${Math.round((r.quietHour.moving / r.quietHour.observed) * 60)} min of movement.` });
  }
  if (r.moveBreaks) out.push({ icon: 'stand', tone: 'light', title: 'Get-up moments', text: `You got up ${r.moveBreaks} time${r.moveBreaks > 1 ? 's' : ''} after sitting 30 min or more.` });
  if (r.fence?.trips.length) {
    const f = r.fence;
    out.push({
      icon: 'pin', tone: 'zone', title: 'Out & about',
      text: `${f.exits || 'No'} departure${f.exits === 1 ? '' : 's'}, ${duration(f.outsideMs)} outside your zone${f.longest ? `; longest trip ${duration(f.longest.duration)} at ${clock(f.longest.start)}` : ''}.`,
    });
  }
  if (r.coverage < 0.6) out.push({ icon: 'eye', tone: 'muted', title: 'Partial picture', text: `Tracking saw ${Math.round(r.coverage * 100)}% of the window. Pocket mode keeps sensing continuous.` });
  return out;
}

const fmtHour = (h) => clock(new Date(2000, 0, 1, h).getTime());

/** Compact summary used for week trends. */
export function summarize(r) {
  return {
    day: r.day, score: r.activityScore, steps: r.steps, activeMin: r.activeMin, movingMin: r.movingMin,
    stillMin: r.minutes.still, observed: r.observed, outsideMs: r.fence?.outsideMs ?? 0, exits: r.fence?.exits ?? 0,
    hours: r.hours.map((h) => (h.observed ? h.moving / h.observed : null)),
  };
}

export { HOUR };
