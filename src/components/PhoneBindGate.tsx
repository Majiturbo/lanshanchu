import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { IS_MOBILE_APP } from "../core/device.ts";
import { bindPhone, logout, sendSms } from "../core/platform.ts";
import { ProviderError } from "../core/providers/types.ts";
import { useSettings, type Account } from "../settings/store.ts";
import { usePresence } from "./presence.ts";

const PHONE = /^1\d{10}$/;

export function needsPhoneBind(account: Account | null | undefined) {
  if (!account || account.role === "admin") return false;
  return !PHONE.test(String(account.phone || ""));
}

function digits(value: string) {
  return value.replace(/\D/g, "").slice(0, 11);
}

const GATE = ".phone-bind-gate, .dialog-layer.is-phone-bind";

/** 遮罩盖不住焦点和顶栏。捕获阶段拦住其它操作，只留绑定框、窗口按钮和标题栏空白拖动。 */
function bindTargetAllowed(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  if (target.closest(`${GATE}, .window-controls`)) return true;
  if (target.closest("button, a, input, textarea, select, [role='button']")) return false;
  return !!target.closest("[data-tauri-drag-region]");
}

/** 窗口按钮和标题栏空白留在外面，关闭和拖动仍可用。 */
const BLOCKED = [
  ".home-inner",
  ".home-titlebar-actions > :not(.window-controls)",
  ".topbar > :not(.window-controls)",
  ".workspace > :not(.topbar)",
  ".toast",
  ".dialog-layer:not(.is-phone-bind)",
  ".auth-screen",
].join(", ");

function setBlocked(on: boolean) {
  document.querySelectorAll<HTMLElement>(BLOCKED).forEach((el) => {
    if (on) el.setAttribute("inert", "");
    else el.removeAttribute("inert");
  });
}

function focusBindField() {
  document.querySelector<HTMLElement>(".dialog-layer.is-phone-bind input, .phone-bind-gate input")?.focus();
}

function usePhoneBindLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    document.documentElement.classList.add("phone-bind-locked");
    const stop = (e: Event) => {
      if (bindTargetAllowed(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
      if (bindTargetAllowed(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      focusBindField();
    };
    const onFocus = (e: FocusEvent) => {
      if (bindTargetAllowed(e.target)) return;
      // 正在聚焦的那次调用会盖掉同步的 focus()，等它结束再拉回绑定框
      queueMicrotask(() => {
        if (!bindTargetAllowed(document.activeElement)) focusBindField();
      });
    };
    addEventListener("pointerdown", stop, true);
    addEventListener("click", stop, true);
    addEventListener("keydown", onKey, true);
    addEventListener("focusin", onFocus, true);
    setBlocked(true);
    if (!bindTargetAllowed(document.activeElement)) focusBindField();
    return () => {
      setBlocked(false);
      document.documentElement.classList.remove("phone-bind-locked");
      removeEventListener("pointerdown", stop, true);
      removeEventListener("click", stop, true);
      removeEventListener("keydown", onKey, true);
      removeEventListener("focusin", onFocus, true);
    };
  }, [active]);
}

/** 旧账号未绑手机号时只能绑定或退出。移动端盖住整页；桌面盖住内容区，窗口仍可关闭。 */
export function PhoneBindGate() {
  const account = useSettings((s) => s.account);
  const p = usePresence(needsPhoneBind(account));
  usePhoneBindLock(p.mounted);
  if (!p.mounted) return null;
  return IS_MOBILE_APP ? <Gate closing={p.closing} /> : <DesktopGate closing={p.closing} />;
}

function Gate({ closing }: { closing: boolean }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [left, setLeft] = useState(0);

  useEffect(() => {
    if (left <= 0) return;
    const timer = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [left]);

  const send = async () => {
    if (!PHONE.test(phone)) { setError("请输入 11 位手机号"); return; }
    setBusy(true);
    setError("");
    try {
      await sendSms(phone, "bind");
      setLeft(60);
    } catch (err) {
      setError(err instanceof ProviderError ? err.message : "验证码发送失败");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!PHONE.test(phone) || code.trim().length < 4) {
      setError("请填写手机号和验证码");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await bindPhone(phone, code);
    } catch (err) {
      setError(err instanceof ProviderError ? err.message : "绑定失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`phone-bind-gate${closing ? " is-closing" : ""}`} role="dialog" aria-modal="true" aria-labelledby="phone-bind-title">
      <section className="phone-bind-sheet">
        <h2 id="phone-bind-title">绑定手机号</h2>
        <p>旧账号需要先绑定手机号，才能继续使用。这个窗口不能关闭。</p>
        <form className="auth-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <label className="auth-well">
            <input aria-label="手机号" inputMode="numeric" autoComplete="tel" maxLength={11} placeholder="11 位手机号" value={phone} onChange={(e) => setPhone(digits(e.target.value))} />
          </label>
          <label className="auth-well">
            <input aria-label="验证码" inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder="验证码" value={code} onChange={(e) => setCode(digits(e.target.value).slice(0, 8))} />
            <button type="button" className="auth-code" disabled={busy || left > 0} onClick={() => { void send(); }}>
              {left > 0 ? `${left}秒` : "获取验证码"}
            </button>
          </label>
          {error ? <p className="field-error" role="alert">{error}</p> : null}
          <button type="submit" className="btn btn-primary auth-submit" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={16} strokeWidth={1.8} /> : null}
            绑定并继续
          </button>
        </form>
        <button type="button" className="phone-bind-leave" onClick={() => { void logout(); }}>退出登录</button>
      </section>
    </div>
  );
}

/** 桌面：不能 Esc、点遮罩或「完成」关掉 */
function DesktopGate({ closing }: { closing: boolean }) {
  const phoneRef = useRef<HTMLInputElement>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [left, setLeft] = useState(0);

  useEffect(() => { phoneRef.current?.focus(); }, []);

  useEffect(() => {
    if (left <= 0) return;
    const timer = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [left]);

  const send = async () => {
    if (!PHONE.test(phone)) { setError("请输入 11 位手机号"); return; }
    setBusy(true);
    setError("");
    try {
      await sendSms(phone, "bind");
      setLeft(60);
    } catch (err) {
      setError(err instanceof ProviderError ? err.message : "验证码发送失败");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!PHONE.test(phone) || code.trim().length < 4) {
      setError("请填写手机号和验证码");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await bindPhone(phone, code);
    } catch (err) {
      setError(err instanceof ProviderError ? err.message : "绑定失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`dialog-layer is-phone-bind${closing ? " is-closing" : ""}`}>
      <div className="dialog-scrim" />
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="phone-bind-title">
        <header className="dialog-head">
          <h2 id="phone-bind-title">绑定手机号</h2>
        </header>
        <form className="dialog-body account-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <div className="field">
            <label className="field-label" htmlFor="gate-phone">手机号</label>
            <div className="key-input">
              <input id="gate-phone" ref={phoneRef} inputMode="numeric" autoComplete="tel" maxLength={11} value={phone} onChange={(e) => setPhone(digits(e.target.value))} />
            </div>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="gate-code">验证码</label>
            <div className="key-input">
              <input id="gate-code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(digits(e.target.value).slice(0, 8))} />
              <button type="button" className="key-code" disabled={busy || left > 0} onClick={() => { void send(); }}>
                {left > 0 ? `${left}秒` : "获取验证码"}
              </button>
            </div>
          </div>
          {error ? <p className="field-error" role="alert">{error}</p> : null}
          <div className="field-actions">
            <button type="button" className="btn btn-sm" onClick={() => { void logout(); }}>退出登录</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={13} strokeWidth={1.8} /> : null}
              绑定并继续
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
