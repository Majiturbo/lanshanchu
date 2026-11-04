import { ArrowRight, Columns2, Copy, FileDown, Link2, Maximize, MessageSquarePlus, PanelRightOpen, RefreshCw, X, type LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePresence } from "../components/presence.ts";
import { IS_MOBILE_APP, IS_TOUCH_UI } from "../core/device.ts";
import { fileName, nodesMd, treeOrder } from "../lib/export.ts";
import { short } from "../lib/format.ts";
import { copyText, saveMarkdown } from "../lib/save.ts";
import { rootOf } from "../history/snapshot.ts";
import { actions, fit, isReady, useGraph } from "../store/graph.ts";
import type { GNode } from "../store/types.ts";

/** 右键 / 长按位置：屏幕坐标、对应的画布坐标，以及点中的节点（空白处为 null） */
export interface MenuAt { x: number; y: number; wx: number; wy: number; nodeId: string | null; text: string }

interface Item { icon: LucideIcon; label: string; run: () => void; danger?: boolean }

function itemsFor(at: MenuAt, ask: () => void, connect: () => void): Item[][] {
  const { nodes, selected } = useGraph.getState();
  const n = at.nodeId ? nodes[at.nodeId] : null;
  const copy: Item[] = at.text ? [{ icon: Copy, label: "复制", run: () => void copyText(at.text) }] : [];
  if (n?.kind === "question") return [copy, [{ icon: ArrowRight, label: "回答这个问题", run: () => actions.ask(n.id) }]];
  if (n) {
    const close: Item[] = n.parent ? [{ icon: X, label: "关闭", run: () => actions.close(n.id), danger: true }] : [];
    if (!isReady(n)) return [copy, close];
    const many = selected.includes(n.id) ? selected.map((id) => nodes[id]).filter(isReady) : [];
    // 移动首版不做触屏多选，「导出选中」隐藏；拖放连接用「连接到…」
    const exportSelected = !IS_TOUCH_UI && many.length > 1
      ? [{ icon: FileDown, label: `导出选中的 ${many.length} 个节点`, run: () => void saveMarkdown(fileName(mapTitle()), nodesMd(many, mapTitle()), "selection") }]
      : [];
    const connectItem: Item[] = IS_TOUCH_UI
      ? [{ icon: Link2, label: "连接到…", run: connect }]
      : [];
    return [copy, [
      { icon: PanelRightOpen, label: "打开详情", run: () => actions.openDrawer(n.id) },
      { icon: RefreshCw, label: "重新回答", run: () => actions.retry(n.id) },
      ...(n.compareOf ? [] : [{ icon: Columns2, label: compareLabel(n), run: () => actions.compare(n.id) }]),
      ...connectItem,
    ], [
      { icon: FileDown, label: "导出", run: () => void saveMarkdown(fileName(n.q), nodesMd([n]), "node") },
      ...exportSelected,
    ], close];
  }
  const all = treeOrder(nodes);
  return [[
    { icon: MessageSquarePlus, label: "新建问题", run: ask },
  ], all.length ? [
    { icon: FileDown, label: "导出", run: () => void saveMarkdown(fileName(mapTitle()), nodesMd(all, mapTitle()), "map") },
  ] : [], [
    { icon: Maximize, label: "适应画布", run: fit },
  ]];
}

const compareLabel = (n: GNode) => (n.sources.length ? "断网对比" : "联网对比");
const mapTitle = () => rootOf(useGraph.getState().nodes)?.q ?? "阑珊处";

function useClamp(x: number, y: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(8, Math.min(x, innerWidth - r.width - 8)), y: Math.max(8, Math.min(y, innerHeight - r.height - 8)) });
  }, [x, y]);
  return { ref, pos };
}

/** 画布的右键 / 长按菜单：移动端为底部动作表 */
export function ContextMenu({ at, onClose, externalAsk = null, onExternalAskDone }: {
  at: MenuAt | null;
  onClose: () => void;
  externalAsk?: MenuAt | null;
  onExternalAskDone?: () => void;
}) {
  const [asking, setAsking] = useState<MenuAt | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const shown = useRef(at);
  if (at) shown.current = at;
  const p = usePresence(!!at, 120);

  useEffect(() => {
    if (!at) return;
    dispatchEvent(new CustomEvent("lanshan:trap-back"));
    const down = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest(".ctx-menu, .ctx-sheet, .ctx-ask, .ctx-pick")) onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const dismiss = () => onClose();
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    addEventListener("blur", dismiss);
    addEventListener("resize", dismiss);
    addEventListener("lanshan:dismiss-menu", dismiss);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key);
      removeEventListener("blur", dismiss);
      removeEventListener("resize", dismiss);
      removeEventListener("lanshan:dismiss-menu", dismiss);
    };
  }, [at, onClose]);

  return createPortal(
    <>
      {p.mounted && shown.current && (
        <Menu
          at={shown.current}
          closing={p.closing}
          onClose={onClose}
          onAsk={() => setAsking(shown.current)}
          onConnect={() => {
            const id = shown.current?.nodeId;
            onClose();
            if (id) setConnectFrom(id);
          }}
        />
      )}
      {(asking || externalAsk) && (
        <AskHere
          at={(asking ?? externalAsk)!}
          onDone={() => { setAsking(null); onExternalAskDone?.(); }}
        />
      )}
      {connectFrom ? <ConnectPick from={connectFrom} onDone={() => setConnectFrom(null)} /> : null}
    </>,
    document.body,
  );
}

function Menu({ at, closing, onClose, onAsk, onConnect }: {
  at: MenuAt;
  closing: boolean;
  onClose: () => void;
  onAsk: () => void;
  onConnect: () => void;
}) {
  const sheet = IS_MOBILE_APP || IS_TOUCH_UI;
  const { ref, pos } = useClamp(at.x, at.y);
  const groups = itemsFor(at, onAsk, onConnect).filter((g) => g.length);
  useEffect(() => { ref.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, [ref]);
  if (!groups.length) return null;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const list = [...ref.current!.querySelectorAll<HTMLButtonElement>("button")];
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    list[(i + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length]?.focus();
  };
  const body = groups.map((g, i) => (
    <div key={i} className="ctx-group" role="group">
      {g.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          className={`ctx-item${it.danger ? " is-danger" : ""}`}
          onClick={() => { onClose(); it.run(); }}
        >
          <it.icon size={14} strokeWidth={1.6} aria-hidden="true" />
          {it.label}
        </button>
      ))}
    </div>
  ));
  if (sheet) {
    return (
      <div className={`ctx-sheet${closing ? " is-closing" : ""}`} role="menu" onContextMenu={(e) => e.preventDefault()}>
        <div className="ctx-sheet-scrim" aria-hidden="true" onClick={onClose} />
        <div ref={ref} className="ctx-sheet-panel" onKeyDown={onKey}>
          <div className="ctx-sheet-handle" aria-hidden="true" />
          {body}
          <button type="button" className="ctx-item ctx-cancel" onClick={onClose}>取消</button>
        </div>
      </div>
    );
  }
  return (
    <div ref={ref} className={`ctx-menu${closing ? " is-closing" : ""}`} role="menu" style={{ left: pos.x, top: pos.y }} onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()}>
      {body}
    </div>
  );
}

/** 右键空白处「新建问题」：在点击的位置弹出输入框，回车后在那里长出一棵新的树 */
function AskHere({ at, onDone }: { at: MenuAt; onDone: () => void }) {
  const [text, setText] = useState("");
  const { ref, pos } = useClamp(at.x, at.y);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // 移动端不自动聚焦，避免立刻顶起键盘挡住「取消」
    if (!IS_MOBILE_APP) input.current?.focus();
  }, []);
  useEffect(() => {
    const dismiss = () => onDone();
    addEventListener("lanshan:dismiss-menu", dismiss);
    return () => removeEventListener("lanshan:dismiss-menu", dismiss);
  }, [onDone]);
  const submit = () => {
    const q = text.trim();
    if (!q) return;
    onDone();
    actions.startHere(q, at.wx, at.wy);
  };
  return (
    <div ref={ref} className={`ctx-ask${IS_MOBILE_APP ? " is-sheet" : ""}`} style={IS_MOBILE_APP ? undefined : { left: pos.x, top: pos.y }}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <MessageSquarePlus className="ctx-ask-icon" size={14} strokeWidth={1.6} aria-hidden="true" />
        <input
          ref={input}
          value={text}
          maxLength={500}
          placeholder="新问题"
          aria-label="新问题"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") onDone(); }}
          onBlur={() => { if (!text.trim() && !IS_MOBILE_APP) onDone(); }}
        />
        <button type="submit" className="slot-send" aria-label="提问" disabled={!text.trim()}>
          <ArrowRight size={14} strokeWidth={1.8} />
        </button>
      </form>
      {IS_MOBILE_APP && <button type="button" className="ctx-item ctx-cancel" onClick={onDone}>取消</button>}
    </div>
  );
}

/** 触控下拖放连接的菜单替代：选目标节点后与来源一起选中，弹出综合指令 */
function ConnectPick({ from, onDone }: { from: string; onDone: () => void }) {
  const nodes = useGraph((s) => s.nodes);
  const targets = Object.values(nodes).filter((n) => n.id !== from && isReady(n));
  useEffect(() => {
    dispatchEvent(new CustomEvent("lanshan:trap-back"));
    const dismiss = () => onDone();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onDone(); };
    addEventListener("lanshan:dismiss-menu", dismiss);
    addEventListener("keydown", key);
    return () => {
      removeEventListener("lanshan:dismiss-menu", dismiss);
      removeEventListener("keydown", key);
    };
  }, [onDone]);
  return createPortal(
    <div className="ctx-pick" role="dialog" aria-label="连接到节点">
      <div className="ctx-sheet-scrim" onClick={onDone} />
      <div className="ctx-sheet-panel">
        <div className="ctx-sheet-handle" aria-hidden="true" />
        <p className="ctx-pick-title">连接到…</p>
        {targets.length === 0 ? (
          <p className="ctx-pick-empty">暂无其他可连接的回答。</p>
        ) : (
          <div className="ctx-group" role="list">
            {targets.map((n) => (
              <button
                key={n.id}
                type="button"
                className="ctx-item"
                onClick={() => {
                  onDone();
                  actions.setSelected([from, n.id]);
                }}
              >
                <Link2 size={14} strokeWidth={1.6} aria-hidden="true" />
                {short(n.q, 28)}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="ctx-item ctx-cancel" onClick={onDone}>取消</button>
      </div>
    </div>,
    document.body,
  );
}

