export function remarkEnableOrderedListNumbers() {
  return () => {};
}

export function chatMarkdownImageSources(markdown: string): string[] {
  const sources: string[] = [];
  for (const match of markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
    if (match[1]) sources.push(match[1]);
  }
  return sources;
}

export function shouldPreserveAssistantLineBreaks(): boolean {
  return false;
}

export function remarkAssistantInsights() {
  return () => {};
}

export const CHAT_MARKDOWN_REHYPE_PLUGINS = [] as const;
export const CHAT_MARKDOWN_REMARK_PLUGINS = [] as const;
export const CHAT_MARKDOWN_REMARK_PLUGINS_WITH_BREAKS = [] as const;
export const CHAT_USER_MARKDOWN_REMARK_PLUGINS = [] as const;
