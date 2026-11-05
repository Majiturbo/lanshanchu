import { useEffect, useRef, useState } from "react";
import { IS_MOBILE_APP } from "../core/device.ts";
import { IN_APP } from "../core/http.ts";
import { APP_VERSION, checkAppUpdate, type UpdateInfo } from "../lib/appUpdate.ts";
import { openExternal } from "../lib/external.ts";
import { useSettings } from "../settings/store.ts";
import { needsPhoneBind } from "./PhoneBindGate.tsx";
import { DialogCloseIcon, scrimClose } from "./DialogChrome.tsx";
import { usePresence } from "./presence.ts";

/** 发布版桌面打开后查一次。有新版本才弹窗；失败或已是最新不打扰。强制绑定未完成时先不弹。 */
export function UpdatePrompt() {
  const account = useSettings((s) => s.account);
  const [info, setInfo] = useState<Extract<UpdateInfo, { status: "available" }> | null>(null);
  const [open, setOpen] = useState(false);
  const blocked = needsPhoneBind(account);
  const p = usePresence(open && !blocked);

  useEffect(() => {
    if (!IN_APP || IS_MOBILE_APP || import.meta.env.DEV) return;
    const ctrl = new AbortController();
    void checkAppUpdate(ctrl.signal)
      .then((next) => {
        if (ctrl.signal.aborted || next.status !== "available") return;
        setInfo(next);
        setOpen(true);
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
      });
    return () => ctrl.abort();
  }, []);

  if (!p.mounted || !info) return null;
  return <Prompt info={info} closing={p.closing} onLater={() => setOpen(false)} />;
}

/** 叠在更新窗上面的层。它们还开着时，Esc 和回车留给那一层。 */
const ABOVE_UPDATE = ".viewer:not(.is-closing), .cite-pop:not(.is-closing), .cite-sheet:not(.is-closing)";

function Prompt({ info, closing, onLater }: { info: Extract<UpdateInfo, { status: "available" }>; closing: boolean; onLater: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const later = useRef(onLater);
  later.current = onLater;
  useEffect(() => {
    const covered = () => !!document.querySelector(ABOVE_UPDATE);
    if (!covered()) primaryRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      const inside = !!dialogRef.current?.contains(e.target as Node);
      if (e.key === "Escape") {
        if (covered()) return;
        e.preventDefault();
        e.stopPropagation();
        later.current();
        return;
      }
      if (e.key === "Enter" && !inside && !covered()) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onFocus = (e: FocusEvent) => {
      if (covered()) return;
      const target = e.target;
      if (!(target instanceof Node) || dialogRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".home-titlebar, .topbar, .window-controls")) return;
      queueMicrotask(() => {
        if (covered()) return;
        const now = document.activeElement;
        if (!(now instanceof Node) || dialogRef.current?.contains(now)) return;
        if (now instanceof Element && now.closest(".home-titlebar, .topbar, .window-controls")) return;
        primaryRef.current?.focus();
      });
    };
    addEventListener("keydown", onKey, true);
    addEventListener("focusin", onFocus, true);
    return () => {
      removeEventListener("keydown", onKey, true);
      removeEventListener("focusin", onFocus, true);
    };
  }, []);

  return (
    <div className={`dialog-layer is-update${closing ? " is-closing" : ""}`}>
      <div className="dialog-scrim" {...scrimClose(onLater)} />
      <div ref={dialogRef} className="dialog leave" role="alertdialog" aria-modal="true" aria-labelledby="update-title">
        <header className="dialog-head">
          <h2 id="update-title">发现新版本 {info.latest}</h2>
          <DialogCloseIcon onClose={onLater} label="稍后" />
        </header>
        <p className="update-current">当前版本 {APP_VERSION}</p>
        <footer className="dialog-foot">
          <button type="button" className="btn" onClick={onLater}>稍后</button>
          <button ref={primaryRef} type="button" className="btn btn-primary" onClick={() => openExternal(info.url)}>下载更新</button>
        </footer>
      </div>
    </div>
  );
}

/** 设置里手动再查一次。失败写在这里，不弹窗。 */
export function UpdateSection() {
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      setInfo(await checkAppUpdate());
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setInfo({ status: "error", message: "检查失败，请稍后重试" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="settings-section">
      <h3>版本</h3>
      <p className="account-usage">当前版本 {APP_VERSION}</p>
      {info?.status === "latest" ? <p className="account-usage">已是最新版本</p> : null}
      {info?.status === "available" ? <p className="account-usage">发现新版本 {info.latest}</p> : null}
      {info?.status === "error" ? <p className="field-error" role="alert">{info.message}</p> : null}
      <div className="field-actions">
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => { void run(); }}>
          {busy ? "检查中…" : "检查更新"}
        </button>
        {info?.status === "available" ? (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => openExternal(info.url)}>下载更新</button>
        ) : null}
      </div>
    </section>
  );
}
