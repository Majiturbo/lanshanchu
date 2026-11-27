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

test("静态 GIF 可识别，动画 GIF 不会只索引第一帧", async () => {
  const staticGif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
  const animatedGif = Buffer.from("R0lGODlhAgACAIEAAP///wAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAFAAAACwAAAAAAgACAAAIBgABCAQQEAAh+QQBFAABACwAAAAAAgACAIEAAAAAAAAAAAAAAAAIBgABCAQQEAA7", "base64");
  await validateOcrImage(new File([staticGif], "still.gif"));
  await assert.rejects(validateOcrImage(new File([animatedGif], "moving.gif")), /动画 GIF 暂不支持/);
});

test("BMP 非正宽度与旧式 DIB 头不会进入识别引擎", async () => {
  const bmp = new Uint8Array(54);
  bmp.set([0x42, 0x4d]);
  const view = new DataView(bmp.buffer);
  view.setUint32(14, 40, true);
  view.setInt32(18, -2_147_483_648, true);
  view.setInt32(22, 100, true);
  await assert.rejects(validateOcrImage(new File([bmp], "negative.bmp")), /图片格式无法读取/);
  view.setUint32(14, 12, true);
  view.setInt32(18, 100, true);
  await assert.rejects(validateOcrImage(new File([bmp], "legacy.bmp")), /图片格式无法读取/);
});
