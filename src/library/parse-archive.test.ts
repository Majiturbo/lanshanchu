import assert from "node:assert/strict";
import test from "node:test";
import { DOMParser } from "@xmldom/xmldom";
import JSZip from "jszip";
import { parseDocument, supportsDocumentName } from "./parse.ts";

Object.defineProperty(globalThis, "DOMParser", { value: DOMParser, configurable: true });

async function archive(name: string, files: Record<string, string>): Promise<File> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  const bytes = await zip.generateAsync({ type: "uint8array" });
  return new File([new Uint8Array(bytes)], name);
}

test("PPTX 按演示顺序读取幻灯片文字，并保留原幻灯片编号", async () => {
  const file = await archive("讲义.pptx", {
    "ppt/presentation.xml": '<p:presentation xmlns:p="urn:p" xmlns:r="urn:r"><p:sldIdLst><p:sldId r:id="r2"/><p:sldId r:id="r1"/></p:sldIdLst></p:presentation>',
    "ppt/_rels/presentation.xml.rels": '<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/><Relationship Id="r2" Target="slides/slide2.xml"/></Relationships>',
    "ppt/slides/slide1.xml": '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:p><a:r><a:t>最后一张</a:t></a:r></a:p></p:sld>',
    "ppt/slides/slide2.xml": '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:p><a:r><a:t>先看结论</a:t></a:r></a:p></p:sld>',
  });
  assert.deepEqual(await parseDocument(file), {
    content: "先看结论\n\n最后一张",
    pages: [{ number: 1, start: 0, end: 4 }, { number: 2, start: 6, end: 10 }],
  });
});

test("ODT 提取正文段落和表格里的文字", async () => {
  const file = await archive("记录.odt", {
    "content.xml": '<office:document-content xmlns:office="urn:office" xmlns:text="urn:text" xmlns:table="urn:table"><office:body><office:text><text:h>会议纪要</text:h><text:p>决定采用蓝色灯笼。</text:p><table:table><table:table-row><table:table-cell><text:p>负责人：小林</text:p></table:table-cell></table:table-row></table:table></office:text></office:body></office:document-content>',
  });
  assert.deepEqual(await parseDocument(file), { content: "会议纪要\n\n决定采用蓝色灯笼。\n\n负责人：小林" });
});

test("ODT 的空格、制表和换行标记保留词边界", async () => {
  const file = await archive("排版.odt", {
    "content.xml": '<office:document-content xmlns:office="urn:office" xmlns:text="urn:text"><office:body><office:text><text:p>Alpha<text:s text:c="2"/>Beta<text:tab/>Gamma<text:line-break/>Delta</text:p></office:text></office:body></office:document-content>',
  });
  assert.deepEqual(await parseDocument(file), { content: "Alpha  Beta\tGamma\nDelta" });
});

test("EPUB 按 spine 顺序读取章节，不索引脚本和导航", async () => {
  const file = await archive("读物.epub", {
    "META-INF/container.xml": '<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>',
    "OEBPS/book.opf": '<package><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>',
    "OEBPS/a.xhtml": '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>后记</h1><p>灯光渐远。</p></body></html>',
    "OEBPS/b.xhtml": '<html xmlns="http://www.w3.org/1999/xhtml"><body><nav>目录</nav><h1>开篇</h1><p>蓝色灯笼。</p><script>hidden()</script></body></html>',
  });
  const result = await parseDocument(file);
  assert.equal(result.content, "开篇\n蓝色灯笼。\n\n后记\n灯光渐远。");
  assert.deepEqual(result.pages, [{ number: 1, start: 0, end: 8 }, { number: 2, start: 10, end: 18 }]);
});

test("EPUB 图片章节后仍保留原阅读顺序编号", async () => {
  const file = await archive("图文.epub", {
    "META-INF/container.xml": '<container><rootfile full-path="book.opf"/></container>',
    "book.opf": '<package><manifest><item id="a" href="image.xhtml" media-type="application/xhtml+xml"/><item id="b" href="text.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>',
    "image.xhtml": '<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="cover.png"/></body></html>',
    "text.xhtml": '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>正文</p></body></html>',
  });
  assert.deepEqual((await parseDocument(file)).pages, [{ number: 2, start: 0, end: 2 }]);
});

test("新格式只有真实可读时才声明支持，压缩包缺失正文会失败", async () => {
  for (const extension of ["pptx", "odt", "epub"]) assert.equal(supportsDocumentName(`资料.${extension}`), true);
  assert.equal(supportsDocumentName("资料.xlsx"), false);
  await assert.rejects(parseDocument(await archive("损坏.pptx", {})), /缺少 ppt\/presentation.xml/);
});

test("压缩比很高的文档在解压阶段被限额拦截", async () => {
  const zip = new JSZip();
  zip.file("content.xml", `<root>${"a".repeat(4 * 1024 * 1024 + 1)}</root>`);
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  assert.ok(bytes.length < 10 * 1024 * 1024);
  await assert.rejects(parseDocument(new File([new Uint8Array(bytes)], "过大.odt")), /展开后超过读取上限/);
});

test("压缩条目被改动时拒绝把损坏文字加入知识库", async () => {
  const zip = new JSZip();
  zip.file("content.xml", '<office:document-content xmlns:office="urn:office" xmlns:text="urn:text"><office:body><office:text><text:p>原始内容</text:p></office:text></office:body></office:document-content>');
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
  const damaged = bytes.slice();
  const offset = new TextDecoder().decode(damaged).indexOf("原始内容");
  assert.ok(offset > 0);
  damaged[offset] = "X".charCodeAt(0);
  await assert.rejects(parseDocument(new File([new Uint8Array(damaged)], "损坏.odt")), /压缩条目损坏/);
});
