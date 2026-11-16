import * as Effect from "effect/Effect";

export const DEFAULT_TAILSCALE_SERVE_PORT = 443;

export type TailscaleServeRoute = {
  readonly servePort: number;
  readonly mount?: string;
  readonly host?: string;
  readonly target?: string;
  readonly owner?: string;
  readonly ambiguous?: boolean;
};

export type TailscaleStderrDiagnostic = "unsupported-target" | "not-running" | "not-logged-in" | "unknown";

export type TailscaleCommandError =
  | { readonly _tag: "TailscaleCommandSpawnError"; readonly cause: unknown }
  | { readonly _tag: "TailscaleCommandExitError"; readonly stderrDiagnostic?: TailscaleStderrDiagnostic }
  | { readonly _tag: "TailscaleCommandTimeoutError" };

export type TailscaleExitNode = {
  readonly id: string;
  readonly dnsName?: string;
  readonly online?: boolean;
};

export type TailscaleStatus = {
  readonly installed: boolean;
  readonly running: boolean;
  readonly magicDnsName: string | undefined;
  readonly tailnetName: string | undefined;
  readonly ips: ReadonlyArray<string>;
};

export function buildTailscaleHttpsBaseUrl(host: string, port = 443): string {
  return port === 443 ? `https://${host}` : `https://${host}:${port}`;
}

export const readTailscaleStatus: Effect.Effect<TailscaleStatus, TailscaleCommandError> = Effect.succeed({
  installed: false,
  running: false,
  magicDnsName: undefined,
  tailnetName: undefined,
  ips: [],
});

export const readTailscaleSshEnabled = Effect.succeed(false);
export const readTailscaleExitNode = Effect.succeed<TailscaleExitNode | null>(null);
export const probeTailscaleHttpsEndpoint = () => Effect.succeed(false);
export const readTailscaleServeRootHolder = (
  _servePort: number,
  _target: { host: string; port: number },
): Effect.Effect<"none" | "ours" | "other" | "dead" | "unreadable", TailscaleCommandError> =>
  Effect.succeed("none");
export const readTailscaleServeRoutesTo = (_target: {
  host: string;
  port: number;
}): Effect.Effect<ReadonlyArray<TailscaleServeRoute>, TailscaleCommandError> => Effect.succeed([]);
export const ensureTailscaleServe = (_opts: {
  localPort: number;
  servePort: number;
  localHost: string;
}): Effect.Effect<void, TailscaleCommandError> => Effect.void;
export const disableTailscaleServe = (_route: TailscaleServeRoute): Effect.Effect<void, TailscaleCommandError> =>
  Effect.void;
export const disableTailscaleServeTcp = (_servePort: number): Effect.Effect<void, TailscaleCommandError> => Effect.void;
export const tailscaleServeOffArgs = (_route: TailscaleServeRoute): ReadonlyArray<string> | undefined => [];
