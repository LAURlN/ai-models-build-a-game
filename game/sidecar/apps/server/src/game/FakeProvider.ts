import * as NodeFs from "node:fs";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import {
  IsoDateTime,
  ProviderAuthMethod,
  ProviderAuthState,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSetupError,
  ServerProvider,
  TrimmedNonEmptyString,
  type GameGenerateInput,
  type ProviderAuthCancelInput,
  type ProviderAuthCompleteInput,
  type ProviderAuthRemoveMethodInput,
  type ProviderAuthRespondInput,
  type ProviderAuthStartInput,
  GameGenerationError,
} from "@t3tools/contracts";
import { fakeArchive, fakeHelperRun, fakeNarratorTurn } from "./FakeStory.ts";

interface StoredFakeState {
  providers: Record<
    string,
    {
      authenticated: boolean;
      installed: boolean;
      accountEmail?: string;
      phase: ProviderAuthState["phase"];
      flowId: string | null;
      message: string | null;
    }
  >;
}

const fakeConfigPubSub = Effect.runSync(PubSub.unbounded<ReadonlyArray<ServerProvider>>());
const fakeAuthPubSub = Effect.runSync(PubSub.unbounded<ProviderAuthState>());

export function isFakeProviderEnabled(): boolean {
  return process.env.CHRONICLE_FAKE_PROVIDER === "1";
}

function getFakeMode(): "normal" | "no-providers" | "fail" {
  const raw = process.env.CHRONICLE_FAKE_MODE?.trim().toLowerCase();
  if (raw === "no-providers") return "no-providers";
  if (raw === "fail") return "fail";
  return "normal";
}

function stateFilePath(stateDir: string): string {
  return NodePath.join(stateDir, "fake-providers.json");
}

function defaultFakeState(): StoredFakeState {
  if (getFakeMode() === "no-providers") {
    return {
      providers: {
        codex: {
          authenticated: false,
          installed: true,
          phase: "idle",
          flowId: null,
          message: "No providers configured (CHRONICLE_FAKE_MODE=no-providers).",
        },
        claudeAgent: {
          authenticated: false,
          installed: true,
          phase: "idle",
          flowId: null,
          message: "No providers configured (CHRONICLE_FAKE_MODE=no-providers).",
        },
        antigravity: {
          authenticated: false,
          installed: false,
          phase: "idle",
          flowId: null,
          message: "Antigravity CLI not installed.",
        },
      },
    };
  }
  return {
    providers: {
      codex: {
        authenticated: true,
        installed: true,
        accountEmail: "codex-fake@example.local",
        phase: "succeeded",
        flowId: null,
        message: "Connected (fake Codex provider).",
      },
      claudeAgent: {
        authenticated: false,
        installed: true,
        phase: "idle",
        flowId: null,
        message: "Sign in to enable Claude.",
      },
      antigravity: {
        authenticated: false,
        installed: false,
        phase: "idle",
        flowId: null,
        message: "Antigravity CLI not installed.",
      },
    },
  };
}

function readFakeState(stateDir: string): StoredFakeState {
  const path = stateFilePath(stateDir);
  if (!NodeFs.existsSync(path)) {
    const initial = defaultFakeState();
    writeFakeState(stateDir, initial);
    return initial;
  }
  try {
    const parsed = JSON.parse(NodeFs.readFileSync(path, "utf8")) as StoredFakeState;
    if (parsed && typeof parsed === "object" && parsed.providers) {
      return parsed;
    }
  } catch {
    // Reinitialize on corrupt fake store
  }
  const initial = defaultFakeState();
  writeFakeState(stateDir, initial);
  return initial;
}

function writeFakeState(stateDir: string, state: StoredFakeState): void {
  NodeFs.mkdirSync(stateDir, { recursive: true });
  NodeFs.writeFileSync(stateFilePath(stateDir), JSON.stringify(state, null, 2), "utf8");
}

function buildFakeProviders(state: StoredFakeState): ReadonlyArray<ServerProvider> {
  const now = IsoDateTime.make(new Date().toISOString());
  const codexState = state.providers.codex ?? defaultFakeState().providers.codex!;
  const claudeState = state.providers.claudeAgent ?? defaultFakeState().providers.claudeAgent!;
  const agState = state.providers.antigravity ?? defaultFakeState().providers.antigravity!;

  const effortDescriptor = {
    id: TrimmedNonEmptyString.make("reasoningEffort"),
    label: TrimmedNonEmptyString.make("Effort"),
    type: "select" as const,
    role: "reasoning" as const,
    options: [
      { id: TrimmedNonEmptyString.make("low"), label: TrimmedNonEmptyString.make("Low"), isDefault: true },
      { id: TrimmedNonEmptyString.make("medium"), label: TrimmedNonEmptyString.make("Medium") },
      { id: TrimmedNonEmptyString.make("high"), label: TrimmedNonEmptyString.make("High") },
    ],
    currentValue: TrimmedNonEmptyString.make("low"),
  };

  return [
    {
      instanceId: ProviderInstanceId.make("codex"),
      driver: ProviderDriverKind.make("codex"),
      displayName: TrimmedNonEmptyString.make("Codex"),
      supportsTextGeneration: true,
      setup: { canAuthenticate: true, canInstall: false },
      enabled: true,
      installed: codexState.installed,
      version: TrimmedNonEmptyString.make("0.0.0-fake"),
      status: !codexState.installed
        ? "error"
        : codexState.authenticated
          ? "ready"
          : "warning",
      auth: {
        status: codexState.authenticated ? "authenticated" : "unauthenticated",
        type: TrimmedNonEmptyString.make("apiKey"),
        label: TrimmedNonEmptyString.make(codexState.authenticated ? "Fake Codex" : "Sign in required"),
        ...(codexState.accountEmail ? { email: TrimmedNonEmptyString.make(codexState.accountEmail) } : {}),
        canLogout: codexState.authenticated,
      },
      checkedAt: now,
      ...(codexState.message ? { message: TrimmedNonEmptyString.make(codexState.message) } : {}),
      availability: codexState.installed ? "available" : "unavailable",
      models: [
        {
          slug: TrimmedNonEmptyString.make("gpt-6.1-terra"),
          name: TrimmedNonEmptyString.make("GPT-6.1 Terra"),
          isCustom: false,
          isDefault: true,
          supportsTextGeneration: true,
          capabilities: { optionDescriptors: [effortDescriptor] },
        },
        {
          slug: TrimmedNonEmptyString.make("gpt-5.3-codex"),
          name: TrimmedNonEmptyString.make("GPT-5.3 Codex"),
          isCustom: false,
          supportsTextGeneration: true,
          capabilities: { optionDescriptors: [effortDescriptor] },
        },
        {
          slug: TrimmedNonEmptyString.make("gpt-vision-only"),
          name: TrimmedNonEmptyString.make("GPT Vision Only (No JSON Gen)"),
          isCustom: false,
          supportsTextGeneration: false,
          capabilities: null,
        },
      ],
      slashCommands: [],
      skills: [],
    },
    {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      driver: ProviderDriverKind.make("claudeAgent"),
      displayName: TrimmedNonEmptyString.make("Claude Agent"),
      supportsTextGeneration: true,
      setup: { canAuthenticate: true, canInstall: false },
      enabled: true,
      installed: claudeState.installed,
      version: TrimmedNonEmptyString.make("0.0.0-fake"),
      status: !claudeState.installed
        ? "error"
        : claudeState.authenticated
          ? "ready"
          : "warning",
      auth: {
        status: claudeState.authenticated ? "authenticated" : "unauthenticated",
        type: TrimmedNonEmptyString.make("credentials"),
        label: TrimmedNonEmptyString.make(
          claudeState.authenticated ? "Fake Claude" : "Sign in required",
        ),
        ...(claudeState.accountEmail
          ? { email: TrimmedNonEmptyString.make(claudeState.accountEmail) }
          : {}),
        canLogout: claudeState.authenticated,
      },
      checkedAt: now,
      ...(claudeState.message ? { message: TrimmedNonEmptyString.make(claudeState.message) } : {}),
      availability: claudeState.installed ? "available" : "unavailable",
      models: [
        {
          slug: TrimmedNonEmptyString.make("claude-sonnet-4-6"),
          name: TrimmedNonEmptyString.make("Claude Sonnet 4.6"),
          isCustom: false,
          isDefault: true,
          supportsTextGeneration: true,
          capabilities: { optionDescriptors: [effortDescriptor] },
        },
        {
          slug: TrimmedNonEmptyString.make("claude-opus-4-6"),
          name: TrimmedNonEmptyString.make("Claude Opus 4.6"),
          isCustom: false,
          supportsTextGeneration: true,
          capabilities: { optionDescriptors: [effortDescriptor] },
        },
      ],
      slashCommands: [],
      skills: [],
    },
    {
      instanceId: ProviderInstanceId.make("antigravity"),
      driver: ProviderDriverKind.make("antigravity"),
      displayName: TrimmedNonEmptyString.make("Antigravity"),
      supportsTextGeneration: true,
      setup: { canAuthenticate: true, canInstall: true },
      enabled: true,
      installed: agState.installed,
      version: null,
      status: agState.installed && agState.authenticated ? "ready" : "error",
      auth: {
        status: agState.authenticated ? "authenticated" : "unauthenticated",
        type: TrimmedNonEmptyString.make("oauth"),
        label: TrimmedNonEmptyString.make(agState.authenticated ? "Fake Antigravity" : "Not connected"),
        canLogout: agState.authenticated,
      },
      checkedAt: now,
      ...(agState.message ? { message: TrimmedNonEmptyString.make(agState.message) } : {}),
      availability: agState.installed ? "available" : "unavailable",
      ...(agState.installed
        ? {}
        : { unavailableReason: TrimmedNonEmptyString.make("Antigravity binary is not installed.") }),
      models: [
        {
          slug: TrimmedNonEmptyString.make("gemini-4-hydrogen-high"),
          name: TrimmedNonEmptyString.make("Gemini 4 Hydrogen"),
          isCustom: false,
          isDefault: true,
          supportsTextGeneration: true,
          capabilities: null,
        },
      ],
      slashCommands: [],
      skills: [],
    },
  ];
}

function buildAuthState(
  instanceId: ProviderInstanceId,
  state: StoredFakeState,
  extra?: Partial<ProviderAuthState>,
): ProviderAuthState {
  const key = String(instanceId);
  const entry = state.providers[key] ?? {
    authenticated: false,
    installed: false,
    phase: "idle" as const,
    flowId: null,
    message: null,
  };
  return {
    instanceId,
    phase: entry.phase,
    flowId: entry.flowId ? TrimmedNonEmptyString.make(entry.flowId) : null,
    authorizationUrl: null,
    expiresAt: null,
    message: entry.message,
    methods: [
      {
        id: TrimmedNonEmptyString.make("fake-credentials"),
        name: TrimmedNonEmptyString.make("Interactive Sign-In"),
        description: "Simulated T3 provider authentication flow.",
        type: "credentials" as const,
        ...(entry.accountEmail ? { accountEmail: TrimmedNonEmptyString.make(entry.accountEmail) } : {}),
        canRemove: entry.authenticated,
      } satisfies typeof ProviderAuthMethod.Type,
    ],
    interaction: null,
    ...extra,
  };
}

export const getProviders = (stateDir: string): ReadonlyArray<ServerProvider> =>
  buildFakeProviders(readFakeState(stateDir));

export const subscribeConfigProviders = (): Stream.Stream<ReadonlyArray<ServerProvider>> =>
  Stream.fromPubSub(fakeConfigPubSub);

export const subscribeAuthStates = (
  instanceId: ProviderInstanceId,
): Stream.Stream<ProviderAuthState> =>
  Stream.fromPubSub(fakeAuthPubSub).pipe(
    Stream.filter((event) => event.instanceId === instanceId),
  );

const emitFakeUpdates = Effect.fn("FakeProvider.emitUpdates")(function* (
  stateDir: string,
  instanceId: ProviderInstanceId,
  authState: ProviderAuthState,
) {
  const providers = getProviders(stateDir);
  yield* PubSub.publish(fakeConfigPubSub, providers);
  yield* PubSub.publish(fakeAuthPubSub, authState);
});

export const authStart = Effect.fn("FakeProvider.authStart")(function* (
  stateDir: string,
  input: ProviderAuthStartInput,
) {
  const state = readFakeState(stateDir);
  const key = String(input.instanceId);
  if (!state.providers[key]) {
    return yield* new ProviderSetupError({
      instanceId: input.instanceId,
      operation: "authStart",
      detail: `Unknown provider instance '${key}'.`,
    });
  }
  const flowId = `fake-flow-${key}-${Date.now()}`;
  state.providers[key] = {
    ...state.providers[key]!,
    phase: "waiting",
    flowId,
    message: "Enter sign-in confirmation to connect this provider.",
  };
  writeFakeState(stateDir, state);
  const authState = buildAuthState(input.instanceId, state, {
    phase: "waiting",
    flowId: TrimmedNonEmptyString.make(flowId),
    interaction: {
      type: "credentials",
      id: TrimmedNonEmptyString.make("fake-cred-prompt"),
      fields: [
        {
          name: TrimmedNonEmptyString.make("label"),
          label: TrimmedNonEmptyString.make("Account Label"),
          secret: false,
        },
      ],
    },
  });
  yield* emitFakeUpdates(stateDir, input.instanceId, authState);
  return authState;
});

export const authRespond = Effect.fn("FakeProvider.authRespond")(function* (
  stateDir: string,
  input: ProviderAuthRespondInput,
) {
  const state = readFakeState(stateDir);
  const key = String(input.instanceId);
  const current = state.providers[key];
  if (!current) {
    return yield* new ProviderSetupError({
      instanceId: input.instanceId,
      operation: "authRespond",
      detail: `Unknown provider instance '${key}'.`,
    });
  }
  const declined = input.response.type === "browser" && input.response.action === "decline";
  state.providers[key] = {
    ...current,
    authenticated: !declined,
    installed: true,
    ...(declined ? {} : { accountEmail: `${key}-connected@example.local` }),
    phase: declined ? "cancelled" : "succeeded",
    flowId: null,
    message: declined ? "Sign-in declined." : `Connected ${key} (fake session).`,
  };
  writeFakeState(stateDir, state);
  const authState = buildAuthState(input.instanceId, state);
  yield* emitFakeUpdates(stateDir, input.instanceId, authState);
  return authState;
});

export const authComplete = Effect.fn("FakeProvider.authComplete")(function* (
  stateDir: string,
  input: ProviderAuthCompleteInput,
) {
  const state = readFakeState(stateDir);
  const key = String(input.instanceId);
  const current = state.providers[key];
  if (!current) {
    return yield* new ProviderSetupError({
      instanceId: input.instanceId,
      operation: "authComplete",
      detail: `Unknown provider instance '${key}'.`,
    });
  }
  state.providers[key] = {
    ...current,
    authenticated: true,
    installed: true,
    accountEmail: `${key}-connected@example.local`,
    phase: "succeeded",
    flowId: null,
    message: `Connected ${key} (fake OAuth complete).`,
  };
  writeFakeState(stateDir, state);
  const authState = buildAuthState(input.instanceId, state);
  yield* emitFakeUpdates(stateDir, input.instanceId, authState);
  return authState;
});

export const authCancel = Effect.fn("FakeProvider.authCancel")(function* (
  stateDir: string,
  input: ProviderAuthCancelInput,
) {
  const state = readFakeState(stateDir);
  const key = String(input.instanceId);
  const current = state.providers[key];
  if (current) {
    state.providers[key] = {
      ...current,
      phase: "cancelled",
      flowId: null,
      message: "Authentication cancelled.",
    };
    writeFakeState(stateDir, state);
  }
  const authState = buildAuthState(input.instanceId, state);
  yield* emitFakeUpdates(stateDir, input.instanceId, authState);
  return authState;
});

export const authLogout = Effect.fn("FakeProvider.authLogout")(function* (
  stateDir: string,
  instanceId: ProviderInstanceId,
) {
  const state = readFakeState(stateDir);
  const key = String(instanceId);
  const current = state.providers[key];
  if (current) {
    const { accountEmail: _omitted, ...rest } = current;
    state.providers[key] = {
      ...rest,
      authenticated: false,
      phase: "idle",
      flowId: null,
      message: "Signed out.",
    };
    writeFakeState(stateDir, state);
  }
  const authState = buildAuthState(instanceId, state);
  yield* emitFakeUpdates(stateDir, instanceId, authState);
  return authState;
});

export const authRemoveMethod = Effect.fn("FakeProvider.authRemoveMethod")(function* (
  stateDir: string,
  input: typeof ProviderAuthRemoveMethodInput.Type,
) {
  return yield* authLogout(stateDir, input.instanceId);
});

function pickMapFromPrompt(
  prompt: string,
): "bridge_assault" | "fortress_siege" | "forest_ambush" | "twin_path_escort" {
  const lower = prompt.toLowerCase();
  if (lower.includes("fortress") || lower.includes("siege") || lower.includes("throne") || lower.includes("seize")) {
    return "fortress_siege";
  }
  if (lower.includes("forest") || lower.includes("ambush") || lower.includes("woods")) {
    return "forest_ambush";
  }
  if (lower.includes("escort") || lower.includes("twin") || lower.includes("split")) {
    return "twin_path_escort";
  }
  return "bridge_assault";
}

function buildFakePlan(prompt: string) {
  const archetype = pickMapFromPrompt(prompt);
  const objective =
    prompt.toLowerCase().includes("seize") || archetype === "fortress_siege" ? "seize" : "rout";
  const shortTheme =
    prompt
      .replace(/\[[^\]]+\]/g, "")
      .trim()
      .slice(0, 48) || "Ashen Ford Stand";

  return {
    schemaVersion: 1,
    title: `Chronicle: ${shortTheme}`.slice(0, 64),
    archetype,
    objective,
    maxTurns: 12,
    summary: `A forged tactical trial inspired by "${shortTheme}".`,
    units: [
      {
        id: "hero_rowan",
        name: "Rowan",
        title: "Pledge Warden",
        faction: "player",
        weaponTag: "lance",
        weaponName: "Vow Halberd",
        hp: 32,
        str: 12,
        mag: 3,
        skl: 9,
        spd: 10,
        lck: 5,
        def: 7,
        res: 4,
        mov: 4,
        grantActiveAbility: true,
      },
      {
        id: "hero_tamsin",
        name: "Tamsin",
        title: "Cinder Marksman",
        faction: "player",
        weaponTag: "bow",
        weaponName: "Gale Crossbow",
        hp: 25,
        str: 11,
        mag: 2,
        skl: 11,
        spd: 11,
        lck: 5,
        def: 5,
        res: 4,
        mov: 4,
        grantActiveAbility: false,
      },
      {
        id: "hero_corin",
        name: "Corin",
        title: "Ashblade",
        faction: "player",
        weaponTag: "sword",
        weaponName: "Ember Sabre",
        hp: 28,
        str: 11,
        mag: 3,
        skl: 10,
        spd: 13,
        lck: 6,
        def: 6,
        res: 5,
        mov: 5,
        grantActiveAbility: false,
      },
      {
        id: "foe_vance",
        name: "Vance",
        title: "Iron Bailiff",
        faction: "enemy",
        weaponTag: "lance",
        weaponName: "Siege Pike",
        hp: 28,
        str: 10,
        mag: 2,
        skl: 6,
        spd: 6,
        lck: 2,
        def: 6,
        res: 3,
        mov: 3,
        grantActiveAbility: false,
      },
      {
        id: "foe_halberdier",
        name: "Gate Halberdier",
        title: "Watchman",
        faction: "enemy",
        weaponTag: "axe",
        weaponName: "Iron Cleaver",
        hp: 24,
        str: 9,
        mag: 2,
        skl: 5,
        spd: 6,
        lck: 2,
        def: 4,
        res: 3,
        mov: 3,
        grantActiveAbility: false,
      },
      {
        id: "foe_bowman",
        name: "Rampart Bowman",
        title: "Watcher",
        faction: "enemy",
        weaponTag: "bow",
        weaponName: "Horn Bow",
        hp: 22,
        str: 8,
        mag: 2,
        skl: 6,
        spd: 7,
        lck: 2,
        def: 4,
        res: 3,
        mov: 4,
        grantActiveAbility: false,
      },
    ],
  };
}

function buildFakeChapterBuild(prompt: string, isRepairAttempt: boolean) {
  if (
    prompt.includes("[FORCE_INVALID_ALWAYS]") ||
    (prompt.includes("[FORCE_REPAIR_ONCE]") && !isRepairAttempt)
  ) {
    return {
      schemaVersion: 1,
      abilityName: "Forbidden Surge",
      statusName: "Broken Debt",
      abilitySummary: "Invalid prototype using an unsupported Rule IR opcode.",
      introChronicle: "The draft rule attempts an unverified warp.",
      rulePack: [
        {
          schemaVersion: 1,
          id: "fake_broken_surge",
          rulesVersion: "r03-1",
          provenanceJobId: "fake-job",
          name: "Forbidden Surge",
          kind: "active",
          costs: { hp: 3, actions: 0 },
          useKey: "fake_broken_surge",
          usesPerPhase: 1,
          stackPolicy: "add",
          activationPolicy: "normal",
          listeners: [
            {
              hook: "useActive",
              scope: "ownerActor",
              priority: 0,
              maxPerRoot: 1,
              maxPerPhase: 32,
              effect: { op: "teleportAnywhereUnsupported", amount: 99 },
            },
          ],
        },
      ],
    };
  }

  return {
    schemaVersion: 1,
    abilityName: "Ember Surge",
    statusName: "Cinder Debt",
    abilitySummary: "Spend 2 HP for +1 action; clear Cinder Debt on a kill to heal 5 HP, or take expiry damage.",
    introChronicle: "Steel rings against stone as the company commits to the crossing.",
    rulePack: [
      {
        schemaVersion: 1,
        id: "ember_surge",
        rulesVersion: "r03-1",
        provenanceJobId: "fake-job",
        name: "Ember Surge",
        kind: "active",
        costs: { hp: 2, actions: 0 },
        useKey: "ember_surge",
        usesPerPhase: 1,
        stackPolicy: "add",
        activationPolicy: "normal",
        listeners: [
          {
            hook: "useActive",
            scope: "ownerActor",
            priority: 0,
            maxPerRoot: 1,
            maxPerPhase: 32,
            effect: {
              op: "sequence",
              effects: [
                { op: "grantAction", amount: 1, key: "ember_surge", kind: "any" },
                { op: "applyStatus", statusId: "cinder_debt", stacks: 1, expiry: "nextOwnPhaseStart" },
              ],
            },
          },
        ],
      },
      {
        schemaVersion: 1,
        id: "cinder_debt",
        rulesVersion: "r03-1",
        provenanceJobId: "fake-job",
        name: "Cinder Debt",
        kind: "status",
        costs: { hp: 0, actions: 0 },
        useKey: "",
        usesPerPhase: 0,
        stackPolicy: "add",
        activationPolicy: "normal",
        listeners: [
          {
            hook: "kill",
            scope: "ownerActor",
            priority: 0,
            maxPerRoot: 1,
            maxPerPhase: 32,
            effect: {
              op: "sequence",
              effects: [
                { op: "removeStatus", statusId: "cinder_debt" },
                { op: "heal", amount: 5 },
              ],
            },
          },
          {
            hook: "statusExpiry",
            scope: "ownedStatus",
            priority: 0,
            maxPerRoot: 1,
            maxPerPhase: 32,
            effect: {
              op: "dealDamage",
              amount: {
                op: "add",
                left: 8,
                right: { op: "multiply", left: 4, right: { read: "stackCount" } },
              },
            },
          },
        ],
      },
    ],
  };
}

export const generateStructuredJson = Effect.fn("FakeProvider.generateStructuredJson")(function* (
  stateDir: string,
  input: GameGenerateInput,
) {
  const mode = getFakeMode();
  if (mode === "no-providers") {
    return yield* new GameGenerationError({
      code: "unavailable",
      detail: "No authenticated providers are available (CHRONICLE_FAKE_MODE=no-providers).",
    });
  }
  const schemaTitleEarly =
    typeof input.jsonSchema === "object" && input.jsonSchema !== null && "title" in input.jsonSchema
      ? String((input.jsonSchema as { title?: unknown }).title ?? "")
      : "";
  // Story prompts embed the whole chat history; only the newest message/brief may carry test flags.
  const scopedTag =
    schemaTitleEarly === "NarratorTurn" ? "PLAYER_MESSAGE" : schemaTitleEarly === "HelperResult" ? "HELPER_BRIEF" : "";
  const scopedStart = scopedTag ? input.prompt.lastIndexOf(`<<<${scopedTag}>>>`) : 0;
  const scopedPrompt = scopedTag ? (scopedStart >= 0 ? input.prompt.slice(scopedStart) : "") : input.prompt;
  const delayMatch = /\[FORCE_DELAY_MS=(\d+)\]/i.exec(scopedPrompt);
  if (delayMatch) {
    const delayMs = Number.parseInt(delayMatch[1]!, 10);
    if (Number.isFinite(delayMs) && delayMs > 0) {
      yield* Effect.sleep(`${delayMs} millis`);
    }
  }
  if (mode === "fail" || scopedPrompt.includes("[FORCE_FAIL]")) {
    return yield* new GameGenerationError({
      code: "failed",
      detail: "Simulated provider failure for fault-handling verification.",
    });
  }

  const fakeState = readFakeState(stateDir);
  const providerKey = String(input.modelSelection.instanceId);
  const entry = fakeState.providers[providerKey];
  if (!entry || !entry.installed || !entry.authenticated) {
    return yield* new GameGenerationError({
      code: "unavailable",
      detail: `Fake provider '${providerKey}' is not installed or authenticated.`,
    });
  }
  if (input.modelSelection.model === "gpt-vision-only") {
    return yield* new GameGenerationError({
      code: "unavailable",
      detail: `Model '${input.modelSelection.model}' does not support structured JSON generation.`,
    });
  }

  const schemaTitle =
    typeof input.jsonSchema === "object" &&
    input.jsonSchema !== null &&
    "title" in input.jsonSchema &&
    typeof (input.jsonSchema as { title?: unknown }).title === "string"
      ? (input.jsonSchema as { title: string }).title
      : "";

  const isRepairAttempt = input.prompt.includes("REPAIR_ATTEMPT");
  const output =
    schemaTitle === "NarratorTurn"
      ? fakeNarratorTurn(input.prompt)
      : schemaTitle === "HelperResult"
        ? fakeHelperRun(input.prompt, input.agent?.cwd)
        : schemaTitle === "ArchiveSummary"
          ? fakeArchive(input.prompt)
          : schemaTitle === "ChapterBuild"
      ? buildFakeChapterBuild(input.prompt, isRepairAttempt)
      : schemaTitle === "ChapterPlan"
        ? buildFakePlan(input.prompt)
        : schemaTitle === "SmokeResult"
          ? { ok: true, summary: "Sidecar structured JSON smoke passed." }
          : buildFakePlan(input.prompt);

  return {
    attemptId: input.attemptId,
    output,
    provider: providerKey,
    model: input.modelSelection.model,
  };
});
