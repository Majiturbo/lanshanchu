import { httpFetch } from "./http.ts";
import { settingsActions, useSettings, type Account, type UsageView } from "../settings/store.ts";
import { ProviderError } from "./providers/types.ts";

/** AudioFlow 正式站：账号、月租额度与模型转发都在这里 */
export const PLATFORM_URL = "https://www.tgcsm.site";

type AuthPayload = {
  session?: string;
  account?: Account;
} & Partial<UsageView> & Record<string, unknown>;

export type UsagePayload = UsageView;

const emptyUsage = (): UsageView => ({
  plan: "",
  planLabel: "",
  canAsk: false,
  planExpiresAt: 0,
  monthPct: 0,
  monthResetsAt: 0,
  windowPct: 0,
  windowResetsAt: 0,
  weekPct: 0,
  weekResetsAt: 0,
  resetsAvailable: 0,
  canUseReset: false,
});

const platformError = (status: number, detail: string) => {
  const quota = status === 403 || /额度|套餐|次数/.test(detail);
  const auth = status === 401;
  const message = auth ? "登录已失效，请重新登录" : quota ? (detail || "额度已用完") : detail || "服务暂时不可用";
  return new ProviderError("platform", message, detail, auth ? "auth" : quota ? "quota" : status === 0 ? "network" : "other", {
    hint: auth ? "请在设置里重新登录。" : quota ? "可在设置里查看用量恢复时间，或联系管理员开通套餐。" : "请稍后重试。",
  });
};

function parseUsage(payload: Record<string, unknown> | null | undefined): UsageView {
  const raw = payload ?? {};
  // 登录 / me / usage / runs 都应带回完整快照；缺字段时保留本地值，避免提问响应偶发缺到期把展示清成 0
  const prior = useSettings.getState().usage ?? emptyUsage();
  const pick = (snake: string, camel: string) => {
    if (Object.prototype.hasOwnProperty.call(raw, snake) && raw[snake] != null) return raw[snake];
    if (Object.prototype.hasOwnProperty.call(raw, camel) && raw[camel] != null) return raw[camel];
    return undefined;
  };
  const pct = (snake: string, camel: string, fallback: number) => {
    const value = pick(snake, camel);
    if (value === undefined) return fallback;
    return Math.max(0, Math.min(100, Math.floor(Number(value) || 0)));
  };
  const at = (snake: string, camel: string, fallback: number) => {
    const value = pick(snake, camel);
    if (value === undefined) return fallback;
    return Math.max(0, Math.floor(Number(value) || 0));
  };
  const has = (snake: string, camel: string) => pick(snake, camel) !== undefined;
  const plan = has("plan", "plan")
    ? (typeof raw.plan === "string" ? raw.plan : "")
    : prior.plan;
  const planLabel = has("plan_label", "planLabel")
    ? (typeof raw.plan_label === "string"
      ? raw.plan_label
      : typeof raw.planLabel === "string"
        ? raw.planLabel
        : "")
    : prior.planLabel;
  const canAsk = has("can_ask", "canAsk") ? Boolean(raw.can_ask ?? raw.canAsk) : prior.canAsk;
  const resetsAvailable = has("resets_available", "resetsAvailable")
    ? Math.max(0, Math.floor(Number(raw.resets_available ?? raw.resetsAvailable) || 0))
    : prior.resetsAvailable;
  const canUseReset = has("can_use_reset", "canUseReset")
    ? Boolean(raw.can_use_reset ?? raw.canUseReset)
    : prior.canUseReset;
  return {
    plan,
    planLabel,
    canAsk,
    planExpiresAt: at("plan_expires_at", "planExpiresAt", prior.planExpiresAt),
    monthPct: pct("month_pct", "monthPct", prior.monthPct),
    monthResetsAt: at("month_resets_at", "monthResetsAt", prior.monthResetsAt),
    windowPct: pct("window_pct", "windowPct", prior.windowPct),
    windowResetsAt: at("window_resets_at", "windowResetsAt", prior.windowResetsAt),
    weekPct: pct("week_pct", "weekPct", prior.weekPct),
    weekResetsAt: at("week_resets_at", "weekResetsAt", prior.weekResetsAt),
    resetsAvailable,
    canUseReset,
  };
}

function applyUsage(usage: UsageView) {
  settingsActions.update({ canAsk: usage.canAsk, usage });
}

function applyUsageHeaders(res: Response) {
  const canAskRaw = res.headers.get("X-Lanshan-Can-Ask");
  const monthRaw = res.headers.get("X-Lanshan-Month-Pct");
  const windowRaw = res.headers.get("X-Lanshan-Window-Pct");
  const weekRaw = res.headers.get("X-Lanshan-Week-Pct");
  if (canAskRaw == null && monthRaw == null && windowRaw == null && weekRaw == null) return;
  const current = useSettings.getState().usage ?? emptyUsage();
  const next: UsageView = {
    ...current,
    canAsk: canAskRaw == null ? current.canAsk : canAskRaw === "1",
    monthPct: monthRaw == null ? current.monthPct : Math.max(0, Math.min(100, Math.floor(Number(monthRaw) || 0))),
    windowPct: windowRaw == null ? current.windowPct : Math.max(0, Math.min(100, Math.floor(Number(windowRaw) || 0))),
    weekPct: weekRaw == null ? current.weekPct : Math.max(0, Math.min(100, Math.floor(Number(weekRaw) || 0))),
  };
  // 已用百分比：成功扣次只采纳更高值，避免并行响应乱序回退；
  // 但若服务端明确 can_ask=1，允许百分比下降（窗已重置）
  if (res.ok && canAskRaw !== "1") {
    if (monthRaw != null && next.monthPct < current.monthPct) next.monthPct = current.monthPct;
    if (windowRaw != null && next.windowPct < current.windowPct) next.windowPct = current.windowPct;
    if (weekRaw != null && next.weekPct < current.weekPct) next.weekPct = current.weekPct;
  }
  applyUsage(next);
}

/** 本地显示不可问时，按最近重置点主动拉一次；用于窗恢复后不用开设置 */
export async function refreshUsageIfNeeded(): Promise<UsageView | null> {
  const state = useSettings.getState();
  if (!state.session) return null;
  if (state.canAsk) return state.usage;
  const usage = state.usage;
  const now = Math.floor(Date.now() / 1000);
  const due =
    !usage ||
    (usage.windowResetsAt > 0 && usage.windowResetsAt <= now) ||
    (usage.weekResetsAt > 0 && usage.weekResetsAt <= now) ||
    (usage.monthResetsAt > 0 && usage.monthResetsAt <= now);
  if (!due && usage) return usage;
  return fetchUsage();
}

async function readDetail(res: Response) {
  const text = await res.text().catch(() => "");
  try {
    const json = JSON.parse(text) as { detail?: unknown };
    return typeof json.detail === "string" ? json.detail : text.slice(0, 200);
  } catch {
    return text.slice(0, 200);
  }
}

async function platformFetch(path: string, init: RequestInit = {}, fetchImpl: typeof httpFetch = httpFetch) {
  const session = useSettings.getState().session;
  const headers = new Headers(init.headers);
  if (session && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${session}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let res: Response;
  try {
    res = await fetchImpl(`${PLATFORM_URL}${path}`, { ...init, headers });
  } catch (err) {
    if (init.signal?.aborted) throw err;
    if (err instanceof ProviderError) throw err;
    throw platformError(0, String(err));
  }
  applyUsageHeaders(res);
  if (res.status === 401) {
    const detail = await readDetail(res);
    if (session) {
      settingsActions.clearAccount();
      throw platformError(401, detail);
    }
    throw new ProviderError("platform", detail || "账号或密码错误", detail, "auth");
  }
  if (!res.ok) throw platformError(res.status, await readDetail(res));
  return res;
}

export async function login(username: string, password: string) {
  const res = await platformFetch("/api/lanshan/login", {
    method: "POST",
    body: JSON.stringify({ username: username.trim(), password }),
  });
  const payload = (await res.json()) as AuthPayload;
  const session = payload.session?.trim() ?? "";
  if (!session || !payload.account) throw platformError(500, "登录结果不完整");
  const usage = parseUsage(payload);
  settingsActions.update({ session, account: payload.account, canAsk: usage.canAsk, usage });
}

export async function logout() {
  try {
    if (useSettings.getState().session) await platformFetch("/api/lanshan/logout", { method: "POST" });
  } catch {
    /* 本地清掉即可 */
  }
  settingsActions.clearAccount();
}

export async function refreshAccount() {
  const session = useSettings.getState().session;
  if (!session) return;
  try {
    const res = await platformFetch("/api/lanshan/me");
    const payload = (await res.json()) as AuthPayload;
    if (payload.account) {
      const usage = parseUsage(payload);
      settingsActions.update({ account: payload.account, canAsk: usage.canAsk, usage });
    }
  } catch (err) {
    if (err instanceof ProviderError && err.kind === "auth") return;
  }
}

export async function fetchUsage(): Promise<UsagePayload | null> {
  const session = useSettings.getState().session;
  if (!session) return null;
  try {
    const res = await platformFetch("/api/lanshan/usage");
    const payload = (await res.json()) as Record<string, unknown>;
    const usage = parseUsage(payload);
    applyUsage(usage);
    return usage;
  } catch (err) {
    if (err instanceof ProviderError && err.kind === "auth") return null;
    return null;
  }
}

/** 使用一次预存重置：只清 5 小时与 7 天窗，不动月额度 */
export async function redeemReset(): Promise<UsagePayload> {
  const res = await platformFetch("/api/lanshan/resets/redeem", { method: "POST" });
  const payload = (await res.json()) as Record<string, unknown>;
  const usage = parseUsage(payload);
  applyUsage(usage);
  return usage;
}

export async function startRun(kind: string) {
  const res = await platformFetch("/api/lanshan/runs", { method: "POST", body: JSON.stringify({ kind }) });
  const payload = (await res.json()) as Record<string, unknown> & { id?: string };
  const id = payload.id?.trim() ?? "";
  if (!id) throw platformError(500, "无法开始这次回答");
  applyUsage(parseUsage(payload));
  return id;
}

/** 把发给腾讯的请求改送到平台，并带上本次运行凭证 */
export function platformProviderFetch(
  runId: string,
  path: "/api/lanshan/llm/chat/completions" | "/api/lanshan/search",
  fetchImpl: typeof httpFetch = httpFetch,
): typeof httpFetch {
  return (_input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("X-Lanshan-Run", runId);
    headers.delete("Authorization");
    return platformFetch(path, { ...init, headers }, fetchImpl);
  };
}
