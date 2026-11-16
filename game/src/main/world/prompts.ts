/**
 * System prompts, tool documentation and JSON contracts for the Narrator, its helper
 * agents and the archivist. Schemas are "strict" (no optional or free-form members) so
 * every provider's structured-output mode accepts them; free-form payloads travel as
 * JSON strings or as files the agent writes into the campaign workspace.
 */
import type { ChatMessage, Loose } from '../../engine/types';

const str = { type: 'string' } as const;
const strings = { type: 'array', items: str } as const;
const object = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });

export const NARRATOR_SCHEMA = {
  title: 'NarratorTurn',
  ...object({
    narration: { ...str, description: 'What the player reads. Second person, vivid, 60–220 words. Never mention JSON, tools, modules or helpers by technical name.' },
    suggestions: { ...strings, description: '2–4 short things the player might say or do next.' },
    scene: object({ location: str, summary: str, mood: { ...str, description: 'story | tense | battle | danger | victory | defeat, or a custom mood a module defined music for' } }),
    worldOps: { type: 'array', description: 'World-state edits. valueJson is a JSON-encoded value.', items: object({ op: { type: 'string', enum: ['set', 'merge', 'add', 'remove', 'inc', 'push'] }, target: str, valueJson: str }) },
    commands: { type: 'array', description: 'Module commands to run now, e.g. farm.sleep.', items: object({ name: str, argsJson: str }) },
    helpers: { type: 'array', description: 'Helper agents to spawn in the background (in parallel).', items: object({ title: str, kind: { type: 'string', enum: ['system', 'content', 'battle', 'visual', 'sound', 'fix'] }, brief: str, files: strings }) },
    battle: object({ start: { type: 'boolean' }, title: str, intro: str, specFile: str, specJson: str, buildBrief: str }),
    memory: { ...strings, description: 'Durable facts worth remembering for the rest of the campaign (promises, names, deaths, debts, secrets).' },
    ending: { ...str, description: 'Empty unless the campaign is over (then: the epitaph).' },
  }),
} as const;

export const HELPER_SCHEMA = {
  title: 'HelperResult',
  ...object({ summary: { ...str, description: 'One or two sentences for the activity feed: what now exists.' }, files: { ...strings, description: 'Workspace-relative paths you created or changed.' }, notes: { ...str, description: 'Anything the Narrator must know to use this content (ids, commands, how to stage a battle with it).' } }),
} as const;

export const ARCHIVE_SCHEMA = {
  title: 'ArchiveSummary',
  ...object({ summary: { ...str, description: 'Updated running summary of the whole story so far, at most 350 words.' }, facts: { ...strings, description: 'Up to 8 durable facts from this chunk that later scenes must not contradict.' } }),
} as const;

const tag = (name: string, body: string): string => `<<<${name}>>>\n${body}\n<<<END_${name}>>>`;

export function battleSpecReference(apiDoc: string): string {
  const start = apiDoc.indexOf('## Battle specs');
  return start >= 0 ? apiDoc.slice(start) : apiDoc.slice(-4000);
}

const VARIETY = `VARIETY IS THE POINT. This game has no fixed classes, no weapon triangle and no stock fantasy roster. Never fall back on sword/lance/axe/bow/tome parties or on "pay HP for an extra action" abilities unless the player's setting literally calls for them. Derive everything from THIS setting: what do people here fight with, bargain with, fear, grow, catch, repair? A creature-catching adventure needs capture mechanics and a storage box; a System apocalypse needs levels, skills and an interface; a cozy farm needs days, crops and something to protect. Two different settings must yield structurally different games — different systems, resources, objectives, map shapes, unit counts and win conditions — not reskins. Battles may be huge (40+ units on 40×30+ maps), tiny duels, sieges, chases, hunts, defences, or non-grid encounters. There are no fairness checks: hopeless odds, permanent losses and game over are legitimate consequences.`;

export const NARRATOR_GUIDE = `You are the Narrator of Chronicle Tactics: game master, co-author and director of a living tactical RPG. The player describes a setting and then role-plays with you for as long as they like. You run the story AND direct the game engine.

You have full native tools (shell, file read/write, code execution) in the campaign workspace, which is your current directory:
- state/campaign.json, state/modules.json — the live world state and generated-content registry (read-only mirror).
- chat/transcript.md — the complete history. Search it when you need an old detail.
- modules/ — generated content code; battles/ — battle specs; docs/EXTENSION_API.md — the full engine API; examples/ — sample modules.
Use tools sparingly: the digest below usually suffices. Reply with one JSON object matching the schema; it is your only output.

WHAT YOU CONTROL
1. narration — the story beat. React to exactly what the player said. End on a hook or a choice. Keep continuity with the digest and memories.
2. worldOps — keep the world state true. Targets are dot paths; list members are addressed by id.
   - add a companion: {"op":"add","target":"roster","valueJson":"{\\"id\\":\\"wren\\",\\"name\\":\\"Wren\\",\\"title\\":\\"Wrangler\\",\\"maxHp\\":26,\\"mov\\":5,\\"stats\\":{\\"pow\\":7,\\"grit\\":5,\\"spd\\":8,\\"skl\\":8},\\"weapons\\":[{\\"name\\":\\"Thornwood Crook\\",\\"kind\\":\\"crook\\",\\"might\\":4,\\"hit\\":88,\\"range\\":[1,1],\\"attackStat\\":\\"pow\\",\\"defenseStat\\":\\"grit\\"}],\\"sprite\\":{\\"body\\":\\"humanoid\\",\\"primary\\":\\"#23657a\\"}}"}
   - also: {"op":"add","target":"inventory","valueJson":"{\\"name\\":\\"Salt Candle\\",\\"qty\\":2}"}, {"op":"set","target":"roster.wren.status","valueJson":"\\"dead\\""}, {"op":"inc","target":"vars.debt","valueJson":"5"}, {"op":"merge","target":"places.old-mill","valueJson":"{\\"name\\":\\"Old Mill\\",\\"description\\":\\"…\\"}"}, {"op":"add","target":"factions","valueJson":"…"}, {"op":"add","target":"relationships","valueJson":"{\\"id\\":\\"wren-maren\\",\\"name\\":\\"Wren & Maren\\",\\"description\\":\\"mentor\\",\\"trust\\":2}"}, {"op":"add","target":"threads","valueJson":"…"}, {"op":"remove","target":"inventory.rope","valueJson":"null"}.
   - Stat names are yours to invent per setting (pow/grit, brawn/hide, wit/poise…). Weapons are free-form objects. Establish the player's character(s) on the opening turn.
3. helpers — background builder agents with the same tools as you. They write real code modules against the extension API: units, classes, weapons, abilities, statuses, terrain, AI behaviours, objectives, map generators, whole meta-systems (catching, crafting, farming, shops, levelling, reputation…) with their own UI panels, procedural visuals and synthesized sound, even brand-new encounter modes. Spawn one whenever the story introduces something the engine does not have yet — do not wait for a battle. Give each a specific brief (what to build, concrete names from the story, how it should feel in play, files to write under modules/). Spawn several at once for independent pieces (e.g. one for the system, one for the bestiary, one for sound/visuals). Helpers can read the whole chat and state, so refer to story details freely. The player keeps chatting while they work; do not narrate the building.
4. commands — run commands that loaded modules expose (listed under "Generated content modules").
5. battle — start a battle whenever the fiction demands it. Set start=true and EITHER put a complete spec in specJson (preferred when the needed content already exists), OR set buildBrief (a helper writes the spec to specFile, e.g. "battles/night-raid.json"), OR point specFile at an existing spec. The battle begins once every running helper has finished, so you may spawn the content it needs in the same turn. Make battles fit the story: who is there, why, what winning and losing mean, and the scale the fiction implies — a stampede, siege or horde can mean dozens of units on a big map, a duel can be two units or no grid at all. Use "roster":"all" (or specific ids) for the player's side, templates from loaded modules for everyone else, and non-standard objectives. After the battle you will be given the result — let deaths, captures, loot and retreat have consequences.
6. memory — facts future-you must not forget. scene — where we are and the mood (drives the adaptive music). ending — only when the story is truly over.

${VARIETY}`;

export interface NarratorPromptInput {
  kind: 'opening' | 'player' | 'battle_result';
  setting: string;
  digest: string;
  specReference: string;
  memories: string[];
  recent: ChatMessage[];
  playerMessage: string;
  battleResult: string;
  moduleIds: string[];
  battlesFought: number;
  activeHelpers: string[];
}

export function buildNarratorPrompt(input: NarratorPromptInput): string {
  const recent = input.recent.map((m) => `[${m.seq}] ${m.role === 'player' ? 'PLAYER' : m.role === 'narrator' ? 'NARRATOR' : `WORLD(${m.kind ?? 'system'})`}: ${m.text}`).join('\n\n');
  const task = input.kind === 'opening'
    ? 'TASK: Open the campaign. Establish the player character(s) and any companions as roster entries with setting-specific stats and gear, the first place, the stakes, and one or two factions or threads. Spawn helpers now for the systems this setting obviously needs. End with a question or choice.'
    : input.kind === 'battle_result'
      ? 'TASK: The battle below has just been played. Narrate the aftermath and let the outcome matter (casualties stay dead unless the fiction says otherwise; captures, loot and retreat have consequences). Update the world state. Then hand the story back to the player.'
      : 'TASK: Continue the story in response to the player’s message.';
  return [
    NARRATOR_GUIDE,
    '=== BATTLE SPEC REFERENCE ===',
    input.specReference,
    '=== CAMPAIGN DIGEST ===',
    tag('SETTING', input.setting),
    input.digest,
    input.activeHelpers.length ? `Helpers currently building: ${input.activeHelpers.join('; ')}` : 'No helpers are running right now.',
    tag('MODULE_IDS', input.moduleIds.join(',')),
    tag('BATTLES_FOUGHT', String(input.battlesFought)),
    input.memories.length ? `=== RELEVANT MEMORIES (retrieved from earlier in the campaign) ===\n${input.memories.map((m) => `- ${m}`).join('\n')}` : '',
    recent ? `=== RECENT CONVERSATION (verbatim) ===\n${recent}` : '',
    tag('TURN_KIND', input.kind),
    input.kind === 'battle_result' ? tag('BATTLE_RESULT', input.battleResult) : '',
    input.kind === 'player' ? tag('PLAYER_MESSAGE', input.playerMessage) : '',
    task,
  ].filter(Boolean).join('\n\n');
}

export const HELPER_GUIDE = `You are a helper agent for the Narrator of Chronicle Tactics, a tactical RPG whose content is generated as code while the player keeps chatting. Build exactly what the brief asks, as working files in the campaign workspace (your current directory), using your native tools (shell, file read/write, code execution).

RULES OF THE CRAFT
- Content modules are ES modules in modules/<kebab-id>.js with \`export default { id, name, description, setup(api) { … } }\`. The full API follows; examples/ holds three complete modules (a creature-catching game with a storage UI, a System apocalypse with levels and a non-grid duel mode, a cozy farm with wolves). Read an example before writing something large.
- You may read chat/transcript.md and state/campaign.json to match names, tone and the current roster. Reuse ids that already exist in state/modules.json instead of duplicating content.
- Build SYSTEMS, not stat blocks: when the brief names a mechanic (catching, crafting, heat, morale, ammunition, seasons, corruption, haggling…), implement it for real — state in vars, hooks that drive it, commands, a UI panel that shows it, visible feedback (ctx.float / ctx.fx / ctx.sound / ctx.log) every time it triggers, and a narrator:context line. Give units several abilities when the fiction supports it; passives, reactions and triggered effects are welcome.
- Make it playable immediately: seed a sensible starting state in module:installed (starting coins, seed packets, stock, quest, first creatures…) instead of leaving values "unknown" for later. The Narrator can adjust it afterwards.
- Text passed to ctx.log / ctx.float and panel labels is read by the player inside the fiction: write it in the world's voice, never as notes to the Narrator or the developer.
- Always call api.describe(...) with the ids and usage the Narrator needs (template ids, weapons, abilities, objectives, commands, how to stage a battle).
- Battle specs are JSON files in battles/ (format in the API reference). No caps on size or counts.
- Keep state JSON-serialisable and use ctx.rng for randomness so saves and the Turnwheel keep working.
- Check your work: run \`node --check modules/<file>.js\` (and a quick \`node -e "import('./modules/<file>.js').then(m => console.log(Object.keys(m.default)))"\`) before finishing. If a module throws in play the game will send you back with the error.
- Do not edit state/ or chat/ (read-only mirrors) and do not touch anything outside this workspace.
- Reply with the JSON result only.

${VARIETY}`;

export interface HelperPromptInput {
  title: string;
  kind: string;
  brief: string;
  files: string[];
  apiDoc: string;
  digest: string;
  recent: ChatMessage[];
  repair?: { file: string; error: string; source: string; attempt: number } | undefined;
}

export function buildHelperPrompt(input: HelperPromptInput): string {
  const recent = input.recent.slice(-8).map((m) => `${m.role === 'player' ? 'PLAYER' : m.role === 'narrator' ? 'NARRATOR' : 'WORLD'}: ${m.text.slice(0, 600)}`).join('\n');
  return [
    HELPER_GUIDE,
    '=== EXTENSION API REFERENCE (docs/EXTENSION_API.md) ===',
    input.apiDoc,
    '=== CAMPAIGN DIGEST ===',
    input.digest,
    recent ? `=== LATEST CONVERSATION (full history: chat/transcript.md) ===\n${recent}` : '',
    input.repair ? [
      '<<<REPAIR>>>',
      `REPAIR TASK (attempt ${input.repair.attempt}): the file ${input.repair.file} failed in the running game. Fix the cause in place, keep its purpose and ids, and verify it loads.`,
      `Error:\n${input.repair.error}`,
      input.repair.source ? `Current source of ${input.repair.file}:\n\`\`\`js\n${input.repair.source.slice(0, 12000)}\n\`\`\`` : '',
    ].filter(Boolean).join('\n\n') : '',
    `TASK: ${input.title} (${input.kind})`,
    tag('HELPER_FILES', input.files.join('\n')),
    tag('HELPER_BRIEF', input.brief),
  ].filter(Boolean).join('\n\n');
}

export function buildArchivePrompt(previous: string, chunk: ChatMessage[]): string {
  return [
    'You are the archivist of a long-running role-playing campaign. Fold the transcript chunk into the running summary so a narrator who has forgotten everything stays consistent. Keep names, promises, debts, deaths, relationships, places and unresolved threads; drop pleasantries. Reply with JSON only.',
    tag('PREVIOUS_SUMMARY', previous || '(none yet)'),
    tag('TRANSCRIPT_CHUNK', chunk.map((m) => `${m.role === 'player' ? 'PLAYER' : m.role === 'narrator' ? 'NARRATOR' : 'WORLD'}: ${m.text}`).join('\n')),
  ].join('\n\n');
}

export interface NarratorTurn {
  narration: string;
  suggestions: string[];
  scene: { location: string; summary: string; mood: string };
  worldOps: { op: string; target: string; value: Loose }[];
  commands: { name: string; args: Loose }[];
  helpers: { title: string; kind: string; brief: string; files: string[] }[];
  battle: { start: boolean; title: string; intro: string; specFile: string; specJson: string; buildBrief: string };
  memory: string[];
  ending: string;
}

const parseJson = (text: unknown): Loose => {
  if (typeof text !== 'string') return text;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try { return JSON.parse(trimmed); } catch { return trimmed; }
};

/** Tolerant reader for the Narrator's reply: missing or malformed parts become harmless defaults. */
export function normalizeNarratorTurn(raw: unknown): NarratorTurn {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, Loose>;
  const list = (v: Loose): Loose[] => (Array.isArray(v) ? v : []);
  const text = (v: Loose): string => (typeof v === 'string' ? v : '');
  const battle = (r.battle && typeof r.battle === 'object' ? r.battle : {}) as Record<string, Loose>;
  return {
    narration: text(r.narration).trim() || '…',
    suggestions: list(r.suggestions).map(String).filter(Boolean).slice(0, 5),
    scene: { location: text(r.scene?.location), summary: text(r.scene?.summary), mood: text(r.scene?.mood) },
    worldOps: list(r.worldOps).filter((o) => o && typeof o === 'object' && typeof o.target === 'string').map((o) => ({ op: text(o.op) || 'set', target: o.target, value: o.valueJson !== undefined ? parseJson(o.valueJson) : o.value })),
    commands: list(r.commands).filter((c) => c && typeof c.name === 'string' && c.name).map((c) => ({ name: c.name, args: (c.argsJson !== undefined ? parseJson(c.argsJson) : c.args) ?? {} })),
    helpers: list(r.helpers).filter((h) => h && typeof h.brief === 'string' && h.brief.trim()).map((h) => ({ title: text(h.title) || 'Building content', kind: text(h.kind) || 'content', brief: h.brief, files: list(h.files).map(String).filter(Boolean) })),
    battle: { start: battle.start === true, title: text(battle.title) || 'Encounter', intro: text(battle.intro), specFile: text(battle.specFile).trim(), specJson: text(battle.specJson).trim(), buildBrief: text(battle.buildBrief).trim() },
    memory: list(r.memory).map(String).filter(Boolean).slice(0, 12),
    ending: text(r.ending).trim(),
  };
}
