/** 安装包类型：Android APK / iOS IPA / macOS PKG / Windows NSIS / 只有发布页 */
export type UpdatePackageKind = "apk" | "ipa" | "pkg" | "nsis" | "page";

export type DesktopOs = "mac" | "windows";

export type ReleaseAsset = { name?: string; browser_download_url?: string };

const RELEASE_HOSTS = new Set([
  "github.com",
  "www.github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);

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

/** 桌面系统：用来挑安装包。认不出时只给发布页。 */
export function desktopOs(ua = navigator.userAgent): DesktopOs | null {
  if (/Macintosh|Mac OS X/i.test(ua)) return "mac";
  if (/Windows/i.test(ua)) return "windows";
  return null;
}

/** 桌面安装包：macOS 优先通用 PKG，Windows 优先 NSIS 安装包；地址不在发布域名上则退回发布页。 */
export function pickDesktopPackage(
  assets: ReleaseAsset[] | undefined,
  os: DesktopOs,
  page: string,
): { url: string; packageKind: UpdatePackageKind } {
  const matched = (assets ?? []).filter((a) => a.browser_download_url && (os === "mac" ? /\.pkg$/i : /-setup\.exe$/i).test(a.name || ""));
  const preferred = os === "mac"
    ? matched.find((a) => /universal/i.test(a.name || "")) ?? matched[0]
    : matched.find((a) => /windows/i.test(a.name || "")) ?? matched[0];
  const raw = preferred?.browser_download_url;
  if (!raw) return { url: page, packageKind: "page" };
  const url = trustedReleaseUrl(raw, page);
  if (url !== raw) return { url: page, packageKind: "page" };
  return { url, packageKind: os === "mac" ? "pkg" : "nsis" };
}
