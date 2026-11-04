import { AlignLeft, ArrowLeft, ChevronRight, Ellipsis, FileDown, History as HistoryIcon, Maximize, MessageSquarePlus, Minus, Plus, Settings, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Canvas, useCrumbs } from "../canvas/Canvas.tsx";
import { IS_MOBILE_APP, IS_TOUCH_UI } from "../core/device.ts";
import { rootOf } from "../history/snapshot.ts";
import { history, useHistory } from "../history/store.ts";
import { fileName, nodesMd, treeOrder } from "../lib/export.ts";
import { short } from "../lib/format.ts";
import { saveMarkdown } from "../lib/save.ts";
import { screenTransition, swapScreen } from "../lib/transition.ts";
import { drawerCss, settingsActions, useSettings } from "../settings/store.ts";
import { actions, fit, isReady, useGraph, zoomAt } from "../store/graph.ts";
import { CitePopover } from "./CitePopover.tsx";
import { CommandPalette } from "./CommandPalette.tsx";
import { MobileSearchSwitch, SearchToggle } from "./common.tsx";
import { PrefsFields, PrefsMenu } from "./PrefsMenu.tsx";
import { Drawer } from "./Drawer.tsx";
import { HistoryButton } from "./History.tsx";
import { SummarySheet } from "./SummarySheet.tsx";
import { drag, WindowControls } from "./TitleBar.tsx";
import { usePresence } from "./presence.ts";
import "../styles/workspace.css";

type MobileSheet = "menu" | "prefs" | "path" | null;

function Topbar() {
  const crumbs = useCrumbs();
  const hasAnswers = useGraph((s) => Object.values(s.nodes).some(isReady));
  const drawerId = useGraph((s) => s.drawerId);
  const reading = useGraph((s) => s.reading);
  const [sheet, setSheet] = useState<MobileSheet>(null);
  const sheetP = usePresence(!!sheet);

  useEffect(() => {
    if (!sheet) return;
    dispatchEvent(new CustomEvent("lanshan:trap-back"));
    const dismiss = () => setSheet(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSheet(null); };
    addEventListener("lanshan:dismiss-overflow", dismiss);
    addEventListener("lanshan:dismiss-menu", dismiss);
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("lanshan:dismiss-overflow", dismiss);
      removeEventListener("lanshan:dismiss-menu", dismiss);
      removeEventListener("keydown", onKey);
    };
  }, [sheet]);

  const onBack = () => {
    if (reading) return actions.closeReader();
    if (drawerId) return actions.closeDrawer();
    actions.leave(() => swapScreen(actions.goHome));
  };
  const backLabel = reading
    ? (reading.back === "map" ? "返回地图" : "返回详情")
    : drawerId ? "关闭详情" : "回到首页";

  return (
    <header className="topbar" {...drag}>
      <button type="button" className="icon-btn topbar-back" aria-label={backLabel} data-replay-id="back" onClick={onBack}>
        <ArrowLeft size={16} strokeWidth={1.6} />
      </button>
      <span className="topbar-sep" aria-hidden="true" {...drag} />
      {IS_MOBILE_APP ? (
        <button type="button" className="topbar-current" onClick={() => setSheet("path")}>
          <span>{short((crumbs[crumbs.length - 1]?.q ?? "").replace(/[？?]$/, ""), 16) || "知识地图"}</span>
          {crumbs.length > 1 ? <ChevronRight size={14} strokeWidth={1.6} aria-hidden="true" /> : null}
        </button>
      ) : (
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
      )}
      {IS_MOBILE_APP ? (
        <div className="topbar-actions">
          <button
            type="button"
            className="icon-btn topbar-more-btn"
            aria-label="更多"
            aria-expanded={!!sheet}
            onClick={() => setSheet((s) => (s ? null : "menu"))}
          >
            <Ellipsis size={16} strokeWidth={1.6} />
          </button>
          {sheetP.mounted && createPortal(
            <div className={`mobile-sheet${sheetP.closing ? " is-closing" : ""}`} role="dialog" aria-label={sheet === "prefs" ? "回答偏好" : sheet === "path" ? "当前路径" : "画布菜单"}>
              <div className="mobile-sheet-scrim" onClick={() => setSheet(null)} />
              <div className="mobile-sheet-panel">
                <div className="mobile-sheet-handle" aria-hidden="true" />
                {sheet === "path" ? (
                  <>
                    <p className="mobile-sheet-title">当前路径</p>
                    <div className="ctx-group">
                      {crumbs.map((n, i) => (
                        <button key={n.id} type="button" className="mobile-sheet-item" onClick={() => { setSheet(null); actions.activate(n.id); }}>
                          <span>{n.q}</span>
                          {i === crumbs.length - 1 ? <span className="meta">当前</span> : null}
                        </button>
                      ))}
                    </div>
                    <button type="button" className="mobile-sheet-item mobile-sheet-cancel" onClick={() => setSheet(null)}>取消</button>
                  </>
                ) : sheet === "prefs" ? (
                  <>
                    <p className="mobile-sheet-title">回答偏好</p>
                    <div className="mobile-sheet-prefs">
                      <PrefsFields onDone={() => setSheet(null)} />
                    </div>
                    <button type="button" className="mobile-sheet-item mobile-sheet-cancel" onClick={() => setSheet(null)}>完成</button>
                  </>
                ) : (
                  <>
                    {/* 每一行统一：图标 + 文字，联网用开关行 */}
                    <MobileSearchSwitch className="mobile-sheet-switch" />
                    <button type="button" className="mobile-sheet-item" onClick={() => setSheet("prefs")}>
                      <SlidersHorizontal size={16} strokeWidth={1.6} aria-hidden="true" />
                      回答偏好
                    </button>
                    <button type="button" className="mobile-sheet-item" disabled={!hasAnswers} onClick={() => { setSheet(null); actions.openSummary(); }}>
                      <AlignLeft size={16} strokeWidth={1.6} aria-hidden="true" />
                      总结
                    </button>
                    <button type="button" className="mobile-sheet-item" onClick={() => { setSheet(null); history.openPanel(); }}>
                      <HistoryIcon size={16} strokeWidth={1.6} aria-hidden="true" />
                      历史记录
                    </button>
                    <button type="button" className="mobile-sheet-item" onClick={() => { setSheet(null); dispatchEvent(new CustomEvent("lanshan:new-question")); }}>
                      <MessageSquarePlus size={16} strokeWidth={1.6} aria-hidden="true" />
                      新建问题
                    </button>
                    <button type="button" className="mobile-sheet-item" onClick={() => { setSheet(null); fit(); }}>
                      <Maximize size={16} strokeWidth={1.6} aria-hidden="true" />
                      适应画布
                    </button>
                    <button
                      type="button"
                      className="mobile-sheet-item"
                      disabled={!hasAnswers}
                      onClick={() => {
                        setSheet(null);
                        const nodes = useGraph.getState().nodes;
                        const all = treeOrder(nodes);
                        if (!all.length) return;
                        const title = rootOf(nodes)?.q ?? "阑珊处";
                        void saveMarkdown(fileName(title), nodesMd(all, title), "map");
                      }}
                    >
                      <FileDown size={16} strokeWidth={1.6} aria-hidden="true" />
                      导出
                    </button>
                    <button type="button" className="mobile-sheet-item mobile-sheet-cancel" onClick={() => setSheet(null)}>取消</button>
                  </>
                )}
              </div>
            </div>,
            document.body,
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
      if (useSettings.getState().open || useHistory.getState().open || useSettings.getState().gate) return;
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

  // 移动端不保留多选框选态显示：进画布就清掉遗留选中
  useEffect(() => {
    if (!IS_MOBILE_APP) return;
    if (useGraph.getState().selected.length) actions.setSelected([]);
  }, []);

  const [intro] = useState(() => {
    const vt = screenTransition();
    // hero 用形变；其余一律淡入（含无 View Transition 的 WebView），避免闪现
    return vt === "hero" ? "enter-hero" : "enter-self";
  });

  return (
    <div className={`workspace ${intro}${drawer ? " has-drawer" : ""}`} style={{ "--drawer-w": drawerCss(drawerRatio) } as React.CSSProperties}>
      <Topbar />
      <Canvas />
      <CommandPalette />
      <Drawer />
      {!IS_MOBILE_APP && <ZoomControls />}
      <SummarySheet />
      <CitePopover />
    </div>
  );
}
