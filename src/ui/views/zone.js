import { icon } from '../icons.js';
import { esc, toast, $ } from '../dom.js';
import { settings } from '../../core/settings.js';
import { getFix } from '../../sensors/location.js';
import { reportFor } from '../../analytics/service.js';
import { dayKey, duration, clock } from '../../core/time.js';

const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/';
let leafletP;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  leafletP ??= new Promise((res, rej) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = LEAFLET + 'leaflet.css';
    document.head.append(css);
    const s = document.createElement('script');
    s.src = LEAFLET + 'leaflet.js';
    s.onload = () => res(window.L);
    s.onerror = () => rej(new Error('Map failed to load (offline?)'));
    document.head.append(s);
  });
  return leafletP;
}

const STEPS = [50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000];
const fmtR = (m) => (m >= 1000 ? `${(m / 1000).toFixed(m % 1000 ? 1 : 0)} km` : `${m} m`);

export function mountZone(root, { tracker }) {
  const s = settings.get();
  const draft = { ...(s.fence ?? { radius: 200, name: 'Home base' }) };
  let map, circle, marker, me;

  root.innerHTML = `
    <header class="top"><div><p class="eyebrow">Geofence</p><h1>Your zone</h1></div></header>
    <section class="card map-card">
      <div id="map" class="map"><div class="map-loading">${icon('zone')}<span>Loading map…</span></div></div>
      <button class="fab" id="locate" aria-label="Centre on my location">${icon('crosshair')}</button>
      <div class="map-badge" id="rbadge">${fmtR(draft.radius)}</div>
    </section>
    <section class="card form">
      <label class="field"><span>Name</span><input id="zname" maxlength="32" value="${esc(draft.name || '')}" placeholder="Home, Office…"></label>
      <label class="field"><span>Radius <b id="rval">${fmtR(draft.radius)}</b></span>
        <input id="zrad" type="range" min="0" max="${STEPS.length - 1}" step="1" value="${nearest(draft.radius)}">
        <span class="ticks"><i>50 m</i><i>500 m</i><i>5 km</i></span>
      </label>
      <p class="sub small">${icon('info')} Tap the map to move the centre. Larger zones (150 m+) give more reliable exits — phone GPS is typically accurate to 5–30 m outdoors.</p>
      <div class="row">
        <button class="btn primary" id="save">${icon('target')}${s.fence ? 'Update zone' : 'Save zone'}</button>
        ${s.fence ? `<button class="btn ghost" id="remove">${icon('trash')}Remove</button>` : ''}
      </div>
    </section>
    <section id="zone-today"></section>
  `;

  const setRadius = (m) => {
    draft.radius = m;
    $('#rval', root).textContent = fmtR(m);
    $('#rbadge', root).textContent = fmtR(m);
    circle?.setRadius(m);
  };
  $('#zrad', root).addEventListener('input', (e) => setRadius(STEPS[+e.target.value]));

  const center = (lat, lng, zoom) => {
    draft.lat = lat; draft.lng = lng;
    marker?.setLatLng([lat, lng]);
    circle?.setLatLng([lat, lng]);
    if (map && zoom) map.setView([lat, lng], zoom);
    if (map) map.fitBounds(circle.getBounds(), { padding: [30, 30], maxZoom: 17 });
  };

  async function locate(useAsCenter) {
    try {
      $('#locate', root).classList.add('busy');
      const f = await getFix({ high: true, timeout: 15000, maxAge: 5000 });
      if (me) me.setLatLng([f.lat, f.lng]).setRadius(f.acc);
      if (useAsCenter || draft.lat == null) center(f.lat, f.lng, 16);
    } catch (e) {
      toast(e.code === 1 ? 'Location permission denied' : 'Could not get your location');
    } finally { $('#locate', root)?.classList.remove('busy'); }
  }

  loadLeaflet().then((L) => {
    if (!root.isConnected) return;
    const start = draft.lat != null ? [draft.lat, draft.lng] : [51.505, -0.09];
    map = L.map($('#map', root), { zoomControl: false, attributionControl: true }).setView(start, draft.lat != null ? 16 : 3);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      className: 'dark-tiles',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    circle = L.circle(start, { radius: draft.radius, color: '#4CC9F0', weight: 2, fillColor: '#4CC9F0', fillOpacity: 0.12, className: 'fence-circle' }).addTo(map);
    marker = L.marker(start, { draggable: true, icon: L.divIcon({ className: 'fence-pin', html: '<i></i>', iconSize: [26, 26] }) }).addTo(map);
    me = L.circle(start, { radius: 0, color: '#fff', weight: 1, fillColor: '#fff', fillOpacity: 0.15, interactive: false }).addTo(map);
    marker.on('drag', (e) => { const p = e.target.getLatLng(); draft.lat = p.lat; draft.lng = p.lng; circle.setLatLng(p); });
    map.on('click', (e) => center(e.latlng.lat, e.latlng.lng));
    $('.map-loading', root)?.remove();
    if (draft.lat != null) map.fitBounds(circle.getBounds(), { padding: [30, 30], maxZoom: 17 });
    const lf = tracker.status.lastFix;
    if (lf) me.setLatLng([lf.lat, lf.lng]).setRadius(lf.acc);
    else locate(draft.lat == null);
  }).catch((e) => { $('.map-loading span', root).textContent = e.message; });

  $('#locate', root).addEventListener('click', () => locate(true));
  $('#save', root).addEventListener('click', async () => {
    if (draft.lat == null) return toast('Pick a centre on the map first');
    draft.name = $('#zname', root).value.trim() || 'My zone';
    await settings.set({ fence: { lat: draft.lat, lng: draft.lng, radius: draft.radius, name: draft.name } });
    toast(`Zone “${draft.name}” saved`);
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
    if (!settings.get().armed) setTimeout(() => { location.hash = '#/today'; }, 600);
  });
  $('#remove', root)?.addEventListener('click', async () => {
    await settings.set({ fence: null });
    toast('Zone removed');
    mountZone(root, { tracker });
  });

  (async () => {
    if (!s.fence) return;
    const r = await reportFor(dayKey(), { fresh: true });
    const f = r.fence;
    const el = $('#zone-today', root);
    if (!el || !f) return;
    el.innerHTML = `<div class="card">
      <p class="eyebrow">Today</p><h3>${f.exits} departure${f.exits === 1 ? '' : 's'} · ${duration(f.outsideMs, { short: true })} away</h3>
      <ol class="trips compact">${f.trips.map((t) => `<li><span class="dot ${t.ongoing ? 'live' : ''}"></span><div><b>${t.startedOutside ? 'Start' : clock(t.start)} → ${t.ongoing ? 'now' : clock(t.end)}</b><span class="sub">${duration(t.duration)}</span></div></li>`).join('') || '<li class="empty">No trips yet today.</li>'}</ol>
    </div>`;
  })();

  return () => { map?.remove(); };
}

function nearest(m) {
  let best = 0;
  STEPS.forEach((v, i) => { if (Math.abs(v - m) < Math.abs(STEPS[best] - m)) best = i; });
  return best;
}
