import { exit, onBackButtonPress } from "@tauri-apps/api/app";
import { IS_MOBILE_APP } from "../core/device.ts";
import { history as mapHistory, useHistory } from "../history/store.ts";
import { settingsActions, useSettings } from "../settings/store.ts";
import { closeCite, useCite } from "../store/cite.ts";
import { actions, useGraph } from "../store/graph.ts";
import { swapScreen } from "./transition.ts";

/** 关闭一层浮层 / 详情 / 页面；有东西可关时返回 true（系统返回应留在 App 内） */
export function dismissOne(): boolean {
  const viewer = document.querySelector<HTMLElement>(".viewer:not(.is-closing) .viewer-close");
  if (viewer) {
    viewer.click();
    return true;
  }
  if (document.querySelector(".mobile-sheet:not(.is-closing), .ctx-menu:not(.is-closing), .ctx-sheet:not(.is-closing), .ctx-ask, .ctx-pick")) {
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
    settingsActions.closeGate();
    return true;
  }
  const g = useGraph.getState();
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

/**
 * 移动 App 返回栈。
 * Android：用 `onBackButtonPress` 接管（单页 App 的 history 哨兵经常管不到详情层）。
 * 其它：仍用 history 哨兵兜底。
 */
export function startBackStack(): () => void {
  if (!IS_MOBILE_APP) return () => {};

  let cancelled = false;
  let unreg: (() => void) | undefined;

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
    // 非 Android 或旧运行时：退回 history 哨兵
    if (cancelled) return;
    window.history.replaceState({ lanshan: 0 }, "");
    const pushIfNeeded = () => {
      const g = useGraph.getState();
      const need = !!(
        g.drawerId || g.reading || g.summaryOpen || g.screen !== "home"
        || useSettings.getState().open || useSettings.getState().gate
        || useHistory.getState().open || useCite.getState().open
        || document.querySelector(".mobile-sheet, .ctx-sheet, .viewer")
      );
      if (need && window.history.state?.lanshan !== 1) window.history.pushState({ lanshan: 1 }, "");
    };
    pushIfNeeded();
    const onPop = () => {
      if (dismissOne()) queueMicrotask(pushIfNeeded);
    };
    addEventListener("popstate", onPop);
    const unsubs = [
      useGraph.subscribe(pushIfNeeded),
      useSettings.subscribe(pushIfNeeded),
      useHistory.subscribe(pushIfNeeded),
      useCite.subscribe(pushIfNeeded),
    ];
    unreg = () => {
      removeEventListener("popstate", onPop);
      unsubs.forEach((u) => u());
    };
  });

  return () => {
    cancelled = true;
    unreg?.();
  };
}
