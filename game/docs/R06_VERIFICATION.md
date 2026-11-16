# R06 verification — 15 November 2026

Windows 11, Node 24.19.0, Electron 45.3.2; dependencies, caches, build output and test
profiles on D:. Clean run (`node_modules`, `sidecar/node_modules` and `dist` deleted first):

| Check | Result |
| --- | --- |
| `npm ci` | exit 0 |
| `npm run typecheck` | exit 0 (main, renderer, e2e and the vendored sidecar) |
| `npm run build` | exit 0 |
| `npm test` | exit 0 — **82 tests** in 8 files |
| `npm run e2e` | exit 0 — **17 scenarios**: all 14 earlier ones plus 3 new |
| `npm start` (`scripts/check-start.mjs`) | main menu rendered; app and children closed, exit 0 |

A process inventory afterwards found no game, Electron or sidecar processes left.

## New coverage

- **Extension API** (`tests/extension.test.ts`, `tests/engine.test.ts`): loading real ES
  modules from a workspace; declarative + imperative registration; hooks across combat
  (matchups, passives, status hooks, XP/levels, loot, quests, custom objectives, capture);
  campaign commands, `module:installed`, `narrator:context`, `battle:resolved`; the three
  example settings register structurally different systems (catch objective + storage UI;
  levels, skill store and a non-grid duel mode; day loop, homestead map generator, dawn
  objective) with no sword/lance/axe/bow/tome.
- **Error isolation and repair**: syntax errors, throwing `setup`, missing default export,
  runtime faults in hooks and abilities — rolled back, module switched off, command retried,
  play continues; rewriting the file clears the fault. With the scripted provider through the
  real sidecar (`tests/director.test.ts`): a helper's broken module is repaired automatically,
  a runtime fault during battle start triggers a repair, repairs give up after two attempts
  with a visible message, provider failure offers Retry. The **watchdog** kills a worker
  stuck in a generated infinite loop, quarantines the module and reopens the campaign.
- **Scale**: 96 units (44 vs 52) on 56×40 — selection + threat 26 ms, AI phases 38–140 ms.
  Also 104 units / 3 factions on 64×48 construct correctly.
- **Campaign round-trip across battles**: catch battle → capture joins roster → storage
  commands → second battle → retreat → mid-third-battle restart: campaign, chat and battle
  hash identical after reopening; Turnwheel works after the restart; `module:installed`
  does not run twice.
- **Turnwheel with generated code**: three rewinds restore module state, inventory and RNG
  position; identical commands reproduce identical hashes; no charge refunds.
- **Sound**: settings persistence/clamping, mute and calm buses, cue → sound mapping for
  every engine cue, per-step caps for huge phases, adaptive mood selection (story, tense,
  battle, danger, victory), deterministic sequencer, clamped module recipes and themes.
- **Narrator/helper loop**: opening establishes world state; a helper builds a system while
  the player keeps chatting; a 40×28, 38-unit battle with generated templates starts after
  helpers finish; the result is narrated back; long chats are folded into a summary.

## New E2E (`e2e/campaign.e2e.ts`, scripted fake provider)

1. Setting → Narrator chat → a helper builds creature catching with a Creature Box UI while
   a second message is answered → the Narrator starts a 40×28 battle with 38 units, the
   generated weapons (Thornwood Crook, Snare Sling) and the Throw Snare Orb ability → board
   selection, forecast, other-faction replay → result feeds back → second battle in the same
   campaign → quit mid-battle, relaunch, Continue → identical hash, Turnwheel, retreat,
   aftermath.
2. The System setting builds levels/skills/quests UI and plays a **non-grid** Battle Net duel.
3. Audio settings persist; Providers & Models shows and persists Narrator/Helper slots.

Screenshots: `campaign-lobby`, `story-chat`, `story-activity`, `creature-box`,
`system-interface`, `world-battle`, `world-forecast`, `world-enemy-phase`,
`world-battle-end`, `net-duel` (plus the earlier gallery).

Live generation: see [LIVE_RUNS.md](LIVE_RUNS.md) (10 of 10 allowed calls used).
