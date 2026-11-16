import type { SourceControlDriver } from "@t3tools/source-control-core/server/driver";
import { makeSourceControlDefinitionRegistry } from "@t3tools/source-control-core/shared/definition";

export const BUILT_IN_SOURCE_CONTROL_DRIVER_LIST: ReadonlyArray<SourceControlDriver> = [];

export const sourceControlDefinitions = makeSourceControlDefinitionRegistry([]);

