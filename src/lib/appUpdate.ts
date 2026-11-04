import { IS_MOBILE_APP } from "../core/device.ts";
import { httpFetch } from "../core/http.ts";

export const APP_VERSION = "1.1.0";

const RELEASES_LATEST = "https://api.github.com/repos/Majiturbo/lanshanchu/releases/latest";

export type UpdateInfo =
  | { status: "latest"; latest: string }
  | { status: "available"; latest: string; url: string; hasApk: boolean }
  | { status: "error"; message: string };

function parseVer(v: string): number[] {
  return String(v || "").replace(/^v/i, "").split(".").map((p) => Math.max(0, parseInt(p, 10) || 0));
}

/** a > b → 1；相等 0；更旧 -1 */
export function compareVersion(a: string, b: string): number {
  const aa = parseVer(a);
  const bb = parseVer(b);
  const n = Math.max(aa.length, bb.length);
  for (let i = 0; i < n; i++) {
    const x = aa[i] ?? 0;
    const y = bb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

type GhRelease = {
  tag_name?: string;
  html_url?: string;
  assets?: { name?: string; browser_download_url?: string }[];
};

/** 查 GitHub 最新 Release；手机优先找 APK 资源，没有则打开发布页 */
export async function checkAppUpdate(signal?: AbortSignal): Promise<UpdateInfo> {
  try {
    const res = await httpFetch(RELEASES_LATEST, {
      headers: { Accept: "application/vnd.github+json" },
      signal,
    });
    if (!res.ok) return { status: "error", message: "暂时连不上更新服务" };
    const data = (await res.json()) as GhRelease;
    const latest = String(data.tag_name || "").replace(/^v/i, "");
    if (!latest) return { status: "error", message: "没有读到版本信息" };
    if (compareVersion(latest, APP_VERSION) <= 0) {
      return { status: "latest", latest };
    }
    const apk = (data.assets ?? []).find((a) => /\.apk$/i.test(a.name || "") && a.browser_download_url);
    const url = (IS_MOBILE_APP && apk?.browser_download_url) || data.html_url || "https://github.com/Majiturbo/lanshanchu/releases/latest";
    return { status: "available", latest, url, hasApk: Boolean(apk?.browser_download_url) };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    return { status: "error", message: "检查失败，请稍后重试" };
  }
}
