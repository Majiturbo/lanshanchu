import { useEffect, useRef, useState } from "react";
import { IS_MOBILE_APP } from "../core/device.ts";
import { actions, useGraph } from "../store/graph.ts";
import { DialogCloseIcon, MAC_DIALOG, scrimClose } from "./DialogChrome.tsx";
import { usePresence } from "./presence.ts";

/** 离开还在回答的地图前的确认：终止，或在后台继续；取消 / 叉号 / Esc 即留在当前地图。可记住选择（设置里能改回来） */
export function LeaveDialog() {
  const leaving = useGraph((s) => s.leaving);
  const p = usePresence(!!leaving);
  const last = useRef(leaving);
  if (leaving) last.current = leaving;
  return p.mounted && last.current ? <Dialog count={last.current.count} closing={p.closing} /> : null;
}

function Dialog({ count, closing }: { count: number; closing: boolean }) {
  const [remember, setRemember] = useState(false);
  const primary = useRef<HTMLButtonElement>(null);
  const cancel = () => actions.resolveLeave(null);

  useEffect(() => {
    if (!IS_MOBILE_APP) primary.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cancel(); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  if (IS_MOBILE_APP) {
    return (
      <div className={`leave-sheet${closing ? " is-closing" : ""}`} role="alertdialog" aria-modal="true" aria-labelledby="leave-title">
        <div className="ctx-sheet-scrim" onClick={cancel} />
        <div className="ctx-sheet-panel leave-sheet-panel">
          <div className="ctx-sheet-handle" aria-hidden="true" />
          <h2 id="leave-title">还有 {count} 个问题正在回答</h2>
          <label className="leave-remember">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span>记住我的选择</span>
          </label>
          <button ref={primary} type="button" className="btn btn-primary leave-sheet-btn" onClick={() => actions.resolveLeave("background", remember)}>
            后台继续回答
          </button>
          <button type="button" className="btn btn-danger leave-sheet-btn" onClick={() => actions.resolveLeave("stop", remember)}>
            全部终止
          </button>
          <button type="button" className="ctx-item ctx-cancel" onClick={cancel}>取消</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`dialog-layer${closing ? " is-closing" : ""}`}>
      <div className="dialog-scrim" {...scrimClose(cancel)} />
      <div className="dialog leave" role="alertdialog" aria-modal="true" aria-labelledby="leave-title">
        <header className="dialog-head">
          <h2 id="leave-title">还有 {count} 个问题正在回答</h2>
          <DialogCloseIcon onClose={cancel} label="关闭，留在当前地图" />
        </header>
        <footer className="leave-foot">
          <label className="leave-remember">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span>记住我的选择</span>
          </label>
          {MAC_DIALOG && (
            <button type="button" className="btn" onClick={cancel}>取消</button>
          )}
          <button type="button" className="btn btn-danger" onClick={() => actions.resolveLeave("stop", remember)}>全部终止</button>
          <button ref={primary} type="button" className="btn btn-primary" onClick={() => actions.resolveLeave("background", remember)}>后台继续回答</button>
        </footer>
      </div>
    </div>
  );
}
