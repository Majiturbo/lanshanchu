import type { MemoryBrief } from "../core/protocol.ts";
import type { MemoryNote } from "../store/types.ts";
import { memoryOn, useMemory } from "./store.ts";

// 把个人记忆用到这次回答上：记忆文本原样交给检索规划（常看的网站会落到元宝的限定站点参数上）和写答案；
// 历史搜索结果和旧回答不进入事实证据链；记忆文本只提供用户偏好与检索方向。

/** 记忆文本里写到的网站（域名），回答完成后用来标出检索时真的限定过哪些 */
export const sitesIn = (text: string) => [...new Set(text.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi) ?? [])].map((s) => s.toLowerCase().replace(/^www\./, ""));

/** 这次提问用到的记忆；关闭了记忆、这张地图不用记忆或没有可用的内容时为 null */
export async function buildMemory(_question: string, mapId: string): Promise<{ brief: MemoryBrief; note: MemoryNote } | null> {
  if (!memoryOn(mapId)) return null;
  const text = useMemory.getState().text.trim();
  if (!text) return null;

  const brief: MemoryBrief = {};
  if (text) {
    brief.research = `用户的个人记忆（只作参考，和这个问题无关就忽略；里面写的常看网站对口时，可以拿一个查询词限定它）：\n${text}`;
  }
  const answer = [
    text ? `用户的个人记忆（回答偏好照做，其余只作参考）：\n${text}` : "",
  ].filter(Boolean);
  if (answer.length) brief.answer = answer.join("\n");

  return { brief, note: { sites: sitesIn(text), recalls: [] } };
}

/** 回答完成后只保留检索时真的限定过的站点（查询词形如「词 site:域名」） */
export function usedSites(note: MemoryNote, queries: string[]) {
  return note.sites.filter((s) => queries.some((q) => q.endsWith(`site:${s}`) || q.endsWith(`site:www.${s}`)));
}
