/** 产品分析事件字典：事件名与属性；不含问题 / 答案 / 记忆原文。 */

export type LenBucket = "0-20" | "21-80" | "81+";
export type PctBucket = "0-25" | "26-50" | "51-75" | "76-100";
export type NodeKind = "root" | "followup" | "compare" | "synth" | "news";
export type AnalyticsEvent =
  | { name: "app_opened"; props: { cold_start: boolean } }
  | { name: "home_viewed"; props: { recent_map_count: number } }
  | { name: "login_started"; props: { from: "settings" | "ask_gate" } }
  | { name: "login_succeeded"; props: { from: "settings" | "ask_gate" } }
  | { name: "login_failed"; props: { from: "settings" | "ask_gate"; error_code?: string } }
  | { name: "settings_opened"; props: { reason: "manual" | "login" | "quota" } }
  | { name: "quota_gate_shown"; props: { reason: "no_plan" | "month" | "5h" | "7d" } }
  | { name: "quota_blocked"; props: { window: "no_plan" | "month" | "5h" | "7d" } }
  | {
      name: "map_created";
      props: { entry: "home" | "start_here"; has_image: boolean; search_on: boolean; input_len_bucket: LenBucket };
    }
  | { name: "map_opened"; props: { node_count: number } }
  | {
      name: "ask_completed";
      props: {
        node_kind: NodeKind;
        depth: number;
        framed: boolean;
        settled: boolean;
        has_visual: boolean;
        source_count: number;
        duration_ms: number;
        search_rounds: number;
        search_on: boolean;
      };
    }
  | {
      name: "ask_failed";
      props: { node_kind: NodeKind; depth: number; stage?: string; error_code?: string; duration_ms: number };
    }
  | { name: "ask_cancelled"; props: { node_kind: NodeKind; depth: number; duration_ms: number } }
  | { name: "extension_shown"; props: { count: number; has_next_why: boolean; depth: number } }
  | { name: "extension_opened"; props: { is_next: boolean; index: number; depth: number } }
  | { name: "followup_submitted"; props: { intent: "ask" | "branch"; parent_depth: number } }
  | { name: "node_framed"; props: { depth: number } }
  | { name: "node_settled"; props: { path_depth: number } }
  | { name: "first_effective_explore"; props: { hours_since_install: number; via: "extension" | "followup" } }
  | { name: "compare_created"; props: { mode: "on" | "off" } }
  | { name: "synth_created"; props: { source_count: number; preset: string } }
  | { name: "node_closed"; props: { had_subtree: boolean; depth: number } }
  | { name: "node_reopened"; props: Record<string, never> }
  | { name: "detail_generated"; props: { trigger: "manual" | "auto"; duration_ms?: number } }
  | { name: "cite_opened"; props: Record<string, never> }
  | { name: "source_opened"; props: { via: "list" | "cite" | "reader"; open_mode: "browser" | "reader" } }
  | { name: "reader_opened"; props: { had_fulltext: boolean } }
  | { name: "reader_fulltext_loaded"; props: Record<string, never> }
  | { name: "visual_shown"; props: { type: string } }
  | { name: "export_done"; props: { scope: "node" | "selection" | "map" | "summary" } }
  | { name: "summary_generated"; props: { scope: "all" | "path" | "selection" } };

export type EventName = AnalyticsEvent["name"];

export type EventProps<N extends EventName> = Extract<AnalyticsEvent, { name: N }>["props"];

export interface CommonProps {
  anon_id: string;
  user_id: string | null;
  session_id: string;
  app_version: string;
  os: "mac" | "win" | "linux" | "web" | "unknown";
  plan: string;
  can_ask: boolean;
  map_id: string | null;
  ts: number;
}

export type TrackedEvent = {
  name: EventName;
  props: Record<string, unknown>;
} & CommonProps;

export function lenBucket(n: number): LenBucket {
  if (n <= 20) return "0-20";
  if (n <= 80) return "21-80";
  return "81+";
}

export function pctBucket(pct: number): PctBucket {
  const p = Math.max(0, Math.min(100, Math.floor(pct)));
  if (p <= 25) return "0-25";
  if (p <= 50) return "26-50";
  if (p <= 75) return "51-75";
  return "76-100";
}

export function quotaReason(usage: { plan: string; monthPct: number; windowPct: number; weekPct: number } | null | undefined): "no_plan" | "month" | "5h" | "7d" {
  if (!usage?.plan) return "no_plan";
  if (usage.monthPct >= 100) return "month";
  if (usage.windowPct >= 100) return "5h";
  if (usage.weekPct >= 100) return "7d";
  return "no_plan";
}
