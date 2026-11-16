import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";

export const GameGenerateInput = Schema.Struct({
  attemptId: TrimmedNonEmptyString,
  prompt: Schema.String,
  jsonSchema: Schema.Unknown,
  modelSelection: ModelSelection,
  role: Schema.optional(Schema.Literals(["architect", "chronicler", "narrator", "helper", "archivist"])),
  /** Agent mode: run with the provider's full native tools (shell, files, code execution) inside this workspace. */
  agent: Schema.optional(Schema.Struct({ cwd: Schema.String })),
  timeoutMs: Schema.optional(Schema.Number),
});
export type GameGenerateInput = typeof GameGenerateInput.Type;

export const GameGenerateResult = Schema.Struct({
  attemptId: TrimmedNonEmptyString,
  output: Schema.Unknown,
  provider: Schema.String,
  model: Schema.String,
});
export type GameGenerateResult = typeof GameGenerateResult.Type;

export class GameGenerationError extends Schema.TaggedError<GameGenerationError>()(
  "GameGenerationError",
  {
    code: Schema.Literals(["cancelled", "unavailable", "invalid_output", "failed", "timeout"]),
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export const GameCancelInput = Schema.Struct({
  attemptId: TrimmedNonEmptyString,
});
export type GameCancelInput = typeof GameCancelInput.Type;

export const GameCancelResult = Schema.Struct({
  cancelled: Schema.Boolean,
});
export type GameCancelResult = typeof GameCancelResult.Type;
