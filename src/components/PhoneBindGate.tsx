import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
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

/** 旧账号未绑手机号时盖住整页，只能绑定或退出 */
export function PhoneBindGate() {
  const account = useSettings((s) => s.account);
  const need = IS_MOBILE_APP && needsPhoneBind(account);
  const p = usePresence(need);
  if (!p.mounted) return null;
  return <Gate closing={p.closing} />;
}

function Gate({ closing }: { closing: boolean }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [left, setLeft] = useState(0);

  useEffect(() => {
    document.documentElement.classList.add("phone-bind-locked");
    return () => document.documentElement.classList.remove("phone-bind-locked");
  }, []);

  useEffect(() => {
    if (left <= 0) return;
    const timer = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [left]);

  useEffect(() => {
    const block = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    addEventListener("keydown", block, true);
    return () => removeEventListener("keydown", block, true);
  }, []);

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
