import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { AcpRegistryOperationError, ProviderDriverKind, type ServerProviderModel } from "@t3tools/contracts";

export type AcpRegistryDriverEnv = never;

export const AcpRegistryDriver = {
  kind: "acpRegistry",
  supported: false,
};

export const acpRegistryClient = {
  driverKind: ProviderDriverKind.make("acpRegistry"),
  label: "ACP Registry",
  settingsSchema: Schema.Struct({}),
};

export function acpRegistryManagedBinaryDirectories(): ReadonlyArray<string> {
  return [];
}

export class AcpRegistryCatalog extends Context.Service<
  AcpRegistryCatalog,
  {
    readonly search: (input: unknown) => Effect.Effect<any, any>;
    readonly prepare: (input: unknown) => Effect.Effect<any, any>;
    readonly uninstallManagedBinary: (input: unknown) => Effect.Effect<any, any>;
    readonly listAvailableAgents: () => Effect.Effect<ReadonlyArray<any>, any>;
    readonly resolveBinary: (id: string) => Effect.Effect<string | undefined, any>;
  }
>()("t3/stub/AcpRegistryCatalog") {}

export class AcpRegistryRuntimeCoordinator extends Context.Service<
  AcpRegistryRuntimeCoordinator,
  {
    readonly acceptUrlAuthentication: (input: unknown) => Effect.Effect<boolean>;
    readonly withSessionMutation: <A, R>(
      eff: Effect.Effect<A, AcpRegistryOperationError, R>,
    ) => Effect.Effect<A, AcpRegistryOperationError, R>;
    readonly ensureSessionManager: (input: unknown) => Effect.Effect<any, any>;
    readonly getSessionManager: (id: string) => Effect.Effect<any, any>;
    readonly closeSessionManager: (id: string) => Effect.Effect<void, any>;
  }
>()("t3/stub/AcpRegistryRuntimeCoordinator") {}

export const layerFromHost = Layer.mergeAll(
    Layer.succeed(AcpRegistryCatalog, {
      search: () => Effect.succeed({ agents: [] }),
      prepare: () =>
        Effect.fail(
          new AcpRegistryOperationError({
            reason: "instance_not_found",
            message: "ACP Registry is disabled in game profile",
          }),
        ),
      uninstallManagedBinary: () => Effect.succeed({ uninstalled: false }),
      listAvailableAgents: () => Effect.succeed([]),
      resolveBinary: () => Effect.succeed(undefined),
    }),
    Layer.succeed(AcpRegistryRuntimeCoordinator, {
      acceptUrlAuthentication: () => Effect.succeed(false),
      withSessionMutation: (eff) => eff,
      ensureSessionManager: () =>
        Effect.fail(
          new AcpRegistryOperationError({
            reason: "instance_not_found",
            message: "ACP Registry is disabled in game profile",
          }),
        ),
      getSessionManager: () => Effect.succeed(undefined),
      closeSessionManager: () => Effect.void,
    }),
  );

export function toAcpRegistryOperationError(error: unknown): AcpRegistryOperationError {
  return error instanceof AcpRegistryOperationError
    ? error
    : new AcpRegistryOperationError({
        reason: "instance_not_found",
        message: error instanceof Error ? error.message : String(error),
      });
}

export function resolveAcpRegistryModelCatalog(): ReadonlyArray<ServerProviderModel> {
  return [];
}
