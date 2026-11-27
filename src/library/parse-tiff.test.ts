import assert from "node:assert/strict";
import test from "node:test";
import UTIF from "utif";
import { decodeTiffPage, validateTiffPages } from "./parse-tiff.ts";

function sampleTiff(): ArrayBuffer {
  return UTIF.encodeImage(new Uint8Array(4 * 4 * 4).fill(255), 4, 4);
}

function setShortTag(buffer: ArrayBuffer, tag: number, value: number): void {
  const view = new DataView(buffer);
  const first = view.getUint32(4, false);
  const count = view.getUint16(first, false);
  for (let entry = first + 2; entry < first + 2 + count * 12; entry += 12) {
    if (view.getUint16(entry, false) !== tag) continue;
    const type = view.getUint16(entry + 2, false);
    if (type === 3) view.setUint16(entry + 8, value, false);
    else if (type === 4) view.setUint32(entry + 8, value, false);
    else throw new Error(`测试 TIFF 标签类型不支持：${type}`);
    return;
  }
  throw new Error(`测试 TIFF 缺少标签：${tag}`);
}

function setAsciiCompression(buffer: ArrayBuffer): void {
  const view = new DataView(buffer);
  const first = view.getUint32(4, false);
  const count = view.getUint16(first, false);
  for (let entry = first + 2; entry < first + 2 + count * 12; entry += 12) {
    if (view.getUint16(entry, false) !== 259) continue;
    view.setUint16(entry + 2, 2, false);
    view.setUint32(entry + 4, 2, false);
    view.setUint8(entry + 8, 55);
    view.setUint8(entry + 9, 0);
    return;
  }
  throw new Error("测试 TIFF 缺少压缩标签");
}

test("TIFF 先检查页面目录，防止循环目录进入解码器", () => {
  const good = sampleTiff();
  assert.equal(validateTiffPages(good).length, 1);
  const cycle = good.slice(0);
  const view = new DataView(cycle);
  const first = view.getUint32(4, false);
  const next = first + 2 + view.getUint16(first, false) * 12;
  view.setUint32(next, first, false);
  assert.throws(() => validateTiffPages(cycle), /页面目录损坏/);
});

test("TIFF 尺寸超限时不解压图像", () => {
  const oversized = sampleTiff();
  const view = new DataView(oversized);
  const first = view.getUint32(4, false);
  const count = view.getUint16(first, false);
  for (let entry = first + 2; entry < first + 2 + count * 12; entry += 12) {
    if (view.getUint16(entry, false) === 256 || view.getUint16(entry, false) === 257) view.setUint16(entry + 8, 5000, false);
  }
  assert.throws(() => validateTiffPages(oversized), /单页最多支持 1600 万像素/);
});

test("TIFF 非压缩条带不足以覆盖页面时拒绝导入", () => {
  const truncated = sampleTiff();
  setShortTag(truncated, 279, 1);
  assert.throws(() => validateTiffPages(truncated), /非压缩图像数据不完整/);
});

test("TIFF 拒绝尚未校验完整性的压缩格式", () => {
  for (const compression of [3, 4, 5, 7]) {
    const compressed = sampleTiff();
    setShortTag(compressed, 259, compression);
    assert.throws(() => validateTiffPages(compressed), /只支持未压缩或 PackBits/);
  }
});

test("PackBits 解压后必须完整覆盖图像，不能将补零页识别入库", () => {
  const complete = sampleTiff();
  const view = new DataView(complete);
  const first = view.getUint32(4, false);
  const count = view.getUint16(first, false);
  let stripOffset = 0;
  for (let entry = first + 2; entry < first + 2 + count * 12; entry += 12) {
    if (view.getUint16(entry, false) === 273) stripOffset = view.getUint32(entry + 8, false);
  }
  setShortTag(complete, 259, 32773);
  setShortTag(complete, 279, 8);
  for (let row = 0; row < 4; row++) {
    view.setUint8(stripOffset + row * 2, 241);
    view.setUint8(stripOffset + row * 2 + 1, 255);
  }
  assert.deepEqual([...decodeTiffPage(complete, validateTiffPages(complete)[0]).slice(0, 4)], [255, 255, 255, 255]);

  const partial = complete.slice(0);
  new DataView(partial).setUint8(stripOffset + 6, 255);
  assert.throws(() => validateTiffPages(partial), /条带数据不完整/);

  const truncated = complete.slice(0);
  setShortTag(truncated, 279, 1);
  assert.throws(() => validateTiffPages(truncated), /条带数据损坏/);

  const crossRow = complete.slice(0);
  setShortTag(crossRow, 279, 2);
  new DataView(crossRow).setUint8(stripOffset, 193);
  assert.throws(() => validateTiffPages(crossRow), /条带数据损坏/);
});

test("TIFF 不把错误类型的压缩标签当成未压缩", () => {
  const malformed = sampleTiff();
  setAsciiCompression(malformed);
  assert.throws(() => validateTiffPages(malformed), /标签 t259 内容无效/);
});
