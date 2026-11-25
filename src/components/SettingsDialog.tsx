import {
  BookOpen,
  Brain,
  Check,
  ChevronRight,
  CircleAlert,
  Eye,
  EyeOff,
  FileText,
  Gauge,
  LoaderCircle,
  Map,
  Palette,
  RefreshCw,
  SlidersHorizontal,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type Ref, type ReactNode } from "react";
import { track } from "../analytics/index.ts";
import { IS_MOBILE_APP } from "../core/device.ts";
import { CAN_FETCH, IN_APP } from "../core/http.ts";
import { VISIBLE_MODELS } from "../core/models.ts";
import { fetchUsage, login, logout, redeemReset, type UsagePayload } from "../core/platform.ts";
import { useMemory } from "../memory/store.ts";
import { ProviderError } from "../core/providers/types.ts";
import { APP_VERSION } from "../lib/appUpdate.ts";
import { SUPPORTED_DOCUMENT_EXTENSIONS } from "../library/parse.ts";
import { listSources } from "../library/db.ts";
import { DesktopAccountExtras, DesktopLogin } from "./DesktopAccount.tsx";
import { DialogCloseIcon, DialogDone, scrimClose } from "./DialogChrome.tsx";
import { UpdateSection } from "./UpdatePrompt.tsx";
import { usePresence } from "./presence.ts";
import { MemorySection } from "./MemorySection.tsx";
import { LocalLibrarySection } from "./LocalLibrarySection.tsx";
import { PlanMark } from "./PlanMark.tsx";
import { PrefsFields, prefsSummary } from "./PrefsMenu.tsx";
import { loginFrom, MOCK_MODE, settingsActions, THEMES, useSettings, type Settings } from "../settings/store.ts";

function formatResetAt(at: number): string {
  if (!at) return "使用后开始计时";
  const date = new Date(at * 1000);
  if (Number.isNaN(date.getTime())) return "使用后开始计时";
  return `${date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })} 后重置`;
}

export function formatExpiresAt(at: number): string {
  if (!at) return "";
  const date = new Date(at * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour12: false })}到期`;
}

export function UsageMeter({ label, pct, resetAt, compact }: { label: string; pct: number; resetAt: number; compact?: boolean }) {
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
      {compact ? null : <div className="usage-meter-reset">{formatResetAt(resetAt)}</div>}
    </div>
  );
}

export function SettingsDialog() {
  const open = useSettings((s) => s.open);
  const p = usePresence(open);
  return p.mounted ? <Dialog closing={p.closing} /> : null;
}

function Dialog({ closing }: { closing: boolean }) {
  const first = useRef<HTMLButtonElement>(null);
  const panelTrigger = useRef<HTMLButtonElement | null>(null);
  const focusTimer = useRef<number | null>(null);
  const [page, setPage] = useState<SettingsPage>("account");
  const [panel, setPanel] = useState<SettingsPanel | null>(null);
  const [renderedPanel, setRenderedPanel] = useState<SettingsPanel | null>(null);
  const [savedTick, setSavedTick] = useState(0);
  const panelPresence = usePresence(panel !== null);

  useEffect(() => {
    if (panel) setRenderedPanel(panel);
  }, [panel]);

  const closePanel = () => {
    if (focusTimer.current !== null) window.clearTimeout(focusTimer.current);
    setPanel(null);
    focusTimer.current = window.setTimeout(() => {
      focusTimer.current = null;
      panelTrigger.current?.focus();
    }, 170);
  };

  const openPanel = (next: SettingsPanel, trigger: HTMLButtonElement) => {
    if (focusTimer.current !== null) {
      window.clearTimeout(focusTimer.current);
      focusTimer.current = null;
    }
    panelTrigger.current = trigger;
    setPanel(next);
  };

  useEffect(() => { first.current?.focus(); }, []);
  useEffect(() => () => {
    if (focusTimer.current !== null) window.clearTimeout(focusTimer.current);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (panel) closePanel();
      else settingsActions.close();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [panel]);

  return (
    <div className={`dialog-layer${closing ? " is-closing" : ""}`}>
      <div className="dialog-scrim" {...scrimClose(settingsActions.close)} />
      <div className="dialog settings" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="dialog-head">
          <h2 id="settings-title">设置</h2>
          <SavedBadge tick={savedTick} />
          <DialogCloseIcon onClose={settingsActions.close} label="关闭设置" />
        </header>

        <div className="settings-shell">
          <SettingsNav page={page} firstRef={first} onChange={setPage} />
          <main className="settings-main">
            {!IN_APP && (MOCK_MODE || !CAN_FETCH) && (
              <p className="settings-banner" role="status">
                <CircleAlert size={14} strokeWidth={1.8} />
                <span>{MOCK_MODE ? "当前为开发示例模式，回答使用示例数据。" : "浏览器无法登录平台，请在桌面应用中使用。"}</span>
              </p>
            )}
            <SettingsPageContent page={page} onOpen={openPanel} />
          </main>
        </div>
        {panelPresence.mounted && renderedPanel ? (
          <SettingsSubdialog panel={renderedPanel} closing={panelPresence.closing} savedTick={savedTick} onSaved={() => setSavedTick((tick) => tick + 1)} onClose={closePanel} />
        ) : null}
        <DialogDone onClose={settingsActions.close} />
      </div>
    </div>
  );
}

type SettingsPage = "account" | "answer" | "knowledge" | "appearance" | "canvas" | "system";
type SettingsPanel =
  | "account"
  | "model"
  | "preferences"
  | "memory"
  | "library"
  | "retrieval"
  | "formats"
  | "theme"
  | "petals"
  | "collapse"
  | "detail"
  | "source"
  | "leave"
  | "update";

const PAGE_META: Record<SettingsPage, { title: string; description: string }> = {
  account: { title: "账号", description: "管理登录、套餐与使用量。" },
  answer: { title: "问答与记忆", description: "设置回答方式和个人记忆。" },
  knowledge: { title: "知识库", description: "管理本地资料、解析能力与检索方式。" },
  appearance: { title: "外观", description: "调整界面明暗和首页灯火。" },
  canvas: { title: "画布与来源", description: "设置知识地图和来源阅读方式。" },
  system: { title: "系统", description: "查看版本并检查应用更新。" },
};

const NAV_GROUPS: { label: string; items: { id: SettingsPage; label: string; icon: LucideIcon }[] }[] = [
  { label: "账户", items: [{ id: "account", label: "账号", icon: UserRound }] },
  { label: "问答与知识", items: [
    { id: "answer", label: "问答与记忆", icon: Brain },
    { id: "knowledge", label: "知识库", icon: BookOpen },
  ] },
  { label: "应用", items: [
    { id: "appearance", label: "外观", icon: Palette },
    { id: "canvas", label: "画布与来源", icon: Map },
  ] },
  { label: "系统", items: [{ id: "system", label: "更新", icon: RefreshCw }] },
];

function SettingsNav({ page, firstRef, onChange }: { page: SettingsPage; firstRef: Ref<HTMLButtonElement>; onChange: (page: SettingsPage) => void }) {
  let first = true;
  return (
    <nav className="settings-nav" aria-label="设置分类">
      {NAV_GROUPS.map((group) => <div className="settings-nav-group" key={group.label}>
        <div className="settings-nav-label">{group.label}</div>
        {group.items.map((item) => {
          const Icon = item.icon;
          const ref = first ? firstRef : undefined;
          first = false;
          return <button
            key={item.id}
            ref={ref}
            type="button"
            className="settings-nav-item"
            aria-current={page === item.id ? "page" : undefined}
            onClick={() => onChange(item.id)}
          >
            <Icon size={18} strokeWidth={1.6} aria-hidden="true" />
            <span>{item.label}</span>
          </button>;
        })}
      </div>)}
    </nav>
  );
}

function SettingsPageContent({ page, onOpen }: { page: SettingsPage; onOpen: (panel: SettingsPanel, trigger: HTMLButtonElement) => void }) {
  const meta = PAGE_META[page];
  return (
    <div className="settings-page" key={page}>
      <header className="settings-page-head">
        <h3>{meta.title}</h3>
        <p>{meta.description}</p>
      </header>
      <SettingsRows page={page} onOpen={onOpen} />
    </div>
  );
}

function SettingsRows({ page, onOpen }: { page: SettingsPage; onOpen: (panel: SettingsPanel, trigger: HTMLButtonElement) => void }) {
  const account = useSettings((s) => s.account);
  const usage = useSettings((s) => s.usage);
  const model = useSettings((s) => s.model);
  const prefs = useSettings((s) => s.prefs);
  const deepLocalSearch = useSettings((s) => s.deepLocalSearch);
  const theme = useSettings((s) => s.theme);
  const petals = useSettings((s) => s.petals);
  const autoCollapse = useSettings((s) => s.autoCollapse);
  const autoDetail = useSettings((s) => s.autoDetail);
  const openSource = useSettings((s) => s.openSource);
  const onLeave = useSettings((s) => s.onLeave);
  const memoryEnabled = useMemory((s) => s.enabled);
  const [libraryLabel, setLibraryLabel] = useState("正在读取");
  const themeLabel = THEMES.find(([value]) => value === theme)?.[1] ?? "跟随系统";
  const modelLabel = VISIBLE_MODELS.find((item) => item.id === model)?.label ?? "默认模型";
  const sourceLabel = openSource === "browser" ? "系统浏览器" : "侧边栏阅读";
  const leaveLabel = onLeave === "ask" ? "每次询问" : onLeave === "stop" ? "终止回答" : "后台继续";

  useEffect(() => {
    if (page !== "knowledge") return;
    let alive = true;
    let timer = 0;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
      void listSources().then((sources) => {
        if (!alive) return;
        const visible = sources.filter((source) => source.kind === "folder" || source.documentCount > 0);
        const documents = sources.reduce((sum, source) => sum + source.indexedCount, 0);
        setLibraryLabel(!visible.length ? "尚无资料" : `${visible.length} 个数据源，${documents} 份资料`);
      }).catch(() => alive && setLibraryLabel("读取失败"));
      }, 80);
    };
    refresh();
    addEventListener("lanshan:library-changed", refresh);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      removeEventListener("lanshan:library-changed", refresh);
    };
  }, [page]);

  const row = (panel: SettingsPanel, icon: LucideIcon, title: string, description: string, value?: string) => (
    <SettingsRow key={panel} icon={icon} title={title} description={description} value={value} onClick={(trigger) => onOpen(panel, trigger)} />
  );

  if (page === "account") return <div className="settings-list">
    {row("account", UserRound, "账号与用量", "登录、套餐和当前使用量", account ? (usage?.planLabel || account.nickname || account.username) : "未登录")}
  </div>;

  if (page === "answer") return <div className="settings-list">
    {row("preferences", SlidersHorizontal, "回答偏好", "回答风格、来源偏好和时间范围", prefsSummary(prefs))}
    {VISIBLE_MODELS.length > 1 ? row("model", Gauge, "回答模型", "选择生成回答使用的模型", modelLabel) : null}
    {row("memory", Brain, "个人记忆", "查看和编辑会在回答中使用的记忆", memoryEnabled ? "已开启" : "已关闭")}
  </div>;

  if (page === "knowledge") return <div className="settings-list">
    {row("library", BookOpen, "数据源", "导入和管理保存在本机的资料", libraryLabel)}
    {row("retrieval", SlidersHorizontal, "本地深度检索", "命中资料后进一步判断和扩展候选原文", deepLocalSearch ? "已开启" : "已关闭")}
    {row("formats", FileText, "解析能力", "查看当前能够读取的文件格式", `${SUPPORTED_DOCUMENT_EXTENSIONS.length} 个扩展名`)}
  </div>;

  if (page === "appearance") return <div className="settings-list">
    {row("theme", Palette, "界面明暗", "选择跟随系统、浅色或深色", themeLabel)}
    {row("petals", Palette, "首页灯火", "控制首页提问框上方的灯火", petals ? "已开启" : "已关闭")}
  </div>;

  if (page === "canvas") return <div className="settings-list">
    {row("collapse", Map, "切换节点时", "设置上一个节点的要点是否自动收起", autoCollapse ? "自动收起" : "保持展开")}
    {row("detail", FileText, "生成详解", "设置打开详情时是否自动生成", autoDetail ? "自动生成" : "手动生成")}
    {row("source", BookOpen, "来源打开方式", "设置点击回答来源后的打开位置", sourceLabel)}
    {row("leave", SlidersHorizontal, "离开正在回答的地图", "设置回答未完成时的处理方式", leaveLabel)}
  </div>;

  return <div className="settings-list">
    {row("update", RefreshCw, "应用更新", "查看当前版本并检查新版本", `版本 ${APP_VERSION}`)}
  </div>;
}

function SettingsRow({ icon: Icon, title, description, value, onClick }: { icon: LucideIcon; title: string; description: string; value?: string; onClick: (trigger: HTMLButtonElement) => void }) {
  return (
    <button type="button" className="settings-list-row" onClick={(event) => onClick(event.currentTarget)}>
      <span className="settings-row-icon" aria-hidden="true"><Icon size={19} strokeWidth={1.6} /></span>
      <span className="settings-row-copy">
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
      {value ? <span className="settings-row-value">{value}</span> : null}
      <ChevronRight size={16} strokeWidth={1.6} aria-hidden="true" />
    </button>
  );
}

const PANEL_TITLES: Record<SettingsPanel, string> = {
  account: "账号与用量",
  model: "回答模型",
  preferences: "回答偏好",
  memory: "个人记忆",
  library: "数据源",
  retrieval: "本地深度检索",
  formats: "解析能力",
  theme: "界面明暗",
  petals: "首页灯火",
  collapse: "切换节点时",
  detail: "生成详解",
  source: "来源打开方式",
  leave: "离开正在回答的地图",
  update: "应用更新",
};

function SettingsSubdialog({ panel, closing, savedTick, onSaved, onClose }: { panel: SettingsPanel; closing: boolean; savedTick: number; onSaved: () => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = box.current;
    if (!root) return;
    (root.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled)") ?? root).focus();
  }, [panel]);
  const wide = panel === "account" || panel === "library" || panel === "update";
  const keepFocusInside = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const items = Array.from(box.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])") ?? []);
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return (
    <div className={`settings-panel-layer${closing ? " is-closing" : ""}`}>
      <div className="settings-panel-scrim" {...scrimClose(onClose)} />
      <div ref={box} tabIndex={-1} className={`settings-panel${wide ? " is-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="settings-panel-title" onKeyDown={keepFocusInside}>
        <header className="dialog-head">
          <h2 id="settings-panel-title">{PANEL_TITLES[panel]}</h2>
          <SavedBadge tick={savedTick} />
          <DialogCloseIcon onClose={onClose} label={`关闭${PANEL_TITLES[panel]}`} />
        </header>
        <div className="settings-panel-body"><SettingsPanelContent panel={panel} onSaved={onSaved} /></div>
        <DialogDone onClose={onClose} />
      </div>
    </div>
  );
}

function SettingsPanelContent({ panel, onSaved }: { panel: SettingsPanel; onSaved: () => void }): ReactNode {
  const model = useSettings((s) => s.model);
  const theme = useSettings((s) => s.theme);
  const petals = useSettings((s) => s.petals);
  const autoCollapse = useSettings((s) => s.autoCollapse);
  const autoDetail = useSettings((s) => s.autoDetail);
  const openSource = useSettings((s) => s.openSource);
  const onLeave = useSettings((s) => s.onLeave);
  const deepLocalSearch = useSettings((s) => s.deepLocalSearch);
  const update = (patch: Partial<Settings>) => {
    settingsActions.update(patch);
    onSaved();
  };

  if (panel === "account") return <section className="settings-section"><h3>账号与用量</h3><AccountSection />{!IS_MOBILE_APP ? <DesktopAccountExtras /> : null}</section>;
  if (panel === "preferences") return <section className="settings-section"><h3>回答偏好</h3><div className="settings-preferences"><PrefsFields onChange={onSaved} /></div></section>;
  if (panel === "model") return <PanelChoice label="回答模型" value={model} options={VISIBLE_MODELS.map((item) => [item.id, item.label] as const)} onChange={(value) => update({ model: value })} />;
  if (panel === "memory") return <MemorySection onSaved={onSaved} />;
  if (panel === "library") return <LocalLibrarySection mode="documents" />;
  if (panel === "retrieval") return <>
    <PanelChoice label="本地深度检索" value={deepLocalSearch ? "on" : "off"} options={[["on", "开启"], ["off", "关闭"]]} onChange={(value) => update({ deepLocalSearch: value === "on" })} />
    <p className="settings-panel-note">开启后每次命中资料会增加最多两次模型判断，并发送少量候选片段。</p>
  </>;
  if (panel === "formats") return <FormatCapabilities />;
  if (panel === "theme") return <PanelChoice label="界面明暗" value={theme} options={THEMES} onChange={(value) => update({ theme: value })} />;
  if (panel === "petals") return <PanelChoice label="首页灯火" value={petals ? "on" : "off"} options={[["on", "开启"], ["off", "关闭"]]} onChange={(value) => update({ petals: value === "on" })} />;
  if (panel === "collapse") return <PanelChoice label="切换节点时，上一个节点的要点" value={autoCollapse ? "collapse" : "keep"} options={[["keep", "保持展开"], ["collapse", "自动收起"]]} onChange={(value) => update({ autoCollapse: value === "collapse" })} />;
  if (panel === "detail") return <PanelChoice label="打开详情时生成详解" value={autoDetail ? "auto" : "manual"} options={[["manual", "手动生成"], ["auto", "自动生成"]]} onChange={(value) => update({ autoDetail: value === "auto" })} />;
  if (panel === "source") return <PanelChoice label="点击来源时" value={openSource} options={[["browser", "系统浏览器打开"], ["reader", "侧边栏阅读视图"]]} onChange={(value) => update({ openSource: value })} />;
  if (panel === "leave") return <PanelChoice label="离开还在回答的地图时" value={onLeave} options={[["background", "后台继续"], ["ask", "每次询问"], ["stop", "终止"]]} onChange={(value) => update({ onLeave: value })} />;
  return <UpdateSection />;
}

function PanelChoice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void }) {
  return (
    <section className="settings-section settings-choice-panel">
      <h3>{label}</h3>
      <div className="settings-choice-list" role="radiogroup" aria-label={label}>
        {options.map(([item, text]) => <button key={item} type="button" role="radio" aria-checked={item === value} onClick={() => item !== value && onChange(item)}>
          <span>{text}</span>
          <span className="settings-radio-mark" aria-hidden="true" />
        </button>)}
      </div>
    </section>
  );
}

function FormatCapabilities() {
  return (
    <section className="settings-section settings-formats">
      <h3>解析能力</h3>
      <div className="settings-capability-list">
        <div><span>文本与 Markdown</span><strong>TXT、TEXT、MD、Markdown</strong></div>
        <div><span>网页与结构化文本</span><strong>HTML、XHTML、CSV、TSV、JSON、JSONL、YAML、XML</strong></div>
        <div><span>文档与演示</span><strong>PDF、DOCX、ODT、PPTX</strong></div>
        <div><span>电子书</span><strong>EPUB</strong></div>
        <div><span>尚未提供</span><strong>扫描件 OCR、旧版 Office、表格、音视频</strong></div>
      </div>
      <p className="memory-hint">只显示当前实际可解析的格式。扫描版 PDF 没有可提取文字时不会加入资料库；不会把未安装的转换能力标成可用。</p>
    </section>
  );
}

function SavedBadge({ tick }: { tick: number }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!tick) return;
    setOn(true);
    const timer = window.setTimeout(() => setOn(false), 1400);
    return () => window.clearTimeout(timer);
  }, [tick]);
  return (
    <span className={`saved-badge${on ? " is-on" : ""}`} role="status" aria-live="polite">
      {on ? <><Check size={13} strokeWidth={2} />已保存</> : null}
    </span>
  );
}

export function AccountSection({ inputRef, hideLogout, onPlans }: { inputRef?: Ref<HTMLInputElement>; hideLogout?: boolean; onPlans?: () => void }) {
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
        {/* 原型 11：状态紧跟名字，再是「用量」 */}
        <div className="account-usage">{status}</div>
        {!usageReady && !view ? (
          <div className="account-usage">正在读取用量</div>
        ) : view && planLabel ? (
          <div className="usage-block">
            <div className="usage-block-title">
              <span>用量</span>
              {onPlans ? <button type="button" className="usage-more" onClick={onPlans}>更多套餐</button> : null}
            </div>
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
                  onClick={() => {
                    if (!canUseReset) {
                      setResetError("目前无需重置");
                      return;
                    }
                    void onRedeemReset();
                  }}
                >
                  {resetBusy ? "正在重置" : "使用重置"}
                </button>
              </div>
            ) : null}
            {resetError ? <div className="account-usage is-error" role="alert">{resetError}</div> : null}
          </div>
        ) : null}
        {hideLogout ? null : (
          <div className="field-actions">
            <button type="button" className="btn btn-sm" onClick={() => { void logout(); }}>退出</button>
          </div>
        )}
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

  if (!IS_MOBILE_APP) return <DesktopLogin inputRef={inputRef} />;

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
