import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { parseDocument, pdfPageText, supportsDocumentName, validateDocx } from "./parse.ts";

test("纯文本导入只保存非空正文并拒绝无文字文件", async () => {
  assert.deepEqual(await parseDocument(new File(["  原始资料。  "], "资料.md")), { content: "原始资料。" });
  await assert.rejects(parseDocument(new File(["   "], "空白.txt")), /没有可提取的文字/);
  await assert.rejects(parseDocument(new File([new Uint8Array([0, 0, 0])], "二进制.txt")), /不是可读取的文字/);
  await assert.rejects(parseDocument(new File([new Uint8Array([0xff])], "无效.txt")), /请转为 UTF-8/);
  await assert.rejects(parseDocument(new File(["test"], "旧版.doc")), /当前格式尚不能解析/);
});

test("目录扫描与单文件导入共用同一份格式能力", async () => {
  assert.equal(supportsDocumentName("数据.CSV"), true);
  assert.equal(supportsDocumentName("旧版.doc"), false);
  assert.deepEqual(await parseDocument(new File(['{"name":"阑珊处"}'], "资料.json")), { content: '{"name":"阑珊处"}' });
});

test("DOCX 压缩条目校验发现正文损坏", async () => {
  const zip = new JSZip();
  zip.file("word/document.xml", "<document>original text</document>");
  const good = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
  await validateDocx(good.buffer.slice(good.byteOffset, good.byteOffset + good.byteLength) as ArrayBuffer);
  const bad = good.slice();
  const at = new TextDecoder().decode(bad).indexOf("original text");
  assert.ok(at > 0);
  bad[at] = "X".charCodeAt(0);
  await assert.rejects(validateDocx(bad.buffer.slice(bad.byteOffset, bad.byteOffset + bad.byteLength) as ArrayBuffer), /CRC32 mismatch/);
});

test("PDF 逐字中文文本项合并后可按连续词检索", () => {
  assert.equal(pdfPageText([{ str: "中" }, { str: "文" }, { str: "检" }, { str: "索", hasEOL: true }, { str: "由" }, { str: "谁" }]), "中文检索\n由谁");
  assert.equal(pdfPageText([{ str: "Orion" }, { str: "Relay" }]), "Orion Relay");
});
