# Bake or Bust! v2 — Systems & Content Design

This document specifies the v2 design for **Bake or Bust!**, covering player goals 1–6 from [`V2_GOALS.md`](V2_GOALS.md) along with an economy pass, UI presentation specs, exact data structures matching `js/rules.js` and `js/game.js`, and balance validation via `dev/sim.js`.

**Design Pillars:**
1. **Short, readable runs (10–20 min):** Every new system lives inside the existing 3-act × (4 road stops + boss) structure and 1280×720 stage.
2. **Exact visible odds:** No hidden dice rigs, secret procs, or opaque multipliers. Live probabilities and modifiers stay visible on buttons and tooltips.
3. **Zero build step / offline-first:** Plain global scripts (`BB`, `ART`, `SFX`, `FX`), procedural SVG/WebAudio, backward-compatible `localStorage` (`bb_save`).
4. **Depth through decisions, not bloat:** Combo eggs, branching upgrades, Charms, and spell loadouts interlock into four clear archetypes without adding extra currencies or extra sub-screens.

---

## 1. Gambling Den Replacement: **Sizzle Dice** (Goal 1)

### Why the v1 Shell Game Broke
In v1, the Cup Game paid `×2` (Lazy), `×3` (Quick), and `×5` (Blur) on 3 cups. Even blind guessing had EV `0.67 / 1.00 / 1.67`, and human visual tracking easily cleared `>85%` on Quick/Blur for `+100` to `+300` corn per visit.

### Rules of **Sizzle Dice** (Hosted by Lucky Wink)
A push-your-luck dice game mirroring the core oven heat-limit loop, with **zero reflex skill** and **exact visible bust odds**.

- **Table Limits:**
  - **Stakes:** `[4, 8, 12]` corn (plus `All-in` chip if `1 ≤ run.corn < 12` and not already in `[4, 8, 12]`).
  - **Max Hands per Visit:** `3` hands.
  - **Net Profit Cap per Visit:** **`+30` corn**. If a cash-out would raise `visitNet` above `+30`, Lucky Wink clamps the payout to `stake + (30 - visitNet)` and locks the table for the rest of the visit (*"House limit, feathers! Come back another night."*).
- **Playing a Hand:**
  - Pan Heat starts at **`0°`**, with a **Pan Burn Limit of `21°`**.
  - On each turn, choose **one** of three actions:
    1. **1 Die (Gentle Toss):** Roll `1d6`.
       - Rolling **`1` (Burnt Egg face 🔥)** = **Instant Bust** (lose stake). (`1/6 = 16.7%`)
       - Rolling `2–6` adds `d` to Pan Heat `P`. If `P > 21`, **Overshoot Burn** (lose stake).
    2. **2 Dice (Bold Toss):** Roll `2d6`.
       - Rolling **`1` on EITHER die** = **Instant Bust** (`11/36 = 30.6%`).
       - Otherwise adds `a + b` to Pan Heat `P`, **plus `+2°` Sizzle Bonus if `a === b`** (doubles: `2-2` gives `+6`, `6-6` gives `+14`). If `P > 21`, **Overshoot Burn** (lose stake).
    3. **Cash Out** *(enabled once `P ≥ 1`)*: Collect `Math.round(stake * mult(P))` according to the Payout Ladder. (At `P === 21`, the hand auto-cashes at `×3.5`.)

### Payout Ladder & Exact Expected Value (DP-Verified)

| Pan Heat `P` | Tier Name | Multiplier | Return on `12` Corn Stake |
|---|---|---:|---:|
| `1–7°` | Cold Pan | `×0.3` | `4` corn (`−8`) |
| `8–11°` | Simmer | `×0.7` | `8` corn (`−4`) |
| `12–14°` | Golden | `×1.2` | `14` corn (`+2`) |
| `15–17°` | Crisp | `×1.6` | `19` corn (`+7`) |
| `18–20°` | Crackling | `×2.3` | `28` corn (`+16`) |
| `21°` | **Perfection!** | **`×3.5`** | **`42` corn (`+30`)** |
| `1` rolled or `>21°` | **Burnt!** | `×0.0` | `0` corn (`−12`) |

**Exact Dynamic Programming Analysis** (computed across all `P ∈ [0..21]`):
- **Optimal DP Policy EV:** **`0.9380`** (`−6.2%` house edge).
  - Optimal action curve: `2 Dice` at `P=0–1`, `1 Die` at `P=2–3`, `2 Dice` at `P=4–7`, **`1 Die` at `P=8–16`**, **`Cash Out` at `P=17–21`**.
  - Notice the genuine cliff at `P=15–17`: at `16°`, 1 Die has EV `1.733×` vs Cash Out `1.60×` (push!); at `17°`, Cash Out `1.60×` beats 1 Die `1.35×` (stop!).
- **Careless Play ("Always 2 Dice until ≥15°"):** EV = **`0.7741`** (`−22.6%`).
- **Reckless Play ("Always 2 Dice until ≥18°"):** EV = **`0.5113`** (`−48.9%`).
- **Timid Play ("Always 1 Die until ≥12° / ≥15°"):** EV = **`0.7085` / `0.8455`**.

### UI Presentation
- Replace the 3 cups on `.den-table` with:
  - A **21-pip horizontal Heat Meter** across the top of the felt (`0°–21°`) with tick markers at the 6 payout rungs (`8, 12, 15, 18, 21`).
  - Two **chunky wooden/bone SVG dice** in the center felt (`1` face rendered as a red 🔥 Burnt Egg glyph; `2–6` as golden pips).
  - A **compact Payout Ladder** strip on the right edge of the table highlighting the current active rung.
  - **Live exact odds** printed directly on the two roll buttons:
    - `[1] 1 Die (Gentle)` → `Burn: XX% · Next rung: YY%`
    - `[2] 2 Dice (Bold)` → `Burn: XX% · Next rung: YY%`
    - `[Enter] Cash Out` → `Collect N corn (+M net)`
  - Top-right Den counter: `Hands left: X/3 · Visit profit: +Y / +30 cap`.

### Data Structures (`rules.js`)
```js
BB.DEN = {
  limit: 21,
  stakes: [4, 8, 12],
  maxHands: 3,
  profitCap: 30,
  rungs: [
    { min: 21, mult: 3.5, label: 'Perfection!' },
    { min: 18, mult: 2.3, label: 'Crackling' },
    { min: 15, mult: 1.6, label: 'Crisp' },
    { min: 12, mult: 1.2, label: 'Golden' },
    { min: 8,  mult: 0.7, label: 'Simmer' },
    { min: 1,  mult: 0.3, label: 'Cold Pan' },
  ],
};
// Pure helpers in BB:
// BB.denMult(heat) -> number
// BB.denOdds(heat) -> { die1: { burn, upgrade }, die2: { burn, upgrade } }
// BB.denRoll(denState, numDice, rng) -> { dice, doubles, heat, bust, mult, autoCash }
```

---

## 2. Combo/Synergy Eggs & Branching Egg Upgrades (Goal 2)

### A. 5 New Combo / Synergy Eggs
Buyable in Markets and available in Legendary Egg Prize drafts. Core pool grows from 11 to **16 base egg types** (`BB.BUYABLE` grows from 7 to **12**).

| Id | Name | Base Puff | Heat | Cost | Combo / Synergy Rule | Archetype |
|---|---|---:|---:|---:|---|---|
| `butter` | **Butter Egg** | `+1` | `+1°` | `8` | **Doubles (`×2`) the puff of the next egg drawn** in this bake (stacks additively with `nextBonus`, multiplicatively before `Golden Cluck`). | Combo / Alchemist |
| `honey` | **Honeycomb Egg** | `+1` | `0°` | `9` | Gains **`+1` puff per `0°` or cooling (`<0°`) egg already in the oven** (plus `+1` for itself = min `+2` puff). | Slow Simmer |
| `cinnamon` | **Cinnamon Egg** | `+2` | `+1°` | `9` | Gains **`+2` extra puff if oven `heat ≥ limit − 2`** when drawn. | Flash-Fry |
| `echo` | **Echo Egg** | `0` | `+1°` | `11` | **Copies the final puff of the previous egg** in the oven (`+2` puff if drawn 1st). Does not copy heat or corn. | Combo / Alchemist |
| `meringue` | **Meringue Egg** | `+1` | `−1°` | `10` | If there are **at least 5 eggs already in the oven** (`oven.length ≥ 5`), also gains **`+3` puff** (`+4` total). | Slow Simmer |

### B. Branching Egg Upgrades (at Cozy Nest & Market Tempering)
Every upgradeable base egg (`10` types) can evolve along **2 distinct branches**:
- **Cool / Steady Branch (`_cool`, sky-blue trim):** Lower heat, extra cooling, or draw utility.
- **Hot / Puffy Branch (`_hot`, gold/flame trim):** Higher raw puff, corn output, or heat-risk payoff.
- **Rotten Egg (`rotten`):** Purifies into **Golden Yolk (`yolk`)** OR composts into **`+8` corn** (and removes the Rotten Egg).

**Where Upgrades Happen:**
1. **Cozy Nest (`Brood`):** Instead of auto-picking 1 target, displays **up to 3 eligible egg types** from your basket (prioritizing `rotten` + random distinct upgradeable base types). Picking an egg opens its **2-card Branch Choice** (`Cool` vs `Hot`, or `Purify` vs `Compost` for `rotten`). Free!
2. **Market Service (`Temper an Egg`):** Costs **`12` corn** (once per Market visit). Lets you pick **any** base upgradeable egg in your basket and choose either its `Cool` or `Hot` branch.

| Base Egg | Cool / Steady Branch (`_cool`) | Hot / Puffy Branch (`_hot`) |
|---|---|---|
| `ember1` (`+1p, +1°`) | **Toasted Egg** (`+2p, +1°`) | **Crackling Ember** (`+3p, +2°`) |
| `ember2` (`+2p, +2°`) | **Hearth Egg** (`+3p, +1°`) | **Wildfire Egg** (`+5p, +3°`) |
| `ember3` (`+3p, +3°`) | **Cinder Egg** (`+4p, +1°`) | **Inferno Egg** (`+7p, +4°`) |
| `yolk` (`+2p, 0°`) | **Royal Yolk** (`+3p, 0°`) | **Brioche Yolk** (`+2p, 0°`; next egg gets `+2` puff) |
| `frost` (`+1p, −1°`) | **Glacier Egg** (`+1p, −2°`) | **Mint Cream Egg** (`+3p, −1°`) |
| `clover` (`+1p, 0°, +3c`) | **Dewdrop Clover** (`+2p, −1°, +3c`) | **Four-Leaf Egg** (`+2p, 0°, +5c`) |
| `pepper` (`+5p, +2°`) | **Smoked Paprika** (`+5p, +1°`) | **Ghost Pepper** (`+8p, +3°`) |
| `moon` (`+1p, 0°, peek`) | **Eclipse Egg** (`+1p, −1°, peek`; `+2` puff if peek tossed) | **Full Moon** (`+3p, 0°, peek`) |
| `thunder` (`Xp, +1°`) | **Cloudburst** (`Xp, 0°`) | **Tempest** (`2Xp, +2°`) |
| `phoenix` (`0p, 0°, guard`) | **Rebirth Egg** (`0p, 0°, guard`; cools `−2°` on save) | **Sunbird Egg** (`+3p, 0°, guard`) |

*(Note: The 5 Combo Eggs `butter, honey, cinnamon, echo, meringue` do not have further branches, keeping total upgraded variants to 20 and preserving visual clarity.)*

### C. UI & Odds Fixes (Goal 7 Overlap)
- **Visual Differentiation (`art.js`):** Upgraded eggs reuse their base `GLYPH` and color palette with a **metallic rim ring** (`#7fd4ff` double-border + frost star for `_cool`; `#ffd23f` spiked crown highlight for `_hot`) and a `+` badge on `.egg-chip` and `.bag-row`.
- **Combo-Accurate `BB.estimateOdds`:** `estimateOdds` uses `BB.bakeDraw(b)` directly during its Monte Carlo rollout, so `nextMult` (`butter`), `nextBonus` (`yolk_hot`), `honey`, `cinnamon`, `echo`, and `meringue` are simulated accurately—and we increase `sims` only slightly or keep `400` with cached deterministic seed per order-card refresh so hovering doesn't jitter.
- **Egg Tray Past 16 Slots:** `.tray` starts as 8×2 (`16` slots). Whenever `b.oven.length >= 16`, `.tray` switches to `repeat(10, 1fr)` (up to `24` slots, slightly shorter `52px` slot height) so deep `Frost`/`Meringue` runs never overflow silently.
- **Live Next-Egg Buff Indicator:** When `bake.nextMult > 1` or `bake.nextBonus > 0`, show a glowing badge above the Oven mouth (`Next egg: ×2 puff!` / `+2 puff!`) and reflect it in `.bag-row` puff previews!

### Data Structures (`rules.js`)
```js
// Added fields on BB.EGGS[id]:
//   base: 'ember1' (for upgraded forms; defaults to id via BB.baseEgg(id))
//   tier: 1 | 2
//   branch: 'cool' | 'hot'
//   combo: 'butter' | 'honey' | 'cinnamon' | 'echo' | 'meringue'
//   nextBonus?: number, tossBonus?: number, saveCool?: number, thunderMult?: number
BB.UPGRADES = {
  ember1: ['ember1_cool', 'ember1_hot'],
  // ...all 10 base upgradeable eggs
};
// Bake state additions:
//   bake.nextMult = 1; bake.nextBonus = 0; bake.bonusPuff = 0;
```

---

## 3. Unlockable Spell Pool & Loadout (Goal 3)

### Pool Size & Loadout Rules
- **9 Total Spells:** 3 Starters + 6 Unlockables across runs.
- **3 Active Spell Slots per Run:** Keeps the right-hand bake panel clean and preserves single-key hotkeys (`F`, `E`, `C` or slot keys `Q / W / E` — keep `F / E / C` mapped to Slots 1 / 2 / 3 so muscle memory holds!).
- **Pre-Run Selection ("Spellbook" on Title Screen):**
  - Default loadout for new saves is `['fan', 'eye', 'cluck']` (zero friction on run 1).
  - Once ≥4 spells are unlocked, a **"Spellbook (3/3)"** button appears below the Spice selector on the Title screen (plus a quick `"Randomize"` button). Clicking it opens a clean 3×3 grid modal showing unlocked/locked spells, unlock hints, and your 3 active slots.
- **Mid-Run Flexibility:** At any **Cozy Nest**, `Preen` offers: `Gain 2 magic feathers` **OR** `Swap 1 active spell (+1 feather)` so players can pivot mid-run if their basket shifts (e.g., swapping `Wing Fan` for `Cryo-Cackle` or `Phoenix Plume` before Act III).

### Complete Spell Pool (9 Spells)

| Id | Name | Cost | Effect | Rules / Limits | Unlock Condition (`SAVE.lifetime`) |
|---|---|---:|---|---|---|
| `fan` | **Wing Fan** | `1` | `−2°` oven heat (min `0`). | Requires `heat > 0`. | **Starter** |
| `eye` | **Hen's Eye** | `1` | Peek at top egg in basket; keep or toss (`T`). | Requires `!peek && bag.length > 0`. | **Starter** |
| `cluck` | **Golden Cluck** | `2` | Double (`×2`) the puff of the last egg in the oven. | Once per bake; requires last egg `puff > 0`. | **Starter** |
| `baste` | **Butter Baste** | `1` | Next egg drawn gains **`+3` puff**. | Stacks onto `bake.nextBonus`; usable anytime while baking. | Serve **25** total orders across runs. |
| `chill` | **Cryo-Cackle** | `2` | **`−3°` oven heat** AND **`+2` bonus puff**. | Requires `heat > 0`. | Win any bake ending at **`heat === limit`**. |
| `swap` | **Sleight of Wing** | `1` | Return the last egg in the oven back to the shuffled basket (undoing its puff/heat/corn) and draw a fresh egg. | Once per bake; requires `oven.length > 0 && bag.length > 0`. | Reach **Act III** (or `wins ≥ 1`). |
| `surge` | **Hearth Surge** | `1` | Gain **`+5` bonus puff**, raise heat by **`+2°`**. | Requires `heat + 2 <= limit` (safe burst; cannot suicide-cast). | Win a run at **Spice 1+**. |
| `wish` | **Wish Egg** | `2` | Conjure a temporary **Golden Yolk (`+2` puff, `0°`)** straight into the oven. | Once per bake; does not enter `run.basket`; respects `maxDraws`. | Hold **≥16 eggs** in your basket at once. |
| `ward` | **Phoenix Plume** | `2` | Shield the **next draw**: if it would burn, toss it aside safely instead. | Once per bake; sets `bake.ward = true`. | Trigger a **Phoenix Egg save** (or beat Act II Boss). |

### Data Structures (`rules.js` & `game.js`)
```js
BB.SPELLS = {
  fan:   { name: 'Wing Fan',        cost: 1, text: 'Cool −2° heat.' },
  eye:   { name: "Hen's Eye",       cost: 1, text: 'Peek at the next egg and keep or toss it.' },
  cluck: { name: 'Golden Cluck',    cost: 2, text: 'Double the last egg’s puff. Once/bake.' },
  baste: { name: 'Butter Baste',    cost: 1, text: 'Next egg drawn gets +3 puff.' },
  chill: { name: 'Cryo-Cackle',     cost: 2, text: 'Cool −3° heat and gain +2 puff.' },
  swap:  { name: 'Sleight of Wing', cost: 1, text: 'Shuffle last oven egg back and redraw. Once/bake.' },
  surge: { name: 'Hearth Surge',    cost: 1, text: '+5 puff and +2° heat (must fit limit).' },
  wish:  { name: 'Wish Egg',        cost: 2, text: 'Bake a temp Golden Yolk (+2 puff, 0°). Once/bake.' },
  ward:  { name: 'Phoenix Plume',   cost: 2, text: 'Next draw cannot burn (tossed if fatal). Once/bake.' },
};
// On run: run.spells = SAVE.loadout.slice(0, 3);
// SAVE migration: preserve best/wins/runs/spiceUnlocked/spice/tutorialDone;
// add unlockedSpells, loadout, lifetime: { served, exactLimitWins, maxBasket, phoenixSaves }.
```

---

## 4. Kitchen Charms (Relics) — 20 Charms & 4 Archetypes (Goal 4)

### Core Rules & Sources
- **Passive Run Relics:** Acquired during a run, kept until end of run, no hard slot cap (typical run collects `2–5` Charms).
- **Where Found:**
  1. **Markets (Primary Sink):** Every Market stocks **2 Charms** alongside its 4 eggs (Act I: Common/Uncommon only; Act II–III: all rarities, weighted `45% Common / 40% Uncommon / 15% Rare`).
  2. **Act Boss Victory Rewards:** Defeating Act I or Act II Boss presents a **1-of-2 Uncommon/Rare Charm choice** (alongside the `+1` feather and rare egg).
  3. **Mystery Events:** Selected Mystery events (e.g., *Wishing Well* jackpot, *Peddling Crow* rare trade, new *Roaming Tinker* event) can grant or sell a Common/Uncommon Charm.
- **UI Presentation:**
  - During `road`, `order`, `bake`, `market`, `nest`, a sleek **Charm Ribbon** sits directly under the top HUD bar (height `34px`, left-aligned gold/brass badges with custom mini SVG icons and hover tooltips showing name + exact effect).
  - On the **Bake screen**, when a Charm triggers (e.g., `Asbestos Mitt`, `Mirror Tray`, `Cryo-Crown`), its badge flashes gold and emits a crisp floating callout (`Mitt saved you!`, `Mirror ×2!`).

### The 20 Kitchen Charms by Archetype

#### Archetype A — **Slow Simmer** *(Coolers, `0°` eggs, deep baskets, Honeycomb & Meringue)*
1. **Tin Whisk** *(Common · `13` corn · Market/Mystery)*: Every cooling egg (`heat < 0`) gives **`+1` extra puff**.
2. **Porcelain Bowl** *(Common · `14` corn · Market)*: Your **5th and 10th** eggs drawn in a bake each give **`+2` extra puff**.
3. **Icebox Door** *(Uncommon · `20` corn · Market/Boss)*: The **first** heat-adding egg (`heat > 0`) in each bake adds **`1` less heat** (min `0°`).
4. **Glazed Apron** *(Uncommon · `21` corn · Market/Boss)*: Zero-heat (`0°`) eggs give **`+1` extra puff** once you have **≥3 eggs** in the oven.
5. **Cryo-Crown** *(Rare · `30` corn · Act II–III Market/Boss)*: Whenever you cool the oven (`egg heat < 0`, `Wing Fan`, or `Cryo-Cackle`), gain **`+2` bonus puff**.

#### Archetype B — **Flash-Fry** *(High heat, `Pepper`/`Ember3`/`Cinnamon`, Phoenix safety)*
6. **Copper Kettle** *(Common · `13` corn · Market/Mystery)*: Eggs with base `heat ≥ +2°` give **`+1` extra puff**.
7. **Bellows** *(Uncommon · `19` corn · Market/Boss)*: Immediately gain **`+1` oven heat limit**. Eggs drawn while `heat === limit` gain **`+1` extra puff**.
8. **Asbestos Mitt** *(Uncommon · `22` corn · Market/Boss)*: Once per bake, if a draw would push `heat` to **exactly `limit + 1`**, survive at `heat = limit` instead of burning.
9. **Phoenix Bell** *(Uncommon · `20` corn · Market/Mystery)*: Whenever a `Phoenix` (or `Phoenix Plume`) saves you from burning, gain **`+4` bonus puff** and **`+5` corn**.
10. **Dragon Grinder** *(Rare · `32` corn · Act II–III Market/Boss)*: Whenever `heat ≥ limit − 1`, **every** egg drawn gains **`+3` extra puff**.

#### Archetype C — **Alchemist Hen** *(Combos, Peeking/Tossing, Spells, `Butter`/`Echo`/`Thunder`)*
11. **Silver Spoon** *(Common · `12` corn · Market/Mystery)*: Whenever you **toss** a peeked egg aside (`Moon` or `Hen's Eye`), gain **`+2` bonus puff**.
12. **Quill Brooch** *(Common · `15` corn · Market/Mystery)*: Immediately gain **`+1 maxFeathers`** (`5 → 6`) and **`+1` feather** at the start of every Act (and on pickup).
13. **Storm Rod** *(Uncommon · `18` corn · Market/Boss)*: `Thunder`, `Echo`, and `Butter` eggs each give **`+2` extra puff**; `Butter` also gives **`+1` corn**.
14. **Mirror Tray** *(Uncommon · `21` corn · Market/Boss)*: Once per bake, your **3rd egg** drawn triggers its puff a **second time**.
15. **Arcane Featherweight** *(Rare · `34` corn · Act II–III Market/Boss)*: The **first spell** you cast in each bake costs **`1` fewer feather** (min `0`).

#### Archetype D — **Golden Goose** *(Corn economy, Tips, Hearts, Safe Yolk scaling)*
16. **Tip Jar** *(Common · `12` corn · Market)*: Tips pay **`+1` extra corn per puff over target** (e.g., `×2` normally, `×4` on *Big Tipper*).
17. **Cornucopia** *(Common · `14` corn · Market/Mystery)*: Gain **`+2` corn** on every served order (`+4` on Bosses), and **`+1` extra corn** from `Clover` draws.
18. **Merchant's Ledger** *(Common · `15` corn · Act I–II Market)*: All Market prices (eggs, charms, services, restocks) are **20% off** (floored).
19. **Warm Nest Egg** *(Uncommon · `18` corn · Market/Mystery)*: Gain **`+1` max heart** (respecting Spice 9 cap) and heal `1` heart on pickup. Start Boss bakes with **`+3` puff** if at full hearts.
20. **Golden Rolling Pin** *(Rare · `28` corn · Market/Boss)*: Your **1st egg** in every bake gains **`+3` extra puff**, and all `Golden Yolks` gain **`+1` extra puff**.

### Data Structures (`rules.js`)
```js
BB.CHARMS = {
  whisk: { name: 'Tin Whisk', rarity: 'common', cost: 13, arch: 'simmer', text: 'Cooling eggs give +1 puff.' },
  // ...20 entries
};
// On run: run.charms = [];
// Helper: BB.hasCharm(run, id) => run.charms.includes(id)
// Hooks inside BB.newBake / BB.eggPuff / BB.bakeDraw / BB.cast / BB.bakeToss / BB.applyBake
```

---

## 5. Economy Pass & Corn Sinks

### Why v1 Ended With ~135 Unspent Corn
1. Markets only had 4 egg slots + 1 oven upgrade (`[14, 20, 28]`) + cheap 1-use services.
2. Once a player visited 1–2 Markets, excess corn had nowhere to go, while the Cup Game printed even more.

### v2 Corn Sinks & Rebalancing
- **New Market Stock Layout:**
  - Top Shelf: **4 Eggs** (`6–16` corn).
  - Middle Shelf: **2 Kitchen Charms** (`12–34` corn).
  - Services (`2×2` + `Restock`):
    1. **Bigger Oven** (`BB.OVEN_PRICES = [12, 18, 25, 34]`, now **4 upgrades** up to `limit 11`, max 1 per visit).
    2. **Temper an Egg** (`12` corn, once per visit): Branch-upgrade any eligible egg in your basket.
    3. **Crack an Egg** (`5` corn, once per visit): Remove any egg (`basket.length > 4`).
    4. **Mend a Heart** (`10` corn) / **Magic Feather** (`6` corn).
    5. **Restock Shelf** (`5` corn first time per visit, **`+4` corn** each additional restock in that visit: `5 → 9 → 13…`): Rerolls all unsold Eggs & Charms!
- **UI Improvement (Goal 7):** Market purchases and Restocks update only the affected card/button DOM nodes and HUD counters instead of rebuilding the entire screen and re-triggering entry animations.
- **Score Formula Update (`BB.score`):**
  - `Corn in pocket`: `Math.floor(run.corn / 2)` (so hoarding unspent corn no longer beats investing in Charms/Upgrades!).
  - `Charms collected × 15`: Rewards building a strong loadout.
  - Keep Hearts `×15`, Feathers `×5`, Bosses `×25`, Legendary `×10`, Golden Egg `100 + 50 * spice`.

### Measured Economy Impact (`dev/sim.js --v2`, Spice 0, 1000 runs)
- **v1 Spice 0:** Avg unspent ending corn = **`135`** (`win 70%`).
- **v2 Spice 0 (`den=skip`):** Avg corn earned **`179.8`**, spent **`112.3`**, **`17.5` corn entering the final Baron fight**, ending corn **`75.5`** *(note: ~58 of that is awarded by the Baron's post-shop 3-course payout at the very end of the run)*. Players average **`5.53` Charms** and **`3.08` Egg Upgrades** per run!

---

## 6. Difficulty Ladder: Spice 0–9 (Goal 5)

Spice `0–5` remain intact for `localStorage` backward compatibility (`SAVE.spiceUnlocked`). Winning Spice `5` unlocks **Spice 6**, up to **Spice 9**. Each new Spice level adds a **structural rule change**, not just bigger numbers:

| Spice | Name | Rule Added (Cumulative) | Measured Bot Win% (v2 Sim) |
|---:|---|---|---:|
| `0` | Mild | The classic adventure. | **74%** *(600 runs)* |
| `1` | Warm | Every target `+1` puff. | **56%** |
| `2` | Hot | Market prices `+25%`. | **47%** |
| `3` | Spicy | Start with `0` corn and `1` feather. | **35%** |
| `4` | Scorching | Start with `3` hearts (instead of `4`). | **30%** |
| `5` | Inferno | Bosses want `+2` more puff. | **16%** *(v1 was 15%)* |
| `6` | **Smoked** | Start with **1 Rotten Egg** in your basket (replacing 1 `Ember Egg`). | **13%** |
| `7` | **Flashpoint** | Every Act II & III bake starts at **`+1°` heat**; Markets stock **3 eggs** instead of 4. | **6%** |
| `8` | **Bitter Crowd** | Non-boss bakes hold at most **8 eggs** (`maxDraws: 8`); Rotten Eggs deal **`+3°` heat** instead of `+2°`. | **3%** |
| `9` | **Gilded Inferno** | **Max hearts capped at 4**; Act III road forks offer **2 choices** instead of 3; **All Bosses gain an Enraged 2nd Rule** (see §7). | **1%** *(naive bot)* |

*(Note on Spice 6–9 sim rates: the heuristic bot in `sim.js` never uses the 6 unlockable spells (`baste`, `chill`, `swap`, `surge`, `wish`, `ward`) and never plans Charm synergies around telegraphed bosses. Skilled human runs will sit meaningfully higher, roughly 10–25% on Spice 8–9.)*

---

## 7. Opponents: Telegraphed Bosses, Alternates, Late-Game Customers & Quirks (Goal 6)

### A. Telegraphed Act Bosses
- At `BB.newRun`, roll `run.actBosses = [boss0, boss1, boss2]` (1 of 2 variants per Act).
- **Act Intro Screen (`showActIntro`):** Displays a **"Boss Ahead"** box with the boss's SVG portrait, name, title, and **exact House Rule**.
- **Road Screen (`showRoad`):** Displays a compact **"Act Boss" badge** in the corner (portrait + 1-line rule) and makes the final ★ trail dot show full boss details on hover, so players build for the boss from Stop 1.

### B. Alternate Bosses Per Act (Balanced Pairs)

| Act | Variant A | Variant B | Spice 9 "Enraged" Bonus Rule |
|---|---|---|---|
| **Act I** *(Clover Meadow)* | **Brunhilde Badger** *(Target `13`, `20` corn)*: *Iron Oven* — Heat limit `-1°`. Ember Eggs give `+1` puff. | **Marshal Brambleboar** *(Target `11`, `20` corn)*: *Toll Gate* — Max **`6` eggs** fit in the oven. `Pepper`, `Ember3`, and `Cinnamon` eggs give **`+2` extra puff**. | Badger: `maxDraws: 7`. Boar: `startHeat: +1°`. |
| **Act II** *(Whisperwood)* | **Hootenanny** *(Target `16`, `28` corn)*: *Hexed Basket* — `2` Rotten Eggs hexed into basket. `Moon` Eggs give `+3` puff. | **Old Shellback** *(Snapping Turtle, Target `16`, `28` corn)*: *Copper Crust* — Every **even draw** (`2nd, 4th, 6th…`) adds **`+1°` extra heat**. Cooling eggs (`<0°`) give **`+3` puff**. | Owl: `startHeat: +1°`. Turtle: `limit: −1°`. |
| **Act III** *(Velvetpaw Keep)* | **Baron — Classic Feast**: Appetizer `13` (no trick), Main `17` (`startHeat: 2`), Dessert `21` (`extraRotten: 1, tipMult: 2`). | **Baron — Midnight Gala**: Appetizer `14` (`maxDraws: 6`, `16g`), Main `18` (*Chaos*: every 3rd draw `×2` puff & `+1°` heat, `22g`), Dessert `22` (`firstFree: true`, pays `×1.5`, `tipMult: 2`, `32g`). | Classic: `+1°` start heat on App/Des, `maxDraws: 7` on Main. Gala: `+1°` start on App, `+1` Rotten on Main, `limit: −1°` on Des. |

### C. Distinctive Late-Game Customers (Act II & Act III)
Act I customers remain welcoming tutorials. **Act II** introduces 3 signature customer mechanics (`60%` roll chance alongside 0–1 quirk), and **all 5 Act III** customers carry a permanent rule-bending mechanic (plus `+4` base corn pay in Act III to offset the harder rules):

- **Act II Distinctive Customers:**
  - **Rook Raccoon:** *Sly Pockets* — Sets `1` random egg from your shuffled bag into `aside` at bake start (`+4` bonus corn).
  - **Sprocket Squirrel:** *Steam Valve* — Draws after the 5th egg (`oven.length ≥ 5`) add **`+1°` extra heat**; tips are `×1.5`.
  - **Saffron Cat:** *Picky Palate* — 3rd+ copy of the same base egg type in the oven gets **`−1` puff**.
- **Act III Distinctive Customers (All 5 Rule-Bending):**
  - **Sergeant Grimsby:** *Rationing* — Max **`1` spell** may be cast this bake (`+5` bonus corn).
  - **Whiskerton the Butler:** *Etiquette* — **`0` tips** unless you serve at `heat ≤ limit − 2`, which pays **`×3` tips**!
  - **Chef Lupo:** *Open Flame* — Oven starts at **`2°` heat**, and `Ember`/`Pepper` eggs give **`+2` extra puff**.
  - **Fizz the Ferret:** *Chaotic Order* — Every **3rd egg** drawn (`3rd, 6th, 9th…`) has its **puff doubled**, then adds **`+1°` extra heat** (marked on tray slots 3, 6, 9!).
  - **Duchess Lynx:** *High Society* — Only offers **Fancy** and **Legendary** tiers (`Ember1` gives `0` puff; `+6` bonus corn).

### D. Relevant-Only Quirks & 6 New Rule-Bending Quirks
- **Relevance Filter (Goal 6 & 7):** Every egg-specific quirk (`sweet`, `chilly`, `spicy`, `smoky`, `lucky`, `stormy`, `moony`) defines `requires: (run) => hasBaseEgg(run, ...)` and is excluded from `BB.genOrderOption` unless the player owns at least 1 matching egg (base or upgraded).
- **6 New Quirks:**
  1. `brittle` (**Crisp & Fragile**): `limit: −1°`, `tipMult: 2`, `rewardMult: 1.3`.
  2. `slowbake` (**Slow Rise**): Must draw **≥5 eggs** before Serve unlocks (`minDraws: 5`), `rewardMult: 1.35`.
  3. `taster` (**Royal Taster**): Your **2nd egg** in the oven gets `×2` puff; Target `+2` puff.
  4. `bargain` (**Haggle**): `tipMult: 0` (no tips), `rewardMult: 1.4`.
  5. `volatile` (**Boiling Pot**): Every `0°`-heat egg adds `+1°` heat instead (`zeroToOne: true`), `rewardMult: 1.4`.
  6. `encore` (**Encore**): Serving with **`0` spells cast** awards `+1` magic feather (any tier!).

---

## 8. Sim Validation Summary (`dev/sim.js --v2`)

Extended `bonus/chicken/dev/sim.js` with a `--v2` mode (`node bonus/chicken/dev/sim.js --v2 [runs] [spice] [denMode]`) implementing the v2 economy, all 20 Charms, 5 Combo eggs, 20 Branching upgrades, Sizzle Dice Den, alternate bosses, customer rules, and Spice 0–9.

### Measured Results (`600` runs per Spice level, `1000` runs for Den comparisons)

| Scenario | Win% | Losses (Act I/II/III) | Corn Pre-Boss3 | Corn End | Charms / Run | Upgrades / Run | Boss Win Rates (`Badger/Boar · Owl/Turtle · FoxA/FoxB`) |
|---|---:|---|---:|---:|---:|---:|---|
| **v1 Spice 0** *(2000 runs)* | 70% | 1 / 92 / 514 | — | **135** | — | — | `87% · 66% · —` |
| **v2 Spice 0** *(den=skip)* | **74%** | 0 / 20 / 135 | **17.5** | 75.5 | 5.53 | 3.08 | `87%/69% · 65%/72% · 84%/85%` |
| **v2 Spice 0** *(den=opt)* | **70%** | 0 / 40 / 260 | **17.2** | 71.0 | 5.16 | 2.57 | `denNet: −2.2 corn` |
| **v2 Spice 0** *(den=careless)* | **67%** | 0 / 38 / 294 | **15.5** | 67.1 | 5.01 | 2.54 | `denNet: −6.6 corn` |
| **v2 Spice 2** *(Hot)* | **47%** | 0 / 37 / 281 | 15.6 | 49.9 | 3.81 | 2.52 | `79%/58% · 36%/52% · 66%/62%` |
| **v2 Spice 5** *(Inferno)* | **16%** | 7 / 149 / 348 | 15.3 | 25.1 | 2.13 | 1.77 | `60%/25% · 22%/21% · 42%/41%` |
| **v2 Spice 6** *(Smoked)* | **13%** | 19 / 255 / 247 | 15.2 | 21.8 | 1.37 | 1.49 | `34%/16% · 19%/20% · 45%/44%` |
| **v2 Spice 7** *(Flashpoint)* | **6%** | 19 / 294 / 254 | 13.7 | 15.5 | 1.21 | 1.46 | `39%/16% · 16%/10% · 28%/20%` |
| **v2 Spice 8** *(Bitter Crowd)* | **3%** | 34 / 301 / 245 | 13.2 | 13.0 | 0.95 | 1.30 | `34%/13% · 6%/10% · 28%/8%` |
| **v2 Spice 9** *(Gilded Inferno)* | **1%** | 34 / 321 / 237 | 14.6 | 11.9 | 0.81 | 1.19 | `26%/9% · 5%/6% · 18%/5%` |

**Key Takeaways & Final Tuning Note for Implementation:**
1. **Economy Fixed:** Unspent corn entering the Baron drops from `~100+` to **`17.5` corn** at Spice 0, with players spending `~112` corn per run on Charms, Eggs, Oven upgrades, Tempering, and Restocks.
2. **Den Fixed:** Sizzle Dice produces **`−2.2` corn net** under optimal DP play (`0.938` EV) and **`−6.6` corn net** under careless play (`0.774` EV), while still allowing exciting `+30` corn spikes capped cleanly at the table limit.
3. **One Knob to Watch:** On Spice 5+, Marshal Brambleboar (`target: 11, maxDraws: 6`) trails Brunhilde Badger (`25%` vs `60%`). Lowering Brambleboar's base target from `11` to **`10`** (or adding `+1` egg draw capacity to `7` at `target: 11`) will bring both Act I bosses into parity across Spice 0–9.


## 9. Shipped implementation decisions and validation (2026-11-15)

The browser, Node checks and `dev/sim.js --v2` all load the same pure `rules.js`. The former separate design-model engine was removed. The reference measurements above remain historical design targets, not claims about the shipped engine.

Decisions / deviations from ambiguous or simplified model behavior:

- **Brambleboar target is 10**, following §8’s suggested tuning. With the real engine at Mild, Badger/Boar success is 83%/85%. Targets, oven capacity and other structural Spice rules otherwise follow this document.
- **Actual rules replace model shortcuts:** Turtle rewards every printed cooling egg (including Meringue and upgraded Moon/Clover), Gala Dessert actually applies its ×1.5 payment, zero tips stay zero, all customer bonus payments apply, and the heart charm really adds a max heart (Spice 9 still caps at 4). Charm rarity is sampled 45/40/15 per rarity among available stock; sold cards remain on restock. These and real customer/quirk combinations explain differences from the historical model.
- **Puff ordering:** printed/combo puff → customer and passive additions → `(puff + nextBonus) × nextMult` → Taster/Chaos/Mirror doubling → first-egg suppression / High Society basic Ember suppression. The live basket preview uses this exact function. “At the limit” and “near the limit” use heat **before** drawing. Cooling/zero-heat charm classification uses printed egg heat; Honeycomb counts heat actually recorded on prior oven eggs. Extra puff is accumulated separately from egg puff.
- **Sleight of Wing:** removes the last egg’s final puff, applied heat, draw corn and draw bonus puff, restores its pending next-egg buff, then shuffles/redraws through the real engine. It never refunds spells, spent safety effects or once-per-bake charm triggers. Temporary Wish eggs stay temporary to the bake (never enter the run basket). Wish obeys customer heat/first-egg/Chaos rules and uses an oven slot.
- **Unwinnable minimum-draw bakes:** if the bag is exhausted or the oven fills before Slow Rise’s five eggs, the Serve button becomes an explicit underbake/concession. Tossing every remaining egg also permits conceding with an empty oven. This prevents a soft lock without allowing a successful early serve.
- **Compact presentation:** the service grid uses 3 columns ×2 rows to fit charms and readable egg cards at 720p; Brood target/branch choices and nest spell swaps use small modals. The deep tray uses ten columns, shorter slots and retained scrolling so every egg remains reachable beyond 24 too. A new Roaming Tinker is the Mystery charm source; it offers an unowned Common/Uncommon charm for 10 corn.
- **Save migration:** preserve existing progress; add lifetime milestones, unlocked spells and the 3-slot loadout. Prior wins prove Act III/Act II milestones; unlocked Spice ≥2 proves a Spice 1 win. Unknown historical order counts/exact-limit bakes start at zero. Lifetime counters are updated after bakes and basket changes; spells unlocked during a run become available for nest swaps.

Shared-engine heuristic measurements (1,000 Mild runs per den mode; 600 per other Spice; starter spells, no synergy planning):

| Spice / mode | Win rate | Corn before Baron | Ending corn | Corn spent | Charms | Upgrades | Den net/run |
|---|---:|---:|---:|---:|---:|---:|---:|
| 0 / skip | 68.4% | 20.3 | 77.8 | 108.8 | 5.48 | 3.02 | 0 |
| 0 / optimal curve | 59.5% | 17.4 | 67.8 | 94.0 | 4.98 | 2.53 | −2.90 |
| 0 / careless | 58.2% | 15.8 | 64.3 | 90.1 | 4.85 | 2.50 | −7.67 |
| 2 / skip | 35.2% | 18.7 | 44.4 | 71.8 | 3.33 | 2.30 | 0 |
| 5 / skip | 10.5% | 15.5 | 22.6 | 38.5 | 1.77 | 1.52 | 0 |
| 6 / skip | 13.2% | 18.6 | 23.5 | 34.3 | 1.56 | 1.36 | 0 |
| 7 / skip | 6.7% | 16.7 | 17.5 | 27.2 | 1.36 | 1.27 | 0 |
| 8 / skip | 5.2% | 16.8 | 14.5 | 22.1 | 1.07 | 1.15 | 0 |
| 9 / skip | 1.5% | 30.1 | 13.6 | 16.3 | 0.77 | 1.01 | 0 |

The mild economy is close to the target (roughly 20 corn before the final shopless fight, 109 spent). Difficulty rises sharply, but 600-seed policy results are noisy and Spice 5/6 are not strictly monotonic for this heuristic: Rotten purification changes its path/upgrade choices. Spice 2/5 are harder for the shipped bot than the simplified design model. No broad target nerfs were made on that evidence alone. The bot does not use unlockable spells; these are not measured human win rates. High-Spice rates should receive player feedback before further tuning.

Sizzle’s exhaustive DP matches **0.9380 optimal EV / 0.7741 careless EV** before integer payout rounding and the visit cap. Printed roll odds enumerate every die face, including 1s, doubles, overshoots and next-rung hits. Next-egg burn odds were compared against real draws for every egg, all heat modifiers and Mitt/Icebox safety combinations.

Verification: Node mechanics/DP checks; existing polish regressions (including stable market purchases and the pre-draw beat); WebAudio renders at 44.1/48 kHz; headless Chrome via npx with D: caches, loaded from `file://`. Three scripted full wins cover Mild and Spice 9, 1280×720/1920×1080, both boss sets, all nine spells, six dice payout rungs, instant/overshoot burns, doubles, auto-cash/cap, Brood and nest spell swaps. Scripted wins use explicit rich-basket fixtures; natural keyboard/mouse runs are tested separately. No browser console errors. All browser harnesses close Chrome in `finally`.
