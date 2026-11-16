# Bonus round B01: the magic chicken bake gamble adventure

You are one of several independent implementers. Work alone, and don't look for other implementations.

**Make a small but high-quality game: a "magic chicken bake gamble adventure".** Interpreting that title is part of the task: what is magic, what gets baked, what the gamble is, and where the adventure goes. Pick one strong, coherent idea and execute it really well. Keep the scope small, polished and fun rather than big and shallow: a complete loop that a player enjoys for 10–20 minutes and wants to replay.

## Requirements
- **Location:** everything goes in `bonus/chicken/`. Do not touch anything else in the repo (especially not `game/`, `docs/`, `rounds/`, `tools/`, `evidence/`, `video/` or `playtest/`).
- **Runs offline in a browser:** double-clicking `bonus/chicken/index.html` must start the game in a current Chrome or Edge, with no build step, no server and nothing loaded from the network.
  - Plain HTML, CSS and JS (ES modules are fine if they work from `file://`; otherwise a single bundled script).
  - You may use a build step while developing, but commit the built, playable output.
- **All art and audio made in code:** canvas, SVG, CSS, WebAudio, procedural generation. No downloaded or hand-made image or sound files.
- **Quality bar:**
  - a clear goal, meaningful choices and real risk/reward in the gamble;
  - a satisfying ending (win and/or lose) and a reason to replay;
  - readable UI, juicy feedback (animation, sound) and a mute toggle;
  - it works with mouse and keyboard, scales to common window sizes, and has no console errors.
- **README:** add a short `bonus/chicken/README.md` with the pitch (2–3 sentences), how to play, and the controls.

## Checks
- Play through it yourself in a headless browser if you can (e.g. Playwright via `npx`, with caches on D:), including at least one full run to an ending, and fix what you find.
- Do not leave browsers, servers or other processes running. Keep caches on drive D: (C: is nearly full).
- Never read anything under `%USERPROFILE%\.t3\` or any credential/token files.

**Commit** your finished work on your current branch, then reply in ≤8 lines: the pitch, the core loop, how you tested it, and any known issues.
