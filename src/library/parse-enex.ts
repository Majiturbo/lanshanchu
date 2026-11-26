import type { ParsedDocument } from "./parse.ts";

const ENML_DOCTYPE = /<!DOCTYPE\s+en-note\s+SYSTEM\s+["']https?:\/\/xml\.evernote\.com\/pub\/enml2\.dtd["']\s*>/iu;
const BLOCKS = new Set(["div", "p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "tr"]);

function hasOuterDoctype(raw: string): boolean {
  for (let position = 0; position < raw.length;) {
    const comment = raw.startsWith("<!--", position);
    const cdata = raw.startsWith("<![CDATA[", position);
    const instruction = raw.startsWith("<?", position);
    const close = comment ? "-->" : cdata ? "]]>" : instruction ? "?>" : "";
    if (close) {
      const end = raw.indexOf(close, position + (comment ? 4 : cdata ? 9 : 2));
      if (end < 0) return true;
      position = end + close.length;
    } else if (raw.slice(position, position + 9).toUpperCase() === "<!DOCTYPE") {
      return true;
    } else {
      position++;
    }
  }
  return false;
}

function xml(raw: string, name: string): Document {
  const document = new DOMParser().parseFromString(raw, "application/xml");
  if (document.getElementsByTagName("parsererror").length || !document.documentElement) throw new Error(`${name}：笔记结构无法读取`);
  return document;
}

function noteText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? "";
  if (node.nodeType !== 1) return "";
  const name = (node as Element).localName.toLowerCase();
  if (name === "en-media" || name === "script" || name === "style") return "";
  if (name === "br") return "\n";
  const text = Array.from(node.childNodes).map(noteText).join("");
  return BLOCKS.has(name) ? `${text.trim()}\n` : text;
}

export function parseEnex(raw: string, name: string): ParsedDocument {
  if (hasOuterDoctype(raw)) {
    throw new Error(`${name}：导出文件包含不支持的外部实体声明`);
  }
  const exportFile = xml(raw, name);
  if (exportFile.documentElement.localName !== "en-export") throw new Error(`${name}：不是 Evernote 笔记导出文件`);
  const notes = Array.from(exportFile.documentElement.childNodes)
    .filter((node): node is Element => node.nodeType === 1 && (node as Element).localName === "note");
  if (!notes.length) throw new Error(`${name}：导出文件没有笔记`);

  const parts: string[] = [];
  const pages: NonNullable<ParsedDocument["pages"]> = [];
  let length = 0;
  let bytes = 0;
  for (const [index, note] of notes.entries()) {
    const title = note.getElementsByTagName("title")[0]?.textContent?.trim() || `未命名笔记 ${index + 1}`;
    const enml = note.getElementsByTagName("content")[0]?.textContent?.trim();
    if (!enml) continue;
    const withoutDeclaration = enml.replace(/^<\?xml\s+[^?]*\?>\s*/iu, "").replace(ENML_DOCTYPE, "").trim();
    if (/<!DOCTYPE\b/iu.test(withoutDeclaration)) throw new Error(`${name}：${title} 包含不支持的外部实体声明`);
    const body = xml(withoutDeclaration, name);
    if (body.documentElement.localName !== "en-note") throw new Error(`${name}：${title} 的正文格式无法读取`);
    const content = noteText(body.documentElement).replace(/\n{3,}/gu, "\n\n").trim();
    if (!content) continue;
    const text = `${title}\n${content}`;
    bytes += new TextEncoder().encode(text).length + (parts.length ? 2 : 0);
    if (bytes > 2 * 1024 * 1024) throw new Error(`${name}：提取的文字不能超过 2 MB`);
    if (parts.length) length += 2;
    const start = length;
    parts.push(text);
    length += text.length;
    pages.push({ number: index + 1, start, end: length, label: title });
  }
  if (!pages.length) throw new Error(`${name}：笔记没有可提取的文字；图片和附件暂不支持`);
  return { content: parts.join("\n\n"), pages };
}
