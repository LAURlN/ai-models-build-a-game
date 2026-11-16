import * as Effect from "effect/Effect";

export const builtInSourceControlDefinitions = [] as const;
export const driver = {
  kind: "disabled",
  definition: { kind: "disabled", label: "Disabled" },
  make: Effect.succeed({}),
};

export function canonicalizeGitCafePullRequestUrl(url: string): string {
  return url;
}
