import { createWorker } from "tesseract.js";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";

const MAX_RENDER_PIXELS = 3_000_000;
const MAX_IMAGE_PIXELS = 16_000_000;

function gifFrameCount(bytes: Uint8Array): number {
  if (bytes.length < 14) return 0;
  let offset = 13;
  if (bytes[10] & 0x80) offset += 3 * (1 << ((bytes[10] & 7) + 1));
  let frames = 0;
  const skipBlocks = () => {
    while (offset < bytes.length) {
      const size = bytes[offset++];
      if (!size) return true;
      offset += size;
      if (offset > bytes.length) return false;
    }
    return false;
  };
  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 0x3b) return frames;
    if (marker === 0x21) {
      if (offset >= bytes.length) return 0;
      offset++;
      if (!skipBlocks()) return 0;
    } else if (marker === 0x2c) {
      if (offset + 9 > bytes.length) return 0;
      const packed = bytes[offset + 8];
      offset += 9;
      if (packed & 0x80) offset += 3 * (1 << ((packed & 7) + 1));
      if (offset >= bytes.length) return 0;
      offset++;
      if (!skipBlocks()) return 0;
      frames++;
      if (frames > 1) return frames;
    } else return 0;
  }
  return 0;
}

/** 先读压缩文件头，避免小文件在解码后占用过大的内存。 */
export async function validateOcrImage(file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  let width = 0;
  let height = 0;
  if (bytes.length >= 24 && bytes.slice(0, 8).every((byte, index) => byte === [137, 80, 78, 71, 13, 10, 26, 10][index])) {
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 7) break;
        height = view.getUint16(offset + 3);
        width = view.getUint16(offset + 5);
        break;
      }
      offset += length;
    }
  } else if (bytes.length >= 30 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === "VP8X") {
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    } else if (chunk === "VP8L" && bytes[20] === 0x2f) {
      width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
      height = 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10);
    } else if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      width = view.getUint16(26, true) & 0x3fff;
      height = view.getUint16(28, true) & 0x3fff;
    }
  } else if (bytes.length >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    const dibSize = view.getUint32(14, true);
    if (dibSize >= 40) {
      width = view.getInt32(18, true);
      height = Math.abs(view.getInt32(22, true));
    }
  } else if (bytes.length >= 14 && ["GIF87a", "GIF89a"].includes(String.fromCharCode(...bytes.slice(0, 6)))) {
    const frames = gifFrameCount(bytes);
    if (frames > 1) throw new Error("动画 GIF 暂不支持导入");
    if (frames === 1) {
      width = view.getUint16(6, true);
      height = view.getUint16(8, true);
    }
  }
  if (width <= 0 || height <= 0) throw new Error("图片格式无法读取或文件已损坏");
  if (width * height > MAX_IMAGE_PIXELS) throw new Error("图片像素过大，最多支持 1600 万像素");
}

export function normalizeOcrText(text: string): string {
  return text.replace(/(?<=\p{Script=Han})[ \t]+(?=\p{Script=Han})/gu, "").trim();
}

export async function createDocumentOcr() {
  const assets = new URL("./__lanshan/ocr/", document.baseURI);
  const worker = await createWorker("chi_sim", undefined, {
    workerPath: new URL("worker.min.js", assets).href,
    corePath: new URL("core/", assets).href,
    langPath: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/chi_sim@1.0.0/4.0.0_best_int",
    workerBlobURL: false,
  });

  return {
    async recognizeImage(image: File | HTMLCanvasElement): Promise<string> {
      return normalizeOcrText((await worker.recognize(image)).data.text);
    },
    async recognize(page: PDFPageProxy): Promise<string> {
      const size = page.getViewport({ scale: 1 });
      const scale = Math.min(2, Math.sqrt(MAX_RENDER_PIXELS / (size.width * size.height)));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("无法绘制扫描页面");
      try {
        await page.render({ canvasContext: context, viewport }).promise;
        return normalizeOcrText((await worker.recognize(canvas)).data.text);
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    },
    close: () => worker.terminate(),
  };
}
