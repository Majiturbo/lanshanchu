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

test("XLSX 按工作簿顺序读取共享文字、行列位置和缓存值", async () => {
  const file = await archive("台账.xlsx", {
    "xl/workbook.xml": '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:z="urn:wrong"><sheets><sheet name="汇总" z:id="r1" r:id="r2"/><sheet name="明细" r:id="r1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="r3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>',
    "xl/sharedStrings.xml": '<sst><si><t>项目</t></si><si><r><t>蓝色</t></r><r><t>灯笼</t></r><rPh><t>lan se deng long</t></rPh></si></sst>',
    "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="3"><c r="C3" t="inlineStr"><is><t>负责人小林</t><rPh><t>注音</t></rPh></is></c><c r="D3"><f>A1+B1</f><v>42</v></c><c r="E3"><f>尚未计算</f></c><c r="F3" t="s"><f>没有缓存</f></c><c r="G3" t="b"><f>没有缓存</f></c><c r="H3" t="b"><v>0</v></c></row></sheetData></worksheet>',
    "xl/worksheets/sheet2.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row></sheetData></worksheet>',
  });
  const result = await parseDocument(file);
  assert.equal(result.content, "工作表：汇总\nA1: 项目 | B1: 蓝色灯笼\n\n工作表：明细\nC3: 负责人小林 | D3: 42 | H3: FALSE");
  const secondStart = result.content.indexOf("工作表：明细");
  assert.deepEqual(result.pages, [{ number: 1, start: 0, end: secondStart - 2, label: "汇总" }, { number: 2, start: secondStart, end: result.content.length, label: "明细" }]);
});

test("ODS 读取命名工作表、重复空行列和显示文字", async () => {
  const file = await archive("统计.ods", {
    "content.xml": '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:z="urn:wrong"><office:body><office:spreadsheet><table:table table:name="数据"><table:table-row z:number-rows-repeated="3" table:number-rows-repeated="2"><table:table-cell table:number-columns-repeated="2"/><table:table-cell office:value-type="string"><text:p>蓝色灯笼</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="12.5"/></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>',
  });
  const result = await parseDocument(file);
  assert.equal(result.content, "工作表：数据\nC1: 蓝色灯笼 | D1: 12.5\nC2: 蓝色灯笼 | D2: 12.5");
  assert.deepEqual(result.pages, [{ number: 1, start: 0, end: result.content.length, label: "数据" }]);
});

test("新格式只有真实可读时才声明支持，压缩包缺失正文会失败", async () => {
  for (const extension of ["pptx", "odt", "epub", "xlsx", "ods"]) assert.equal(supportsDocumentName(`资料.${extension}`), true);
  await assert.rejects(parseDocument(await archive("损坏.pptx", {})), /缺少 ppt\/presentation.xml/);
});

test("压缩比很高的文档在解压阶段被限额拦截", async () => {
  const zip = new JSZip();
  zip.file("content.xml", `<root>${"a".repeat(4 * 1024 * 1024 + 1)}</root>`);
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  assert.ok(bytes.length < 10 * 1024 * 1024);
  await assert.rejects(parseDocument(new File([new Uint8Array(bytes)], "过大.odt")), /展开后超过读取上限/);
});

test("ODS 重复单元格在展开前检查提取上限", async () => {
  const file = await archive("重复.ods", {
    "content.xml": `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:spreadsheet><table:table><table:table-row><table:table-cell table:number-columns-repeated="1000"><text:p>${"资料".repeat(1500)}</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>`,
  });
  await assert.rejects(parseDocument(file), /提取的文字不能超过 2 MB/);
});

test("ODS 可导入实际低于上限的重复单元格", async () => {
  const file = await archive("边界.ods", {
    "content.xml": `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:spreadsheet><table:table><table:table-row><table:table-cell table:number-columns-repeated="1000"><text:p>${"A".repeat(2080)}</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>`,
  });
  const result = await parseDocument(file);
  assert.ok(result.content.length < 2 * 1024 * 1024);
  assert.match(result.content, /ALL1: AAAAA/u);
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
