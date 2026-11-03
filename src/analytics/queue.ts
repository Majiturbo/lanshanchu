import { PACK_MODE } from "../core/devNet.ts";
import { MOCK_MODE, useSettings } from "../settings/store.ts";
import type { TrackedEvent } from "./events.ts";

const QUEUE_KEY = "lanshan-analytics-queue";
const MAX_QUEUE = 500;
const FLUSH_AT = 12;
const FLUSH_MS = 8_000;

let queue: TrackedEvent[] = load();
let timer = 0;
let flushing = false;
let backoffUntil = 0;

/** 开发 / 示例 / 数据包模式只积压本地，不打正式站 */
function remoteEnabled() {
  if (import.meta.env?.DEV) return false;
  if (MOCK_MODE || PACK_MODE) return false;
  return true;
}

function load(): TrackedEvent[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as TrackedEvent[]) : [];
  } catch {
    return [];
  }
}

function save() {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)));
  } catch {
    /* ignore */
  }
}

export function enqueue(ev: TrackedEvent) {
  queue.push(ev);
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
  save();
  if (!remoteEnabled()) return;
  if (queue.length >= FLUSH_AT) void flush();
  else schedule();
}

function schedule(delay = FLUSH_MS) {
  if (timer || typeof window === "undefined" || !remoteEnabled()) return;
  timer = window.setTimeout(() => {
    timer = 0;
    void flush();
  }, delay);
}

/** 推到平台；失败留在本地队列，不打扰用户。动态加载网络层，避免单测拉起 Tauri / Vite 环境 */
export async function flush() {
  if (flushing || !queue.length || !remoteEnabled()) return;
  if (Date.now() < backoffUntil) {
    schedule(Math.max(1_000, backoffUntil - Date.now()));
    return;
  }
  flushing = true;
  const batch = queue.slice(0, 50);
  try {
    const { CAN_FETCH, httpFetch } = await import("../core/http.ts");
    if (!CAN_FETCH) return;
    const { PLATFORM_URL } = await import("../core/platform.ts");
    const session = useSettings.getState().session;
    const headers = new Headers({ "Content-Type": "application/json" });
    if (session) headers.set("Authorization", `Bearer ${session}`);
    const res = await httpFetch(`${PLATFORM_URL}/api/lanshan/events`, {
      method: "POST",
      headers,
      body: JSON.stringify({ events: batch }),
    });
    if (res.ok) {
      queue = queue.slice(batch.length);
      save();
      if (queue.length) schedule();
      return;
    }
    // 4xx：这批服务端不会接受，丢掉以免堵死后续；5xx / 网络：退避后再试
    if (res.status >= 400 && res.status < 500) {
      console.warn("[analytics] drop batch", res.status);
      queue = queue.slice(batch.length);
      save();
      if (queue.length) schedule();
    } else {
      backoffUntil = Date.now() + 60_000;
      schedule(60_000);
    }
  } catch (err) {
    console.warn("[analytics] flush failed", err);
    backoffUntil = Date.now() + 60_000;
    schedule(60_000);
  } finally {
    flushing = false;
  }
}

export function peekQueue() {
  return queue.slice();
}

export function resetQueueForTest(events: TrackedEvent[] = []) {
  queue = events.slice();
  save();
  flushing = false;
  if (timer && typeof window !== "undefined") {
    window.clearTimeout(timer);
    timer = 0;
  }
}
