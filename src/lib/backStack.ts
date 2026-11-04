import { exit, onBackButtonPress } from "@tauri-apps/api/app";
import { IS_MOBILE_APP } from "../core/device.ts";
import { history as mapHistory, useHistory } from "../history/store.ts";
import { needsPhoneBind } from "../components/PhoneBindGate.tsx";
import { settingsActions, useSettings } from "../settings/store.ts";
import { closeCite, useCite } from "../store/cite.ts";
import { actions, useGraph } from "../store/graph.ts";
import { swapScreen } from "./transition.ts";

let settingsPop: (() => boolean) | null = null;

/** 设置二级页先退一层；没有更深的页面时返回 false，由调用方关闭设置 */
export function bindSettingsBack(fn: () => boolean) {
  settingsPop = fn;
  return () => { if (settingsPop === fn) settingsPop = null; };
}

function popSettingsPage() {
  return settingsPop?.() ?? false;
}

const tauriPlatform = String(import.meta.env.TAURI_ENV_PLATFORM ?? "");
const isAndroid =
  tauriPlatform === "android"
  || (tauriPlatform !== "ios" && /Android/i.test(navigator.userAgent));

/** 关闭一层浮层 / 详情 / 页面；有东西可关时返回 true（系统返回应留在 App 内） */
export function dismissOne(): boolean {
  if (needsPhoneBind(useSettings.getState().account)) {
    // 强制绑定不能关掉，系统返回留在弹窗里
    return true;
  }
  const viewer = document.querySelector<HTMLElement>(".viewer:not(.is-closing) .viewer-close");
  if (viewer) {
    viewer.click();
    return true;
  }
  if (document.querySelector(".mobile-sheet:not(.is-closing), .ctx-menu:not(.is-closing), .ctx-sheet:not(.is-closing), .ctx-ask, .ctx-pick, .command-sheet:not(.is-closing)")) {
    document.dispatchEvent(new CustomEvent("lanshan:dismiss-menu"));
    document.dispatchEvent(new CustomEvent("lanshan:dismiss-overflow"));
    return true;
  }
  if (document.querySelector(".prefs-pop:not(.is-closing)")) {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return true;
  }
  if (document.querySelector(".topbar-overflow:not(.is-closing)")) {
    document.dispatchEvent(new CustomEvent("lanshan:dismiss-overflow"));
    return true;
  }
  if (useCite.getState().open) {
    closeCite();
    return true;
  }
  if (useSettings.getState().gate) {
    // 未登录的登录页不能关掉
    if (useSettings.getState().gate === "login" && !useSettings.getState().session) return true;
    settingsActions.closeGate();
    return true;
  }
  const g = useGraph.getState();
  if (g.leaving) {
    actions.resolveLeave(null);
    return true;
  }
  if (g.reading) {
    actions.closeReader();
    return true;
  }
  if (g.drawerId) {
    actions.closeDrawer();
    return true;
  }
  if (g.summaryOpen) {
    actions.closeSummary();
    return true;
  }
  if (useSettings.getState().open) {
    if (popSettingsPage()) return true;
    settingsActions.close();
    return true;
  }
  if (useHistory.getState().open) {
    mapHistory.closePanel();
    return true;
  }
  if (g.screen !== "home") {
    actions.leave(() => swapScreen(actions.goHome));
    return true;
  }
  return false;
}

function needTrap(): boolean {
  const g = useGraph.getState();
  const settings = useSettings.getState();
  return !!(
    needsPhoneBind(settings.account)
    || g.drawerId || g.reading || g.summaryOpen || g.leaving || g.screen !== "home"
    || settings.open || settings.gate
    || useHistory.getState().open || useCite.getState().open
    || document.querySelector(".mobile-sheet, .ctx-sheet, .ctx-pick, .command-sheet, .leave-sheet, .viewer")
  );
}

/** history 哨兵：iOS 侧滑、或 Android 原生返回注册失败时用；监听 trap-back 以便底栏菜单等本地态入栈 */
function startHistorySentinel(): () => void {
  window.history.replaceState({ lanshan: 0 }, "");
  const pushIfNeeded = () => {
    if (needTrap() && window.history.state?.lanshan !== 1) window.history.pushState({ lanshan: 1 }, "");
  };
  const onTrap = () => {
    if (window.history.state?.lanshan !== 1) window.history.pushState({ lanshan: 1 }, "");
  };
  const onPop = () => {
    if (dismissOne()) queueMicrotask(pushIfNeeded);
  };
  pushIfNeeded();
  addEventListener("popstate", onPop);
  addEventListener("lanshan:trap-back", onTrap);
  const unsubs = [
    useGraph.subscribe(pushIfNeeded),
    useSettings.subscribe(pushIfNeeded),
    useHistory.subscribe(pushIfNeeded),
    useCite.subscribe(pushIfNeeded),
  ];
  return () => {
    removeEventListener("popstate", onPop);
    removeEventListener("lanshan:trap-back", onTrap);
    unsubs.forEach((u) => u());
  };
}

/**
 * 移动 App 返回栈。
 * Android：`onBackButtonPress` 接管（单页 history 管不到详情层）；注册失败才退回 history。
 * 其它（含 iOS）：history 哨兵 + trap-back。
 */
export function startBackStack(): () => void {
  if (!IS_MOBILE_APP) return () => {};

  if (!isAndroid) return startHistorySentinel();

  let cancelled = false;
  let unreg: (() => void) | undefined;
  let stopFallback: (() => void) | undefined;

  void onBackButtonPress(() => {
    if (dismissOne()) return;
    void exit(0);
  }).then((listener) => {
    if (cancelled) {
      void listener.unregister();
      return;
    }
    unreg = () => { void listener.unregister(); };
  }).catch(() => {
    if (!cancelled) stopFallback = startHistorySentinel();
  });

  return () => {
    cancelled = true;
    unreg?.();
    stopFallback?.();
  };
}
