// Time helpers. All "day" keys are local-calendar dates: 'YYYY-MM-DD'.

export const MIN = 60_000;
export const HOUR = 60 * MIN;

const pad = (n) => String(n).padStart(2, '0');

export function dayKey(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dayStart(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function shiftDay(day, delta) {
  const t = dayStart(day);
  const d = new Date(t);
  d.setDate(d.getDate() + delta);
  return dayKey(d.getTime());
}

/** Absolute [start, end] ms of the tracking window for a day. Hours may be fractional. */
export function windowFor(day, startHour = 8, endHour = 18) {
  const base = dayStart(day);
  return [base + startHour * HOUR, base + endHour * HOUR];
}

export function inWindow(t, startHour, endHour) {
  const [s, e] = windowFor(dayKey(t), startHour, endHour);
  return t >= s && t < e;
}

/** ms until the next window opens (0 if currently inside). */
export function msUntilWindow(t, startHour, endHour) {
  const day = dayKey(t);
  const [s, e] = windowFor(day, startHour, endHour);
  if (t < s) return s - t;
  if (t < e) return 0;
  return windowFor(shiftDay(day, 1), startHour, endHour)[0] - t;
}

export function clock(t, { seconds = false } = {}) {
  const d = new Date(t);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) });
}

export function hourLabel(h) {
  const hh = ((h + 11) % 12) + 1;
  return `${hh}${h < 12 ? 'a' : 'p'}`;
}

export function duration(ms, { short = false } = {}) {
  const m = Math.round(ms / MIN);
  if (m < 1) return short ? '<1m' : 'under a minute';
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export function prettyDay(day) {
  const today = dayKey();
  if (day === today) return 'Today';
  if (day === shiftDay(today, -1)) return 'Yesterday';
  return new Date(dayStart(day)).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}
