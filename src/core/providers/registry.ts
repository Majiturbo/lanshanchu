import { platformProviderFetch } from "../platform.ts";
import { profiles } from "../models.ts";
import { createMockLLM, createMockReader, createMockSearch } from "./mock.ts";
import { createTokenHub } from "./tokenhub.ts";
import { ProviderError, type HttpFetch, type LLMProvider, type SearchProvider } from "./types.ts";
import { createPageReader, type PageReader } from "./web.ts";
import { createYuanbao } from "./yuanbao.ts";

// 供应商注册表：登录后经平台转发混元与元宝搜索，密钥不进客户端。

export interface ProviderSettings {
  session: string;
  runId: string;
  model: string;
  mock: boolean;
  fetch: HttpFetch;
  /** 读网页全文用的请求：不经调试日志的完整记录（网页 HTML 太大），由研究 Agent 自己记摘要 */
  pageFetch: HttpFetch;
}

export function createProviders(s: ProviderSettings): { llm: LLMProvider; search: SearchProvider | null; reader: PageReader } {
  if (s.mock) return { llm: createMockLLM(), search: createMockSearch(), reader: createMockReader() };
  if (!s.session.trim()) throw new ProviderError("platform", "请先登录", undefined, "config");
  if (!s.runId.trim()) throw new ProviderError("platform", "无法开始这次回答", undefined, "quota");
  return {
    llm: createTokenHub({ apiKey: "platform", models: profiles(s.model), fetch: platformProviderFetch(s.runId, "/api/lanshan/llm/chat/completions", s.fetch) }),
    search: createYuanbao({ apiKey: "platform", fetch: platformProviderFetch(s.runId, "/api/lanshan/search", s.fetch) }),
    reader: createPageReader(s.pageFetch),
  };
}
