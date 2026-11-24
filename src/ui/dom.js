export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Animate a number from 0 (or its current value) to `to`. */
export function countUp(el, to, { ms = 1100, fmt = (v) => Math.round(v).toLocaleString() } = {}) {
  if (!el) return;
  const from = Number(el.dataset.v ?? 0);
  el.dataset.v = to;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / ms);
    const e = 1 - Math.pow(1 - p, 4);
    el.textContent = fmt(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function countAll(root) {
  $$('[data-count]', root).forEach((el) => {
    const to = Number(el.dataset.count);
    const unit = el.dataset.unit;
    const fmt = unit === 'dur'
      ? (v) => { const m = Math.round(v); const h = Math.floor(m / 60); return h ? `${h}h ${m % 60}m` : `${m}m`; }
      : unit === 'pct' ? (v) => `${Math.round(v)}%` : undefined;
    countUp(el, to, fmt ? { fmt } : {});
  });
}

/** Reveal sections as they scroll into view (adds .in). */
export function reveal(root) {
  const els = $$('.reveal', root);
  if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.add('in');
      countAll(en.target);
      io.unobserve(en.target);
    });
  }, { threshold: 0.12 });
  els.forEach((e) => io.observe(e));
}

let toastTimer;
export function toast(msg) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.append(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/** Global tooltip for any element carrying data-tip. Works with hover and tap. */
export function installTooltips() {
  const tip = document.createElement('div');
  tip.id = 'tip';
  document.body.append(tip);
  let current = null;
  const show = (el, x, y) => {
    current = el;
    tip.innerHTML = el.dataset.tip;
    tip.classList.add('show');
    const r = tip.getBoundingClientRect();
    const left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x - r.width / 2));
    const top = y - r.height - 14 < 8 ? y + 18 : y - r.height - 14;
    tip.style.transform = `translate(${left}px, ${top}px)`;
  };
  const hide = () => { current = null; tip.classList.remove('show'); };
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (el) show(el, e.clientX, e.clientY); else if (current && e.pointerType === 'mouse') hide();
  });
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (el) show(el, e.clientX, e.clientY); else hide();
  });
  document.addEventListener('scroll', hide, { passive: true, capture: true });
}
