import * as Effect from "effect/Effect";
import { SshCommandError } from "./ssh-errors.ts";

export function baseSshArgs(): ReadonlyArray<string> {
  return [];
}

export function resolveSshCommand(): Effect.Effect<string, SshCommandError> {
  return Effect.fail(new SshCommandError({ message: "SSH is disabled in headless game sidecar" }));
}

export function runSshCommand(): Effect.Effect<
  { stdout: string; stderr: string; exitCode: number },
  SshCommandError
> {
  return Effect.fail(new SshCommandError({ message: "SSH is disabled in headless game sidecar" }));
}
