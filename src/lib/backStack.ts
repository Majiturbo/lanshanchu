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
 * iOS 侧滑按业界 SPA 常见做法（Capacitor / WKWebView）：
 * 1. 打开 allowsBackForwardNavigationGestures，跟手快照由系统画
 * 2. 每一层可返回界面 push 一条 history；根页只用 replace
 * 3. 根页（depth=0）必须关掉手势——否则会右滑出白底或第二张主页
 * 4. scrollRestoration=manual，避免快照被滚动恢复打成空白
 * 5. 只在层数升降沿改 history，禁止每次 store 更新都 push（脏栈→卡顿/白屏）
 * 参考：https://jishuzhan.net/article/2010957812160577537
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

/** 根页之上的层数：一层对应一条可侧滑的 history */
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

function setNavGestures(enabled: boolean) {
  if (!IS_IOS_APP) return;
  void invoke("ios_set_nav_gestures", { enabled }).catch(() => {});
}

/**
 * iOS：系统侧滑 + 每层一条 history。
 * depth=0 时关掉手势，彻底杜绝「主页滑主页 / 白屏」。
 */
function startIosHistoryStack(): () => void {
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  // 丢掉脏栈，只留根
  window.history.replaceState({ lanshan: 0 }, "");
  setNavGestures(false);

  let depth = 0;
  let ignorePop = 0;
  let syncing = false;
  let gesturesOn = false;

  const applyGestures = (on: boolean) => {
    if (gesturesOn === on) return;
    gesturesOn = on;
    setNavGestures(on);
  };

  const sync = () => {
    if (syncing) return;
    const want = layerDepth();
    if (want === depth) {
      applyGestures(want > 0);
      return;
    }
    syncing = true;
    try {
      if (want > depth) {
        // 进入更深：每层 push，系统侧滑预览才能看到真实上一页而不是白屏
        while (depth < want) {
          depth++;
          window.history.pushState({ lanshan: depth }, "");
        }
      } else {
        // 按钮关掉上层：用 back/go 与侧滑共用同一条栈
        const steps = depth - want;
        depth = want;
        ignorePop += steps;
        if (steps === 1) window.history.back();
        else window.history.go(-steps);
      }
      applyGestures(want > 0);
    } finally {
      queueMicrotask(() => {
        syncing = false;
        if (ignorePop < 0) ignorePop = 0;
      });
    }
  };

  const onTrap = () => {
    queueMicrotask(sync);
  };

  const onPop = () => {
    if (ignorePop > 0) {
      ignorePop--;
      return;
    }
    // 系统侧滑已弹出一层
    if (depth > 0) depth--;
    applyGestures(depth > 0);
    if (dismissOne()) {
      queueMicrotask(() => {
        const want = layerDepth();
        // 只收敛计数，不再 push/back，避免和手势打架
        if (want !== depth) depth = want;
        applyGestures(depth > 0);
      });
      return;
    }
    // 已在根：补根条目并保持手势关闭
    ignorePop++;
    window.history.pushState({ lanshan: 0 }, "");
    depth = 0;
    applyGestures(false);
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
    setNavGestures(false);
  };
}

/** Android 失败回退：不启 WK 手势，只做单层哨兵 */
function startHistorySentinel(): () => void {
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  window.history.replaceState({ lanshan: 0 }, "");
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
  addEventListener("lanshan:trap-back", () => queueMicrotask(sync));
  const unsubs = [
    useGraph.subscribe(sync),
    useSettings.subscribe(sync),
    useHistory.subscribe(sync),
    useCite.subscribe(sync),
  ];
  return () => {
    removeEventListener("popstate", onPop);
    unsubs.forEach((u) => u());
  };
}

export function startBackStack(): () => void {
  if (!IS_MOBILE_APP) return () => {};

  if (IS_IOS_APP) return startIosHistoryStack();
  if (!isAndroid) return startHistorySentinel();

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
