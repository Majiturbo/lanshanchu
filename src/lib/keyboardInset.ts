import { IS_MOBILE_APP, IS_TOUCH_UI } from "../core/device.ts";

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
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty("--kb-inset", `${Math.round(inset)}px`);
  };
  sync();
  vv.addEventListener("resize", sync);
  vv.addEventListener("scroll", sync);
  return () => {
    vv.removeEventListener("resize", sync);
    vv.removeEventListener("scroll", sync);
    document.documentElement.style.removeProperty("--kb-inset");
  };
}
