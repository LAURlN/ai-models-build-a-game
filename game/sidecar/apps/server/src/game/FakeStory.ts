/**
 * Deterministic scripted Narrator / helper / archivist for CHRONICLE_FAKE_PROVIDER=1.
 *
 * It behaves like an agent with native tools: helpers really write module and battle
 * files into the campaign workspace (copied from the workspace's own `examples/`),
 * so the full loop — chat, background helpers, repair, battles, aftermath — can be
 * exercised offline and in tests.
 */
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";

type Json = Record<string, unknown>;

function between(prompt: string, tag: string): string {
  const open = `<<<${tag}>>>`;
  const start = prompt.lastIndexOf(open);
  if (start < 0) return "";
  const from = start + open.length;
  const end = prompt.indexOf(`<<<END_${tag}>>>`, from);
  return (end < 0 ? prompt.slice(from) : prompt.slice(from, end)).trim();
}

type Theme = "creature" | "system" | "farm" | "generic";

function themeOf(setting: string): Theme {
  const s = setting.toLowerCase();
  if (/system|apocalypse|litrpg/.test(s)) return "system";
  if (/farm|cozy|homestead/.test(s)) return "farm";
  if (/pok[eé]mon|creature|monster|tamer|catch/.test(s)) return "creature";
  if (/wolves|wolf/.test(s)) return "farm";
  return "generic";
}

const op = (kind: string, target: string, value: unknown) => ({ op: kind, target, valueJson: JSON.stringify(value) });

const THEME_MODULE: Record<Theme, string> = {
  creature: "creature-catching",
  system: "system-apocalypse",
  farm: "cozy-farm",
  generic: "",
};

function openingFor(theme: Theme, setting: string): Json {
  const base = { suggestions: [] as string[], commands: [], helpers: [], memory: [] as string[], ending: "", battle: noBattle() };
  if (theme === "creature") {
    return {
      ...base,
      narration:
        "Dawn mist lifts off the Verdant Reach. You are Wren, a newly licensed wrangler, and the ember-furred pup at your heel — Cinder — has not stopped sniffing the wind since you left Hollowmere. Somewhere ahead the tall grass is moving against the breeze. What do you do?",
      suggestions: ["I want to catch wild creatures and store them in a box.", "Head into the tall grass.", "Ask Cinder what she smells."],
      scene: { location: "Verdant Reach trailhead", summary: "Wren and Cinder set out to wrangle wild creatures.", mood: "story" },
      worldOps: [
        op("add", "roster", { id: "wren", name: "Wren", title: "Wrangler", maxHp: 26, mov: 5, stats: { pow: 7, grit: 5, spd: 8, skl: 8 }, tags: ["handler"], sprite: { body: "humanoid", primary: "#23657a", secondary: "#e9dfc5" }, weapons: [{ name: "Thornwood Crook", kind: "crook", might: 4, hit: 88, range: [1, 1], damageType: "blunt", attackStat: "pow", defenseStat: "grit", glyph: "staff" }] }),
        op("add", "roster", { id: "cinder", name: "Cinder", title: "ember creature", classId: "emberpup", maxHp: 22, mov: 5, stats: { pow: 9, grit: 4, spd: 9, skl: 6 }, tags: ["creature", "tamed", "ember"], vars: { species: "emberpup", element: "ember" }, sprite: { body: "beast", primary: "#c8553d", secondary: "#f2c078" }, weapons: [{ name: "Cinder Bite", kind: "bite", might: 4, hit: 88, damageType: "ember", attackStat: "pow", defenseStat: "grit", glyph: "fang" }] }),
        op("add", "places", { id: "hollowmere", name: "Hollowmere", description: "Wren's home village and wrangler lodge." }),
        op("add", "places", { id: "verdant-reach", name: "Verdant Reach", description: "Rolling tall-grass country full of wild herds." }),
        op("add", "threads", { id: "first-catch", name: "First catch", description: "Wren has yet to catch a wild creature." }),
      ],
      memory: ["Wren is a newly licensed wrangler from Hollowmere; her partner is the emberpup Cinder."],
    };
  }
  if (theme === "system") {
    return {
      ...base,
      narration:
        "Blue text hung in the air over the stalled traffic on Meridian Avenue at 9:14 this morning: [INTEGRATION COMPLETE]. By noon the hollowed were walking. You are Mara, a rebar spear in your hands and a courier named Jun at your back. The parking structure ahead is the only way to the river. What do you do?",
      suggestions: ["Check my status window and skills.", "Fight through the parking structure.", "Look for other survivors."],
      scene: { location: "Meridian Avenue", summary: "Hours after the System arrived.", mood: "tense" },
      worldOps: [
        op("add", "roster", { id: "mara", name: "Mara", title: "Survivor", maxHp: 28, mov: 5, stats: { pow: 8, guard: 5, will: 5, spd: 7, aim: 5, skl: 6 }, sprite: { body: "humanoid", primary: "#23657a", secondary: "#d7dccb" }, weapons: [{ id: "rebar-spear", name: "Rebar Spear", kind: "rebar", might: 6, hit: 82, range: [1, 2], damageType: "pierce", attackStat: "pow", defenseStat: "guard", glyph: "spear" }] }),
        op("add", "roster", { id: "jun", name: "Jun", title: "Courier", maxHp: 22, mov: 6, stats: { pow: 4, guard: 3, will: 6, spd: 10, aim: 9, skl: 8 }, sprite: { body: "humanoid", primary: "#3f7a4f", secondary: "#e3d9bd" }, weapons: [{ id: "nail-gun", name: "Nail Gun", kind: "nailgun", might: 4, hit: 78, range: [2, 4], damageType: "pierce", attackStat: "aim", defenseStat: "guard", counter: false, glyph: "gun" }] }),
        op("add", "factions", { id: "the-system", name: "The System", description: "An indifferent interface that arrived overnight." }),
      ],
      memory: ["The System arrived at 9:14; Mara and Jun are survivors on Meridian Avenue."],
    };
  }
  if (theme === "farm") {
    return {
      ...base,
      narration:
        "The kettle is on and the frost has not quite left the pasture. Greywillow Farm is yours now — eight plots, six sheep, and Biscuit, who has decided the porch belongs to her. Last night something howled past the ridge. What would you like to do today?",
      suggestions: ["Plant the turnip seeds and tend the farm.", "Check on the sheep.", "Stay up tonight and watch for wolves."],
      scene: { location: "Greywillow Farm", summary: "A quiet first morning on the homestead.", mood: "story" },
      worldOps: [
        op("add", "roster", { id: "tilda", name: "Tilda", title: "Homesteader", classId: "farmhand", maxHp: 20, mov: 4, stats: { brawn: 6, knack: 6, hide: 3, spd: 6 }, tags: ["farmer"], sprite: { body: "humanoid", primary: "#7d6a2c", secondary: "#e9dfc5" }, weapons: [{ id: "pitchfork", name: "Pitchfork", kind: "pitchfork", might: 4, hit: 85, range: [1, 2], damageType: "jab", attackStat: "brawn", defenseStat: "hide", glyph: "spear" }] }),
        op("add", "roster", { id: "biscuit", name: "Biscuit", title: "Working dog", classId: "sheepdog", maxHp: 16, mov: 6, stats: { brawn: 5, knack: 4, hide: 3, spd: 11 }, tags: ["dog"], sprite: { body: "beast", primary: "#3d3a36", secondary: "#f1eadb" }, weapons: [{ id: "herding-nip", name: "Herding Nip", kind: "bite", might: 3, hit: 92, damageType: "bite", attackStat: "brawn", defenseStat: "hide", glyph: "fang" }] }),
        op("add", "places", { id: "greywillow", name: "Greywillow Farm", description: "A small valley homestead with a barn, pasture and pond." }),
      ],
      memory: ["Tilda inherited Greywillow Farm; Biscuit is her sheepdog. Wolves were heard beyond the ridge."],
    };
  }
  return {
    ...base,
    narration: `The story opens: ${setting.slice(0, 220)} — You stand at its threshold with little more than a weighted rope and your wits. What do you do?`,
    suggestions: ["Look around.", "Pick a fight.", "Find allies."],
    scene: { location: "The threshold", summary: "The first moment of the tale.", mood: "story" },
    worldOps: [
      op("add", "roster", { id: "ash", name: "Ash", title: "Wanderer", maxHp: 24, mov: 5, stats: { str: 7, def: 4, spd: 8, skl: 7 }, sprite: { body: "humanoid" }, weapons: [{ name: "Weighted Rope", kind: "rope", might: 4, hit: 86, range: [1, 2], glyph: "whip" }] }),
    ],
    memory: ["Ash is a wanderer armed with a weighted rope."],
  };
}

function noBattle() {
  return { start: false, title: "", intro: "", specFile: "", specJson: "", buildBrief: "" };
}

function helperFor(theme: Theme, extra: string): Json[] {
  if (theme === "creature") {
    return [
      { title: "Creature catching & storage box", kind: "system", brief: `Build modules/creature-catching.js: wild elemental species, snare-orb capture ability with a visible catch chance, herd AI, a "catch" objective, and a party/box storage meta-system with a Creature Box UI panel. ${extra}`, files: ["modules/creature-catching.js"] },
      { title: "Field ambience (sound & terrain art)", kind: "sound", brief: "Build modules/field-ambience.js: calm pastoral story music, a livelier chase theme for battles, rustle/chirp cues and a custom tall-grass tile drawing.", files: ["modules/field-ambience.js"] },
    ];
  }
  if (theme === "system") {
    return [{ title: "The System interface", kind: "system", brief: `Build modules/system-apocalypse.js: XP and levels, Essence, a skill store and quest log panel, scavenged weapons, husk swarms and the non-grid Battle Net duel mode. ${extra}`, files: ["modules/system-apocalypse.js"] }];
  }
  if (theme === "farm") {
    return [{ title: "Homestead & wolves", kind: "system", brief: `Build modules/cozy-farm.js: day loop with plots, crops and coins, a wolf-threat clock, livestock, pack-hunter wolves, a homestead map generator and a hold-until-dawn objective. ${extra}`, files: ["modules/cozy-farm.js"] }];
  }
  return [];
}

function battleFor(theme: Theme, fought: number, message: string): { title: string; intro: string; spec: Json } {
  if (theme === "creature" && fought === 0) {
    return {
      title: "Stampede in the Tall Grass",
      intro: "Four herds share this meadow, and every one of them has noticed you.",
      spec: {
        title: "Stampede in the Tall Grass",
        intro: "Weaken a creature, snare it, then throw an orb.",
        map: { width: 40, height: 28, generator: "wilds", base: "grass", features: [{ tile: "tall-grass", amount: 0.34, scale: 5 }, { tile: "forest", amount: 0.1, scale: 4 }, { tile: "water", amount: 0.04, scale: 6 }] },
        factions: [
          { id: "party", name: "Wren's party", controller: "player", color: "#23657a", shape: "shield" },
          { id: "wild", name: "Wild herds", controller: "ai", color: "#7d6a2c", shape: "hex", ai: "herd" },
        ],
        units: [
          { roster: "all", faction: "party", area: [2, 11, 5, 16] },
          { template: "mossling", faction: "wild", count: 12, area: [10, 4, 22, 22] },
          { template: "emberpup", faction: "wild", count: 10, area: [24, 6, 37, 20] },
          { template: "galewing", faction: "wild", count: 8, area: [18, 0, 38, 8] },
          { template: "cragback", faction: "wild", count: 6, area: [22, 18, 38, 27] },
        ],
        objective: { text: "Catch a wild creature (or drive off every herd)", win: [{ type: "catch", count: 1 }, { type: "rout" }], turnLimit: 30 },
      },
    };
  }
  if (theme === "creature") {
    return {
      title: "Rival at the Ford",
      intro: "Corvin of the Ashgrove lodge blocks the crossing with a team of his own.",
      spec: {
        title: "Rival at the Ford",
        intro: "A licensed duel: first team unable to continue yields.",
        map: { width: 24, height: 16, generator: "wilds", base: "grass", features: [{ tile: "tall-grass", amount: 0.15, scale: 4 }], stamps: [{ tile: "water", line: [12, 0, 12, 15], width: 2 }, { tile: "bridge", rect: [11, 6, 3, 4] }] },
        factions: [
          { id: "party", name: "Wren's party", controller: "player" },
          { id: "rival", name: "Corvin's team", controller: "ai", color: "#5b4a7a", shape: "diamond" },
        ],
        units: [
          { roster: "all", faction: "party", area: [1, 5, 4, 10] },
          { name: "Corvin", title: "Rival wrangler", faction: "rival", pos: [21, 8], maxHp: 26, mov: 5, stats: { pow: 7, grit: 5, spd: 7, skl: 7 }, sprite: { body: "humanoid", primary: "#5b4a7a" }, weapons: ["snare-sling"], ai: "defensive" },
          { template: "tidefin", faction: "rival", count: 2, area: [17, 5, 20, 10], ai: "aggressive" },
          { template: "galewing", faction: "rival", count: 2, area: [17, 3, 21, 12], ai: "aggressive" },
          { template: "cragback", faction: "rival", count: 1, pos: [19, 8], ai: "aggressive" },
        ],
        objective: { text: "Defeat Corvin's team", win: [{ type: "rout" }], turnLimit: 24 },
      },
    };
  }
  if (theme === "system") {
    if (/duel|net/.test(message)) {
      return { title: "Battle Net: Rank Warden", intro: "The System offers a ranked duel.", spec: { title: "Battle Net: Rank Warden", mode: "net-duel", units: [{ roster: "all", faction: "player" }], vars: { duelFoe: { name: "Rank Warden", integrity: 14 } } } };
    }
    return {
      title: "Parking Structure Breach",
      intro: "Three levels of stalled cars, and every shadow is moving.",
      spec: {
        title: "Parking Structure Breach",
        map: { width: 36, height: 24, generator: "streets", base: "floor", params: { building: "barricade", street: "road", spacing: 6 }, stamps: [{ tile: "rift", blobs: 0.05, scale: 4 }] },
        units: [
          { roster: "all", faction: "player", area: "west" },
          { template: "husk", faction: "enemy", count: 24, area: [10, 0, 35, 23] },
          { template: "scrap-hound", faction: "enemy", count: 8, area: [16, 0, 35, 23] },
          { template: "spire-drone", faction: "enemy", count: 6, area: [22, 0, 35, 23] },
          { template: "rift-brute", faction: "enemy", pos: [33, 12] },
        ],
        objective: { text: "Break through: defeat the Rift Brute", win: [{ type: "defeat", tag: "boss" }], turnLimit: 40 },
      },
    };
  }
  if (theme === "farm") {
    return {
      title: "Night Raid on Greywillow",
      intro: "Eyes shine along the tree line. The flock has gone very still.",
      spec: {
        title: "Night Raid on Greywillow",
        map: { width: 30, height: 20, generator: "homestead" },
        factions: [
          { id: "player", name: "The homestead", controller: "player" },
          { id: "flock", name: "The flock", controller: "ai", hostileTo: ["wolves"], ai: "graze", color: "#b9b29a", shape: "circle" },
          { id: "wolves", name: "The pack", controller: "ai", hostileTo: ["player", "flock"], color: "#5c6166", shape: "diamond" },
        ],
        units: [
          { roster: "all", faction: "player", area: [6, 4, 9, 9] },
          { template: "sheep", faction: "flock", count: 6, area: [12, 2, 16, 7] },
          { template: "wolf", faction: "wolves", count: 9, area: [22, 0, 29, 19] },
          { template: "alpha-wolf", faction: "wolves", pos: [27, 10] },
        ],
        objective: { text: "Keep at least 2 sheep alive until dawn (6 rounds) or drive off the pack", win: [{ type: "dawn", rounds: 6 }, { type: "rout", faction: "wolves" }], lose: [{ type: "flock-lost", min: 2 }] },
      },
    };
  }
  return {
    title: "Roadside Skirmish",
    intro: "Chain-swinging toll takers step out of the hedgerow.",
    spec: {
      title: "Roadside Skirmish",
      map: { width: 20, height: 14, generator: "wilds" },
      units: [
        { roster: "all", faction: "player", area: "west" },
        { name: "Toll Taker", faction: "enemy", count: 8, area: "east", maxHp: 18, stats: { str: 6, def: 3, spd: 5, skl: 5 }, weapons: [{ name: "Hooked Chain", kind: "chain", might: 4, hit: 80, range: [1, 2], glyph: "whip", effects: [{ op: "pull", distance: 1 }] }] },
      ],
      objective: "rout",
    },
  };
}

export function fakeNarratorTurn(prompt: string): Json {
  const setting = between(prompt, "SETTING");
  const theme = themeOf(setting);
  const kind = between(prompt, "TURN_KIND") || "player";
  const moduleIds = between(prompt, "MODULE_IDS").split(",").map((s) => s.trim()).filter(Boolean);
  const fought = Number.parseInt(between(prompt, "BATTLES_FOUGHT") || "0", 10) || 0;
  if (kind === "opening") return openingFor(theme, setting);

  const base = { suggestions: ["Press on.", "Make camp.", "Look for trouble."], scene: { location: "", summary: "", mood: "" }, worldOps: [] as unknown[], commands: [] as unknown[], helpers: [] as Json[], battle: noBattle(), memory: [] as string[], ending: "" };

  if (kind === "battle_result") {
    const result = between(prompt, "BATTLE_RESULT");
    const outcome = /—\s*(\w+)/.exec(result)?.[1] ?? "over";
    const captured = /Captured: ([^.]+)\./.exec(result)?.[1];
    const fallen = /Fallen: ([^.]+)\./.exec(result)?.[1];
    return {
      ...base,
      narration:
        outcome === "victory"
          ? `The field settles. ${captured ? `${captured} trembles, then calms — yours now, if you are kind to it. ` : ""}${fallen ? `Not everyone walked away: ${fallen}. ` : ""}Word of this will travel. Where to next?`
          : `You fall back with ${outcome === "retreat" ? "your pride bruised" : "wounds to tend"}${fallen ? ` and losses to mourn: ${fallen}` : ""}. The road does not forgive, but it does continue.`,
      scene: { location: "", summary: `Aftermath of the last battle (${outcome}).`, mood: outcome === "victory" ? "story" : "tense" },
      suggestions: theme === "creature" ? ["Check the Creature Box.", "A rival blocks the ford — duel him.", "Rest at camp."] : ["Rest.", "Push on.", "Take stock."],
      memory: [`The latest battle ended in ${outcome}.${captured ? ` Captured: ${captured}.` : ""}`],
    };
  }

  const message = between(prompt, "PLAYER_MESSAGE");
  const lower = message.toLowerCase();
  const needsModule = THEME_MODULE[theme];
  const hasModule = !needsModule || moduleIds.includes(needsModule);
  const wantsBuild =
    (theme === "creature" && /catch|box|storage|tame|orb|creature/.test(lower)) ||
    (theme === "system" && /system|skill|level|quest|interface|status/.test(lower)) ||
    (theme === "farm" && /farm|plant|crop|homestead|sheep|seed/.test(lower));
  const wantsBattle = /battle|fight|attack|ambush|tall grass|wolves|raid|hunt|duel|charge|breach|rival/.test(lower);
  const allFlags = (message.match(/\[FORCE_[A-Z_]+(?:=\d+)?\]/g) ?? []).join(" ");

  const out = { ...base };
  const lines: string[] = [];
  if (wantsBuild && !hasModule) {
    out.helpers = helperFor(theme, allFlags);
    lines.push(
      theme === "creature"
        ? "Old Maren at the lodge presses a satchel of snare orbs into your hands and taps the brass-bound storage box by the door. \"Weaken them first. An orb on a fresh creature is an orb wasted.\" (Helpers are building the catching and storage systems — keep talking.)"
        : theme === "system"
          ? "The air chimes. [STATUS WINDOW UNLOCKING…] Lines of blue text assemble themselves at the edge of your vision. (A helper is building the System interface.)"
          : "You pace out the plots and count the sheep twice. There is a rhythm to this place, and you are starting to hear it. (A helper is building the homestead systems.)",
    );
    out.memory.push(`The ${needsModule} systems were introduced to the story.`);
  }
  if (wantsBattle) {
    const battle = battleFor(theme, fought, lower);
    if (!hasModule && !out.helpers.length) out.helpers = helperFor(theme, allFlags);
    out.battle = { start: true, title: battle.title, intro: battle.intro, specFile: "", specJson: JSON.stringify(battle.spec), buildBrief: "" };
    out.scene = { location: "", summary: battle.intro, mood: "battle" };
    lines.push(`${battle.intro} There is no talking your way out of this one.`);
  }
  if (!lines.length) {
    const said = message.replace(/\[[^\]]*\]/g, "").trim().replace(/[.!?]+$/, "") || "You wait";
    lines.push(`“${said}.” The world answers in small ways: a shift in the wind, a look held a moment too long. Nothing here is fixed yet — say what you want this world to be, and it will be built.`);
    out.memory.push(`The player said: "${message.replace(/\[[^\]]*\]/g, "").trim().slice(0, 140)}"`);
  }
  return { ...out, narration: lines.join(" ") };
}

const MINIMAL_MODULE = (id: string) => `export default {
  id: ${JSON.stringify(id)},
  name: ${JSON.stringify(id.replace(/-/g, " "))},
  description: 'Placeholder content written by the scripted fake helper.',
  setup(api) {
    api.defineStatus({ id: ${JSON.stringify(`${id}-mark`)}, name: 'Marked', duration: 2, mods: { def: -1 }, tone: 'debuff' });
    api.describe('Scripted placeholder module.');
  },
};
`;
const BROKEN_MODULE = (id: string) => `export default {
  id: ${JSON.stringify(id)},
  name: 'Broken draft',
  setup(api) {
    api.defineAbility({ id: 'draft', name: 'Draft' });
    thisFunctionDoesNotExist(api); // simulated generation mistake
  },
};
`;
const FAULTY_MODULE = (id: string) => `export default {
  id: ${JSON.stringify(id)},
  name: 'Faulty draft',
  description: 'Loads fine but throws when a phase starts.',
  setup(api) {
    api.on('phase:start', (ev, ctx) => { ctx.vars.touched = true; throw new Error('Simulated runtime fault in phase:start'); });
  },
};
`;
const HANGING_MODULE = (id: string) => `export default {
  id: ${JSON.stringify(id)},
  name: 'Hanging draft',
  setup(api) { api.on('phase:start', () => { for (;;) { /* simulated infinite loop */ } }); },
};
`;

export function fakeHelperRun(prompt: string, cwd: string | undefined): Json {
  const files = between(prompt, "HELPER_FILES").split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  const brief = between(prompt, "HELPER_BRIEF");
  const repair = prompt.includes("<<<REPAIR>>>");
  const written: string[] = [];
  if (!cwd) return { summary: "No workspace was provided; nothing written.", files: [], notes: "" };
  for (const relative of files) {
    const target = NodePath.resolve(cwd, relative);
    if (!target.startsWith(NodePath.resolve(cwd))) continue;
    NodeFs.mkdirSync(NodePath.dirname(target), { recursive: true });
    const base = NodePath.basename(relative);
    if (relative.startsWith("modules/")) {
      const id = base.replace(/\.[a-z]+$/, "");
      const example = NodePath.join(cwd, "examples", base);
      let source: string;
      if (!repair && brief.includes("[FORCE_BROKEN_MODULE]")) source = BROKEN_MODULE(id);
      else if (!repair && brief.includes("[FORCE_RUNTIME_FAULT]")) source = FAULTY_MODULE(id);
      else if (!repair && brief.includes("[FORCE_HANG]")) source = HANGING_MODULE(id);
      else if (repair && brief.includes("[FORCE_REPAIR_FAILS]")) source = BROKEN_MODULE(id);
      else source = NodeFs.existsSync(example) ? NodeFs.readFileSync(example, "utf8") : MINIMAL_MODULE(id);
      NodeFs.writeFileSync(target, source, "utf8");
    } else if (relative.endsWith(".json")) {
      NodeFs.writeFileSync(target, JSON.stringify(battleFor("generic", 0, "").spec, null, 2), "utf8");
    } else {
      NodeFs.writeFileSync(target, `Scripted helper note for: ${brief.slice(0, 200)}\n`, "utf8");
    }
    written.push(relative);
  }
  return {
    summary: repair ? `Repaired ${written.join(", ") || "nothing"}.` : `Wrote ${written.join(", ") || "nothing"}.`,
    files: written,
    notes: "Scripted fake helper (CHRONICLE_FAKE_PROVIDER=1).",
  };
}

export function fakeArchive(prompt: string): Json {
  const previous = between(prompt, "PREVIOUS_SUMMARY");
  const chunk = between(prompt, "TRANSCRIPT_CHUNK");
  const firstLines = chunk.split("\n").filter((l) => l.trim().length > 0).slice(0, 6).map((l) => l.trim().slice(0, 120));
  return {
    summary: [previous, `Earlier: ${firstLines.join(" / ")}`].filter(Boolean).join(" ").slice(-1800),
    facts: firstLines.slice(0, 2).map((l) => `Earlier in the story — ${l}`),
  };
}
