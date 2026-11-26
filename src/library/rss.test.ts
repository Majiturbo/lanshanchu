import assert from "node:assert/strict";
import { test } from "node:test";
import { DOMParser } from "linkedom";
import { parseFeed } from "./rss-parse.ts";

const previous = globalThis.DOMParser;
globalThis.DOMParser = DOMParser as typeof globalThis.DOMParser;

test.after(() => { globalThis.DOMParser = previous; });

test("RSS keeps article body and source link, skips private links", () => {
  const feed = parseFeed(`<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>示例订阅</title>
    <item><title>文章一</title><link>https://example.com/one</link><description>简短摘要</description><content:encoded><![CDATA[<p>正文内容 <b>可检索</b></p>]]></content:encoded></item>
    <item><title>内网</title><link>http://127.0.0.1/private</link><description>不应入库</description></item>
  </channel></rss>`, "https://example.com/feed.xml");
  assert.equal(feed.title, "示例订阅");
  assert.deepEqual(feed.entries, [{ title: "文章一", url: "https://example.com/one", content: "正文内容 可检索", isSummary: false }]);
});

test("Atom summary is marked as summary, not article body", () => {
  const feed = parseFeed(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Updates</title>
    <entry><title>News</title><link rel="alternate" href="/news"/><summary type="html">Short summary</summary></entry>
  </feed>`, "https://example.com/atom.xml");
  assert.deepEqual(feed.entries, [{ title: "News", url: "https://example.com/news", content: "订阅源摘要（非文章全文）：Short summary", isSummary: true }]);
});

test("rejects HTML masquerading as a feed", () => {
  assert.throws(() => parseFeed("<html><body>Not a feed</body></html>", "https://example.com/feed"), /不是有效/);
});
