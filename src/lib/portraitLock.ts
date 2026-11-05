import { needsPhoneBind } from "../components/PhoneBindGate.tsx";
import { IS_MOBILE_APP } from "../core/device.ts";
import { useHistory } from "../history/store.ts";
import { useSettings } from "../settings/store.ts";
import { useCite } from "../store/cite.ts";
import { useGraph } from "../store/graph.ts";
import { allowsLandscape, portraitLockAngle, viewportAngle, type OrientSurface } from "./portrait.ts";

const OVERLAY = [
  ".viewer:not(.is-closing)",
  ".mobile-sheet:not(.is-closing)",
  ".path-pop:not(.is-closing)",
  ".ctx-sheet:not(.is-closing)",
  ".ctx-menu:not(.is-closing)",
  ".ctx-ask",
  ".ctx-pick",
  ".command-sheet:not(.is-closing)",
  ".leave-sheet:not(.is-closing)",
  ".cite-sheet",
  ".prefs-pop:not(.is-closing)",
  ".topbar-overflow:not(.is-closing)",
  ".phone-bind-gate:not(.is-closing)",
].join(", ");

function surface(): OrientSurface {
  const g = useGraph.getState();
  const settings = useSettings.getState();
  return {
    mobile: true,
    screen: g.screen,
    drawer: !!g.drawerId,
    reading: !!g.reading,
    summary: g.summaryOpen,
    leaving: !!g.leaving,
    settings: settings.open,
    gate: !!settings.gate,
    phoneBind: needsPhoneBind(settings.account),
    history: useHistory.getState().open,
    cite: !!useCite.getState().open,
    overlay: !!document.querySelector(OVERLAY),
  };
}

function sync() {
  const root = document.documentElement;
  const angle = viewportAngle(screen.orientation?.angle, window.innerWidth, window.innerHeight);
  const lock = portraitLockAngle(allowsLandscape(surface()), angle);
  root.classList.toggle("is-portrait-locked", lock != null);
  if (lock == null) delete root.dataset.orient;
  else root.dataset.orient = String(lock);
}

/** 活动跟随传感器（不锁方向，系统才不会在左下角放横屏按钮）；非画布界面用转回竖屏的布局。 */
export function startPortraitLock(): () => void {
  if (!IS_MOBILE_APP) return () => {};
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      sync();
    });
  };
  sync();
  const onOrient = () => schedule();
  screen.orientation?.addEventListener("change", onOrient);
  window.addEventListener("resize", onOrient);
  const obs = new MutationObserver(schedule);
  obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  const unsubs = [
    useGraph.subscribe(schedule),
    useSettings.subscribe(schedule),
    useHistory.subscribe(schedule),
    useCite.subscribe(schedule),
  ];
  return () => {
    screen.orientation?.removeEventListener("change", onOrient);
    window.removeEventListener("resize", onOrient);
    obs.disconnect();
    unsubs.forEach((u) => u());
    if (frame) cancelAnimationFrame(frame);
    document.documentElement.classList.remove("is-portrait-locked");
    delete document.documentElement.dataset.orient;
  };
}
