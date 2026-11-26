import { beginSourceSync, completeIndexJob, finishSourceSync, getSource, listDocuments, markDocumentIndexFailed, putSource, removeSourceDocument, saveSourceDocument, sourceSyncCurrent, startIndexJob, updateIndexJob, updateSourceDocumentUrl } from "./db.ts";
import { normalizeRepositoryScope, parseGitHubRepository, parseGitLabRepository, type RepositoryFile } from "./repository-parse.ts";
import { githubDocumentUrl, loadGitHubSnapshot, readGitHubMarkdown, type RepositorySnapshot } from "./github.ts";
import { gitlabDocumentUrl, loadGitLabSnapshot, readGitLabMarkdown } from "./gitlab.ts";
import type { KnowledgeSource } from "./model.ts";

type RepositoryKind = "github" | "gitlab";

async function sourceId(kind: RepositoryKind, owner: string, repo: string, branch: string, folder: string): Promise<string> {
  const key = `${owner.toLowerCase()}/${repo.toLowerCase()}@${branch}/${folder}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return `${kind}:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function documentId(source: KnowledgeSource, path: string): string {
  return `${source.id}:${path}`;
}

function repositoryDocumentUrl(source: KnowledgeSource, commit: string, path: string): string {
  return source.kind === "gitlab" ? gitlabDocumentUrl(source, commit, path) : githubDocumentUrl(source, commit, path);
}

function readRepositoryMarkdown(source: KnowledgeSource, commit: string, file: RepositoryFile) {
  return source.kind === "gitlab" ? readGitLabMarkdown(source, commit, file) : readGitHubMarkdown(source, commit, file);
}

function loadSnapshot(kind: RepositoryKind, owner: string, repo: string, branch: string, scope: string): Promise<RepositorySnapshot> {
  return kind === "gitlab" ? loadGitLabSnapshot(owner, repo, branch, scope) : loadGitHubSnapshot(owner, repo, branch, scope);
}

async function importSnapshot(source: KnowledgeSource, token: string, snapshot: RepositorySnapshot): Promise<void> {
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
          const parsed = await readRepositoryMarkdown(source, snapshot.commit, file);
          const saved = await saveSourceDocument({
            id: previous?.id ?? documentId(source, file.path), sourceId: source.id,
            sourcePath: file.path, sourceUrl: repositoryDocumentUrl(source, snapshot.commit, file.path),
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
      } else if (previous.sourceUrl !== repositoryDocumentUrl(source, snapshot.commit, file.path)) {
        await updateSourceDocumentUrl(previous.id, source, token, file.sha, repositoryDocumentUrl(source, snapshot.commit, file.path));
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

export async function addRepositorySource(rawUrl: string, rawBranch: string, rawScope: string): Promise<void> {
  let host: string;
  try { host = new URL(rawUrl.trim()).hostname.toLowerCase(); }
  catch { throw new Error("请输入公开 GitHub 或 GitLab 仓库地址"); }
  if (host !== "github.com" && host !== "gitlab.com") throw new Error("目前支持 github.com 和 gitlab.com 的公开仓库");
  const kind: RepositoryKind = host === "gitlab.com" ? "gitlab" : "github";
  const { owner, repo } = kind === "gitlab" ? parseGitLabRepository(rawUrl) : parseGitHubRepository(rawUrl);
  const { branch, folder } = normalizeRepositoryScope(rawBranch, rawScope);
  const snapshot = await loadSnapshot(kind, owner, repo, branch, folder);
  const id = await sourceId(kind, owner, repo, snapshot.branch, folder);
  if (await getSource(id)) throw new Error("这个仓库范围已经添加，请使用同步更新");
  const now = Date.now();
  const source: KnowledgeSource = {
    id, kind, name: `${owner}/${repo}`, enabled: true, createdAt: now, updatedAt: now,
    repoOwner: owner, repoName: repo, branch: snapshot.branch, folderPath: folder,
  };
  await putSource(source);
  await importSnapshot(source, await beginSourceSync(source), snapshot);
}

export async function syncRepositorySource(source: KnowledgeSource): Promise<void> {
  if ((source.kind !== "github" && source.kind !== "gitlab") || !source.repoOwner || !source.repoName || !source.branch || source.folderPath === undefined) {
    throw new Error("仓库数据源配置不完整");
  }
  const token = await beginSourceSync(source);
  let snapshot: RepositorySnapshot;
  try { snapshot = await loadSnapshot(source.kind, source.repoOwner, source.repoName, source.branch, source.folderPath); }
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
