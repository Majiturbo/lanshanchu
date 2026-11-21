import type { Source } from "../core/protocol.ts";
import { coverage, dice } from "../lib/match.ts";
import { memoryOn } from "../memory/store.ts";
import { get, parked } from "../store/core.ts";
import { getMap, listMeta } from "./db.ts";

/** 本机历史是权威数据；每次检索读取存档，删除和撤销立即反映在结果中。 */
export async function searchLocal(question: string, mapId: string, signal: AbortSignal): Promise<Source[]> {
  if (!memoryOn(mapId)) return [];
  const hits: { score: number; source: Source }[] = [];
  const current = get();
  const live = current.map?.id === mapId ? { nodes: current.nodes, title: Object.values(current.nodes).find((n) => !n.parent)?.q ?? "当前地图" } : parked.has(mapId) ? { nodes: parked.get(mapId)!.nodes, title: "当前地图" } : null;
  const metas = await listMeta();
  const entries = [...metas.filter((m) => m.id !== mapId).map((m) => ({ id: m.id, title: m.title })), ...(live ? [{ id: mapId, title: live.title }] : [])];
  for (const meta of entries) {
    if (signal.aborted) return [];
    const nodes = meta.id === mapId && live ? live.nodes : (await getMap(meta.id))?.nodes;
    if (!nodes) continue;
    for (const node of Object.values(nodes)) {
      if (node.kind !== "answer" || node.status !== "ready" || !node.summary.trim()) continue;
      const direct = dice(question, node.q);
      const contextual = Math.max(coverage(question, node.summary), ...node.points.map((p) => coverage(question, p.text)));
      const score = Math.max(direct.common >= 3 ? direct.score : 0, contextual * 0.6);
      if (score >= 0.26) {
        const cleaned = node.summary.replace(/\[\d+\]/g, "").trim();
        hits.push({ score, source: {
        id: `local:${meta.id}:${node.id}`,
        title: `${meta.title} · ${node.q}`,
        url: "", site: "我的知识地图",
        date: node.answeredAt ? new Date(node.answeredAt).toISOString() : undefined,
        snippet: `此前回答（模型整理，并非原始网页）：${cleaned.slice(0, 900)}`,
        localRef: { mapId: meta.id, nodeId: node.id },
        } });
      }
      for (const original of node.sources) {
        if (original.localRef) continue;
        const overlap = Math.max(coverage(question, original.title), coverage(question, original.text ?? original.snippet));
        if (overlap < 0.28) continue;
        hits.push({ score: overlap * 0.7 + score * 0.3, source: {
          id: `local:${meta.id}:${node.id}:${original.id}`,
          title: original.title,
          url: original.url,
          site: original.site,
          date: original.date,
          snippet: original.snippet.slice(0, 900),
          text: original.text?.slice(0, 1800),
          localRef: { mapId: meta.id, nodeId: node.id, sourceId: original.id },
        } });
      }
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 4).map((h) => h.source);
}
