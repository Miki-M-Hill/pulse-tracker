// Loads raw data from IndexedDB and runs analytics, caching finished (past) days.
import { db } from '../core/db.js';
import { settings } from '../core/settings.js';
import { dayKey, shiftDay } from '../core/time.js';
import { analyzeDay, summarize } from './analyze.js';

const cache = new Map();

export async function reportFor(day, { fresh = false } = {}) {
  const s = settings.get();
  const key = `${day}|${s.startHour}|${s.endHour}|${s.restMinutes}`;
  const isPast = day < dayKey();
  if (!fresh && isPast && cache.has(key)) return cache.get(key);
  const [samples, fixes, fence, coverage] = await Promise.all([
    db.byDay('samples', day), db.byDay('fixes', day), db.byDay('fence', day), db.byDay('coverage', day),
  ]);
  const r = analyzeDay({ day, samples, fixes, fence, coverage, settings: s });
  if (isPast) cache.set(key, r);
  return r;
}

export async function recentSummaries(endDay = dayKey(), count = 7) {
  const days = Array.from({ length: count }, (_, i) => shiftDay(endDay, i - count + 1));
  return Promise.all(days.map(async (d) => summarize(await reportFor(d))));
}

export async function daysWithData() {
  return (await db.days('samples')).sort().reverse();
}

export function invalidate() { cache.clear(); }
