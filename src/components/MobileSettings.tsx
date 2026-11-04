import { ArrowLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useMemory } from "../memory/store.ts";
import { bindSettingsBack } from "../lib/backStack.ts";
import {
  bindPhone,
  changePhone,
  deleteAccount,
  logout,
  sendSms,
  type SmsPurpose,
} from "../core/platform.ts";
import { ProviderError } from "../core/providers/types.ts";
import { APP_VERSION, checkAppUpdate, type UpdateInfo } from "../lib/appUpdate.ts";
import { openExternal } from "../lib/external.ts";
import { AccountSection } from "./SettingsDialog.tsx";
import { MemorySection } from "./MemorySection.tsx";
import { NAV_MS, useNavCover, useStackNav } from "./navMotion.ts";
import { PlanMark } from "./PlanMark.tsx";
import { usePresence } from "./presence.ts";
import { settingsActions, THEMES, useSettings, type Settings } from "../settings/store.ts";
import { toast } from "../store/toast.ts";

const PHONE = /^1\d{10}$/;

type Page = "root" | "account" | "memory" | "look" | "canvas" | "update" | "bind" | "change" | "delete";

const TITLES: Record<Page, string> = {
  root: "设置",
  account: "账号与用量",
  memory: "记忆",
  look: "外观",
  canvas: "画布与来源",
  update: "检查更新",
  bind: "绑定手机号",
  change: "更换手机号",
  delete: "注销账号",
};

/** 购买尚未开放：只提示，不进二级页 */
export function noticePlansSoon() {
  toast("购买套餐即将开放");
}

function digits(value: string) {
  return value.replace(/\D/g, "").slice(0, 11);
}

function maskPhone(phone: string) {
  return PHONE.test(phone) ? `${phone.slice(0, 3)}****${phone.slice(7)}` : "";
}

let pendingPage: Page | null = null;

/** 打开移动端设置，可选直达子页（额度页跳转套餐等） */
export function openMobileSettingsPage(page?: Page) {
  pendingPage = page ?? null;
  settingsActions.open("manual");
  if (page) {
    queueMicrotask(() => {
      window.dispatchEvent(new CustomEvent("lanshan:settings-page", { detail: page }));
    });
  }
}

export function MobileSettingsHost() {
  const open = useSettings((s) => s.open);
  const p = usePresence(open, NAV_MS);
  useNavCover(p.mounted, p.closing);
  if (!p.mounted) return null;
  return <MobileSettings closing={p.closing} />;
}

function MobileSettings({ closing }: { closing: boolean }) {
  const initial: Page[] = (() => {
    if (!pendingPage) return ["root"];
    const target = pendingPage;
    pendingPage = null;
    return ["root", target];
  })();
  const { stack, stackRef, phase, outgoing, push, pop, replace } = useStackNav<Page>(initial);
  const page = stack[stack.length - 1] ?? "root";
  const under = stack.length >= 2 ? stack[stack.length - 2]! : null;
  const accountId = useSettings((s) => s.account?.id ?? "");

  useEffect(() => {
    dispatchEvent(new CustomEvent("lanshan:trap-back"));
  }, [stack.length]);

  useEffect(() => {
    const onPage = (e: Event) => {
      const target = (e as CustomEvent<Page>).detail;
      if (!target) return;
      pendingPage = null;
      replace(["root", target]);
    };
    addEventListener("lanshan:settings-page", onPage);
    return () => removeEventListener("lanshan:settings-page", onPage);
  }, [replace]);

  useEffect(() => {
    if (accountId) return;
    const top = stackRef.current[stackRef.current.length - 1];
    if (top === "account" || top === "bind" || top === "change" || top === "delete") {
      replace(["root"]);
    }
  }, [accountId, replace, stackRef]);

  useEffect(() => {
    // 必须用 ref 判断深度：Android 返回来自原生回调，setState updater 可能延后，不能靠副作用里改标志
    return bindSettingsBack(() => pop());
  }, [pop]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pop()) return;
      settingsActions.close();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [pop]);

  const back = () => {
    if (!pop()) settingsActions.close();
  };

  const renderPage = (id: Page): ReactNode => {
    if (id === "root") return <RootPage push={push} />;
    if (id === "account") return <AccountPage push={push} />;
    if (id === "memory") return <MemorySection />;
    if (id === "look") return <LookPage />;
    if (id === "canvas") return <CanvasPage />;
    if (id === "update") return <UpdatePage />;
    if (id === "bind") return <BindPage onDone={back} />;
    if (id === "change") return <ChangePage onDone={back} />;
    if (id === "delete") return <DeletePage onDone={() => { settingsActions.close(); }} />;
    return null;
  };

  const underClass = [
    "nav-pane",
    "is-under",
    phase === "push" ? "is-push-under" : "",
  ].filter(Boolean).join(" ");
  const frontClass = [
    "nav-pane",
    "is-front",
    under || outgoing ? "" : "is-alone",
    phase === "push" ? "is-push-in" : "",
    phase === "pop" ? "is-pop-reveal" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={`auth-screen mset${closing ? " is-closing" : ""}`}>
      <header className="auth-head">
        <button type="button" className="icon-btn" aria-label="返回" onClick={back}>
          <ArrowLeft size={18} strokeWidth={1.6} />
        </button>
        <h1 key={page} className="auth-title-swap">{TITLES[page]}</h1>
        <span className="auth-head-spacer" aria-hidden="true" />
      </header>
      <div className="nav-stack">
        {under ? (
          <div className={underClass} aria-hidden="true">
            <div className="nav-pane-body">{renderPage(under)}</div>
          </div>
        ) : null}
        <div className={frontClass}>
          <div className="nav-pane-body">{renderPage(page)}</div>
        </div>
        {outgoing ? (
          <div className="nav-pane is-front is-pop-out" aria-hidden="true">
            <div className="nav-pane-body">{renderPage(outgoing)}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RootPage({ push }: { push: (page: Page) => void }) {
  const account = useSettings((s) => s.account);
  const usage = useSettings((s) => s.usage);
  const canAsk = useSettings((s) => s.canAsk);
  const theme = useSettings((s) => s.theme);
  const openSource = useSettings((s) => s.openSource);
  const memoryOn = useMemory((s) => s.enabled);
  const planLabel = usage?.planLabel || "";
  const status = !account
    ? "登录 / 注册"
    : !planLabel
      ? "尚未开通套餐"
      : canAsk || usage?.canAsk
        ? "额度充足"
        : "额度已用完";
  const themeLabel = THEMES.find(([value]) => value === theme)?.[1] ?? "跟随系统";

  return (
    <>
      <button type="button" className="mset-account" onClick={() => (account ? push("account") : settingsActions.open("login"))}>
        <span className="mset-account-copy">
          <span className="mset-account-name">
            {account ? (account.nickname || account.username) : "登录 / 注册"}
            {account ? <PlanMark plan={usage?.plan || planLabel} /> : null}
          </span>
          <span className="mset-account-status">{account ? status : "登录后即可提问"}</span>
        </span>
        <ChevronRight size={16} strokeWidth={1.6} aria-hidden="true" />
      </button>
      <button type="button" className="mset-row" onClick={noticePlansSoon}>
        <span>购买套餐</span>
        <em>即将开放</em>
      </button>
      <div className="mset-group">
        <button type="button" className="mset-row" onClick={() => push("memory")}>
          <span>记忆</span>
          <em>{memoryOn ? "开启" : "关闭"}</em>
          <ChevronRight size={16} strokeWidth={1.6} aria-hidden="true" />
        </button>
        <button type="button" className="mset-row" onClick={() => push("look")}>
          <span>外观</span>
          <em>{themeLabel}</em>
          <ChevronRight size={16} strokeWidth={1.6} aria-hidden="true" />
        </button>
        <button type="button" className="mset-row" onClick={() => push("canvas")}>
          <span>画布与来源</span>
          <em>{openSource === "reader" ? "应用内阅读" : "系统浏览器"}</em>
          <ChevronRight size={16} strokeWidth={1.6} aria-hidden="true" />
        </button>
        <button type="button" className="mset-row" onClick={() => push("update")}>
          <span>检查更新</span>
          <em>{APP_VERSION}</em>
          <ChevronRight size={16} strokeWidth={1.6} aria-hidden="true" />
        </button>
      </div>
    </>
  );
}

function AccountPage({ push }: { push: (page: Page) => void }) {
  const account = useSettings((s) => s.account);
  const phone = account?.phone && PHONE.test(account.phone) ? account.phone : "";
  return (
    <div className="mset-account-page">
      <AccountSection hideLogout onPlans={noticePlansSoon} />
      <button type="button" className="mset-row" onClick={() => push(phone ? "change" : "bind")}>
        <span>手机号</span>
        <em>{phone ? maskPhone(phone) : "去绑定"}</em>
        <ChevronRight size={16} strokeWidth={1.6} aria-hidden="true" />
      </button>
      <button type="button" className="mset-row" disabled={!phone} onClick={() => phone && push("delete")}>
        <span>注销账号</span>
        <em>{phone ? "" : "需先绑定手机号"}</em>
        <ChevronRight size={16} strokeWidth={1.6} aria-hidden="true" />
      </button>
      <button type="button" className="mset-logout" onClick={() => { void logout(); }}>退出登录</button>
    </div>
  );
}

function LookPage() {
  const theme = useSettings((s) => s.theme);
  const petals = useSettings((s) => s.petals);
  const update = (patch: Partial<Settings>) => settingsActions.update(patch);
  return (
    <>
      <Choice label="明暗" value={theme} options={THEMES} onChange={(value) => update({ theme: value })} />
      <Choice label="首页灯火" value={petals ? "on" : "off"} options={[["on", "开启"], ["off", "关闭"]]} onChange={(value) => update({ petals: value === "on" })} />
    </>
  );
}

function CanvasPage() {
  const autoCollapse = useSettings((s) => s.autoCollapse);
  const autoDetail = useSettings((s) => s.autoDetail);
  const openSource = useSettings((s) => s.openSource);
  const onLeave = useSettings((s) => s.onLeave);
  const update = (patch: Partial<Settings>) => settingsActions.update(patch);
  return (
    <>
      <Choice label="切换节点时，上一个节点的要点" value={autoCollapse ? "collapse" : "keep"} options={[["keep", "保持展开"], ["collapse", "自动收起"]]} onChange={(value) => update({ autoCollapse: value === "collapse" })} />
      <Choice label="打开详情时生成详解" value={autoDetail ? "auto" : "manual"} options={[["manual", "手动生成"], ["auto", "自动生成"]]} onChange={(value) => update({ autoDetail: value === "auto" })} />
      <Choice label="点击来源时" value={openSource} options={[["reader", "应用内阅读"], ["browser", "系统浏览器"]]} onChange={(value) => update({ openSource: value })} />
      <Choice label="离开还在回答的地图时" value={onLeave} options={[["background", "后台继续"], ["ask", "每次询问"], ["stop", "终止"]]} onChange={(value) => update({ onLeave: value })} />
    </>
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map(([item, text]) => (
          <button key={item} type="button" role="radio" aria-checked={value === item} onClick={() => value !== item && onChange(item)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function UpdatePage() {
  const [busy, setBusy] = useState(true);
  const [info, setInfo] = useState<UpdateInfo | null>(null);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setInfo(null);
    try {
      setInfo(await checkAppUpdate());
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const ctrl = new AbortController();
    void checkAppUpdate(ctrl.signal)
      .then((next) => {
        if (!ctrl.signal.aborted) setInfo(next);
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (!ctrl.signal.aborted) setInfo({ status: "error", message: "检查失败，请稍后重试" });
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setBusy(false);
      });
    return () => ctrl.abort();
  }, []);

  return (
    <div className="mset-note">
      <p>当前版本 {APP_VERSION}</p>
      {busy && !info ? <p>正在检查…</p> : null}
      {info?.status === "latest" ? <p>已是最新版本。</p> : null}
      {info?.status === "available" ? (
        <>
          <p>发现新版本 {info.latest}。</p>
          <button type="button" className="btn auth-submit" onClick={() => openExternal(info.url)}>
            {info.hasApk ? "下载安装包" : "查看更新"}
          </button>
        </>
      ) : null}
      {info?.status === "error" ? <p>{info.message}</p> : null}
      <button type="button" className="btn" disabled={busy} onClick={() => void run()}>
        {busy ? "检查中…" : "重新检查"}
      </button>
    </div>
  );
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

function CodeButton({ left, busy, onClick }: { left: number; busy: boolean; onClick: () => void }) {
  return (
    <button type="button" className="auth-code" disabled={busy || left > 0} onClick={onClick}>
      {left > 0 ? `${left}秒` : "获取验证码"}
    </button>
  );
}

function BindPage({ onDone }: { onDone: () => void }) {
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
      setError(err instanceof ProviderError ? err.message : "验证码发送失败");
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
      setError(err instanceof ProviderError ? err.message : "绑定失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="auth-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <label className="auth-well">
        <input aria-label="手机号" inputMode="numeric" autoComplete="tel" maxLength={11} placeholder="11 位手机号" value={phone} onChange={(e) => setPhone(digits(e.target.value))} />
      </label>
      <label className="auth-well">
        <input aria-label="验证码" inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder="验证码" value={code} onChange={(e) => setCode(digits(e.target.value).slice(0, 8))} />
        <CodeButton left={left} busy={busy} onClick={() => { void send(); }} />
      </label>
      {error ? <p className="field-error" role="alert">{error}</p> : null}
      <button type="submit" className="btn btn-primary auth-submit" disabled={busy}>
        {busy ? <LoaderCircle className="spin" size={16} strokeWidth={1.8} /> : null}
        绑定
      </button>
    </form>
  );
}

function ChangePage({ onDone }: { onDone: () => void }) {
  const current = useSettings((s) => s.account?.phone || "");
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
      setError(err instanceof ProviderError ? err.message : "验证码发送失败");
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
      setError(err instanceof ProviderError ? err.message : "更换失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="auth-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <p className="auth-sent">当前手机号 {maskPhone(current)}</p>
      <label className="auth-well">
        <input aria-label="当前号码验证码" inputMode="numeric" maxLength={8} placeholder="当前号码验证码" value={oldCode} onChange={(e) => setOldCode(digits(e.target.value).slice(0, 8))} />
        <CodeButton left={oldLeft} busy={busy} onClick={() => { void send("phone-old", current, setOldLeft); }} />
      </label>
      <label className="auth-well">
        <input aria-label="新手机号" inputMode="numeric" autoComplete="tel" maxLength={11} placeholder="新的 11 位手机号" value={phone} onChange={(e) => setPhone(digits(e.target.value))} />
      </label>
      <label className="auth-well">
        <input aria-label="新号码验证码" inputMode="numeric" maxLength={8} placeholder="新号码验证码" value={code} onChange={(e) => setCode(digits(e.target.value).slice(0, 8))} />
        <CodeButton left={newLeft} busy={busy} onClick={() => { void send("phone-new", phone, setNewLeft); }} />
      </label>
      {error ? <p className="field-error" role="alert">{error}</p> : null}
      <button type="submit" className="btn btn-primary auth-submit" disabled={busy}>
        {busy ? <LoaderCircle className="spin" size={16} strokeWidth={1.8} /> : null}
        完成更换
      </button>
    </form>
  );
}

function DeletePage({ onDone }: { onDone: () => void }) {
  const phone = useSettings((s) => s.account?.phone || "");
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState("");
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
      setError(err instanceof ProviderError ? err.message : "验证码发送失败");
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    if (confirm !== "注销账号") { setError("请输入「注销账号」以确认"); return; }
    if (code.trim().length < 4) { setError("请输入验证码"); return; }
    setBusy(true);
    setError("");
    try {
      await deleteAccount(code);
      onDone();
    } catch (err) {
      setError(err instanceof ProviderError ? err.message : "注销失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="auth-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <p className="auth-lead">注销后账号和本站上的用量不可恢复。本机的历史地图仍留在这台设备上。</p>
      <label className="auth-well">
        <input aria-label="验证码" inputMode="numeric" maxLength={8} placeholder="验证码" value={code} onChange={(e) => setCode(digits(e.target.value).slice(0, 8))} />
        <CodeButton left={left} busy={busy} onClick={() => { void send(); }} />
      </label>
      <label className="auth-well">
        <input aria-label="确认注销" placeholder="输入「注销账号」" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </label>
      {error ? <p className="field-error" role="alert">{error}</p> : null}
      <button type="submit" className="btn btn-danger auth-submit" disabled={busy || confirm !== "注销账号"}>
        {busy ? <LoaderCircle className="spin" size={16} strokeWidth={1.8} /> : null}
        注销账号
      </button>
    </form>
  );
}
