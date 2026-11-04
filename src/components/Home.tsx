import { ArrowUp, CircleAlert, ImagePlus, Settings } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { quotaReason, track } from "../analytics/index.ts";
import { CAN_FETCH } from "../core/http.ts";
import { defaultImageQuestion } from "../lib/image.ts";
import { morphToCard, screenTransition, swapScreen } from "../lib/transition.ts";
import { AttachmentStrip, hasFiles, useAttachments } from "./Attachments.tsx";
import { refreshUsageIfNeeded } from "../core/platform.ts";
import { actions } from "../store/graph.ts";
import { MOCK_MODE, settingsActions, useSettings } from "../settings/store.ts";
import { SearchToggle } from "./common.tsx";
import { PrefsMenu } from "./PrefsMenu.tsx";
import { HistoryButton, RecentList } from "./History.tsx";
import { useHistory } from "../history/store.ts";
import { drag, WindowControls } from "./TitleBar.tsx";
import { Wordmark } from "./Wordmark.tsx";
import { LanternSky, useNight } from "./Lantern.tsx";
import "../styles/home.css";

export function Home() {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const att = useAttachments();
  const [drop, setDrop] = useState(false);
  const canAsk = useSettings((s) => s.canAsk);
  const session = useSettings((s) => s.session);
  const usage = useSettings((s) => s.usage);
  const loaded = useHistory((s) => s.loaded);
  useEffect(() => {
    if (!loaded) return;
    track("home_viewed", { recent_map_count: useHistory.getState().items.length });
  }, [loaded]);

  // 额度用尽后，到重置点主动刷新，避免一直卡在本地旧 canAsk
  useEffect(() => {
    if (MOCK_MODE || !session || canAsk) return;
    let cancelled = false;
    const tick = () => { if (!cancelled) void refreshUsageIfNeeded(); };
    tick();
    const id = window.setInterval(tick, 30_000);
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [session, canAsk]);
  // 没有历史时整体上下居中；删光记录（或撤销后又有了）时用页面过渡平滑地挪过去，不用刷新
  const hasItems = useHistory((s) => s.items.length > 0);
  const [empty, setEmpty] = useState<boolean | null>(() => (loaded ? !hasItems : null));
  useEffect(() => {
    if (!loaded) return;
    if (empty === null) setEmpty(!hasItems);
    else if (empty === hasItems) swapScreen(() => setEmpty(!hasItems));
  }, [loaded, hasItems, empty]);

  // 窄屏首页以列表为主，不自动聚焦提问框以免弹出键盘挡住最近
  useEffect(() => {
    if (empty === null) return;
    if (matchMedia("(max-width: 720px)").matches) return;
    ref.current?.focus();
  }, [empty !== null]);
  const petals = useSettings((s) => s.petals);
  const night = useNight();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [text]);

  const images = att.ready ?? [];
  const canSend = !!att.ready && (!!text.trim() || images.length > 0);

  const submit = () => {
    if (!canSend) return;
    // 未登录先打开设置；额度不够时先刷新一次（窗可能已恢复）
    if (!MOCK_MODE && !session) return settingsActions.open("login");
    if (!MOCK_MODE && !canAsk) {
      void refreshUsageIfNeeded().then((next) => {
        if (next?.canAsk) {
          const q = text.trim() || defaultImageQuestion(images.length);
          const form = ref.current?.closest("form");
          const start = () => actions.start(q, images);
          if (form) void morphToCard(form, start);
          else start();
          return;
        }
        const reason = quotaReason(next ?? usage);
        track("quota_gate_shown", { reason });
        track("quota_blocked", { window: reason });
        settingsActions.open("quota");
      });
      return;
    }
    const q = text.trim() || defaultImageQuestion(images.length);
    const form = ref.current?.closest("form");
    const start = () => actions.start(q, images);
    if (form) void morphToCard(form, start);
    else start();
  };

  const problem =
    !CAN_FETCH && !MOCK_MODE ? "浏览器无法登录平台，请在桌面应用中使用"
    : !session && !MOCK_MODE ? "使用前请先登录"
    : !MOCK_MODE && !canAsk
      ? (usage?.plan ? "额度已用完" : "尚未开通套餐")
    : null;

  const [intro] = useState(() => (screenTransition() ? " enter-self" : ""));

  // 待定时先按空首页排版（更常见），内容仍透明；读出后若有历史再经 swapScreen 挪布局
  return (
    <main className={`home${empty !== false ? " is-empty" : ""}${empty === null ? " is-pending" : ""}${intro}`}>
      <LanternSky active={night && empty !== null && petals} />
      <header className="home-titlebar" {...drag}>
        <div className="home-titlebar-actions">
          <HistoryButton />
          <button type="button" className="icon-btn" aria-label="设置" data-replay-id="settings" onClick={() => settingsActions.open("manual")}>
            <Settings size={16} strokeWidth={1.6} />
          </button>
          <WindowControls />
        </div>
        <p className="home-brand">
          <span className="doodle"><Wordmark /></span>
        </p>
      </header>
      <div className="home-inner">
        <div className="home-hero">
          <h1 className="wordmark">
            <span className="doodle"><Wordmark /></span>
          </h1>
          <form
            className={`ask${drop ? " is-drop" : ""}`}
            onSubmit={(e) => { e.preventDefault(); submit(); }}
            onDragOver={(e) => { if (!hasFiles(e)) return; e.preventDefault(); setDrop(true); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(false); }}
            onDrop={(e) => { if (!hasFiles(e)) return; e.preventDefault(); setDrop(false); att.add([...e.dataTransfer.files]); ref.current?.focus(); }}
          >
            <AttachmentStrip items={att.items} onRemove={(id) => { att.remove(id); ref.current?.focus(); }} />
            <label className="visually-hidden" htmlFor="home-input">问题</label>
            <textarea
              id="home-input"
              data-replay-id="ask-input"
              ref={ref}
              rows={1}
              placeholder={att.items.length ? "关于图片想了解什么？" : "想知道什么，或者在纠结什么？"}
              value={text}
              maxLength={500}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
                if (!files.length) return;
                e.preventDefault();
                att.add(files);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <div className="ask-bar">
              <div className="ask-tools">
                {/* 输入框工具栏：图标即可；底栏菜单才用「图标+文字」整行 */}
                <SearchToggle compact />
                <PrefsMenu compact />
                <button type="button" className="icon-btn" aria-label="添加图片" disabled={att.full} onClick={() => file.current?.click()}>
                  <ImagePlus size={16} strokeWidth={1.6} />
                </button>
                <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden
                  onChange={(e) => { att.add([...(e.target.files ?? [])]); e.target.value = ""; ref.current?.focus(); }} />
              </div>
              <button type="submit" className="send" aria-label="提问" data-replay-id="ask-submit" disabled={!canSend}>
                <ArrowUp size={16} strokeWidth={2} />
              </button>
            </div>
          </form>
        </div>
        {problem && (
          <p className="home-status" role="status">
            <CircleAlert size={14} strokeWidth={1.8} />
            <span>{problem}</span>
            {CAN_FETCH && (
              <button type="button" className="link-btn" onClick={() => settingsActions.open(!session ? "login" : "quota")}>
                {!session ? "去登录" : "查看额度"}
              </button>
            )}
          </p>
        )}
        <RecentList />
      </div>
    </main>
  );
}
