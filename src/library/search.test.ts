import assert from "node:assert/strict";
import { test } from "node:test";
import { buildIndex, rankIndexes, type DocumentIndex } from "./index.ts";
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

test("网页剪藏的本地快照保留原始网址引用", () => {
  const clipped = { id: "web:a", sourceId: "web-clips", name: "海棠计划", sourceUrl: "https://example.com/article", content: "海棠计划的蓝色灯笼由林先生保管。", importedAt: 3 };
  const found = sourcesForMatches(rankIndexes(buildIndex(clipped), "蓝色灯笼由谁保管？"), [clipped]);
  assert.equal(found[0].url, clipped.sourceUrl);
  assert.match(found[0].site, /^网页剪藏（保存于 /);
  assert.equal(found[0].localDocId, clipped.id);
  assert.match(found[0].text!, /林先生/);
});

test("RSS 摘要的每个命中片段都标明不是全文", () => {
  const doc = { id: "rss:feed:article", sourceId: "rss:feed", name: "测试订阅", sourceUrl: "https://example.com/post", isSummary: true, content: "甲".repeat(4000), importedAt: 3 };
  const found = sourcesForMatches([{ id: doc.id, start: 2000, score: 1 }], [doc]);
  assert.match(found[0].site, /RSS 摘要（非全文）/);
});

test("GitHub 文档引用指向已索引版本的原文", () => {
  const doc = { id: "github:a:docs/guide.md", sourceId: "github:a", name: "docs/guide.md", sourceUrl: "https://github.com/owner/repo/blob/abc123/docs/guide.md", content: "青玉案计划由蓝色灯笼标记。", importedAt: 3 };
  const found = sourcesForMatches(rankIndexes(buildIndex(doc), "青玉案计划如何标记？"), [doc]);
  assert.equal(found[0].url, doc.sourceUrl);
  assert.match(found[0].site, /^GitHub 仓库（保存于 /);
  assert.match(found[0].title, /docs\/guide\.md/);
});

test("GitLab 文档引用保留仓库来源与提交链接", () => {
  const doc = { id: "gitlab:a:README.md", sourceId: "gitlab:a", name: "README.md", sourceUrl: "https://gitlab.com/team/repo/-/blob/abc123/README.md", content: "青玉案计划由蓝色灯笼标记。", importedAt: 3 };
  const found = sourcesForMatches(rankIndexes(buildIndex(doc), "青玉案计划如何标记？"), [doc]);
  assert.equal(found[0].url, doc.sourceUrl);
  assert.match(found[0].site, /^GitLab 仓库（保存于 /);
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

test("罕见词证据排在只命中常见词的文件前", () => {
  const indexes: DocumentIndex[] = Array.from({ length: 9 }, (_, index) => ({
    id: `common-${index}`, bucket: 0, terms: ["oak"], postings: { oak: [0] },
  }));
  indexes.push({ id: "specific", bucket: 0, terms: ["maple"], postings: { maple: [0] } });
  assert.deepEqual(rankIndexes(indexes, "oak maple", 1).map((hit) => hit.id), ["specific"]);
  const reverse = [
    ...Array.from({ length: 9 }, (_, index) => ({ id: `maple-${index}`, name: "常见.md", content: "maple", importedAt: index })).flatMap(buildIndex),
    ...buildIndex({ id: "rare-oak", name: "罕见.md", content: "oak", importedAt: 10 }),
  ];
  assert.deepEqual(rankIndexes(reverse, "oak maple", 1, 1000).map((hit) => hit.id), ["rare-oak"]);
  const shared = [
    ...Array.from({ length: 9 }, (_, index) => ({ id: `map-${index}`, name: "共享子词.md", content: "map", importedAt: index })).flatMap(buildIndex),
    ...buildIndex({ id: "unique-oak", name: "罕见.md", content: "oak", importedAt: 10 }),
  ];
  assert.deepEqual(rankIndexes(shared, "map maple oak", 1, 1000).map((hit) => hit.id), ["unique-oak"]);
  for (const question of ["mapping maple oak", "maple mapping oak"]) {
    assert.deepEqual(rankIndexes(reverse, question, 1, 1000).map((hit) => hit.id), ["rare-oak"]);
  }
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

test("PDF 每页独立建索引且引用只包含所在页的原文", () => {
  const content = "Orion Relay belongs to Cedarbridge.\n\nMaya Chen leads the Harbor project.";
  const second = content.indexOf("Maya Chen");
  const pdf = { id: "pdf", name: "记录.pdf", content, importedAt: 1, pages: [{ number: 1, start: 0, end: second - 2 }, { number: 2, start: second, end: content.length }] };
  const first = sourcesForMatches(rankIndexes(buildIndex(pdf), "Orion Relay"), [pdf]);
  const later = sourcesForMatches(rankIndexes(buildIndex(pdf), "Harbor project"), [pdf]);
  assert.equal(first[0].title, "记录.pdf 第1页");
  assert.doesNotMatch(first[0].text!, /Maya Chen/);
  assert.equal(later[0].title, "记录.pdf 第2页");
  assert.doesNotMatch(later[0].text!, /Orion Relay/);
});

test("表格引用显示工作表名称并限制片段到该表", () => {
  const content = "工作表：汇总\nA1: 蓝色灯笼\n\n工作表：明细\nC3: 青玉案";
  const second = content.indexOf("工作表：明细");
  const sheet = { id: "sheet", name: "台账.xlsx", format: "xlsx", content, importedAt: 1,
    pages: [{ number: 1, start: 0, end: second - 2, label: "汇总" }, { number: 2, start: second, end: content.length, label: "明细" }] };
  const found = sourcesForMatches(rankIndexes(buildIndex(sheet), "青玉案"), [sheet]);
  assert.equal(found[0].title, "台账.xlsx 明细");
  assert.doesNotMatch(found[0].text!, /蓝色灯笼/);
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
