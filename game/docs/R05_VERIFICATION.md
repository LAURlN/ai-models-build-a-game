# R05 verification — 14 November 2026

Verified on Windows with Node 24.19.0 and the pinned Electron 45.3.2.

| Check | Result |
| --- | --- |
| Fresh `npm ci` | Exit 0; dependencies, download caches and build output on D: |
| `npm run typecheck` | Exit 0, including the vendored sidecar |
| `npm run build` | Exit 0; also rebuilt by test and E2E scripts |
| `npm test` | 53 tests passed across 4 files |
| `npm run e2e` | 14 scenarios passed |
| `npm start` | Main menu rendered; app and descendants closed normally, exit 0 |

E2E covers native/scaled cell targeting, immediate and bump attacks, forecast RNG
invariance, abilities, save/relaunch/load hashes, Turnwheel's nonrefundable ledger,
enemy replay/Skip, provider preferences, fake generation, local fallback, victory,
defeat, terminal-state freezing, Electron security and forced process cleanup.
The new scenarios cover the ten-screen gallery, OS/explicit reduced motion,
preference persistence, identical full/reduced-motion resolution, keyboard input,
and 960×680, 1280×720 and 1920×1080 content sizes.

The visible 1920×1080 ambient board sampled 90 frame callbacks: median **16.7 ms**,
p95 **16.8 ms**. This is foreground callback cadence on the shared test machine,
not a dedicated GPU stress benchmark. Hidden Windows windows were observed at
roughly one callback per second, so frame-sensitive tests show their windows
without taking focus and close them afterward.

All generation used the fake provider or Local Fallback. No live provider requests
were run. A final process inventory found no remaining task game/sidecar processes.

The kernel still exposes plain, cover and wall terrain. Art represents those rules
and unit debt/status hazards; it does not invent elevation or map-hazard mechanics.
FULL-sync SQLite durability is unchanged. Startup and disk-backed worker waits are
bounded but allow for busy-drive latency; the pure forecast watchdog remains 5 s.
