import type {
  BattleState,
  CompiledRuleDefinition,
  CompiledRulePack,
  RuleDefinition,
  RuleEffect,
  RuleExpr,
  RuleHook,
  RuleListener,
  StatusInstance,
  UnitState,
} from '../shared/contracts';

export function hash(value: unknown): string {
  const json = JSON.stringify(value);
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i = 0; i < json.length; i++) {
    a = Math.imul(a ^ json.charCodeAt(i), 0x01000193);
    b = Math.imul(b ^ (json.charCodeAt(i) + i), 0x85ebca6b);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
export class RootFault extends Error {
  constructor(message: string, readonly definitionId: string | null = null) { super(message); }
}
export function safeInteger(n: number, nonnegative = false): number {
  if (!Number.isSafeInteger(n) || (nonnegative && n < 0)) throw new RootFault('Unsafe arithmetic intermediate');
  return n;
}
export function integer(n: number, nonnegative = false): number {
  if (!Number.isSafeInteger(n) || Math.abs(n) > 1_000_000 || (nonnegative && n < 0)) throw new RootFault('Integer representation limit');
  return n;
}
export type Expr = RuleExpr;
export type Effect = RuleEffect;
export type Hook = RuleHook;
export type Listener = RuleListener;
export type Definition = RuleDefinition;
export type CompiledDefinition = CompiledRuleDefinition;
export type RulePack = CompiledRulePack;

const seq = (...effects: Effect[]): Effect => ({ op: 'sequence', effects });
const listener = (hook: Hook, scope: Listener['scope'], effect: Effect): Listener => ({ hook, scope, effect, priority: 0, maxPerRoot: 1, maxPerPhase: 32 });
const metadata = { schemaVersion: 1 as const, rulesVersion: 'r03-1', provenanceJobId: 'authored-brass-ward', stackPolicy: 'add' as const, activationPolicy: 'normal' as const };
export const RULE_SOURCE: Definition[] = [
  { ...metadata, id: 'borrowed_second', name: 'Borrowed Second', kind: 'active', costs: { hp: 3, actions: 0 }, useKey: 'borrowed_second', usesPerPhase: 1,
    listeners: [listener('useActive', 'ownerActor', seq(
      { op: 'grantAction', amount: 1, kind: 'any', key: 'borrowed_second' },
      { op: 'applyStatus', statusId: 'temporal_debt', stacks: 1, expiry: 'nextOwnPhaseStart' },
    ))] },
  { ...metadata, id: 'temporal_debt', name: 'Temporal Debt', kind: 'status', costs: { hp: 0, actions: 0 }, useKey: '', usesPerPhase: 0,
    listeners: [listener('kill', 'ownerActor', seq({ op: 'removeStatus', statusId: 'temporal_debt' }, { op: 'heal', amount: 6 })),
      listener('statusExpiry', 'ownedStatus', { op: 'dealDamage', amount: { op: 'add', left: 10, right: { op: 'multiply', left: 5, right: { read: 'stackCount' } } } })] },
];
function exact(o: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(o).some(k => !keys.includes(k)) || keys.some(k => !(k in o))) throw new Error('Unknown or missing Rule IR field');
}
function obj(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Expected Rule IR object');
  return v as Record<string, unknown>;
}
function name(v: unknown): void { if (typeof v !== 'string' || v.length > 128 || !/^[\w -]*$/.test(v)) throw new Error('Invalid Rule IR ID/text'); }
function num(v: unknown, positive = false): void { if (typeof v !== 'number') throw new Error('Expected integer'); integer(v, positive); }
function expression(v: unknown, depth: number, budget: { nodes: number }): void {
  if (++budget.nodes > 64 || depth > 8) throw new Error('Rule expression bound exceeded');
  if (typeof v === 'number') { integer(v); return; }
  const o = obj(v);
  if (o.read === 'stackCount') { exact(o, ['read']); return; }
  if (o.read === 'counter') { exact(o, ['read', 'key']); name(o.key); return; }
  exact(o, ['op', 'left', 'right']);
  if (!['add', 'multiply', 'floorDivide'].includes(o.op as string)) throw new Error('Unsupported expression opcode');
  expression(o.left, depth + 1, budget); expression(o.right, depth + 1, budget);
  if (o.op === 'floorDivide' && o.right === 0) throw new Error('Division by zero');
}
function effect(v: unknown, depth: number, budget: { nodes: number }, refs: string[], emits: Set<Hook>): void {
  if (++budget.nodes > 64 || depth > 8) throw new Error('Rule effect bound exceeded');
  const o = obj(v);
  switch (o.op) {
    case 'sequence': exact(o, ['op', 'effects']); if (!Array.isArray(o.effects)) throw new Error('Invalid sequence'); o.effects.forEach(e => effect(e, depth + 1, budget, refs, emits)); break;
    case 'grantAction': exact(o, ['op', 'amount', 'key', 'kind']); num(o.amount, true); name(o.key); if (o.kind !== 'any') throw new Error('Unsupported credit kind'); break;
    case 'applyStatus': exact(o, ['op', 'statusId', 'stacks', 'expiry']); name(o.statusId); refs.push(o.statusId as string); num(o.stacks, true); if (o.expiry !== 'nextOwnPhaseStart') throw new Error('Unsupported expiry'); break;
    case 'removeStatus': exact(o, ['op', 'statusId']); name(o.statusId); refs.push(o.statusId as string); break;
    case 'heal': case 'dealDamage': exact(o, ['op', 'amount']); expression(o.amount, depth + 1, budget); emits.add(o.op === 'heal' ? 'afterHeal' : 'afterDamage'); if (o.op === 'dealDamage') emits.add('kill'); break;
    case 'adjustCounter': exact(o, ['op', 'key', 'amount']); name(o.key); expression(o.amount, depth + 1, budget); break;
    default: throw new Error(`Unsupported Rule IR opcode '${String(o.op)}'`);
  }
}
function describeExpr(e: Expr): string {
  if (typeof e === 'number') return `${e}`;
  if ('read' in e) return e.read === 'stackCount' ? 'stacks at expiry' : `counter ${e.key}`;
  return `(${describeExpr(e.left)} ${e.op === 'add' ? '+' : e.op === 'multiply' ? '×' : 'floor divided by'} ${describeExpr(e.right)})`;
}
function describeEffect(e: Effect): string {
  switch (e.op) {
    case 'sequence': return e.effects.map(describeEffect).join('; ');
    case 'grantAction': return `gain ${e.amount} ${e.kind} action credit (shared key ${e.key})`;
    case 'applyStatus': return `add ${e.stacks} ${e.statusId} stack, expires next own phase start`;
    case 'removeStatus': return `remove ${e.statusId}`;
    case 'heal': return `heal ${describeExpr(e.amount)} HP`;
    case 'dealDamage': return `take ${describeExpr(e.amount)} true damage (can kill)`;
    case 'adjustCounter': return `adjust ${e.key} by ${describeExpr(e.amount)}`;
  }
}
export function compileRules(input: unknown): RulePack {
  if (!Array.isArray(input) || JSON.stringify(input).length > 65536 || input.length > 64) throw new Error('Rule pack size bound');
  const pack: RulePack = {}, refs: string[] = [], edges = new Map<Hook, Set<Hook>>();
  for (const raw of input) {
    const d = obj(raw);
    exact(d, ['schemaVersion', 'id', 'rulesVersion', 'provenanceJobId', 'name', 'kind', 'costs', 'useKey', 'usesPerPhase', 'stackPolicy', 'activationPolicy', 'listeners']);
    for (const key of ['id', 'rulesVersion', 'provenanceJobId', 'name', 'useKey']) name(d[key]);
    if (!d.id || pack[d.id as string] || d.schemaVersion !== 1 || d.rulesVersion !== 'r03-1' || !['active', 'status'].includes(d.kind as string) || d.stackPolicy !== 'add' || !['normal', 'blockOrdinaryAction'].includes(d.activationPolicy as string)) throw new Error('Invalid definition');
    const costs = obj(d.costs); exact(costs, ['hp', 'actions']); num(costs.hp, true); num(costs.actions, true); num(d.usesPerPhase, true);
    if (!Array.isArray(d.listeners) || d.listeners.length > 16) throw new Error('Invalid listeners');
    const budget = { nodes: 0 };
    for (const rawListener of d.listeners) {
      const l = obj(rawListener); exact(l, ['hook', 'scope', 'priority', 'maxPerRoot', 'maxPerPhase', 'effect']);
      if (!['useActive', 'kill', 'statusExpiry', 'afterHeal', 'afterDamage'].includes(l.hook as string)) throw new Error(`Unsupported hook '${String(l.hook)}'`);
      const expectedScope = l.hook === 'statusExpiry' ? 'ownedStatus' : ['afterHeal', 'afterDamage'].includes(l.hook as string) ? 'ownerTarget' : 'ownerActor';
      if (l.scope !== expectedScope) throw new Error('Invalid event scope');
      num(l.priority); num(l.maxPerRoot, true); num(l.maxPerPhase, true);
      if (!l.maxPerRoot || !l.maxPerPhase) throw new Error('Firing limits required');
      const emits = edges.get(l.hook as Hook) ?? new Set<Hook>();
      effect(l.effect, 1, budget, refs, emits); edges.set(l.hook as Hook, emits);
    }
    const definition = structuredClone(raw) as Definition;
    const rulesText = `${definition.name}: costs ${definition.costs.hp} HP and ${definition.costs.actions} actions; ${definition.usesPerPhase} use(s) per own phase. ` + definition.listeners.map(l => `${l.hook} [${l.scope}]: ${describeEffect(l.effect)}.`).join(' ');
    pack[definition.id] = { ...definition, contentHash: hash(definition), rulesText, bound: budget.nodes };
  }
  for (const id of refs) if (pack[id]?.kind !== 'status') throw new Error(`Unknown status reference '${id}'`);
  const visit = (h: Hook, ancestry: Set<Hook>) => {
    if (ancestry.has(h)) throw new Error('Unproven trigger cycle');
    for (const next of edges.get(h) ?? []) visit(next, new Set([...ancestry, h]));
  };
  for (const hook of edges.keys()) visit(hook, new Set());
  return pack;
}
export const RULES = compileRules(RULE_SOURCE);
export function abilityTooltip(id: string, pack = RULES): string {
  const d = pack[id];
  if (!d) return 'Unsupported ability';
  const statuses = new Set<string>();
  const scan = (e: Effect): void => { if (e.op === 'applyStatus') statuses.add(e.statusId); if (e.op === 'sequence') e.effects.forEach(scan); };
  d.listeners.forEach(l => scan(l.effect));
  return [d.rulesText, ...[...statuses].map(s => pack[s]!.rulesText)].join(' ');
}
export interface RuleEvent { hook: Hook; actorId: string; targetId: string; definitionId?: string; status?: StatusInstance; depth: number }
export interface RootContext {
  state: BattleState; pack: RulePack; fuel: number; rootCounts: Record<string, number>; queue: RuleEvent[];
  draining: boolean; triggers: string[];
}
export function rootContext(state: BattleState, pack = state.rulePack ?? RULES, fuel = 4096): RootContext {
  return { state, pack, fuel, rootCounts: {}, queue: [], draining: false, triggers: [] };
}
export function tick(ctx: RootContext): void { if (--ctx.fuel < 0) throw new RootFault('Root evaluation fuel exhausted'); }
export function log(state: BattleState, kind: BattleState['events'][number]['kind'], message: string): void {
  state.events.push({ id: (state.events.at(-1)?.id ?? 0) + 1, turn: state.turn, phase: state.phase, kind, message });
}
function read(e: Expr, u: UnitState, status: StatusInstance | undefined, ctx: RootContext): number {
  tick(ctx);
  if (typeof e === 'number') return e;
  if ('read' in e) return e.read === 'stackCount' ? status?.stacks ?? 0 : u.counters[e.key] ?? 0;
  const a = read(e.left, u, status, ctx), b = read(e.right, u, status, ctx);
  return safeInteger(e.op === 'add' ? a + b : e.op === 'multiply' ? a * b : b === 0 ? NaN : Math.floor(a / b));
}
function execute(e: Effect, u: UnitState, event: RuleEvent, ctx: RootContext): void {
  tick(ctx);
  const s = ctx.state;
  switch (e.op) {
    case 'sequence': for (const child of e.effects) { execute(child, u, event, ctx); drain(ctx, true); } break;
    case 'grantAction': {
      const key = `grant:${e.key}`;
      if ((u.phaseUses[key] ?? 0) > 0) throw new Error('Shared action grant already used');
      u.phaseUses[key] = 1; u.bonusCredits = integer(u.bonusCredits + e.amount, true); u.actionCredits = integer(u.actionCredits + e.amount, true); u.hasActed = u.actionCredits === 0; break;
    }
    case 'applyStatus': {
      const definition = ctx.pack[e.statusId]!;
      const existing = u.statuses.find(st => st.definitionId === e.statusId);
      if (existing) { existing.stacks = integer(existing.stacks + e.stacks, true); existing.expiry = s.phaseOrdinal + 2; }
      else u.statuses.push({ id: `${u.id}:${e.statusId}:${s.commandOrdinal}`, definitionId: e.statusId, definitionHash: definition.contentHash, stacks: e.stacks, expiry: s.phaseOrdinal + 2, payload: {} });
      break;
    }
    case 'removeStatus': u.statuses = u.statuses.filter(st => st.definitionId !== e.statusId); break;
    case 'heal': {
      const amount = safeInteger(read(e.amount, u, event.status, ctx), true);
      if (u.alive) { const actual = Math.min(amount, u.maxHp - u.hp); u.hp += actual; log(s, 'rule', `${u.name} heals ${actual} HP.`); emit(ctx, { hook: 'afterHeal', actorId: u.id, targetId: u.id, depth: event.depth + 1 }); } break;
    }
    case 'dealDamage': damage(ctx, u.id, u.id, safeInteger(read(e.amount, u, event.status, ctx), true), event.depth + 1); break;
    case 'adjustCounter': u.counters[e.key] = integer((u.counters[e.key] ?? 0) + read(e.amount, u, event.status, ctx)); break;
  }
}
export function emit(ctx: RootContext, event: RuleEvent): void {
  if (event.depth > 8) throw new RootFault('Event ancestry exceeded');
  ctx.queue.push(event); drain(ctx);
}
function drain(ctx: RootContext, nested = false): void {
  if (ctx.draining && !nested) return;
  const wasDraining = ctx.draining;
  ctx.draining = true;
  try {
    while (ctx.queue.length) {
      tick(ctx);
      const event = ctx.queue.shift()!;
      const candidates: { u: UnitState; d: CompiledDefinition; l: Listener; index: number; status?: StatusInstance }[] = [];
      for (const u of ctx.state.units) {
        const sources = event.hook === 'statusExpiry' && event.targetId === u.id && event.status
          ? [{ id: event.status.definitionId, status: event.status }]
          : [...u.abilities.map(id => ({ id })), ...u.statuses.map(status => ({ id: status.definitionId, status }))];
        for (const source of sources) {
          const d = ctx.pack[source.id]; if (!d) throw new Error('Missing pinned definition');
          const status = 'status' in source ? source.status : undefined;
          if (status && status.definitionHash !== d.contentHash) throw new Error('Definition hash mismatch');
          d.listeners.forEach((l, index) => {
            const own = l.scope === 'ownerActor' ? event.actorId === u.id : event.targetId === u.id;
            if (l.hook === event.hook && (event.hook !== 'useActive' || event.definitionId === d.id) && own && (u.alive || event.hook === 'statusExpiry')) candidates.push({ u, d, l, index, ...(status ? { status } : {}) });
          });
        }
      }
      candidates.sort((a, b) => a.l.priority - b.l.priority || a.u.id.localeCompare(b.u.id) || a.d.contentHash.localeCompare(b.d.contentHash) || a.index - b.index);
      for (const { u, d, l, index, status } of candidates) {
        if (!u.alive && event.hook !== 'statusExpiry') continue;
        const key = `${u.id}:${d.id}:${index}`, phaseKey = `${ctx.state.phaseOrdinal}:${key}`;
        if ((ctx.rootCounts[key] ?? 0) >= l.maxPerRoot || (ctx.state.listenerCounts[phaseKey] ?? 0) >= l.maxPerPhase) continue;
        ctx.rootCounts[key] = (ctx.rootCounts[key] ?? 0) + 1;
        ctx.state.listenerCounts[phaseKey] = (ctx.state.listenerCounts[phaseKey] ?? 0) + 1;
        const explanation = `${d.name} — ${event.hook} (${l.scope})`;
        ctx.triggers.push(explanation); log(ctx.state, 'rule', explanation);
        try { execute(l.effect, u, { ...event, ...(status ? { status } : {}) }, ctx); }
        catch (error) { throw new RootFault(error instanceof Error ? error.message : String(error), d.id); }
      }
    }
  } finally { ctx.draining = wasDraining; }
}
export function damage(ctx: RootContext, actorId: string, targetId: string, amount: number, depth = 0): void {
  tick(ctx); safeInteger(amount, true);
  const u = ctx.state.units.find(unit => unit.id === targetId)!;
  if (!u.alive) return;
  const lost = Math.min(u.hp, amount); u.hp -= lost; u.alive = u.hp > 0;
  log(ctx.state, 'attack', `${u.name} loses ${lost} HP (${u.hp}/${u.maxHp}).`);
  emit(ctx, { hook: 'afterDamage', actorId, targetId, depth });
  if (!u.alive) { log(ctx.state, 'outcome', `${u.name} is defeated.`); emit(ctx, { hook: 'kill', actorId, targetId, depth: depth + 1 }); }
}
