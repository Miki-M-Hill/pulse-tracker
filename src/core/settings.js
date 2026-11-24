// Reactive settings persisted in IndexedDB (kv store).
import { db } from './db.js';

export const DEFAULTS = {
  startHour: 8,
  endHour: 18,
  fence: null, // { lat, lng, radius, name }
  pocketMode: false,
  armed: false,
  restMinutes: 20, // a still stretch at least this long counts as a rest period
};

const listeners = new Set();
let current = { ...DEFAULTS };

export const settings = {
  async load() {
    current = { ...DEFAULTS, ...(await db.getKV('settings', {})) };
    return current;
  },
  get() { return current; },
  async set(patch) {
    current = { ...current, ...patch };
    await db.setKV('settings', current);
    listeners.forEach((fn) => fn(current, patch));
    return current;
  },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
