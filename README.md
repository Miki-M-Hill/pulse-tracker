# Pulse — daily motion & geofence tracker (PWA)

Plain ES modules with no build step. Any static host works.

## Run locally
```bash
python3 -m http.server 5178
```
Open http://localhost:5178. Phones need **HTTPS** for motion sensors and location, so deploy it (GitHub Pages, Netlify, Cloudflare Pages) or use a tunnel, then on the phone choose **Add to Home Screen**.

## Tests
```bash
node tests/run.mjs
```

## Architecture
```
src/
  core/       db (IndexedDB), settings, time, geofence (pure state machine), tracker (orchestrator)
  sensors/    features (pure signal processing + classifier), motion (duty-cycled IMU), location
  analytics/  analyze (pure day analytics), service (load + cache), demo (synthetic days)
  ui/         charts (SVG/HTML), dom, icons, views/{today, insights, zone, settings, pocket}
sw.js         offline shell + runtime cache for map tiles/fonts
```

## How battery is saved
- Sensors run only inside the tracking window (8:00–18:00 by default).
- The accelerometer runs in 5 s bursts, 15–90 s apart, with longer gaps while you're still.
- GPS only runs when the accelerometer shows movement. Fix frequency scales with your distance to the zone edge and your pace. Coarse fixes are used when you're far from the edge.

## Platform limits
Browsers suspend web apps that aren't on screen. Pulse records those gaps as *not observed*. When you come back, it re-checks your location right away, and a zone exit that happened in the gap is logged with an *estimated* time. **Pocket mode** keeps the app awake behind a black screen for continuous tracking.
