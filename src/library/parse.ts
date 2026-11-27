import type { LocalDocument } from "./db.ts";

export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

export const SUPPORTED_DOCUMENT_EXTENSIONS = [
  "txt", "text", "md", "markdown",
  "html", "htm", "xhtml",
  "csv", "tsv", "json", "jsonl", "yaml", "yml", "xml",
  "pdf", "docx", "pptx", "odt", "epub", "xlsx", "ods",
  "enex",
  "png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff",
] as const;

const PLAIN_TEXT_EXTENSIONS = new Set(["txt", "text", "md", "markdown", "csv", "tsv", "json", "jsonl", "yaml", "yml"]);
const HTML_EXTENSIONS = new Set(["html", "htm", "xhtml"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "bmp", "gif"]);

export function documentExtension(name: string): string {
  return /\.([^.]+)$/u.exec(name.trim())?.[1]?.toLocaleLowerCase() ?? "";
}

export function supportsDocumentName(name: string): boolean {
  return (SUPPORTED_DOCUMENT_EXTENSIONS as readonly string[]).includes(documentExtension(name));
}

export function folderAllowsDocumentName(name: string, allowedExtensions?: readonly string[]): boolean {
  return supportsDocumentName(name) && (!allowedExtensions || allowedExtensions.includes(documentExtension(name)));
}

export type ParsedDocument = Pick<LocalDocument, "content" | "pages">;

function checkText(content: string, name: string): string {
  const text = content.trim();
  if (!text) throw new Error(`${name}：没有可提取的文字`);
  if (/[\u0000-\u0008\u000B\u000E-\u001F]/u.test(text)) throw new Error(`${name}：文件内容不是可读取的文字`);
  if (new TextEncoder().encode(text).length > MAX_TEXT_BYTES) throw new Error(`${name}：提取的文字不能超过 2 MB`);
  return text;
}

/** 中文文字层常按单字拆项，拼接时不能人为插入空格。 */
export function pdfPageText(items: readonly ({ str: string; hasEOL?: boolean } | { type: string })[]): string {
  const parts: string[] = [];
  let previous = "";
  for (const item of items) {
    if (!("str" in item) || !item.str) continue;
    const characters = [...item.str];
    const first = characters[0] ?? "";
    const space = previous && !/\s/u.test(previous) && !/^\s/u.test(item.str)
      && !(/\p{Script=Han}/u.test(previous) && /\p{Script=Han}/u.test(first))
      && !/^[，。！？；：、,.!?;:)\]}]/u.test(item.str) && !/[（【([{]$/u.test(previous);
    if (space) parts.push(" ");
    parts.push(item.str);
    if (item.hasEOL) parts.push("\n");
    previous = item.hasEOL ? "\n" : characters.at(-1) ?? previous;
  }
  return parts.join("").trim();
}

async function readPdf(file: File): Promise<ParsedDocument> {
  const [{ getDocument, GlobalWorkerOptions, OPS }, worker] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ]);
  GlobalWorkerOptions.workerSrc = worker.default;
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()), stopAtErrors: true });
  let ocr: Awaited<ReturnType<typeof import("./parse-ocr.ts")["createDocumentOcr"]>> | undefined;
  let pdf;
  try {
    pdf = await task.promise;
    const pieces: string[] = [];
    const pages: NonNullable<LocalDocument["pages"]> = [];
    let length = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      let text = pdfPageText(content.items);
      if (!text) {
        if (!ocr) {
          try { ocr = await (await import("./parse-ocr.ts")).createDocumentOcr(); }
          catch (error) {
            console.warn("文字识别组件加载失败", error);
            throw new Error(`${file.name}：文字识别组件加载失败，请检查网络后重试`, { cause: error });
          }
        }
        try { text = await ocr.recognize(page); }
        catch (error) {
          console.warn("PDF 页面文字识别失败", error);
          throw new Error(`${file.name}：第 ${number} 页文字识别失败`, { cause: error });
        }
        if (!text) {
          const imageOps = new Set([
            OPS.paintImageXObject, OPS.paintImageXObjectRepeat, OPS.paintInlineImageXObject,
            OPS.paintInlineImageXObjectGroup, OPS.paintImageMaskXObject, OPS.paintImageMaskXObjectGroup,
            OPS.paintImageMaskXObjectRepeat,
          ]);
          const operations = await page.getOperatorList();
          if (operations.fnArray.some((operation) => imageOps.has(operation))) {
            throw new Error(`${file.name}：第 ${number} 页包含图片但未识别到文字，请检查扫描清晰度`);
          }
        }
      }
      if (!text) continue;
      if (pieces.length) { pieces.push("\n\n"); length += 2; }
      const start = length;
      pieces.push(text);
      length += text.length;
      if (length > MAX_TEXT_BYTES) throw new Error(`${file.name}：提取的文字不能超过 2 MB`);
      pages.push({ number, start, end: length });
    }
    if (!pages.length) throw new Error(`${file.name}：PDF 没有识别到文字`);
    return { content: checkText(pieces.join(""), file.name), pages };
  } finally {
    try { await ocr?.close(); }
    finally { await task.destroy(); }
  }
}

export async function validateDocx(bytes: ArrayBuffer): Promise<void> {
  const { default: JSZip } = await import("jszip");
  await JSZip.loadAsync(bytes, { checkCRC32: true });
}

async function readDocx(file: File): Promise<ParsedDocument> {
  const bytes = await file.arrayBuffer();
  await validateDocx(bytes);
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ arrayBuffer: bytes });
  if (result.messages.some((message) => message.type === "error")) throw new Error(`${file.name}：Word 正文解析失败`);
  return { content: checkText(result.value, file.name) };
}

export async function parseDocument(file: File): Promise<ParsedDocument> {
  if (file.size > MAX_IMPORT_FILE_BYTES) throw new Error(`${file.name}：文件不能超过 10 MB`);
  const extension = documentExtension(file.name);
  if (PLAIN_TEXT_EXTENSIONS.has(extension)) {
    try { return { content: checkText(new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()), file.name) }; }
    catch (error) {
      if (error instanceof Error && error.message.startsWith(`${file.name}：`)) throw error;
      throw new Error(`${file.name}：文本编码无法读取，请转为 UTF-8`);
    }
  }
  if (HTML_EXTENSIONS.has(extension) || extension === "xml") {
    try {
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      const parsed = new DOMParser().parseFromString(raw, extension === "xml" ? "application/xml" : "text/html");
      if (parsed.querySelector("parsererror")) throw new Error(`${file.name}：文档结构无法读取`);
      parsed.querySelectorAll("script, style, noscript, template").forEach((node) => node.remove());
      return { content: checkText(parsed.documentElement.textContent ?? "", file.name) };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith(`${file.name}：`)) throw error;
      throw new Error(`${file.name}：文本编码无法读取，请转为 UTF-8`);
    }
  }
  if (extension === "enex") {
    let raw: string;
    try { raw = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()); }
    catch { throw new Error(`${file.name}：文本编码无法读取，请转为 UTF-8`); }
    return (await import("./parse-enex.ts")).parseEnex(raw, file.name);
  }
  if (IMAGE_EXTENSIONS.has(extension)) {
    const { createDocumentOcr, validateOcrImage } = await import("./parse-ocr.ts");
    try { await validateOcrImage(file); }
    catch (error) { throw new Error(`${file.name}：${error instanceof Error ? error.message : "图片无法读取"}`, { cause: error }); }
    let ocr: Awaited<ReturnType<typeof import("./parse-ocr.ts")["createDocumentOcr"]>>;
    try { ocr = await createDocumentOcr(); }
    catch (error) {
      console.warn("图片文字识别组件加载失败", error);
      throw new Error(`${file.name}：文字识别组件加载失败，请检查网络后重试`, { cause: error });
    }
    try {
      return { content: checkText(await ocr.recognizeImage(file), file.name) };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith(`${file.name}：`)) throw error;
      console.warn("图片文字识别失败", error);
      throw new Error(`${file.name}：图片文字识别失败，请检查图片是否损坏`, { cause: error });
    } finally { await ocr.close(); }
  }
  if (extension === "tif" || extension === "tiff") {
    try {
      const parsed = await (await import("./parse-tiff.ts")).parseTiff(file);
      return { ...parsed, content: checkText(parsed.content, file.name) };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith(`${file.name}：`)) throw error;
      console.warn("TIFF 解析失败", error);
      throw new Error(`${file.name}：${error instanceof Error ? error.message : "TIFF 解析失败"}`, { cause: error });
    }
  }
  if (extension === "pdf" || extension === "docx") {
    const format = extension === "pdf" ? "PDF" : "DOCX";
    try { return format === "PDF" ? await readPdf(file) : await readDocx(file); }
    catch (error) {
      if (error instanceof Error && error.message.startsWith(`${file.name}：`)) throw error;
      throw new Error(`${file.name}：${format} 解析失败，请确认文件未损坏或加密`);
    }
  }
  if (extension === "pptx" || extension === "odt" || extension === "epub" || extension === "xlsx" || extension === "ods") {
    try { return await (await import("./parse-archive.ts")).parseArchive(file, extension); }
    catch (error) {
      if (error instanceof Error && error.message.startsWith(`${file.name}：`)) throw error;
      throw new Error(`${file.name}：文档解析失败，请确认文件未损坏或加密`);
    }
  }
  throw new Error(`${file.name}：当前格式尚不能解析`);
}
