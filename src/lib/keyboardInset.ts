import { IS_MOBILE_APP, IS_TOUCH_UI } from "../core/device.ts";

function editingField(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** 软键盘抬起时把 visualViewport 底部空隙写到 `--kb-inset`，供提问框 / 追问槽 / 表单避让。仅触控 / 移动壳，避免桌面缩放误抬布局 */
export function startKeyboardInset(): () => void {
  if (!IS_MOBILE_APP && !IS_TOUCH_UI) {
    document.documentElement.style.setProperty("--kb-inset", "0px");
    return () => {};
  }
  const vv = window.visualViewport;
  if (!vv) {
    document.documentElement.style.setProperty("--kb-inset", "0px");
    return () => {};
  }
  const sync = () => {
    // iOS WebView 即使没弹键盘也会有 innerHeight 与 visualViewport 的偏差；
    // 只在真正编辑输入时抬布局，并忽略小于 Home 条量级的抖动。
    const raw = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    const inset = editingField() && raw > 60 ? raw : 0;
    document.documentElement.style.setProperty("--kb-inset", `${Math.round(inset)}px`);
  };
  sync();
  vv.addEventListener("resize", sync);
  vv.addEventListener("scroll", sync);
  addEventListener("focusin", sync);
  addEventListener("focusout", sync);
  return () => {
    vv.removeEventListener("resize", sync);
    vv.removeEventListener("scroll", sync);
    removeEventListener("focusin", sync);
    removeEventListener("focusout", sync);
    document.documentElement.style.removeProperty("--kb-inset");
  };
}
