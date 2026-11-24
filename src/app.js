import { settings } from './core/settings.js';
import { Tracker } from './core/tracker.js';
import { icon } from './ui/icons.js';
import { installTooltips, $ } from './ui/dom.js';
import { mountToday } from './ui/views/today.js';
import { mountInsights } from './ui/views/insights.js';
import { mountZone } from './ui/views/zone.js';
import { mountSettings } from './ui/views/settings.js';

const ROUTES = {
  today: { mount: mountToday, label: 'Today', icon: 'today' },
  insights: { mount: mountInsights, label: 'Insights', icon: 'insights' },
  zone: { mount: mountZone, label: 'Zone', icon: 'zone' },
  settings: { mount: mountSettings, label: 'Settings', icon: 'settings' },
};

let cleanup = null;
let tracker;

function parseHash() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [name, ...params] = path.split('/');
  return { name: ROUTES[name] ? name : 'today', params, query };
}

function route() {
  const { name, params, query } = parseHash();
  const view = $('#view');
  cleanup?.();
  view.classList.remove('settled');
  view.className = `view view-${name}`;
  view.innerHTML = '';
  // Restart the enter animation.
  void view.offsetWidth;
  view.classList.add('enter');
  cleanup = ROUTES[name].mount(view, { tracker, params, query }) || null;
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.r === name));
  window.scrollTo({ top: 0 });
}

function renderTabs() {
  $('#tabs').innerHTML = Object.entries(ROUTES).map(([k, r]) => `<a href="#/${k}" data-r="${k}">${icon(r.icon)}<span>${r.label}</span></a>`).join('');
}

async function boot() {
  await settings.load();
  if (settings.get().pocketMode) await settings.set({ pocketMode: false }); // overlay doesn't survive reloads
  tracker = new Tracker();
  await tracker.init();
  renderTabs();
  installTooltips();
  window.addEventListener('hashchange', route);
  route();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  // Ask the browser not to evict our IndexedDB under storage pressure.
  navigator.storage?.persist?.().catch(() => {});
}

boot();
