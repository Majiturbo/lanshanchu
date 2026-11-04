import { invoke } from "@tauri-apps/api/core";
import { onBackButtonPress } from "@tauri-apps/api/app";
import { IS_IOS_APP, IS_MOBILE_APP } from "../core/device.ts";
import { history as mapHistory, useHistory } from "../history/store.ts";
import { needsPhoneBind } from "../components/PhoneBindGate.tsx";
import { settingsActions, useSettings } from "../settings/store.ts";
import { closeCite, useCite } from "../store/cite.ts";
import { actions, useGraph } from "../store/graph.ts";
import { swapScreen } from "./transition.ts";

/**
 * iOS 返回（针对本 App 的正确做法）：
 * - **关掉** WKWebView.allowsBackForwardNavigationGestures。
 *   单页里开它会在首页也能右滑，露出白底或另一张主页快照（用户截图）。
 * - 有上层时用左缘滑动调用 dismissOne，一次只关一层（对齐 UINavigationController 语义）。
 * - history 只做防误离页的单层哨兵，升降沿才改，禁止订阅里狂 push。
 */

let settingsPop: (() => boolean) | null = null;
let settingsDepth: (() => number) | null = null;

export function bindSettingsBack(fn: () => boolean, depth?: () => number) {
  settingsPop = fn;
  settingsDepth = depth ?? null;
  return () => {
    if (settingsPop === fn) settingsPop = null;
    if (settingsDepth === depth) settingsDepth = null;
  };
}

function popSettingsPage() {
  return settingsPop?.() ?? false;
}

const tauriPlatform = String(import.meta.env.TAURI_ENV_PLATFORM ?? "");
const isAndroid =
  tauriPlatform === "android"
  || (tauriPlatform !== "ios" && /Android/i.test(navigator.userAgent));

type AppBridge = { moveToBack: () => void };

function leaveToBackground() {
  if (!isAndroid) return;
  const bridge = (window as unknown as { LanshanApp?: AppBridge }).LanshanApp;
  try {
    bridge?.moveToBack?.();
  } catch {
    /* 桥未就绪 */
  }
  try {
    document.dispatchEvent(new CustomEvent("lanshan:move-to-back"));
  } catch {
    /* ignore */
  }
}

const SHEET_SEL = ".mobile-sheet:not(.is-closing), .ctx-menu:not(.is-closing), .ctx-sheet:not(.is-closing), .ctx-ask, .ctx-pick, .command-sheet:not(.is-closing), .leave-sheet:not(.is-closing), .cite-sheet";

export function dismissOne(): boolean {
  if (needsPhoneBind(useSettings.getState().account)) return true;
  const viewer = document.querySelector<HTMLElement>(".viewer:not(.is-closing) .viewer-close");
  if (viewer) {
    viewer.click();
    return true;
  }
  if (document.querySelector(SHEET_SEL)) {
    if (useCite.getState().open) closeCite();
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

function layerDepth(): number {
  const g = useGraph.getState();
  const settings = useSettings.getState();
  let n = 0;
  if (needsPhoneBind(settings.account) || settings.gate) n += 1;
  if (g.screen !== "home") n += 1;
  if (useHistory.getState().open) n += 1;
  if (settings.open) n += Math.max(1, settingsDepth?.() ?? 1);
  if (g.summaryOpen) n += 1;
  if (g.leaving) n += 1;
  if (g.drawerId) n += 1;
  if (g.reading) n += 1;
  if (useCite.getState().open) n += 1;
  if (document.querySelector(".mobile-sheet:not(.is-closing), .ctx-sheet:not(.is-closing), .ctx-pick, .command-sheet:not(.is-closing), .leave-sheet:not(.is-closing), .viewer:not(.is-closing)")) n += 1;
  return n;
}

/** 强制关掉 WK 原生前进/后退手势（首页绝不能再滑出白底/第二张主页） */
function disableWebKitNavGestures() {
  if (!IS_IOS_APP) return;
  void invoke("ios_set_nav_gestures", { enabled: false }).catch(() => {});
}

/**
 * 轻量哨兵：最多根上多一条。用内存 armed，避免 state 丢失时每帧 push。
 */
function startHistorySentinel(): () => void {
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  // 清掉脏栈：只保留当前这一条
  window.history.replaceState({ lanshan: 0 }, "");
  disableWebKitNavGestures();

  let armed = false;
  let ignoring = false;

  const sync = () => {
    const need = layerDepth() > 0;
    if (need === armed) return;
    if (need) {
      armed = true;
      if (window.history.state?.lanshan !== 1) window.history.pushState({ lanshan: 1 }, "");
      return;
    }
    armed = false;
    if (window.history.state?.lanshan === 1) {
      ignoring = true;
      window.history.replaceState({ lanshan: 0 }, "");
      ignoring = false;
    }
  };

  const onTrap = () => {
    queueMicrotask(sync);
  };

  const onPop = () => {
    if (ignoring) return;
    if (dismissOne()) {
      queueMicrotask(sync);
      return;
    }
    ignoring = true;
    window.history.pushState({ lanshan: 0 }, "");
    ignoring = false;
    armed = false;
    leaveToBackground();
  };

  sync();
  addEventListener("popstate", onPop);
  addEventListener("lanshan:trap-back", onTrap);
  const unsubs = [
    useGraph.subscribe(sync),
    useSettings.subscribe(sync),
    useHistory.subscribe(sync),
    useCite.subscribe(sync),
  ];
  return () => {
    removeEventListener("popstate", onPop);
    removeEventListener("lanshan:trap-back", onTrap);
    unsubs.forEach((u) => u());
  };
}

/**
 * 左缘滑动 = dismissOne，且仅当有上层。
 * 首页 depth=0 时直接忽略，不会出现滑主页/白屏。
 */
function startEdgeSwipeBack(): () => void {
  const EDGE = 22;
  const MIN_DX = 60;
  const MAX_DY = 36;
  let start: { x: number; y: number; t: number } | null = null;
  let tracking = false;
  let lastAt = 0;

  const onStart = (e: TouchEvent) => {
    tracking = false;
    if (e.touches.length !== 1) {
      start = null;
      return;
    }
    // 没有可关的层：不接手势（根页）
    if (layerDepth() <= 0) {
      start = null;
      return;
    }
    const t = e.touches[0];
    if (t.clientX > EDGE) {
      start = null;
      return;
    }
    start = { x: t.clientX, y: t.clientY, t: Date.now() };
  };
  const onMove = (e: TouchEvent) => {
    if (!start || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - start.x;
    const dy = Math.abs(t.clientY - start.y);
    if (!tracking) {
      if (dx < 10) return;
      if (dy >= dx) {
        start = null;
        return;
      }
      tracking = true;
    }
    if (tracking && dx > 10) e.preventDefault();
  };
  const onEnd = (e: TouchEvent) => {
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = Math.abs(t.clientY - start.y);
    const ok = tracking && dx >= MIN_DX && dy <= MAX_DY && Date.now() - start.t <= 700;
    start = null;
    tracking = false;
    if (!ok) return;
    if (layerDepth() <= 0) return;
    const now = Date.now();
    if (now - lastAt < 400) return;
    if (dismissOne()) lastAt = now;
  };
  const onCancel = () => {
    start = null;
    tracking = false;
  };

  addEventListener("touchstart", onStart, { passive: true, capture: true });
  addEventListener("touchmove", onMove, { passive: false, capture: true });
  addEventListener("touchend", onEnd, { passive: true, capture: true });
  addEventListener("touchcancel", onCancel, { passive: true, capture: true });
  return () => {
    removeEventListener("touchstart", onStart, true);
    removeEventListener("touchmove", onMove, true);
    removeEventListener("touchend", onEnd, true);
    removeEventListener("touchcancel", onCancel, true);
  };
}

export function startBackStack(): () => void {
  if (!IS_MOBILE_APP) return () => {};

  if (IS_IOS_APP || !isAndroid) {
    const stopSentinel = startHistorySentinel();
    const stopEdge = startEdgeSwipeBack();
    return () => {
      stopEdge();
      stopSentinel();
      disableWebKitNavGestures();
    };
  }

  let cancelled = false;
  let unreg: (() => void) | undefined;
  let stopFallback: (() => void) | undefined;
  let lastDismissAt = 0;

  void onBackButtonPress(() => {
    if (dismissOne()) {
      lastDismissAt = Date.now();
      return;
    }
    if (Date.now() - lastDismissAt < 450) return;
    leaveToBackground();
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
