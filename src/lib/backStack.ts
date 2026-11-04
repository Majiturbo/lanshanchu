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
 * iOS 侧滑：学 Ionic / 原生栈导航，不学 WKWebView 前进后退手势。
 *
 * WK `allowsBackForwardNavigationGestures` 侧滑时露出的是浏览器 history 快照，
 * SPA 同一份文档里那张快照经常是空白——白屏/黑底/浅色露白都是同一根因，改窗口底色治标不治本。
 *
 * 正确做法（Ionic `createSwipeBackGesture` + 保留下层 DOM）：
 * 1. 永久关掉 WK 前进后退手势
 * 2. 左缘自管 touch 手势；有可返回层才启用
 * 3. 拖动时平移当前顶层（下层本就挂在 DOM：全屏页底下是首页/画布，设置二级底下是一级）
 * 4. 松手过半或够快则 dismissOne；否则弹回
 */

let settingsPop: ((fromSwipe: boolean) => boolean) | null = null;
let settingsDepth: (() => number) | null = null;
/** beginSwipeDismiss 期间为 true，设置栈走瞬时 pop，避免再播推出动画闪两页 */
let swipeDismissing = false;

export function bindSettingsBack(fn: (fromSwipe: boolean) => boolean, depth?: () => number) {
  settingsPop = fn;
  settingsDepth = depth ?? null;
  return () => {
    if (settingsPop === fn) settingsPop = null;
    if (settingsDepth === depth) settingsDepth = null;
  };
}

function popSettingsPage() {
  return settingsPop?.(swipeDismissing) ?? false;
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
    if (useCite.getState().open) closeCite({ force: true });
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
    closeCite({ force: true });
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

/** 是否有可侧滑关掉的一层（强制绑定不可滑关） */
function canSwipeBack(): boolean {
  if (needsPhoneBind(useSettings.getState().account)) return false;
  const g = useGraph.getState();
  const settings = useSettings.getState();
  if (settings.gate === "login" && !settings.session) return false;
  if (document.querySelector(".viewer:not(.is-closing)")) return true;
  if (document.querySelector(SHEET_SEL)) return true;
  if (document.querySelector(".prefs-pop:not(.is-closing), .topbar-overflow:not(.is-closing)")) return true;
  if (useCite.getState().open) return true;
  if (settings.gate) return true;
  if (g.leaving || g.reading || g.drawerId || g.summaryOpen) return true;
  if (settings.open) return true;
  if (useHistory.getState().open) return true;
  if (g.screen !== "home") return true;
  return false;
}

/**
 * 当前应被拖走的顶层节点。下层本就在 DOM 里，拖开即露出真实上一页，不靠 history 快照。
 */
function topSwipeTarget(): HTMLElement | null {
  const g = useGraph.getState();
  const settings = useSettings.getState();

  const viewer = document.querySelector<HTMLElement>(".viewer:not(.is-closing)");
  if (viewer) return viewer;

  const sheet = document.querySelector<HTMLElement>(
    ".cite-sheet, .mobile-sheet:not(.is-closing) .mobile-sheet-panel, .ctx-sheet:not(.is-closing) .ctx-sheet-panel, .command-sheet:not(.is-closing) .ctx-sheet-panel, .leave-sheet:not(.is-closing) .ctx-sheet-panel, .ctx-pick:not(.is-closing), .ctx-menu:not(.is-closing), .prefs-pop:not(.is-closing), .topbar-overflow:not(.is-closing)",
  );
  if (sheet) return sheet;

  if (g.leaving) {
    return document.querySelector<HTMLElement>(".leave-sheet:not(.is-closing) .ctx-sheet-panel, .dialog-layer:not(.is-closing)");
  }
  if (g.reading || g.drawerId) {
    return document.querySelector<HTMLElement>(".drawer[aria-hidden='false']");
  }
  if (g.summaryOpen) {
    return document.querySelector<HTMLElement>(".summary-screen:not(.is-closing), .auth-screen.summary-screen:not(.is-closing)");
  }
  if (settings.open) {
    // 设置二级：只拖 front pane，露出一级；一级：拖整页露出首页/画布
    if ((settingsDepth?.() ?? 1) > 1) {
      return document.querySelector<HTMLElement>(".mset .nav-pane.is-front");
    }
    return document.querySelector<HTMLElement>(".mset:not(.is-closing), .auth-screen.mset:not(.is-closing)");
  }
  if (useHistory.getState().open) {
    return document.querySelector<HTMLElement>(".hist-screen:not(.is-closing), .auth-screen.hist-screen:not(.is-closing)");
  }
  if (settings.gate) {
    return document.querySelector<HTMLElement>(".auth-screen:not(.is-closing)");
  }
  if (g.screen !== "home") {
    return document.querySelector<HTMLElement>(".workspace");
  }
  return null;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

/** 永久关闭 WK 前进后退手势——SPA 不能靠它做侧滑 */
function disableWkNavGestures() {
  if (!IS_IOS_APP) return;
  void invoke("ios_set_nav_gestures", { enabled: false }).catch(() => {});
}

/**
 * Ionic 式左缘侧滑：阈值 50、过半或速度 ≥0.2 完成。
 * 参考 ionic-team/ionic-framework `core/src/utils/gesture/swipe-back.ts`
 */
function startIosEdgeSwipe(): () => void {
  disableWkNavGestures();

  const EDGE = 50;
  const THRESHOLD = 10;

  let tracking = false;
  let armed = false;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastT = 0;
  let velocity = 0;
  let target: HTMLElement | null = null;
  let width = 0;
  let savedTransform = "";
  let savedTransition = "";
  let savedAnim = "";

  const clearInline = (el: HTMLElement) => {
    el.style.transform = savedTransform;
    el.style.transition = savedTransition;
    el.style.animation = savedAnim;
    el.style.opacity = "";
    el.style.pointerEvents = "";
    el.style.willChange = "";
  };

  const applyDrag = (el: HTMLElement, x: number) => {
    el.style.animation = "none";
    el.style.transition = "none";
    el.style.willChange = "transform";
    el.style.transform = `translate3d(${x}px,0,0)`;
  };

  /** 侧滑已把顶层拖走：禁止再播 is-closing / is-pop-out，否则会闪回整页再退一次。
   * 设置二级 front 会被 React 复用成一级——等提交后再清行内 transform，过早清会把二级瞬移回中间叠在一级上闪两页。 */
  const beginSwipeDismiss = (el: HTMLElement) => {
    const root = document.documentElement;
    root.dataset.swipeDismiss = "";
    swipeDismissing = true;
    dismissOne();
    swipeDismissing = false;
    const wipe = () => {
      el.style.transform = "";
      el.style.transition = "";
      el.style.animation = "";
      el.style.opacity = "";
      el.style.pointerEvents = "";
      el.style.willChange = "";
    };
    // 双 rAF：等内容从二级换成一级后再清，避免空白与闪两页
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        wipe();
        delete root.dataset.swipeDismiss;
      });
    });
    window.setTimeout(() => {
      wipe();
      delete root.dataset.swipeDismiss;
    }, 400);
  };

  const onStart = (e: TouchEvent) => {
    if (tracking || e.touches.length !== 1) return;
    if (!canSwipeBack()) return;
    const t = e.touches[0]!;
    if (t.clientX > EDGE) return;
    tracking = true;
    armed = false;
    startX = t.clientX;
    startY = t.clientY;
    lastX = startX;
    lastT = e.timeStamp;
    velocity = 0;
    target = null;
  };

  const onMove = (e: TouchEvent) => {
    if (!tracking || e.touches.length !== 1) return;
    const t = e.touches[0]!;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    const now = e.timeStamp;
    const dt = Math.max(1, now - lastT);
    velocity = (t.clientX - lastX) / dt;
    lastX = t.clientX;
    lastT = now;

    if (!armed) {
      if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
      // 纵向优先：交给页面滚动
      if (Math.abs(dy) > Math.abs(dx)) {
        tracking = false;
        return;
      }
      if (dx <= 0) {
        tracking = false;
        return;
      }
      if (!canSwipeBack()) {
        tracking = false;
        return;
      }
      target = topSwipeTarget();
      if (!target) {
        tracking = false;
        return;
      }
      armed = true;
      width = window.innerWidth || 1;
      savedTransform = target.style.transform;
      savedTransition = target.style.transition;
      savedAnim = target.style.animation;
    }

    e.preventDefault();
    const x = clamp(dx, 0, width);
    applyDrag(target!, x);
  };

  const finish = (shouldComplete: boolean, step: number) => {
    const el = target;
    tracking = false;
    armed = false;
    target = null;
    if (!el) return;

    const w = width || window.innerWidth || 1;
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      el.removeEventListener("transitionend", onTransEnd);
      fn();
    };
    const onTransEnd = () => settle(() => {
      if (shouldComplete) beginSwipeDismiss(el);
      else clearInline(el);
    });

    if (shouldComplete) {
      const missing = Math.max(0.01, 1 - step);
      const dur = clamp(missing * w / Math.max(0.15, Math.abs(velocity)), 120, 360);
      el.style.animation = "none";
      el.style.transition = `transform ${dur}ms ease-out`;
      el.style.transform = `translate3d(${w}px,0,0)`;
      el.addEventListener("transitionend", onTransEnd);
      window.setTimeout(() => settle(() => beginSwipeDismiss(el)), dur + 48);
    } else {
      const dur = clamp(step * w / Math.max(0.15, Math.abs(velocity)), 100, 280);
      el.style.animation = "none";
      el.style.transition = `transform ${dur}ms ease-out`;
      el.style.transform = savedTransform || "translate3d(0,0,0)";
      el.addEventListener("transitionend", onTransEnd);
      window.setTimeout(() => settle(() => clearInline(el)), dur + 48);
    }
  };

  const onEnd = () => {
    if (!tracking) return;
    if (!armed || !target) {
      tracking = false;
      armed = false;
      target = null;
      return;
    }
    const w = width || window.innerWidth || 1;
    const dx = Math.max(0, lastX - startX);
    const step = dx / w;
    // Ionic：velocity ≥ 0.2 或过半
    const shouldComplete = velocity >= 0 && (velocity > 0.2 || dx > w / 2);
    finish(shouldComplete, clamp(step, 0.01, 0.99));
  };

  const onCancel = () => {
    if (!tracking) return;
    if (armed && target) finish(false, clamp((lastX - startX) / (width || 1), 0.01, 0.99));
    else {
      tracking = false;
      armed = false;
      target = null;
    }
  };

  // 页面切层时确保 WK 手势不会被别处打开
  const keepOff = () => disableWkNavGestures();
  document.addEventListener("touchstart", onStart, { passive: true, capture: true });
  document.addEventListener("touchmove", onMove, { passive: false, capture: true });
  document.addEventListener("touchend", onEnd, { passive: true, capture: true });
  document.addEventListener("touchcancel", onCancel, { passive: true, capture: true });
  const unsubs = [
    useGraph.subscribe(keepOff),
    useSettings.subscribe(keepOff),
    useHistory.subscribe(keepOff),
    useCite.subscribe(keepOff),
  ];

  return () => {
    document.removeEventListener("touchstart", onStart, true);
    document.removeEventListener("touchmove", onMove, true);
    document.removeEventListener("touchend", onEnd, true);
    document.removeEventListener("touchcancel", onCancel, true);
    unsubs.forEach((u) => u());
    disableWkNavGestures();
  };
}

/** Android 失败回退：单层哨兵配合系统返回 */
function startHistorySentinel(): () => void {
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  window.history.replaceState({ lanshan: 0 }, "");
  let armed = false;
  let ignoring = false;
  const needBack = () => canSwipeBack();
  const sync = () => {
    const need = needBack();
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
    window.history.replaceState({ lanshan: 0 }, "");
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

  if (IS_IOS_APP) return startIosEdgeSwipe();
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
