import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import {
  type GameCancelInput,
  type GameCancelResult,
  type GameGenerateInput,
  type GameGenerateResult,
  GameGenerationError,
} from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as FakeProvider from "./FakeProvider.ts";

export class GameGeneration extends Context.Service<
  GameGeneration,
  {
    readonly generate: (
      input: GameGenerateInput,
    ) => Effect.Effect<GameGenerateResult, GameGenerationError>;
    readonly cancel: (input: GameCancelInput) => Effect.Effect<GameCancelResult, GameGenerationError>;
  }
>()("t3/game/GameGeneration") {}

function classifyTextGenerationError(detail: string): GameGenerationError["code"] {
  const lower = detail.toLowerCase();
  if (lower.includes("not authenticated") || lower.includes("not installed") || lower.includes("not available") || lower.includes("unavailable")) {
    return "unavailable";
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return "timeout";
  }
  if (lower.includes("invalid") || lower.includes("json") || lower.includes("schema")) {
    return "invalid_output";
  }
  return "failed";
}

function ensureGenSandboxDir(stateDir: string): string {
  const sandboxDir = NodePath.join(stateDir, "gen-sandbox");
  NodeFS.mkdirSync(sandboxDir, { recursive: true });
  return sandboxDir;
}

function ensureAgentWorkspace(cwd: string): string {
  const resolved = NodePath.resolve(cwd);
  NodeFS.mkdirSync(resolved, { recursive: true });
  return resolved;
}

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const activeFibers = new Map<string, Fiber.Fiber<unknown, unknown>>();
  const cancelledIds = new Set<string>();

  const generate: GameGeneration["Service"]["generate"] = Effect.fn("GameGeneration.generate")(
    function* (input) {
      if (cancelledIds.has(input.attemptId)) {
        return yield* new GameGenerationError({
          code: "cancelled",
          detail: `Generation attempt '${input.attemptId}' was cancelled before execution.`,
        });
      }

      const timeoutMs =
        typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
          ? input.timeoutMs
          : input.agent
            ? 15 * 60_000
            : 90_000;

      const work = FakeProvider.isFakeProviderEnabled()
        ? FakeProvider.generateStructuredJson(config.stateDir, input)
        : textGeneration
            .generateStructuredJson({
              cwd: input.agent ? ensureAgentWorkspace(input.agent.cwd) : ensureGenSandboxDir(config.stateDir),
              ...(input.agent ? { agent: { timeoutMs } } : {}),
              prompt: input.prompt,
              jsonSchema: input.jsonSchema,
              modelSelection: input.modelSelection,
              projectId: null,
            })
            .pipe(
              Effect.map((res) => ({
                attemptId: input.attemptId,
                output: res.output,
                provider: String(input.modelSelection.instanceId),
                model: input.modelSelection.model,
              })),
              Effect.mapError((error) => {
                const detail =
                  error instanceof Error
                    ? error.message
                    : typeof error === "object" && error !== null && "detail" in error
                      ? String((error as { detail: unknown }).detail)
                      : String(error);
                return new GameGenerationError({
                  code: classifyTextGenerationError(detail),
                  detail,
                  cause: error,
                });
              }),
            );

      const fiber = yield* work.pipe(
        Effect.timeoutOption(`${Math.round(timeoutMs)} millis`),
        Effect.flatMap((option) =>
          option._tag === "Some"
            ? Effect.succeed(option.value)
            : Effect.fail(
                new GameGenerationError({
                  code: "timeout",
                  detail: `Generation attempt '${input.attemptId}' timed out after ${timeoutMs}ms.`,
                }),
              ),
        ),
        Effect.forkDetach,
      );

      activeFibers.set(input.attemptId, fiber);
      return yield* Fiber.join(fiber).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            activeFibers.delete(input.attemptId);
          }),
        ),
        Effect.onInterrupt(() =>
          Fiber.interrupt(fiber).pipe(
            Effect.ignore,
            Effect.ensuring(
              Effect.sync(() => {
                activeFibers.delete(input.attemptId);
                cancelledIds.add(input.attemptId);
              }),
            ),
          ),
        ),
      );
    },
  );

  const cancel: GameGeneration["Service"]["cancel"] = Effect.fn("GameGeneration.cancel")(
    function* (input) {
      cancelledIds.add(input.attemptId);
      const fiber = activeFibers.get(input.attemptId);
      if (!fiber) {
        return { cancelled: false };
      }
      activeFibers.delete(input.attemptId);
      yield* Fiber.interrupt(fiber).pipe(Effect.ignore);
      return { cancelled: true };
    },
  );

  return GameGeneration.of({ generate, cancel });
});

export const layer = Layer.effect(GameGeneration, make);
