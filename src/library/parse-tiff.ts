import UTIF from "utif";
import type { IFD } from "utif";
import type { ParsedDocument } from "./parse.ts";
import { createDocumentOcr } from "./parse-ocr.ts";

const MAX_TIFF_PAGES = 50;
const MAX_TIFF_PAGE_PIXELS = 16_000_000;
const TAG_BYTES = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
const NESTED_TAGS = new Set([330, 34665, 50740, 37500]);

function tagNumbers(page: IFD, tag: string): number[] {
  const value = page[tag];
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.length || !value.every(Number.isSafeInteger)) {
    throw new Error(`TIFF 标签 ${tag} 内容无效`);
  }
  return value as number[];
}

/** UTIF 会递归解析嵌套元数据；先约束目录链与标签范围再交给解码器。 */
export function validateTiffPages(buffer: ArrayBuffer): IFD[] {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 8) throw new Error("TIFF 文件头不完整");
  const little = bytes[0] === 0x49 && bytes[1] === 0x49;
  if (!little && !(bytes[0] === 0x4d && bytes[1] === 0x4d)) throw new Error("TIFF 文件头无法读取");
  const view = new DataView(buffer);
  if (view.getUint16(2, little) !== 42) throw new Error("当前只支持标准 TIFF 文件");
  let offset = view.getUint32(4, little);
  const seen = new Set<number>();
  while (offset) {
    if (offset < 8 || offset + 2 > bytes.length || seen.has(offset)) throw new Error("TIFF 页面目录损坏");
    seen.add(offset);
    if (seen.size > MAX_TIFF_PAGES) throw new Error(`TIFF 最多支持 ${MAX_TIFF_PAGES} 页`);
    const count = view.getUint16(offset, little);
    const end = offset + 2 + count * 12;
    if (count > 128 || end + 4 > bytes.length) throw new Error("TIFF 页面目录损坏");
    for (let entry = offset + 2; entry < end; entry += 12) {
      const tag = view.getUint16(entry, little);
      const type = view.getUint16(entry + 2, little);
      const size = view.getUint32(entry + 4, little) * (TAG_BYTES[type] ?? 0);
      if (!TAG_BYTES[type] || size > bytes.length) throw new Error("TIFF 标签内容损坏");
      if (size > 4) {
        const valueOffset = view.getUint32(entry + 8, little);
        if (valueOffset < 8 || valueOffset + size > bytes.length) throw new Error("TIFF 标签内容损坏");
      }
      if (NESTED_TAGS.has(tag)) throw new Error("当前不支持包含嵌套元数据的 TIFF");
    }
    offset = view.getUint32(end, little);
  }
  if (!seen.size) throw new Error("TIFF 没有可读取的页面");
  const pages = UTIF.decode(buffer);
  if (pages.length !== seen.size) throw new Error("TIFF 页面目录损坏");
  for (const page of pages) {
    const width = tagNumbers(page, "t256")[0];
    const height = tagNumbers(page, "t257")[0];
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width * height > MAX_TIFF_PAGE_PIXELS) {
      throw new Error("TIFF 页面像素过大或尺寸无效，单页最多支持 1600 万像素");
    }
    const bits = tagNumbers(page, "t258");
    const samples = tagNumbers(page, "t277")[0] ?? bits.length;
    const depth = bits[0] ?? 1;
    const color = tagNumbers(page, "t262")[0] ?? 2;
    const supportedColor = color === 0 && [1, 4, 8].includes(depth) && samples === 1
      || color === 1 && [1, 2, 8, 16].includes(depth) && samples === 1
      || color === 2 && [8, 16].includes(depth) && [3, 4].includes(samples)
      || color === 3 && depth === 8 && samples === 1 && tagNumbers(page, "t320").length >= 768;
    if (!supportedColor || (bits.length && bits.length !== samples) || bits.some((bit) => bit !== depth)) {
      throw new Error("TIFF 图像通道格式不支持");
    }
    const compression = tagNumbers(page, "t259")[0] ?? 1;
    if (page.t322 || page.t323 || tagNumbers(page, "t284")[0] === 2 || compression !== 1) {
      throw new Error("当前只支持未压缩、非分块的 TIFF");
    }
    const offsets = tagNumbers(page, "t273");
    const sizes = tagNumbers(page, "t279");
    const rowsPerStrip = tagNumbers(page, "t278")[0] ?? height;
    if (!Number.isSafeInteger(rowsPerStrip) || rowsPerStrip < 1 || !offsets.length || offsets.length !== sizes.length ||
        offsets.length !== Math.ceil(height / rowsPerStrip) ||
        offsets.some((value, index) => !Number.isSafeInteger(value) || value < 8 || !Number.isSafeInteger(sizes[index]) || sizes[index] < 1 || value + sizes[index] > bytes.length)) {
      throw new Error("TIFF 图像数据损坏");
    }
    if (compression === 1) {
      const rowBytes = Math.ceil(width * depth * samples / 8);
      if (sizes.some((size, index) => size < rowBytes * Math.min(rowsPerStrip, height - index * rowsPerStrip))) {
        throw new Error("TIFF 非压缩图像数据不完整");
      }
    }
  }
  return pages;
}

export async function parseTiff(file: File): Promise<ParsedDocument> {
  const buffer = await file.arrayBuffer();
  const pages = validateTiffPages(buffer);
  const ocr = await createDocumentOcr();
  const parts: string[] = [];
  const locations: NonNullable<ParsedDocument["pages"]> = [];
  let length = 0;
  try {
    for (let index = 0; index < pages.length; index++) {
      const page = pages[index];
      const width = tagNumbers(page, "t256")[0];
      const height = tagNumbers(page, "t257")[0];
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("无法绘制 TIFF 页面");
      try {
        UTIF.decodeImage(buffer, page);
        const rgba = UTIF.toRGBA8(page);
        if (rgba.length !== width * height * 4) throw new Error("TIFF 页面图像数据不完整");
        context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
        const text = await ocr.recognizeImage(canvas);
        if (!text) throw new Error("页面未识别到文字，请检查扫描清晰度");
        if (parts.length) { parts.push("\n\n"); length += 2; }
        const start = length;
        parts.push(text);
        length += text.length;
        locations.push({ number: index + 1, start, end: length });
      } catch (error) {
        throw new Error(`${file.name}：第 ${index + 1} 页识别失败：${error instanceof Error ? error.message : "无法读取"}`, { cause: error });
      } finally {
        page.data = new Uint8Array(0);
        canvas.width = 0;
        canvas.height = 0;
      }
    }
  } finally { await ocr.close(); }
  return { content: parts.join(""), pages: locations };
}
