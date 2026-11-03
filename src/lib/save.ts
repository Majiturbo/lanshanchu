import { invoke } from "@tauri-apps/api/core";
import { track } from "../analytics/index.ts";
import { IS_MOBILE_APP } from "../core/device.ts";
import { IN_APP } from "../core/http.ts";
import { toast } from "../store/toast.ts";

// 导出与复制 Markdown：桌面经 Rust save_markdown「另存为」；移动端优先系统分享，否则下载；浏览器示例模式直接下载。

export type ExportScope = "node" | "selection" | "map" | "summary";

function downloadMarkdown(name: string, content: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function shareMarkdown(name: string, content: string): Promise<boolean> {
  if (typeof navigator.share !== "function") return false;
  const file = new File([content], name, { type: "text/markdown" });
  const data: ShareData = navigator.canShare?.({ files: [file] })
    ? { files: [file], title: name }
    : { text: content, title: name };
  if (navigator.canShare && !navigator.canShare(data)) return false;
  try {
    await navigator.share(data);
    return true;
  } catch (e) {
    // 用户取消分享不算失败
    if (e instanceof DOMException && e.name === "AbortError") return true;
    return false;
  }
}

export async function saveMarkdown(name: string, content: string, scope: ExportScope = "map") {
  try {
    if (IN_APP && IS_MOBILE_APP) {
      if (await shareMarkdown(name, content)) {
        track("export_done", { scope });
        toast("已导出 Markdown");
        return;
      }
      downloadMarkdown(name, content);
      track("export_done", { scope });
      toast("已导出 Markdown");
      return;
    }
    if (IN_APP) {
      if (await invoke<boolean>("save_markdown", { name, content })) {
        track("export_done", { scope });
        toast("已导出 Markdown");
      }
      return;
    }
    downloadMarkdown(name, content);
    track("export_done", { scope });
  } catch (e) {
    console.error("[export] 导出失败", e);
    toast("导出失败，请重试");
  }
}

export async function copyText(text: string, done = "已复制") {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch (e) {
    console.error("[export] 复制失败", e);
    toast("复制失败，请重试");
  }
}
