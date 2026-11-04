import { ArrowLeft } from "lucide-react";
import { useEffect } from "react";
import { IS_MOBILE_APP } from "../core/device.ts";
import { settingsActions, useSettings } from "../settings/store.ts";
import { AccountSection } from "./SettingsDialog.tsx";
import { usePresence } from "./presence.ts";

/** 移动端独立全屏登录 / 额度页：不是设置对话框的缩略版 */
export function AuthScreen() {
  const gate = useSettings((s) => s.gate);
  const p = usePresence(!!gate);
  if (!IS_MOBILE_APP || !p.mounted || !gate) return null;
  return <Screen kind={gate} closing={p.closing} />;
}

function Screen({ kind, closing }: { kind: "login" | "quota"; closing: boolean }) {
  const account = useSettings((s) => s.account);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") settingsActions.closeGate(); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (kind === "login" && account) settingsActions.closeGate();
  }, [kind, account]);

  return (
    <div className={`auth-screen${closing ? " is-closing" : ""}`} role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <header className="auth-head">
        <button type="button" className="icon-btn" aria-label="返回" onClick={settingsActions.closeGate}>
          <ArrowLeft size={18} strokeWidth={1.6} />
        </button>
        <h1 id="auth-title">{kind === "login" ? "登录" : "额度"}</h1>
        <span className="auth-head-spacer" aria-hidden="true" />
      </header>
      <div className="auth-body">
        {kind === "login" ? (
          <p className="auth-lead">登录后即可提问。账号与工作台同一套，不另注册。</p>
        ) : (
          <p className="auth-lead">当前额度不足，无法继续提问。可查看用量，或联系管理员开通套餐 / 发放重置。</p>
        )}
        <AccountSection />
        <button
          type="button"
          className="btn auth-settings"
          onClick={() => {
            settingsActions.closeGate();
            queueMicrotask(() => settingsActions.open("manual"));
          }}
        >
          打开设置
        </button>
      </div>
    </div>
  );
}
