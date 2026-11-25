import { isTauri } from "@tauri-apps/api/core";
import { basename, join } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { exists, readDir, readFile, stat, watch, type UnwatchFn } from "@tauri-apps/plugin-fs";
import ignore, { type Ignore } from "ignore";
import { IS_MOBILE_APP } from "../core/device.ts";
import {
  completeIndexJob,
  getSource,
  listDocuments,
  listSources,
  markSourceSynced,
  markDocumentIndexFailed,
  putSource,
  removeScannedFolderDocument,
  removeSource,
  saveDocument,
  startIndexJob,
  updateIndexJob,
  type KnowledgeSource,
} from "./db.ts";
import { createFolderSource } from "./model.ts";
import { folderAllowsDocumentName, MAX_IMPORT_FILE_BYTES, parseDocument } from "./parse.ts";

const MAX_FOLDER_FILES = 5_000;
const ALWAYS_IGNORED_DIRECTORIES = new Set([".git", ".svn", "node_modules", ".sag-converted"]);

interface ScannedFile {
  absolutePath: string;
  relativePath: string;
  name: string;
  size: number;
  modifiedAt?: number;
}

export const folderSourcesAvailable = isTauri() && !IS_MOBILE_APP;

async function readIgnoreRules(rootPath: string): Promise<Ignore> {
  const rules = ignore();
  for (const name of [".gitignore", ".sagignore"]) {
    const path = await join(rootPath, name);
    if (!await exists(path)) continue;
    const bytes = await readFile(path);
    rules.add(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }
  return rules;
}

async function scanFolder(source: KnowledgeSource): Promise<ScannedFile[]> {
  if (source.kind !== "folder" || !source.rootPath) throw new Error("文件夹数据源缺少目录位置");
  const rules = await readIgnoreRules(source.rootPath);
  const files: ScannedFile[] = [];

  const walk = async (absolute: string, relative: string) => {
    for (const entry of await readDir(absolute)) {
      if (entry.isSymlink) continue;
      if (!source.includeHidden && entry.name.startsWith(".")) continue;
      if (entry.isDirectory && ALWAYS_IGNORED_DIRECTORIES.has(entry.name)) continue;
      const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
      if (rules.ignores(entry.isDirectory ? `${relativePath}/` : relativePath)) continue;
      const absolutePath = await join(absolute, entry.name);
      if (entry.isDirectory) {
        if (source.recursive !== false) await walk(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile || !folderAllowsDocumentName(entry.name, source.allowedExtensions)) continue;
      const metadata = await stat(absolutePath);
      files.push({
        absolutePath,
        relativePath,
        name: entry.name,
        size: metadata.size,
        modifiedAt: metadata.mtime?.getTime(),
      });
      if (files.length > MAX_FOLDER_FILES) throw new Error(`单个文件夹最多索引 ${MAX_FOLDER_FILES} 份资料`);
    }
  };

  await walk(source.rootPath, "");
  return files;
}

async function syncFolder(source: KnowledgeSource): Promise<void> {
  const initialJob = await startIndexJob(source.id, "import", 0);
  let job = initialJob;
  try {
    const files = await scanFolder(source);
    const existing = await listDocuments(source.id);
    const byPath = new Map(existing.filter((doc) => doc.sourcePath).map((doc) => [doc.sourcePath!, doc]));
    const scannedPaths = new Set(files.map((file) => file.relativePath));
    const removed = existing.filter((doc) => doc.sourcePath && !scannedPaths.has(doc.sourcePath));
    const total = files.length + removed.length;
    let completed = 0;
    let updated = 0;
    let failed = 0;
    job = await updateIndexJob(job.id, { stage: "reading", total });

    for (const file of files) {
      const previous = byPath.get(file.relativePath);
      const unchanged = previous?.sourceSize === file.size
        && previous.sourceModifiedAt === file.modifiedAt
        && previous.indexStatus === "ready";
      if (!unchanged) {
        try {
          if (file.size > MAX_IMPORT_FILE_BYTES) throw new Error(`${file.name}：文件不能超过 10 MB`);
          const bytes = await readFile(file.absolutePath);
          const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
          const parsed = await parseDocument(new File([data], file.name));
          if (await saveDocument({
            id: previous?.id ?? crypto.randomUUID(),
            sourceId: source.id,
            sourcePath: file.relativePath,
            name: file.name,
            ...parsed,
            importedAt: Date.now(),
            sourceModifiedAt: file.modifiedAt,
            sourceSize: file.size,
          })) updated++;
        } catch (error) {
          failed++;
          if (previous) await markDocumentIndexFailed(previous, error);
          job = await updateIndexJob(job.id, {
            stage: "indexing",
            completed: completed + 1,
            updated,
            failed,
            error: { name: file.relativePath, message: error instanceof Error ? error.message : "索引失败" },
          });
          completed++;
          continue;
        }
      }
      completed++;
      job = await updateIndexJob(job.id, { stage: "indexing", completed, updated, failed });
    }

    for (const document of removed) {
      const deleted = await removeScannedFolderDocument(document.id, source);
      completed++;
      if (deleted) updated++;
      job = await updateIndexJob(job.id, { stage: "indexing", completed, updated, failed });
    }
    await completeIndexJob(job.id);
    await markSourceSynced(source.id);
  } catch (error) {
    await updateIndexJob(job.id, {
      stage: "finished",
      completed: job.completed,
      updated: job.updated,
      failed: Math.max(1, job.failed),
      error: { name: source.name, message: error instanceof Error ? error.message : "读取文件夹失败" },
    }).then((failedJob) => completeIndexJob(failedJob.id));
    throw error;
  }
}

const syncing = new Map<string, Promise<void>>();
const changedDuringSync = new Set<string>();
const removing = new Set<string>();

export function syncFolderSource(source: KnowledgeSource): Promise<void> {
  if (removing.has(source.id)) return Promise.reject(new Error("数据源正在移除"));
  const current = syncing.get(source.id);
  if (current) {
    changedDuringSync.add(source.id);
    return current;
  }
  const task = (async () => {
    do {
      changedDuringSync.delete(source.id);
      try {
        const fresh = await getSource(source.id);
        if (!fresh) return;
        await syncFolder(fresh);
      } catch (error) {
        if (!changedDuringSync.has(source.id) || removing.has(source.id)) throw error;
      }
    } while (changedDuringSync.has(source.id) && !removing.has(source.id));
  })().finally(() => {
    syncing.delete(source.id);
    changedDuringSync.delete(source.id);
  });
  syncing.set(source.id, task);
  return task;
}

export async function chooseFolderSources(): Promise<KnowledgeSource[]> {
  if (!folderSourcesAvailable) throw new Error("文件夹数据源仅支持桌面应用");
  const selected = await open({ directory: true, multiple: true, recursive: true, title: "添加知识库文件夹" });
  if (!selected) return [];
  const paths = Array.isArray(selected) ? selected : [selected];
  const existing = await listSources();
  const created: KnowledgeSource[] = [];
  for (const rootPath of paths) {
    const duplicate = existing.find((source) => source.kind === "folder" && source.rootPath === rootPath);
    if (duplicate) {
      created.push(duplicate);
      continue;
    }
    const source = createFolderSource(crypto.randomUUID(), rootPath, await basename(rootPath));
    await putSource(source);
    created.push(source);
  }
  return created;
}

const watchers = new Map<string, UnwatchFn>();

export function stopFolderSource(id: string): void {
  watchers.get(id)?.();
  watchers.delete(id);
}

export async function removeFolderSource(id: string): Promise<void> {
  removing.add(id);
  stopFolderSource(id);
  try {
    await syncing.get(id)?.catch(() => undefined);
    await removeSource(id);
  } finally {
    removing.delete(id);
  }
}

async function ensureWatcher(source: KnowledgeSource): Promise<void> {
  if (!source.rootPath || watchers.has(source.id)) return;
  const unwatch = await watch(source.rootPath, () => {
    void getSource(source.id)
      .then((fresh) => fresh && syncFolderSource(fresh))
      .catch(() => console.warn("文件夹变更后的索引任务失败"));
  }, { recursive: source.recursive !== false, delayMs: 1_200 });
  watchers.set(source.id, unwatch);
}

export async function startFolderSources(): Promise<void> {
  if (!folderSourcesAvailable) return;
  const sources = (await listSources()).filter((source) => source.kind === "folder" && source.enabled);
  for (const source of sources) {
    await ensureWatcher(source).catch(() => console.warn("文件夹监听未启动"));
    void syncFolderSource(source).catch(() => console.warn("文件夹启动索引失败"));
  }
}

export async function addAndSyncFolderSources(): Promise<KnowledgeSource[]> {
  const sources = await chooseFolderSources();
  for (const source of sources) {
    await ensureWatcher(source).catch(() => console.warn("文件夹监听未启动"));
    await syncFolderSource(source);
  }
  return sources;
}
