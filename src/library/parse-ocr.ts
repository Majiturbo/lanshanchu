import { createWorker } from "tesseract.js";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";

const MAX_RENDER_PIXELS = 3_000_000;

export function normalizeOcrText(text: string): string {
  return text.replace(/(?<=\p{Script=Han})[ \t]+(?=\p{Script=Han})/gu, "").trim();
}

export async function createPdfOcr() {
  const assets = new URL("./__lanshan/ocr/", document.baseURI);
  const worker = await createWorker("chi_sim", undefined, {
    workerPath: new URL("worker.min.js", assets).href,
    corePath: new URL("core/", assets).href,
    langPath: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/chi_sim@1.0.0/4.0.0_best_int",
    workerBlobURL: false,
  });

  return {
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
