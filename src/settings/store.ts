import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DEFAULT_MAIN_MODEL, VISIBLE_MODELS, type MainModel } from "../core/models.ts";
import { PACK_MODE } from "../core/devNet.ts";
import type { Prefs } from "../core/protocol.ts";

export interface Account {
  id: string;
  username: string;
  nickname: string;
  role: string;
}

/** 服务端对外黑盒用量；百分比为已用比例，不暴露具体消耗单位 */
export interface UsageView {
  plan: string;
  planLabel: string;
  canAsk: boolean;
  planExpiresAt: number;
  monthPct: number;
  monthResetsAt: number;
  windowPct: number;
  windowResetsAt: number;
  weekPct: number;
  weekResetsAt: number;
  /** 预存重置次数；管理员发放，用户手动使用，只清 5 小时与 7 天窗 */
  resetsAvailable: number;
  /** 服务端判定当前是否可使用一次预存重置 */
  canUseReset: boolean;
}

export interface Settings {
  /** AudioFlow 会话令牌，只存在本机 */
  session: string;
  account: Account | null;
  /** 是否还能提问；权威值在服务端 */
  canAsk: boolean;
  /** 最近一次用量快照；权威值在服务端 */
  usage: UsageView | null;
  /** 主模型；轻量模型固定在 models.ts */
  model: MainModel;
  /** 切换节点时是否收起上一个节点的要点 */
  autoCollapse: boolean;
  /** 打开详情侧边栏时自动生成详解；关闭时（默认）侧边栏里点按钮才生成，省一次主模型调用 */
  autoDetail: boolean;
  /** 点击来源时：用系统默认浏览器打开，或在侧边栏的阅读视图里打开 */
  openSource: "browser" | "reader";
  /** 侧边栏宽度占窗口宽度的比例，拖动左边缘调整；记比例而不是像素，窗口变宽变窄时侧边栏跟着变 */
  drawerRatio: number;
  /** 离开还在回答的地图时：每次询问、终止，或在后台继续 */
  onLeave: "ask" | "stop" | "background";
  /** 明暗：深色（新用户默认）、浅色或跟随系统；写到 html 的 data-theme，令牌在 styles/tokens.css */
  theme: Theme;
  /** 首页孔明灯；关闭后提问框上方不再放灯 */
  petals: boolean;
  /** 输入框旁的回答偏好：回答风格、来源偏好与时间范围 */
  prefs: Prefs;
}

export const DEFAULT_PREFS: Prefs = { style: "auto", customStyle: "", sources: "auto", time: "auto" };

/** 存档里的偏好逐项校验，不认识的值回到默认 */
function cleanPrefs(v: unknown): Prefs {
  const p = (v && typeof v === "object" ? v : {}) as Partial<Prefs>;
  return {
    style: p.style === "concise" || p.style === "plain" || p.style === "deep" || p.style === "custom" ? p.style : "auto",
    customStyle: typeof p.customStyle === "string" ? p.customStyle : "",
    sources: p.sources === "official" ? "official" : "auto",
    time: p.time === "d7" || p.time === "m1" ? p.time : "auto",
  };
}

export const THEMES = [["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"]] as const;
export type Theme = (typeof THEMES)[number][0];

const DRAWER_MIN = 360;
/** 侧边栏最宽不超过窗口的 60%，给画布留出位置 */
const DRAWER_MAX_RATIO = 0.6;
export const DRAWER_RATIO = 0.3;
const clampRatio = (r: number) => Math.min(DRAWER_MAX_RATIO, Math.max(0, r));
/** 侧边栏当前的像素宽度：按比例算，不窄于 360 */
export const drawerPx = (ratio: number) => Math.round(Math.max(DRAWER_MIN, clampRatio(ratio) * innerWidth));
/** 与 drawerPx 同一规则的 CSS 宽度，窗口缩放时由浏览器直接重算 */
export const drawerCss = (ratio: number) => `max(${DRAWER_MIN}px, ${clampRatio(ratio) * 100}vw)`;
/** 拖动边缘到距窗口右边 px 像素时的比例；360 的下限只在显示时保证，记下的比例不受当前窗口宽度抬高 */
export const drawerRatioAt = (px: number) => clampRatio(px / innerWidth);

interface SettingsState extends Settings {
  open: boolean;
}

export const useSettings = create<SettingsState>()(
  persist(
    (): SettingsState => ({ session: "", account: null, canAsk: false, usage: null, model: DEFAULT_MAIN_MODEL, autoCollapse: false, autoDetail: false, openSource: "browser", drawerRatio: DRAWER_RATIO, onLeave: "background", theme: "dark", petals: true, prefs: DEFAULT_PREFS, open: false }),
    {
      name: "lanshan-settings",
      version: 7,
      // 版本 2：「切换节点时收起上一个节点的要点」默认改为保持展开（用户要求），老用户也改一次
      // 版本 3：回答风格新增「自动」并设为默认，原来默认的「简洁明了」改为自动（用户反馈简洁明了答得太少），其他选择保留
      // 版本 4：密钥改由平台代发，本机只保留登录会话
      // 版本 5：去掉可切换配色，只留墨色
      // 版本 6：灯火余额改为月租双窗黑盒用量
      // 版本 7：用量快照补 planExpiresAt（设置账号区展示到期）
      migrate: (persisted, version) => {
        let s = (persisted ?? {}) as Partial<SettingsState> & { palette?: unknown; remaining?: unknown };
        if (version < 2) s = { ...s, autoCollapse: false };
        if (version < 3 && s.prefs?.style === "concise") s = { ...s, prefs: { ...s.prefs, style: "auto" } };
        if (version < 4) s = { ...s, session: "", account: null };
        if (version < 5) {
          const { palette: _dropped, ...rest } = s;
          s = rest;
        }
        if (version < 6) {
          const { remaining: _dropped, ...rest } = s;
          s = { ...rest, canAsk: false, usage: null };
        }
        if (version < 7 && s.usage && typeof s.usage === "object") {
          const u = s.usage as UsageView & { planExpiresAt?: number };
          s = { ...s, usage: { ...u, planExpiresAt: Math.max(0, Math.floor(Number(u.planExpiresAt) || 0)) } };
        }
        return s as SettingsState;
      },
      storage: createJSONStorage(() => localStorage),
      partialize: ({ session, account, canAsk, usage, model, autoCollapse, autoDetail, openSource, drawerRatio, onLeave, theme, petals, prefs }) => ({ session, account, canAsk, usage, model, autoCollapse, autoDetail, openSource, drawerRatio, onLeave, theme, petals, prefs }),
      // 已下线或在设置页隐藏的模型回到默认值（2026-10 起混元隐藏，统一用 DeepSeek Flash）
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Settings>;
        const model = VISIBLE_MODELS.some((m) => m.id === p.model) ? p.model! : DEFAULT_MAIN_MODEL;
        const openSource = p.openSource === "reader" ? "reader" : "browser";
        const drawerRatio = typeof p.drawerRatio === "number" && p.drawerRatio >= 0 && p.drawerRatio <= 1 ? p.drawerRatio : DRAWER_RATIO;
        const onLeave = p.onLeave === "stop" || p.onLeave === "ask" ? p.onLeave : "background";
        // 新用户默认深色；存过设置的保持原样，存档里没有明暗（加这个选项之前存的）说明一直跟随系统
        const theme = THEMES.some(([t]) => t === p.theme) ? p.theme! : persisted ? "system" : current.theme;
        const petals = p.petals !== false;
        const session = typeof p.session === "string" ? p.session : "";
        const canAsk = p.canAsk === true;
        const usageRaw = p.usage && typeof p.usage === "object" ? (p.usage as UsageView) : null;
        const usage = usageRaw
          ? {
              ...usageRaw,
              planExpiresAt: Math.max(0, Math.floor(Number(usageRaw.planExpiresAt) || 0)),
              monthPct: Math.max(0, Math.min(100, Math.floor(Number(usageRaw.monthPct) || 0))),
              windowPct: Math.max(0, Math.min(100, Math.floor(Number(usageRaw.windowPct) || 0))),
              weekPct: Math.max(0, Math.min(100, Math.floor(Number(usageRaw.weekPct) || 0))),
              monthResetsAt: Math.max(0, Math.floor(Number(usageRaw.monthResetsAt) || 0)),
              windowResetsAt: Math.max(0, Math.floor(Number(usageRaw.windowResetsAt) || 0)),
              weekResetsAt: Math.max(0, Math.floor(Number(usageRaw.weekResetsAt) || 0)),
              plan: typeof usageRaw.plan === "string" ? usageRaw.plan : "",
              planLabel: typeof usageRaw.planLabel === "string" ? usageRaw.planLabel : "",
              canAsk: usageRaw.canAsk === true,
              resetsAvailable: Math.max(0, Math.floor(Number(usageRaw.resetsAvailable) || 0)),
              canUseReset: usageRaw.canUseReset === true,
            }
          : null;
        const account = p.account && typeof p.account === "object" && typeof p.account.id === "string" ? p.account : null;
        return { ...current, ...p, session, account, canAsk, usage, model, openSource, drawerRatio, onLeave, theme, petals, prefs: cleanPrefs(p.prefs) };
      },
    },
  ),
);

/** 打开设置时的来源：登录表单用来区分 ask_gate / settings；移动门闸短页也看它 */
export type SettingsOpenReason = "manual" | "login" | "quota";
let settingsOpenReason: SettingsOpenReason = "manual";
export const loginFrom = () => (settingsOpenReason === "login" ? "ask_gate" as const : "settings" as const);
export const settingsReason = () => settingsOpenReason;

export const settingsActions = {
  /** 设置即改即存：persist 中间件会把变更写入本机存储 */
  update: (s: Partial<Settings>) => useSettings.setState(s),
  setPrefs: (p: Partial<Prefs>) => useSettings.setState((s) => ({ prefs: { ...s.prefs, ...p } })),
  open: (reason: SettingsOpenReason = "manual") => {
    settingsOpenReason = reason;
    useSettings.setState({ open: true });
    // 动态导入，避免 settings ↔ analytics 循环依赖
    void import("../analytics/index.ts").then(({ track }) => track("settings_opened", { reason }));
  },
  close: () => {
    settingsOpenReason = "manual";
    useSettings.setState({ open: false });
  },
  clearAccount: () => useSettings.setState({ session: "", account: null, canAsk: false, usage: null }),
};

/** 示例模式：只在开发环境通过 VITE_PROVIDERS=mock 打开，不出现在发布版本里；地址指定了数据包（采集或重放）时以数据包为准 */
export const MOCK_MODE = import.meta.env.DEV && import.meta.env.VITE_PROVIDERS === "mock" && !PACK_MODE;

export const isConfigured = (s: Settings) => MOCK_MODE || !!s.session;
