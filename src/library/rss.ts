import { httpFetch } from "../core/http.ts";
import { isPublicUrl } from "../core/providers/web.ts";
import { completeIndexJob, getSource, listSources, markSourceSynced, putSource, saveDocument, startIndexJob, updateIndexJob, updateRssSourceUrl } from "./db.ts";
import type { KnowledgeSource } from "./model.ts";
import { parseFeed, type Feed } from "./rss-parse.ts";
import { readLimitedBytes } from "./read-limited.ts";

async function readFeed(url: string): Promise<Feed & { url: string }> {
  let current = url;
  const signal = AbortSignal.timeout(10_000);
  for (let hop = 0; hop <= 5; hop++) {
    if (!isPublicUrl(current)) throw new Error("请输入有效的公网 RSS / Atom 地址");
    const response = await httpFetch(current, { method: "GET", signal, redirect: "manual", maxRedirections: 0 } as RequestInit);
    const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
    if (location) { current = new URL(location, current).href; continue; }
    if (!response.ok) throw new Error(`订阅源返回 HTTP ${response.status}`);
    const bytes = await readLimitedBytes(response, 3 * 1024 * 1024, "订阅源");
    const head = new TextDecoder("latin1").decode(bytes.slice(0, 256));
    const encoding = /encoding=["']([\w-]+)/i.exec(head)?.[1] ?? "utf-8";
    const xml = new TextDecoder(encoding).decode(bytes);
    return { ...parseFeed(xml, current), url: current };
  }
  throw new Error("订阅源重定向次数过多");
}

async function sourceId(url: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url));
  return `rss:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function addRssSource(rawUrl: string): Promise<void> {
  const url = rawUrl.trim();
  if (url.length > 2048 || !isPublicUrl(url)) throw new Error("请输入有效的公网 RSS / Atom 地址");
  const feed = await readFeed(url);
  const finalUrl = new URL(feed.url);
  finalUrl.hash = "";
  const id = await sourceId(finalUrl.href);
  const existing = await getSource(id);
  if (existing || (await listSources()).some((source) => source.kind === "rss" && source.feedUrl === finalUrl.href)) {
    throw new Error("此订阅源已经添加，请使用同步更新");
  }
  const now = Date.now();
  await putSource({ id, kind: "rss", name: feed.title, feedUrl: finalUrl.href, enabled: true, createdAt: now, updatedAt: now });
  await importFeed(id, feed);
}

export async function syncRssSource(source: KnowledgeSource): Promise<void> {
  if (source.kind !== "rss" || !source.feedUrl) throw new Error("订阅源地址不可用");
  let feed: Feed & { url: string };
  try { feed = await readFeed(source.feedUrl); }
  catch (error) {
    const job = await startIndexJob(source.id, "import", 1);
    await updateIndexJob(job.id, { stage: "reading", completed: 1, failed: 1, error: { name: source.name, message: error instanceof Error ? error.message : "读取订阅源失败" } });
    await completeIndexJob(job.id);
    throw error;
  }
  await importFeed(source.id, feed);
  const finalUrl = new URL(feed.url);
  finalUrl.hash = "";
  if (finalUrl.href !== source.feedUrl) await updateRssSourceUrl(source.id, finalUrl.href);
}

async function importFeed(sourceId: string, feed: Feed): Promise<void> {
  const job = await startIndexJob(sourceId, "import", feed.entries.length);
  let updated = 0;
  let failed = 0;
  for (const [index, entry] of feed.entries.entries()) {
    try {
      const id = `${sourceId}:${await sourceIdForEntry(entry.url)}`;
      const saved = await saveDocument({ id, sourceId, name: entry.title, format: "html", sourceUrl: entry.url, content: entry.content, isSummary: entry.isSummary, importedAt: Date.now() });
      if (!saved) throw new Error("资料未写入索引");
      updated++;
      await updateIndexJob(job.id, { stage: "indexing", completed: index + 1, updated, failed });
    } catch (error) {
      failed++;
      await updateIndexJob(job.id, { stage: "indexing", completed: index + 1, updated, failed, error: { name: entry.title, message: error instanceof Error ? error.message : "导入失败" } });
    }
  }
  await completeIndexJob(job.id);
  if (failed) throw new Error(`订阅源有 ${failed} 篇文章导入失败，请查看失败原因后重试`);
  await markSourceSynced(sourceId);
}

async function sourceIdForEntry(url: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
