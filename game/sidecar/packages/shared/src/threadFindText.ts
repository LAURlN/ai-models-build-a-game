import type { OrchestrationV2ConversationMessage } from "@t3tools/contracts";

export function searchablePlanSegments(markdown: string, _cwd?: string): readonly string[] {
  return [markdown];
}

export function searchableMessageSegments(
  message: Pick<OrchestrationV2ConversationMessage, "role" | "text" | "streaming" | "context">,
  _cwd?: string,
  _skills: readonly unknown[] = [],
): readonly string[] | null {
  if (message.role !== "user" && message.role !== "assistant") return null;
  return message.text ? [message.text] : [];
}
