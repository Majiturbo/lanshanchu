import assert from "node:assert/strict";
import { test } from "node:test";
import { DOMParser as LinkedomDOMParser } from "linkedom";
import { createPageReader, isPublicUrl, MAX_PAGE_CHARS, sniffCharset, tidyText } from "./web.ts";

test("只允许公网 http/https：本机、内网、链路本地与非网页协议一律拒绝", () => {
  for (const ok of ["https://www.gmw.cn/a.html", "http://news.qq.com/x?y=1", "https://8.8.8.8/", "https://172.32.0.1/"]) assert.equal(isPublicUrl(ok), true, ok);
  for (const bad of [
    "http://localhost:5173/", "http://127.0.0.1/", "http://10.1.2.3/", "http://192.168.1.1/", "http://172.16.0.1/", "http://172.31.255.1/",
    "http://169.254.169.254/latest/meta-data", "http://100.64.0.1/", "http://0.0.0.0/", "http://[::1]/", "http://[fd00::1]/", "http://[fe80::1]/",
    "http://printer.local/", "http://intranet/", "file:///C:/Windows/win.ini", "ftp://a.com/", "https://user:pw@a.com/", "不是网址",
  ]) assert.equal(isPublicUrl(bad), false, bad);
});

test("网页编码：响应头优先，其次 meta；GBK / GB2312 按 GB18030 解码", () => {
  assert.equal(sniffCharset("text/html; charset=GBK", ""), "gb18030");
  assert.equal(sniffCharset("text/html", '<meta charset="gb2312">'), "gb18030");
  assert.equal(sniffCharset(null, '<meta http-equiv="Content-Type" content="text/html; charset=big5">'), "big5");
  assert.equal(sniffCharset("text/html", "<html>"), "utf-8");
});

test("正文整理：合并空白、保留段落、超长截断", () => {
  assert.equal(tidyText("  第一段\n  续行 \n\n\n 第二段\t结尾  "), "第一段 续行\n第二段 结尾");
  const long = tidyText("字".repeat(MAX_PAGE_CHARS + 50));
  assert.equal(long.length, MAX_PAGE_CHARS + 1);
  assert.ok(long.endsWith("…"));
});

test("手动剪藏保留重定向后的地址和长正文，超限时拒绝保存", async () => {
  const body = "海棠计划的资料。".repeat(1200);
  const seen: string[] = [];
  const reader = createPageReader(async (url) => {
    seen.push(url);
    return url.endsWith("/old")
      ? new Response(null, { status: 302, headers: { location: "/article" } })
      : new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
  }, { maxChars: 20_000, truncate: false });
  const page = await reader.read("https://example.com/old");
  assert.deepEqual(seen, ["https://example.com/old", "https://example.com/article"]);
  assert.equal(page.url, "https://example.com/article");
  assert.equal(page.text, body);
  await assert.rejects(createPageReader(async () => new Response(body, { headers: { "content-type": "text/plain" } }), { maxChars: 100, truncate: false }).read("https://example.com/"), /超过剪藏容量/);
});

test("HTML 剪藏排除附录且保留含嵌套参见标题的正文", async () => {
  const originalParser = globalThis.DOMParser;
  globalThis.DOMParser = LinkedomDOMParser as unknown as typeof DOMParser;
  try {
    const main = "海棠计划的蓝色灯笼用于展示知识图谱的实体关系。".repeat(12);
    const html = `<html><head><title>海棠计划</title></head><body><article>
      <section aria-labelledby="main"><h1 id="main">海棠计划</h1><p>${main}</p>
        <section><h2>参见</h2><p>辅助链接标记：云雀。</p></section>
      </section>
      <section><h2>参考资料 [编辑]</h2><ol><li>附录标记：纸鹤。</li></ol></section>
      <section aria-labelledby="refs"><div class="mw-heading"><h2 id="refs">References:</h2></div><p>附录标记：松柏。</p></section>
      <section><p>章节前置正文标记：玉兰。</p><h2>参考资料</h2><ol><li>附录标记：白鹤。</li></ol></section>
      <h2>External links</h2><ul><li>附录标记：青鸾。</li></ul>
      <div class="mw-heading"><h2>See also</h2></div><ul><li>附录标记：金雀。</li></ul>
      <h2>继续阅读</h2><p>主体延续标记：桔梗。</p>
    </article></body></html>`;
    const page = await createPageReader(async () => new Response(html, { headers: { "content-type": "text/html" } }),
      { maxChars: 200_000, truncate: false, requireArticle: true }).read("https://example.com/article");
    assert.match(page.text, /蓝色灯笼/);
    assert.match(page.text, /桔梗/);
    assert.match(page.text, /玉兰/);
    assert.doesNotMatch(page.text, /纸鹤|松柏|白鹤|青鸾|金雀/);
  } finally {
    if (originalParser) globalThis.DOMParser = originalParser;
    else Reflect.deleteProperty(globalThis, "DOMParser");
  }
});
