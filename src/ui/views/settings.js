import { icon } from '../icons.js';
import { toast, $ } from '../dom.js';
import { settings } from '../../core/settings.js';
import { db } from '../../core/db.js';
import { seedDemo } from '../../analytics/demo.js';
import { invalidate } from '../../analytics/service.js';
import { clock, dayStart, dayKey } from '../../core/time.js';

const hourOpts = (sel, from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
  .map((h) => `<option value="${h}" ${h === sel ? 'selected' : ''}>${clock(dayStart(dayKey()) + h * 3600000)}</option>`).join('');

export function mountSettings(root, { tracker, query }) {
  const s = settings.get();
  const notif = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  root.innerHTML = `
    <header class="top"><div><p class="eyebrow">Preferences</p><h1>Settings</h1></div></header>

    <section class="card list">
      <h3 class="list-h">${icon('clock')} Tracking window</h3>
      <div class="row-item"><span>Start</span><select id="sh">${hourOpts(s.startHour, 0, 23)}</select></div>
      <div class="row-item"><span>End</span><select id="eh">${hourOpts(s.endHour, 1, 24)}</select></div>
      <div class="row-item"><span>Rest period = still for at least</span><select id="rm">${[10, 15, 20, 30, 45, 60].map((m) => `<option value="${m}" ${m === s.restMinutes ? 'selected' : ''}>${m} min</option>`).join('')}</select></div>
    </section>

    <section class="card list">
      <h3 class="list-h">${icon('bell')} Alerts</h3>
      <div class="row-item"><span>Zone exit/return notifications</span>
        ${notif === 'granted' ? '<em class="ok">On</em>' : notif === 'unsupported' ? `<em>${standalone ? 'Unsupported' : 'Install app first'}</em>` : '<button class="btn small ghost" id="notif">Enable</button>'}</div>
    </section>

    <section class="card list">
      <h3 class="list-h">${icon('sparkle')} Data</h3>
      <button class="row-item btnrow" id="demo">${icon('insights')}<span>Load 2 weeks of sample data</span>${icon('chevR')}</button>
      <button class="row-item btnrow" id="export">${icon('download')}<span>Export my data (JSON)</span>${icon('chevR')}</button>
      <button class="row-item btnrow danger" id="wipe">${icon('trash')}<span>Erase all recorded data</span>${icon('chevR')}</button>
      <p class="sub small">Everything stays on this device. Nothing is uploaded.</p>
    </section>

    <section class="card how">
      <h3 class="list-h">${icon('battery')} How Pulse saves battery</h3>
      <ul>
        <li><b>Only in your window.</b> Sensors are fully off outside ${clock(dayStart(dayKey()) + s.startHour * 3600000)}–${clock(dayStart(dayKey()) + s.endHour * 3600000)}.</li>
        <li><b>Burst sampling.</b> The accelerometer runs for 5 s, then sleeps 15–90 s — longer when you're still.</li>
        <li><b>Motion-gated GPS.</b> No location requests while you're still; while moving, Pulse checks only as often as needed to catch a zone crossing at your pace, and uses coarse Wi‑Fi positioning far from the edge.</li>
      </ul>
      <h3 class="list-h">${icon('info')} What a web app can and can't do</h3>
      <ul>
        <li>Browsers pause web apps that aren't on screen. Pulse marks those gaps as <em>not observed</em> instead of guessing, and re-checks your position the moment you return — zone exits that happened meanwhile are recorded with an <em>estimated</em> time.</li>
        <li>For gap-free tracking, use <b>Pocket mode</b>: a pitch-black screen that keeps the app awake (OLED pixels are off, so it costs little).</li>
        <li>Add Pulse to your home screen for full-screen use and notifications.</li>
      </ul>
    </section>
    <p class="foot">Pulse · v1.0</p>
  `;

  const num = (id) => Number($(id, root).value);
  $('#sh', root).addEventListener('change', async () => {
    if (num('#sh') >= s.endHour) { toast('Start must be before end'); $('#sh', root).value = s.startHour; return; }
    await settings.set({ startHour: num('#sh') }); invalidate(); s.startHour = num('#sh'); toast('Window updated');
  });
  $('#eh', root).addEventListener('change', async () => {
    if (num('#eh') <= s.startHour) { toast('End must be after start'); $('#eh', root).value = s.endHour; return; }
    await settings.set({ endHour: num('#eh') }); invalidate(); s.endHour = num('#eh'); toast('Window updated');
  });
  $('#rm', root).addEventListener('change', async () => { await settings.set({ restMinutes: num('#rm') }); invalidate(); toast('Saved'); });
  $('#notif', root)?.addEventListener('click', async () => { await Notification.requestPermission(); mountSettings(root, { tracker, query: '' }); });

  const loadDemo = async () => {
    toast('Generating sample days…');
    const fence = await seedDemo(db, 14);
    if (!settings.get().fence) await settings.set({ fence });
    invalidate();
    toast('Sample data loaded');
    location.hash = `#/insights/${dayKey()}`;
  };
  const askDemo = () => confirm('Load two weeks of realistic sample data so you can explore the analytics? This replaces anything recorded in the last 14 days.');
  $('#demo', root).addEventListener('click', () => { if (askDemo()) loadDemo(); });
  $('#export', root).addEventListener('click', async () => {
    const days = await db.days('samples');
    const out = { exported: new Date().toISOString(), settings: settings.get(), days: {} };
    for (const d of days) out.days[d] = { samples: await db.byDay('samples', d), fixes: await db.byDay('fixes', d), fence: await db.byDay('fence', d), coverage: await db.byDay('coverage', d) };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' }));
    a.download = `pulse-export-${dayKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  $('#wipe', root).addEventListener('click', async () => {
    if (!confirm('Erase all recorded activity and zone history from this device? This cannot be undone.')) return;
    await db.clearAll(); invalidate(); toast('All data erased');
  });

  if (query === 'demo') {
    if (askDemo()) loadDemo(); else history.replaceState(null, '', '#/settings');
  }
}
