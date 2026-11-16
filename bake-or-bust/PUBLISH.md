# Publishing Bake or Bust!

The complete deployable site is exactly these ten files (preserve the `js/` directory):

```text
index.html
style.css
icon.svg
manifest.webmanifest
social.svg
js/rules.js
js/audio.js
js/art.js
js/fx.js
js/game.js
```

Run `pwsh -File bonus/chicken/dev/package-site.ps1` from the repository root to
create `bonus/chicken/site/`, an ignored, allowlisted artifact containing only
those files. Upload the **contents of `site/`** as the GitHub Pages artifact, or
copy those contents into the chosen Pages branch. Do not publish the whole
repository or the source `bonus/chicken/` directory. `dev/`, test scripts,
`docs/`, `README.md`, `PUBLISH.md`, and `.gitignore` are not deployed.

All URLs resolve relative to `index.html`, so any HTTPS sub-path works without
configuration. No dependencies, remote fonts, downloads, fetches, build step,
or service worker are needed. Opening `index.html` directly with `file://`
also plays fully offline. The manifest is used only by HTTP(S) browser app
installation; file viewers may ignore it. There is no persistent worker cache
to serve stale deploys; use the host's normal revalidation policy.

The favicon, manifest icon and optional social card are original SVG code.
Social crawlers vary in relative-URL/SVG support; the title and description
still work when a crawler does not render the SVG card.

Phones/tablets use a reflowed layout, safe-area padding, scrollable content,
and fixed-in-layout Draw/Serve controls with current puff, heat and burn risk.
Tap passive info (eggs, charms, stats); hold an actionable card for half a second
to inspect its tooltip without activating it. Scroll inside the content rather
than the page. Keyboard shortcuts and the illustrated desktop stage remain.

Verification (Chrome installed; npm, browser profiles and caches on D:):

```powershell
$env:NODE_PATH = '<local cache dir>'
$env:TEMP = $env:TMP = '<local cache dir>'
npx --cache <local cache dir> --yes --package playwright-core -- node bonus/chicken/dev/mobile-web-check.cjs
npx --cache <local cache dir> --yes --package playwright-core -- node bonus/chicken/dev/audio-check.cjs
```

`mobile-web-check.cjs` owns its temporary local sub-path server and headless
browser and closes both in `finally`. It checks touch portrait/landscape,
tablets, desktop, HTTP and file URLs. Emulation cannot replace a final on-device
Safari/Chrome check of hardware audio and browser safe areas.
