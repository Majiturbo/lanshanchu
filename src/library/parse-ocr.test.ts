import assert from "node:assert/strict";
import test from "node:test";
import { buildIndex, rankIndexes } from "./index.ts";
import { normalizeOcrText } from "./parse-ocr.ts";

test("OCR 中文字间空格不打断检索词，段落换行仍保留", () => {
  const content = normalizeOcrText("蓝 色 灯笼 由 小 林 保 管\n第 二 段");
  assert.equal(content, "蓝色灯笼由小林保管\n第二段");
  const indexes = buildIndex({ id: "scan", name: "扫描件.pdf", content, importedAt: 1 });
  assert.equal(rankIndexes(indexes, "蓝色灯笼由谁保管")[0]?.id, "scan");
});
