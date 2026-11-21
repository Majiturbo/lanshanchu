import type { LocalSearchResult, Source } from "../core/protocol.ts";
import { lookupDocuments, type LocalDocument } from "./db.ts";
import { CHUNK_SIZE, CHUNK_STEP, type IndexMatch } from "./index.ts";

export function sourcesForMatches(matches: IndexMatch[], docs: LocalDocument[]): Source[] {
  const byId = new Map(docs.map((doc) => [doc.id, doc]));
  return matches.flatMap(({ id, start }) => {
    const doc = byId.get(id);
    if (!doc) return [];
    const chunk = doc.content.trim().slice(start, start + CHUNK_SIZE);
    return [{
      id: `local:${id}:${start}`,
      localDocId: id,
      title: `${doc.name} · 第 ${Math.floor(start / CHUNK_STEP) + 1} 段`,
      url: "",
      site: "本地资料",
      snippet: chunk.slice(0, 180),
      text: chunk,
    }];
  });
}

export async function searchLocalLibrary(question: string, signal: AbortSignal): Promise<LocalSearchResult> {
  const empty = { sources: [], incomplete: false };
  if (signal.aborted) return empty;
  let onAbort = () => {};
  const aborted = new Promise<null>((resolve) => {
    onAbort = () => resolve(null);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const result = await Promise.race([lookupDocuments(question), aborted]);
    if (!result || signal.aborted) return empty;
    return { sources: sourcesForMatches(result.matches, result.docs), incomplete: result.incomplete };
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
