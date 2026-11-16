import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";

// Empty service layers and stubs for excluded provider drivers (cursor, fx, grok, kiro, muse, opencode, pi).
export const layer = Layer.empty;
export const OpenCodeRuntime = { layer: Layer.empty };
export const OpenCodeServerLedger = { layer: (_opts?: unknown) => Layer.empty };
export const MuseUsageHome = { layer: Layer.empty };
export const CursorAccountReader = { layer: Layer.empty };
export const CursorUsageAccounts = { layer: Layer.empty };
export const CursorAgentSdk = { layer: Layer.empty };
export const CursorSdk = { layer: Layer.empty };

export function piHome(): string {
  return "";
}
export function resolvePiSessionsDir(): string {
  return "";
}

export const GROK_USAGE_URL = "";
export const GrokUsageResponse = Schema.Unknown;
export function grokUsageResponseToLimits() {
  return [];
}

export const piUsageFormat = {
  id: "pi",
  decode: () => Effect.succeed(undefined),
};
export const grokUsageFormat = {
  id: "grok",
  decode: () => Effect.succeed(undefined),
};
export const museUsageFormat = {
  id: "muse",
  decode: () => Effect.succeed(undefined),
};

import { ProviderDriverKind } from "@t3tools/contracts";

export const emptyProviderClient = (driverKind: string) => ({
  driverKind: ProviderDriverKind.make(driverKind),
  label: driverKind,
  settingsSchema: Schema.Struct({}),
});

export const cursorClient = emptyProviderClient("cursor");
export const fxClient = emptyProviderClient("fx");
export const grokClient = emptyProviderClient("grok");
export const kiroClient = emptyProviderClient("kiro");
export const museClient = emptyProviderClient("muse");
export const openCodeClient = emptyProviderClient("opencode");
export const piClient = emptyProviderClient("pi");
