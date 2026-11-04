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
  if (document.querySelector(".ctx-menu:not(.is-closing), .ctx-sheet:not(.is-closing), .ctx-ask, .ctx-pick")) {
    document.dispatchEvent(new CustomEvent("lanshan:dismiss-menu"));
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

/** 是否还有需要系统返回拦截的一层（首页空态不拦截，让下一次返回退出 App） */
function shouldTrap(): boolean {
  if (document.querySelector(".viewer:not(.is-closing), .ctx-menu, .ctx-sheet, .ctx-ask, .ctx-pick, .prefs-pop, .topbar-overflow")) {
    return true;
  }
  if (useCite.getState().open) return true;
  const g = useGraph.getState();
  if (g.reading || g.drawerId || g.summaryOpen || g.screen !== "home") return true;
  if (useSettings.getState().open || useHistory.getState().open) return true;
  return false;
}

/** 有可关层时推一枚哨兵；首页空态不推，避免多按一次才能退出 */
export function ensureBackTrap() {
  if (!IS_MOBILE_APP) return;
  if (!shouldTrap()) return;
  if (window.history.state?.lanshan === 1) return;
  window.history.pushState({ lanshan: 1 }, "");
}

/**
 * 移动 App：用 history 哨兵接管 Android 返回。
 * 只在「有东西可关」时占一层；首页且无浮层时不占层，系统返回直接出 App。
 */
export function startBackStack(): () => void {
  if (!IS_MOBILE_APP) return () => {};
  window.history.replaceState({ lanshan: 0 }, "");
  ensureBackTrap();

  const onPop = () => {
    if (dismissOne()) {
      // 关掉一层后若还有层，再占哨兵，避免下一次返回直接出 App
      queueMicrotask(ensureBackTrap);
    }
  };

  const unsubs = [
    useGraph.subscribe(ensureBackTrap),
    useSettings.subscribe(ensureBackTrap),
    useHistory.subscribe(ensureBackTrap),
    useCite.subscribe(ensureBackTrap),
  ];
  addEventListener("popstate", onPop);
  addEventListener("lanshan:node-menu", ensureBackTrap);
  addEventListener("lanshan:trap-back", ensureBackTrap);

  return () => {
    removeEventListener("popstate", onPop);
    removeEventListener("lanshan:node-menu", ensureBackTrap);
    removeEventListener("lanshan:trap-back", ensureBackTrap);
    unsubs.forEach((u) => u());
  };
}
