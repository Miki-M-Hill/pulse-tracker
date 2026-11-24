// Hand-built SVG/HTML charts. Every chart returns an HTML string; animation is CSS-driven
// (see styles: .draw, .grow, .sweep) so charts reveal when their section scrolls into view.

import { CLASS_META } from '../sensors/features.js';
import { clock, duration, hourLabel, MIN } from '../core/time.js';

export const COLOR = { still: 'var(--c-still)', light: 'var(--c-light)', walk: 'var(--c-walk)', run: 'var(--c-run)', gap: 'var(--c-gap)' };
const LABEL = (c) => CLASS_META[c]?.label ?? 'Not observed';
const f1 = (n) => Math.round(n * 10) / 10;

// ------------------------------------------------------------------ geometry
const polar = (cx, cy, r, deg) => { const a = ((deg - 90) * Math.PI) / 180; return [f1(cx + r * Math.cos(a)), f1(cy + r * Math.sin(a))]; };
function arc(cx, cy, r, a0, a1) {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0} ${y0}A${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

// ------------------------------------------------------------------ day ring
/** Radial "day clock": class arc, intensity sunburst, zone trips and a live now-marker. */
export function dayRing(r, { now = Date.now(), size = 320 } = {}) {
  const c = 160, R = 124;
  const total = r.we - r.ws;
  const ang = (t) => (360 * (t - r.ws)) / total;
  const parts = [];

  parts.push(`<circle cx="${c}" cy="${c}" r="${R}" class="ring-track"/>`);

  // Hour ticks + labels.
  const hours = Math.round(total / 3600000);
  for (let i = 0; i <= hours; i++) {
    if (i === hours) break; // last tick coincides with first
    const a = (360 * i) / hours;
    const [x0, y0] = polar(c, c, R + 12, a);
    const [x1, y1] = polar(c, c, R + 16, a);
    parts.push(`<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" class="ring-tick"/>`);
    const [lx, ly] = polar(c, c, R + 27, a);
    const h = new Date(r.ws + i * 3600000).getHours();
    parts.push(`<text x="${lx}" y="${ly}" class="ring-label" text-anchor="middle" dominant-baseline="central">${hourLabel(h)}</text>`);
  }

  // Class arcs.
  r.segs.forEach((s) => {
    if (s.cls === 'gap') return;
    const a0 = ang(s.start), a1 = Math.max(a0 + 0.6, ang(s.end));
    parts.push(`<path d="${arc(c, c, R, a0, a1)}" class="ring-seg draw" pathLength="1" style="stroke:${COLOR[s.cls]};--d:${f1(a0 / 360)}s" data-tip="<b>${LABEL(s.cls)}</b><br>${clock(s.start)} – ${clock(s.end)} · ${duration(s.end - s.start)}"/>`);
  });

  // Sunburst: 5-minute buckets, length = activity intensity.
  const B = 5;
  for (let i = 0; i < r.grid.length; i += B) {
    const cells = r.grid.slice(i, i + B).filter((x) => x.cls);
    if (!cells.length) continue;
    const count = {};
    cells.forEach((x) => { count[x.cls] = (count[x.cls] || 0) + 1; });
    const dom = Object.entries(count).sort((a, b) => b[1] - a[1] || (b[0] === 'still' ? -1 : 1))[0][0];
    const inten = Math.max(...cells.map((x) => x.intensity));
    const a = (360 * (i + B / 2)) / r.grid.length;
    const len = 3 + inten * 19;
    const [x0, y0] = polar(c, c, R - 16, a);
    const [x1, y1] = polar(c, c, R - 16 - len, a);
    parts.push(`<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" class="ray" style="stroke:${COLOR[dom]};--d:${f1(0.4 + a / 400)}s"/>`);
  }

  // Zone trips — outer thin orbit.
  r.fence?.trips.forEach((t) => {
    const a0 = ang(t.start), a1 = Math.max(a0 + 1, ang(t.end));
    parts.push(`<path d="${arc(c, c, R + 7, a0, a1)}" class="ring-zone draw" pathLength="1" style="--d:${f1(0.6 + a0 / 360)}s" data-tip="<b>Outside zone</b><br>${clock(t.start)} – ${t.ongoing ? 'now' : clock(t.end)} · ${duration(t.duration)}"/>`);
  });

  // Now marker.
  if (now > r.ws && now < r.we) {
    const [x, y] = polar(c, c, R, ang(now));
    parts.push(`<circle cx="${x}" cy="${y}" r="9" class="now-halo"/><circle cx="${x}" cy="${y}" r="5" class="now-dot"/>`);
  }

  return `<svg class="ring" viewBox="0 0 320 320" width="${size}" height="${size}" role="img" aria-label="Activity over the tracking window">${parts.join('')}</svg>`;
}

// ------------------------------------------------------------------ intensity river
const BASE = { still: 0.05, light: 0.32, walk: 0.62, run: 0.86 };

/** Flowing area chart of activity intensity, coloured along time by activity class. */
export function activityRiver(r, { id = 'rv', height = 150 } = {}) {
  const W = 600, H = height, top = 8, bottom = H - 4;
  const n = r.grid.length;
  const x = (m) => f1((m / n) * W);
  const raw = r.grid.map((c) => (c.cls ? BASE[c.cls] + 0.14 * c.intensity : null));
  const k = 4;
  const sm = raw.map((v, i) => {
    if (v == null) return null;
    let s = 0, w = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(n - 1, i + k); j++) if (raw[j] != null) { const wt = 1 - Math.abs(j - i) / (k + 1); s += raw[j] * wt; w += wt; }
    return s / w;
  });
  const y = (v) => f1(bottom - v * (bottom - top));

  // Contiguous runs → closed area paths.
  const runs = [];
  let cur = null;
  sm.forEach((v, i) => {
    if (v == null) { cur = null; return; }
    if (!cur) { cur = []; runs.push(cur); }
    cur.push([i, v]);
  });
  const area = runs.map((run) => {
    const pts = run.map(([i, v]) => `${x(i)} ${y(v)}`).join('L');
    return `M${x(run[0][0])} ${bottom}L${pts}L${x(run[run.length - 1][0] + 1)} ${y(run[run.length - 1][1])}L${x(run[run.length - 1][0] + 1)} ${bottom}Z`;
  }).join('');
  const line = runs.map((run) => 'M' + run.map(([i, v]) => `${x(i)} ${y(v)}`).join('L')).join('');

  // Horizontal gradient following the class segments.
  const stops = r.segs.filter((s) => s.cls !== 'gap').flatMap((s) => {
    const a = ((s.start - r.ws) / (r.we - r.ws)) * 100, b = ((s.end - r.ws) / (r.we - r.ws)) * 100;
    return [`<stop offset="${f1(a)}%" style="stop-color:${COLOR[s.cls]}"/>`, `<stop offset="${f1(b)}%" style="stop-color:${COLOR[s.cls]}"/>`];
  }).join('');

  const gaps = r.segs.filter((s) => s.cls === 'gap' && s.start < r.elapsedEnd).map((s) => {
    const a = ((s.start - r.ws) / (r.we - r.ws)) * W;
    const b = ((Math.min(s.end, r.elapsedEnd) - r.ws) / (r.we - r.ws)) * W;
    return b - a > 2 ? `<rect x="${f1(a)}" y="${top}" width="${f1(b - a)}" height="${bottom - top}" fill="url(#${id}-hatch)" data-tip="Not observed<br>${clock(s.start)} – ${clock(Math.min(s.end, r.elapsedEnd))}"/>` : '';
  }).join('');

  // Hover targets every 10 minutes.
  const hits = [];
  for (let m = 0; m < n; m += 10) {
    const cells = r.grid.slice(m, m + 10);
    const obs = cells.filter((c) => c.cls);
    if (!obs.length) continue;
    const cnt = {};
    obs.forEach((c) => { cnt[c.cls] = (cnt[c.cls] || 0) + 1; });
    const desc = Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([c, v]) => `<i style='background:${COLOR[c]}'></i>${LABEL(c)} ${v}m`).join('<br>');
    const t = r.ws + m * MIN;
    hits.push(`<rect x="${x(m)}" y="0" width="${x(10)}" height="${H}" class="hit" data-tip="<b>${clock(t)} – ${clock(t + 10 * MIN)}</b><br>${desc}"/>`);
  }

  return `<svg class="river" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Activity intensity through the day">
    <defs>
      <linearGradient id="${id}-g" x1="0" x2="${W}" y1="0" y2="0" gradientUnits="userSpaceOnUse">${stops}</linearGradient>
      <linearGradient id="${id}-v" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset=".7" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity=".12"/></linearGradient>
      <mask id="${id}-m"><rect width="${W}" height="${H}" fill="url(#${id}-v)"/></mask>
      <pattern id="${id}-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" class="hatch"/></pattern>
      <clipPath id="${id}-c"><rect class="sweep" width="${W}" height="${H}"/></clipPath>
    </defs>
    ${[0.25, 0.5, 0.75].map((g) => `<line x1="0" x2="${W}" y1="${y(g)}" y2="${y(g)}" class="grid"/>`).join('')}
    ${gaps}
    <g clip-path="url(#${id}-c)">
      <path d="${area}" fill="url(#${id}-g)" mask="url(#${id}-m)"/>
      <path d="${line}" fill="none" stroke="url(#${id}-g)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    </g>
    ${hits.join('')}
  </svg>`;
}

/** HTML hour axis matching a chart spanning [ws, we]. */
export function hourAxis(r, every = 2) {
  const hours = (r.we - r.ws) / 3600000;
  const labels = [];
  for (let i = 0; i <= hours; i += every) {
    const h = new Date(r.ws + i * 3600000).getHours();
    labels.push(`<span style="left:${(i / hours) * 100}%">${hourLabel(h)}</span>`);
  }
  return `<div class="axis">${labels.join('')}</div>`;
}

/** Lanes under the river: zone trips + rest periods, as positioned pills. */
export function lanes(r) {
  const pos = (a, b) => `left:${((a - r.ws) / (r.we - r.ws)) * 100}%;width:${Math.max(0.6, ((b - a) / (r.we - r.ws)) * 100)}%`;
  const rest = r.rests.map((p, i) => `<span class="pill rest grow-x" style="${pos(p.start, p.end)};--i:${i}" data-tip="<b>Rest period</b><br>${clock(p.start)} – ${clock(p.end)} · ${duration(p.end - p.start)}"></span>`).join('');
  const zone = (r.fence?.trips ?? []).map((t, i) => `<span class="pill zone grow-x ${t.inferredStart || t.inferredEnd ? 'inferred' : ''}" style="${pos(t.start, t.end)};--i:${i}" data-tip="<b>Outside zone</b><br>${clock(t.start)} – ${t.ongoing ? 'now' : clock(t.end)} · ${duration(t.duration)}${t.inferredStart || t.inferredEnd ? '<br><em>time estimated</em>' : ''}"></span>`).join('');
  return `<div class="lanes">
    ${r.fence ? `<div class="lane"><label>Away</label><div class="track">${zone}</div></div>` : ''}
    <div class="lane"><label>Rest</label><div class="track">${rest}</div></div>
  </div>`;
}

// ------------------------------------------------------------------ hourly stacks
let uid = 0;
export function hourlyBars(r) {
  const u = `hb${++uid}`;
  const n = r.hours.length;
  const W = 600, H = 190, gap = W / n;
  const bw = Math.min(34, gap * 0.62);
  const order = ['run', 'walk', 'light', 'still'];
  const bars = r.hours.map((h, i) => {
    const x0 = f1(i * gap + (gap - bw) / 2);
    let y0 = H;
    const rects = order.map((c) => {
      const hgt = (h[c] / 60) * (H - 6);
      if (hgt <= 0) return '';
      y0 -= hgt;
      return `<rect x="${x0}" y="${f1(y0)}" width="${f1(bw)}" height="${f1(hgt)}" style="fill:${COLOR[c]}" class="${c === 'still' ? 'dim' : ''}"/>`;
    }).join('');
    const tip = `<b>${hourLabel(h.hour)} – ${hourLabel(h.hour + 1)}</b><br>${order.filter((c) => h[c]).map((c) => `<i style='background:${COLOR[c]}'></i>${LABEL(c)} ${h[c]}m`).join('<br>') || 'Not observed'}`;
    return `<g class="grow" style="--i:${i}" data-tip="${tip}"><rect x="${f1(i * gap)}" y="0" width="${f1(gap)}" height="${H}" class="hit"/><clipPath id="${u}-${i}"><rect x="${x0}" y="6" width="${f1(bw)}" height="${H - 6}" rx="6"/></clipPath><rect x="${x0}" y="6" width="${f1(bw)}" height="${H - 6}" rx="6" class="bar-bg"/><g clip-path="url(#${u}-${i})">${rects}</g></g>`;
  }).join('');
  const labels = r.hours.map((h) => `<span>${hourLabel(h.hour)}</span>`).join('');
  return `<svg class="bars" viewBox="0 0 ${W} ${H}" role="img" aria-label="Minutes per activity, per hour">${bars}</svg><div class="axis even">${labels}</div>`;
}

// ------------------------------------------------------------------ donut
export function donut(minutes, { size = 168 } = {}) {
  const c = 84, R = 66;
  const total = Object.values(minutes).reduce((a, b) => a + b, 0) || 1;
  let a = 0;
  const segs = ['walk', 'run', 'light', 'still'].filter((k) => minutes[k] > 0).map((k, i) => {
    const sweep = (minutes[k] / total) * 360;
    const a0 = a + 1.2, a1 = a + Math.max(1.6, sweep) - 1.2;
    a += sweep;
    return a1 > a0 ? `<path d="${arc(c, c, R, a0, a1)}" class="donut-seg draw" pathLength="1" style="stroke:${COLOR[k]};--d:${0.1 + i * 0.18}s" data-tip="<b>${LABEL(k)}</b><br>${duration(minutes[k] * MIN)} · ${Math.round((minutes[k] / total) * 100)}%"/>` : '';
  });
  return `<svg class="donut" viewBox="0 0 168 168" width="${size}" height="${size}"><circle cx="${c}" cy="${c}" r="${R}" class="ring-track"/>${segs.join('')}</svg>`;
}

// ------------------------------------------------------------------ week trend
export function weekBars(sums, activeDay, { metric = 'score', max } = {}) {
  const W = 600, H = 150, n = sums.length;
  const gap = W / n, bw = Math.min(30, gap * 0.55);
  const vals = sums.map((s) => s[metric] ?? 0);
  const top = max ?? Math.max(1, ...vals);
  const bars = sums.map((s, i) => {
    const v = vals[i];
    const h = Math.max(3, (v / top) * (H - 10));
    const x0 = f1(i * gap + (gap - bw) / 2);
    const fmt = metric === 'steps' ? v.toLocaleString() + ' steps' : metric === 'activeMin' ? `${v} active min` : `Score ${v}`;
    return `<g class="grow" style="--i:${i}" data-tip="<b>${new Date(s.day + 'T12:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</b><br>${fmt}"><rect x="${f1(i * gap)}" width="${f1(gap)}" height="${H}" class="hit"/><rect x="${x0}" y="${f1(H - h)}" width="${f1(bw)}" height="${f1(h)}" rx="${f1(Math.min(8, bw / 2))}" class="wk ${s.day === activeDay ? 'on' : ''}" ${s.observed ? '' : 'opacity=".25"'}/></g>`;
  }).join('');
  const avg = vals.filter((v, i) => sums[i].observed).reduce((a, b, _, arr) => a + b / arr.length, 0);
  const ay = f1(H - (avg / top) * (H - 10));
  const labels = sums.map((s) => `<span class="${s.day === activeDay ? 'on' : ''}">${new Date(s.day + 'T12:00').toLocaleDateString([], { weekday: 'narrow' })}</span>`).join('');
  return `<svg class="bars" viewBox="0 0 ${W} ${H}">${bars}${avg ? `<line x1="0" x2="${W}" y1="${ay}" y2="${ay}" class="avg" vector-effect="non-scaling-stroke"/>` : ''}</svg><div class="axis even">${labels}</div>`;
}

// ------------------------------------------------------------------ heatmap (HTML grid)
export function heatmap(sums, startHour, endHour) {
  const cols = endHour - startHour;
  const rows = sums.map((s) => {
    const cells = s.hours.map((v, i) => `<i style="--v:${v == null ? 0 : f1(0.12 + v * 0.88)}" class="${v == null ? 'na' : ''}" data-tip="<b>${new Date(s.day + 'T12:00').toLocaleDateString([], { weekday: 'short', day: 'numeric' })} · ${hourLabel(startHour + i)}</b><br>${v == null ? 'Not observed' : `${Math.round(v * 100)}% moving`}"></i>`).join('');
    return `<div class="hm-row"><b>${new Date(s.day + 'T12:00').toLocaleDateString([], { weekday: 'short' })}</b>${cells}</div>`;
  }).join('');
  const head = Array.from({ length: cols }, (_, i) => `<span>${i % 2 ? '' : hourLabel(startHour + i)}</span>`).join('');
  return `<div class="heatmap" style="--cols:${cols}"><div class="hm-row hm-head"><b></b>${head}</div>${rows}</div>`;
}

// ------------------------------------------------------------------ sparkline
export function sparkline(values, { w = 120, h = 36, color = 'var(--c-walk)' } = {}) {
  if (values.length < 2) return `<svg width="${w}" height="${h}"></svg>`;
  const max = Math.max(0.3, ...values);
  const pts = values.map((v, i) => `${f1((i / (values.length - 1)) * w)},${f1(h - 3 - (v / max) * (h - 6))}`);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><polyline points="${pts.join(' ')}" fill="none" style="stroke:${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** Gauge for the activity score (semi-circle). */
export function scoreGauge(score, { size = 200 } = {}) {
  const c = 100, R = 82;
  const a1 = -120 + (240 * Math.max(0, Math.min(100, score))) / 100;
  return `<svg class="gauge" viewBox="0 0 200 170" width="${size}" height="${size * 0.85}">
    <defs><linearGradient id="gg" x1="0" x2="1"><stop offset="0" style="stop-color:var(--c-still)"/><stop offset=".55" style="stop-color:var(--c-walk)"/><stop offset="1" style="stop-color:var(--c-light)"/></linearGradient></defs>
    <path d="${arc(c, c, R, -120, 120)}" class="gauge-track"/>
    ${score > 0 ? `<path d="${arc(c, c, R, -120, a1)}" class="gauge-val draw" pathLength="1" stroke="url(#gg)"/>` : ''}
  </svg>`;
}
