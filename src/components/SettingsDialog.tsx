import { Check, CircleAlert, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState, type Ref } from "react";
import { track } from "../analytics/index.ts";
import { CAN_FETCH, IN_APP } from "../core/http.ts";
import { VISIBLE_MODELS } from "../core/models.ts";
import { fetchUsage, login, logout, redeemReset, type UsagePayload } from "../core/platform.ts";
import { ProviderError } from "../core/providers/types.ts";
import { DialogCloseIcon, DialogDone, scrimClose } from "./DialogChrome.tsx";
import { usePresence } from "./presence.ts";
import { MemorySection } from "./MemorySection.tsx";
import { PlanMark } from "./PlanMark.tsx";
import { loginFrom, MOCK_MODE, settingsActions, THEMES, useSettings, type Settings } from "../settings/store.ts";

function formatResetAt(at: number): string {
  if (!at) return "使用后开始计时";
  const date = new Date(at * 1000);
  if (Number.isNaN(date.getTime())) return "使用后开始计时";
  return `${date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })} 后重置`;
}

function formatExpiresAt(at: number): string {
  if (!at) return "";
  const date = new Date(at * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour12: false })}到期`;
}

function UsageMeter({ label, pct, resetAt }: { label: string; pct: number; resetAt: number }) {
  const value = Math.max(0, Math.min(100, pct));
  const hot = value >= 90;
  return (
    <div className="usage-meter">
      <div className="usage-meter-top">
        <span className="usage-meter-label">{label}</span>
        <span className={`usage-meter-pct${hot ? " is-hot" : ""}`}>{value}%</span>
      </div>
      <div className="usage-meter-track" aria-hidden="true">
        <div className={`usage-meter-fill${hot ? " is-hot" : ""}`} style={{ width: `${value}%` }} />
      </div>
      <div className="usage-meter-reset">{formatResetAt(resetAt)}</div>
    </div>
  );
}

export function SettingsDialog() {
  const open = useSettings((s) => s.open);
  const p = usePresence(open);
  return p.mounted ? <Dialog closing={p.closing} /> : null;
}

function Dialog({ closing }: { closing: boolean }) {
  const model = useSettings((s) => s.model);
  const autoCollapse = useSettings((s) => s.autoCollapse);
  const autoDetail = useSettings((s) => s.autoDetail);
  const openSource = useSettings((s) => s.openSource);
  const onLeave = useSettings((s) => s.onLeave);
  const theme = useSettings((s) => s.theme);
  const petals = useSettings((s) => s.petals);
  const first = useRef<HTMLInputElement>(null);
  const [savedTick, setSavedTick] = useState(0);
  const update = (patch: Partial<Settings>) => {
    settingsActions.update(patch);
    setSavedTick((t) => t + 1);
  };

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") settingsActions.close(); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={`dialog-layer${closing ? " is-closing" : ""}`}>
      <div className="dialog-scrim" {...scrimClose(settingsActions.close)} />
      <div className="dialog settings" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="dialog-head">
          <h2 id="settings-title">设置</h2>
          <SavedBadge tick={savedTick} />
          <DialogCloseIcon onClose={settingsActions.close} label="关闭设置" />
        </header>

        <div className="dialog-body">
          {!IN_APP && (MOCK_MODE || !CAN_FETCH) && (
            <p className="settings-banner" role="status">
              <CircleAlert size={14} strokeWidth={1.8} />
              <span>{MOCK_MODE ? "当前为开发示例模式，回答使用示例数据。" : "浏览器无法登录平台，请在桌面应用中使用。"}</span>
            </p>
          )}

          <div className="settings-cols">
            <div className="settings-col">
            <section className="settings-section">
              <h3>账号</h3>
              <AccountSection inputRef={first} />
              {VISIBLE_MODELS.length > 1 && (
                <div className="field">
                  <span className="field-label" id="model-label">模型</span>
                  <div className="segmented" role="radiogroup" aria-labelledby="model-label">
                    {VISIBLE_MODELS.map((m) => (
                      <button key={m.id} type="button" role="radio" aria-checked={model === m.id} onClick={() => model !== m.id && update({ model: m.id })}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>
            <MemorySection />
            </div>
            <div className="settings-col">
            <section className="settings-section">
              <h3>外观</h3>
              <div className="field">
                <span className="field-label" id="theme-label">明暗</span>
                <div className="segmented" role="radiogroup" aria-labelledby="theme-label">
                  {THEMES.map(([v, label]) => (
                    <button key={v} type="button" role="radio" aria-checked={theme === v} onClick={() => theme !== v && update({ theme: v })}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span className="field-label" id="petals-label">首页灯火</span>
                <div className="segmented" role="radiogroup" aria-labelledby="petals-label">
                  {([[true, "开启"], [false, "关闭"]] as const).map(([v, label]) => (
                    <button key={label} type="button" role="radio" aria-checked={petals === v} onClick={() => petals !== v && update({ petals: v })}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </section>
            <section className="settings-section">
              <h3>画布与来源</h3>
              <div className="field">
                <span className="field-label" id="collapse-label">切换节点时，上一个节点的要点</span>
                <div className="segmented" role="radiogroup" aria-labelledby="collapse-label">
                  {([[false, "保持展开"], [true, "自动收起"]] as const).map(([v, label]) => (
                    <button key={label} type="button" role="radio" aria-checked={autoCollapse === v} onClick={() => autoCollapse !== v && update({ autoCollapse: v })}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span className="field-label" id="detail-label">打开详情时生成详解</span>
                <div className="segmented" role="radiogroup" aria-labelledby="detail-label">
                  {([[false, "手动生成"], [true, "自动生成"]] as const).map(([v, label]) => (
                    <button key={label} type="button" role="radio" aria-checked={autoDetail === v} onClick={() => autoDetail !== v && update({ autoDetail: v })}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span className="field-label" id="open-source-label">点击来源时</span>
                <div className="segmented" role="radiogroup" aria-labelledby="open-source-label">
                  {([["browser", "系统浏览器打开"], ["reader", "侧边栏阅读视图"]] as const).map(([v, label]) => (
                    <button key={v} type="button" role="radio" aria-checked={openSource === v} onClick={() => openSource !== v && update({ openSource: v })}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span className="field-label" id="leave-label">离开还在回答的地图时</span>
                <div className="segmented" role="radiogroup" aria-labelledby="leave-label">
                  {([["background", "后台继续"], ["ask", "每次询问"], ["stop", "终止"]] as const).map(([v, label]) => (
                    <button key={v} type="button" role="radio" aria-checked={onLeave === v} onClick={() => onLeave !== v && update({ onLeave: v })}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </section>
            </div>
          </div>
        </div>
        <DialogDone onClose={settingsActions.close} />
      </div>
    </div>
  );
}

function AccountSection({ inputRef }: { inputRef: Ref<HTMLInputElement> }) {
  const account = useSettings((s) => s.account);
  const canAsk = useSettings((s) => s.canAsk);
  const cached = useSettings((s) => s.usage);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [usage, setUsage] = useState<UsagePayload | null>(cached);
  const [usageReady, setUsageReady] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState("");

  useEffect(() => {
    if (!account) {
      setUsage(null);
      setUsageReady(false);
      return;
    }
    // store 已有快照时先展示，避免闪「正在读取」；再拉一次对齐服务端
    if (cached) {
      setUsage(cached);
      setUsageReady(true);
    } else {
      setUsageReady(false);
    }
    let cancelled = false;
    void fetchUsage().then((next) => {
      if (cancelled || !next) return;
      setUsage(next);
      setUsageReady(true);
      setResetError("");
    });
    return () => { cancelled = true; };
  }, [account]);

  // 打开设置后若提问等路径更新了 store 用量，跟进本地展示
  useEffect(() => {
    if (!account || !cached) return;
    setUsage(cached);
    setUsageReady(true);
  }, [account, cached]);

  if (account) {
    const view = usage ?? cached;
    const planLabel = view?.planLabel || (view?.plan ? view.plan : "");
    const expires = formatExpiresAt(view?.planExpiresAt ?? 0);
    const status = !planLabel
      ? "请联系管理员开通月租套餐"
      : canAsk || view?.canAsk
        ? "额度充足，可继续提问"
        : "额度已用完，请等待恢复";
    const resetsAvailable = view?.resetsAvailable ?? 0;
    const canUseReset = Boolean(view?.canUseReset);
    const onRedeemReset = async () => {
      if (resetBusy || resetsAvailable <= 0) return;
      setResetBusy(true);
      setResetError("");
      try {
        const next = await redeemReset();
        setUsage(next);
      } catch (err) {
        setResetError(err instanceof ProviderError ? err.message : "重置失败");
      } finally {
        setResetBusy(false);
      }
    };
    return (
      <div className="account-card">
        <div className="account-name-row">
          <span className="account-name">
            <span className="account-name-text">{account.nickname || account.username}</span>
            <PlanMark plan={view?.plan || planLabel} />
            <span className="account-remain">{planLabel || "尚未开通套餐"}</span>
          </span>
          {expires ? <span className="account-expire">{expires}</span> : null}
        </div>
        {!usageReady && !view ? (
          <div className="account-usage">正在读取用量</div>
        ) : view && planLabel ? (
          <div className="usage-block">
            <div className="usage-block-title">用量</div>
            <div className="usage-meters">
              <UsageMeter label="总使用量" pct={view.monthPct} resetAt={view.monthResetsAt} />
              <UsageMeter label="5 小时用量" pct={view.windowPct} resetAt={view.windowResetsAt} />
              <UsageMeter label="7 天用量" pct={view.weekPct} resetAt={view.weekResetsAt} />
            </div>
            {resetsAvailable > 0 ? (
              <div className="usage-reset-row">
                <span className="usage-reset-count">有 {resetsAvailable} 次重置可用</span>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={resetBusy}
                  aria-disabled={!canUseReset || resetBusy}
                  onClick={() => { void onRedeemReset(); }}
                >
                  {resetBusy ? "正在重置" : "使用重置"}
                </button>
              </div>
            ) : null}
            {resetError ? <div className="account-usage is-error" role="alert">{resetError}</div> : null}
          </div>
        ) : null}
        <div className="account-usage">{status}</div>
        <div className="field-actions">
          <button type="button" className="btn btn-sm" onClick={() => { void logout(); }}>退出</button>
        </div>
      </div>
    );
  }

  const submit = async () => {
    if (!CAN_FETCH || busy) return;
    const from = loginFrom();
    track("login_started", { from });
    setBusy(true);
    setError("");
    try {
      await login(username, password);
      setPassword("");
      track("login_succeeded", { from });
    } catch (err) {
      track("login_failed", { from, error_code: err instanceof ProviderError ? err.kind : "other" });
      setError(err instanceof ProviderError ? err.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="account-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="field">
        <label className="field-label" htmlFor="login-user">账号</label>
        <div className="key-input">
          <input id="login-user" ref={inputRef} value={username} autoComplete="username" maxLength={32} onChange={(e) => setUsername(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="login-pass">密码</label>
        <div className="key-input">
          <input
            id="login-pass"
            type={visible ? "text" : "password"}
            value={password}
            autoComplete="current-password"
            maxLength={128}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="button" className="icon-btn" aria-label={visible ? "隐藏密码" : "显示密码"} onClick={() => setVisible((v) => !v)}>
            {visible ? <EyeOff size={15} strokeWidth={1.6} /> : <Eye size={15} strokeWidth={1.6} />}
          </button>
        </div>
      </div>
      {error && <p className="field-error">{error}</p>}
      <div className="field-actions">
        <button type="submit" className="btn btn-primary btn-sm" disabled={!CAN_FETCH || busy || !username.trim() || !password}>
          {busy ? <LoaderCircle className="spin" size={13} strokeWidth={1.8} /> : null}
          登录
        </button>
      </div>
    </form>
  );
}

function SavedBadge({ tick }: { tick: number }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!tick) return;
    setOn(true);
    const t = setTimeout(() => setOn(false), 1400);
    return () => clearTimeout(t);
  }, [tick]);
  return (
    <span className={`saved-badge${on ? " is-on" : ""}`} role="status" aria-live="polite">
      {on && <><Check size={13} strokeWidth={2} />已保存</>}
    </span>
  );
}
