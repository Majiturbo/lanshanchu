/** 移动端谁可以横屏：只有知识地图画布本身。详情、角标、菜单和其它全屏页都不行。 */

export interface OrientSurface {
  mobile: boolean;
  screen: string;
  drawer: boolean;
  reading: boolean;
  summary: boolean;
  leaving: boolean;
  settings: boolean;
  gate: boolean;
  phoneBind: boolean;
  history: boolean;
  cite: boolean;
  /** 底栏菜单、路径、长按菜单、大图等不在 store 里的一层 */
  overlay: boolean;
}

/** 系统方向锁开着就冻结；否则只有画布跟随用户方向，其它界面只要正向竖屏。 */
export type OrientMode = "locked" | "free" | "portrait";

export function orientationMode(rotationLocked: boolean, allows: boolean): OrientMode {
  if (rotationLocked) return "locked";
  if (allows) return "free";
  return "portrait";
}

export function allowsLandscape(s: OrientSurface): boolean {
  if (!s.mobile) return true;
  if (s.screen !== "workspace") return false;
  if (s.drawer || s.reading || s.summary || s.leaving) return false;
  if (s.settings || s.gate || s.phoneBind || s.history || s.cite || s.overlay) return false;
  return true;
}
