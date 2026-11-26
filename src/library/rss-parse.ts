import { isPublicUrl } from "../core/providers/web.ts";

export interface FeedEntry { title: string; url: string; content: string; isSummary: boolean }
export interface Feed { title: string; entries: FeedEntry[] }

function childText(parent: Element, tag: string): string {
  return Array.from(parent.children).find((child) => child.tagName.toLowerCase() === tag)?.textContent?.trim() ?? "";
}

function plainText(value: string): string {
  const doc = new DOMParser().parseFromString(`<html><body>${value}</body></html>`, "text/html");
  for (const el of doc.querySelectorAll("script, style, iframe, svg")) el.remove();
  return (doc.body?.textContent ?? "").replace(/\s+/gu, " ").trim().slice(0, 200_000);
}

export function parseFeed(xml: string, feedUrl: string): Feed {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const root = document.documentElement;
  if (!root || !["rss", "feed"].includes(root.localName.toLowerCase()) || document.querySelector("parsererror")) {
    throw new Error("不是有效的 RSS 或 Atom 订阅源");
  }
  const atom = root.localName.toLowerCase() === "feed";
  const channel = atom ? root : root.querySelector("channel");
  if (!channel) throw new Error("RSS 缺少频道信息");
  const title = childText(channel, "title") || new URL(feedUrl).hostname;
  const items = Array.from(channel.children).filter((child) => child.localName.toLowerCase() === (atom ? "entry" : "item")).slice(0, 50);
  const entries = items.flatMap((item): FeedEntry[] => {
    const link = atom
      ? Array.from(item.children).find((child) => child.localName === "link" && (!child.getAttribute("rel") || child.getAttribute("rel") === "alternate"))?.getAttribute("href") ?? ""
      : childText(item, "link");
    let url: string;
    try { url = new URL(link, feedUrl).href; } catch { return []; }
    if (!isPublicUrl(url)) return [];
    const full = childText(item, atom ? "content" : "content:encoded");
    const summary = childText(item, atom ? "summary" : "description");
    const fullText = plainText(full);
    const body = fullText || plainText(summary);
    if (!body) return [];
    const name = childText(item, "title") || new URL(url).pathname.split("/").filter(Boolean).pop() || "未命名文章";
    return [{ title: name, url, content: fullText ? body : `订阅源摘要（非文章全文）：${body}`, isSummary: !fullText }];
  });
  return { title, entries };
}
