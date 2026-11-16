// Example module: a creature-catching adventure.
// Adds wild species with elemental matchups, a snare-orb capture mechanic, herd AI,
// a "catch N" objective, party/box storage as a campaign meta-system, and a storage-box UI panel.
// Everything is ordinary JavaScript: change formulas, add species, replace the UI.

const SPECIES = [
  { id: 'emberpup', name: 'Emberpup', element: 'ember', body: 'beast', primary: '#c8553d', secondary: '#f2c078', maxHp: 22, mov: 5, stats: { pow: 9, grit: 4, spd: 9, skl: 6 }, attack: { name: 'Cinder Bite', kind: 'bite', might: 4, hit: 88 } },
  { id: 'mossling', name: 'Mossling', element: 'moss', body: 'blob', primary: '#6f9a5b', secondary: '#c9d7a3', maxHp: 28, mov: 3, stats: { pow: 7, grit: 7, spd: 4, skl: 5 }, attack: { name: 'Spore Slap', kind: 'slam', might: 3, hit: 92 } },
  { id: 'galewing', name: 'Galewing', element: 'gale', body: 'bird', primary: '#7fa7b8', secondary: '#eef2e2', maxHp: 18, mov: 6, moveType: 'fly', stats: { pow: 8, grit: 3, spd: 12, skl: 9 }, attack: { name: 'Shear Gust', kind: 'gust', might: 3, hit: 90, range: [1, 2] } },
  { id: 'tidefin', name: 'Tidefin', element: 'tide', body: 'serpent', primary: '#3f7f9a', secondary: '#bfe0dc', maxHp: 24, mov: 4, moveType: 'swim', stats: { pow: 8, grit: 5, spd: 8, skl: 7 }, attack: { name: 'Brine Lash', kind: 'lash', might: 4, hit: 86, range: [1, 2] } },
  { id: 'cragback', name: 'Cragback', element: 'stone', body: 'construct', primary: '#8a8170', secondary: '#d3c8a8', maxHp: 34, mov: 3, stats: { pow: 10, grit: 10, spd: 3, skl: 4 }, attack: { name: 'Boulder Shove', kind: 'slam', might: 6, hit: 78 } },
];

// attacker element → elements it is strong against
const STRONG = { ember: ['moss'], moss: ['tide', 'stone'], tide: ['ember', 'stone'], gale: ['moss'], stone: ['ember', 'gale'] };

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function catchChance(ctx, target) {
  const missing = 1 - target.hp / target.maxHp;
  const snared = ctx.hasStatus(target, 'snared') ? 25 : 0;
  return clamp(Math.round(20 + 65 * missing + snared - (target.level - 1) * 4), 5, 95);
}

function creatureState(ctx) {
  ctx.vars.creatures ??= { box: [], partyLimit: 4, caughtTotal: 0, seen: [] };
  return ctx.vars.creatures;
}

export default {
  id: 'creature-catching',
  name: 'Creature Catching & Storage',
  description: 'Wild elemental creatures, snare orbs, capture chances, herd behaviour, party/box storage with a storage UI.',

  setup(api) {
    // ---- species (unit templates). `sprite.body` picks a procedural body plan; colours are free.
    for (const s of SPECIES) {
      api.defineUnit({
        id: s.id, name: s.name, title: `${s.element} creature`, maxHp: s.maxHp, mov: s.mov, moveType: s.moveType ?? 'foot',
        stats: s.stats, tags: ['creature', 'wild', s.element], ai: 'herd',
        sprite: { body: s.body, primary: s.primary, secondary: s.secondary },
        weapons: [{ ...s.attack, damageType: s.element, attackStat: 'pow', defenseStat: 'grit', glyph: 'fang', description: `${s.element} attack` }],
        vars: { species: s.id, element: s.element },
      });
    }

    // ---- elemental chart instead of a weapon triangle
    for (const [element, beats] of Object.entries(STRONG)) {
      for (const weak of beats) {
        api.matchup({ attacker: { damageType: element }, defender: { tag: weak }, damagePct: 150, hit: 10, note: `${element} is strong against ${weak} (×1.5)` });
        api.matchup({ attacker: { damageType: weak }, defender: { tag: element }, damagePct: 70, note: `${weak} is weak against ${element} (×0.7)` });
      }
    }

    // ---- handler gear
    api.defineStatus({ id: 'snared', name: 'Snared', duration: 2, mods: { mov: -2, spd: -3 }, tone: 'debuff', glyph: 'net', description: '−2 movement, −3 speed, +25% catch chance.' });
    api.defineStatus({ id: 'startled', name: 'Startled', duration: 1, mods: { skl: -3 }, tone: 'debuff', description: 'Just broke free of an orb: −3 skill.' });
    api.defineWeapon({
      id: 'snare-sling', name: 'Snare Sling', kind: 'sling', might: 2, hit: 92, range: [2, 3], damageType: 'blunt', attackStat: 'pow', defenseStat: 'grit',
      glyph: 'sling', description: 'Light hit that Snares the target for 2 turns.', effects: [{ op: 'status', id: 'snared', duration: 2 }],
    });
    api.defineItem({ id: 'snare-orb', name: 'Snare Orb', kind: 'consumable', description: 'Thrown to catch a weakened wild creature.' });

    api.defineAbility({
      id: 'throw-snare-orb', name: 'Throw Snare Orb', glyph: 'orb', sound: 'capture-throw',
      description: 'Spend 1 Snare Orb to try to catch a wild creature within 4 tiles. Chance rises as its HP falls; Snared adds 25%.',
      target: 'unit', range: [1, 4], los: true, cost: { acts: 1, items: { 'snare-orb': 1 } },
      targets: (ctx, unit) => ctx.enemies(unit).filter((t) => t.tags.includes('wild') && ctx.distance(unit, t) <= 4 && ctx.los(unit, t)),
      preview: (ctx, unit, target) => `Catch chance ${catchChance(ctx, target)}%`,
      use(ctx, unit, target) {
        const chance = catchChance(ctx, target);
        ctx.fx('capture', { from: unit, at: target });
        if (ctx.rng.chance(chance)) {
          ctx.float(target, 'CAUGHT!', 'buff');
          ctx.sound('capture-success');
          ctx.log(`${unit.name} catches ${target.name} (${chance}% chance).`, 'ability');
          ctx.capture(target, unit);
          ctx.vars.caught = (ctx.vars.caught ?? 0) + 1;
        } else {
          ctx.float(target, 'Broke free!', 'debuff');
          ctx.log(`${target.name} breaks free (${chance}% chance).`, 'ability');
          ctx.applyStatus(target, 'startled', { source: unit });
        }
      },
    });

    // ---- herd behaviour: graze, bolt when badly hurt, otherwise defend the herd
    api.defineAi({
      id: 'herd',
      description: 'Grazes until something hostile comes within 6 tiles; flees below 35% HP; otherwise fights.',
      plan(ctx, unit) {
        const near = ctx.enemies(unit).filter((e) => ctx.distance(e, unit) <= 6);
        if (!near.length) {
          const cells = ctx.reachable(unit, 2);
          return cells.length && ctx.rng.chance(40) ? { move: ctx.rng.pick(cells) } : null;
        }
        if (unit.hp < unit.maxHp * 0.35) {
          let best = null, bestDistance = Math.min(...near.map((e) => ctx.distance(e, unit)));
          for (const cell of ctx.reachable(unit)) {
            const d = Math.min(...near.map((e) => ctx.distance(e, cell)));
            if (d > bestDistance) { bestDistance = d; best = cell; }
          }
          if (best) return { move: best };
        }
        return undefined; // fall through to the built-in tactical AI
      },
    });

    // ---- objective usable in battle specs: { "type": "catch", "count": 2 }
    api.defineObjective({ id: 'catch', check: (ctx, cond) => (ctx.vars.caught ?? 0) >= (cond.count ?? 1), describe: (cond) => `Catch ${cond.count ?? 1} wild creature(s)` });

    // ---- campaign meta-system: party + storage box
    api.on('module:installed', (ev, ctx) => {
      creatureState(ctx);
      ctx.addItem('snare-orb', 8);
      for (const member of ctx.roster((r) => !r.tags.includes('creature'))) {
        if (!member.abilities.includes('throw-snare-orb')) member.abilities.push('throw-snare-orb');
        if (!member.weapons.some((w) => (w.id ?? w) === 'snare-sling')) member.weapons.push('snare-sling');
      }
      ctx.log('Creature catching unlocked: 8 Snare Orbs issued, handlers can Throw Snare Orb, and the Creature Box is open.');
    });

    api.on('battle:resolved', (ev, ctx) => {
      const state = creatureState(ctx);
      for (const caught of ev.result.captured) {
        const creature = { ...caught, tags: caught.tags.filter((t) => t !== 'wild').concat('tamed'), ai: '', hp: caught.maxHp };
        state.caughtTotal += 1;
        if (!state.seen.includes(creature.classId)) state.seen.push(creature.classId);
        const party = ctx.roster((r) => r.tags.includes('creature') && r.status === 'active').length;
        if (party < state.partyLimit) {
          const added = ctx.addUnit({ ...creature, status: 'active' });
          ctx.log(`${added.name} joins the party.`);
        } else {
          state.box.push(creature);
          ctx.log(`${creature.name} was sent to the Creature Box (party is full).`);
        }
      }
      ev.capturedHandled = true;
    });

    api.on('narrator:context', (ev, ctx) => {
      const state = creatureState(ctx);
      ev.lines.push(`Creature Box: ${state.box.length} stored (${state.box.map((c) => c.name).join(', ') || 'empty'}); ${state.caughtTotal} caught in total; Snare Orbs left: ${ctx.itemCount('snare-orb')}.`);
    });

    api.command('creatures.deposit', (ctx, args) => {
      const state = creatureState(ctx);
      const index = ctx.campaign.roster.findIndex((r) => r.id === args.id && r.tags.includes('creature'));
      if (index < 0) throw new Error('No such party creature.');
      const [creature] = ctx.campaign.roster.splice(index, 1);
      state.box.push(creature);
      ctx.log(`${creature.name} was stored in the Creature Box.`);
    }, 'Move a party creature into the box: { id }');

    api.command('creatures.withdraw', (ctx, args) => {
      const state = creatureState(ctx);
      const creature = state.box[args.index];
      if (!creature) throw new Error('That box slot is empty.');
      if (ctx.roster((r) => r.tags.includes('creature') && r.status === 'active').length >= state.partyLimit) throw new Error(`The party already has ${state.partyLimit} creatures.`);
      state.box.splice(args.index, 1);
      const added = ctx.addUnit({ ...creature, status: 'active' });
      ctx.log(`${added.name} was withdrawn from the Creature Box.`);
    }, 'Move a boxed creature into the party: { index }');

    api.command('creatures.release', (ctx, args) => {
      const state = creatureState(ctx);
      const [creature] = state.box.splice(args.index, 1);
      if (creature) ctx.log(`${creature.name} was released back into the wild.`);
    }, 'Release a boxed creature: { index }');

    // ---- storage UI. `ui.h` builds DOM; `ui.send` runs a campaign command; `ui.sprite` draws the procedural portrait.
    api.panel({
      id: 'creature-box', title: 'Creature Box', icon: '◍', scope: 'both',
      render(ui) {
        const h = ui.h, campaign = ui.campaign;
        const state = campaign.vars.creatures ?? { box: [], partyLimit: 4, caughtTotal: 0, seen: [] };
        const party = campaign.roster.filter((r) => r.tags.includes('creature') && r.status === 'active');
        const locked = !!ui.battle; // no swapping in the middle of a battle
        const card = (creature, action) => h('div', { class: 'ext-card', 'data-testid': `creature-${creature.id}` },
          ui.sprite(creature, 44),
          h('div', { class: 'ext-card-body' },
            h('strong', {}, creature.name),
            h('span', { class: 'ext-muted' }, `${creature.vars?.element ?? ''} · L${creature.level} · HP ${creature.hp}/${creature.maxHp}`)),
          action);
        return h('div', { class: 'ext-panel', 'data-testid': 'creature-box-panel' },
          h('div', { class: 'ext-stats' },
            h('span', {}, `Caught ${state.caughtTotal}`), h('span', {}, `Species seen ${state.seen.length}/${SPECIES.length}`),
            h('span', {}, `Snare Orbs ${campaign.inventory.find((i) => i.id === 'snare-orb')?.qty ?? 0}`)),
          h('h4', {}, `Party (${party.length}/${state.partyLimit})`),
          party.length ? h('div', { class: 'ext-grid' }, ...party.map((c) => card(c, h('button', { class: 'btn btn-compact', disabled: locked, onclick: () => ui.send('creatures.deposit', { id: c.id }) }, 'Store'))))
            : h('p', { class: 'ext-muted' }, 'No creatures travel with you yet.'),
          h('h4', {}, `Box (${state.box.length})`),
          state.box.length ? h('div', { class: 'ext-grid', 'data-testid': 'creature-box-slots' }, ...state.box.map((c, index) => card(c, h('span', { class: 'ext-actions' },
            h('button', { class: 'btn btn-compact btn-primary', disabled: locked, onclick: () => ui.send('creatures.withdraw', { index }) }, 'Take'),
            h('button', { class: 'btn btn-compact btn-ghost', disabled: locked, onclick: () => ui.send('creatures.release', { index }) }, 'Release')))))
            : h('p', { class: 'ext-muted' }, 'The box is empty. Weaken a wild creature, then Throw Snare Orb.'));
      },
    });

    // ---- presentation: a contracting ring when an orb lands, plus two synthesized cues
    api.effect('capture', {
      duration: 650,
      draw(g, t, cue, env) {
        const at = env.center(cue.at), radius = env.tile * (0.9 - 0.6 * t);
        g.circle(at.x, at.y, radius).stroke({ color: 0xc4a15d, width: 3, alpha: 1 - t * 0.5 });
        g.circle(at.x, at.y, radius * 0.55).stroke({ color: 0xfff2d4, width: 1.5, alpha: 1 - t });
        if (cue.from) { const from = env.center(cue.from); g.moveTo(from.x, from.y).lineTo(at.x, at.y).stroke({ color: 0xc4a15d, width: 2, alpha: Math.max(0, 0.8 - t * 2) }); }
      },
    });
    api.sound('capture-throw', { voices: [{ wave: 'triangle', freq: [520, 880], dur: 0.16, gain: 0.25 }, { wave: 'noise', dur: 0.12, gain: 0.08, filter: { type: 'highpass', freq: 3000 } }] });
    api.sound('capture-success', { voices: [{ wave: 'sine', freq: 587, dur: 0.14, gain: 0.3 }, { wave: 'sine', freq: 880, dur: 0.16, gain: 0.3, delay: 0.12 }, { wave: 'triangle', freq: 1175, dur: 0.3, gain: 0.25, delay: 0.24 }] });

    api.describe([
      'Species templates: emberpup (ember), mossling (moss), galewing (gale, flies), tidefin (tide, swims), cragback (stone). Use them in battle specs via { "template": "<id>", "count": N, "area": "east" }.',
      'Elements: ember>moss, moss>tide+stone, tide>ember+stone, gale>moss, stone>ember+gale.',
      'Handlers catch with the ability throw-snare-orb (needs the item snare-orb) and the weapon snare-sling (applies Snared).',
      'Objective for catching battles: { "win": [{ "type": "catch", "count": 2 }, { "type": "rout" }] }. Wild creatures use ai "herd".',
      'Caught creatures join the party (max 4) or go to the Creature Box (vars.creatures.box); commands: creatures.deposit {id}, creatures.withdraw {index}, creatures.release {index}.',
    ].join('\n'));
  },
};
