// Logic tests: `node tests/run.mjs`
import assert from 'node:assert/strict';
import { extractFeatures, classify } from '../src/sensors/features.js';
import { Geofence, nextFixDelay } from '../src/core/geofence.js';
import { analyzeDay } from '../src/analytics/analyze.js';
import { generateDay } from '../src/analytics/demo.js';

let pass = 0;
const test = (name, fn) => { try { fn(); pass++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.message); process.exitCode = 1; } };

// --- synthetic accelerometer traces -----------------------------------
function trace({ fs = 60, secs = 5, cadence = 0, amp = 0, noise = 0.002, seed = 1 }) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  const out = [];
  for (let i = 0; i < fs * secs; i++) {
    const t = i / fs;
    const g = 1 + amp * Math.sin(2 * Math.PI * cadence * t) + 0.3 * amp * Math.sin(2 * Math.PI * cadence * 2 * t) + noise * rnd();
    out.push({ t: t * 1000, x: 0.2 * 9.81, y: Math.sqrt(Math.max(0, g * g - 0.04)) * 9.81, z: 0 });
  }
  return out;
}

console.log('features');
test('still phone on desk → still', () => assert.equal(classify(extractFeatures(trace({ noise: 0.003 }))).cls, 'still'));
test('fidgeting → light', () => assert.equal(classify(extractFeatures(trace({ noise: 0.08 }))).cls, 'light'));
test('walking 1.8 Hz → walk with cadence ≈1.8', () => {
  const r = classify(extractFeatures(trace({ cadence: 1.8, amp: 0.25, noise: 0.03 })));
  assert.equal(r.cls, 'walk');
  assert.ok(Math.abs(r.cadence - 1.8) < 0.15, `cadence ${r.cadence}`);
});
test('running 2.8 Hz → run', () => assert.equal(classify(extractFeatures(trace({ cadence: 2.8, amp: 0.7, noise: 0.05 }))).cls, 'run'));
test('iOS 100 Hz walking', () => assert.equal(classify(extractFeatures(trace({ fs: 100, cadence: 1.9, amp: 0.2, noise: 0.03 }))).cls, 'walk'));
test('too few readings → null', () => assert.equal(classify(extractFeatures(trace({ secs: 0.05 }))), null));

console.log('geofence');
const C = { lat: 51.5, lng: -0.1, radius: 150 };
const at = (m, t, acc = 15) => ({ t, lat: C.lat + m / 111320, lng: C.lng, acc });
test('init inside', () => { const g = new Geofence(C); assert.equal(g.update(at(0, 0)).type, 'init'); assert.equal(g.inside, true); });
test('noisy fix near boundary does not exit', () => { const g = new Geofence(C); g.update(at(0, 0)); assert.equal(g.update(at(170, 60e3, 60)), null); assert.equal(g.inside, true); });
test('two clear outside fixes → exit at first', () => {
  const g = new Geofence(C); g.update(at(0, 0));
  assert.equal(g.update(at(165, 60e3)), null);
  const e = g.update(at(260, 90e3));
  assert.equal(e.type, 'exit'); assert.equal(e.t, 60e3); assert.equal(e.inferred, false);
});
test('decisive far fix exits immediately', () => { const g = new Geofence(C); g.update(at(0, 0)); assert.equal(g.update(at(900, 60e3)).type, 'exit'); });
test('long blind gap → inferred midpoint', () => {
  const g = new Geofence(C); g.update(at(0, 0));
  const e = g.update(at(2000, 40 * 60e3, 10));
  assert.equal(e.inferred, true); assert.equal(e.t, 20 * 60e3);
});
test('still → long GPS delay; walking near edge → short', () => {
  assert.ok(nextFixDelay({ marginM: -30, motion: 'still', stillForMs: 5 * 60e3 }) >= 10 * 60e3);
  assert.ok(nextFixDelay({ marginM: -30, motion: 'walk', stillForMs: 0 }) <= 30e3);
});

console.log('analytics');
const day = '2026-11-23';
const g = generateDay(day, 42);
const r = analyzeDay({ day, ...g, settings: { startHour: 8, endHour: 18, restMinutes: 20 }, now: Infinity });
test('grid covers 600 minutes', () => assert.equal(r.grid.length, 600));
test('coverage reflects background gap', () => assert.ok(r.coverage > 0.85 && r.coverage < 0.99, `coverage ${r.coverage}`));
test('steps plausible', () => assert.ok(r.steps > 1500 && r.steps < 20000, `steps ${r.steps}`));
test('rests found', () => assert.ok(r.rests.length >= 2, `rests ${r.rests.length}`));
test('fence trips', () => {
  assert.ok(r.fence && r.fence.trips.length >= 2, JSON.stringify(r.fence?.trips?.length));
  assert.ok(r.fence.trips[0].startedOutside);
  assert.ok(r.fence.outsideMs > 30 * 60e3);
});
test('insights generated', () => assert.ok(r.insights.length >= 4));
test('score 0–100', () => assert.ok(r.activityScore >= 0 && r.activityScore <= 100));
console.log(`\n${pass} passed`);
console.log({ steps: r.steps, activeMin: r.activeMin, score: r.activityScore, rests: r.rests.length, exits: r.fence.exits, outside: Math.round(r.fence.outsideMs / 60e3), insights: r.insights.map((i) => i.text) });
