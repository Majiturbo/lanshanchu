import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lenBucket, pctBucket, quotaReason } from "./events.ts";
import { hoursSinceInstall, markEffectiveExplore, resetIdentityForTest, takeColdStart } from "./identity.ts";
import { nodeDepth, nodeKind } from "./nodeMeta.ts";
import type { GNode } from "../store/types.ts";

describe("analytics buckets", () => {
  it("lenBucket", () => {
    assert.equal(lenBucket(0), "0-20");
    assert.equal(lenBucket(20), "0-20");
    assert.equal(lenBucket(21), "21-80");
    assert.equal(lenBucket(80), "21-80");
    assert.equal(lenBucket(81), "81+");
  });

  it("pctBucket", () => {
    assert.equal(pctBucket(-1), "0-25");
    assert.equal(pctBucket(25), "0-25");
    assert.equal(pctBucket(26), "26-50");
    assert.equal(pctBucket(100), "76-100");
  });

  it("quotaReason", () => {
    assert.equal(quotaReason(null), "no_plan");
    assert.equal(quotaReason({ plan: "", monthPct: 0, windowPct: 0, weekPct: 0 }), "no_plan");
    assert.equal(quotaReason({ plan: "lamp", monthPct: 100, windowPct: 10, weekPct: 10 }), "month");
    assert.equal(quotaReason({ plan: "lamp", monthPct: 10, windowPct: 100, weekPct: 10 }), "5h");
    assert.equal(quotaReason({ plan: "lamp", monthPct: 10, windowPct: 10, weekPct: 100 }), "7d");
  });
});

describe("nodeMeta", () => {
  const base = (p: Partial<GNode> & { id: string }): GNode =>
    ({
      kind: "answer",
      dir: null,
      nextWhy: null,
      q: "q",
      parent: null,
      links: [],
      op: null,
      instruction: null,
      children: [],
      collapsed: false,
      settled: false,
      status: "ready",
      stage: null,
      stageDetail: null,
      images: [],
      imageNote: "",
      summary: "",
      framed: false,
      thinking: "",
      points: [],
      visual: null,
      memory: null,
      sources: [],
      detail: "",
      detailStatus: "idle",
      queries: [],
      searchMode: null,
      compareOf: null,
      searches: [],
      steps: [],
      dropped: [],
      searchMs: 0,
      searchResults: 0,
      answeredAt: 0,
      since: null,
      error: null,
      errorCode: null,
      errorHint: null,
      dx: 0,
      dy: 0,
      ax: 0,
      ay: 0,
      ...p,
    }) as GNode;

  it("nodeDepth and nodeKind", () => {
    const nodes = {
      n1: base({ id: "n1" }),
      n2: base({ id: "n2", parent: "n1", dir: "追问" }),
      n3: base({ id: "n3", parent: "n2", compareOf: "n2" }),
      n4: base({ id: "n4", links: ["n1", "n2"], op: "summary" }),
      n5: base({ id: "n5", parent: "n1", since: "2026-10-01", dir: "新进展" }),
    };
    assert.equal(nodeDepth(nodes, "n1"), 0);
    assert.equal(nodeDepth(nodes, "n2"), 1);
    assert.equal(nodeDepth(nodes, "n3"), 2);
    assert.equal(nodeKind(nodes.n1), "root");
    assert.equal(nodeKind(nodes.n2), "followup");
    assert.equal(nodeKind(nodes.n3), "compare");
    assert.equal(nodeKind(nodes.n4), "synth");
    assert.equal(nodeKind(nodes.n5), "news");
  });
});

describe("identity", () => {
  it("cold start then warm", () => {
    resetIdentityForTest({ anon: "a1", session: "s1", installAt: Date.now(), explored: false });
    assert.equal(takeColdStart(), true);
    assert.equal(takeColdStart(), false);
  });

  it("hoursSinceInstall and first effective explore once", () => {
    resetIdentityForTest({ anon: "a1", session: "s1", installAt: Date.now() - 7_200_000, explored: false });
    assert.equal(hoursSinceInstall(), 2);
    assert.equal(markEffectiveExplore(), true);
    assert.equal(markEffectiveExplore(), false);
  });
});
