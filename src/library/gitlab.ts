import { httpFetch } from "../core/http.ts";
import { selectRepositoryFiles, type RepositoryFile } from "./repository-parse.ts";
import type { RepositorySnapshot } from "./github.ts";
import type { KnowledgeSource } from "./model.ts";
import { parseDocument } from "./parse.ts";
import { readLimitedBytes } from "./read-limited.ts";

async function api(path: string, label: string, method = "GET"): Promise<Response> {
  const response = await httpFetch(`https://gitlab.com/api/v4${path}`, {
    method, signal: AbortSignal.timeout(15_000), redirect: "manual", maxRedirections: 0,
  } as RequestInit);
  if (response.status === 403 || response.status === 429) throw new Error("GitLab 访问受限或达到请求限额，请稍后重试");
  if (response.status === 404) throw new Error(`${label}不存在或不是公开内容`);
  if (!response.ok) throw new Error(`${label}读取失败（HTTP ${response.status}）`);
  return response;
}

async function apiJson(path: string, label: string): Promise<unknown> {
  const bytes = await readLimitedBytes(await api(path, label), 8 * 1024 * 1024, label);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new Error(`${label}返回格式无法读取`); }
}

export async function loadGitLabSnapshot(owner: string, repo: string, requestedBranch: string, scope: string): Promise<RepositorySnapshot> {
  const project = encodeURIComponent(`${owner}/${repo}`);
  const base = `/projects/${project}`;
  const metadata = await apiJson(base, "仓库") as { visibility?: unknown; default_branch?: unknown };
  if (!metadata || metadata.visibility !== "public" || typeof metadata.default_branch !== "string") throw new Error("目前只能导入公开 GitLab 仓库");
  const branch = requestedBranch || metadata.default_branch;
  const branchData = await apiJson(`${base}/repository/branches/${encodeURIComponent(branch)}`, "分支") as { commit?: { id?: unknown } };
  const commit = branchData?.commit?.id;
  if (typeof commit !== "string" || !/^[0-9a-f]{40}$/iu.test(commit)) throw new Error("GitLab 分支版本无法读取");
  const fileScope = /\.(?:md|markdown)$/iu.test(scope);
  if (fileScope) {
    const response = await api(`${base}/repository/files/${encodeURIComponent(scope)}?ref=${commit}`, "所选 Markdown 文件", "HEAD");
    const sha = response.headers.get("x-gitlab-blob-id");
    const sizeHeader = response.headers.get("x-gitlab-size");
    const size = Number(sizeHeader);
    if (!sha || !/^[0-9a-f]{40}$/iu.test(sha) || !sizeHeader || !/^\d+$/u.test(sizeHeader) || !Number.isSafeInteger(size)) throw new Error("所选 Markdown 文件元数据无法读取");
    return { branch, commit, files: [{ path: scope, sha, size }] };
  }
  const folder = scope;
  const entries: { path: string; type: string; id: string }[] = [];
  for (let page = 1; page <= 100; page++) {
    const path = `${base}/repository/tree?ref=${encodeURIComponent(commit)}&recursive=true&per_page=100&page=${page}${folder ? `&path=${encodeURIComponent(folder)}` : ""}`;
    const response = await api(path, "仓库文件列表");
    const bytes = await readLimitedBytes(response, 8 * 1024 * 1024, "仓库文件列表");
    let batch: unknown;
    try { batch = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
    catch { throw new Error("仓库文件列表返回格式无法读取"); }
    if (!Array.isArray(batch) || !batch.every((entry) => entry && typeof entry.path === "string" && typeof entry.type === "string" && typeof entry.id === "string")) {
      throw new Error("仓库文件列表格式错误");
    }
    entries.push(...batch);
    if (entries.length > 10_000) throw new Error("仓库文件过多，请选择更小的子目录");
    if (!response.headers.get("x-next-page") && batch.length < 100) break;
    if (response.headers.has("x-next-page") && !response.headers.get("x-next-page")) break;
    if (page === 100) throw new Error("仓库文件列表过长，请选择更小的子目录");
  }
  const tree = { truncated: false, tree: entries.map((entry) => ({ path: entry.path, type: entry.type, sha: entry.id, size: 0 })) };
  return { branch, commit, files: selectRepositoryFiles(tree, folder).map(({ path, sha }) => ({ path, sha })) };
}

export function gitlabDocumentUrl(source: KnowledgeSource, commit: string, path: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `https://gitlab.com/${source.repoOwner!.split("/").map(encodeURIComponent).join("/")}/${encodeURIComponent(source.repoName!)}/-/blob/${commit}/${encoded}`;
}

export async function readGitLabMarkdown(source: KnowledgeSource, commit: string, file: RepositoryFile) {
  const project = encodeURIComponent(`${source.repoOwner}/${source.repoName}`);
  const url = `https://gitlab.com/api/v4/projects/${project}/repository/files/${encodeURIComponent(file.path)}/raw?ref=${encodeURIComponent(commit)}`;
  const response = await httpFetch(url, { method: "GET", signal: AbortSignal.timeout(15_000), redirect: "manual", maxRedirections: 0 } as RequestInit);
  if (response.status === 403 || response.status === 429) throw new Error("GitLab 文件访问受限，请稍后重试");
  if (!response.ok) throw new Error(`文件读取失败（HTTP ${response.status}）`);
  const bytes = await readLimitedBytes(response, 2 * 1024 * 1024, file.path);
  const name = file.path.split("/").pop()!;
  return parseDocument(new File([new Uint8Array(bytes)], /\./u.test(name) ? name : `${name}.md`));
}
