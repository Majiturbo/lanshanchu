import { httpFetch } from "../core/http.ts";
import { createPageReader, isPublicUrl, PageError } from "../core/providers/web.ts";
import { saveDocument } from "./db.ts";
import { createWebClipsSource, WEB_CLIPS_SOURCE_ID } from "./model.ts";

const reader = createPageReader(httpFetch, { maxChars: 200_000, truncate: false, requireArticle: true });

export async function clipWebPage(rawUrl: string): Promise<void> {
  const input = rawUrl.trim();
  if (input.length > 2048 || !isPublicUrl(input)) throw new PageError("请输入有效的公网网页地址");
  const page = await reader.read(input);
  if (page.text.length < 80) throw new PageError("没有提取到足够正文，未保存到知识库");
  const url = new URL(page.url ?? input);
  url.hash = "";
  const key = new TextEncoder().encode(url.href);
  const digest = await crypto.subtle.digest("SHA-256", key);
  const id = `web:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const saved = await saveDocument({
    id,
    sourceId: WEB_CLIPS_SOURCE_ID,
    sourceUrl: url.href,
    name: page.title || url.hostname,
    format: "html",
    content: page.text,
    importedAt: Date.now(),
  }, createWebClipsSource());
  if (!saved) throw new Error("网页保存失败，未进入本地索引");
}
