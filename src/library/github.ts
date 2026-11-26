import { httpFetch } from "../core/http.ts";
import { selectRepositoryFiles, type RepositoryFile } from "./repository-parse.ts";
import type { KnowledgeSource } from "./model.ts";
import { parseDocument } from "./parse.ts";
import { readLimitedBytes } from "./read-limited.ts";

export interface RepositorySnapshot { branch: string; commit: string; files: RepositoryFile[] }

async function apiJson(path: string, label: string, limit = 8 * 1024 * 1024): Promise<unknown> {
  const response = await httpFetch(`https://api.github.com${path}`, {
    method: "GET", signal: AbortSignal.timeout(15_000), redirect: "manual", maxRedirections: 0,
    headers: { Accept: "application/vnd.github+json" },
  } as RequestInit);
  if (response.status === 403 || response.status === 429) throw new Error("GitHub 访问受限或达到请求限额，请稍后重试");
  if (response.status === 404) throw new Error(`${label}不存在或不是公开内容`);
  if (!response.ok) throw new Error(`${label}读取失败（HTTP ${response.status}）`);
  const bytes = await readLimitedBytes(response, limit, label);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new Error(`${label}返回格式无法读取`); }
}

export async function loadGitHubSnapshot(owner: string, repo: string, requestedBranch: string, scope: string): Promise<RepositorySnapshot> {
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const metadata = await apiJson(base, "仓库", 1024 * 1024) as { private?: unknown; default_branch?: unknown };
  if (!metadata || metadata.private !== false || typeof metadata.default_branch !== "string") throw new Error("目前只能导入公开 GitHub 仓库");
  const branch = requestedBranch || metadata.default_branch;
  const branchData = await apiJson(`${base}/branches/${encodeURIComponent(branch)}`, "分支", 1024 * 1024) as { commit?: { sha?: unknown } };
  const commit = branchData?.commit?.sha;
  if (typeof commit !== "string" || !/^[0-9a-f]{40}$/iu.test(commit)) throw new Error("GitHub 分支版本无法读取");
  const fileScope = /\.(?:md|markdown)$/iu.test(scope);
  if (fileScope) {
    const path = scope.split("/").map(encodeURIComponent).join("/");
    const file = await apiJson(`${base}/contents/${path}?ref=${commit}`, "所选 Markdown 文件") as { type?: unknown; sha?: unknown; size?: unknown; path?: unknown };
    if (!file || file.type !== "file" || file.path !== scope || typeof file.sha !== "string" || !/^[0-9a-f]{40}$/iu.test(file.sha)
      || typeof file.size !== "number" || file.size < 0) throw new Error("所选 Markdown 文件无法读取");
    return { branch, commit, files: [{ path: scope, sha: file.sha, size: file.size }] };
  }
  const folder = scope;
  let treeSha = commit;
  if (folder) {
    for (const segment of folder.split("/")) {
      const parent = await apiJson(`${base}/git/trees/${treeSha}`, "仓库目录") as { truncated?: unknown; tree?: { path?: unknown; type?: unknown; sha?: unknown }[] };
      if (!parent || parent.truncated || !Array.isArray(parent.tree)) throw new Error("仓库目录列表不完整");
      const child = parent.tree.find((entry) => entry.path === segment && entry.type === "tree");
      if (typeof child?.sha !== "string" || !/^[0-9a-f]{40}$/iu.test(child.sha)) throw new Error("所选子目录不存在");
      treeSha = child.sha;
    }
  }
  const tree = await apiJson(`${base}/git/trees/${treeSha}?recursive=1`, "仓库文件列表");
  const scoped = folder && tree && typeof tree === "object" && "tree" in tree && Array.isArray(tree.tree)
    ? { ...tree, tree: tree.tree.map((entry: { path?: string }) => ({ ...entry, path: `${folder}/${entry.path}` })) }
    : tree;
  return { branch, commit, files: selectRepositoryFiles(scoped, folder) };
}

export function githubDocumentUrl(source: KnowledgeSource, commit: string, path: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${encodeURIComponent(source.repoOwner!)}/${encodeURIComponent(source.repoName!)}/blob/${commit}/${encoded}`;
}

export async function readGitHubMarkdown(source: KnowledgeSource, commit: string, file: RepositoryFile) {
  if (file.size !== undefined && file.size > 2 * 1024 * 1024) throw new Error("Markdown 文件超过 2 MB");
  const encoded = file.path.split("/").map(encodeURIComponent).join("/");
  const url = `https://raw.githubusercontent.com/${encodeURIComponent(source.repoOwner!)}/${encodeURIComponent(source.repoName!)}/${commit}/${encoded}`;
  const response = await httpFetch(url, { method: "GET", signal: AbortSignal.timeout(15_000), redirect: "manual", maxRedirections: 0 } as RequestInit);
  if (response.status === 403 || response.status === 429) throw new Error("GitHub 文件访问受限，请稍后重试");
  if (!response.ok) throw new Error(`文件读取失败（HTTP ${response.status}）`);
  const bytes = await readLimitedBytes(response, 2 * 1024 * 1024, file.path);
  const name = file.path.split("/").pop()!;
  return parseDocument(new File([new Uint8Array(bytes)], /\./u.test(name) ? name : `${name}.md`));
}
