import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { IS_MOBILE_APP } from "../core/device.ts";
import { PACK_MODE } from "../core/devNet.ts";
import { IN_APP } from "../core/http.ts";

// 顶栏空白处通过 data-tauri-drag-region 拖动（双击最大化）。
// macOS 用系统红黄绿（tauri.macos.conf.json 的 Overlay），不自绘窗口按钮。
// Windows 无系统装饰，右侧自绘最小化 / 最大化 / 关闭，图标与顶栏其他按钮同用 lucide。
// 移动端无窗口拖动与窗控；浏览器开发时不渲染窗口按钮；采集或重放只在 Windows 画面下画出按钮，点了没有作用。

/** 桌面应用跑在 macOS 上：用系统红绿灯，顶栏给它们留出位置 */
export const IS_MAC = IN_APP && !IS_MOBILE_APP && /Macintosh/.test(navigator.userAgent);
if (IS_MAC) document.documentElement.classList.add("is-mac");

/** 放在可拖动元素上；子元素按钮不受影响。移动端没有窗口拖动。 */
export const drag = IN_APP && !IS_MOBILE_APP ? { "data-tauri-drag-region": "" } : {};

/** 窗口是否获得焦点：失焦时标题栏内容变淡，与系统窗口一致；移动端跳过 */
export function useWindowFocus() {
  useEffect(() => {
    if (!IN_APP || IS_MOBILE_APP) return;
    const win = getCurrentWindow();
    const unlisten = win.onFocusChanged(({ payload }) => {
      document.documentElement.classList.toggle("window-inactive", !payload);
    });
    return () => { void unlisten.then((f) => f()); };
  }, []);
}

/** 与顶栏图标按钮一致：16px 图标、线宽 1.6（24 网格）≈ 实际 1.07px。
 * 方框图形在 lucide 里比横线和叉号大一圈，缩到 13px，并用绝对线宽保持同样粗细。 */
const ICON = 16;
const STROKE = 1.6;
const BOX = 13;
const BOX_STROKE = (STROKE * ICON) / 24;

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!IN_APP || IS_MOBILE_APP) return;
    const win = getCurrentWindow();
    void win.isMaximized().then(setMaximized);
    const unlisten = win.onResized(() => { void win.isMaximized().then(setMaximized); });
    return () => { void unlisten.then((f) => f()); };
  }, []);

  if (IS_MOBILE_APP || IS_MAC || (!IN_APP && !PACK_MODE)) return null;
  const win = IN_APP ? getCurrentWindow() : null;
  return (
    <div className="window-controls">
      <button type="button" className="wc" aria-label="最小化" onClick={() => void win?.minimize()}>
        <Minus size={ICON} strokeWidth={STROKE} />
      </button>
      <button type="button" className="wc" aria-label={maximized ? "还原" : "最大化"} onClick={() => void win?.toggleMaximize()}>
        {maximized
          ? <Copy size={BOX} strokeWidth={BOX_STROKE} absoluteStrokeWidth style={{ transform: "scaleX(-1)" }} />
          : <Square size={BOX} strokeWidth={BOX_STROKE} absoluteStrokeWidth />}
      </button>
      <button type="button" className="wc wc-close" aria-label="关闭" onClick={() => void win?.close()}>
        <X size={ICON} strokeWidth={STROKE} />
      </button>
    </div>
  );
}
