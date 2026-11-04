import { useSettings } from "../settings/store.ts";
import { get } from "../store/core.ts";
import type { CommonProps } from "./events.ts";
import { getAnonId, getSessionId } from "./identity.ts";

/** 与 package.json / tauri.conf 对齐；埋点只作分维，不要求每次发版改这里 */
const APP_VERSION = "0.1.3";

function detectOs(): CommonProps["os"] {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const plat = typeof navigator !== "undefined" ? navigator.platform || "" : "";
  if (/Mac|iPhone|iPad/i.test(plat) || /Mac OS X/i.test(ua)) return "mac";
  if (/Win/i.test(plat) || /Windows/i.test(ua)) return "win";
  if (/Linux/i.test(plat) || /Linux/i.test(ua)) return "linux";
  // 单测与无 navigator 环境：记 unknown，不依赖 Tauri 检测以免拉起 http 层
  return "unknown";
}

export function commonProps(mapId?: string | null): CommonProps {
  const s = useSettings.getState();
  const map = mapId === undefined ? get().map?.id ?? null : mapId;
  return {
    anon_id: getAnonId(),
    user_id: s.account?.id ?? null,
    session_id: getSessionId(),
    app_version: APP_VERSION,
    os: detectOs(),
    plan: s.usage?.plan || "",
    can_ask: s.canAsk,
    map_id: map,
    ts: Date.now(),
  };
}
