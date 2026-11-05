import { IS_ANDROID_APP, IS_IOS_APP, IS_MOBILE_APP } from "../core/device.ts";
import { httpFetch } from "../core/http.ts";

export const APP_VERSION = "1.1.7";

const RELEASES_LATEST = "https://api.github.com/repos/Majiturbo/lanshanchu/releases/latest";

/** 安装包类型：Android APK / iOS 旁加载 IPA / 只有发布页 */
export type UpdatePackageKind = "apk" | "ipa" | "page";

export type UpdateInfo =
  | { status: "latest"; latest: string }
  | { status: "available"; latest: string; url: string; packageKind: UpdatePackageKind }
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

function pickAsset(assets: GhRelease["assets"], re: RegExp) {
  return (assets ?? []).find((a) => re.test(a.name || "") && a.browser_download_url);
}

const RELEASE_HOSTS = new Set([
  "github.com",
  "www.github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);

/** 只接受本仓库 GitHub 发布页 / 安装包域名；其余退回发布页，避免把任意下载地址交给系统浏览器 */
export function trustedReleaseUrl(url: string | undefined, fallback: string): string {
  const page = fallback.startsWith("https://github.com/") ? fallback : "https://github.com/Majiturbo/lanshanchu/releases/latest";
  if (!url) return page;
  try {
    const u = new URL(url);
    if (u.protocol === "https:" && RELEASE_HOSTS.has(u.hostname)) return url;
  } catch {
    /* 非法地址 */
  }
  return page;
}

/**
 * 查 GitHub 最新 Release。
 * Android：优先 APK 直链；iOS 旁加载：优先 IPA 直链（交给签名工具安装，不做应用内静默更新 / App Store）。
 * 没有对应安装包则打开发布页。
 */
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

    const page = trustedReleaseUrl(data.html_url, "https://github.com/Majiturbo/lanshanchu/releases/latest");
    if (!IS_MOBILE_APP) {
      return { status: "available", latest, url: page, packageKind: "page" };
    }

    if (IS_IOS_APP) {
      const ipa = pickAsset(data.assets, /\.ipa$/i);
      const url = trustedReleaseUrl(ipa?.browser_download_url, page);
      return {
        status: "available",
        latest,
        url,
        packageKind: ipa?.browser_download_url && url === ipa.browser_download_url ? "ipa" : "page",
      };
    }

    if (IS_ANDROID_APP) {
      const apk = pickAsset(data.assets, /\.apk$/i);
      const url = trustedReleaseUrl(apk?.browser_download_url, page);
      return {
        status: "available",
        latest,
        url,
        packageKind: apk?.browser_download_url && url === apk.browser_download_url ? "apk" : "page",
      };
    }

    const any = pickAsset(data.assets, /\.(apk|ipa)$/i);
    const url = trustedReleaseUrl(any?.browser_download_url, page);
    const direct = !!any?.browser_download_url && url === any.browser_download_url;
    const kind: UpdatePackageKind = !direct ? "page" : /\.ipa$/i.test(any?.name || "") ? "ipa" : "apk";
    return { status: "available", latest, url, packageKind: kind };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    return { status: "error", message: "检查失败，请稍后重试" };
  }
}
