/**
 * Long-campaign memory without embeddings or network access:
 *  - durable facts (written by the Narrator, battles and modules),
 *  - a rolling summary of everything older than the recent window,
 *  - lexical retrieval (BM25-style with a recency nudge) over facts, old chat and battle records.
 * The full transcript is also mirrored into the campaign workspace so agents can grep it.
 */
import type { CampaignState, ChatMessage } from './types';

export interface MemoryDoc { id: string; kind: 'fact' | 'chat' | 'battle' | 'summary'; text: string; turn: number }

const STOP = new Set(('the a an and or but if then of to in on at for from with without by as is are was were be been being it its this that these those i you he she we they me my your his her our their them us not no yes do does did have has had will would can could should may might must there here what which who whom when where why how all any some more most other into over under again very just than too so up down out off about').split(' '));

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9äöüß']+/)) {
    let w = raw.replace(/^'+|'+$/g, '');
    if (w.length < 3 || STOP.has(w)) continue;
    if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
    else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
    else if (w.length > 4 && w.endsWith('es')) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith('s')) w = w.slice(0, -1);
    out.push(w);
  }
  return out;
}

/** Top-k documents for a query. Deterministic; ties resolve by recency then id. */
export function retrieve(query: string, docs: MemoryDoc[], k: number, nowTurn = 0): MemoryDoc[] {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length || !docs.length) return [];
  const tokenized = docs.map((d) => tokenize(d.text));
  const avgLen = tokenized.reduce((n, t) => n + t.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const tokens of tokenized) for (const term of new Set(tokens)) df.set(term, (df.get(term) ?? 0) + 1);
  const scored = docs.map((doc, i) => {
    const tokens = tokenized[i]!;
    let score = 0;
    for (const term of terms) {
      const tf = tokens.reduce((n, t) => n + (t === term ? 1 : 0), 0);
      if (!tf) continue;
      const idf = Math.log(1 + (docs.length - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5));
      score += (idf * tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * tokens.length) / avgLen));
    }
    if (score > 0) {
      score *= doc.kind === 'fact' ? 1.25 : doc.kind === 'battle' ? 1.1 : 1;
      score += 0.15 / (1 + Math.max(0, nowTurn - doc.turn) / 12);
    }
    return { doc, score };
  });
  return scored.filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.doc.turn - a.doc.turn || a.doc.id.localeCompare(b.doc.id))
    .slice(0, k).map((s) => s.doc);
}

export const RECENT_WINDOW = 14;
export const SUMMARY_CHUNK = 12;

/** Which chat sequence range should be folded into the rolling summary next, if any. */
export function planSummary(summarizedThrough: number, lastSeq: number, recent = RECENT_WINDOW, chunk = SUMMARY_CHUNK): { from: number; to: number } | null {
  const foldable = lastSeq - recent - summarizedThrough;
  return foldable >= chunk ? { from: summarizedThrough + 1, to: lastSeq - recent } : null;
}

/** Extractive fallback when no model is available: keeps memory moving, never blocks play. */
export function localSummary(previous: string, messages: ChatMessage[], limit = 2400): string {
  const lines = messages.filter((m) => m.role !== 'system' || m.kind === 'battle').map((m) => {
    const first = m.text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/).slice(0, 2).join(' ');
    return `${m.role === 'player' ? 'Player' : m.role === 'narrator' ? 'Narrator' : 'World'}: ${first.slice(0, 220)}`;
  });
  const merged = [previous, ...lines].filter(Boolean).join(' ');
  return merged.length > limit ? `…${merged.slice(merged.length - limit)}` : merged;
}

export function memoryDocs(c: CampaignState, olderChat: ChatMessage[]): MemoryDoc[] {
  return [
    ...c.facts.map((f) => ({ id: `fact-${f.id}`, kind: 'fact' as const, text: f.text, turn: f.turn })),
    ...c.battles.map((b) => ({ id: `battle-${b.id}`, kind: 'battle' as const, text: b.summary, turn: b.turn })),
    ...olderChat.filter((m) => m.role !== 'system').map((m) => ({ id: `chat-${m.seq}`, kind: 'chat' as const, text: `${m.role === 'player' ? 'Player' : 'Narrator'}: ${m.text.slice(0, 500)}`, turn: m.turn })),
  ];
}
