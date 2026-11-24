import { icon } from '../icons.js';
import { dayRing, activityRiver, hourAxis, lanes, sparkline, COLOR } from '../charts.js';
import { esc, countAll, $ } from '../dom.js';
import { reportFor } from '../../analytics/service.js';
import { settings } from '../../core/settings.js';
import { db } from '../../core/db.js';
import { dayKey, clock, duration, MIN } from '../../core/time.js';
import { CLASS_META } from '../../sensors/features.js';
import { openPocket } from './pocket.js';

const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

function statusPill(st) {
  if (!st.armed) return `<span class="pill-status off">${icon('pause')}Not tracking</span>`;
  if (!st.inWindow) return `<span class="pill-status idle">${icon('moon')}Resumes in ${duration(st.nextWindowIn)}</span>`;
  if (!st.active) return `<span class="pill-status idle">${icon('eye')}Paused in background</span>`;
  const cls = st.motion?.cls;
  return `<span class="pill-status on" style="--pc:${cls ? COLOR[cls] : 'var(--c-walk)'}"><i class="pulse"></i>${cls ? CLASS_META[cls].label : 'Sensing…'}</span>`;
}

export function mountToday(root, { tracker }) {
  let first = true;
  let alive = true;
  let timer;

  async function render() {
    const st = tracker.status;
    const s = settings.get();
    const r = await reportFor(dayKey(), { fresh: true });
    const recent = (await db.byDay('samples', dayKey())).slice(-24);
    const motion = st.motion ?? recent[recent.length - 1];
    const stillFor = st.stillSince ? Date.now() - st.stillSince : null;
    if (!alive) return; // view was replaced while we were loading

    root.innerHTML = `
      <header class="top">
        <div>
          <p class="eyebrow">${new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          <h1>${greet()}</h1>
        </div>
        ${statusPill(st)}
      </header>

      ${!st.armed ? `
      <section class="card hero-cta reveal">
        <div class="cta-orb">${icon('sparkle')}</div>
        <h2>Start sensing your day</h2>
        <p>Pulse samples your phone's motion sensors in short, power-light bursts between <b>${clock(r.ws)}</b> and <b>${clock(r.we)}</b>, then turns them into a picture of how you moved, rested and roamed.</p>
        <button class="btn primary" id="arm">${icon('play')}Start tracking</button>
        <button class="btn ghost small" id="demo">or explore a sample day</button>
      </section>` : ''}

      <section class="card ring-card reveal">
        <div class="ring-wrap">
          ${dayRing(r)}
          <div class="ring-center">
            <span class="big" data-count="${r.activityScore}">0</span>
            <span class="lbl">activity score</span>
          </div>
        </div>
        <div class="trio">
          <div><b data-count="${r.steps}">0</b><span>${icon('steps')}steps</span></div>
          <div><b data-count="${r.activeMin}" data-unit="dur">0</b><span>${icon('walk')}active</span></div>
          <div><b data-count="${r.minutes.still}" data-unit="dur">0</b><span>${icon('still')}still</span></div>
        </div>
      </section>

      <section class="grid2">
        <div class="card live reveal" style="--pc:${motion ? COLOR[motion.cls] : 'var(--muted)'}">
          <p class="eyebrow">${st.active ? 'Right now' : 'Last sensed'}</p>
          <div class="live-ic ${motion?.cls ?? ''}">${icon(motion?.cls ?? 'still')}</div>
          <h3>${motion ? CLASS_META[motion.cls].label : '—'}</h3>
          <p class="sub">${stillFor && stillFor > 2 * MIN ? `still for ${duration(stillFor)}` : motion?.cadence ? `${Math.round(motion.cadence * 60)} steps/min` : motion ? `at ${clock(motion.t)}` : 'no samples yet'}</p>
          ${sparkline(recent.map((x) => x.intensity), { color: motion ? COLOR[motion.cls] : 'var(--muted)' })}
        </div>
        ${zoneCard(st, r, s)}
      </section>

      <section class="card reveal">
        <div class="card-head">
          <div><p class="eyebrow">So far today</p><h3>The shape of your day</h3></div>
          <a class="link" href="#/insights/${r.day}">Full report ${icon('chevR')}</a>
        </div>
        <div class="river-wrap">${activityRiver(r, { id: 'today' })}</div>
        ${hourAxis(r)}
        ${lanes(r)}
        <div class="legend">${['still', 'light', 'walk', 'run'].map((c) => `<span><i style="background:${COLOR[c]}"></i>${CLASS_META[c].label}</span>`).join('')}</div>
      </section>

      ${st.armed ? `
      <section class="card controls reveal">
        <button class="tile" id="pocket">${icon('pocket')}<b>Pocket mode</b><span>Continuous sensing with a black, OLED-dark screen</span></button>
        <button class="tile" id="disarm">${icon('pause')}<b>Stop tracking</b><span>Pause the daily schedule</span></button>
      </section>
      ${st.motionOk === false ? `<p class="note warn">${icon('info')}No motion sensor readings. Open Pulse on your phone (desktop browsers have no accelerometer).</p>` : ''}
      ${st.locationError && s.fence ? `<p class="note warn">${icon('info')}Location: ${esc(st.locationError)}</p>` : ''}` : ''}
      ${r.coverage ? `<p class="foot">Observed ${Math.round(r.coverage * 100)}% of today's window so far</p>` : ''}
    `;

    if (first) {
      root.querySelectorAll('.reveal').forEach((el, i) => { el.style.setProperty('--stagger', i); setTimeout(() => el.classList.add('in'), 20); });
      countAll(root);
      first = false;
    } else {
      root.classList.add('settled');
      root.querySelectorAll('.reveal').forEach((el) => el.classList.add('in'));
      root.querySelectorAll('[data-count]').forEach((el) => {
        const v = Number(el.dataset.count); const u = el.dataset.unit;
        el.textContent = u === 'dur' ? duration(v * MIN, { short: true }) : v.toLocaleString();
      });
    }

    $('#arm', root)?.addEventListener('click', async () => {
      await tracker.arm();
      if (typeof Notification !== 'undefined' && Notification.permission === 'default' && settings.get().fence) Notification.requestPermission();
    });
    $('#demo', root)?.addEventListener('click', () => { location.hash = '#/settings?demo'; });
    $('#disarm', root)?.addEventListener('click', () => tracker.disarm());
    $('#pocket', root)?.addEventListener('click', () => openPocket(tracker));
  }

  let pending = false;
  const schedule = () => { if (pending) return; pending = true; setTimeout(() => { pending = false; render(); }, 250); };
  ['sample', 'fence', 'status'].forEach((e) => tracker.addEventListener(e, schedule));
  timer = setInterval(schedule, 60_000);
  render();
  return () => { alive = false; ['sample', 'fence', 'status'].forEach((e) => tracker.removeEventListener(e, schedule)); clearInterval(timer); };
}

function zoneCard(st, r, s) {
  if (!s.fence) {
    return `<a class="card zone-card empty reveal" href="#/zone">
      <p class="eyebrow">Zone</p>
      <div class="live-ic zone">${icon('target')}</div>
      <h3>Set a zone</h3>
      <p class="sub">Track when you leave, how often and for how long.</p>
    </a>`;
  }
  const f = r.fence;
  const inside = st.inside ?? (f ? !f.trips.some((t) => t.ongoing) : null);
  const dist = st.distance;
  return `<a class="card zone-card reveal ${inside === false ? 'out' : 'in'}" href="#/zone">
    <p class="eyebrow">${esc(s.fence.name || 'Zone')}</p>
    <div class="zone-orb"><i></i><i></i><span>${icon(inside === false ? 'flag' : 'home')}</span></div>
    <h3>${inside == null ? 'Locating…' : inside ? 'Inside' : 'Away'}</h3>
    <p class="sub">${dist != null ? `${dist < 1000 ? Math.round(dist) + ' m' : (dist / 1000).toFixed(1) + ' km'} from centre · ` : ''}${f ? `${f.exits} exit${f.exits === 1 ? '' : 's'} · ${duration(f.outsideMs, { short: true })} away` : 'no exits yet'}</p>
  </a>`;
}
