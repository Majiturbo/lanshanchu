import assert from "node:assert/strict";
import test from "node:test";
import { buildIndex, rankIndexes } from "./index.ts";
import { normalizeOcrText, validateOcrImage } from "./parse-ocr.ts";

test("OCR 中文字间空格不打断检索词，段落换行仍保留", () => {
  const content = normalizeOcrText("蓝 色 灯笼 由 小 林 保 管\n第 二 段");
  assert.equal(content, "蓝色灯笼由小林保管\n第二段");
  const indexes = buildIndex({ id: "scan", name: "扫描件.pdf", content, importedAt: 1 });
  assert.equal(rankIndexes(indexes, "蓝色灯笼由谁保管")[0]?.id, "scan");
});

test("图片识别前拒绝解码后像素过大的文件与无效格式", async () => {
  const png = new Uint8Array(24);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  new DataView(png.buffer).setUint32(16, 20_000);
  new DataView(png.buffer).setUint32(20, 20_000);
  await assert.rejects(validateOcrImage(new File([png], "small-file.png")), /最多支持 1600 万像素/);
  await assert.rejects(validateOcrImage(new File(["not an image"], "broken.png")), /图片格式无法读取/);
});
