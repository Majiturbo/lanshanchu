import { ArrowLeft, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { IS_MOBILE_APP } from "../core/device.ts";
import {
  login,
  loginWithCode,
  registerWithPhone,
  resetPassword,
  sendSms,
  type SmsPurpose,
} from "../core/platform.ts";
import { ProviderError } from "../core/providers/types.ts";
import { track } from "../analytics/index.ts";
import { loginFrom, settingsActions, useSettings } from "../settings/store.ts";
import { openMobileSettingsPage } from "./MobileSettings.tsx";
import { NAV_MS, useNavCover } from "./navMotion.ts";
import { AccountSection } from "./SettingsDialog.tsx";
import { usePresence } from "./presence.ts";

/** 移动端独立全屏登录 / 额度页 */
export function AuthScreen() {
  const gate = useSettings((s) => s.gate);
  const p = usePresence(!!gate, NAV_MS);
  useNavCover(p.mounted, p.closing);
  if (!IS_MOBILE_APP || !p.mounted || !gate) return null;
  return <Screen kind={gate} closing={p.closing} />;
}

function Screen({ kind, closing }: { kind: "login" | "quota"; closing: boolean }) {
  const account = useSettings((s) => s.account);
  const session = useSettings((s) => s.session);
  // 未登录时登录页不能 Esc / 返回关掉，必须先登录
  const lockLogin = kind === "login" && !session;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (lockLogin) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      settingsActions.closeGate();
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [lockLogin]);

  useEffect(() => {
    if (kind === "login" && account?.id) settingsActions.closeGate();
  }, [kind, account]);

  return (
    <div className={`auth-screen${closing ? " is-closing" : ""}`} role="dialog" aria-modal="true" aria-labelledby="auth-title">
      {kind === "login" ? <LoginFlow /> : <QuotaFlow />}
    </div>
  );
}

function QuotaFlow() {
  return (
    <>
      <header className="auth-head">
        <button type="button" className="icon-btn" aria-label="返回" onClick={settingsActions.closeGate}>
          <ArrowLeft size={18} strokeWidth={1.6} />
        </button>
        <h1 id="auth-title">额度</h1>
        <span className="auth-head-spacer" aria-hidden="true" />
      </header>
      <div className="auth-body">
        <p className="auth-lead">当前额度不足，无法继续提问。可查看用量，或稍后再试。购买入口即将开放。</p>
        <AccountSection
          hideLogout
          onPlans={() => {
            settingsActions.closeGate();
            queueMicrotask(() => openMobileSettingsPage("plans"));
          }}
        />
        <button
          type="button"
          className="btn auth-settings"
          onClick={() => {
            settingsActions.closeGate();
            queueMicrotask(() => openMobileSettingsPage());
          }}
        >
          打开设置
        </button>
      </div>
    </>
  );
}

type Pane = "password" | "sms" | "register" | "reset";

const PHONE = /^1\d{10}$/;

function digits(value: string) {
  return value.replace(/\D/g, "").slice(0, 11);
}

function maskPhone(phone: string) {
  return PHONE.test(phone) ? `${phone.slice(0, 3)}****${phone.slice(7)}` : phone;
}

function LoginFlow() {
  const [pane, setPane] = useState<Pane>("password");
  const [phone, setPhone] = useState("");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [left, setLeft] = useState(0);

  useEffect(() => {
    if (left <= 0) return;
    const timer = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [left]);

  const session = useSettings((s) => s.session);
  const back = () => {
    setError("");
    if (pane === "register" || pane === "reset") {
      setPane("password");
      setCode("");
      return;
    }
    if (!session) return;
    settingsActions.closeGate();
  };

  const fail = (err: unknown) => {
    setError(err instanceof ProviderError ? err.message : "登录失败");
  };

  const requestCode = async (purpose: SmsPurpose) => {
    if (busy || left > 0) return;
    if (!PHONE.test(phone)) {
      setError("请输入 11 位手机号");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await sendSms(phone, purpose);
      setSentTo(phone);
      setLeft(60);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (busy) return;
    setError("");
    if (pane === "password") {
      const name = account.trim();
      if (!name || !password) {
        setError("请输入账号和密码");
        return;
      }
      setBusy(true);
      const from = loginFrom();
      track("login_started", { from });
      try {
        await login(name, password);
        track("login_succeeded", { from });
      } catch (err) {
        track("login_failed", { from, error_code: err instanceof ProviderError ? err.kind : "other" });
        fail(err);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!PHONE.test(phone)) {
      setError("请输入 11 位手机号");
      return;
    }
    if (code.trim().length < 4) {
      setError("请输入验证码");
      return;
    }
    if ((pane === "register" || pane === "reset") && password.length < 10) {
      setError("密码至少 10 位");
      return;
    }
    setBusy(true);
    try {
      if (pane === "sms") await loginWithCode(phone, code);
      else if (pane === "register") await registerWithPhone(phone, code, password);
      else await resetPassword(phone, code, password);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const title = pane === "register" ? "注册" : pane === "reset" ? "重置密码" : "登录阑珊处";
  const lead = pane === "register"
    ? "用手机号注册账号"
    : pane === "reset"
      ? "通过绑定的手机号设置新密码"
      : "登录后即可提问";
  const purpose: SmsPurpose = pane === "register" ? "register" : pane === "reset" ? "reset" : "login";

  const showBack = pane === "register" || pane === "reset" || !!session;

  return (
    <>
      <header className="auth-head">
        {showBack ? (
          <button type="button" className="icon-btn" aria-label="返回" onClick={back}>
            <ArrowLeft size={18} strokeWidth={1.6} />
          </button>
        ) : (
          <span className="auth-head-spacer" aria-hidden="true" />
        )}
        <span className="auth-head-spacer" aria-hidden="true" />
      </header>
      <div className="auth-body">
        <div className="auth-brand">
          <h1 id="auth-title">{title}</h1>
          <p>{lead}</p>
        </div>
        {pane === "password" || pane === "sms" ? (
          <div className="auth-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={pane === "password"} className={pane === "password" ? "on" : ""} onClick={() => { setPane("password"); setError(""); }}>密码登录</button>
            <button type="button" role="tab" aria-selected={pane === "sms"} className={pane === "sms" ? "on" : ""} onClick={() => { setPane("sms"); setError(""); }}>验证码登录</button>
          </div>
        ) : null}
        <form className="auth-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          {pane === "password" ? (
            <label className="auth-well">
              <input aria-label="账号" value={account} autoComplete="username" maxLength={32} placeholder="手机号或用户名" onChange={(e) => setAccount(e.target.value)} />
            </label>
          ) : (
            <label className="auth-well">
              <input aria-label="手机号" inputMode="numeric" autoComplete="tel" maxLength={11} placeholder="11 位手机号" value={phone} onChange={(e) => setPhone(digits(e.target.value))} />
            </label>
          )}
          {pane !== "password" ? (
            <label className="auth-well">
              <input aria-label="验证码" inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder="验证码" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))} />
              <button type="button" className="auth-code" disabled={busy || left > 0} onClick={() => { void requestCode(purpose); }}>
                {left > 0 ? `${left}秒` : "获取验证码"}
              </button>
            </label>
          ) : null}
          {pane === "password" || pane === "register" || pane === "reset" ? (
            <label className="auth-well">
              <input
                aria-label={pane === "password" ? "密码" : "设置密码"}
                type={visible ? "text" : "password"}
                autoComplete={pane === "password" ? "current-password" : "new-password"}
                maxLength={128}
                placeholder={pane === "password" ? "密码" : "设置密码，至少 10 位"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button type="button" className="icon-btn" aria-label={visible ? "隐藏密码" : "显示密码"} onClick={() => setVisible((v) => !v)}>
                {visible ? <EyeOff size={16} strokeWidth={1.6} /> : <Eye size={16} strokeWidth={1.6} />}
              </button>
            </label>
          ) : null}
          {pane === "sms" && sentTo ? <p className="auth-sent">验证码已发送到 {maskPhone(sentTo)}</p> : null}
          {pane === "password" ? (
            <div className="auth-links">
              <button type="button" onClick={() => { setPane("reset"); setError(""); setPhone(PHONE.test(account) ? account : phone); }}>忘记密码？</button>
            </div>
          ) : null}
          {error ? <p className="field-error" role="alert">{error}</p> : null}
          <button type="submit" className="btn btn-primary auth-submit" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={16} strokeWidth={1.8} /> : null}
            {pane === "register" ? "注册并登录" : pane === "reset" ? "重置并登录" : "登录"}
          </button>
        </form>
        <div className="auth-foot">
          {pane === "register" ? (
            <span>已有账号？<button type="button" onClick={() => { setPane("password"); setError(""); }}>登录</button></span>
          ) : (
            <span>还没有账号？<button type="button" onClick={() => { setPane("register"); setError(""); }}>注册</button></span>
          )}
        </div>
      </div>
    </>
  );
}
