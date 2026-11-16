import * as Schema from "effect/Schema";

export class SshCommandError extends Schema.TaggedError<SshCommandError>()("SshCommandError", {
  message: Schema.String,
  detail: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect()),
}) {}
