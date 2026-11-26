import { httpFetch } from "../core/http.ts";
import { beginSourceSync, completeIndexJob, finishSourceSync, getSource, listDocuments, markDocumentIndexFailed, putSource, removeSourceDocument, saveSourceDocument, sourceSyncCurrent, startIndexJob, updateIndexJob, updateSourceDocumentUrl } from "./db.ts";
import { normalizeGitHubScope, parseGitHubRepository, selectGitHubFiles, type GitHubFile } from "./github-parse.ts";
import type { KnowledgeSource } from "./model.ts";
import { parseDocument } from "./parse.ts";
import { readLimitedBytes } from "./read-limited.ts";

interface Snapshot { branch: string; commit: string; files: GitHubFile[] }

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

async function loadSnapshot(owner: string, repo: string, requestedBranch: string, folder: string): Promise<Snapshot> {
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const metadata = await apiJson(base, "仓库", 1024 * 1024) as { private?: unknown; default_branch?: unknown };
  if (metadata.private !== false || typeof metadata.default_branch !== "string") throw new Error("目前只能导入公开 GitHub 仓库");
  const branch = requestedBranch || metadata.default_branch;
  const branchData = await apiJson(`${base}/branches/${encodeURIComponent(branch)}`, "分支", 1024 * 1024) as { commit?: { sha?: unknown } };
  const commit = branchData.commit?.sha;
  if (typeof commit !== "string" || !/^[0-9a-f]{40}$/iu.test(commit)) throw new Error("GitHub 分支版本无法读取");
  let treeSha = commit;
  if (folder) {
    for (const segment of folder.split("/")) {
      const parent = await apiJson(`${base}/git/trees/${treeSha}`, "仓库目录", 8 * 1024 * 1024) as { truncated?: unknown; tree?: { path?: unknown; type?: unknown; sha?: unknown }[] };
      if (parent.truncated || !Array.isArray(parent.tree)) throw new Error("仓库目录列表不完整");
      const child = parent.tree.find((entry) => entry.path === segment && entry.type === "tree");
      if (typeof child?.sha !== "string" || !/^[0-9a-f]{40}$/iu.test(child.sha)) throw new Error("所选子目录不存在");
      treeSha = child.sha;
    }
  }
  const tree = await apiJson(`${base}/git/trees/${treeSha}?recursive=1`, "仓库文件列表");
  const scoped = folder && tree && typeof tree === "object" && "tree" in tree && Array.isArray(tree.tree)
    ? { ...tree, tree: tree.tree.map((entry: { path?: string }) => ({ ...entry, path: `${folder}/${entry.path}` })) }
    : tree;
  return { branch, commit, files: selectGitHubFiles(scoped, folder) };
}

async function sourceId(owner: string, repo: string, branch: string, folder: string): Promise<string> {
  const key = `${owner.toLowerCase()}/${repo.toLowerCase()}@${branch}/${folder}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return `github:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function documentId(source: KnowledgeSource, path: string): string {
  return `${source.id}:${path}`;
}

function documentUrl(source: KnowledgeSource, commit: string, path: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${encodeURIComponent(source.repoOwner!)}/${encodeURIComponent(source.repoName!)}/blob/${commit}/${encoded}`;
}

async function readMarkdown(source: KnowledgeSource, commit: string, file: GitHubFile) {
  if (file.size > 2 * 1024 * 1024) throw new Error("Markdown 文件超过 2 MB");
  const encoded = file.path.split("/").map(encodeURIComponent).join("/");
  const url = `https://raw.githubusercontent.com/${encodeURIComponent(source.repoOwner!)}/${encodeURIComponent(source.repoName!)}/${commit}/${encoded}`;
  const response = await httpFetch(url, { method: "GET", signal: AbortSignal.timeout(15_000), redirect: "manual", maxRedirections: 0 } as RequestInit);
  if (response.status === 403 || response.status === 429) throw new Error("GitHub 文件访问受限，请稍后重试");
  if (!response.ok) throw new Error(`文件读取失败（HTTP ${response.status}）`);
  const bytes = await readLimitedBytes(response, 2 * 1024 * 1024, file.path);
  const name = file.path.split("/").pop()!;
  return parseDocument(new File([new Uint8Array(bytes)], /\./u.test(name) ? name : `${name}.md`));
}

async function importSnapshot(source: KnowledgeSource, token: string, snapshot: Snapshot): Promise<void> {
  let job = await startIndexJob(source.id, "import", 0, source, token);
  try {
    const existing = await listDocuments(source.id);
    const byPath = new Map(existing.filter((document) => document.sourcePath).map((document) => [document.sourcePath!, document]));
    const paths = new Set(snapshot.files.map((file) => file.path));
    const removed = existing.filter((document) => document.sourcePath && !paths.has(document.sourcePath));
    job = await updateIndexJob(job.id, { stage: "reading", total: snapshot.files.length + removed.length }, source, token);
    let completed = 0;
    let updated = 0;
    let failed = 0;
    for (const file of snapshot.files) {
      if (!await sourceSyncCurrent(source, token)) throw new Error("仓库同步已被新任务替代");
      const previous = byPath.get(file.path);
      if (previous?.sourceRevision !== file.sha || previous.indexStatus !== "ready") {
        try {
          const parsed = await readMarkdown(source, snapshot.commit, file);
          const saved = await saveSourceDocument({
            id: previous?.id ?? documentId(source, file.path), sourceId: source.id,
            sourcePath: file.path, sourceUrl: documentUrl(source, snapshot.commit, file.path),
            sourceRevision: file.sha, sourceSize: file.size, name: file.path, format: "md",
            ...parsed, importedAt: Date.now(),
          }, source, token);
          if (!saved) throw new Error("仓库同步已被新任务替代");
          updated++;
        } catch (error) {
          if (!await sourceSyncCurrent(source, token)) throw new Error("仓库同步已被新任务替代");
          failed++;
          if (previous) await markDocumentIndexFailed(previous, error, source, token);
          job = await updateIndexJob(job.id, { stage: "indexing", completed: completed + 1, updated, failed, error: { name: file.path, message: error instanceof Error ? error.message : "导入失败" } }, source, token);
          completed++;
          continue;
        }
      } else if (previous.sourceUrl !== documentUrl(source, snapshot.commit, file.path)) {
        await updateSourceDocumentUrl(previous.id, source, token, file.sha, documentUrl(source, snapshot.commit, file.path));
      }
      completed++;
      job = await updateIndexJob(job.id, { stage: "indexing", completed, updated, failed }, source, token);
    }
    for (const document of removed) {
      if (!await sourceSyncCurrent(source, token)) throw new Error("仓库同步已被新任务替代");
      if (await removeSourceDocument(document.id, source, token)) updated++;
      completed++;
      job = await updateIndexJob(job.id, { stage: "indexing", completed, updated, failed }, source, token);
    }
    job = await completeIndexJob(job.id, source, token);
    if (failed) throw new Error(`${failed} 份仓库文件导入失败，请查看数据源中的失败原因`);
    await finishSourceSync(source, token);
  } catch (error) {
    if (job.status === "running") {
      try {
        const failedJob = await updateIndexJob(job.id, { failed: Math.max(1, job.failed), error: { name: source.name, message: error instanceof Error ? error.message : "仓库同步失败" } }, source, token);
        await completeIndexJob(failedJob.id, source, token);
      } catch (jobError) {
        if (await getSource(source.id)) throw jobError;
      }
    }
    throw error;
  }
}

export async function addGitHubSource(rawUrl: string, rawBranch: string, rawFolder: string): Promise<void> {
  const { owner, repo } = parseGitHubRepository(rawUrl);
  const { branch, folder } = normalizeGitHubScope(rawBranch, rawFolder);
  const snapshot = await loadSnapshot(owner, repo, branch, folder);
  const id = await sourceId(owner, repo, snapshot.branch, folder);
  if (await getSource(id)) throw new Error("这个仓库范围已经添加，请使用同步更新");
  const now = Date.now();
  const source: KnowledgeSource = {
    id, kind: "github", name: `${owner}/${repo}`, enabled: true, createdAt: now, updatedAt: now,
    repoOwner: owner, repoName: repo, branch: snapshot.branch, folderPath: folder,
  };
  await putSource(source);
  await importSnapshot(source, await beginSourceSync(source), snapshot);
}

export async function syncGitHubSource(source: KnowledgeSource): Promise<void> {
  if (source.kind !== "github" || !source.repoOwner || !source.repoName || !source.branch || source.folderPath === undefined) {
    throw new Error("仓库数据源配置不完整");
  }
  const token = await beginSourceSync(source);
  let snapshot: Snapshot;
  try { snapshot = await loadSnapshot(source.repoOwner, source.repoName, source.branch, source.folderPath); }
  catch (error) {
    if (!await sourceSyncCurrent(source, token)) throw error;
    const job = await startIndexJob(source.id, "import", 1, source, token);
    await updateIndexJob(job.id, { stage: "reading", completed: 1, failed: 1, error: { name: source.name, message: error instanceof Error ? error.message : "读取仓库失败" } }, source, token);
    await completeIndexJob(job.id, source, token);
    throw error;
  }
  if (!await sourceSyncCurrent(source, token)) throw new Error("仓库同步已被新任务替代");
  await importSnapshot(source, token, snapshot);
}
