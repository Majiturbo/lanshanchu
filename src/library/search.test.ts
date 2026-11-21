import assert from "node:assert/strict";
import { test } from "node:test";
import { searchDocuments } from "./search.ts";

test("只返回与问题匹配的导入原文，保留文件和片段定位", () => {
  const docs = [
    { id: "a", name: "计划.md", content: "阑珊处支持本地知识检索。", importedAt: 1 },
    { id: "b", name: "无关.txt", content: "今天晴天。", importedAt: 2 },
  ];
  const found = searchDocuments(docs, "本地知识怎么检索？");
  assert.equal(found.length, 1);
  assert.equal(found[0].localDocId, "a");
  assert.equal(found[0].site, "本地资料");
  assert.match(found[0].text!, /本地知识检索/);
  assert.deepEqual(searchDocuments(docs, "火星探测器"), []);
});
