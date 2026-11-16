# Bake or Bust! — a magic chicken bake gamble adventure

**Pitch.** Marigold is a hen in a wizard's hat with a temperamental Wishing Oven, and Baron Velvetpaw the fox has stolen the Golden Egg. Travel through three lands baking for the creatures on the road: every bake is a push-your-luck gamble where you draw magic eggs from your basket for *puff*, while each egg pushes the oven's *heat* toward the point where the bake burns. Build a better basket, win the Baron's three-course Grand Bake, and bring the egg home.

Open `index.html` in Chrome or Edge (double-click works). It runs offline with no build step and no server. All art is procedural SVG and canvas, and all sound and music is synthesized with WebAudio.

Phones and tablets use a reflowed, safe-area-aware layout with 44 px touch targets.
Tap to play; tap eggs, charms and stats for info, or hold a card for half a second
to inspect it without choosing it. Scroll the detail panels while Draw/Serve and
the current puff, heat and risk stay on screen. Audio unlocks on the first tap;
music pauses when the tab is hidden. Desktop mouse and keyboard controls remain.
For GitHub Pages, publish only the ten files listed in [PUBLISH.md](PUBLISH.md),
using the included allowlist packaging script.

## How to play
- **Goal:** clear 3 acts (4 road stops plus a boss each) and pass at least 2 of the Baron's 3 courses. If you run out of hearts, you're bust.
- **Baking:** press **Draw** to pull a random egg from your shuffled basket into the oven. Each egg adds **puff** (score) and most add **heat**. When you've reached the customer's **target puff**, press **Serve**. Every puff above the target is paid as a tip.
- **The gamble:** if heat goes **above your oven's limit**, the bake **burns**. You lose a heart and a Rotten Egg joins your basket. Stopping short also costs a heart, but nothing rots. The right-hand panel shows exactly which eggs are left and your burn chance for the next draw.
- **Orders:** each customer offers Humble, Fancy and Legendary tiers with higher targets and better rewards (feathers, rare eggs), plus an estimated odds bar. Estimates simulate 500 deterministic shuffles with the real draw engine (including all combos, charms, customer heat changes and safety effects): serve at target after any minimum draws, draw at up to 40% burn risk, toss unsafe peeks, and spend no feathers. Many customers have quirks that change the rules.
- **Oven feel:** music gains a subtle tension layer near the heat limit. Special eggs have distinct chimes; draws at 40% or greater burn risk get a quick 180 ms shudder before the egg resolves (the delay is skipped with reduced motion). The oven tray switches to ten columns on deep bakes and scrolls to every new egg.
- **Run recap:** the end screen shows your strongest bake, closest successful call, key stats and a collapsible final basket.
- **Magic feathers** pay for your **three equipped spells**, cast with **F / E / C** in slot order. Start with *Wing Fan* (−2 heat), *Hen's Eye* (peek/toss), and *Golden Cluck* (double the last egg’s puff, once/bake). Six more unlock across runs: Butter Baste (serve 25 orders), Cryo-Cackle (serve at exactly the heat limit), Sleight of Wing (reach Act III), Hearth Surge (win Spice 1+), Wish Egg (hold 16 eggs), and Phoenix Plume (Phoenix save or Act II boss victory). The title **Spellbook** shows costs, effects, unlock hints and your loadout; Randomize picks three unlocked spells. At a nest, Preen can swap one spell and give +1 feather instead of gaining 2 feathers.
- **Combo eggs:** Butter doubles the next egg’s puff; Honeycomb grows with zero-heat/cooling eggs; Cinnamon rewards baking close to the limit; Echo copies the previous egg’s final puff; Meringue rewards drawing at least five eggs first. The oven displays pending multipliers/bonuses, and basket rows preview the exact puff and heat the next egg would produce.
- **Branching upgrades:** Brood at a nest offers up to three base egg types, each with Cool / Steady and Hot / Puffy branches. Blue rims mark Cool; gold crowns mark Hot. Ten base types have branches. Rotten Eggs can instead become Golden Yolks or compost into 8 corn. Market Tempering costs 12 corn, once per visit, and lets you choose any eligible base egg.
- **20 Kitchen Charms** give passive effects for the current run. Buy them at markets, choose one after Act I/II boss victories, or find the Roaming Tinker. Their brass badges sit below the HUD; hover or focus for exact effects. Triggered charms flash and show a floating callout. Builds favor cooling/deep bakes, risky high heat, combos/spells, or corn/tips.
- **Markets:** four eggs (three at Spice 7+), two unowned charms, four oven upgrades (12/18/25/34 corn), Temper (12), Crack (5), Heart (10), Feather (6), and Restock (5, then +4 per restock). Spice 2+ prices rise 25%; the Ledger discounts every market price 20%, rounded down. Restocks reroll unsold stock. Sold items and the market scene stay in place.
- **Sizzle Dice:** stake 4, 8 or 12 corn (small all-in stakes also allowed). A die showing **1 burns immediately**; exceeding **21°** also loses the stake. Bold rolls use two dice and add +2° on doubles. The buttons show exact burn and next-rung odds, including overshoots. Cash out at ×0.3 / ×0.7 / ×1.2 / ×1.6 / ×2.3 for 1–7 / 8–11 / 12–14 / 15–17 / 18–20°, or automatically at ×3.5 on 21°. Three hands per visit, with a hard **+30 net corn** cap. Even optimal play has a 6.2% house edge before rounding/caps.
- **The road:** choose your path at each fork: orders, a **Market** (buy eggs, a bigger oven, hearts and feathers, or crack bad eggs), the **Sizzle Dice den**, a **Nest** (heal, preen, or branch-upgrade an egg) and **Mysteries** (risky little events).
- **Replay:** every run is randomized. Winning unlocks the next of 10 **Spice** levels (0–9, cumulative modifiers), and your best score is saved.

Your act’s boss portrait and exact house rules appear at the act intro and on the road. Each act has two boss variants; the Baron hosts a Classic Feast or Midnight Gala. Later customers add signature rules, while egg-specific quirks only appear when relevant to your basket. At Spice 6 you start with a Rotten Egg; 7 adds starting heat in Acts II–III and smaller shops; 8 caps non-boss ovens at 8 eggs and makes Rotten Eggs hotter; 9 caps hearts at 4, narrows Act III forks, and gives every boss an extra Enraged rule.

Existing `bb_save` records migrate automatically, keeping best score, wins, Spice and tutorial state. Unlock progress/loadouts are added; old wins also unlock spells whose milestones they prove. Runs remain short: four stops and one boss per act, with the Baron’s optional dessert gamble. Your recap includes the final basket, charms, upgrades, spell casts, charm triggers, corn spent and closest calls. Pocket corn scores half its value; each charm scores 15.

## Controls
| Action | Mouse | Keyboard |
|---|---|---|
| Draw an egg | Draw button | **Space** (or D) |
| Serve / continue / confirm | Serve or Continue button | **Enter** |
| Equipped spell slots 1 / 2 / 3 | spell buttons | **F** / **E** / **C** |
| Toss a peeked egg aside | Toss button | **T** |
| Pick a road card, order tier, item or option | click it | **1 – 4** (shown on each button) |
| Sizzle Dice: gentle / bold / cash out | roll / cash buttons | **1 / 2 / Enter** |
| View basket | basket button in the top bar | **B** |
| Close a window | ✕ | **Esc** |
| Change Spice level (title screen) | ‹ › arrows | **← / →** |
| Mute all sound / toggle music | speaker / note buttons | **M** / **N** |

## Files
- `index.html`, `style.css`, `js/*.js`: the game (plain scripts, no modules, so it works from `file://`).
- `icon.svg`, `manifest.webmanifest`, `social.svg`: generated-in-code web metadata/art, using relative URLs.
- `dev/package-site.ps1`: copies only the deployable files into ignored `site/`; excludes all development scripts and docs.
- `dev/mobile-web-check.cjs`: touch and desktop full runs from a local HTTP sub-path and `file://`, layout/hit-target checks, tooltip/hold/rotation/audio checks, and owned server/browser cleanup. Screenshots and caches stay on D:.
- `js/rules.js`: all pure game rules and v2 content, shared with the simulator.
- `dev/sim.js`, `dev/bot.cjs`: shared-engine balance simulator (`node dev/sim.js --v2 1000 0 skip`; den modes: `skip`, `opt`, `careless`). The former independent design model has been replaced so simulation and gameplay cannot drift. The bot uses starter spells only.
- `dev/v2-rules-check.cjs`: Node checks for all eggs/branches, all 20 charms and 9 spells, exhaustive next-draw/dice odds and den DP.
- `dev/v2-browser-check.cjs`: three scripted full wins from `file://`, including Spice 9, both viewport sizes, all spells, alternate bosses, all dice payout rungs, burns/caps, nest swaps/upgrades, and charm feedback. Uses explicit rich-basket fixtures; `playtest.cjs` separately tests unmodified natural runs.
- `dev/playtest.cjs`: headless Playwright playthrough used for testing (needs `playwright-core` on `NODE_PATH` and an installed Chrome).
- `dev/audio-check.cjs`: headless Chrome audio regression check (needs `playwright-core` on `NODE_PATH`). Run `node dev/audio-check.cjs`; add `--compare <git-revision>` to render the old audio too. Browser caches and temporary profiles use `<local cache dir>`. It renders all nine tracks, the reactive heat layer, special egg chimes and every cue at 44.1/48 kHz, checks sample spikes, clipping and silent endings, stresses overlapping cues, toggles and scheduler stalls, then checks gameplay and audio from `file://`. The browser closes even if a check fails.
- `dev/polish-check.cjs`: focused Chrome regressions for relevant quirks, combo odds, stable market purchases and services, a 24-egg tray, the 40% pre-draw beat and reduced motion. Uses `file://` and closes Chrome on failure.

For the browser checks, use an existing `playwright-core` installation on `NODE_PATH` and keep npm/browser caches on D:, for example in PowerShell:

```powershell
$env:NODE_PATH = '<local cache dir>'
$env:TEMP = $env:TMP = '<local cache dir>'
node bonus/chicken/dev/v2-rules-check.cjs
npx --cache <local cache dir> --yes --package playwright-core -- node bonus/chicken/dev/v2-browser-check.cjs
npx --cache <local cache dir> --yes --package playwright-core -- node bonus/chicken/dev/polish-check.cjs
npx --cache <local cache dir> --yes --package playwright-core -- node bonus/chicken/dev/audio-check.cjs
npx --cache <local cache dir> --yes --package playwright-core -- node bonus/chicken/dev/playtest.cjs 1280 720 <local cache dir> 0 keys
```
