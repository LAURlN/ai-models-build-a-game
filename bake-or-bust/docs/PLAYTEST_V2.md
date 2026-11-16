# Bake or Bust! v2 — Critical Playtest & Balance Notes

Playtest conducted against the shipped v2 implementation in `bonus/chicken/` using `dev/sim.js --v2`, `dev/v2-rules-check.cjs`, and live headless Chrome (`file://`) runs (`dev/v2-browser-check.cjs`, `dev/polish-check.cjs`, `dev/audio-check.cjs`, and `dev/playtest.cjs` in both keyboard and mouse modes).

---

## 1. Key Findings

### Fun, Decisions & Content Balance
- **Shop & Prize Pool Dilution:** `BB.genShop` and `BB.prizeChoices` sampled uniformly across all 12 `BB.BUYABLE` eggs without duplicate protection, crowding out affordable staples (`Golden Yolk`, `Frost Egg`, `Clover Egg`, `Pepper Egg`) with expensive or combo-dependent eggs (`Phoenix`, `Thunder`, `Echo`) in Act I/II.
- **Under-tuned Items & Spells:**
  - `Echo Egg` (`11` corn) was overpriced relative to its `+1°` heat and reliance on preceding strong draws.
  - `Glazed Apron` (`21` corn) had a modest conditional payoff (`+1` puff on `0°` eggs from the 4th egg onward) priced above higher-impact uncommons.
  - `Wish Egg` (`2` feathers) felt weak for a once-per-bake `+2 puff / 0°` slot filler compared to `Cryo-Cackle` and `Golden Cluck`, and casting it wiped out an active `Hen's Eye` / `Moon` peek on the real basket.
  - `BB.genOrderOption` excluded `Echo Egg` when checking whether `Fussy Eater` (`firstFree`) could affect the basket.
- **Sizzle Dice:** Mathematically tight and non-exploitable (`0.9380` DP-optimal EV, `0.7741` careless EV, `+30` corn visit profit cap, integer payout rounding on `[4, 8, 12]` stakes). Visually, however, the **Road card art** (`ART.place('den')`) still showed the 3 v1 cups, and the roll odds text (`Next rung: YY%`) omitted which rung and multiplier were next.

### Opponents & Spice 0–9 Balance
- **Act II Boss Spike:** `Hootenanny` (`owl`, target `16`, `+2 Rotten Eggs`) and `Old Shellback` (`turtle`, target `16`, `+1°` every even draw) were roughly twice as lethal as Act III bosses (`52% / 65%` vs `80% / 84%` at Spice 0; `27% / 34%` at Spice 2; `17% / 14%` at Spice 5), starving the Act III run rate and driving the starter-spell bot below target at Spice 2 (`33.5%` vs `47%`) and Spice 5 (`10.0%` vs `16%`).
- **Act I Alternate Boss:** `Marshal Brambleboar` (`boar`, `maxDraws: 6`) kept pace with `Badger` at Spice 0–2 (`84% / 61%`) but fell behind at Spice 5 (`27%` vs `43%`). Raising `bonusHeavy` (`+2 -> +3` puff for `Pepper`, `Ember3`, `Cinnamon`) preserves the 6-egg toll-gate puzzle while rewarding heavy-egg builds.
- **Act II Signature Customers:** On a starter basket at Spice 2 Fancy, `Sprocket Squirrel` (`after5Heat`, `8%` clear rate) and `Saffron Cat` (`pickyDup`, `16%` clear rate) were disproportionately punishing compared to `Rook Raccoon` (`31%`) and non-signature Act II orders (`26%`).
- **Spice 5 vs Spice 6 Non-Monotonicity:** Starting with a `Rotten Egg` at Spice 6 triggered early Nest purification (`rotten -> yolk`), causing the starter-spell heuristic bot to win more often at Spice 6 (`13.0%`) than Spice 5 (`10.0%`).

### Legibility, UI & Feel
- `BK.bagList` highlighted heat using `E.heat < 0` instead of effective `BB.eggHeat(b, t)` and lacked a `.zero` class, miscoloring `0°` eggs under `Boiling Pot` (`+1°`) or `Icebox Door`.
- `BK.status` appended `Slow Rise` text unconditionally when `oven.length < minDraws`, overwriting `'Your basket is empty'` on exhausted bags and remaining visible after a burn; the limit warning also ignored `Boiling Pot` (`zeroToOne`) and `Asbestos Mitt`.
- Unlockable spells (`baste`, `chill`, `surge`, `ward`, `wish`, `swap`) shared generic text floaters instead of distinct particles/SFX, and burning via `wish`/`swap` lacked charred tray/flash/shake feedback.
- Nest `Preen` remained enabled when `feathers >= maxFeathers` and `<4` spells were unlocked, opening a modal with both buttons disabled; `chooseUpgrade` omitted egg counts, stats, descriptions, and `1–9` hotkeys; `How to Play` omitted Kitchen Charms and unlockable spells.
- Audio (`js/audio.js`) rendered cleanly at 44.1 kHz and 48 kHz with zero clipping and click-free zero-start envelopes; no audio engine changes were needed.

---

## 2. Changes Made

- **[`js/rules.js`](bonus/chicken/js/rules.js):**
  - Tuned `Echo Egg` cost `11 -> 9`, `Glazed Apron` cost `21 -> 16`, and `Wish Egg` spell cost `2 -> 1` feather.
  - Restored Act-weighted egg distribution with 75% duplicate rejection in `BB.genShop` (keeping 3-egg Spice 7+ stock) and weighted rare-egg picks in `BB.prizeChoices`.
  - Tuned `owl.target` `16 -> 13`, `turtle.target` `16 -> 14`, and `boar` `bonusHeavy` `+2 -> +3`.
  - Adjusted `Sprocket Squirrel` to trigger after the 6th egg (`after6Heat`, keeping `after5Heat` supported in `BB.eggHeat`) + `+3` bonus corn, and added `+3` bonus corn to `Saffron Cat`.
  - Preserved active `peek` when casting `Wish Egg` (unless burnt), and included `echo` in `Fussy Eater` basket relevance checks.
- **[`js/art.js`](bonus/chicken/js/art.js):**
  - Replaced the v1 3-cup road icon in `ART.place('den')` with Sizzle Dice art (two dice on green felt + sizzle flame).
- **[`js/game.js`](bonus/chicken/js/game.js) & [`style.css`](bonus/chicken/style.css):**
  - Used effective `BB.eggHeat(b, t)` and `.bag-h.zero` in `BK.bagList`, fixed `BK.status` priority/guards for `Slow Rise`, `Boiling Pot`, and `Mitt`.
  - Added distinct SFX/particles/burn FX for `chill`, `surge`, `baste`, `ward`, `wish`, and `swap` in `doCast`.
  - Named the target rung and multiplier on Sizzle Dice roll buttons (`→ Golden (×1.2): YY%`).
  - Added basket counts, egg stats, descriptions, and `1–9` hotkeys to `chooseUpgrade`; disabled `Preen` when neither feathers nor spell swaps are available; updated `How to Play` to mention Charms and unlockable spells.

---

## 3. Before / After Balance (`dev/sim.js --v2`, starter-spell bot)

Before: `400` runs/Spice (`den=skip`). After: `1,000` runs/Spice (`den=skip`, plus `1,000` Spice 0 runs in `den=opt` and `den=careless`).

| Spice / Mode | Design Target | Before Win% | After Win% | Pre-Baron Corn | Charms / Upgrades | After Boss Win Rates (`Badger/Boar · Owl/Turtle · Fox/Gala`) |
|---|---:|---:|---:|---:|---:|---|
| `0` Mild (`skip`) | 74% | 71.3% | **74.0%** | 22.7 | 5.79 / 3.13 | `81%/86% · 67%/72% · 83%/86%` |
| `0` Mild (`den=opt`) | — | — | **70.1%** | 18.5 | 5.39 / 2.73 | `denNet: −2.59` |
| `0` Mild (`den=careless`) | — | — | **67.1%** | 16.7 | 5.29 / 2.61 | `denNet: −7.52` |
| `1` Warm | 56% | 46.5% | **51.3%** | 17.8 | 4.54 / 2.63 | `62%/69% · 51%/56% · 74%/72%` |
| `2` Hot | 47% | 33.5% | **44.1%** | 18.6 | 3.81 / 2.36 | `65%/64% · 47%/51% · 70%/62%` |
| `3` Spicy | 35% | 30.5% | **39.1%** | 16.0 | 3.43 / 2.37 | `67%/62% · 40%/44% · 65%/55%` |
| `4` Scorching | 30% | 24.5% | **35.4%** | 16.0 | 3.14 / 2.02 | `63%/62% · 40%/46% · 70%/64%` |
| `5` Inferno | 16% | 10.0% | **18.0%** | 15.8 | 2.34 / 1.75 | `48%/43% · 27%/29% · 48%/43%` |
| `6` Smoked | 13% | 13.0% | **17.6%** | 17.7 | 1.87 / 1.47 | `34%/35% · 28%/33% · 56%/47%` |
| `7` Flashpoint | 6% | 6.8% | **10.4%** | 14.4 | 1.52 / 1.36 | `33%/34% · 21%/21% · 41%/43%` |
| `8` Bitter Crowd | 3% | 5.8% | **6.4%** | 15.0 | 1.14 / 1.20 | `25%/32% · 11%/17% · 31%/37%` |
| `9` Gilded Inferno | 1% | 1.8% | **3.1%** | 28.9 | 0.87 / 1.07 | `20%/24% · 8%/12% · 28%/25%` |

- Spice `0` hits the `74%` target cleanly; Spice `2` rises from `33.5%` to `44.1%` and Spice `5` from `10.0%` to `18.0%`.
- Every boss pair is balanced across acts, and the Spice `0–9` win curve is strictly monotonic.

---

## 4. Verification Summary (Post-Edit)

- `node dev/v2-rules-check.cjs`: **PASS** (20 charms, 36 eggs, 12 buyable eggs, exact burn & dice DP `0.9380` / `0.7741`, all triggers & spells).
- `node dev/v2-browser-check.cjs`: **PASS** (`file://`, 1280×720 & 1920×1080, Spice 0 & 9, both boss sets, all 9 spells, Sizzle Dice outcomes, Brood & nest spell swap, 0 console errors).
- `node dev/polish-check.cjs`: **PASS** (relevant quirks, stable Market DOM, 24-egg tray scroll, 40% pre-draw shudder & reduced motion, run recap).
- `node dev/audio-check.cjs`: **PASS** (44.1 kHz & 48 kHz offline renders, 0 clipped samples, smooth zero-start envelopes, live `file://` toggles).
- `node dev/playtest.cjs`: **PASS** (full keyboard and mouse playthroughs to victory at Spice 0 & 2, 0 console/page errors).
