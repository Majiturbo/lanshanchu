import { IS_ANDROID_APP, IS_IOS_APP, IS_MOBILE_APP } from "../core/device.ts";
import { httpFetch } from "../core/http.ts";
import {
  compareVersion,
  desktopOs,
  pickDesktopPackage,
  trustedReleaseUrl,
  type ReleaseAsset,
  type UpdatePackageKind,
} from "./releaseAsset.ts";

export const APP_VERSION = "1.1.9";
export type { UpdatePackageKind } from "./releaseAsset.ts";

const RELEASES_LATEST = "https://api.github.com/repos/Majiturbo/lanshanchu/releases/latest";

export type UpdateInfo =
  | { status: "latest"; latest: string }
  | { status: "available"; latest: string; url: string; packageKind: UpdatePackageKind }
  | { status: "error"; message: string };

type GhRelease = {
  tag_name?: string;
  html_url?: string;
  assets?: ReleaseAsset[];
};

function pickAsset(assets: GhRelease["assets"], re: RegExp) {
  return (assets ?? []).find((a) => re.test(a.name || "") && a.browser_download_url);
}

/**
 * 查 GitHub 最新 Release。
 * Android：优先 APK 直链；iOS 旁加载：优先 IPA 直链。
 * 桌面：macOS 优先通用 PKG，Windows 优先 NSIS。没有对应安装包则打开发布页。
 * 不做应用内静默安装。
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
      const os = desktopOs();
      if (!os) return { status: "available", latest, url: page, packageKind: "page" };
      return { status: "available", latest, ...pickDesktopPackage(data.assets, os, page) };
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
