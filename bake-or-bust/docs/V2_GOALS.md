# Bake or Bust! v2: player goals

The player loves the game: the short three-act journey, visible risk, exact odds, charm and offline simplicity. Keep all of that. v2 adds depth and replayability without bloat.

## Requested by the player
1. **Replace the gambling den.** The cup game is "way too OP and easy", and even blind guessing has positive expected value. Replace it with a different, thematic gambling minigame: a real push-your-luck or skill/risk decision with negative-to-neutral expected value for careless play, a payout cap per visit, and genuine tension.
2. **Much more interesting upgrades:** branching egg upgrades (e.g. at nests: a cooler or a puffier version of an egg) and combo/synergy eggs.
3. **Unlockable spells:** a pool of different feather spells, unlocked across runs, with a loadout or choice so runs differ.
4. **Relics (Kitchen Charms)** found during a run and kept for that run, giving passive boosts. They create build archetypes and give corn a real use, since runs currently end with about 135 unspent corn.
5. **Higher difficulty settings** beyond the current Spice levels, with real new challenge rather than just bigger numbers.
6. **Much more interesting opponents, especially later on:**
   - bosses telegraphed from the start of their act (portrait and house rule visible);
   - alternate bosses or rule twists;
   - late-game opponents with distinctive, rule-bending mechanics;
   - customer quirks that only roll when relevant, plus new rule-bending quirks.
7. **Polish and bugs:**
   - the egg tray overflows silently past 16 eggs;
   - the market re-renders and re-animates on every purchase;
   - irrelevant quirks roll;
   - odds estimates are unreliable for combo eggs;
   - add a richer end-of-run recap.
8. **Audio feel:**
   - music that reacts to oven heat (a tension layer near the limit);
   - unique chimes for special eggs;
   - wire up the unused hover sound;
   - a short "oven shudder" beat before high-risk draws.
   - Keep audio click-free: gains start at 0, with smooth ramps (see the recent fix in `js/audio.js`).

## Constraints
- It still runs offline by double-clicking `index.html`, with no build step, no network, and all art and audio made in code.
- Keep runs short (10–20 min) and readable. Every new mechanic must be legible in the UI, with exact odds where the game already shows odds.
- Saves stay backward-compatible with existing `localStorage` data, or migrate it cleanly.
