import assert from "node:assert/strict";
import { test } from "node:test";
import { buildIndex, rankIndexes } from "./index.ts";
import { parseJudgment, retrieveLocal, sourcesForMatches } from "./search.ts";
import type { LLMProvider } from "../core/providers/types.ts";

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

test("中文长问句不会因多个零散单字误引无关资料", () => {
  const unrelated = { id: "u", name: "字表.md", content: "今，天，东，京，的，气，是，什，么。", importedAt: 1 };
  const entries = buildIndex(unrelated);
  assert.deepEqual(rankIndexes(entries, "今天东京的天气是什么？"), []);
  assert.equal(rankIndexes(entries, "京").length, 1);
  assert.equal(rankIndexes(entries, "京？").length, 1);
  const filler = buildIndex({ id: "f", name: "无关.md", content: "合作与收益的关系。", importedAt: 1 });
  assert.deepEqual(rankIndexes(filler, "请比较 iOS 与 Android 的兼容性"), []);
  const rare = buildIndex({ id: "r", name: "无关.md", content: "𠮷。", importedAt: 1 });
  assert.deepEqual(rankIndexes(rare, "𠮷野家今天营业吗？"), []);
  assert.equal(rankIndexes(rare, "𠮷？").length, 1);
});

test("判断结果只能用已选原文中的词扩展本地检索", () => {
  const candidates = [{ id: "local:a:0", title: "资料", url: "", site: "本地资料", snippet: "", text: "桔梗项目与松柏工作室合作。" }];
  assert.deepEqual(parseJudgment('{"keep":[1],"expand":["松柏工作室","虚构机构","桔梗项目"]}', candidates, "桔梗项目由谁负责？"), { keep: [1], expand: ["松柏工作室"] });
  assert.equal(parseJudgment('{"keep":[2],"expand":[]}', candidates, "问题"), null);
});

test("一次原文词项扩展能找回首轮没有命中的另一份文件", async () => {
  const corpus = [
    { id: "a", name: "路径.md", content: "Orion Relay routes ownership records through Cedarbridge.", importedAt: 1 },
    { id: "b", name: "职责.md", content: "Cedarbridge custodian: Maya Chen.", importedAt: 2 },
  ];
  const indexes = corpus.flatMap(buildIndex);
  const asked: string[] = [];
  const lookup = async (question: string, max = 5) => {
    asked.push(question);
    return { matches: rankIndexes(indexes, question, max), docs: corpus, incomplete: false };
  };
  let calls = 0;
  const llm: LLMProvider = {
    name: "test",
    complete: async () => ++calls === 1 ? '{"keep":[1],"expand":["Cedarbridge"]}' : '{"keep":[1],"expand":[]}',
    async *stream() {},
  };
  assert.deepEqual(rankIndexes(indexes, "Who is responsible for Orion Relay?").map((hit) => hit.id), ["a"]);
  const found = await retrieveLocal("Who is responsible for Orion Relay?", new AbortController().signal, llm, lookup);
  assert.deepEqual(asked, ["Who is responsible for Orion Relay?", "Cedarbridge"]);
  assert.deepEqual(found.sources.map((source) => source.localDocId), ["a", "b"]);
  assert.match(found.sources[1].text!, /Maya Chen/);
  assert.equal(calls, 2);
});

test("扩展判断失败时仅交付首轮已判断的原文并标明降级", async () => {
  const corpus = [
    { id: "a", name: "路径.md", content: "Orion Relay routes ownership records through Cedarbridge.", importedAt: 1 },
    { id: "b", name: "职责.md", content: "Cedarbridge custodian: Maya Chen.", importedAt: 2 },
  ];
  let calls = 0;
  const llm: LLMProvider = {
    name: "test",
    complete: async () => {
      if (++calls === 1) return '{"keep":[1],"expand":["Cedarbridge"]}';
      throw new Error("服务不可用");
    },
    async *stream() {},
  };
  const lookup = async (question: string, max = 5) => ({ matches: rankIndexes(corpus.flatMap(buildIndex), question, max), docs: corpus, incomplete: false });
  const found = await retrieveLocal("Who is responsible for Orion Relay?", new AbortController().signal, llm, lookup);
  assert.equal(found.sources.length, 1);
  assert.equal(found.deepSearchFailed, true);
  assert.equal(calls, 2);
});

test("扩展读库失败时保留首轮证据", async () => {
  const corpus = [{ id: "a", name: "路径.md", content: "Orion Relay routes through Cedarbridge.", importedAt: 1 }];
  const llm: LLMProvider = {
    name: "test",
    complete: async () => '{"keep":[1],"expand":["Cedarbridge"]}',
    async *stream() {},
  };
  const lookup = async (question: string, max = 5) => {
    if (question === "Cedarbridge") throw new Error("本地索引暂不可读");
    return { matches: rankIndexes(corpus.flatMap(buildIndex), question, max), docs: corpus, incomplete: false };
  };
  const found = await retrieveLocal("Orion Relay", new AbortController().signal, llm, lookup);
  assert.deepEqual(found.sources.map((source) => source.localDocId), ["a"]);
  assert.equal(found.deepSearchFailed, true);
});

test("取消时中断证据判断，不继续扩展检索", async () => {
  const corpus = [{ id: "a", name: "资料.md", content: "Orion Relay routes through Cedarbridge.", importedAt: 1 }];
  const ctrl = new AbortController();
  const asked: string[] = [];
  const lookup = async (question: string, max = 5) => {
    asked.push(question);
    return { matches: rankIndexes(corpus.flatMap(buildIndex), question, max), docs: corpus, incomplete: false };
  };
  const llm: LLMProvider = {
    name: "test",
    complete: async (_messages, options) => new Promise<string>((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new Error("已取消")), { once: true });
    }),
    async *stream() {},
  };
  const pending = retrieveLocal("Orion Relay", ctrl.signal, llm, lookup);
  setTimeout(() => ctrl.abort(), 0);
  const result = await pending;
  assert.deepEqual(result.sources, []);
  assert.deepEqual(asked, ["Orion Relay"]);
});
