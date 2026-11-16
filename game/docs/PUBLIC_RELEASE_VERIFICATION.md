# Windows public-release verification — 16 November 2026

Verified from a separate clone of `t3/implement-r06-limitless-brief-2`, starting at
`3168560`, then repeated against the committed release changes. Windows 11 x64,
Node 24.19.0, npm 11.17.0, Electron 45.3.2, electron-builder 26.18.0. The requested
external npm cache was used throughout. No live generations or personal provider
profiles were used. The verification clone was updated with the final audit-only
change before packaging; application code was unchanged during the final suite.
The final generic path-pattern cleanup was rechecked against the copied release.

| Command/check in the verification clone | Final result |
| --- | --- |
| `npm ci` | exit 0 |
| `node node_modules/electron/install.js` | exit 0; required after the fresh install omitted the binary |
| `npm run typecheck` | exit 0; main, renderer, E2E and sidecar |
| `npm test` | exit 0; 82 tests in 8 files |
| `npm run build` | exit 0 |
| `npm run e2e` | exit 0; 17 scenarios, 6.6 minutes |
| `npm run dist:win` | exit 0; portable x64 EXE and unpacked app |
| `node scripts/check-start.mjs` (runs `npm start`) | menu rendered; exit 0 |
| `node scripts/check-start.mjs release/Chronicle-Tactics-0.1.0-portable-x64.exe` | menu, native addon, sidecar RPC and SQLite worker passed; exit 0 |
| `node scripts/check-release.mjs` | 98 files passed, including extracted ASAR and all release resources |

The initial baseline also passed 82 tests and 17 E2E scenarios. Its startup check
rendered and exited successfully, but Windows briefly retained a profile handle
during cleanup. The check now retries cleanup for longer; final cleanup passed.
Both unpacked and portable startup checks use unique temporary user-data directories,
the fake provider and a PATH containing only Windows directories. The portable check
runs outside the source directory and verifies that its sidecar base directory is
inside that temporary profile. No Node, npm or compiler is available to the packaged
app through PATH. The sidecar is confirmed dead after the launcher exits.

## Artefacts

The verified clone's release output was copied into the worktree's ignored `release/`:

- `release/Chronicle-Tactics-0.1.0-portable-x64.exe`: **113,105,916 bytes**.
- SHA-256: `aff6b03cc5ea1f22ed07fedc675011da5e0ea4017e9a5feabe3bd2c66b995b91`.
- `release/win-unpacked/Chronicle Tactics.exe`: **250,056,704 bytes**, with its sibling
  runtime/resources required. The portable file above is the standalone distributable.

The release is unsigned and uses Electron's default executable icon. All code is
bundled; development dependencies and source maps are excluded. The sidecar and
native Job Object addon are real files under `resources/runtime/`, so the plain-Node
sidecar child does not need to understand ASAR. Live providers still need their own
CLI/authentication; offline startup needs no development environment.

## Licence provenance and shipped notices

Fetched `LICENSE` through GitHub's contents API at exactly
`e72dd5055eb437c93c0b3ddf710246ecbfe1f16e` in `pingdotgg/t3code`.
It is **MIT**, with **Copyright (c) 2026 T3 Tools Inc.** The vendored and shipped
licence texts match the fetched upstream text (normalizing line endings only).
The server manifest already declared MIT. The sidecar wrapper and ten vendored
package manifests now explicitly declare MIT as well; these previously omitted it.

The release ships:

- `resources/licenses/t3code/LICENSE`, `NOTICE` and `FORK_PATCHES.md`. NOTICE identifies
  the modified headless fork and links its patch ledger. The ledger was checked against
  the structured-generation adapters, fake provider, profile config, RPC authorization,
  stubs and agent mode. Its stale tool-denial claim, adapter path and incomplete RPC
  allowlist description were corrected.
- `resources/licenses/THIRD_PARTY_LICENSES.txt`: full licence/notice texts for the
  **25 npm packages** that contribute bundled code, discovered from esbuild output
  metadata and renderer module information. A missing full licence fails the build.
- `LICENSE.electron.txt` and `LICENSES.chromium.html` alongside the unpacked executable
  (also inside the portable payload).

There are **no bundled font binaries**: Georgia/Times New Roman/Segoe UI/system fonts
are supplied by the OS. Accordingly there are no redistributed fonts requiring OFL
files. The generated notices record this explicitly.

## Hygiene findings

Scanned the source tree and entire release output for the requested identity, path,
delegation, email, token and authorization markers. The release audit also scans UTF-16LE
and extracts `app.asar` before checking it. No local identity/worktree/home paths,
credential-shaped literals, or source-map files remain in the packaged application.

Fixed accidental drive-specific README cache instructions and the live-story output
example; removed drive-specific build/test comments. The packager's generated debug
YAML contained local NSIS/cache paths, so the release script deletes that exact
diagnostic file before auditing. The committed scanner uses generic path patterns
and the current build root, so it does not embed a developer identity itself.

Retained and reviewed legitimate hits:

- `sidecar/apps/server/src/game/FakeProvider.ts`: fake addresses
  `codex-fake@example.local` and `${key}-connected@example.local`.
- `tests/extension.test.ts`: fixture unit ID `husk-1` matches the short token prefix;
  ordinary `task-*`, `disk-*` and `risk-*` strings also match it.
- `sidecar/packages/shared/src/markdownLinks.ts`: illustrative `me@example.com`;
  `cloneUrl.ts` contains SSH URL syntax. Git/provider attribution code contains public
  service bot addresses; dependency metadata/licence texts contain public author emails.
- Upstream `pinnedRuntime.ts` and `fileLinks.ts`: generic Windows-drive examples and
  path-parsing regexes, with no developer identity or actual local build directory.
- Upstream MCP delegation operation names, thread fields and link documentation;
  Bearer authorization implementations, token-redaction regexes and the game's
  authored “Standard Bearer” title. These are functional source/content, not secrets.
- Broad byte scans of Electron binaries, compressed portable data and PAK files
  incidentally match short marker sequences. Electron's embedded Node source also
  documents a bare drive root. These are upstream examples/opcodes/compressed data,
  not build paths. App ASAR and runtime resources contain no developer drive paths.

Final process inventory: **zero task application/sidecar/build processes**.
Verification clone: **deleted after preserving the verified release output**.
