// Example module: a cozy farm where wolves raid from time to time.
// Adds a day/season loop with plots, planting, watering, harvesting and selling (campaign
// meta-system + Homestead panel), a rising wolf-threat clock, livestock to protect,
// crops that can be trampled in battle, pack-hunter AI, noise-making tools instead of weapons,
// a homestead map generator and a "hold out until dawn" objective.

const CROPS = {
  turnip: { name: 'Turnip', days: 2, price: 6 },
  bean: { name: 'Runner Bean', days: 3, price: 10 },
  pumpkin: { name: 'Pumpkin', days: 5, price: 22 },
};

function farm(ctx) {
  ctx.vars.farm ??= { day: 1, coins: 20, sheep: 6, threat: 0, plots: Array.from({ length: 8 }, () => ({ crop: null, growth: 0, watered: false })) };
  return ctx.vars.farm;
}

export default {
  id: 'cozy-farm',
  name: 'Homestead & Wolves',
  description: 'Day loop with plots/crops/coins, wolf-threat clock, livestock, trample-able crops, pack-hunter wolves, homestead maps, dawn objective.',

  setup(api) {
    // ---- tools, not weapons
    api.defineWeapon({ id: 'pitchfork', name: 'Pitchfork', kind: 'pitchfork', might: 4, hit: 85, range: [1, 2], damageType: 'jab', attackStat: 'brawn', defenseStat: 'hide', glyph: 'spear', description: 'Reach 1–2.' });
    api.defineWeapon({ id: 'slingshot', name: 'Slingshot', kind: 'slingshot', might: 2, hit: 88, range: [2, 4], damageType: 'pebble', attackStat: 'knack', defenseStat: 'hide', counter: false, glyph: 'sling', description: 'Range 2–4. A sting more than a wound.' });
    api.defineWeapon({ id: 'herding-nip', name: 'Herding Nip', kind: 'bite', might: 3, hit: 92, damageType: 'bite', attackStat: 'brawn', defenseStat: 'hide', glyph: 'fang', effects: [{ op: 'push', distance: 2 }], description: 'Drives the target back 2 tiles.' });

    api.defineStatus({ id: 'spooked', name: 'Spooked', duration: 2, tone: 'debuff', blocks: ['attack'], mods: { mov: 1 }, description: 'Cannot attack; runs from noise.' });
    api.defineStatus({ id: 'calm', name: 'Calm', duration: 2, tone: 'buff', mods: { hide: 2 }, description: 'Soothed: +2 hide.' });

    api.defineAbility({
      id: 'bang-pots', name: 'Bang the Pots', glyph: 'star', sound: 'pots', target: 'self', cost: { acts: 1 }, cooldown: 2,
      description: 'Every wolf within 3 tiles becomes Spooked for 2 turns (cannot attack, flees).',
      use(ctx, unit) {
        ctx.fx('burst', { at: unit, color: '#e0c893', size: 3 });
        for (const wolf of ctx.unitsInRadius(unit, 3, (u) => u.tags.includes('wolf'))) ctx.applyStatus(wolf, 'spooked', { source: unit });
      },
    });
    api.defineAbility({
      id: 'shepherd-whistle', name: 'Shepherd’s Whistle', glyph: 'whistle', sound: 'whistle', target: 'self', cost: { acts: 0 }, usesPerPhase: 1,
      description: 'Free, once per turn: every sheep moves up to 3 tiles toward you and becomes Calm.',
      use(ctx, unit) {
        for (const sheep of ctx.units((u) => u.tags.includes('livestock'))) {
          let best = null, bestDistance = ctx.distance(sheep, unit);
          for (const cell of ctx.reachable(sheep, 3)) { const d = ctx.distance(cell, unit); if (d < bestDistance) { bestDistance = d; best = cell; } }
          if (best) ctx.move(sheep, best);
          ctx.applyStatus(sheep, 'calm', { source: unit });
        }
      },
    });
    api.defineAbility({
      id: 'plant-scarecrow', name: 'Plant Scarecrow', glyph: 'leaf', target: 'tile', filter: 'empty', range: [1, 2], cost: { acts: 1, items: { scarecrow: 1 } },
      description: 'Stand a scarecrow on an empty tile within 2. Wolves will not step next to it.',
      use(ctx, unit, tile) { ctx.spawn({ template: 'scarecrow', faction: unit.faction, pos: tile }); },
    });

    // ---- the cast
    api.defineUnit({ id: 'farmhand', name: 'Farmhand', title: 'Homesteader', maxHp: 20, mov: 4, stats: { brawn: 6, knack: 6, hide: 3, spd: 6 }, tags: ['farmer'], sprite: { body: 'humanoid', primary: '#7d6a2c', secondary: '#e9dfc5' }, weapons: ['pitchfork'], abilities: ['bang-pots'] });
    api.defineUnit({ id: 'sheepdog', name: 'Sheepdog', title: 'Working dog', maxHp: 16, mov: 6, stats: { brawn: 5, knack: 4, hide: 3, spd: 11 }, tags: ['dog'], sprite: { body: 'beast', primary: '#3d3a36', secondary: '#f1eadb' }, weapons: ['herding-nip'] });
    api.defineUnit({ id: 'sheep', name: 'Sheep', title: 'Livestock', maxHp: 10, mov: 3, stats: { hide: 1, spd: 3 }, tags: ['livestock'], ai: 'graze', sprite: { body: 'blob', primary: '#efe9da', secondary: '#4b4640' }, weapons: [] });
    api.defineUnit({ id: 'wolf', name: 'Wolf', title: 'Hungry raider', maxHp: 14, mov: 6, stats: { brawn: 7, hide: 2, spd: 10, skl: 5 }, tags: ['wolf', 'beast'], ai: 'pack-hunter', sprite: { body: 'beast', primary: '#5c6166', secondary: '#c8ccd0' }, weapons: [{ name: 'Snapping Jaws', kind: 'bite', might: 3, hit: 86, damageType: 'bite', attackStat: 'brawn', defenseStat: 'hide', glyph: 'fang' }] });
    api.defineUnit({ id: 'alpha-wolf', name: 'Old Greyback', title: 'Pack alpha', maxHp: 26, mov: 6, level: 3, stats: { brawn: 9, hide: 4, spd: 11, skl: 7 }, tags: ['wolf', 'beast', 'alpha'], ai: 'pack-hunter', sprite: { body: 'beast', primary: '#3f4347', secondary: '#e4e6e8', scale: 1.2 }, weapons: [{ name: 'Rending Jaws', kind: 'bite', might: 5, hit: 88, damageType: 'bite', attackStat: 'brawn', defenseStat: 'hide', glyph: 'fang' }] });
    api.defineUnit({ id: 'scarecrow', name: 'Scarecrow', title: 'Straw sentinel', maxHp: 8, mov: 0, stats: { hide: 0 }, tags: ['scarecrow'], ai: 'passive', sprite: { body: 'plant', primary: '#b58a4a', secondary: '#6d4b2a' }, weapons: [] });

    api.defineAi({ id: 'graze', description: 'Sheep drift a tile or two and bolt from wolves.', plan(ctx, unit) {
      const wolves = ctx.units((u) => u.tags.includes('wolf') && ctx.distance(u, unit) <= 4);
      const cells = ctx.reachable(unit, wolves.length ? 3 : 1);
      if (!cells.length) return null;
      if (!wolves.length) return ctx.rng.chance(30) ? { move: ctx.rng.pick(cells) } : null;
      let best = null, bestDistance = Math.min(...wolves.map((w) => ctx.distance(w, unit)));
      for (const cell of cells) { const d = Math.min(...wolves.map((w) => ctx.distance(w, cell))); if (d > bestDistance) { bestDistance = d; best = cell; } }
      return best ? { move: best } : null;
    } });

    // Wolves want mutton, avoid scarecrows, and slink off once the pack is broken.
    api.defineAi({ id: 'pack-hunter', description: 'Prefers livestock, avoids scarecrows, flees when Spooked or when alone and hurt.', plan(ctx, unit) {
      const pack = ctx.units((u) => u.tags.includes('wolf') && u.id !== unit.id);
      const threats = ctx.enemies(unit).filter((e) => !e.tags.includes('livestock') && !e.tags.includes('scarecrow'));
      if (ctx.hasStatus(unit, 'spooked') || (pack.length === 0 && unit.hp < unit.maxHp / 2)) {
        let best = null, bestDistance = -1;
        for (const cell of ctx.reachable(unit)) { const d = Math.min(99, ...threats.map((t) => ctx.distance(t, cell))); if (d > bestDistance) { bestDistance = d; best = cell; } }
        if (best && (best.x === 0 || best.y === 0 || best.x === ctx.map.width - 1 || best.y === ctx.map.height - 1) && !ctx.hasStatus(unit, 'spooked')) { ctx.move(unit, best); ctx.remove(unit, 'fled'); return null; }
        return best ? { move: best } : null;
      }
      return undefined;
    } });
    api.on('ai:score', (ev, ctx) => {
      if (!ev.unit.tags.includes('wolf')) return;
      if (ev.target.tags.includes('livestock')) ev.score += 12;
      if (ev.target.tags.includes('scarecrow')) ev.score -= 100;
      if (ctx.unitsInRadius(ev.cell, 1, (u) => u.tags.includes('scarecrow')).length) ev.score -= 30;
    });

    // ---- terrain: crops can be trampled, and that matters after the battle
    api.defineTile({ id: 'crop-row', name: 'Crop row', look: 'crop', avoid: 5, tags: ['crop'], description: 'Trampled if a wolf crosses it.', onEnter(ctx, unit, at) {
      if (!unit.tags.includes('wolf')) return;
      ctx.setTile(at.x, at.y, 'trampled');
      ctx.result.vars.trampled = (ctx.result.vars.trampled ?? 0) + 1;
      ctx.float(at, 'Trampled!', 'debuff');
    } });
    api.defineTile({ id: 'trampled', name: 'Trampled crops', look: 'mud', description: 'Ruined planting.' });
    api.defineTile({ id: 'barn-floor', name: 'Barn floor', look: 'floor', defense: 1, description: '+1 hide. Livestock are safest here.' });

    api.defineMapGenerator({ id: 'homestead', description: 'Farmhouse and barn in the west, fenced pasture, crop rows, a pond, forest edge to the east.', generate(gen) {
      const { width: w, height: h } = gen;
      gen.fill('grass');
      gen.blobs('forest', 0.18, 5);
      gen.rect(0, 0, Math.floor(w * 0.6), h, 'grass');
      gen.blobs('tall-grass', 0.08, 4, 'grass');
      gen.rect(1, 1, 5, 4, 'wall', true); gen.rect(2, 2, 3, 2, 'barn-floor'); gen.set(3, 4, 'barn-floor'); // barn with a door
      gen.rect(2, Math.floor(h / 2) - 1, Math.floor(w * 0.3), Math.max(3, Math.floor(h / 3)), 'crop-row');
      const px = Math.floor(w * 0.36), py = 1, pw = Math.max(5, Math.floor(w * 0.22)), ph = Math.max(4, Math.floor(h * 0.35));
      gen.rect(px, py, pw, ph, 'fence', true); gen.set(px + Math.floor(pw / 2), py + ph - 1, 'grass'); // pasture gate
      gen.circle(Math.floor(w * 0.5), h - 3, 2, 'water');
      gen.line(0, h - 1, Math.floor(w * 0.55), h - 1, 'road');
    } });

    // "Dawn" objective: win when the night is over; lose if too few sheep survive.
    api.defineObjective({ id: 'dawn', check: (ctx, cond) => ctx.round > (cond.rounds ?? 6), describe: (cond) => `Hold out until dawn (${cond.rounds ?? 6} rounds)` });
    api.defineObjective({ id: 'flock-lost', check: (ctx, cond) => ctx.state.units.filter((u) => u.tags.includes('livestock') && u.alive).length < (cond.min ?? 1) });

    // ---- farm life: commands the panel and the Narrator can run
    api.on('module:installed', (ev, ctx) => {
      farm(ctx);
      ctx.addItem('turnip-seed', 4, { name: 'Turnip seed', kind: 'seed' });
      ctx.addItem('bean-seed', 2, { name: 'Runner bean seed', kind: 'seed' });
      ctx.addItem('scarecrow', 1, { name: 'Scarecrow', kind: 'tool' });
      ctx.log('The homestead ledger is open: 8 plots, 6 sheep, 20 coins, a handful of seed.');
    });
    api.command('farm.plant', (ctx, args) => {
      const state = farm(ctx), plot = state.plots[args.plot];
      if (!plot || plot.crop) throw new Error('That plot is not free.');
      if (!CROPS[args.crop] || !ctx.removeItem(`${args.crop}-seed`, 1)) throw new Error('No seed of that kind.');
      plot.crop = args.crop; plot.growth = 0; plot.watered = false;
    }, 'Plant a seed: { plot, crop }');
    api.command('farm.water', (ctx, args) => { const plot = farm(ctx).plots[args.plot]; if (plot?.crop) plot.watered = true; }, 'Water a plot: { plot }');
    api.command('farm.harvest', (ctx, args) => {
      const plot = farm(ctx).plots[args.plot], crop = CROPS[plot?.crop];
      if (!crop || plot.growth < crop.days) throw new Error('Nothing ripe there.');
      ctx.addItem(plot.crop, 1, { name: crop.name, kind: 'produce' });
      plot.crop = null; plot.growth = 0; plot.watered = false;
    }, 'Harvest a ripe plot: { plot }');
    api.command('farm.sell', (ctx, args) => {
      const crop = CROPS[args.crop], state = farm(ctx);
      if (!crop || !ctx.removeItem(args.crop, 1)) throw new Error('Nothing to sell.');
      state.coins += crop.price;
    }, 'Sell one produce: { crop }');
    api.command('farm.buySeed', (ctx, args) => {
      const crop = CROPS[args.crop], state = farm(ctx), price = Math.ceil((crop?.price ?? 99) / 3);
      if (!crop || state.coins < price) throw new Error('Not enough coins.');
      state.coins -= price; ctx.addItem(`${args.crop}-seed`, 1, { name: `${crop.name} seed`, kind: 'seed' });
    }, 'Buy one seed: { crop }');
    api.command('farm.sleep', (ctx) => {
      const state = farm(ctx);
      state.day += 1;
      for (const plot of state.plots) { if (plot.crop && plot.watered) plot.growth += 1; plot.watered = false; }
      state.threat = Math.min(5, state.threat + (ctx.rng.chance(60) ? 1 : 0) + (state.sheep > 4 ? 1 : 0));
      ctx.log(`Day ${state.day} dawns. ${state.threat >= 4 ? 'Paw prints circle the pasture fence — the wolves are close.' : 'The valley is quiet.'}`);
    }, 'End the day: crops grow if watered, the wolf threat creeps up.');

    api.on('battle:resolved', (ev, ctx) => {
      const state = farm(ctx);
      const flock = ev.battle.units.filter((u) => u.tags.includes('livestock'));
      if (!flock.length) return;
      const lost = flock.filter((u) => !u.alive).length, trampled = ev.result.vars.trampled ?? 0;
      state.sheep = Math.max(0, state.sheep - lost);
      state.threat = 0;
      let ruined = 0;
      for (const plot of state.plots) if (plot.crop && ruined < Math.ceil(trampled / 4)) { plot.crop = null; plot.growth = 0; ruined++; }
      ctx.log(`After the raid: ${lost} sheep lost (${state.sheep} left), ${ruined} planted plot(s) ruined.`);
    });
    api.on('narrator:context', (ev, ctx) => {
      const state = farm(ctx);
      ev.lines.push(`Farm: day ${state.day}, ${state.coins} coins, ${state.sheep} sheep, wolf threat ${state.threat}/5${state.threat >= 4 ? ' (a night raid is due — start a battle on a "homestead" map)' : ''}; plots: ${state.plots.map((p, i) => `${i}:${p.crop ? `${p.crop} ${p.growth}/${CROPS[p.crop].days}` : 'empty'}`).join(' ')}.`);
    });

    api.panel({
      id: 'homestead', title: 'Homestead', icon: '❦', scope: 'story',
      render(ui) {
        const h = ui.h, c = ui.campaign, state = c.vars.farm;
        if (!state) return h('p', { class: 'ext-muted' }, 'The ledger is blank.');
        const count = (id) => c.inventory.find((i) => i.id === id)?.qty ?? 0;
        return h('div', { class: 'ext-panel', 'data-testid': 'homestead-panel' },
          h('div', { class: 'ext-stats' }, h('span', {}, `Day ${state.day}`), h('span', {}, `${state.coins} coins`), h('span', {}, `${state.sheep} sheep`)),
          h('div', { class: 'ext-row' }, h('span', {}, 'Wolf threat'), ui.meter(state.threat, 5, `${state.threat}/5`)),
          h('h4', {}, 'Plots'),
          h('div', { class: 'ext-grid ext-grid-tight' }, ...state.plots.map((plot, index) => {
            const crop = CROPS[plot.crop];
            return h('div', { class: 'ext-card ext-card-column' },
              h('strong', {}, crop ? crop.name : `Plot ${index + 1}`),
              crop ? ui.meter(plot.growth, crop.days, plot.growth >= crop.days ? 'ripe' : `${plot.growth}/${crop.days}${plot.watered ? ' · watered' : ''}`) : h('span', { class: 'ext-muted' }, 'fallow'),
              crop
                ? (plot.growth >= crop.days
                  ? h('button', { class: 'btn btn-compact btn-primary', onclick: () => ui.send('farm.harvest', { plot: index }) }, 'Harvest')
                  : h('button', { class: 'btn btn-compact', disabled: plot.watered, onclick: () => ui.send('farm.water', { plot: index }) }, 'Water'))
                : h('span', { class: 'ext-actions' }, ...Object.keys(CROPS).filter((id) => count(`${id}-seed`) > 0).map((id) =>
                  h('button', { class: 'btn btn-compact', onclick: () => ui.send('farm.plant', { plot: index, crop: id }) }, `Sow ${id}`))));
          })),
          h('h4', {}, 'Market'),
          h('div', { class: 'ext-actions' },
            ...Object.entries(CROPS).map(([id, crop]) => h('button', { class: 'btn btn-compact', disabled: count(id) < 1, onclick: () => ui.send('farm.sell', { crop: id }) }, `Sell ${crop.name} (+${crop.price})`)),
            ...Object.entries(CROPS).map(([id, crop]) => h('button', { class: 'btn btn-compact btn-ghost', disabled: state.coins < Math.ceil(crop.price / 3), onclick: () => ui.send('farm.buySeed', { crop: id }) }, `Buy ${id} seed (${Math.ceil(crop.price / 3)})`))),
          h('button', { class: 'btn btn-secondary', 'data-testid': 'farm-sleep', onclick: () => ui.send('farm.sleep', {}) }, 'Sleep until morning'));
      },
    });

    api.sound('pots', { voices: [{ wave: 'noise', dur: 0.09, gain: 0.3, filter: { type: 'bandpass', freq: 2400, q: 4 } }, { wave: 'noise', dur: 0.09, gain: 0.3, delay: 0.12, filter: { type: 'bandpass', freq: 3100, q: 4 } }, { wave: 'noise', dur: 0.12, gain: 0.3, delay: 0.24, filter: { type: 'bandpass', freq: 2000, q: 4 } }] });
    api.sound('whistle', { voices: [{ wave: 'sine', freq: [1400, 2100], dur: 0.22, gain: 0.2 }, { wave: 'sine', freq: [2100, 1700], dur: 0.18, gain: 0.2, delay: 0.22 }] });
    api.music('story', { tempo: 76, root: 55, scale: [0, 2, 4, 7, 9], progression: [0, 3, 4, 0], layers: { pad: 0.5, pluck: 0.55, bass: 0.3, drums: 0, lead: 0.35 }, pluckWave: 'triangle' });

    api.describe([
      'Daily life runs through commands: farm.plant {plot, crop}, farm.water {plot}, farm.harvest {plot}, farm.sell {crop}, farm.buySeed {crop}, farm.sleep {}. Crops: turnip, bean, pumpkin.',
      'vars.farm.threat rises as days pass; at 4+ stage a night raid: map { "generator": "homestead", "width": 30, "height": 20 }, units farmhand/sheepdog/sheep (faction "flock", controller ai, alliedWith the player) versus wolf / alpha-wolf.',
      'Raid objective: { "win": [{ "type": "dawn", "rounds": 6 }, { "type": "rout" }], "lose": [{ "type": "flock-lost", "min": 2 }] }.',
      'Abilities: bang-pots (spook wolves), shepherd-whistle (gather sheep), plant-scarecrow (needs item scarecrow).',
    ].join('\n'));
  },
};
