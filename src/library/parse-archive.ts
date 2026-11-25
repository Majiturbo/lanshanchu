import type { LocalDocument } from "./db.ts";
import { BoundedZipReader } from "./zip-reader.ts";

type ParsedArchive = Pick<LocalDocument, "content" | "pages">;
const SPREADSHEET_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const ODF_TABLE_NS = "urn:oasis:names:tc:opendocument:xmlns:table:1.0";
const ODF_OFFICE_NS = "urn:oasis:names:tc:opendocument:xmlns:office:1.0";

function parseXml(value: string, name: string): Document {
  if (/<!DOCTYPE\b/iu.test(value)) throw new Error(`${name}：文档包含不支持的外部实体声明`);
  const document = new DOMParser().parseFromString(value, "application/xml");
  if (document.getElementsByTagName("parsererror").length) throw new Error(`${name}：文档结构无法读取`);
  return document;
}

function descendants(parent: Document | Element, localName: string): Element[] {
  return Array.from(parent.getElementsByTagNameNS("*", localName));
}

function attribute(element: Element, localName: string, namespace: string | null = null): string | null {
  return element.getAttributeNS(namespace, localName);
}

function columnName(index: number): string {
  let result = "";
  for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + (value - 1) % 26) + result;
  return result;
}

function richText(element: Element): string {
  return Array.from(element.childNodes).filter((node): node is Element => node.nodeType === 1)
    .flatMap((node) => node.localName === "t" ? [node.textContent ?? ""]
      : node.localName === "r" ? descendants(node, "t").map((run) => run.textContent ?? "") : []).join("");
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

function sheetResult(sheets: { name: string; rows: string[] }[], name: string): ParsedArchive {
  const parts: string[] = [];
  const pages: NonNullable<LocalDocument["pages"]> = [];
  let length = 0;
  for (const [index, sheet] of sheets.entries()) {
    if (!sheet.rows.length) continue;
    if (parts.length) length += 2;
    const start = length;
    const text = `工作表：${sheet.name}\n${sheet.rows.join("\n")}`;
    parts.push(text);
    length += text.length;
    if (length > 2 * 1024 * 1024) throw new Error(`${name}：提取的文字不能超过 2 MB`);
    pages.push({ number: index + 1, start, end: length, label: sheet.name });
  }
  return { content: joinParts(parts, name), pages };
}

async function readXlsx(zip: BoundedZipReader, name: string): Promise<ParsedArchive> {
  const workbookPath = "xl/workbook.xml";
  const workbook = parseXml(await entry(zip, workbookPath, name), name);
  const relations = parseXml(await entry(zip, "xl/_rels/workbook.xml.rels", name), name);
  const paths = new Map(descendants(relations, "Relationship").map((relation) => [attribute(relation, "Id"), attribute(relation, "Target")]));
  const sharedPath = descendants(relations, "Relationship")
    .find((relation) => /\/sharedStrings$/u.test(attribute(relation, "Type") ?? ""));
  const sharedStrings = sharedPath
    ? descendants(parseXml(await entry(zip, zipPath(workbookPath, attribute(sharedPath, "Target") ?? ""), name), name), "si")
      .map(richText)
    : [];
  const sheets: { name: string; rows: string[] }[] = [];
  let extracted = 0;
  for (const [index, sheet] of descendants(workbook, "sheet").entries()) {
    const target = paths.get(attribute(sheet, "id", SPREADSHEET_REL_NS));
    if (!target) throw new Error(`${name}：工作簿缺少工作表引用`);
    const path = zipPath(workbookPath, target);
    const worksheet = parseXml(await entry(zip, path, name), name);
    const rows: string[] = [];
    for (const [rowIndex, row] of descendants(worksheet, "row").entries()) {
      const cells: string[] = [];
      for (const [cellIndex, cell] of descendants(row, "c").entries()) {
        const type = attribute(cell, "t");
        if (type === "e") continue;
        const reference = attribute(cell, "r") ?? `${columnName(cellIndex + 1)}${attribute(row, "r") ?? rowIndex + 1}`;
        const raw = descendants(cell, "v")[0]?.textContent ?? "";
        let value = type === "inlineStr"
          ? descendants(cell, "is").map(richText).join("")
          : raw;
        if (type === "s") {
          if (!raw.trim()) continue;
          const offset = Number(raw);
          if (!Number.isInteger(offset) || offset < 0 || offset >= sharedStrings.length) throw new Error(`${name}：共享文字索引无效`);
          value = sharedStrings[offset];
        } else if (type === "b") {
          if (!raw.trim()) continue;
          if (raw !== "0" && raw !== "1") throw new Error(`${name}：布尔单元格值无效`);
          value = raw === "1" ? "TRUE" : "FALSE";
        }
        if (value.trim()) cells.push(`${reference}: ${value.trim()}`);
      }
      if (cells.length) {
        const line = cells.join(" | ");
        extracted += line.length;
        if (extracted > 2 * 1024 * 1024) throw new Error(`${name}：提取的文字不能超过 2 MB`);
        rows.push(line);
      }
    }
    sheets.push({ name: attribute(sheet, "name") ?? `工作表 ${index + 1}`, rows });
  }
  return sheetResult(sheets, name);
}

function repeatCount(element: Element, attributeName: string): number {
  const raw = attribute(element, attributeName, ODF_TABLE_NS);
  const count = raw === null ? 1 : Number(raw);
  if (!Number.isInteger(count) || count < 1 || count > 1_048_576) throw new Error("表格重复行列数无效");
  return count;
}

async function readOds(zip: BoundedZipReader, name: string): Promise<ParsedArchive> {
  const document = parseXml(await entry(zip, "content.xml", name), name);
  const sheets: { name: string; rows: string[] }[] = [];
  let extracted = 0;
  for (const [index, table] of descendants(document, "table").entries()) {
    const rows: string[] = [];
    let rowNumber = 1;
    for (const row of descendants(table, "table-row")) {
      const cells: string[] = [];
      let rowLength = 0;
      let column = 1;
      for (const cell of Array.from(row.childNodes).filter((item): item is Element => item.nodeType === 1)
        .filter((item) => item.localName === "table-cell" || item.localName === "covered-table-cell")) {
        const count = repeatCount(cell, "number-columns-repeated");
        const paragraphs = descendants(cell, "p").map((item) => openDocumentText(item).trim()).filter(Boolean);
        const value = paragraphs.join(" ") || attribute(cell, "string-value", ODF_OFFICE_NS) || attribute(cell, "date-value", ODF_OFFICE_NS)
          || attribute(cell, "time-value", ODF_OFFICE_NS) || attribute(cell, "boolean-value", ODF_OFFICE_NS)
          || attribute(cell, "value", ODF_OFFICE_NS) || "";
        if (value && cell.localName === "table-cell") {
          if (count > 1_000) throw new Error(`${name}：重复内容超过读取上限`);
          for (let offset = 0; offset < count; offset++) {
            const reference = `${columnName(column + offset)}${rowNumber}`;
            rowLength += reference.length + 2 + value.length + (cells.length ? 3 : 0);
            if (rowLength > 2 * 1024 * 1024) throw new Error(`${name}：提取的文字不能超过 2 MB`);
            cells.push(`${reference}: ${value}`);
          }
        }
        column += count;
      }
      const repeated = repeatCount(row, "number-rows-repeated");
      if (cells.length) {
        if (repeated > 1_000) throw new Error(`${name}：重复内容超过读取上限`);
        const line = cells.join(" | ");
        extracted += line.length * repeated;
        if (extracted > 2 * 1024 * 1024) throw new Error(`${name}：提取的文字不能超过 2 MB`);
        for (let offset = 0; offset < repeated; offset++) {
          rows.push(offset === 0 ? line : cells.map((item) => item.replace(/\d+:/u, `${rowNumber + offset}:`)).join(" | "));
        }
      }
      rowNumber += repeated;
    }
    sheets.push({ name: attribute(table, "name", ODF_TABLE_NS) ?? `工作表 ${index + 1}`, rows });
  }
  return sheetResult(sheets, name);
}

export async function parseArchive(file: File, extension: "pptx" | "odt" | "epub" | "xlsx" | "ods"): Promise<ParsedArchive> {
  const zip = await BoundedZipReader.open(new Uint8Array(await file.arrayBuffer()));
  if (extension === "pptx") return readPresentation(zip, file.name);
  if (extension === "odt") return readOpenDocument(zip, file.name);
  if (extension === "epub") return readEpub(zip, file.name);
  if (extension === "xlsx") return readXlsx(zip, file.name);
  return readOds(zip, file.name);
}
