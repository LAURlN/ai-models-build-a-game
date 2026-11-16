import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  RULES_VERSION,
  type BattleState,
  type ChapterBuild,
  type ChapterPlan,
  type ChapterPlanUnit,
  type CompiledRulePack,
  type Coord,
  type GeneratedChapterPreview,
  type MapArchetypeId,
  type ObjectiveType,
  type RuleDefinition,
  type Terrain,
  type UnitState,
  type Weapon,
} from '../shared/contracts';
import { compileRules, log } from './ir';

export interface ArchetypeSpec {
  id: MapArchetypeId;
  label: string;
  defaultObjective: ObjectiveType;
  rows: string[];
  playerSpawns: Coord[];
  enemySpawns: Coord[];
  seizeTile: Coord | null;
}

export const MAP_ARCHETYPES: Record<MapArchetypeId, ArchetypeSpec> = {
  bridge_assault: {
    id: 'bridge_assault',
    label: 'Bridge Assault',
    defaultObjective: 'rout',
    rows: [
      '..........',
      '###.##.###',
      '###.cc.###',
      '....cc....',
      '..........',
      '..........',
      '....cc....',
      '###.cc.###',
      '###.##.###',
      '..........',
    ],
    playerSpawns: [
      { x: 1, y: 4 },
      { x: 1, y: 5 },
      { x: 0, y: 3 },
      { x: 0, y: 6 },
    ],
    enemySpawns: [
      { x: 6, y: 4 },
      { x: 7, y: 3 },
      { x: 7, y: 5 },
      { x: 8, y: 4 },
      { x: 8, y: 6 },
    ],
    seizeTile: { x: 9, y: 4 },
  },
  fortress_siege: {
    id: 'fortress_siege',
    label: 'Fortress Siege',
    defaultObjective: 'seize',
    rows: [
      '..........',
      '..##..##..',
      '.c......c.',
      '..#....#..',
      '..#..c.#..',
      '.....c....',
      '..#....#..',
      '..##..##..',
      '...cc.....',
      '..........',
    ],
    playerSpawns: [
      { x: 1, y: 4 },
      { x: 1, y: 5 },
      { x: 0, y: 4 },
      { x: 0, y: 5 },
    ],
    enemySpawns: [
      { x: 5, y: 3 },
      { x: 6, y: 4 },
      { x: 6, y: 5 },
      { x: 8, y: 4 },
      { x: 8, y: 5 },
    ],
    seizeTile: { x: 9, y: 4 },
  },
  forest_ambush: {
    id: 'forest_ambush',
    label: 'Forest Ambush',
    defaultObjective: 'rout',
    rows: [
      '..........',
      '.cc....cc.',
      '.c..#...c.',
      '..c....c..',
      '...c..c...',
      '...c..c...',
      '..c....c..',
      '.c...#..c.',
      '.cc....cc.',
      '..........',
    ],
    playerSpawns: [
      { x: 2, y: 4 },
      { x: 2, y: 5 },
      { x: 1, y: 3 },
      { x: 1, y: 6 },
    ],
    enemySpawns: [
      { x: 6, y: 2 },
      { x: 7, y: 4 },
      { x: 7, y: 5 },
      { x: 6, y: 7 },
      { x: 8, y: 4 },
    ],
    seizeTile: { x: 8, y: 4 },
  },
  twin_path_escort: {
    id: 'twin_path_escort',
    label: 'Twin Path Escort',
    defaultObjective: 'seize',
    rows: [
      '..........',
      '.c......c.',
      '..##..##..',
      '..........',
      '....##....',
      '....##....',
      '..........',
      '..##..##..',
      '.c......c.',
      '..........',
    ],
    playerSpawns: [
      { x: 1, y: 3 },
      { x: 1, y: 6 },
      { x: 0, y: 3 },
      { x: 0, y: 6 },
    ],
    enemySpawns: [
      { x: 6, y: 3 },
      { x: 7, y: 3 },
      { x: 6, y: 6 },
      { x: 7, y: 6 },
      { x: 8, y: 4 },
    ],
    seizeTile: { x: 9, y: 4 },
  },
};

function terrainFromRows(rows: string[]): Terrain[][] {
  return rows.map((row) =>
    [...row].map((ch) => (ch === '#' ? ('wall' as const) : ch === 'c' ? ('cover' as const) : ('plain' as const))),
  );
}

const WEAPON_TEMPLATES: Record<ChapterPlanUnit['weaponTag'], Omit<Weapon, 'id' | 'name'>> = {
  sword: { tag: 'sword', might: 5, weight: 4, hit: 90, crit: 5, minRange: 1, maxRange: 1, damageType: 'physical', lineOfSight: false },
  axe: { tag: 'axe', might: 6, weight: 8, hit: 78, crit: 2, minRange: 1, maxRange: 1, damageType: 'physical', lineOfSight: false },
  lance: { tag: 'lance', might: 5, weight: 6, hit: 85, crit: 2, minRange: 1, maxRange: 1, damageType: 'physical', lineOfSight: false },
  bow: { tag: 'bow', might: 5, weight: 5, hit: 86, crit: 5, minRange: 2, maxRange: 2, damageType: 'physical', lineOfSight: true },
  tome: { tag: 'tome', might: 4, weight: 3, hit: 90, crit: 2, minRange: 1, maxRange: 2, damageType: 'magical', lineOfSight: true },
};

export const CHAPTER_PLAN_JSON_SCHEMA = {
  title: 'ChapterPlan',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'title', 'archetype', 'objective', 'maxTurns', 'summary', 'units'],
  properties: {
    schemaVersion: { type: 'integer', enum: [1] },
    title: { type: 'string', description: 'Short tactical chapter title (3-64 chars).' },
    archetype: { type: 'string', enum: ['bridge_assault', 'fortress_siege', 'forest_ambush', 'twin_path_escort'] },
    objective: { type: 'string', enum: ['rout', 'seize'] },
    maxTurns: { type: 'integer', description: 'Turn limit integer between 6 and 20.' },
    summary: { type: 'string', description: 'One-sentence premise summary (8-240 chars).' },
    units: {
      type: 'array',
      description: 'Between 5 and 9 units total (1-4 player, 1-5 enemy).',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'name',
          'title',
          'faction',
          'weaponTag',
          'weaponName',
          'hp',
          'str',
          'mag',
          'skl',
          'spd',
          'lck',
          'def',
          'res',
          'mov',
          'grantActiveAbility',
        ],
        properties: {
          id: { type: 'string', description: 'Lowercase alphanumeric/underscore id like hero_rowan.' },
          name: { type: 'string' },
          title: { type: 'string' },
          faction: { type: 'string', enum: ['player', 'enemy'] },
          weaponTag: { type: 'string', enum: ['sword', 'axe', 'lance', 'bow', 'tome'] },
          weaponName: { type: 'string' },
          hp: { type: 'integer', description: 'Integer 14..55' },
          str: { type: 'integer', description: 'Integer 2..18' },
          mag: { type: 'integer', description: 'Integer 2..18' },
          skl: { type: 'integer', description: 'Integer 3..16' },
          spd: { type: 'integer', description: 'Integer 3..16' },
          lck: { type: 'integer', description: 'Integer 1..12' },
          def: { type: 'integer', description: 'Integer 1..14' },
          res: { type: 'integer', description: 'Integer 1..14' },
          mov: { type: 'integer', description: 'Integer 2..5' },
          grantActiveAbility: { type: 'boolean' },
        },
      },
    },
  },
} as const;

export const CHAPTER_BUILD_JSON_SCHEMA = {
  title: 'ChapterBuild',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'abilityName', 'statusName', 'abilitySummary', 'introChronicle', 'rulePack'],
  $defs: {
    ruleExpr: {
      anyOf: [
        { type: 'integer' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['read'],
          properties: { read: { type: 'string', enum: ['stackCount'] } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['read', 'key'],
          properties: {
            read: { type: 'string', enum: ['counter'] },
            key: { type: 'string' },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['op', 'left', 'right'],
          properties: {
            op: { type: 'string', enum: ['add', 'multiply', 'floorDivide'] },
            left: { $ref: '#/$defs/ruleExpr' },
            right: { $ref: '#/$defs/ruleExpr' },
          },
        },
      ],
    },
    leafEffect: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['op', 'amount', 'key', 'kind'],
          properties: {
            op: { type: 'string', enum: ['grantAction'] },
            amount: { type: 'integer' },
            key: { type: 'string' },
            kind: { type: 'string', enum: ['any'] },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['op', 'statusId', 'stacks', 'expiry'],
          properties: {
            op: { type: 'string', enum: ['applyStatus'] },
            statusId: { type: 'string' },
            stacks: { type: 'integer' },
            expiry: { type: 'string', enum: ['nextOwnPhaseStart'] },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['op', 'statusId'],
          properties: {
            op: { type: 'string', enum: ['removeStatus'] },
            statusId: { type: 'string' },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['op', 'amount'],
          properties: {
            op: { type: 'string', enum: ['heal', 'dealDamage'] },
            amount: { $ref: '#/$defs/ruleExpr' },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['op', 'key', 'amount'],
          properties: {
            op: { type: 'string', enum: ['adjustCounter'] },
            key: { type: 'string' },
            amount: { $ref: '#/$defs/ruleExpr' },
          },
        },
      ],
    },
    ruleEffect: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['op', 'effects'],
          properties: {
            op: { type: 'string', enum: ['sequence'] },
            effects: { type: 'array', items: { $ref: '#/$defs/leafEffect' } },
          },
        },
        { $ref: '#/$defs/leafEffect' },
      ],
    },
  },
  properties: {
    schemaVersion: { type: 'integer', enum: [1] },
    abilityName: { type: 'string' },
    statusName: { type: 'string' },
    abilitySummary: { type: 'string' },
    introChronicle: { type: 'string' },
    rulePack: {
      type: 'array',
      description: '1 to 4 RuleDefinition objects: at least one kind="active" ability and any referenced kind="status" definitions.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'schemaVersion',
          'id',
          'rulesVersion',
          'provenanceJobId',
          'name',
          'kind',
          'costs',
          'useKey',
          'usesPerPhase',
          'stackPolicy',
          'activationPolicy',
          'listeners',
        ],
        properties: {
          schemaVersion: { type: 'integer', enum: [1] },
          id: { type: 'string' },
          rulesVersion: { type: 'string', enum: ['r03-1'] },
          provenanceJobId: { type: 'string' },
          name: { type: 'string' },
          kind: { type: 'string', enum: ['active', 'status'] },
          costs: {
            type: 'object',
            additionalProperties: false,
            required: ['hp', 'actions'],
            properties: {
              hp: { type: 'integer' },
              actions: { type: 'integer' },
            },
          },
          useKey: { type: 'string' },
          usesPerPhase: { type: 'integer' },
          stackPolicy: { type: 'string', enum: ['add'] },
          activationPolicy: { type: 'string', enum: ['normal', 'blockOrdinaryAction'] },
          listeners: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['hook', 'scope', 'priority', 'maxPerRoot', 'maxPerPhase', 'effect'],
              properties: {
                hook: { type: 'string', enum: ['useActive', 'kill', 'statusExpiry', 'afterHeal', 'afterDamage'] },
                scope: { type: 'string', enum: ['ownerActor', 'ownerTarget', 'ownedStatus'] },
                priority: { type: 'integer' },
                maxPerRoot: { type: 'integer' },
                maxPerPhase: { type: 'integer' },
                effect: { $ref: '#/$defs/ruleEffect' },
              },
            },
          },
        },
      },
    },
  },
} as const;

function cleanText(raw: unknown, field: string, minLen = 2, maxLen = 240): string {
  if (typeof raw !== 'string') throw new Error(`${field} must be a string.`);
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (trimmed.length < minLen || trimmed.length > maxLen) {
    throw new Error(`${field} length must be between ${minLen} and ${maxLen} characters.`);
  }
  return trimmed;
}

export function validateChapterPlan(raw: unknown): { ok: true; plan: ChapterPlan } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['Plan must be a JSON object.'] };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.schemaVersion !== 1) errors.push('schemaVersion must equal 1.');

  let title = 'Generated Skirmish';
  let summary = '';
  try {
    title = cleanText(obj.title, 'title', 3, 64);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  try {
    summary = cleanText(obj.summary, 'summary', 6, 240);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  const archetype = obj.archetype;
  if (typeof archetype !== 'string' || !(archetype in MAP_ARCHETYPES)) {
    errors.push(`Unsupported map archetype '${String(archetype)}'.`);
  }
  const objective = obj.objective;
  if (objective !== 'rout' && objective !== 'seize') {
    errors.push(`Objective must be 'rout' or 'seize', received '${String(objective)}'.`);
  }
  const maxTurns = obj.maxTurns;
  if (typeof maxTurns !== 'number' || !Number.isInteger(maxTurns) || maxTurns < 6 || maxTurns > 20) {
    errors.push('maxTurns must be an integer between 6 and 20.');
  }

  if (!Array.isArray(obj.units) || obj.units.length < 4 || obj.units.length > 9) {
    errors.push('units must contain 4 to 9 entries.');
  } else {
    const ids = new Set<string>();
    let playerCount = 0;
    let enemyCount = 0;
    const validUnits: ChapterPlanUnit[] = [];

    for (let i = 0; i < obj.units.length; i++) {
      const u = obj.units[i] as Record<string, unknown> | null;
      if (!u || typeof u !== 'object' || Array.isArray(u)) {
        errors.push(`units[${i}] must be an object.`);
        continue;
      }
      const id = u.id;
      if (typeof id !== 'string' || !/^[a-z][a-z0-9_]{1,39}$/.test(id)) {
        errors.push(`units[${i}].id '${String(id)}' is invalid.`);
      } else if (ids.has(id)) {
        errors.push(`Duplicate unit id '${id}'.`);
      } else {
        ids.add(id);
      }

      try {
        cleanText(u.name, `units[${i}].name`, 2, 32);
        cleanText(u.title, `units[${i}].title`, 2, 48);
        cleanText(u.weaponName, `units[${i}].weaponName`, 2, 40);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }

      if (u.faction === 'player') playerCount++;
      else if (u.faction === 'enemy') enemyCount++;
      else errors.push(`units[${i}].faction must be 'player' or 'enemy'.`);

      if (!['sword', 'axe', 'lance', 'bow', 'tome'].includes(String(u.weaponTag))) {
        errors.push(`units[${i}].weaponTag '${String(u.weaponTag)}' is unsupported.`);
      }

      const checkInt = (key: string, min: number, max: number) => {
        const v = u[key];
        if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
          errors.push(`units[${i}].${key} must be an integer in [${min}, ${max}].`);
        }
      };
      checkInt('hp', 14, 55);
      checkInt('str', 2, 18);
      checkInt('mag', 2, 18);
      checkInt('skl', 3, 16);
      checkInt('spd', 3, 16);
      checkInt('lck', 1, 12);
      checkInt('def', 1, 14);
      checkInt('res', 1, 14);
      checkInt('mov', 2, 5);
      if (typeof u.grantActiveAbility !== 'boolean') {
        errors.push(`units[${i}].grantActiveAbility must be boolean.`);
      }

      validUnits.push(u as unknown as ChapterPlanUnit);
    }

    const archSpec = typeof archetype === 'string' && archetype in MAP_ARCHETYPES
      ? MAP_ARCHETYPES[archetype as MapArchetypeId]
      : MAP_ARCHETYPES.bridge_assault;
    if (playerCount < 1 || playerCount > archSpec.playerSpawns.length) {
      errors.push(`Player count (${playerCount}) must be between 1 and ${archSpec.playerSpawns.length}.`);
    }
    if (enemyCount < 1 || enemyCount > archSpec.enemySpawns.length) {
      errors.push(`Enemy count (${enemyCount}) must be between 1 and ${archSpec.enemySpawns.length}.`);
    }
    if (errors.length === 0) {
      return {
        ok: true,
        plan: {
          schemaVersion: 1,
          title,
          archetype: archetype as MapArchetypeId,
          objective: objective as ObjectiveType,
          maxTurns: maxTurns as number,
          summary,
          units: validUnits,
        },
      };
    }
  }

  return { ok: false, errors };
}

export function validateChapterBuild(
  raw: unknown,
  provenanceJobId: string,
): { ok: true; build: ChapterBuild; compiledPack: CompiledRulePack; activeAbilityId: string } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['Build must be a JSON object.'] };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.schemaVersion !== 1) errors.push('schemaVersion must equal 1.');
  try {
    cleanText(obj.abilityName, 'abilityName', 3, 48);
    cleanText(obj.statusName, 'statusName', 3, 48);
    cleanText(obj.abilitySummary, 'abilitySummary', 6, 200);
    cleanText(obj.introChronicle, 'introChronicle', 6, 240);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  if (!Array.isArray(obj.rulePack) || obj.rulePack.length === 0 || obj.rulePack.length > 6) {
    errors.push('rulePack must contain 1 to 6 definitions.');
    return { ok: false, errors };
  }

  // Stamp provenanceJobId and rulesVersion strictly on validated structure copies before compilation.
  const normalizedDefs: RuleDefinition[] = obj.rulePack.map((entry) => {
    const def = structuredClone(entry) as Record<string, unknown>;
    if (def && typeof def === 'object') {
      def.provenanceJobId = provenanceJobId;
      def.rulesVersion = RULES_VERSION;
    }
    return def as unknown as RuleDefinition;
  });

  let compiledPack: CompiledRulePack;
  try {
    compiledPack = compileRules(normalizedDefs);
  } catch (e) {
    errors.push(`Rule IR compilation rejected: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, errors };
  }

  const activeDefs = Object.values(compiledPack).filter((d) => d.kind === 'active');
  if (activeDefs.length === 0) {
    errors.push('rulePack must define at least one kind="active" ability.');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    build: {
      schemaVersion: 1,
      abilityName: cleanText(obj.abilityName, 'abilityName', 3, 48),
      statusName: cleanText(obj.statusName, 'statusName', 3, 48),
      abilitySummary: cleanText(obj.abilitySummary, 'abilitySummary', 6, 200),
      introChronicle: cleanText(obj.introChronicle, 'introChronicle', 6, 240),
      rulePack: normalizedDefs,
    },
    compiledPack,
    activeAbilityId: activeDefs[0]!.id,
  };
}

export function buildBattleStateFromChapter(input: {
  attemptId: string;
  epoch: number;
  source: 'generated' | 'local_fallback';
  premise: string;
  plan: ChapterPlan;
  build: ChapterBuild;
  compiledPack: CompiledRulePack;
  activeAbilityId: string;
  providerUsed: string;
  modelUsed: string;
  repaired: boolean;
  fallbackReason: string | null;
}): GeneratedChapterPreview {
  const arch = MAP_ARCHETYPES[input.plan.archetype];
  const terrain = terrainFromRows(arch.rows);

  const playerUnits = input.plan.units.filter((u) => u.faction === 'player');
  const enemyUnits = input.plan.units.filter((u) => u.faction === 'enemy');

  let activeAssigned = false;
  const toUnitState = (u: ChapterPlanUnit, idx: number, spawns: Coord[]): UnitState => {
    const pos = structuredClone(spawns[idx]!);
    const tpl = WEAPON_TEMPLATES[u.weaponTag];
    const shouldAssignAbility = u.faction === 'player' && (u.grantActiveAbility || (!activeAssigned && idx === 0));
    if (shouldAssignAbility) activeAssigned = true;
    return {
      id: u.id,
      name: u.name,
      title: u.title,
      classId: u.weaponTag,
      faction: u.faction,
      pos,
      hp: u.hp,
      maxHp: u.hp,
      str: u.str,
      mag: u.mag,
      skl: u.skl,
      spd: u.spd,
      lck: u.lck,
      def: u.def,
      res: u.res,
      mov: u.mov,
      weapon: {
        id: `${u.id}_${u.weaponTag}`,
        name: u.weaponName,
        ...tpl,
      },
      abilities: shouldAssignAbility ? [input.activeAbilityId] : [],
      statuses: [],
      counters: {},
      actionCredits: 1,
      bonusCredits: 0,
      phaseUses: {},
      hasMoved: false,
      hasActed: false,
      alive: true,
    };
  };

  const units: UnitState[] = [
    ...playerUnits.map((u, idx) => toUnitState(u, idx, arch.playerSpawns)),
    ...enemyUnits.map((u, idx) => toUnitState(u, idx, arch.enemySpawns)),
  ];

  // If no player unit explicitly had grantActiveAbility=true, assign to lead player unit.
  if (!activeAssigned && units.length > 0 && units[0]!.faction === 'player') {
    units[0]!.abilities = [input.activeAbilityId];
  }

  const seizeTile = input.plan.objective === 'seize' ? structuredClone(arch.seizeTile ?? { x: 9, y: 4 }) : null;
  if (seizeTile && terrain[seizeTile.y]?.[seizeTile.x] === 'wall') {
    terrain[seizeTile.y]![seizeTile.x] = 'plain';
  }

  const state: BattleState = {
    rulesVersion: RULES_VERSION,
    seed: 1 + (input.epoch % 997),
    boardWidth: BOARD_WIDTH,
    boardHeight: BOARD_HEIGHT,
    terrain,
    turn: 1,
    maxTurns: input.plan.maxTurns,
    phase: 'player',
    phaseOrdinal: 1,
    phaseCommands: 0,
    status: 'ongoing',
    endReason: null,
    selectedUnitId: null,
    commandOrdinal: 0,
    rngPosition: 0,
    units,
    events: [],
    listenerCounts: {},
    chapterId: `chapter_${input.attemptId}`,
    chapterTitle: input.plan.title,
    chapterPremise: input.premise,
    chapterSource: input.source,
    provenanceJobId: input.attemptId,
    objectiveType: input.plan.objective,
    seizeTile,
    rulePack: input.compiledPack,
  };

  const abilityRulesText = input.compiledPack[input.activeAbilityId]!.rulesText;
  const objText =
    input.plan.objective === 'seize' && seizeTile
      ? `Seize (${seizeTile.x}, ${seizeTile.y}) within ${input.plan.maxTurns} turns`
      : `Rout all enemies within ${input.plan.maxTurns} turns`;
  log(state, 'system', `${input.plan.title}: ${input.build.introChronicle} Objective: ${objText}.`);

  return {
    attemptId: input.attemptId,
    epoch: input.epoch,
    source: input.source,
    title: input.plan.title,
    premise: input.premise,
    archetype: input.plan.archetype,
    objective: input.plan.objective,
    summary: input.plan.summary,
    abilityName: input.compiledPack[input.activeAbilityId]!.name,
    abilityRulesText,
    units: units.map((u) => ({ name: u.name, title: u.title, faction: u.faction, weaponTag: u.weapon.tag })),
    providerUsed: input.providerUsed,
    modelUsed: input.modelUsed,
    repaired: input.repaired,
    fallbackReason: input.fallbackReason,
    battleState: state,
  };
}

export function buildLocalFallbackChapter(
  premise: string,
  attemptId: string,
  epoch: number,
  fallbackReason: string,
): GeneratedChapterPreview {
  const lower = premise.toLowerCase();
  const archetype: MapArchetypeId = lower.includes('fortress') || lower.includes('siege')
    ? 'fortress_siege'
    : lower.includes('forest') || lower.includes('ambush') || lower.includes('woods')
      ? 'forest_ambush'
      : lower.includes('escort') || lower.includes('twin')
        ? 'twin_path_escort'
        : 'bridge_assault';

  const objective: ObjectiveType = lower.includes('seize') || archetype === 'fortress_siege' ? 'seize' : 'rout';
  const plan: ChapterPlan = {
    schemaVersion: 1,
    title: `Local Chronicle: ${MAP_ARCHETYPES[archetype].label}`,
    archetype,
    objective,
    maxTurns: 12,
    summary: `Deterministic local fallback generated from premise: "${premise.trim().slice(0, 80)}"`,
    units: [
      { id: 'fallback_vanguard', name: 'Alden', title: 'Standard Bearer', faction: 'player', weaponTag: 'sword', weaponName: 'Ash Blade', hp: 32, str: 12, mag: 3, skl: 9, spd: 11, lck: 5, def: 6, res: 4, mov: 4, grantActiveAbility: true },
      { id: 'fallback_scout', name: 'Mira', title: 'Pathfinder', faction: 'player', weaponTag: 'bow', weaponName: 'Reed Bow', hp: 26, str: 11, mag: 2, skl: 10, spd: 10, lck: 5, def: 5, res: 4, mov: 4, grantActiveAbility: false },
      { id: 'fallback_scholar', name: 'Iona', title: 'Rite Scribe', faction: 'player', weaponTag: 'tome', weaponName: 'Cinder Folio', hp: 25, str: 3, mag: 11, skl: 8, spd: 9, lck: 4, def: 4, res: 7, mov: 4, grantActiveAbility: false },
      { id: 'fallback_sentinel', name: 'Bram', title: 'Iron Bulwark', faction: 'player', weaponTag: 'lance', weaponName: 'Pillar Pike', hp: 35, str: 12, mag: 2, skl: 7, spd: 7, lck: 4, def: 8, res: 4, mov: 3, grantActiveAbility: false },
      { id: 'fallback_raider_a', name: 'Garrick', title: 'Outrider', faction: 'enemy', weaponTag: 'axe', weaponName: 'Spite Axe', hp: 24, str: 9, mag: 2, skl: 5, spd: 6, lck: 2, def: 4, res: 3, mov: 3, grantActiveAbility: false },
      { id: 'fallback_archer_a', name: 'Kestrel', title: 'Watchman', faction: 'enemy', weaponTag: 'bow', weaponName: 'Horn Bow', hp: 22, str: 8, mag: 2, skl: 6, spd: 8, lck: 2, def: 4, res: 3, mov: 4, grantActiveAbility: false },
      { id: 'fallback_warden', name: 'Mord', title: 'Gate Sentinel', faction: 'enemy', weaponTag: 'lance', weaponName: 'Dread Halberd', hp: 27, str: 10, mag: 2, skl: 5, spd: 6, lck: 2, def: 5, res: 3, mov: 3, grantActiveAbility: false },
    ],
  };

  const rulePack: RuleDefinition[] = [
    {
      schemaVersion: 1,
      id: 'local_second_wind',
      rulesVersion: RULES_VERSION,
      provenanceJobId: attemptId,
      name: 'Second Wind',
      kind: 'active',
      costs: { hp: 3, actions: 0 },
      useKey: 'local_second_wind',
      usesPerPhase: 1,
      stackPolicy: 'add',
      activationPolicy: 'normal',
      listeners: [
        {
          hook: 'useActive',
          scope: 'ownerActor',
          priority: 0,
          maxPerRoot: 1,
          maxPerPhase: 32,
          effect: {
            op: 'sequence',
            effects: [
              { op: 'grantAction', amount: 1, kind: 'any', key: 'local_second_wind' },
              { op: 'applyStatus', statusId: 'local_strain', stacks: 1, expiry: 'nextOwnPhaseStart' },
            ],
          },
        },
      ],
    },
    {
      schemaVersion: 1,
      id: 'local_strain',
      rulesVersion: RULES_VERSION,
      provenanceJobId: attemptId,
      name: 'Oath Strain',
      kind: 'status',
      costs: { hp: 0, actions: 0 },
      useKey: '',
      usesPerPhase: 0,
      stackPolicy: 'add',
      activationPolicy: 'normal',
      listeners: [
        {
          hook: 'kill',
          scope: 'ownerActor',
          priority: 0,
          maxPerRoot: 1,
          maxPerPhase: 32,
          effect: {
            op: 'sequence',
            effects: [
              { op: 'removeStatus', statusId: 'local_strain' },
              { op: 'heal', amount: 6 },
            ],
          },
        },
        {
          hook: 'statusExpiry',
          scope: 'ownedStatus',
          priority: 0,
          maxPerRoot: 1,
          maxPerPhase: 32,
          effect: {
            op: 'dealDamage',
            amount: { op: 'add', left: 8, right: { op: 'multiply', left: 4, right: { read: 'stackCount' } } },
          },
        },
      ],
    },
  ];

  const compiledPack = compileRules(rulePack);
  const build: ChapterBuild = {
    schemaVersion: 1,
    abilityName: 'Second Wind',
    statusName: 'Oath Strain',
    abilitySummary: 'Pay 3 HP to gain an extra action; clear strain with a kill or suffer expiry damage.',
    introChronicle: 'Fallback scouts muster along the border.',
    rulePack,
  };

  return buildBattleStateFromChapter({
    attemptId,
    epoch,
    source: 'local_fallback',
    premise,
    plan,
    build,
    compiledPack,
    activeAbilityId: 'local_second_wind',
    providerUsed: 'local-fallback',
    modelUsed: 'deterministic-template',
    repaired: false,
    fallbackReason,
  });
}

/**
 * Acceptance fixture (SPEC §4 & M5): A technically valid Seize chapter whose seize objective
 * is sealed behind an impassable wall. There is no fairness/winnability gate; it passes
 * validation and reaches `'expiry'` defeat when maxTurns elapse.
 */
export function createImpossibleSeizeFixture(): GeneratedChapterPreview {
  const plan: ChapterPlan = {
    schemaVersion: 1,
    title: 'Sealed Sanctuary (Impossible Seize)',
    archetype: 'fortress_siege',
    objective: 'seize',
    maxTurns: 6,
    summary: 'Sanctuary gate is sealed by solid stone; no path reaches the seize crest.',
    units: [
      { id: 'fix_vanguard', name: 'Rowan', title: 'Siege Lead', faction: 'player', weaponTag: 'sword', weaponName: 'Steel Blade', hp: 30, str: 10, mag: 2, skl: 8, spd: 9, lck: 4, def: 6, res: 3, mov: 4, grantActiveAbility: true },
      { id: 'fix_warden', name: 'Tamsin', title: 'Shieldmate', faction: 'player', weaponTag: 'lance', weaponName: 'Vow Pike', hp: 32, str: 9, mag: 2, skl: 7, spd: 8, lck: 4, def: 7, res: 4, mov: 4, grantActiveAbility: false },
      { id: 'fix_sentry', name: 'Hollis', title: 'Stone Guard', faction: 'enemy', weaponTag: 'lance', weaponName: 'Gate Pike', hp: 24, str: 7, mag: 2, skl: 5, spd: 5, lck: 1, def: 5, res: 3, mov: 2, grantActiveAbility: false },
      { id: 'fix_keeper', name: 'Varn', title: 'Vault Keeper', faction: 'enemy', weaponTag: 'axe', weaponName: 'Vault Axe', hp: 26, str: 8, mag: 2, skl: 5, spd: 5, lck: 1, def: 6, res: 3, mov: 2, grantActiveAbility: false },
    ],
  };

  const rulePack: RuleDefinition[] = [
    {
      schemaVersion: 1,
      id: 'fixture_stride',
      rulesVersion: RULES_VERSION,
      provenanceJobId: 'fixture-impossible-seize',
      name: 'Siege Stride',
      kind: 'active',
      costs: { hp: 2, actions: 0 },
      useKey: 'fixture_stride',
      usesPerPhase: 1,
      stackPolicy: 'add',
      activationPolicy: 'normal',
      listeners: [
        {
          hook: 'useActive',
          scope: 'ownerActor',
          priority: 0,
          maxPerRoot: 1,
          maxPerPhase: 32,
          effect: { op: 'grantAction', amount: 1, kind: 'any', key: 'fixture_stride' },
        },
      ],
    },
  ];

  const validPlan = validateChapterPlan(plan);
  const validBuild = validateChapterBuild(
    {
      schemaVersion: 1,
      abilityName: 'Siege Stride',
      statusName: 'None',
      abilitySummary: 'Pay 2 HP for an extra action.',
      introChronicle: 'The sanctuary wall stands unbroken.',
      rulePack,
    },
    'fixture-impossible-seize',
  );
  if (!validPlan.ok || !validBuild.ok) {
    throw new Error('Impossible seize fixture must pass schema validation');
  }

  const preview = buildBattleStateFromChapter({
    attemptId: 'fixture-impossible-seize',
    epoch: 1,
    source: 'generated',
    premise: 'Reach the sealed sanctuary throne.',
    plan: validPlan.plan,
    build: validBuild.build,
    compiledPack: validBuild.compiledPack,
    activeAbilityId: validBuild.activeAbilityId,
    providerUsed: 'fixture',
    modelUsed: 'fixture',
    repaired: false,
    fallbackReason: null,
  });

  // Seal the seize tile (9,4) behind an unbroken wall column so expiry triggers cleanly.
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    preview.battleState.terrain[y]![7] = 'wall';
  }
  preview.battleState.units[2]!.pos = { x: 8, y: 4 };
  preview.battleState.units[2]!.mov = 0;
  preview.battleState.units[3]!.pos = { x: 8, y: 5 };
  preview.battleState.units[3]!.mov = 0;

  return preview;
}
