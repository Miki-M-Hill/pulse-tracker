// Pocket mode: a pure-black screen (pixels off on OLED) that holds a wake lock so the
// browser keeps the page — and therefore the sensors — alive while the phone is in
// your pocket. This is the only way a web app can sense continuously on iOS.
import { icon } from '../icons.js';
import { settings } from '../../core/settings.js';
import { clock } from '../../core/time.js';
import { CLASS_META } from '../../sensors/features.js';

export async function openPocket(tracker) {
  await settings.set({ pocketMode: true });
  const el = document.createElement('div');
  el.className = 'pocket';
  el.innerHTML = `<div class="pk-clock"></div><div class="pk-status"></div><p class="pk-hint">${icon('pocket')} Double-tap to exit</p>`;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('show'));

  // Drift the content slowly to avoid OLED burn-in.
  let k = 0;
  const paint = () => {
    const st = tracker.status;
    el.querySelector('.pk-clock').textContent = clock(Date.now());
    el.querySelector('.pk-status').textContent = `${st.motion ? CLASS_META[st.motion.cls].label : 'Sensing'}${st.wakeLock ? '' : ' · screen may sleep'}`;
    k++;
    el.style.setProperty('--dx', `${Math.sin(k / 7) * 24}px`);
    el.style.setProperty('--dy', `${Math.cos(k / 9) * 40}px`);
  };
  paint();
  const iv = setInterval(paint, 20_000);
  tracker.addEventListener('status', paint);

  let last = 0;
  el.addEventListener('pointerup', async () => {
    const now = Date.now();
    if (now - last < 400) {
      clearInterval(iv);
      tracker.removeEventListener('status', paint);
      el.classList.remove('show');
      setTimeout(() => el.remove(), 400);
      await settings.set({ pocketMode: false });
    }
    last = now;
  });
}
