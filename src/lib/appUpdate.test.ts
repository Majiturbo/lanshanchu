import assert from "node:assert/strict";
import { test } from "node:test";
import { compareVersion, desktopOs, pickDesktopPackage, trustedReleaseUrl } from "./releaseAsset.ts";

const page = "https://github.com/Majiturbo/lanshanchu/releases/latest";
const pkg = "https://github.com/Majiturbo/lanshanchu/releases/download/v1.2.0/lanshanchu_1.2.0_darwin_universal.pkg";
const exe = "https://github.com/Majiturbo/lanshanchu/releases/download/v1.2.0/lanshanchu_1.2.0_windows_x64-setup.exe";

test("版本比较忽略 v 前缀，按段比较", () => {
  assert.equal(compareVersion("v1.2.0", "1.1.8"), 1);
  assert.equal(compareVersion("1.1.8", "1.1.8"), 0);
  assert.equal(compareVersion("1.1.8", "1.1.10"), -1);
});

test("桌面安装包优先通用 PKG 与 Windows NSIS，陌生地址退回发布页", () => {
  const assets = [
    { name: "lanshanchu_1.2.0_darwin_aarch64.pkg", browser_download_url: pkg.replace("universal", "aarch64") },
    { name: "lanshanchu_1.2.0_darwin_universal.pkg", browser_download_url: pkg },
    { name: "lanshanchu_1.2.0_windows_x64-setup.exe", browser_download_url: exe },
    { name: "notes.txt", browser_download_url: "https://evil.example/setup.exe" },
  ];
  assert.deepEqual(pickDesktopPackage(assets, "mac", page), { url: pkg, packageKind: "pkg" });
  assert.deepEqual(pickDesktopPackage(assets, "windows", page), { url: exe, packageKind: "nsis" });
  assert.deepEqual(pickDesktopPackage([{ name: "app-setup.exe", browser_download_url: "https://evil.example/a.exe" }], "windows", page), { url: page, packageKind: "page" });
  assert.equal(pickDesktopPackage([], "mac", page).packageKind, "page");
  assert.equal(trustedReleaseUrl("https://evil.example/a.pkg", page), page);
});

test("桌面系统从 UA 识别，其余不挑安装包", () => {
  assert.equal(desktopOs("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"), "mac");
  assert.equal(desktopOs("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "windows");
  assert.equal(desktopOs("Mozilla/5.0 (X11; Linux x86_64)"), null);
});
