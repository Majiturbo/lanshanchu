import { AlignLeft, ArrowLeft, ChevronRight, Ellipsis, Maximize, Minus, Plus, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { Canvas, useCrumbs } from "../canvas/Canvas.tsx";
import { IS_MOBILE_APP, IS_TOUCH_UI } from "../core/device.ts";
import { short } from "../lib/format.ts";
import { screenTransition, swapScreen } from "../lib/transition.ts";
import { history, useHistory } from "../history/store.ts";
import { drawerCss, settingsActions, useSettings } from "../settings/store.ts";
import { actions, fit, isReady, useGraph, zoomAt } from "../store/graph.ts";
import { CitePopover } from "./CitePopover.tsx";
import { CommandPalette } from "./CommandPalette.tsx";
import { SearchToggle } from "./common.tsx";
import { PrefsMenu } from "./PrefsMenu.tsx";
import { Drawer } from "./Drawer.tsx";
import { HistoryButton } from "./History.tsx";
import { SummarySheet } from "./SummarySheet.tsx";
import { drag, WindowControls } from "./TitleBar.tsx";
import { usePresence } from "./presence.ts";
import "../styles/workspace.css";

function Topbar() {
  const crumbs = useCrumbs();
  const hasAnswers = useGraph((s) => Object.values(s.nodes).some(isReady));
  const drawerId = useGraph((s) => s.drawerId);
  const reading = useGraph((s) => s.reading);
  const [more, setMore] = useState(false);
  const moreP = usePresence(more);

  useEffect(() => {
    if (!more) return;
    dispatchEvent(new CustomEvent("lanshan:trap-back"));
    const dismiss = () => setMore(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMore(false); };
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest(".topbar-overflow, .topbar-more-btn")) setMore(false);
    };
    addEventListener("lanshan:dismiss-overflow", dismiss);
    addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      removeEventListener("lanshan:dismiss-overflow", dismiss);
      removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [more]);

  const onBack = () => {
    if (reading) return actions.closeReader();
    if (drawerId) return actions.closeDrawer();
    actions.leave(() => swapScreen(actions.goHome));
  };
  const backLabel = reading ? "返回详情" : drawerId ? "关闭详情" : "回到首页";

  return (
    <header className="topbar" {...drag}>
      <button type="button" className="icon-btn topbar-back" aria-label={backLabel} data-replay-id="back" onClick={onBack}>
        <ArrowLeft size={16} strokeWidth={1.6} />
      </button>
      <span className="topbar-sep" aria-hidden="true" {...drag} />
      <nav className="crumbs" aria-label="当前路径" {...drag}>
        {crumbs.map((n, i) => (
          <span key={n.id} className="crumb-item">
            {i > 0 && <ChevronRight className="crumb-sep" size={13} strokeWidth={1.6} aria-hidden="true" />}
            <button type="button" className="crumb" aria-current={i === crumbs.length - 1 || undefined} onClick={() => actions.activate(n.id)}>
              {short(n.q.replace(/[？?]$/, ""), 18)}
            </button>
          </span>
        ))}
      </nav>
      {IS_MOBILE_APP ? (
        <div className="topbar-actions">
          <button
            type="button"
            className="icon-btn topbar-more-btn"
            aria-label="更多"
            aria-expanded={more}
            onClick={() => setMore((o) => !o)}
          >
            <Ellipsis size={16} strokeWidth={1.6} />
          </button>
          {moreP.mounted && (
            <div className={`topbar-overflow${moreP.closing ? " is-closing" : ""}`} role="menu">
              <SearchToggle compact />
              <PrefsMenu compact />
              <button type="button" className="ctx-item" role="menuitem" disabled={!hasAnswers} onClick={() => { setMore(false); actions.openSummary(); }}>
                <AlignLeft size={14} strokeWidth={1.6} />总结
              </button>
              <button type="button" className="ctx-item" role="menuitem" onClick={() => { setMore(false); history.openPanel(); }}>
                历史记录
              </button>
              <button type="button" className="ctx-item" role="menuitem" data-replay-id="settings" onClick={() => { setMore(false); settingsActions.open("manual"); }}>
                <Settings size={14} strokeWidth={1.6} />设置
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="topbar-actions">
          <SearchToggle compact />
          <PrefsMenu compact />
          <button type="button" className="btn" onClick={actions.openSummary} disabled={!hasAnswers}>
            <AlignLeft size={14} strokeWidth={1.6} />
            <span className="btn-label">总结</span>
          </button>
          <HistoryButton />
          <button type="button" className="icon-btn" aria-label="设置" data-replay-id="settings" onClick={() => settingsActions.open("manual")}>
            <Settings size={16} strokeWidth={1.6} />
          </button>
        </div>
      )}
      <WindowControls />
    </header>
  );
}

function ZoomControls() {
  const s = useGraph((st) => st.view.s);
  const drawer = useGraph((st) => !!st.drawerId);
  const center = () => [innerWidth / 2, innerHeight / 2] as const;
  return (
    <div className={`zoom${drawer ? " with-drawer" : ""}`} role="group" aria-label="缩放">
      {/* 框选依赖 Shift，空白拖是平移；不写出来用户会以为框选坏了。触屏首版不做框选，不显示 */}
      {!IS_TOUCH_UI && <span className="zoom-hint">Shift 框选</span>}
      {!IS_TOUCH_UI && <span className="zoom-sep" aria-hidden="true" />}
      <button type="button" className="icon-btn" aria-label="缩小" onClick={() => zoomAt(1 / 1.2, ...center(), true)}><Minus size={15} strokeWidth={1.6} /></button>
      <button type="button" className="zoom-value" aria-label="重置为 100%" onClick={() => zoomAt(1 / s, ...center(), true)}>{Math.round(s * 100)}%</button>
      <button type="button" className="icon-btn" aria-label="放大" onClick={() => zoomAt(1.2, ...center(), true)}><Plus size={15} strokeWidth={1.6} /></button>
      <span className="zoom-sep" aria-hidden="true" />
      <button type="button" className="icon-btn" aria-label="适应画布" onClick={fit}><Maximize size={14} strokeWidth={1.6} /></button>
    </div>
  );
}

export function Workspace() {
  const drawerRatio = useSettings((s) => s.drawerRatio);
  const drawer = useGraph((s) => !!s.drawerId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useGraph.getState();
      if (useSettings.getState().open || useHistory.getState().open) return; // 对话框自己处理按键
      if (e.key === "Escape") {
        if (s.summaryOpen) return actions.closeSummary();
        if (s.selected.length) return actions.setSelected([]);
        if (s.drawerId) return actions.closeDrawer();
        return;
      }
      if ((e.target as HTMLElement).matches("input, textarea")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        actions.setSelected(s.visible.filter((id) => isReady(s.nodes[id])));
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  // 挂载时定下进场方式并保持不变：在页面切换中挂载就交给过渡淡入，不再自己播动画
  const [intro] = useState(() => {
    const vt = screenTransition();
    return vt === "hero" ? "enter-hero" : vt ? "enter-vt" : "enter-self";
  });

  return (
    <div className={`workspace ${intro}${drawer ? " has-drawer" : ""}`} style={{ "--drawer-w": drawerCss(drawerRatio) } as React.CSSProperties}>
      <Topbar />
      <Canvas />
      <CommandPalette />
      <Drawer />
      <ZoomControls />
      <SummarySheet />
      <CitePopover />
    </div>
  );
}
