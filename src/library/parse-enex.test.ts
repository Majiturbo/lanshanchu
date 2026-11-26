import assert from "node:assert/strict";
import test from "node:test";
import { DOMParser } from "@xmldom/xmldom";
import { buildIndex, rankIndexes } from "./index.ts";
import { parseDocument, supportsDocumentName } from "./parse.ts";
import { sourcesForMatches } from "./search.ts";

Object.defineProperty(globalThis, "DOMParser", { value: DOMParser, configurable: true });

const exportFile = `<?xml version="1.0" encoding="UTF-8"?>
<en-export export-date="20261126T000000Z" application="Evernote">
  <note><title>会议纪要</title><content><![CDATA[<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
<en-note><div>决定采用蓝色灯笼。</div><div>负责人小林。<br/>下周检查。</div></en-note>]]></content></note>
  <note><title>项目计划</title><content><![CDATA[<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
<en-note><div>青玉案项目计划。</div><en-media type="image/png" hash="abc"/></en-note>]]></content></note>
</en-export>`;

test("Evernote 导出按笔记保留文字和标题定位，检索只引用命中的笔记", async () => {
  assert.equal(supportsDocumentName("笔记.enex"), true);
  const parsed = await parseDocument(new File([exportFile], "笔记.enex"));
  assert.equal(parsed.content, "会议纪要\n决定采用蓝色灯笼。\n负责人小林。\n下周检查。\n\n项目计划\n青玉案项目计划。");
  assert.deepEqual(parsed.pages?.map((page) => page.label), ["会议纪要", "项目计划"]);
  const doc = { id: "notes", name: "笔记.enex", sourceId: "manual-files", importedAt: 1, ...parsed };
  const matches = rankIndexes(buildIndex(doc), "青玉案项目计划");
  assert.match(sourcesForMatches(matches, [doc])[0].title, /项目计划/);
});

test("ENEX 拒绝外部实体和无文字导出", async () => {
  await assert.rejects(parseDocument(new File([`<!DOCTYPE en-export SYSTEM "https://example.com/export.dtd">${exportFile}`], "危险.enex")), /外部实体/);
  await assert.rejects(parseDocument(new File([`<!-- <en-export -->\n<!DOCTYPE en-export SYSTEM "https://example.com/export.dtd">${exportFile}`], "危险.enex")), /外部实体/);
  await assert.rejects(parseDocument(new File([`<!-- <![CDATA[ --><!-- ]]> --><!DOCTYPE en-export SYSTEM "https://example.com/export.dtd">${exportFile}`], "危险.enex")), /外部实体/);
  const suspicious = exportFile.replace("http://xml.evernote.com/pub/enml2.dtd", "https://example.com/untrusted.dtd");
  await assert.rejects(parseDocument(new File([suspicious], "危险.enex")), /外部实体/);
  const imagesOnly = '<en-export><note><title>图片</title><content><![CDATA[<en-note><en-media type="image/png" hash="abc"/></en-note>]]></content></note></en-export>';
  await assert.rejects(parseDocument(new File([imagesOnly], "图片.enex")), /没有可提取的文字/);
});

test("ENEX 提取文字按 UTF-8 字节限额，篇数不另设低于文件限额的限制", async () => {
  const many = `<en-export>${'<note><title>笔记</title><content><![CDATA[<en-note>正文</en-note>]]></content></note>'.repeat(501)}</en-export>`;
  assert.equal((await parseDocument(new File([many], "多篇.enex"))).pages?.length, 501);
  const large = `<en-export><note><title>长文</title><content><![CDATA[<en-note>${"汉".repeat(800_000)}</en-note>]]></content></note></en-export>`;
  await assert.rejects(parseDocument(new File([large], "超限.enex")), /提取的文字不能超过 2 MB/);
});
