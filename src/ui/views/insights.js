import { icon } from '../icons.js';
import { activityRiver, hourAxis, lanes, hourlyBars, donut, weekBars, heatmap, scoreGauge, COLOR } from '../charts.js';
import { reveal, $, $$ } from '../dom.js';
import { reportFor, recentSummaries, daysWithData } from '../../analytics/service.js';
import { settings } from '../../core/settings.js';
import { dayKey, shiftDay, prettyDay, clock, duration, MIN } from '../../core/time.js';
import { CLASS_META } from '../../sensors/features.js';

function headline(r) {
  if (!r.observed) return ['No data for this day', 'Start tracking or load a sample day from Settings.'];
  const s = r.activityScore;
  const tone = s >= 80 ? 'A vibrant, well-moved day' : s >= 60 ? 'A balanced day' : s >= 40 ? 'A steady, desk-heavy day' : 'A quiet, restful day';
  const bits = [];
  if (r.peakWindow) bits.push(`peaking around ${clock(r.peakWindow.start)}`);
  if (r.fence?.exits) bits.push(`${r.fence.exits} trip${r.fence.exits > 1 ? 's' : ''} out`);
  if (r.rests.length) bits.push(`${r.rests.length} rest period${r.rests.length > 1 ? 's' : ''}`);
  return [tone, bits.length ? bits.join(' · ') : ''];
}

export function mountInsights(root, { params }) {
  let alive = true;
  let metric = 'score';
  const day = params[0] && /^\d{4}-\d{2}-\d{2}$/.test(params[0]) ? params[0] : dayKey();

  (async () => {
    const s = settings.get();
    const [r, week, fortnight, days] = await Promise.all([reportFor(day), recentSummaries(day, 7), recentSummaries(day, 14), daysWithData()]);
    if (!alive) return;
    const [title, sub] = headline(r);
    const isToday = day === dayKey();
    const chips = [...new Set([dayKey(), ...days])].sort().reverse().slice(0, 21);
    const total = r.observed || 1;

    root.innerHTML = `
      <header class="top">
        <div><p class="eyebrow">${isToday ? 'Live report · updates as you go' : 'Day report'}</p><h1>Insights</h1></div>
      </header>

      <nav class="day-nav">
        <a class="round" href="#/insights/${shiftDay(day, -1)}" aria-label="Previous day">${icon('chevL')}</a>
        <div class="chips">${chips.map((d) => `<a class="chip ${d === day ? 'on' : ''}" href="#/insights/${d}">${d === dayKey() ? 'Today' : new Date(d + 'T12:00').toLocaleDateString([], { weekday: 'short', day: 'numeric' })}</a>`).join('')}</div>
        <a class="round ${isToday ? 'disabled' : ''}" href="#/insights/${isToday ? day : shiftDay(day, 1)}" aria-label="Next day">${icon('chevR')}</a>
      </nav>

      <section class="card hero reveal">
        <div class="gauge-wrap">
          ${scoreGauge(r.activityScore)}
          <div class="gauge-center"><span class="big" data-count="${r.activityScore}">0</span><span class="lbl">score</span></div>
        </div>
        <p class="eyebrow">${prettyDay(day)}</p>
        <h2>${title}</h2>
        <p class="sub">${sub}</p>
      </section>

      ${r.observed ? `
      <section class="kpis reveal">
        ${kpi('steps', 'Steps', r.steps, '', 'walk')}
        ${kpi('walk', 'Active', r.activeMin, 'dur', 'walk')}
        ${kpi('light', 'On your feet', r.minutes.light, 'dur', 'light')}
        ${kpi('still', 'Still', r.minutes.still, 'dur', 'still')}
        ${kpi('couch', 'Rest periods', r.rests.length, '', 'still')}
        ${kpi('stand', 'Get-ups', r.moveBreaks, '', 'light')}
      </section>

      ${r.insights.length ? `
      <section class="reveal">
        <h3 class="sec">${icon('sparkle')} Highlights</h3>
        <div class="insights">${r.insights.map((x, i) => `
          <article class="insight" style="--tone:${toneColor(x.tone)};--i:${i}">
            <span class="in-ic">${icon(x.icon)}</span><b>${x.title}</b><p>${x.text}</p>
          </article>`).join('')}</div>
      </section>` : ''}

      <section class="card reveal">
        <div class="card-head"><div><p class="eyebrow">Timeline</p><h3>The shape of your day</h3></div></div>
        <div class="river-wrap tall">${activityRiver(r, { id: 'ins', height: 180 })}</div>
        ${hourAxis(r)}
        ${lanes(r)}
        <div class="legend">${['still', 'light', 'walk', 'run'].map((c) => `<span><i style="background:${COLOR[c]}"></i>${CLASS_META[c].label}</span>`).join('')}<span><i class="hatch-sw"></i>Not observed</span></div>
      </section>

      <section class="card reveal">
        <div class="card-head"><div><p class="eyebrow">Hour by hour</p><h3>When you moved</h3></div>
        ${r.peakHour ? `<span class="tag" style="--pc:var(--c-walk)">Peak ${clock(new Date(2000, 0, 1, r.peakHour.hour).getTime())}</span>` : ''}</div>
        ${hourlyBars(r)}
      </section>

      <section class="grid2">
        <div class="card reveal">
          <p class="eyebrow">Composition</p><h3>Your mix</h3>
          <div class="donut-wrap">${donut(r.minutes)}<div class="donut-center"><b>${duration(r.observed * MIN, { short: true })}</b><span>observed</span></div></div>
          <ul class="mix">${['walk', 'run', 'light', 'still'].filter((c) => r.minutes[c]).map((c) => `<li><i style="background:${COLOR[c]}"></i>${CLASS_META[c].label}<b>${Math.round((r.minutes[c] / total) * 100)}%</b></li>`).join('')}</ul>
        </div>
        <div class="card reveal">
          <p class="eyebrow">Daily rhythm</p><h3>Movement per hour</h3>
          <div class="rhythm">${rhythm(r)}</div>
          <p class="sub small">Coverage ${Math.round(r.coverage * 100)}% of ${duration(r.elapsedMin * MIN, { short: true })}</p>
        </div>
      </section>

      <section class="card reveal">
        <div class="card-head"><div><p class="eyebrow">Recovery</p><h3>Rest periods</h3></div><span class="tag" style="--pc:var(--c-still)">≥ ${s.restMinutes} min still</span></div>
        ${r.rests.length ? `<ol class="rests">${r.rests.map((p, i) => {
          const len = p.end - p.start;
          const max = Math.max(...r.rests.map((x) => x.end - x.start));
          return `<li style="--i:${i}"><span class="t">${clock(p.start)}</span><span class="bar"><i class="grow-x" style="width:${(len / max) * 100}%;--i:${i}"></i></span><b>${duration(len, { short: true })}</b></li>`;
        }).join('')}</ol>` : '<p class="empty">No rest stretches long enough yet.</p>'}
      </section>

      ${zoneSection(r, s)}
      ` : `
      <section class="card empty-state reveal">
        <div class="cta-orb">${icon('insights')}</div>
        <h3>Nothing recorded${isToday ? ' yet' : ''}</h3>
        <p class="sub">${isToday ? 'Once tracking runs for a little while, your report fills in here live.' : 'Pulse didn’t sense anything on this day.'}</p>
        <a class="btn ghost" href="#/settings?demo">${icon('sparkle')}Load sample days</a>
      </section>`}

      <section class="card reveal">
        <div class="card-head"><div><p class="eyebrow">Trend</p><h3>Last 7 days</h3></div>
          <div class="seg" role="tablist">${[['score', 'Score'], ['steps', 'Steps'], ['activeMin', 'Active']].map(([k, l]) => `<button data-m="${k}" class="${k === metric ? 'on' : ''}">${l}</button>`).join('')}</div>
        </div>
        <div id="week">${weekBars(week, day, { metric })}</div>
        <p class="sub small" id="week-sum">${weekSummary(week, metric)}</p>
      </section>

      <section class="card reveal">
        <div class="card-head"><div><p class="eyebrow">Patterns</p><h3>When you're usually active</h3></div></div>
        ${heatmap(fortnight, s.startHour, s.endHour)}
        <p class="sub small">${patternText(fortnight, s.startHour)}</p>
      </section>
    `;

    reveal(root);
    $$('.seg button', root).forEach((b) => b.addEventListener('click', () => {
      metric = b.dataset.m;
      $$('.seg button', root).forEach((x) => x.classList.toggle('on', x === b));
      $('#week', root).innerHTML = weekBars(week, day, { metric });
      $('#week-sum', root).textContent = weekSummary(week, metric);
    }));
    $('.chip.on', root)?.scrollIntoView({ inline: 'center', block: 'nearest' });
  })();

  return () => { alive = false; };
}

const toneColor = (t) => ({ walk: 'var(--c-walk)', still: 'var(--c-still)', light: 'var(--c-light)', zone: 'var(--c-zone)', run: 'var(--c-run)' }[t] ?? 'var(--muted)');

function kpi(ic, label, value, unit, tone) {
  return `<div class="kpi" style="--pc:var(--c-${tone})"><span class="k-ic">${icon(ic)}</span><b data-count="${value}" ${unit ? `data-unit="${unit}"` : ''}>0</b><span>${label}</span></div>`;
}

function rhythm(r) {
  const rates = r.rhythm.map((p) => ({ ...p, rate: p.value / Math.max(1, p.to - p.from) }));
  const max = Math.max(1, ...rates.map((p) => p.rate));
  return rates.map((p, i) => `<div class="rh"><span>${p.key}</span><div class="rh-bar"><i class="grow-x" style="width:${(p.rate / max) * 100}%;--i:${i}"></i></div><b>${Math.round(p.rate)}m</b></div>`).join('');
}

function zoneSection(r, s) {
  if (!s.fence && !r.fence) {
    return `<a class="card zone-empty reveal" href="#/zone">${icon('target')}<div><h3>Add a zone</h3><p class="sub">Set a geofence to see how often and how long you leave it.</p></div>${icon('chevR')}</a>`;
  }
  const f = r.fence;
  if (!f) return `<section class="card reveal"><p class="eyebrow">Zone</p><h3>${s.fence?.name || 'Your zone'}</h3><p class="empty">No location fixes recorded this day.</p></section>`;
  const span = r.elapsedEnd - r.ws;
  return `
    <section class="card zone-report reveal">
      <div class="card-head"><div><p class="eyebrow">Geofence · ${s.fence?.name || 'Zone'}</p><h3>Coming & going</h3></div></div>
      <div class="zone-split">
        <div class="split-bar"><i class="in" style="width:${(f.insideMs / span) * 100}%"></i><i class="out" style="width:${(f.outsideMs / span) * 100}%"></i></div>
        <div class="split-legend"><span><i class="in"></i>Inside ${duration(f.insideMs, { short: true })}</span><span><i class="out"></i>Away ${duration(f.outsideMs, { short: true })}</span></div>
      </div>
      <div class="zstats">
        <div><b data-count="${f.exits}">0</b><span>departures</span></div>
        <div><b>${f.longest ? duration(f.longest.duration, { short: true }) : '—'}</b><span>longest trip</span></div>
        <div><b>${f.trips.length ? duration(f.avgTrip, { short: true }) : '—'}</b><span>average trip</span></div>
        <div><b>${f.firstExit ? clock(f.firstExit) : '—'}</b><span>first out</span></div>
      </div>
      <ol class="trips">${f.trips.map((t, i) => `
        <li style="--i:${i}">
          <span class="dot ${t.ongoing ? 'live' : ''}"></span>
          <div><b>${t.startedOutside ? 'Arrived' : clock(t.start)} → ${t.ongoing ? 'still away' : t.untilWindowEnd ? 'end of day' : clock(t.end)}</b>
          <span class="sub">${duration(t.duration)} away${t.activeMin ? ` · ${t.activeMin} min walking` : ''}${t.startedOutside ? ' · day began outside' : ''}${t.untilWindowEnd ? ' · still out when tracking ended' : ''}${t.inferredStart || t.inferredEnd ? ' · <em>time estimated</em>' : ''}</span></div>
          <span class="tbar"><i class="grow-x" style="width:${Math.max(4, (t.duration / (f.longest?.duration || 1)) * 100)}%;--i:${i}"></i></span>
        </li>`).join('')}</ol>
    </section>`;
}

function weekSummary(week, metric) {
  const obs = week.filter((w) => w.observed);
  if (!obs.length) return 'No days recorded this week yet.';
  const avg = obs.reduce((a, w) => a + w[metric], 0) / obs.length;
  const best = obs.reduce((b, w) => (w[metric] > b[metric] ? w : b));
  const name = metric === 'steps' ? 'steps' : metric === 'activeMin' ? 'active minutes' : 'score';
  return `Average ${Math.round(avg).toLocaleString()} ${name} · best on ${new Date(best.day + 'T12:00').toLocaleDateString([], { weekday: 'long' })}. Dashed line = average.`;
}

function patternText(sums, startHour) {
  const cols = sums[0]?.hours.length ?? 0;
  const avg = Array.from({ length: cols }, (_, i) => {
    const v = sums.map((s) => s.hours[i]).filter((x) => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  });
  const valid = avg.map((v, i) => [v, i]).filter(([v]) => v != null);
  if (valid.length < 2) return 'Patterns emerge after a few tracked days.';
  const hi = valid.reduce((b, x) => (x[0] > b[0] ? x : b));
  const lo = valid.reduce((b, x) => (x[0] < b[0] ? x : b));
  const h = (i) => clock(new Date(2000, 0, 1, startHour + i).getTime());
  return `Across ${sums.filter((s) => s.observed).length} days you tend to be most active around ${h(hi[1])} and stillest around ${h(lo[1])}.`;
}
