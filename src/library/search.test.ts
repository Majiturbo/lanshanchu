import assert from "node:assert/strict";
import { test } from "node:test";
import { buildIndex, rankIndexes } from "./index.ts";
import { sourcesForMatches } from "./search.ts";

const docs = [
  { id: "a", name: "计划.md", content: "阑珊处支持本地知识检索。", importedAt: 1 },
  { id: "b", name: "无关.txt", content: "今天晴天。", importedAt: 2 },
];

test("索引只返回与问题匹配的导入原文，保留文件和片段定位", () => {
  const indexes = docs.flatMap(buildIndex);
  const found = sourcesForMatches(rankIndexes(indexes, "本地知识怎么检索？"), docs);
  assert.equal(found.length, 1);
  assert.equal(found[0].localDocId, "a");
  assert.equal(found[0].site, "本地资料");
  assert.match(found[0].text!, /本地知识检索/);
  assert.deepEqual(rankIndexes(indexes, "火星探测器"), []);
});

test("同一资料更新后重建索引，旧词不再召回", () => {
  const old = buildIndex(docs[0]);
  const updated = buildIndex({ ...docs[0], content: "海棠计划使用蓝色灯笼。" });
  assert.equal(rankIndexes(old, "本地知识").length, 1);
  assert.deepEqual(rankIndexes(updated, "本地知识"), []);
  assert.equal(rankIndexes(updated, "蓝色灯笼").length, 1);
});

test("问题只共享常见词的旧文件不作为引用", () => {
  const old = { id: "old", name: "旧.md", content: "海棠计划的蓝色灯笼用于资料库迁移。", importedAt: 1 };
  const fresh = { id: "fresh", name: "新.md", content: "青铜门计划的紫色纸鹤标记新导入资料。", importedAt: 2 };
  const found = rankIndexes([...buildIndex(old), ...buildIndex(fresh)], "青铜门计划的紫色纸鹤是什么？");
  assert.deepEqual(found.map((hit) => hit.id), ["fresh"]);
});

test("单字中文与英文子串仍可检索", () => {
  const index = buildIndex({ id: "x", name: "书.txt", content: "这本书很好。knowledgebase", importedAt: 1 });
  assert.equal(rankIndexes(index, "书").length, 1);
  assert.equal(rankIndexes(index, "knowledge").length, 1);
});
