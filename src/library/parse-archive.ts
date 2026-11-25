import type { LocalDocument } from "./db.ts";
import { BoundedZipReader } from "./zip-reader.ts";

type ParsedArchive = Pick<LocalDocument, "content" | "pages">;

function parseXml(value: string, name: string): Document {
  if (/<!DOCTYPE\b/iu.test(value)) throw new Error(`${name}：文档包含不支持的外部实体声明`);
  const document = new DOMParser().parseFromString(value, "application/xml");
  if (document.getElementsByTagName("parsererror").length) throw new Error(`${name}：文档结构无法读取`);
  return document;
}

function descendants(parent: Document | Element, localName: string): Element[] {
  return Array.from(parent.getElementsByTagNameNS("*", localName));
}

function zipPath(base: string, target: string): string {
  if (/^[a-z][a-z\d+.-]*:/iu.test(target) || target.startsWith("//")) throw new Error("文档引用了外部资源");
  const clean = decodeURIComponent(target.split(/[?#]/u, 1)[0]);
  const parts = target.startsWith("/") ? [] : base.split("/").slice(0, -1);
  for (const part of clean.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new Error("文档路径超出压缩包");
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

async function entry(zip: BoundedZipReader, path: string, name: string): Promise<string> {
  try { return await zip.read(path); }
  catch (error) { throw new Error(`${name}：${error instanceof Error ? error.message : "压缩条目无法读取"}`); }
}

function htmlText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? "";
  if (node.nodeType !== 1) return "";
  const name = (node as Element).localName.toLowerCase();
  if (["script", "style", "noscript", "nav", "template"].includes(name)) return "";
  if (name === "br") return "\n";
  const text = Array.from(node.childNodes).map(htmlText).join("");
  return ["p", "div", "section", "article", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote"].includes(name)
    ? `${text.trim()}\n`
    : text;
}

function openDocumentText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? "";
  if (node.nodeType !== 1) return "";
  const element = node as Element;
  if (element.localName === "s") {
    const count = Number(element.getAttribute("text:c") ?? 1);
    if (!Number.isInteger(count) || count < 1 || count > 1_000) throw new Error("文档空格标记超出上限");
    return " ".repeat(count);
  }
  if (element.localName === "tab") return "\t";
  if (element.localName === "line-break") return "\n";
  return Array.from(node.childNodes).map(openDocumentText).join("");
}

function joinParts(parts: string[], name: string): string {
  const content = parts.filter(Boolean).join("\n\n").trim();
  if (!content) throw new Error(`${name}：没有可提取的文字`);
  if (new TextEncoder().encode(content).length > 2 * 1024 * 1024) throw new Error(`${name}：提取的文字不能超过 2 MB`);
  return content;
}

async function readPresentation(zip: BoundedZipReader, name: string): Promise<ParsedArchive> {
  const presentation = parseXml(await entry(zip, "ppt/presentation.xml", name), name);
  const relationships = parseXml(await entry(zip, "ppt/_rels/presentation.xml.rels", name), name);
  const paths = new Map(descendants(relationships, "Relationship").map((item) => [item.getAttribute("Id"), item.getAttribute("Target")]));
  const pieces: string[] = [];
  const pages: NonNullable<LocalDocument["pages"]> = [];
  let length = 0;
  let slideNumber = 0;
  for (const slide of descendants(presentation, "sldId")) {
    slideNumber++;
    const id = slide.getAttribute("r:id");
    const target = paths.get(id);
    if (!target) throw new Error(`${name}：演示文稿缺少幻灯片引用`);
    const path = zipPath("ppt/presentation.xml", target);
    const document = parseXml(await entry(zip, path, name), name);
    const text = descendants(document, "p")
      .map((paragraph) => descendants(paragraph, "t").map((run) => run.textContent ?? "").join("").trim())
      .filter(Boolean).join("\n");
    if (!text) continue;
    if (pieces.length) length += 2;
    const start = length;
    pieces.push(text);
    length += text.length;
    if (length > 2 * 1024 * 1024) throw new Error(`${name}：提取的文字不能超过 2 MB`);
    pages.push({ number: slideNumber, start, end: length });
  }
  return { content: joinParts(pieces, name), pages };
}

async function readOpenDocument(zip: BoundedZipReader, name: string): Promise<ParsedArchive> {
  const document = parseXml(await entry(zip, "content.xml", name), name);
  const paragraphs = Array.from(document.getElementsByTagName("*"))
    .filter((element) => element.localName === "p" || element.localName === "h")
    .map((element) => openDocumentText(element).trim())
    .filter(Boolean);
  return { content: joinParts(paragraphs, name) };
}

async function readEpub(zip: BoundedZipReader, name: string): Promise<ParsedArchive> {
  const container = parseXml(await entry(zip, "META-INF/container.xml", name), name);
  const packagePath = descendants(container, "rootfile")[0]?.getAttribute("full-path");
  if (!packagePath) throw new Error(`${name}：电子书缺少目录`);
  const packageFile = parseXml(await entry(zip, zipPath("", packagePath), name), name);
  const manifest = new Map(descendants(packageFile, "item").map((item) => [item.getAttribute("id"), item]));
  const pieces: string[] = [];
  const pages: NonNullable<LocalDocument["pages"]> = [];
  let length = 0;
  let position = 0;
  for (const reference of descendants(packageFile, "itemref")) {
    if (reference.getAttribute("linear") === "no") continue;
    position++;
    const item = manifest.get(reference.getAttribute("idref"));
    if (!item || !["application/xhtml+xml", "text/html"].includes(item.getAttribute("media-type") ?? "")) continue;
    const href = item.getAttribute("href");
    if (!href) continue;
    const path = zipPath(packagePath, href);
    const chapter = parseXml(await entry(zip, path, name), name);
    const body = descendants(chapter, "body")[0];
    const text = htmlText(body ?? chapter.documentElement).replace(/[ \t]+\n/gu, "\n").trim();
    if (!text) continue;
    if (pieces.length) length += 2;
    const start = length;
    pieces.push(text);
    length += text.length;
    if (length > 2 * 1024 * 1024) throw new Error(`${name}：提取的文字不能超过 2 MB`);
    pages.push({ number: position, start, end: length });
  }
  return { content: joinParts(pieces, name), pages };
}

export async function parseArchive(file: File, extension: "pptx" | "odt" | "epub"): Promise<ParsedArchive> {
  const zip = await BoundedZipReader.open(new Uint8Array(await file.arrayBuffer()));
  if (extension === "pptx") return readPresentation(zip, file.name);
  if (extension === "odt") return readOpenDocument(zip, file.name);
  return readEpub(zip, file.name);
}
