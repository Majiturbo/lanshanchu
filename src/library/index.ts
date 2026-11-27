import type { LocalDocument } from "./db.ts";

export interface DocumentIndex {
  id: string;
  bucket: number;
  terms: string[];
  postings: Record<string, number[]>;
}

export interface IndexMatch {
  id: string;
  start: number;
  score: number;
}

export const CHUNK_SIZE = 1200;
export const CHUNK_STEP = CHUNK_SIZE - 160;
const MAX_HITS = 5;
const BUCKETS = 128;

export function terms(text: string): string[] {
  const normalized = text.toLowerCase();
  const words = normalized.match(/[a-z0-9]{2,}/g) ?? [];
  const han = normalized.match(/[\p{Script=Han}]+/gu) ?? [];
  const parts = words.flatMap((word) => [word, ...Array.from({ length: Math.max(0, word.length - 1) }, (_, i) => word.slice(i, i + 2)), ...Array.from({ length: Math.max(0, word.length - 2) }, (_, i) => word.slice(i, i + 3))]);
  const characters = han.flatMap((run) => [...run, ...Array.from({ length: Math.max(0, run.length - 1) }, (_, i) => run.slice(i, i + 2))]);
  return [...new Set([...parts, ...characters])];
}

/** 长问句以连续词项召回；整句只有一个汉字时保留单字检索。 */
export function queryTerms(text: string): string[] {
  return /^\s*\p{Script=Han}[?？!！。.\s]*$/u.test(text)
    ? terms(text)
    : terms(text).filter((term) => [...term].length > 1);
}

export function bucketOf(term: string): number {
  let hash = 2166136261;
  for (const char of term) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
  return (hash >>> 0) % BUCKETS;
}

/** 索引只包含词项到原文片段起点的映射，不把模型输出或搜索结果作为输入。 */
export function buildIndex(doc: LocalDocument): DocumentIndex[] {
  const buckets = new Map<number, DocumentIndex>();
  const content = doc.content.trim();
  for (const span of doc.pages ?? [{ start: 0, end: content.length }]) {
    for (let start = span.start; start < span.end; start += CHUNK_STEP) {
      for (const term of terms(content.slice(start, Math.min(start + CHUNK_SIZE, span.end)))) {
        const bucket = bucketOf(term);
        let index = buckets.get(bucket);
        if (!index) { index = { id: doc.id, bucket, terms: [], postings: Object.create(null) }; buckets.set(bucket, index); }
        (index.postings[term] ??= []).push(start);
      }
    }
  }
  for (const index of buckets.values()) index.terms = Object.keys(index.postings);
  return [...buckets.values()];
}

export function rankIndexes(indexes: DocumentIndex[], question: string, maxHits = MAX_HITS, totalDocuments?: number): IndexMatch[] {
  const query = queryTerms(question);
  if (!query.length) return [];
  const matchedDocuments = new Set(indexes.map((index) => index.id));
  const documentCount = Math.max(totalDocuments ?? matchedDocuments.size, matchedDocuments.size);
  const termDocuments = new Map(query.map((term) => [term, new Set<string>()]));
  for (const index of indexes) {
    for (const term of query) {
      if (index.postings[term]?.length) termDocuments.get(term)!.add(index.id);
    }
  }
  const hits = new Map<string, { id: string; start: number; weights: number[] }>();
  for (const index of indexes) {
    for (const term of query) {
      const frequency = termDocuments.get(term)!.size;
      if (!frequency) continue;
      const weight = Math.log(1 + (documentCount - frequency + 0.5) / (frequency + 0.5));
      for (const start of index.postings[term] ?? []) {
        const key = `${index.id}:${start}`;
        const hit = hits.get(key) ?? { id: index.id, start, weights: [] };
        hit.weights.push(weight * (term.length > 1 ? 2 : 1));
        hits.set(key, hit);
      }
    }
  }
  const chosen: IndexMatch[] = [];
  const perDocument = new Map<string, number>();
  const ranked = [...hits.values()].map(({ id, start, weights }) => {
    weights.sort((a, b) => b - a);
    return { match: { id, start, score: weights[0] + weights.slice(1, 4).reduce((sum, value) => sum + value * 0.1, 0) }, coverage: weights.length };
  }).sort((a, b) => b.match.score - a.match.score || b.coverage - a.coverage);
  const minimum = query.length === 1 ? 0 : (ranked[0]?.match.score ?? 0) * 0.45;
  for (const { match: hit } of ranked) {
    if (hit.score < minimum) break;
    if ((perDocument.get(hit.id) ?? 0) >= 2) continue;
    chosen.push(hit);
    perDocument.set(hit.id, (perDocument.get(hit.id) ?? 0) + 1);
    if (chosen.length === maxHits) break;
  }
  return chosen;
}
