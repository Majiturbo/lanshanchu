import { IN_APP } from "./http.ts";

/** 构建期平台（Vite envPrefix 含 TAURI_ENV_*）；比 UA 更可靠，避免 iPad 桌面 UA 误判 */
const tauriPlatform = String(import.meta.env.TAURI_ENV_PLATFORM ?? "");

/** 是否跑在触屏手机/平板形态（Tauri 移动包，或窄屏粗指针环境） */
const uaMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** Tauri iOS / Android 发布与开发包 */
export const IS_MOBILE_APP =
  IN_APP && (tauriPlatform === "ios" || tauriPlatform === "android" || uaMobile);

/** 需要触控命中区与移动壳层：移动应用，或仅有粗指针的触屏设备 */
export const IS_TOUCH_UI =
  IS_MOBILE_APP ||
  (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches);

if (IS_MOBILE_APP) document.documentElement.classList.add("is-mobile-app");
if (IS_TOUCH_UI) document.documentElement.classList.add("is-touch");
