import type { GNode } from "../store/types.ts";
import type { NodeKind } from "./events.ts";

/** 回答节点在树上的深度：根为 0 */
export function nodeDepth(nodes: Record<string, GNode>, id: string): number {
  let d = 0;
  let cur: string | null = id;
  const seen = new Set<string>();
  while (cur) {
    if (seen.has(cur)) break;
    seen.add(cur);
    const node: GNode | undefined = nodes[cur];
    if (!node?.parent) break;
    cur = node.parent;
    d++;
  }
  return d;
}

export function nodeKind(n: GNode): NodeKind {
  if (n.compareOf) return "compare";
  if (n.links.length) return "synth";
  if (n.since) return "news";
  if (n.parent) return "followup";
  return "root";
}
