import { invoke } from "@tauri-apps/api/core";
import { IN_APP } from "./http.ts";
import type { HttpFetch } from "./providers/types.ts";

// 开发版调试日志：每条一行 JSON，写到项目的 .debug/network.jsonl（由 Rust 的 debug_log 命令写入）。
// 只在「开发环境 + 桌面应用」启用；发布版中 DEBUG_LOG 为常量 false，下面的记录代码不会执行。
// 只记录请求状态与耗时；用户导入的资料和模型输出不写入调试文件。

export const DEBUG_LOG = import.meta.env.DEV && IN_APP;

export function debugLog(entry: Record<string, unknown>) {
  if (!DEBUG_LOG) return;
  const line = JSON.stringify({ t: new Date().toISOString(), ...entry });
  invoke("debug_log", { line }).catch((err) => console.warn("debug log write failed", err));
}

let seq = 0;

/** 包一层 fetch：只记录状态与耗时，不复制响应流。 */
export function tracedFetch(base: HttpFetch, run: string): HttpFetch {
  if (!DEBUG_LOG) return base;
  return async (url, init) => {
    const req = `${run}.${++seq}`;
    const started = performance.now();
    const ms = () => Math.round(performance.now() - started);
    debugLog({ run, req, type: "http.request", method: init.method ?? "GET" });
    let res: Response;
    try {
      res = await base(url, init);
    } catch (err) {
      debugLog({ run, req, type: "http.error", ms: ms(), aborted: !!init.signal?.aborted });
      throw err;
    }
    debugLog({ run, req, type: "http.response", status: res.status, firstByteMs: ms() });
    return res;
  };
}
