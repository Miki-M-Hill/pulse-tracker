// Minimal promise-based IndexedDB layer.
// Stores:
//   samples   – one record per IMU sampling window   { t, day, cls, intensity, cadence, std, span }
//   fixes     – location fixes                       { t, day, lat, lng, acc, inside }
//   fence     – geofence transitions                 { t, day, type: 'exit'|'enter', inferred, lat, lng }
//   coverage  – observed tracking segments           { id, day, start, end, mode }
//   kv        – settings & misc                      { key, value }

const DB_NAME = 'pulse-tracker';
const DB_VERSION = 1;
const TIMESERIES = ['samples', 'fixes', 'fence'];

let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of TIMESERIES) {
        if (!db.objectStoreNames.contains(name)) {
          const s = db.createObjectStore(name, { keyPath: 't' });
          s.createIndex('day', 'day');
        }
      }
      if (!db.objectStoreNames.contains('coverage')) {
        const s = db.createObjectStore('coverage', { keyPath: 'id' });
        s.createIndex('day', 'day');
      }
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

async function tx(store, mode = 'readonly') {
  const db = await open();
  return db.transaction(store, mode).objectStore(store);
}

export const db = {
  async put(store, value) { return wrap((await tx(store, 'readwrite')).put(value)); },
  async putMany(store, values) {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, 'readwrite');
      const s = t.objectStore(store);
      for (const v of values) s.put(v);
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  },
  async get(store, key) { return wrap((await tx(store)).get(key)); },
  async byDay(store, day) { return wrap((await tx(store)).index('day').getAll(day)); },
  async days(store = 'samples') {
    // Walk distinct index values with a unique key cursor.
    const s = await tx(store);
    return new Promise((res, rej) => {
      const out = [];
      const req = s.index('day').openKeyCursor(null, 'nextunique');
      req.onsuccess = () => { const c = req.result; if (c) { out.push(c.key); c.continue(); } else res(out); };
      req.onerror = () => rej(req.error);
    });
  },
  async deleteDay(day) {
    for (const store of [...TIMESERIES, 'coverage']) {
      const s = await tx(store, 'readwrite');
      const keys = await wrap(s.index('day').getAllKeys(day));
      const s2 = await tx(store, 'readwrite');
      await Promise.all(keys.map((k) => wrap(s2.delete(k))));
    }
  },
  async clearAll() {
    for (const store of [...TIMESERIES, 'coverage']) await wrap((await tx(store, 'readwrite')).clear());
  },
  async getKV(key, fallback) { const r = await this.get('kv', key); return r ? r.value : fallback; },
  async setKV(key, value) { return this.put('kv', { key, value }); },
};
