import type { Source } from "../core/protocol.ts";
import { listDocuments, type LocalDocument } from "./db.ts";

const CHUNK_SIZE = 1200;
const OVERLAP = 160;
const MAX_HITS = 5;

function terms(text: string): string[] {
  const normalized = text.toLowerCase();
  const words = normalized.match(/[a-z0-9]{2,}/g) ?? [];
  const han = normalized.match(/[\p{Script=Han}]+/gu) ?? [];
  const pairs = han.flatMap((run) => run.length < 2 ? [run] : Array.from({ length: run.length - 1 }, (_, i) => run.slice(i, i + 2)));
  return [...new Set([...words, ...pairs])];
}

export function searchDocuments(docs: LocalDocument[], question: string): Source[] {
  const query = terms(question);
  if (!query.length) return [];
  const hits: { score: number; source: Source }[] = [];
  for (const doc of docs) {
    const content = doc.content.trim();
    for (let start = 0; start < content.length; start += CHUNK_SIZE - OVERLAP) {
      const chunk = content.slice(start, start + CHUNK_SIZE);
      const haystack = chunk.toLowerCase();
      const matched = query.filter((term) => haystack.includes(term));
      if (!matched.length) continue;
      const score = matched.reduce((sum, term) => sum + (term.length > 2 ? 2 : 1), 0);
      hits.push({ score, source: {
        id: `local:${doc.id}:${start}`,
        localDocId: doc.id,
        title: `${doc.name} · 第 ${Math.floor(start / (CHUNK_SIZE - OVERLAP)) + 1} 段`,
        url: "",
        site: "本地资料",
        snippet: chunk.slice(0, 180),
        text: chunk,
      } });
    }
  }
  const chosen: Source[] = [];
  const perDocument = new Map<string, number>();
  for (const hit of hits.sort((a, b) => b.score - a.score)) {
    const id = hit.source.localDocId!;
    if ((perDocument.get(id) ?? 0) >= 2) continue;
    chosen.push(hit.source);
    perDocument.set(id, (perDocument.get(id) ?? 0) + 1);
    if (chosen.length === MAX_HITS) break;
  }
  return chosen;
}

export async function searchLocalLibrary(question: string, signal: AbortSignal): Promise<Source[]> {
  const docs = await listDocuments();
  if (signal.aborted) return [];
  return searchDocuments(docs, question);
}
