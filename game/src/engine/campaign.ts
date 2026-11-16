/**
 * Open-ended campaign state: roster, inventory, relationships, factions, places,
 * story memory and module-owned meta-systems (`vars`). Pure and JSON-only.
 */
import { summarizeBattle, unitToRoster } from './battle';
import { ModuleFault, emitGlobal, invoke, isFaulted, normalizeSprite, slug, type Registry } from './registry';
import { hashString, makeRng, type Rng } from './rng';
import {
  ENGINE_VERSION,
  type BattleRecord, type BattleState, type CampaignState, type InventoryItem, type Loose, type ModuleFaultInfo, type RosterUnit,
  type Vars, type WorldEntity, type WorldOp,
} from './types';

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback);
const text = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : v === undefined || v === null ? fallback : String(v));
const obj = (v: unknown): Record<string, Loose> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, Loose>) : {});

/** A short working title from the setting (the Narrator can rename it with a `set title` op). */
export function campaignTitle(setting: string): string {
  const first = setting.split(/[.!?\n:;—]/)[0]!.trim();
  if (first.length <= 48) return first || 'Untitled campaign';
  const cut = first.slice(0, 48);
  return `${cut.slice(0, Math.max(20, cut.lastIndexOf(' '))).replace(/[,\s]+$/, '')}…`;
}

export function newCampaign(id: string, setting: string, now: number): CampaignState {
  const clean = setting.trim();
  return {
    engine: ENGINE_VERSION, id,
    title: campaignTitle(clean),
    setting: clean, seed: hashString(`${id}/${clean}`) || 1, rngPos: 0,
    createdAt: now, updatedAt: now, turn: 0, status: 'active', ending: null,
    scene: { location: '', summary: '', mood: 'story' },
    roster: [], inventory: [], factions: [], relationships: [], places: [], threads: [],
    facts: [], factSeq: 0, summary: '', summarizedThrough: 0, battles: [],
    vars: {}, rules: { healAfterBattle: true, defeatMeans: 'dead' }, installed: [],
    activeBattleId: null, pendingBattle: null, suggestions: [],
  };
}

export function normalizeRosterUnit(raw: Loose, existing?: RosterUnit): RosterUnit {
  const r = obj(raw), base: Partial<RosterUnit> = existing ?? {};
  const name = text(r.name, base.name ?? text(r.id, 'Nameless'));
  const maxHp = Math.max(1, Math.round(num(r.maxHp ?? r.hp, base.maxHp ?? 20)));
  const stats: Record<string, number> = { ...(base.stats ?? {}) };
  for (const [k, v] of Object.entries(obj(r.stats))) stats[k] = num(v, 0);
  const template = r.template ?? r.classId ?? r.class ?? base.template;
  return {
    id: slug(r.id ?? base.id ?? name, 'member'),
    name,
    title: text(r.title, base.title ?? ''),
    classId: text(r.classId ?? r.class ?? r.template, base.classId ?? 'unit'),
    ...(template ? { template: String(template) } : {}),
    status: text(r.status, base.status ?? 'active'),
    hp: Math.max(0, Math.min(maxHp, Math.round(num(r.hp, base.hp ?? maxHp)))),
    maxHp,
    mov: Math.max(0, Math.round(num(r.mov, base.mov ?? 4))),
    moveType: text(r.moveType, base.moveType ?? 'foot'),
    stats,
    weapons: r.weapons !== undefined ? [r.weapons].flat() : r.weapon !== undefined ? [r.weapon] : base.weapons ?? [],
    abilities: Array.isArray(r.abilities) ? r.abilities.map(String) : base.abilities ?? [],
    tags: Array.isArray(r.tags) ? r.tags.map(String) : base.tags ?? [],
    vars: { ...(base.vars ?? {}), ...obj(r.vars) },
    sprite: { ...(base.sprite ?? {}), ...normalizeSprite(r.sprite) },
    level: Math.max(1, Math.round(num(r.level, base.level ?? 1))),
    xp: Math.max(0, Math.round(num(r.xp, base.xp ?? 0))),
    notes: text(r.notes, base.notes ?? ''),
    ...(typeof r.ai === 'string' ? { ai: r.ai } : base.ai ? { ai: base.ai } : {}),
  };
}

export function normalizeItem(raw: Loose, existing?: InventoryItem): InventoryItem {
  const r = typeof raw === 'string' ? { name: raw } : obj(raw);
  const name = text(r.name, existing?.name ?? text(r.id, 'Item'));
  return {
    id: slug(r.id ?? existing?.id ?? name, 'item'), name,
    qty: Math.round(num(r.qty ?? r.count ?? r.quantity, existing?.qty ?? 1)),
    kind: text(r.kind, existing?.kind ?? 'item'),
    description: text(r.description, existing?.description ?? ''),
    data: { ...(existing?.data ?? {}), ...obj(r.data) },
  };
}

function normalizeEntity(raw: Loose, existing?: WorldEntity): WorldEntity {
  const r = typeof raw === 'string' ? { name: raw } : obj(raw);
  const name = text(r.name, existing?.name ?? text(r.id, 'Unnamed'));
  return { ...(existing ?? {}), ...r, id: slug(r.id ?? existing?.id ?? name, 'entry'), name, description: text(r.description, existing?.description ?? '') };
}

const COLLECTIONS = ['roster', 'inventory', 'factions', 'relationships', 'places', 'threads'] as const;
type Collection = (typeof COLLECTIONS)[number];
const isCollection = (key: string): key is Collection => (COLLECTIONS as readonly string[]).includes(key);

function upsert(c: CampaignState, collection: Collection, value: Loose, forcedId?: string): void {
  const raw: Record<string, Loose> = typeof value === 'string' ? { name: value } : { ...obj(value) };
  if (forcedId && raw.id === undefined) raw.id = forcedId;
  const id = slug(raw.id ?? raw.name, 'entry');
  const listRef = c[collection] as Loose[];
  const index = listRef.findIndex((e) => e.id === id);
  const existing = index >= 0 ? listRef[index] : undefined;
  const next = collection === 'roster' ? normalizeRosterUnit(raw, existing) : collection === 'inventory' ? normalizeItem(raw, existing) : normalizeEntity(raw, existing);
  if (index >= 0) listRef[index] = next; else listRef.push(next);
}

function resolve(root: Loose, segments: string[], create: boolean): { parent: Loose; key: string | number } | null {
  let node = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    if (Array.isArray(node)) {
      let found = node.find((e) => e && (e.id === seg || slug(e.name) === slug(seg)));
      if (!found) { if (!create) return null; found = { id: slug(seg), name: seg }; node.push(found); }
      node = found;
    } else if (node && typeof node === 'object') {
      if (node[seg] === undefined || node[seg] === null) { if (!create) return null; node[seg] = {}; }
      node = node[seg];
    } else return null;
  }
  const last = segments.at(-1)!;
  if (Array.isArray(node)) {
    const index = node.findIndex((e) => e && (e.id === last || slug(e.name) === slug(last)));
    return { parent: node, key: index >= 0 ? index : /^\d+$/.test(last) ? Number(last) : -1 };
  }
  return node && typeof node === 'object' ? { parent: node, key: last } : null;
}

/**
 * Applies Narrator/world operations. Tolerant: an op that cannot be applied is
 * reported in the returned notes instead of throwing.
 * Targets are dot paths; array members are addressed by id, e.g. `roster.wren.hp`,
 * `inventory.snare-orb.qty`, `vars.farm.day`, `places.old-mill`.
 */
export function applyWorldOps(c: CampaignState, ops: WorldOp[]): string[] {
  const notes: string[] = [];
  const PROTECTED = new Set(['engine', 'id', 'seed', 'rngPos', 'createdAt', 'facts', 'factSeq', 'battles', 'activeBattleId', 'pendingBattle', 'installed', 'summarizedThrough']);
  for (const op of ops) {
    try {
      const target = text(op?.target).trim(), kind = text(op?.op).trim();
      const segments = target.split('.').filter(Boolean);
      const head = segments[0] ?? '';
      if (!head || PROTECTED.has(head)) { notes.push(`Ignored op on '${target}'.`); continue; }
      if (isCollection(head) && segments.length <= 2 && (kind === 'add' || kind === 'set' || kind === 'merge')) {
        if (head === 'inventory' && kind === 'add') {
          const item = normalizeItem(segments[1] && typeof op.value !== 'object' ? { id: segments[1], qty: op.value } : op.value);
          if (segments[1]) item.id = slug(segments[1]);
          const have = c.inventory.find((i) => i.id === item.id);
          if (have) have.qty += item.qty; else c.inventory.push(item);
        } else if (segments.length === 1 && Array.isArray(op.value)) for (const v of op.value) upsert(c, head, v);
        else upsert(c, head, op.value, segments[1]);
        continue;
      }
      const ref = resolve(c, segments, kind !== 'remove');
      if (!ref) { notes.push(`No such target '${target}'.`); continue; }
      const { parent, key } = ref;
      switch (kind) {
        case 'set': if (Array.isArray(parent) && key === -1) parent.push(op.value); else parent[key] = op.value; break;
        case 'merge': parent[key] = { ...obj(parent[key]), ...obj(op.value) }; break;
        case 'inc': parent[key] = num(parent[key], 0) + num(op.value, 1); break;
        case 'push': case 'add': if (!Array.isArray(parent[key])) parent[key] = parent[key] === undefined ? [] : [parent[key]]; parent[key].push(op.value); break;
        case 'remove':
          if (Array.isArray(parent)) { if (typeof key === 'number' && key >= 0) parent.splice(key, 1); }
          else delete parent[key];
          break;
        default: notes.push(`Unknown op '${kind}'.`);
      }
    } catch (error) { notes.push(`Op failed: ${error instanceof Error ? error.message : String(error)}`); }
  }
  c.inventory = c.inventory.filter((i) => i.qty > 0);
  return notes;
}

export function addFacts(c: CampaignState, facts: string[], tags: string[] = []): void {
  for (const raw of facts) {
    const t = text(raw).trim();
    if (!t || c.facts.some((f) => f.text === t)) continue;
    c.facts.push({ id: ++c.factSeq, text: t.slice(0, 600), turn: c.turn, tags });
  }
}

// ---------------------------------------------------------------- module hooks at campaign scope

export class CampaignCtx {
  readonly campaign: CampaignState;
  readonly reg: Registry;
  readonly rng: Rng;
  /** Lines appended to the story log as world events (visible to player and Narrator). */
  readonly notes: string[] = [];
  constructor(campaign: CampaignState, reg: Registry) { this.campaign = campaign; this.reg = reg; this.rng = makeRng(campaign); }
  get vars(): Vars { return this.campaign.vars; }
  log(line: string): void { this.notes.push(String(line)); }
  item(id: string): InventoryItem | undefined { return this.campaign.inventory.find((i) => i.id === id); }
  itemCount(id: string): number { return this.item(id)?.qty ?? 0; }
  addItem(id: string, qty = 1, extra: Loose = {}): InventoryItem {
    const def = this.reg.items[id];
    let item = this.item(id);
    if (!item) { item = normalizeItem({ id, name: def?.name ?? id, kind: def?.kind, description: def?.description, ...extra, qty: 0 }); this.campaign.inventory.push(item); }
    item.qty += qty;
    return item;
  }
  removeItem(id: string, qty = 1): boolean {
    const item = this.item(id);
    if (!item || item.qty < qty) return false;
    item.qty -= qty;
    if (item.qty <= 0) this.campaign.inventory = this.campaign.inventory.filter((i) => i !== item);
    return true;
  }
  unit(id: string): RosterUnit | undefined { return this.campaign.roster.find((r) => r.id === id || r.name === id); }
  roster(filter?: (r: RosterUnit) => boolean): RosterUnit[] { return this.campaign.roster.filter((r) => !filter || filter(r)); }
  /** Adds a roster member from a template id and/or raw fields. */
  addUnit(raw: Loose): RosterUnit {
    const r = obj(raw), template = this.reg.units[text(r.template ?? r.classId ?? r.class)];
    const base = template ? { ...template, id: undefined, template: template.id, classId: template.id } : {};
    const unit = normalizeRosterUnit({ ...base, ...r });
    let id = unit.id, n = 1;
    while (this.campaign.roster.some((m) => m.id === id)) id = `${unit.id}-${++n}`;
    unit.id = id;
    this.campaign.roster.push(unit);
    return unit;
  }
  addFact(line: string): void { addFacts(this.campaign, [line], ['system']); }
  emit<T extends Vars>(name: string, event: T): T { emitGlobal(this.reg, name, event, this); return event; }
}

export interface CampaignTxn<T = Loose> { ok: boolean; campaign: CampaignState; value?: T; error: string | null; notes: string[]; faults: ModuleFaultInfo[] }

/** Runs generated campaign-scope code transactionally with module-fault isolation. */
export function campaignTransaction<T>(campaign: CampaignState, reg: Registry, body: (ctx: CampaignCtx) => T): CampaignTxn<T> {
  const faults: ModuleFaultInfo[] = [];
  for (let attempt = 0; attempt < 12; attempt++) {
    const draft = structuredClone(campaign);
    const ctx = new CampaignCtx(draft, reg);
    try {
      const value = body(ctx);
      return { ok: true, campaign: draft, value, error: null, notes: ctx.notes, faults };
    } catch (error) {
      if (error instanceof ModuleFault && !isFaulted(reg, error.moduleId)) { reg.faults[error.moduleId] = error.info(); faults.push(error.info()); continue; }
      return { ok: false, campaign, error: error instanceof Error ? error.message : String(error), notes: [], faults };
    }
  }
  return { ok: false, campaign, error: 'Too many faulting modules.', notes: [], faults };
}

export function runCampaignCommand(campaign: CampaignState, reg: Registry, name: string, args: Loose): CampaignTxn {
  const handler = reg.commands[name];
  if (!handler) return { ok: false, campaign, error: `Unknown command '${name}'.`, notes: [], faults: [] };
  if (isFaulted(reg, handler.module)) return { ok: false, campaign, error: `'${name}' is being repaired by a helper.`, notes: [], faults: [] };
  return campaignTransaction(campaign, reg, (ctx) => invoke(reg, handler.module, `command ${name}`, () => handler.fn(ctx, args ?? {}), { allowRejection: true }));
}

/** Fires `module:installed` once per module per campaign so systems can seed their state. */
export function installNewModules(campaign: CampaignState, reg: Registry): CampaignTxn {
  const fresh = Object.values(reg.modules).filter((m) => m.status === 'loaded' && !campaign.installed.includes(m.id)).map((m) => m.id);
  if (!fresh.length) return { ok: true, campaign, error: null, notes: [], faults: [] };
  return campaignTransaction(campaign, reg, (ctx) => {
    for (const id of fresh) {
      ctx.campaign.installed.push(id);
      for (const h of reg.hooks.get('module:installed') ?? []) if (h.module === id) invoke(reg, id, 'hook module:installed', () => h.fn({ module: id }, ctx));
    }
  });
}

// ---------------------------------------------------------------- battles ↔ campaign

/** Folds a finished battle back into the campaign: casualties, captures, loot, inventory, module state. */
export function applyBattleResult(campaign: CampaignState, battle: BattleState, reg: Registry): CampaignTxn<BattleRecord> {
  return campaignTransaction(campaign, reg, (ctx) => {
    const c = ctx.campaign;
    c.inventory = structuredClone(battle.world.inventory);
    c.vars = structuredClone(battle.world.vars);
    const casualties: string[] = [];
    for (const u of battle.units) {
      if (!u.rosterId) continue;
      const member = c.roster.find((r) => r.id === u.rosterId);
      if (!member) continue;
      const fresh = unitToRoster(u);
      Object.assign(member, { maxHp: fresh.maxHp, stats: fresh.stats, weapons: fresh.weapons, abilities: fresh.abilities, tags: fresh.tags, level: fresh.level, mov: fresh.mov, vars: { ...member.vars, ...fresh.vars } });
      if (!u.alive && !u.gone) {
        member.hp = 0; member.status = text(c.rules.defeatMeans, 'dead');
        casualties.push(member.name);
      } else if (u.gone === 'captured') { member.status = 'captured'; casualties.push(`${member.name} (captured)`); }
      else member.hp = c.rules.healAfterBattle === false ? Math.max(1, u.hp) : member.maxHp;
    }
    for (const drop of battle.result.loot) ctx.addItem(drop.id, drop.qty, { name: drop.name, ...(drop.data ? { data: drop.data } : {}) });
    const record: BattleRecord = {
      id: battle.id, title: battle.title, turn: c.turn, outcome: battle.outcome ?? 'ended', reason: battle.endReason ?? '', rounds: battle.round,
      summary: summarizeBattle(battle), casualties, captured: battle.result.captured.map((u: Loose) => text(u.name)), loot: battle.result.loot.map((l) => `${l.name} ×${l.qty}`),
    };
    const event = { battle, result: battle.result, record, capturedHandled: false };
    ctx.emit('battle:resolved', event);
    if (!event.capturedHandled) for (const unit of battle.result.captured) ctx.addUnit({ ...unit, status: 'reserve' });
    c.battles.push(record);
    c.activeBattleId = null; c.pendingBattle = null;
    addFacts(c, [`Battle "${record.title}" ended in ${record.outcome} (${record.reason}) after ${record.rounds} rounds.${casualties.length ? ` Lost: ${casualties.join(', ')}.` : ''}${record.captured.length ? ` Captured: ${record.captured.join(', ')}.` : ''}`], ['battle']);
    return record;
  });
}

// ---------------------------------------------------------------- text digest for prompts

const cap = <T>(items: T[], n: number): T[] => (items.length > n ? items.slice(0, n) : items);

export function describeRosterUnit(r: RosterUnit): string {
  const stats = Object.entries(r.stats).map(([k, v]) => `${k} ${v}`).join(' ');
  const weapons = r.weapons.map((w: Loose) => (typeof w === 'string' ? w : w?.name ?? w?.id)).filter(Boolean).join(', ');
  return `- ${r.name} [id ${r.id}] ${r.title ? `(${r.title}) ` : ''}${r.status}; HP ${r.hp}/${r.maxHp}; L${r.level}; ${stats}${weapons ? `; weapons: ${weapons}` : ''}${r.abilities.length ? `; abilities: ${r.abilities.join(', ')}` : ''}${r.tags.length ? `; tags: ${r.tags.join(', ')}` : ''}${r.notes ? `; ${r.notes}` : ''}`;
}

export function campaignDigest(c: CampaignState, reg: Registry | null): string {
  const lines: string[] = [];
  lines.push(`Campaign: ${c.title} (turn ${c.turn}, ${c.battles.length} battle(s) fought, status ${c.status})`);
  lines.push(`Setting as the player described it: ${c.setting}`);
  if (c.scene.location || c.scene.summary) lines.push(`Current scene: ${c.scene.location}${c.scene.summary ? ` — ${c.scene.summary}` : ''} (mood: ${c.scene.mood})`);
  if (c.summary) lines.push(`Story so far: ${c.summary}`);
  lines.push(c.roster.length ? `Roster (${c.roster.length}):\n${cap(c.roster, 60).map(describeRosterUnit).join('\n')}` : 'Roster: empty — nobody has been established yet.');
  if (c.inventory.length) lines.push(`Inventory: ${cap(c.inventory, 80).map((i) => `${i.name} ×${i.qty} [${i.id}]`).join(', ')}`);
  const entities = (label: string, items: WorldEntity[]): void => {
    if (items.length) lines.push(`${label}:\n${cap(items, 40).map((e) => `- ${e.name} [${e.id}]${e.description ? `: ${e.description}` : ''}${Object.entries(e).filter(([k]) => !['id', 'name', 'description'].includes(k)).map(([k, v]) => ` ${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join('')}`).join('\n')}`);
  };
  entities('Factions', c.factions); entities('Relationships', c.relationships); entities('Places', c.places); entities('Open threads', c.threads);
  if (c.battles.length) lines.push(`Recent battles:\n${c.battles.slice(-4).map((b) => `- ${b.summary}`).join('\n')}`);
  if (Object.keys(c.vars).length) lines.push(`Module state (vars): ${JSON.stringify(c.vars).slice(0, 1800)}`);
  if (Object.keys(c.rules).length) lines.push(`Campaign rules: ${JSON.stringify(c.rules)}`);
  if (reg) {
    const mods = Object.values(reg.modules);
    lines.push(mods.length
      ? `Generated content modules:\n${mods.map((m) => `- ${m.id} (${m.file}) — ${m.status}${m.error ? ` ERROR: ${m.error.split('\n')[0]}` : ''}: ${m.description}\n  provides: ${Object.entries(m.provides).map(([k, ids]) => `${k}[${ids.join(', ')}]`).join(' ')}${m.usage ? `\n  usage: ${m.usage.replace(/\n/g, '\n  ')}` : ''}`).join('\n')}`
      : 'Generated content modules: none yet. Everything distinctive about this world still needs to be built by helpers.');
    const extra = { lines: [] as string[] };
    try { emitGlobal(reg, 'narrator:context', extra, new CampaignCtx(structuredClone(c), reg)); } catch { /* context hooks are best-effort */ }
    if (extra.lines.length) lines.push(`Live system notes:\n${extra.lines.map((l) => `- ${l}`).join('\n')}`);
  }
  return lines.join('\n\n');
}
