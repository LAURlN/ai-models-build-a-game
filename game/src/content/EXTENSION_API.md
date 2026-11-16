# Chronicle Tactics — extension API (limitless-1)

Generated content is **code**. A module is one ES module file in `modules/` of the campaign
workspace (`.js`, `.mjs` or `.ts`), hot-loaded by the game the moment it is written. There
is no allow-list and no fixed vocabulary: define any weapon kind, stat, resource, status,
ability, AI, terrain, objective, encounter mode, meta-system, UI panel, visual or sound.
If a module throws, the game catches it, keeps playing without it, and sends a helper to
repair it with the error text — so write boldly.

```js
// modules/tide-tables.js
export default {
  id: 'tide-tables',                      // stable, kebab-case
  name: 'Tide Tables',
  description: 'One line: what this adds.',
  setup(api) {
    api.defineWeapon({ id: 'ledger-hook', name: 'Ledger Hook', kind: 'hook', might: 4, hit: 85, range: [1, 2],
      damageType: 'snag', attackStat: 'wit', defenseStat: 'poise', glyph: 'hook', description: 'Reach 1–2.' });
    api.defineStatus({ id: 'soaked', name: 'Soaked', duration: 2, mods: { spd: -2 }, tone: 'debuff' });
    api.defineAbility({
      id: 'read-the-swell', name: 'Read the Swell', target: 'unit', range: [1, 4], cost: { acts: 1 },
      description: 'Soak a target and drag it 2 tiles toward you.',
      preview: (ctx, unit, target) => `Pulls ${target.name} 2 tiles`,
      use(ctx, unit, target) {
        ctx.applyStatus(target, 'soaked', { source: unit });
        ctx.push(target, Math.sign(unit.pos.x - target.pos.x), Math.sign(unit.pos.y - target.pos.y), 2);
        ctx.float(target, 'Dragged!', 'debuff');
      },
    });
    api.on('round:start', (ev, ctx) => { if (ev.round % 3 === 0) ctx.log('The tide turns.'); });
    api.describe('Narrator notes: weapon ledger-hook, ability read-the-swell, status soaked.');
  },
};
```

The **same file is loaded twice**: in the simulation worker (Node; rules, AI, campaign
systems — you may `import` Node built-ins there) and in the renderer (browser; panels,
drawing, sound). Registration is identical on both sides. Do not touch `window`/`document`
or Node APIs at module top level; use them inside the functions that run on that side.
`api.side` is `'sim'` or `'view'`.

## Determinism, saving and the Turnwheel

- Keep **all state in the JSON state objects**: `ctx.vars` (battle), `unit.vars`,
  `unit.resources`, `ctx.world.vars` / campaign `ctx.vars` (persistent), `ctx.result`.
  Module-level variables are lost on save, rewind and reload.
- Use `ctx.rng` for every random decision — never `Math.random()`. The stream position is
  part of the state, so rewinds and saves replay identically.
- A battle command runs in a transaction on a snapshot. The Turnwheel restores snapshots,
  so anything you keep in state rewinds for free.

## Registration (`api.*`)

| Call | Purpose |
| --- | --- |
| `defineWeapon(w)` | `{ id, name, kind, might, hit, crit, weight, range:[min,max], damageType, attackStat, defenseStat, los, counter, tags, glyph, description, effects:[…], area:{shape,size}, onHit(ctx, ev) }`. `kind`, `damageType` and the stat names are free text. |
| `defineAbility(a)` | Active or passive. `{ id, name, description, glyph, sound, fx, target:'self'|'unit'|'tile'|'none', filter:'enemy'|'ally'|'any'|'other'|'empty', range, los, area, cost:{ acts, hp, resources:{k:n}, items:{id:n} }, cooldown, usesPerPhase, usesPerBattle, effects:[…], canUse(ctx,unit)→bool|reason, targets(ctx,unit)→units/tiles, preview(ctx,unit,target)→text, use(ctx,unit,target), ai(ctx,unit)→{target,score}, hooks:{ 'event'(ev,ctx,owner){} } }`. A unit may have any number. `cost.acts: 0` = free action. |
| `defineStatus(s)` | `{ id, name, description, duration, stacking:'refresh'|'add'|'replace', maxStacks, mods:{stat:n}, blocks:['move','act','attack','ability','counter'], tick:[…effects], tone:'buff'|'debuff'|'neutral', onApply, onTick, onExpire, hooks }`. `duration` = number of the owner's phases; `-1` = until removed. |
| `defineUnit(t)` / `defineClass(t)` | Template: `{ id, name, title, maxHp, mov, moveType, stats:{…any}, weapons:[ids or inline], abilities, tags, ai, level, actsPerTurn, vars, sprite:{ body, primary, secondary, accent, scale, drawer } }`. Bodies: `humanoid, beast, bird, serpent, blob, construct, machine, spirit, plant, swarm`. |
| `defineTile(t)` | `{ id, name, look, color, cost, costs:{moveType:n}, blocksMove, blocksSight, defense, avoid, tags, hazard:[…effects], onEnter(ctx,unit,at), onEndPhase(ctx,unit) }`. Looks: `plain grass tallgrass forest water deepwater wall rock sand road floor mud snow ice rubble bridge crop fence lava metal void`. |
| `defineItem(i)` | Inventory item metadata `{ id, name, kind, description }`. |
| `defineAi(a)` | `{ id, plan(ctx, unit) }` → `{ move:{x,y}, attack:unitId, weapon:n }` or `{ ability:id, target }`, `null` = do nothing, `undefined` = fall through to built-in tactics. Units/factions select it with `ai: id`. Built-ins: `aggressive, defensive, guard, skittish, wander, passive, berserk`. |
| `defineObjective(o)` | `{ id, check(ctx, cond)→bool, describe(cond) }`, used in specs as `{ type: id, … }`. |
| `defineMapGenerator(g)` | `{ id, generate(gen) }` with `gen.width/height/rng/params`, `fill, set, get, rect, line, circle, scatter, blobs, noise`. |
| `defineMode(m)` | New encounter mode. `{ id, name, grid:false, init(ctx, spec), commands:{ name(ctx,args){} }, view:{ render(ui) } }`. With `grid:false` the board is replaced by your view: card duels, chases, debates, rhythm, anything. |
| `matchup(m)` | Relationship table instead of a weapon triangle: `{ attacker:{kind|tag|damageType}, defender:{tag|classId|kind}, might, hit, damagePct, note }`. |
| `on(event, fn, {priority})` | Global hook, see events below. |
| `command(name, fn(ctx,args), description)` | Campaign-level command (meta-systems). Run by panels (`ui.send`) and by the Narrator. |
| `battleCommand(name, fn(ctx,args))` | Custom in-battle command (`ui.battleSend`). |
| `panel(p)` | `{ id, title, icon, scope:'story'|'battle'|'both', render(ui) }` → DOM node. |
| `drawUnit(id, fn(g, unit, env))`, `drawTile(id, fn(g, tile, env))`, `effect(id, { duration, draw(g, t, cue, env) })` | Procedural Pixi drawing (see Visuals). |
| `sound(id, recipe)`, `music(mood, theme)` | Procedural audio (see Sound). |
| `describe(text)` | Usage notes shown to the Narrator every turn: template ids, how to stage battles with this module, commands. **Always call this.** |

Declarative sugar is accepted too: `export default { id, weapons:{…}, abilities:{…}, statuses, units, tiles, hooks:{ 'event': fn }, commands, sounds, music }`.

## Battle context (`ctx`) — passed to every sim function

State: `ctx.state` (everything), `ctx.vars`, `ctx.world.inventory`, `ctx.world.vars`
(campaign vars, written back after the battle), `ctx.result` (`captured`, `loot`, `notes`,
`vars`), `ctx.map`, `ctx.round`, `ctx.rng` (`next, int(n), range(a,b), chance(pct), pick, shuffle, weighted`).

Queries: `unit(id)`, `units(filter)`, `unitAt(x,y)`, `allies(u)`, `enemies(u)`, `isHostile(a,b)`,
`isPlayerControlled(u)`, `distance(a,b)`, `los(a,b)`, `tile(x,y)`, `tileId(x,y)`, `unitsInRadius(at,r,filter)`,
`cellsInRange(at,min,max)`, `reachable(u, budget?)`, `path(u,to)`, `stat(u,'name')`, `movOf(u)`,
`hasStatus(u,id)`, `status(u,id)`, `hasAbility(u,id)`, `item(id)`, `itemCount(id)`, `combat(a,b,weapon)`.

Actions: `damage(target, n, {source,type})`, `heal(target, n)`, `applyStatus(target, id, {duration,stacks,data,source})`,
`removeStatus(target,id)`, `move(u,to)`, `teleport(u,to)`, `push(u,dx,dy,n)`, `attack(a,b,weaponIndex)`,
`spawn(unitSpec, near)`, `defeat(u)`, `remove(u,'fled')`, `capture(u, by)`, `grantAction(u,n)`,
`addResource(u,key,n)`, `addItem(id,qty)`, `useItem(id,qty)`, `loot(id,qty,name)`, `setTile(x,y,tileId)`,
`runEffects(ops,{source,target,area})`, `endBattle(outcome, reason)`, `emit(event, payload)`.

Feedback (always give the player some): `log(text)`, `float(unitOrTile, text, 'buff'|'debuff'|'info')`,
`fx(id, {at,from,to,color,size})` (built-ins: `ring burst beam sparkle shock ripple`), `sound(id)`.

Units are plain objects: `{ id, name, title, classId, faction, pos, hp, maxHp, mov, moveType, stats, weapons, equipped, abilities, statuses, tags, vars, resources, acts, moved, alive, gone, ai, sprite, rosterId, level }`. You may mutate them directly (use `ctx.move/teleport` for positions).

### Events (`api.on` and `hooks` on abilities/statuses)

Hooks on an ability/status fire only when its owner is `ev.unit` or `ev.target` (or for
unit-less events) and receive `(ev, ctx, owner, statusInstance)`. Mutable fields are marked *.

`battle:start {spec}` · `battle:end {outcome,reason}` · `round:start {round}` · `phase:start/phase:end {faction}` ·
`turn:start {unit}` · `move:cost {unit,x,y,tile,cost*}` · `move:before {unit,to,path,cancel*,reason*}` ·
`move:step {unit,x,y,tile,stop*}` · `move:after {unit,from,to,path}` · `target:filter {unit,target,weapon,allowed*}` ·
`combat:calc {unit,target,weapon,power*,defense*,damage*,hit*,crit*,notes*}` (runs for forecasts too — no side effects) ·
`attack:before {unit,target,weapon,cancel*}` · `strike {unit,target,weapon,role,outcome*,damage*}` ·
`attack:after {unit,target,weapon,strikes}` · `damage:before {unit,target,amount*,type,cause}` · `damage:after` ·
`heal:before {amount*}` · `heal:after` · `unit:defeated {unit(killer),target,prevent*}` · `unit:removed {target,reason}` ·
`unit:captured` · `unit:spawned {target}` · `status:applied/tick/expired {target,status,def}` ·
`ability:before {unit,ability,target,cancel*}` · `ability:used` · `stat:calc {unit,stat,value*}` ·
`ai:plan {unit,plan*}` · `ai:score {unit,target,weapon,cell,score*}` · `objective:check {outcome*,reason*}`.

### Declarative effects (for simple cases; code is never required to fit them)

`effects`, `tick` and tile `hazard` take steps such as `{op:'damage', amount, stat, times, type}`,
`heal`, `status {id,duration,stacks}`, `removeStatus`, `push/pull {distance}`, `teleport`, `swap`,
`grantAction`, `resource {key,amount}`, `summon {template,count}`, `tile {tile}`, `capture`, `remove`,
`var {key,amount}`, `loot`, `float`, `fx`, `sound`, `log`, `end {outcome}`; add `to:'source'` or
`area:{shape:'burst'|'line'|'cross'|'cone', size}` + `affects:'enemy'|'ally'|'any'`.

## Campaign scope: meta-systems

`api.command` handlers and the campaign events get a campaign context:
`ctx.campaign` (roster, inventory, factions, relationships, places, threads, vars, rules), `ctx.vars`,
`ctx.rng`, `ctx.log(line)` (appears in the story log), `ctx.addItem/removeItem/itemCount/item`,
`ctx.unit(id)`, `ctx.roster(filter)`, `ctx.addUnit(raw | {template})`, `ctx.addFact(text)`.

Events: `module:installed {module}` (once per campaign — seed your state here),
`battle:build {spec*}`, `battle:resolved {battle, result, record, capturedHandled*}`,
`narrator:context {lines*}` (push one-line status the Narrator should always know).

Build catching, crafting, farming, shops, reputation, levelling, calendars… as: state in
`ctx.vars.<yourSystem>`, commands that mutate it, a panel that shows it, a
`narrator:context` line, and `battle:resolved` to fold battle results in.

## UI (`panel.render(ui)` and `mode.view.render(ui)`)

`ui.h(tag, props, ...children)` builds DOM (`class`, `style`, `onclick`, `disabled`, `data-*`, …).
`ui.campaign` (live campaign; during battle inventory/vars reflect the battle), `ui.battle` (state or null),
`ui.selected` (selected unit or null), `ui.send(command, args)`, `ui.battleSend(command, args)`,
`ui.sprite(unitLike, size)`, `ui.meter(value, max, label)`, `ui.sound(id)`.
Classes that match the game's look: `ext-panel ext-card ext-card-body ext-grid ext-row ext-stats ext-actions ext-muted btn btn-primary btn-secondary btn-ghost btn-compact pill`.
Panels re-render on every state change: keep `render` pure and derive everything from `ui`.

## Visuals (procedural only — no image files, no network)

`api.drawUnit(spriteDrawerId, (g, unit, env) => {…})` draws a token with a PixiJS `Graphics`
centred on (0,0) within ±`env.tile/2`; select it with `sprite: { drawer: id }`.
`api.drawTile(tileIdOrLook, (g, tile, env) => {…})` draws in a `env.tile`-sized square at (0,0);
`env.seed` is a stable per-cell hash, `env.x/env.y` the cell.
`api.effect(id, { duration, draw(g, t, cue, env) })` with `t` from 0→1 and `env.center(cell)`.
Palette (`env.palette`): ink `#243c3b`, paper `#e3d8ba`, brass `#c4a15d`, cream `#fff2d4`, teal `#23657a`, vermilion `#9e4536`.
Style: engraved atlas — flat fills, 1–2 px ink outlines, restrained colour. Without custom
drawing, units get a faction-shaped token with a procedural body plan and tiles get their `look`.

## Sound (WebAudio synthesis only)

`api.sound(id, { voices: [{ wave:'sine'|'triangle'|'square'|'sawtooth'|'noise', freq: 440 | [from,to], dur, gain, delay, attack, release, filter:{type,freq,q} }] })`.
Play with `ctx.sound(id)` or `ability.sound`. Override built-in cues by reusing their ids:
`ui.click ui.select ui.deny move attack.swing attack.hit attack.miss attack.crit defeat ability status.buff status.debuff heal phase.player phase.enemy victory defeat.stinger capture helper.done`.
`api.music(mood, { tempo, root (MIDI), scale:[semitones], progression:[degrees], layers:{pad,pluck,bass,drums,lead}, pluckWave })` for moods `story tense battle danger victory defeat`.

## Battle specs (`battles/*.json`, or inline from the Narrator)

```json
{
  "title": "Night Raid", "intro": "…", "mode": "grid",
  "map": { "width": 40, "height": 28, "generator": "wilds", "base": "grass",
           "features": [{ "tile": "forest", "amount": 0.15, "scale": 5 }],
           "stamps": [{ "tile": "road", "line": [0, 14, 39, 14] }, { "tile": "wall", "rect": [18, 4, 6, 5], "hollow": true }],
           "tiles": { "shrine": { "name": "Shrine", "look": "floor", "defense": 2 } } },
  "factions": [{ "id": "party", "controller": "player" },
               { "id": "pack", "controller": "ai", "hostileTo": ["party", "flock"], "ai": "pack-hunter" },
               { "id": "flock", "controller": "ai", "hostileTo": ["pack"] }],
  "units": [{ "roster": "all", "faction": "party", "area": "west" },
            { "template": "wolf", "faction": "pack", "count": 12, "area": [28, 0, 39, 27] },
            { "name": "Old Greyback", "faction": "pack", "pos": [36, 14], "maxHp": 30, "stats": { "brawn": 9 },
              "weapons": [{ "name": "Rending Jaws", "kind": "bite", "might": 5 }], "abilities": ["howl"] }],
  "objective": { "text": "Hold until dawn", "win": [{ "type": "survive", "rounds": 6 }], "lose": [{ "type": "protect", "tag": "livestock" }], "turnLimit": 0 },
  "abilities": { "howl": { "name": "Howl", "target": "self", "effects": [{ "op": "status", "id": "bold", "area": { "shape": "burst", "size": 3 }, "affects": "ally" }] } },
  "statuses": { "bold": { "name": "Bold", "mods": { "brawn": 2 }, "duration": 2 } },
  "rules": { "turnwheelCharges": 3, "followUpThreshold": 4, "critMultiplier": 3 }
}
```

- No caps on map size, unit counts, factions or abilities. Generators: `open wilds caves rooms streets islands` + module generators; or explicit `rows` with a `legend`.
- `area`: `[x0,y0,x1,y1]` or `west east north south center northwest…`; `pos`: `[x,y]`. Bad positions snap to the nearest free tile.
- Conditions: `rout {faction?}`, `defeat {unit|tag|template}`, `seize/reach {at|area,count}`, `survive {rounds}`, `protect {unit|tag}`, `captured {count}`, `var {key, gte|lte|eq}`, `wipe`, plus module objectives. Any condition may set `"outcome"` (custom outcomes flow into the story) and `"reason"`.
- Default combat (override via `combat:calc`/`strike`): damage = attackStat + might − defenseStat − tile defense; hit% = weapon hit + 2·skl + lck − 2·target speed − target lck − tile avoid; crit% = weapon crit + skl/2 − target lck; speed lead ≥ `followUpThreshold` strikes twice; the defender counters if its weapon reaches. Missing stats count as 0 — invent stat names that fit the setting.
- There are no fairness or winnability checks. Hopeless fights and game overs are legitimate.
