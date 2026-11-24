// One-shot geolocation fixes (never watchPosition — a continuous watch keeps the GNSS
// radio hot). Coarse (network/Wi-Fi) fixes are used when far from the fence boundary.

export const geoAvailable = () => 'geolocation' in navigator;

export function getFix({ high = false, timeout = 20_000, maxAge = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!geoAvailable()) return reject(new Error('Geolocation unavailable'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ t: Date.now(), lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      (e) => reject(e),
      { enableHighAccuracy: high, timeout, maximumAge: maxAge },
    );
  });
}

export async function geoPermissionState() {
  try { return (await navigator.permissions.query({ name: 'geolocation' })).state; } catch { return 'prompt'; }
}
