export type EffortLevel = "low" | "medium" | "high" | "max";
export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk";
export type SettingSource = "user" | "project" | "local";
export type Settings = Record<string, any>;
export type ModelInfo = {
  value: string;
  displayName: string;
  description?: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: ReadonlyArray<EffortLevel>;
  supportsFastMode?: boolean;
  supportsAdaptiveThinking?: boolean;
};
export type SlashCommand = { name: string; description?: string; argumentHint?: string };
export type McpServerStatus = { name: string; status: string };
export type PermissionUpdate = Record<string, any>;
export type PermissionResult = { behavior: "allow" | "deny"; message?: string; updatedInput?: unknown; updatedPermissions?: unknown[] };
export type CanUseTool = (...args: any[]) => Promise<PermissionResult>;
export type ElicitationRequest = Record<string, any>;
export type ElicitationResult = Record<string, any>;
export type HookCallback = (...args: any[]) => Promise<Record<string, any>>;
export type SpawnOptions = Record<string, any>;
export type SpawnedProcess = Record<string, any>;
export type ForkSessionOptions = Record<string, any>;
export type ForkSessionResult = { sessionId: string };
export type Options = Record<string, any>;
export type Query = AsyncGenerator<SDKMessage, void, unknown> & Record<string, any>;
export type SDKControlGetUsageResponse = Record<string, any>;
export type SDKRateLimitInfo = Record<string, any>;
export type SDKAssistantMessage = Record<string, any>;
export type SDKAPIRetryMessage = Record<string, any>;
export type SDKResultMessage = Record<string, any>;
export type SDKUserMessage = Record<string, any>;
export type SDKMessage = Record<string, any>;

export function query(_options: { prompt: unknown; options?: Options }): Query {
  async function* gen(): AsyncGenerator<SDKMessage, void, unknown> {
    throw new Error("Claude Agent SDK is unavailable in headless game sidecar");
  }
  const iterator = gen() as Query;
  iterator.interrupt = async () => {};
  iterator.close = () => {};
  iterator.supportedModels = async () => [];
  iterator.supportedCommands = async () => [];
  iterator.initializationResult = async () => ({});
  return iterator;
}

export async function forkSession(): Promise<ForkSessionResult> {
  throw new Error("Claude Agent SDK is unavailable in headless game sidecar");
}

export async function getSessionMessages(): Promise<SDKMessage[]> {
  return [];
}

export async function getSubagentMessages(): Promise<SDKMessage[]> {
  return [];
}

export function resolveSettings(): Settings {
  return {};
}
