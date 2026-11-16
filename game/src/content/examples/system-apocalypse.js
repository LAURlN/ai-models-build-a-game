// Example module: a "System apocalypse" — the world got an RPG interface overnight.
// Adds XP and levels earned inside battles, Essence currency, a skill store and quest log
// (campaign meta-systems with a UI panel), scavenged weapons, swarm behaviour, glitch
// terrain, and a NON-GRID encounter mode: the Battle Net duel.

const SKILLS = {
  'blink-step': { cost: 30, text: 'Teleport up to 4 tiles (cooldown 2).' },
  'system-barrier': { cost: 25, text: 'Gain a 10-point barrier that absorbs damage.' },
  'inspect': { cost: 10, text: 'Free action: Analyze a target (+15 hit against it, reveals its sheet).' },
  'kill-streak': { cost: 40, text: 'Passive: each kill grants Momentum (+2 pow, stacks).' },
};
const xpToNext = (level) => 20 + level * 15;

function sys(ctx) {
  ctx.vars.system ??= { quests: [], rank: 'Unranked', netWins: 0, announcements: [] };
  return ctx.vars.system;
}

function grantXp(ctx, unit, amount) {
  unit.vars.xp = (unit.vars.xp ?? 0) + amount;
  ctx.float(unit, `+${amount} XP`, 'buff');
  while (unit.vars.xp >= xpToNext(unit.level)) {
    unit.vars.xp -= xpToNext(unit.level);
    unit.level += 1;
    unit.maxHp += 3; unit.hp += 3;
    unit.vars.statPoints = (unit.vars.statPoints ?? 0) + 2;
    ctx.float(unit, `LEVEL ${unit.level}`, 'buff');
    ctx.fx('ring', { at: unit, color: '#7fd4c1' });
    ctx.sound('level-up');
    ctx.log(`[System] ${unit.name} reached level ${unit.level}. +3 max HP, 2 stat points banked.`, 'ability');
  }
}

export default {
  id: 'system-apocalypse',
  name: 'The System',
  description: 'XP/levels, Essence, skill store, quests, scavenged gear, swarm AI, glitch terrain and the non-grid Battle Net duel.',

  setup(api) {
    // ---- scavenged arsenal: none of this is a sword/lance/axe/bow/tome
    api.defineWeapon({ id: 'rebar-spear', name: 'Rebar Spear', kind: 'rebar', might: 6, hit: 82, range: [1, 2], weight: 6, damageType: 'pierce', attackStat: 'pow', defenseStat: 'guard', glyph: 'spear', description: 'Reach 1–2.' });
    api.defineWeapon({ id: 'nail-gun', name: 'Nail Gun', kind: 'nailgun', might: 4, hit: 78, range: [2, 4], damageType: 'pierce', attackStat: 'aim', defenseStat: 'guard', counter: false, glyph: 'gun', description: 'Range 2–4, cannot counter.' });
    api.defineWeapon({
      id: 'glitch-shard', name: 'Glitch Shard', kind: 'shard', might: 5, hit: 88, crit: 10, damageType: 'glitch', attackStat: 'will', defenseStat: 'will', glyph: 'bolt',
      description: 'Ignores armour (uses Will). 30% to leave the target Desynced.',
      onHit(ctx, ev) { if (ctx.rng.chance(30)) ctx.applyStatus(ev.target, 'desynced', { source: ev.unit }); },
    });

    api.defineStatus({ id: 'analyzed', name: 'Analyzed', duration: 3, tone: 'debuff', glyph: 'eye', description: 'Attacks against this unit get +15 hit.' });
    api.defineStatus({ id: 'desynced', name: 'Desynced', duration: 2, mods: { spd: -4, mov: -1 }, tone: 'debuff', description: '−4 speed, −1 movement.', tick: [{ op: 'damage', amount: 2, type: 'glitch' }] });
    api.defineStatus({ id: 'momentum', name: 'Momentum', duration: -1, stacking: 'add', maxStacks: 5, mods: { pow: 2 }, tone: 'buff', description: '+2 pow per stack until the battle ends.' });
    api.defineStatus({
      id: 'barrier', name: 'System Barrier', duration: 3, tone: 'buff', glyph: 'shield', description: 'Absorbs damage until depleted.',
      hooks: {
        'damage:before'(ev, ctx, owner, status) {
          if (ev.target !== owner || ev.amount <= 0) return;
          const absorbed = Math.min(status.data.points ?? 0, ev.amount);
          status.data.points -= absorbed; ev.amount -= absorbed;
          if (absorbed) ctx.float(owner, `Barrier −${absorbed}`, 'buff');
          if (status.data.points <= 0) ctx.removeStatus(owner, 'barrier', true);
        },
      },
    });

    api.on('combat:calc', (ev, ctx) => { if (ctx.hasStatus(ev.target, 'analyzed')) { ev.hit += 15; ev.notes.push('Analyzed: +15 hit'); } });

    api.defineAbility({
      id: 'inspect', name: 'Inspect', glyph: 'eye', target: 'unit', range: [1, 6], cost: { acts: 0 }, usesPerPhase: 1,
      description: 'Free action, once per turn: Analyze a hostile within 6 tiles for 3 turns.',
      use(ctx, unit, target) {
        ctx.applyStatus(target, 'analyzed', { source: unit });
        ctx.log(`[System] ${target.name}: L${target.level} ${target.title}. HP ${target.hp}/${target.maxHp}. ${Object.entries(target.stats).map(([k, v]) => `${k} ${v}`).join(', ')}.`, 'ability');
      },
    });
    api.defineAbility({
      id: 'blink-step', name: 'Blink Step', glyph: 'bolt', target: 'tile', filter: 'empty', range: [1, 4], cost: { acts: 0 }, cooldown: 2, fx: 'sparkle',
      description: 'Teleport to an empty tile within 4. Does not use your action. Cooldown 2.',
      use(ctx, unit, tile) { ctx.teleport(unit, tile); ctx.float(unit, 'Blink', 'buff'); },
    });
    api.defineAbility({
      id: 'system-barrier', name: 'System Barrier', glyph: 'shield', target: 'self', cost: { acts: 1 }, cooldown: 3,
      description: 'Raise a barrier that absorbs the next 10 damage (3 turns).',
      use(ctx, unit) { ctx.applyStatus(unit, 'barrier', { data: { points: 10 } }); },
    });
    api.defineAbility({
      id: 'kill-streak', name: 'Kill Streak', kind: 'passive', description: 'Each kill grants Momentum (+2 pow, up to 5 stacks).',
      hooks: { 'unit:defeated'(ev, ctx, owner) { if (ev.unit === owner && ev.target !== owner) ctx.applyStatus(owner, 'momentum'); } },
    });

    // ---- the monsters the System spawned
    api.defineUnit({ id: 'husk', name: 'Husk', title: 'Hollowed citizen', maxHp: 16, mov: 3, stats: { pow: 6, guard: 2, will: 1, spd: 3, aim: 2 }, tags: ['husk', 'undead'], ai: 'swarm', sprite: { body: 'humanoid', primary: '#6d7d74', secondary: '#b9c2a8' }, weapons: [{ name: 'Clawing Hands', kind: 'claw', might: 3, hit: 80, damageType: 'slash', attackStat: 'pow', defenseStat: 'guard', glyph: 'claw' }] });
    api.defineUnit({ id: 'scrap-hound', name: 'Scrap Hound', title: 'Wire-stitched pack hunter', maxHp: 20, mov: 6, stats: { pow: 8, guard: 3, will: 2, spd: 10, aim: 4, skl: 6 }, tags: ['beast', 'construct'], sprite: { body: 'beast', primary: '#7a5a48', secondary: '#c9b48c' }, weapons: [{ name: 'Sheet-metal Jaws', kind: 'bite', might: 5, hit: 84, damageType: 'slash', attackStat: 'pow', defenseStat: 'guard', glyph: 'fang' }] });
    api.defineUnit({ id: 'spire-drone', name: 'Spire Drone', title: 'System enforcer', maxHp: 14, mov: 5, moveType: 'fly', stats: { pow: 2, guard: 4, will: 6, spd: 8, aim: 9, skl: 8 }, tags: ['machine', 'system'], sprite: { body: 'machine', primary: '#4f7f8f', secondary: '#bfe3dc' }, weapons: [{ name: 'Arc Lance', kind: 'arc', might: 5, hit: 86, range: [2, 3], damageType: 'glitch', attackStat: 'aim', defenseStat: 'will', glyph: 'bolt', counter: false }] });
    api.defineUnit({ id: 'rift-brute', name: 'Rift Brute', title: 'Floor boss', maxHp: 58, mov: 4, level: 5, stats: { pow: 13, guard: 7, will: 5, spd: 5, aim: 3, skl: 5 }, tags: ['boss', 'rift'], sprite: { body: 'construct', primary: '#5b4a7a', secondary: '#c7b8e6', scale: 1.25 }, weapons: [{ name: 'Collapse', kind: 'slam', might: 8, hit: 76, damageType: 'crush', attackStat: 'pow', defenseStat: 'guard', area: { shape: 'cross', size: 1 }, glyph: 'star', description: 'Hits a cross around the target.' }] });

    // Husks pile onto whoever is already surrounded.
    api.defineAi({ id: 'swarm', description: 'Default tactics, but strongly prefers targets that other husks already threaten.', plan: () => undefined });
    api.on('ai:score', (ev, ctx) => {
      if (!ev.unit.tags.includes('husk')) return;
      ev.score += 3 * ctx.unitsInRadius(ev.target, 1, (u) => u.tags.includes('husk') && u.id !== ev.unit.id).length;
    });

    // ---- terrain: a rift tile that desyncs whoever ends their phase on it
    api.defineTile({ id: 'rift', name: 'Rift static', look: 'void', color: '#5b4a7a', cost: 2, avoid: -10, tags: ['glitch'], description: 'Costs 2. Ending a phase here inflicts Desynced.', onEndPhase(ctx, unit) { ctx.applyStatus(unit, 'desynced'); } });
    api.defineTile({ id: 'barricade', name: 'Car barricade', look: 'rubble', cost: 2, defense: 2, avoid: 15, description: 'Costs 2. +2 guard, +15 avoid.' });

    // ---- XP, Essence and quest progress from kills
    api.on('unit:defeated', (ev, ctx) => {
      const killer = ev.unit, victim = ev.target;
      if (!killer || !killer.rosterId || !ctx.isHostile(killer, victim)) return;
      grantXp(ctx, killer, 8 + victim.level * 6 + (victim.tags.includes('boss') ? 40 : 0));
      ctx.loot('essence', victim.tags.includes('boss') ? 25 : 3 + victim.level, 'Essence');
      for (const quest of ctx.world.vars.system?.quests ?? []) {
        if (!quest.done && victim.tags.includes(quest.tag)) {
          quest.progress += 1;
          if (quest.progress >= quest.goal) { quest.done = true; ctx.loot('essence', quest.reward, 'Essence'); ctx.float(killer, 'QUEST COMPLETE', 'buff'); ctx.log(`[System] Quest complete: ${quest.title}. +${quest.reward} Essence.`, 'ability'); }
        }
      }
    });

    api.on('module:installed', (ev, ctx) => {
      const state = sys(ctx);
      state.quests.push({ id: 'cull', title: 'Cull the Hollowed', tag: 'husk', goal: 10, progress: 0, reward: 30, done: false });
      for (const member of ctx.roster()) { member.vars.xp ??= 0; member.vars.statPoints ??= 0; if (!member.abilities.includes('inspect')) member.abilities.push('inspect'); }
      ctx.log('[System] Interface initialised. Quest issued: Cull the Hollowed (0/10). Everyone gains Inspect.');
    });

    api.on('narrator:context', (ev, ctx) => {
      const state = sys(ctx);
      ev.lines.push(`System: rank ${state.rank}, Battle Net wins ${state.netWins}, Essence ${ctx.itemCount('essence')}. Quests: ${state.quests.map((q) => `${q.title} ${q.progress}/${q.goal}${q.done ? ' (done)' : ''}`).join('; ') || 'none'}.`);
    });

    api.command('system.buySkill', (ctx, args) => {
      const member = ctx.unit(args.unit), skill = SKILLS[args.skill];
      if (!member || !skill) throw new Error('Unknown unit or skill.');
      if (member.abilities.includes(args.skill)) throw new Error(`${member.name} already has that skill.`);
      if (!ctx.removeItem('essence', skill.cost)) throw new Error(`Needs ${skill.cost} Essence.`);
      member.abilities.push(args.skill);
      ctx.log(`[System] ${member.name} acquired ${args.skill}.`);
    }, 'Spend Essence on a skill: { unit, skill }');

    api.command('system.allocate', (ctx, args) => {
      const member = ctx.unit(args.unit);
      if (!member || !(member.vars.statPoints > 0)) throw new Error('No stat points to spend.');
      member.vars.statPoints -= 1;
      member.stats[args.stat] = (member.stats[args.stat] ?? 0) + 1;
    }, 'Spend one banked stat point: { unit, stat }');

    api.command('system.issueQuest', (ctx, args) => {
      sys(ctx).quests.push({ id: `q${Date.now() % 100000}`, title: String(args.title ?? 'Unnamed quest'), tag: String(args.tag ?? 'husk'), goal: Number(args.goal ?? 5), progress: 0, reward: Number(args.reward ?? 20), done: false });
    }, 'Narrator: issue a kill quest { title, tag, goal, reward }');

    api.on('battle:resolved', (ev, ctx) => {
      const duel = ev.battle.vars.duel;
      if (!duel) return;
      const state = sys(ctx);
      if (ev.battle.outcome === 'victory') { state.netWins += 1; state.rank = ['Bronze', 'Silver', 'Gold', 'Apex'][Math.min(3, state.netWins - 1)]; ctx.addItem('essence', 20, { name: 'Essence' }); ctx.log(`[System] Battle Net victory. Rank: ${state.rank}. +20 Essence.`); }
    });

    // ---- status-window UI
    api.panel({
      id: 'system-interface', title: 'System', icon: '⌬', scope: 'both',
      render(ui) {
        const h = ui.h, c = ui.campaign, state = c.vars.system ?? { quests: [], rank: 'Unranked', netWins: 0 };
        const essence = c.inventory.find((i) => i.id === 'essence')?.qty ?? 0;
        const locked = !!ui.battle;
        return h('div', { class: 'ext-panel', 'data-testid': 'system-panel' },
          h('div', { class: 'ext-stats' }, h('span', {}, `Essence ${essence}`), h('span', {}, `Rank ${state.rank}`), h('span', {}, `Net wins ${state.netWins}`)),
          h('h4', {}, 'Quests'),
          ...state.quests.map((q) => h('div', { class: 'ext-row' }, h('span', {}, `${q.done ? '✓' : '◇'} ${q.title}`), ui.meter(q.progress, q.goal, `${Math.min(q.progress, q.goal)}/${q.goal}`))),
          h('h4', {}, 'Status windows'),
          ...c.roster.filter((r) => r.status === 'active').map((r) => h('div', { class: 'ext-card' },
            ui.sprite(r, 40),
            h('div', { class: 'ext-card-body' },
              h('strong', {}, `${r.name} · L${r.level}`),
              ui.meter(r.vars.xp ?? 0, xpToNext(r.level), `XP ${r.vars.xp ?? 0}/${xpToNext(r.level)}`),
              h('span', { class: 'ext-muted' }, Object.entries(r.stats).map(([k, v]) => `${k} ${v}`).join(' · ')),
              (r.vars.statPoints ?? 0) > 0 ? h('span', { class: 'ext-actions' }, `${r.vars.statPoints} pts: `,
                ...Object.keys(r.stats).map((stat) => h('button', { class: 'btn btn-compact', disabled: locked, onclick: () => ui.send('system.allocate', { unit: r.id, stat }) }, `+${stat}`))) : null,
              h('span', { class: 'ext-actions' }, ...Object.entries(SKILLS).filter(([id]) => !r.abilities.includes(id)).map(([id, skill]) =>
                h('button', { class: 'btn btn-compact btn-secondary', title: skill.text, disabled: locked || essence < skill.cost, onclick: () => ui.send('system.buySkill', { unit: r.id, skill: id }) }, `${id} (${skill.cost})`)))))));
      },
    });

    // ---- NON-GRID encounter mode: the Battle Net duel.
    // Start it with a battle spec like { "mode": "net-duel", "title": "...", "vars": { "duelFoe": { "name": "Rank Warden", "integrity": 18 } } }.
    const beats = { strike: 'overclock', overclock: 'guard', guard: 'strike' };
    api.defineMode({
      id: 'net-duel', name: 'Battle Net duel', grid: false,
      description: 'A System-arbitrated duel of stances: Strike beats Overclock, Overclock beats Guard, Guard beats Strike. First to 0 Integrity loses.',
      init(ctx, spec) {
        const foe = spec.vars?.duelFoe ?? {};
        const champion = ctx.units((u) => ctx.isPlayerControlled(u))[0];
        ctx.vars.duel = {
          round: 1, lastRound: null,
          you: { name: champion?.name ?? 'Challenger', integrity: 16 + (champion?.level ?? 1) * 2, charge: 0 },
          foe: { name: foe.name ?? 'Net Warden', integrity: foe.integrity ?? 18, charge: 0 },
        };
        ctx.state.objective.text = 'Reduce the opposing signal to 0 Integrity';
        ctx.state.objective.win = [{ type: 'var', key: 'duel.won', gte: 1, reason: 'the opposing signal collapsed' }];
        ctx.state.objective.lose = [{ type: 'var', key: 'duel.lost', gte: 1, reason: 'your signal was dropped from the Net' }];
      },
      commands: {
        stance(ctx, args) {
          const duel = ctx.vars.duel, mine = String(args.stance);
          if (!beats[mine]) throw new Error('Choose strike, guard or overclock.');
          const theirs = ctx.rng.weighted([['strike', 4], ['guard', 3], ['overclock', 2 + duel.foe.charge]]);
          const power = (side, stance) => (stance === 'strike' ? 4 : stance === 'overclock' ? 6 + side.charge * 2 : 1);
          let text;
          if (mine === theirs) { duel.you.integrity -= 1; duel.foe.integrity -= 1; text = `Both chose ${mine}: static burns 1 Integrity each.`; }
          else if (beats[mine] === theirs) { const dmg = power(duel.you, mine); duel.foe.integrity -= dmg; text = `Your ${mine} beats ${theirs}: ${duel.foe.name} loses ${dmg}.`; }
          else { const dmg = power(duel.foe, theirs); duel.you.integrity -= dmg; text = `${duel.foe.name}'s ${theirs} beats your ${mine}: you lose ${dmg}.`; }
          duel.you.charge = mine === 'guard' ? duel.you.charge + 1 : 0;
          duel.foe.charge = theirs === 'guard' ? duel.foe.charge + 1 : 0;
          duel.lastRound = { mine, theirs, text };
          duel.round += 1;
          ctx.log(`[Battle Net] ${text}`, 'ability');
          ctx.sound(beats[mine] === theirs ? 'hit' : 'system-chime');
          if (duel.foe.integrity <= 0) duel.won = 1;
          if (duel.you.integrity <= 0 && !duel.won) duel.lost = 1;
        },
      },
      view: {
        render(ui) {
          const h = ui.h, duel = ui.battle.vars.duel;
          const side = (who, label) => h('div', { class: 'ext-card' }, h('div', { class: 'ext-card-body' }, h('strong', {}, `${label}: ${who.name}`), ui.meter(Math.max(0, who.integrity), 24, `Integrity ${Math.max(0, who.integrity)}`), h('span', { class: 'ext-muted' }, `Guard charge ${who.charge} (adds +${who.charge * 2} to Overclock)`)));
          return h('div', { class: 'ext-panel ext-mode', 'data-testid': 'net-duel' },
            h('h3', {}, `Battle Net · round ${duel.round}`),
            h('p', { class: 'ext-muted' }, 'Strike (4) beats Overclock · Overclock (6+charge) beats Guard · Guard (1, builds charge) beats Strike.'),
            h('div', { class: 'ext-grid' }, side(duel.you, 'You'), side(duel.foe, 'Opponent')),
            duel.lastRound ? h('p', { 'data-testid': 'net-duel-last' }, duel.lastRound.text) : null,
            h('div', { class: 'ext-actions' }, ...['strike', 'guard', 'overclock'].map((stance) =>
              h('button', { class: 'btn btn-primary', 'data-testid': `stance-${stance}`, disabled: ui.battle.status !== 'ongoing', onclick: () => ui.battleSend('stance', { stance }) }, stance.toUpperCase()))));
        },
      },
    });

    api.sound('system-chime', { voices: [{ wave: 'square', freq: 1320, dur: 0.07, gain: 0.12 }, { wave: 'square', freq: 1760, dur: 0.09, gain: 0.1, delay: 0.07 }] });
    api.sound('level-up', { voices: [{ wave: 'square', freq: 523, dur: 0.1, gain: 0.14 }, { wave: 'square', freq: 659, dur: 0.1, gain: 0.14, delay: 0.1 }, { wave: 'square', freq: 784, dur: 0.1, gain: 0.14, delay: 0.2 }, { wave: 'triangle', freq: 1046, dur: 0.35, gain: 0.2, delay: 0.3 }] });
    api.music('battle', { tempo: 132, root: 45, scale: [0, 1, 3, 5, 7, 8, 10], progression: [0, 0, 5, 4], layers: { pad: 0.35, pluck: 0.6, bass: 0.7, drums: 0.7, lead: 0.2 }, pluckWave: 'square' });

    api.describe([
      'Templates: husk (ai swarm), scrap-hound, spire-drone (flies, ranged), rift-brute (boss). Weapons: rebar-spear, nail-gun, glitch-shard. Tiles: rift, barricade.',
      'Kills by roster members grant XP (levels persist), Essence loot and quest progress. Skills are bought in the System panel (system.buySkill {unit, skill}).',
      'Issue quests with the command system.issueQuest { title, tag, goal, reward }.',
      'Non-grid duels: start a battle with { "mode": "net-duel", "units": [{ "roster": "<id>" }], "vars": { "duelFoe": { "name": "…", "integrity": 18 } } }.',
    ].join('\n'));
  },
};
