import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useEffect, useState, type Ref } from "react";
import { track } from "../analytics/index.ts";
import { CAN_FETCH } from "../core/http.ts";
import {
  bindPhone,
  changePhone,
  deleteAccount,
  login,
  loginWithCode,
  registerWithPhone,
  resetPassword,
  sendSms,
  type SmsPurpose,
} from "../core/platform.ts";
import { ProviderError } from "../core/providers/types.ts";
import { loginFrom, useSettings } from "../settings/store.ts";
import { toast } from "../store/toast.ts";

const PHONE = /^1\d{10}$/;

type Pane = "password" | "sms" | "register" | "reset";
type Extra = "idle" | "bind" | "change" | "delete";

function digits(value: string, max = 11) {
  return value.replace(/\D/g, "").slice(0, max);
}

function maskPhone(phone: string) {
  return PHONE.test(phone) ? `${phone.slice(0, 3)}****${phone.slice(7)}` : phone;
}

function useCountdown() {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const timer = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [left]);
  return [left, setLeft] as const;
}

function failText(err: unknown, fallback: string) {
  return err instanceof ProviderError ? err.message : fallback;
}

function CodeField({
  label,
  value,
  left,
  busy,
  onChange,
  onSend,
}: {
  label: string;
  value: string;
  left: number;
  busy: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
}) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={`code-${label}`}>{label}</label>
      <div className="key-input">
        <input
          id={`code-${label}`}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={8}
          value={value}
          onChange={(e) => onChange(digits(e.target.value, 8))}
        />
        <button type="button" className="key-code" disabled={busy || left > 0} onClick={onSend}>
          {left > 0 ? `${left}秒` : "获取验证码"}
        </button>
      </div>
    </div>
  );
}

/** 桌面设置里的登录：密码、验证码、注册、重置密码，都留在账号区 */
export function DesktopLogin({ inputRef }: { inputRef?: Ref<HTMLInputElement> }) {
  const [pane, setPane] = useState<Pane>("password");
  const [account, setAccount] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [left, setLeft] = useCountdown();

  const go = (next: Pane) => {
    setPane(next);
    setError("");
    setCode("");
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
      setLeft(60);
    } catch (err) {
      setError(failText(err, "验证码发送失败"));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!CAN_FETCH || busy) return;
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
        setPassword("");
        track("login_succeeded", { from });
      } catch (err) {
        track("login_failed", { from, error_code: err instanceof ProviderError ? err.kind : "other" });
        setError(failText(err, "登录失败"));
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
      setPassword("");
    } catch (err) {
      setError(failText(err, pane === "register" ? "注册失败" : pane === "reset" ? "重置失败" : "登录失败"));
    } finally {
      setBusy(false);
    }
  };

  const purpose: SmsPurpose = pane === "register" ? "register" : pane === "reset" ? "reset" : "login";
  const submitLabel = pane === "register" ? "注册并登录" : pane === "reset" ? "重置并登录" : "登录";

  return (
    <form className="account-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      {pane === "password" || pane === "sms" ? (
        <div className="segmented" role="radiogroup" aria-label="登录方式">
          <button type="button" role="radio" aria-checked={pane === "password"} onClick={() => go("password")}>密码登录</button>
          <button type="button" role="radio" aria-checked={pane === "sms"} onClick={() => go("sms")}>验证码登录</button>
        </div>
      ) : (
        <button type="button" className="link-btn" onClick={() => go("password")}>返回登录</button>
      )}
      {pane === "password" ? (
        <div className="field">
          <label className="field-label" htmlFor="login-user">账号</label>
          <div className="key-input">
            <input id="login-user" ref={inputRef} value={account} autoComplete="username" maxLength={32} onChange={(e) => setAccount(e.target.value)} />
          </div>
        </div>
      ) : (
        <div className="field">
          <label className="field-label" htmlFor="login-phone">手机号</label>
          <div className="key-input">
            <input id="login-phone" ref={pane === "register" ? inputRef : undefined} inputMode="numeric" autoComplete="tel" maxLength={11} value={phone} onChange={(e) => setPhone(digits(e.target.value))} />
          </div>
        </div>
      )}
      {pane !== "password" ? (
        <CodeField label="验证码" value={code} left={left} busy={busy} onChange={setCode} onSend={() => { void requestCode(purpose); }} />
      ) : null}
      {pane === "password" || pane === "register" || pane === "reset" ? (
        <div className="field">
          <label className="field-label" htmlFor="login-pass">{pane === "password" ? "密码" : "设置密码"}</label>
          <div className="key-input">
            <input
              id="login-pass"
              type={visible ? "text" : "password"}
              value={password}
              autoComplete={pane === "password" ? "current-password" : "new-password"}
              maxLength={128}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="button" className="icon-btn" aria-label={visible ? "隐藏密码" : "显示密码"} onClick={() => setVisible((v) => !v)}>
              {visible ? <EyeOff size={15} strokeWidth={1.6} /> : <Eye size={15} strokeWidth={1.6} />}
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
      <div className="field-actions account-links">
        {pane === "password" ? (
          <button type="button" className="link-btn" onClick={() => { setPhone(PHONE.test(account) ? account : phone); go("reset"); }}>忘记密码？</button>
        ) : null}
        <button type="submit" className="btn btn-primary btn-sm" disabled={!CAN_FETCH || busy}>
          {busy ? <LoaderCircle className="spin" size={13} strokeWidth={1.8} /> : null}
          {submitLabel}
        </button>
      </div>
      {pane === "password" || pane === "sms" ? (
        <button type="button" className="link-btn" onClick={() => go("register")}>注册</button>
      ) : null}
    </form>
  );
}

/** 已登录：绑定或更换手机号、注销、购买套餐入口。额度重置仍在用量区。 */
export function DesktopAccountExtras() {
  const account = useSettings((s) => s.account);
  const phone = account?.phone && PHONE.test(account.phone) ? account.phone : "";
  const [mode, setMode] = useState<Extra>("idle");
  if (!account) return null;
  return (
    <div className="account-extra">
      {mode === "bind" ? <BindForm onDone={() => setMode("idle")} /> : null}
      {mode === "change" && phone ? <ChangeForm current={phone} onDone={() => setMode("idle")} /> : null}
      {mode === "delete" && phone ? <DeleteForm phone={phone} onDone={() => setMode("idle")} /> : null}
      {mode === "idle" ? (
        <>
          <div className="field">
            <span className="field-label">手机号</span>
            <div className="field-actions">
              <span className="account-usage">{phone ? maskPhone(phone) : "未绑定"}</span>
              <button type="button" className="btn btn-sm" onClick={() => setMode(phone ? "change" : "bind")}>{phone ? "更换" : "去绑定"}</button>
            </div>
          </div>
          <div className="field-actions">
            <button type="button" className="btn btn-sm" disabled={!phone} onClick={() => setMode("delete")}>注销账号</button>
            <button type="button" className="btn btn-sm" onClick={() => toast("购买套餐即将开放")}>购买套餐</button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function BindForm({ onDone }: { onDone: () => void }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [left, setLeft] = useCountdown();
  const send = async () => {
    if (!PHONE.test(phone)) { setError("请输入 11 位手机号"); return; }
    setBusy(true);
    setError("");
    try {
      await sendSms(phone, "bind");
      setLeft(60);
    } catch (err) {
      setError(failText(err, "验证码发送失败"));
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    if (!PHONE.test(phone) || code.trim().length < 4) { setError("请填写手机号和验证码"); return; }
    setBusy(true);
    setError("");
    try {
      await bindPhone(phone, code);
      onDone();
    } catch (err) {
      setError(failText(err, "绑定失败"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="account-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="field">
        <label className="field-label" htmlFor="bind-phone">手机号</label>
        <div className="key-input">
          <input id="bind-phone" inputMode="numeric" autoComplete="tel" maxLength={11} value={phone} onChange={(e) => setPhone(digits(e.target.value))} />
        </div>
      </div>
      <CodeField label="验证码" value={code} left={left} busy={busy} onChange={setCode} onSend={() => { void send(); }} />
      {error ? <p className="field-error" role="alert">{error}</p> : null}
      <div className="field-actions">
        <button type="button" className="link-btn" onClick={onDone}>返回</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>完成绑定</button>
      </div>
    </form>
  );
}

function ChangeForm({ current, onDone }: { current: string; onDone: () => void }) {
  const [oldCode, setOldCode] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [oldLeft, setOldLeft] = useCountdown();
  const [newLeft, setNewLeft] = useCountdown();
  const send = async (purpose: SmsPurpose, number: string, arm: (n: number) => void) => {
    if (!PHONE.test(number)) { setError("请输入 11 位手机号"); return; }
    setBusy(true);
    setError("");
    try {
      await sendSms(number, purpose);
      arm(60);
    } catch (err) {
      setError(failText(err, "验证码发送失败"));
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    if (oldCode.trim().length < 4 || !PHONE.test(phone) || code.trim().length < 4) {
      setError("请填写两个验证码和新手机号");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await changePhone(oldCode, phone, code);
      onDone();
    } catch (err) {
      setError(failText(err, "更换失败"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="account-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="field">
        <span className="field-label">当前手机号</span>
        <div className="key-input">
          <input aria-label="当前手机号" value={maskPhone(current)} readOnly />
        </div>
      </div>
      <CodeField label="当前号码验证码" value={oldCode} left={oldLeft} busy={busy} onChange={setOldCode} onSend={() => { void send("phone-old", current, setOldLeft); }} />
      <div className="field">
        <label className="field-label" htmlFor="new-phone">新手机号</label>
        <div className="key-input">
          <input id="new-phone" inputMode="numeric" autoComplete="tel" maxLength={11} value={phone} onChange={(e) => setPhone(digits(e.target.value))} />
        </div>
      </div>
      <CodeField label="新号码验证码" value={code} left={newLeft} busy={busy} onChange={setCode} onSend={() => { void send("phone-new", phone, setNewLeft); }} />
      {error ? <p className="field-error" role="alert">{error}</p> : null}
      <div className="field-actions">
        <button type="button" className="link-btn" onClick={onDone}>返回</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>完成更换</button>
      </div>
    </form>
  );
}

function DeleteForm({ phone, onDone }: { phone: string; onDone: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [left, setLeft] = useCountdown();
  const send = async () => {
    setBusy(true);
    setError("");
    try {
      await sendSms(phone, "delete");
      setLeft(60);
    } catch (err) {
      setError(failText(err, "验证码发送失败"));
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    if (code.trim().length < 4) { setError("请输入验证码"); return; }
    setBusy(true);
    setError("");
    try {
      await deleteAccount(code);
      onDone();
    } catch (err) {
      setError(failText(err, "注销失败"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="account-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <p className="account-usage">注销后这个账号不能再登录。这台设备上的知识地图还在。</p>
      <div className="field">
        <span className="field-label">当前手机号</span>
        <div className="key-input">
          <input aria-label="当前手机号" value={maskPhone(phone)} readOnly />
        </div>
      </div>
      <CodeField label="验证码" value={code} left={left} busy={busy} onChange={setCode} onSend={() => { void send(); }} />
      {error ? <p className="field-error" role="alert">{error}</p> : null}
      <div className="field-actions">
        <button type="button" className="link-btn" onClick={onDone}>返回</button>
        <button type="submit" className="btn btn-sm btn-danger" disabled={busy}>确认注销</button>
      </div>
    </form>
  );
}
