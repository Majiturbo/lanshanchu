import { commonProps } from "./context.ts";
import type { AnalyticsEvent, EventName, EventProps, TrackedEvent } from "./events.ts";
import { ensureIdentity, hoursSinceInstall, markEffectiveExplore, takeColdStart } from "./identity.ts";
import { enqueue, flush } from "./queue.ts";

type Sink = (ev: TrackedEvent) => void;

let sink: Sink = enqueue;
const once = new Set<string>();

export function setAnalyticsSink(next: Sink) {
  sink = next;
}

export function track<N extends EventName>(name: N, props: EventProps<N>, mapId?: string | null) {
  ensureIdentity();
  const ev: TrackedEvent = { name, props: { ...props }, ...commonProps(mapId) };
  if (import.meta.env.DEV) console.debug("[analytics]", name, ev.props);
  sink(ev);
}

/** 同一进程内同 key 只打一次（如 extension_shown 按节点） */
export function trackOnce<N extends EventName>(key: string, name: N, props: EventProps<N>, mapId?: string | null) {
  if (once.has(key)) return;
  once.add(key);
  track(name, props, mapId);
}

export function trackAppOpened() {
  track("app_opened", { cold_start: takeColdStart() });
  // 启动时顺带冲一次本地队列；失败无感
  void flush().catch(() => {});
}

/** 有效探索：点开延伸或主动追问；生涯只记一次 first_effective_explore */
export function noteEffectiveExplore(via: "extension" | "followup", mapId?: string | null) {
  if (!markEffectiveExplore()) return;
  track("first_effective_explore", { hours_since_install: hoursSinceInstall(), via }, mapId);
}

export function resetTrackOnceForTest() {
  once.clear();
}

/** 便于类型收窄的包装：接受完整 AnalyticsEvent */
export function trackEvent(ev: AnalyticsEvent, mapId?: string | null) {
  track(ev.name, ev.props as EventProps<typeof ev.name>, mapId);
}
