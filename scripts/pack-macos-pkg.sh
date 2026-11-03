#!/usr/bin/env bash
# 把 Tauri 打出的 .app 封成带安装/升级向导的 .pkg（安装到 /Applications）。
# productName 保持 ASCII（Windows 安装目录需要）；包内目录名改为「阑珊处.app」，Finder / 程序坞 / 安装向导显示中文。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRODUCT_NAME="LanshanChu"
DISPLAY_NAME="阑珊处"
PKG_ID="com.lanshanchu.app"
RESOURCE_DIR="$ROOT/src-tauri/macos/pkg"
APP=""

for candidate in \
  "$ROOT/src-tauri/target/universal-apple-darwin/release/bundle/macos/${PRODUCT_NAME}.app" \
  "$ROOT/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/${PRODUCT_NAME}.app" \
  "$ROOT/src-tauri/target/x86_64-apple-darwin/release/bundle/macos/${PRODUCT_NAME}.app" \
  "$ROOT/src-tauri/target/release/bundle/macos/${PRODUCT_NAME}.app"
do
  if [[ -d "$candidate" ]]; then
    APP="$candidate"
    break
  fi
done

if [[ -z "$APP" ]]; then
  echo "未找到 ${PRODUCT_NAME}.app。请先执行：" >&2
  echo "  npm run tauri -- build --bundles app" >&2
  echo "通用包再加：--target universal-apple-darwin" >&2
  exit 1
fi

VERSION="$(
  /usr/bin/python3 -c "import json; print(json.load(open('$ROOT/src-tauri/tauri.conf.json'))['version'])"
)"
BUNDLE_ROOT="$(cd "$(dirname "$APP")/.." && pwd)"
OUT_DIR="$BUNDLE_ROOT/pkg"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/lanshan-pkg.XXXXXX")"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

mkdir -p "$OUT_DIR" "$WORK/resources" "$WORK/scripts" "$WORK/root"
# -X 避免把 ._ 资源叉打进包里；Installer 脚本目录里多文件会干扰
/bin/cp -X "$RESOURCE_DIR/welcome.html" "$WORK/resources/welcome.html"
/bin/cp -X "$RESOURCE_DIR/conclusion.html" "$WORK/resources/conclusion.html"
/bin/cp -X "$RESOURCE_DIR/scripts/preinstall" "$WORK/scripts/preinstall"
/bin/cp -X "$RESOURCE_DIR/scripts/postinstall" "$WORK/scripts/postinstall"
chmod 755 "$WORK/scripts/preinstall" "$WORK/scripts/postinstall"
xattr -cr "$WORK/scripts" "$WORK/resources" 2>/dev/null || true

# 复制为中文 .app 名再封装；可执行文件仍是 LanshanChu（与 productName 一致）
DISPLAY_APP="$WORK/root/${DISPLAY_NAME}.app"
ditto "$APP" "$DISPLAY_APP"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName ${DISPLAY_NAME}" "$DISPLAY_APP/Contents/Info.plist" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string ${DISPLAY_NAME}" "$DISPLAY_APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName ${DISPLAY_NAME}" "$DISPLAY_APP/Contents/Info.plist" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleName string ${DISPLAY_NAME}" "$DISPLAY_APP/Contents/Info.plist"
# 简体中文系统下强制用显示名（避免个别环境回退到文件名 LanshanChu）
mkdir -p "$DISPLAY_APP/Contents/Resources/zh-Hans.lproj"
printf 'CFBundleDisplayName = "%s";\nCFBundleName = "%s";\n' "$DISPLAY_NAME" "$DISPLAY_NAME" \
  > "$DISPLAY_APP/Contents/Resources/zh-Hans.lproj/InfoPlist.strings"
# 临时签名后改了包内文件需重签，否则 Apple 芯片上会提示损坏。
# 不带 hardened runtime：未公证时旧系统更容易打开；entitlements 给 WKWebView JIT。
ENTITLEMENTS="$RESOURCE_DIR/entitlements.plist"
if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  codesign --force --deep --options runtime --entitlements "$ENTITLEMENTS" --sign "$APPLE_SIGNING_IDENTITY" "$DISPLAY_APP"
else
  codesign --force --deep --entitlements "$ENTITLEMENTS" --sign - "$DISPLAY_APP"
fi
xattr -cr "$DISPLAY_APP" 2>/dev/null || true

ARCH_TAG="darwin"
case "$APP" in
  *universal-apple-darwin*) ARCH_TAG="darwin_universal" ;;
  *aarch64-apple-darwin*) ARCH_TAG="darwin_aarch64" ;;
  *x86_64-apple-darwin*) ARCH_TAG="darwin_x64" ;;
esac

COMPONENT="$WORK/${PKG_ID}.pkg"
PKG="$OUT_DIR/lanshanchu_${VERSION}_${ARCH_TAG}.pkg"
DIST="$WORK/Distribution.xml"
rm -f "$PKG"

# 组件包：固定标识与版本，便于 Installer 识别升级；preinstall 在覆盖前退出旧进程
# 通用包含 Apple 芯片，安装器侧也标 11.0，旧系统会直接提示版本不够而不是装完打不开
pkgbuild \
  --root "$WORK/root" \
  --install-location /Applications \
  --identifier "$PKG_ID" \
  --version "$VERSION" \
  --min-os-version 11.0 \
  --scripts "$WORK/scripts" \
  "$COMPONENT"

cat > "$DIST" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="1">
    <title>${DISPLAY_NAME}</title>
    <organization>com.lanshanchu</organization>
    <domains enable_anywhere="false" enable_currentUserHome="false" enable_localSystem="true"/>
    <options customize="never" require-scripts="false" rootVolumeOnly="true"/>
    <welcome file="welcome.html" mime-type="text/html" />
    <conclusion file="conclusion.html" mime-type="text/html" />
    <volume-check>
        <allowed-os-versions>
            <os-version min="11.0"/>
        </allowed-os-versions>
    </volume-check>
    <pkg-ref id="${PKG_ID}"/>
    <choices-outline>
        <line choice="default">
            <line choice="${PKG_ID}"/>
        </line>
    </choices-outline>
    <choice id="default"/>
    <choice id="${PKG_ID}" visible="false">
        <pkg-ref id="${PKG_ID}"/>
    </choice>
    <pkg-ref id="${PKG_ID}" version="${VERSION}" onConclusion="none">${PKG_ID}.pkg</pkg-ref>
</installer-gui-script>
EOF

PRODUCTBUILD_ARGS=(
  --distribution "$DIST"
  --resources "$WORK/resources"
  --package-path "$WORK"
)

# 无安装包签名证书时打未签名 pkg（与当前未公证分发一致）；有证书时可设 APPLE_INSTALLER_SIGNING_IDENTITY
if [[ -n "${APPLE_INSTALLER_SIGNING_IDENTITY:-}" ]]; then
  PRODUCTBUILD_ARGS+=(--sign "$APPLE_INSTALLER_SIGNING_IDENTITY")
fi

xcrun productbuild "${PRODUCTBUILD_ARGS[@]}" "$PKG"

echo "已生成: $PKG"
