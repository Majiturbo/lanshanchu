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

export type OrientAngle = 0 | 90 | 180 | 270;

export function allowsLandscape(s: OrientSurface): boolean {
  if (!s.mobile) return true;
  if (s.screen !== "workspace") return false;
  if (s.drawer || s.reading || s.summary || s.leaving) return false;
  if (s.settings || s.gate || s.phoneBind || s.history || s.cite || s.overlay) return false;
  return true;
}

export function viewportAngle(angle: number | undefined, width: number, height: number): OrientAngle {
  if (angle === 0 || angle === 90 || angle === 180 || angle === 270) return angle;
  return width > height ? 90 : 0;
}

/** 需要把横屏视口转回竖屏时返回设备角；画布横屏或本来就是竖屏则不转 */
export function portraitLockAngle(allows: boolean, angle: OrientAngle): 90 | 270 | null {
  if (allows) return null;
  if (angle === 90 || angle === 270) return angle;
  return null;
}
