import { buildIndex, queryTerms, rankIndexes, type DocumentIndex, type IndexMatch } from "./index.ts";
import {
  LIBRARY_DB_VERSION,
  LIBRARY_INDEX_VERSION,
  MANUAL_SOURCE_ID,
  createManualSource,
  extensionForName,
  finishIndexJob,
  sourceStatus,
  type DocumentIndexStatus,
  type IndexJob,
  type IndexJobKind,
  type IndexJobProgress,
  type KnowledgeSource,
  type KnowledgeSourceSummary,
} from "./model.ts";

export type { IndexJob, KnowledgeSource, KnowledgeSourceSummary } from "./model.ts";

export interface LocalDocumentMeta {
  id: string;
  /** v5 起持久化；读取旧数据时会归入手动导入源。 */
  sourceId?: string;
  name: string;
  format?: string;
  importedAt: number;
  sourceModifiedAt?: number;
  sourceSize?: number;
  /** 在线仓库中的 blob SHA；相同版本复用现有索引。 */
  sourceRevision?: string;
  /** 文件夹源内的相对路径；手动导入不记录磁盘位置。 */
  sourcePath?: string;
  /** 用户主动剪藏的网页最终地址；正文是当时读取的本地快照。 */
  sourceUrl?: string;
  /** 订阅源只提供摘要时，所有命中片段都必须保持这一来源属性。 */
  isSummary?: boolean;
  indexStatus?: DocumentIndexStatus;
  indexError?: string;
  /** 派生索引版本与分片，仅用于更新和移除时定位旧分片。 */
  indexedVersion?: number;
  buckets?: number[];
}

export interface LocalDocument extends LocalDocumentMeta {
  content: string;
  pages?: { number: number; start: number; end: number; label?: string }[];
}

export type LocalDocumentInput = LocalDocument;

const DB = "lanshan-library";
const DOCUMENTS = "documents";
const LEGACY_INDEX = "indexes";
const SHARDS = "shards";
const META = "meta";
const SOURCES = "sources";
const TASKS = "tasks";
let opening: Promise<IDBDatabase> | null = null;
let rebuilding: Promise<void> | null = null;
let rebuildFailed = false;
let rebuildComplete = false;

function normalizeDocument<T extends LocalDocumentMeta>(doc: T): T {
  return {
    ...doc,
    sourceId: doc.sourceId || MANUAL_SOURCE_ID,
    format: doc.format || extensionForName(doc.name),
    indexStatus: doc.indexStatus || (doc.indexedVersion === LIBRARY_INDEX_VERSION ? "ready" : "pending"),
  };
}

function ensureIndex(store: IDBObjectStore, name: string, keyPath: string | string[], options?: IDBIndexParameters) {
  if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, options);
}

function upgrade(request: IDBOpenDBRequest, oldVersion: number) {
  const database = request.result;
  const transaction = request.transaction!;
  const documents = database.objectStoreNames.contains(DOCUMENTS)
    ? transaction.objectStore(DOCUMENTS)
    : database.createObjectStore(DOCUMENTS, { keyPath: "id" });
  const meta = database.objectStoreNames.contains(META)
    ? transaction.objectStore(META)
    : database.createObjectStore(META, { keyPath: "id" });
  const shards = database.objectStoreNames.contains(SHARDS)
    ? transaction.objectStore(SHARDS)
    : database.createObjectStore(SHARDS, { keyPath: ["bucket", "id"] });
  ensureIndex(shards, "byTerm", "terms", { multiEntry: true });
  ensureIndex(meta, "bySource", "sourceId");

  const sources = database.objectStoreNames.contains(SOURCES)
    ? transaction.objectStore(SOURCES)
    : database.createObjectStore(SOURCES, { keyPath: "id" });
  ensureIndex(sources, "byUpdatedAt", "updatedAt");
  const tasks = database.objectStoreNames.contains(TASKS)
    ? transaction.objectStore(TASKS)
    : database.createObjectStore(TASKS, { keyPath: "id" });
  ensureIndex(tasks, "bySource", "sourceId");
  ensureIndex(tasks, "byStartedAt", "startedAt");

  // v1 只有原文；先迁移小型列表数据，索引在升级后逐份构建，避免配额失败锁死旧资料。
  if (oldVersion === 1) {
    const cursor = documents.openCursor();
    cursor.onsuccess = () => {
      const row = cursor.result;
      if (!row) return;
      const doc = normalizeDocument(row.value as LocalDocument);
      meta.put({
        id: doc.id,
        sourceId: doc.sourceId,
        name: doc.name,
        format: doc.format,
        importedAt: doc.importedAt,
        indexStatus: "pending",
      } satisfies LocalDocumentMeta);
      row.continue();
    };
  }

  if (oldVersion < 5) {
    const now = Date.now();
    sources.put(createManualSource(now));
    const migrate = (store: IDBObjectStore) => {
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        row.update(normalizeDocument(row.value as LocalDocumentMeta));
        row.continue();
      };
    };
    migrate(documents);
    if (oldVersion !== 1) migrate(meta);
  }
}

function db(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, LIBRARY_DB_VERSION);
    request.onupgradeneeded = (event) => upgrade(request, event.oldVersion);
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); opening = null; };
      resolve(request.result);
    };
    request.onerror = () => { opening = null; reject(request.error); };
    request.onblocked = () => window.dispatchEvent(new Event("lanshan:library-blocked"));
  });
  return opening;
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function notifyChanged() {
  window.dispatchEvent(new Event("lanshan:library-changed"));
}

export async function listSources(): Promise<KnowledgeSourceSummary[]> {
  const transaction = (await db()).transaction([SOURCES, META, TASKS], "readonly");
  const sourceRequest = transaction.objectStore(SOURCES).getAll() as IDBRequest<KnowledgeSource[]>;
  const metaRequest = transaction.objectStore(META).getAll() as IDBRequest<LocalDocumentMeta[]>;
  const taskRequest = transaction.objectStore(TASKS).getAll() as IDBRequest<IndexJob[]>;
  const [sources, documents, tasks] = await Promise.all([
    requestResult(sourceRequest),
    requestResult(metaRequest),
    requestResult(taskRequest),
  ]);
  return sources.map((source) => {
    const sourceDocuments = documents.map(normalizeDocument).filter((doc) => doc.sourceId === source.id);
    const latestJob = tasks
      .filter((job) => job.sourceId === source.id)
      .sort((a, b) => b.startedAt - a.startedAt)[0];
    const failedCount = sourceDocuments.filter((doc) => doc.indexStatus === "failed").length;
    return {
      ...source,
      documentCount: sourceDocuments.length,
      indexedCount: sourceDocuments.filter((doc) => doc.indexStatus === "ready").length,
      failedCount,
      status: sourceStatus(latestJob, failedCount),
      latestJob,
    };
  }).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getSource(id: string): Promise<KnowledgeSource | undefined> {
  const transaction = (await db()).transaction(SOURCES, "readonly");
  return requestResult(transaction.objectStore(SOURCES).get(id) as IDBRequest<KnowledgeSource | undefined>);
}

export async function putSource(source: KnowledgeSource): Promise<void> {
  const transaction = (await db()).transaction(SOURCES, "readwrite");
  transaction.objectStore(SOURCES).put(source);
  await transactionDone(transaction);
  notifyChanged();
}

export async function updateFolderFormats(id: string, allowedExtensions: string[]): Promise<void> {
  const database = await db();
  const stores = [SOURCES, META, DOCUMENTS, SHARDS, ...(database.objectStoreNames.contains(LEGACY_INDEX) ? [LEGACY_INDEX] : [])];
  const transaction = database.transaction(stores, "readwrite");
  const finished = transactionDone(transaction);
  const source = transaction.objectStore(SOURCES).get(id) as IDBRequest<KnowledgeSource | undefined>;
  source.onsuccess = () => {
    if (!source.result || source.result.kind !== "folder") {
      transaction.abort();
      return;
    }
    transaction.objectStore(SOURCES).put({ ...source.result, allowedExtensions, updatedAt: Date.now() });
    const cursor = transaction.objectStore(META).index("bySource").openCursor(IDBKeyRange.only(id));
    cursor.onsuccess = () => {
      const row = cursor.result;
      if (!row) return;
      const document = row.value as LocalDocumentMeta;
      if (!allowedExtensions.includes(extensionForName(document.sourcePath ?? document.name))) {
        for (const bucket of document.buckets ?? []) transaction.objectStore(SHARDS).delete([bucket, document.id]);
        if (stores.includes(LEGACY_INDEX)) transaction.objectStore(LEGACY_INDEX).delete(document.id);
        transaction.objectStore(DOCUMENTS).delete(document.id);
        row.delete();
      }
      row.continue();
    };
  };
  await finished;
  notifyChanged();
}

export async function markSourceSynced(id: string): Promise<void> {
  const transaction = (await db()).transaction(SOURCES, "readwrite");
  const request = transaction.objectStore(SOURCES).get(id) as IDBRequest<KnowledgeSource | undefined>;
  request.onsuccess = () => {
    if (request.result) transaction.objectStore(SOURCES).put({ ...request.result, updatedAt: Date.now(), lastSyncedAt: Date.now() });
  };
  await transactionDone(transaction);
  notifyChanged();
}

export async function beginSourceSync(source: KnowledgeSource): Promise<string> {
  const token = crypto.randomUUID();
  const transaction = (await db()).transaction(SOURCES, "readwrite");
  const request = transaction.objectStore(SOURCES).get(source.id) as IDBRequest<KnowledgeSource | undefined>;
  let accepted = false;
  request.onsuccess = () => {
    if (request.result?.kind === "github" && request.result.createdAt === source.createdAt) {
      transaction.objectStore(SOURCES).put({ ...request.result, syncToken: token, updatedAt: Date.now() });
      accepted = true;
    }
  };
  await transactionDone(transaction);
  if (!accepted) throw new Error("仓库数据源已移除或重新添加");
  notifyChanged();
  return token;
}

export async function sourceSyncCurrent(source: KnowledgeSource, token: string): Promise<boolean> {
  const current = await getSource(source.id);
  return current?.createdAt === source.createdAt && current.syncToken === token;
}

export async function finishSourceSync(source: KnowledgeSource, token: string): Promise<void> {
  const transaction = (await db()).transaction(SOURCES, "readwrite");
  const request = transaction.objectStore(SOURCES).get(source.id) as IDBRequest<KnowledgeSource | undefined>;
  let finished = false;
  request.onsuccess = () => {
    if (request.result?.createdAt === source.createdAt && request.result.syncToken === token) {
      transaction.objectStore(SOURCES).put({ ...request.result, lastSyncedAt: Date.now(), updatedAt: Date.now() });
      finished = true;
    }
  };
  await transactionDone(transaction);
  if (!finished) throw new Error("仓库同步已被新任务替代");
  notifyChanged();
}

export async function updateRssSourceUrl(id: string, feedUrl: string): Promise<void> {
  const transaction = (await db()).transaction(SOURCES, "readwrite");
  const request = transaction.objectStore(SOURCES).get(id) as IDBRequest<KnowledgeSource | undefined>;
  let changed = false;
  request.onsuccess = () => {
    if (request.result?.kind === "rss") {
      transaction.objectStore(SOURCES).put({ ...request.result, feedUrl, updatedAt: Date.now() });
      changed = true;
    }
  };
  await transactionDone(transaction);
  if (changed) notifyChanged();
}

export async function removeSource(id: string): Promise<void> {
  if (id === MANUAL_SOURCE_ID) throw new Error("手动导入数据源不能移除");
  const database = await db();
  const stores = [SOURCES, TASKS, META, DOCUMENTS, SHARDS, ...(database.objectStoreNames.contains(LEGACY_INDEX) ? [LEGACY_INDEX] : [])];
  const transaction = database.transaction(stores, "readwrite");
  const finished = transactionDone(transaction);
  const metaCursor = transaction.objectStore(META).index("bySource").openCursor(IDBKeyRange.only(id));
  metaCursor.onsuccess = () => {
    const row = metaCursor.result;
    if (!row) return;
    const document = row.value as LocalDocumentMeta;
    for (const bucket of document.buckets ?? []) transaction.objectStore(SHARDS).delete([bucket, document.id]);
    if (stores.includes(LEGACY_INDEX)) transaction.objectStore(LEGACY_INDEX).delete(document.id);
    transaction.objectStore(DOCUMENTS).delete(document.id);
    row.delete();
    row.continue();
  };
  const taskCursor = transaction.objectStore(TASKS).index("bySource").openCursor(IDBKeyRange.only(id));
  taskCursor.onsuccess = () => {
    const row = taskCursor.result;
    if (!row) return;
    row.delete();
    row.continue();
  };
  transaction.objectStore(SOURCES).delete(id);
  await finished;
  notifyChanged();
}

export async function listDocuments(sourceId?: string): Promise<LocalDocumentMeta[]> {
  const transaction = (await db()).transaction(META, "readonly");
  const store = transaction.objectStore(META);
  const request = sourceId
    ? store.index("bySource").getAll(sourceId) as IDBRequest<LocalDocumentMeta[]>
    : store.getAll() as IDBRequest<LocalDocumentMeta[]>;
  return (await requestResult(request)).map(normalizeDocument).sort((a, b) => b.importedAt - a.importedAt);
}

async function getDocument(id: string): Promise<LocalDocument | undefined> {
  const transaction = (await db()).transaction(DOCUMENTS, "readonly");
  const request = transaction.objectStore(DOCUMENTS).get(id) as IDBRequest<LocalDocument | undefined>;
  const document = await requestResult(request);
  return document ? normalizeDocument(document) : undefined;
}

export async function startIndexJob(sourceId: string, kind: IndexJobKind, total: number, expectedSource?: KnowledgeSource, syncToken?: string): Promise<IndexJob> {
  const job: IndexJob = {
    id: crypto.randomUUID(),
    sourceId,
    kind,
    status: "running",
    stage: "reading",
    total,
    completed: 0,
    updated: 0,
    failed: 0,
    errors: [],
    startedAt: Date.now(),
  };
  const transaction = (await db()).transaction([TASKS, SOURCES], "readwrite");
  const previousJobs = transaction.objectStore(TASKS).index("bySource").getAll(sourceId) as IDBRequest<IndexJob[]>;
  const sourceRequest = transaction.objectStore(SOURCES).get(sourceId) as IDBRequest<KnowledgeSource | undefined>;
  let accepted = false;
  const begin = () => {
    if (previousJobs.readyState !== "done" || sourceRequest.readyState !== "done") return;
    const source = sourceRequest.result;
    if (!source || (expectedSource && (source.createdAt !== expectedSource.createdAt || source.syncToken !== syncToken))) return;
    job.startedAt = previousJobs.result.reduce((latest, previous) => Math.max(latest, previous.startedAt + 1), Date.now());
    transaction.objectStore(TASKS).put(job);
    transaction.objectStore(SOURCES).put({ ...source, updatedAt: job.startedAt });
    accepted = true;
  };
  previousJobs.onsuccess = begin;
  sourceRequest.onsuccess = begin;
  await transactionDone(transaction);
  if (!accepted) throw new Error(expectedSource ? "仓库同步已被新任务替代" : "数据源不存在");
  notifyChanged();
  return job;
}

async function mutateIndexJob(id: string, mutate: (job: IndexJob) => IndexJob, emit = false, expectedSource?: KnowledgeSource, syncToken?: string): Promise<IndexJob> {
  const transaction = (await db()).transaction(expectedSource ? [TASKS, SOURCES] : [TASKS], "readwrite");
  const finished = transactionDone(transaction);
  let next: IndexJob | undefined;
  const update = () => {
    const request = transaction.objectStore(TASKS).get(id) as IDBRequest<IndexJob | undefined>;
    request.onsuccess = () => {
      if (!request.result || (expectedSource && request.result.sourceId !== expectedSource.id)) return;
      next = mutate(request.result);
      transaction.objectStore(TASKS).put(next);
    };
  };
  if (expectedSource) {
    const source = transaction.objectStore(SOURCES).get(expectedSource.id) as IDBRequest<KnowledgeSource | undefined>;
    source.onsuccess = () => {
      if (source.result?.createdAt === expectedSource.createdAt && source.result.syncToken === syncToken) update();
    };
  } else update();
  await finished;
  if (!next) throw new Error(expectedSource ? "仓库同步已被新任务替代" : "索引任务不存在");
  if (emit) notifyChanged();
  return next;
}

export function updateIndexJob(id: string, progress: IndexJobProgress, source?: KnowledgeSource, syncToken?: string): Promise<IndexJob> {
  return mutateIndexJob(id, (job) => ({
    ...job,
    ...progress,
    errors: progress.error ? [...job.errors, progress.error].slice(-50) : job.errors,
  }), false, source, syncToken);
}

export function completeIndexJob(id: string, source?: KnowledgeSource, syncToken?: string): Promise<IndexJob> {
  return mutateIndexJob(id, (job) => finishIndexJob(job), true, source, syncToken);
}

export async function markDocumentIndexFailed(meta: LocalDocumentMeta, error: unknown, expectedSource?: KnowledgeSource, token?: string): Promise<void> {
  const message = error instanceof Error ? error.message : "索引失败";
  const transaction = (await db()).transaction([META, DOCUMENTS, ...(expectedSource ? [SOURCES] : [])], "readwrite");
  const mark = () => {
    const current = transaction.objectStore(META).get(meta.id) as IDBRequest<LocalDocumentMeta | undefined>;
    current.onsuccess = () => {
      if (!current.result || current.result.importedAt !== meta.importedAt || current.result.sourceRevision !== meta.sourceRevision) return;
      transaction.objectStore(META).put({ ...current.result, indexStatus: "failed", indexError: message });
      const document = transaction.objectStore(DOCUMENTS).get(meta.id) as IDBRequest<LocalDocument | undefined>;
      document.onsuccess = () => {
        if (document.result) transaction.objectStore(DOCUMENTS).put({ ...document.result, indexStatus: "failed", indexError: message });
      };
    };
  };
  if (expectedSource) {
    const request = transaction.objectStore(SOURCES).get(expectedSource.id) as IDBRequest<KnowledgeSource | undefined>;
    request.onsuccess = () => {
      if (request.result?.createdAt === expectedSource.createdAt && request.result.syncToken === token) mark();
    };
  } else mark();
  await transactionDone(transaction);
  notifyChanged();
}

/** 旧库分批补建；每份资料单独提交，失败时已完成的部分可复用，原文仍可在设置中移除。 */
export function rebuildMissingIndexes(): Promise<void> {
  if (rebuildComplete) return Promise.resolve();
  rebuilding ??= (async () => {
    const pending = (await listDocuments()).filter((meta) =>
      (meta.indexedVersion !== LIBRARY_INDEX_VERSION || meta.indexStatus !== "ready")
      && (meta.indexStatus !== "failed" || meta.sourceId === MANUAL_SOURCE_ID));
    if (!pending.length) {
      rebuildFailed = false;
      rebuildComplete = true;
      return;
    }
    const job = await startIndexJob(MANUAL_SOURCE_ID, "rebuild", pending.length);
    let updated = 0;
    let failed = 0;
    for (let index = 0; index < pending.length; index++) {
      const meta = pending[index];
      try {
        const doc = await getDocument(meta.id);
        if (doc && await writeDocument(doc, true)) updated++;
      } catch (error) {
        failed++;
        await markDocumentIndexFailed(meta, error);
        await updateIndexJob(job.id, {
          stage: "indexing",
          completed: index + 1,
          updated,
          failed,
          error: { name: meta.name, message: error instanceof Error ? error.message : "索引失败" },
        });
        continue;
      }
      await updateIndexJob(job.id, { stage: "indexing", completed: index + 1, updated, failed });
    }
    await completeIndexJob(job.id);
    if (failed) throw new Error(`${failed} 份资料索引失败`);
    rebuildFailed = false;
    rebuildComplete = true;
  })().catch((error) => { rebuildFailed = true; throw error; })
    .finally(() => { rebuilding = null; notifyChanged(); });
  return rebuilding;
}

/** 索引与原文在同一只读事务中取快照，避免更新时引用指向另一版内容。 */
export async function lookupDocuments(question: string, maxHits = 5): Promise<{ matches: IndexMatch[]; docs: LocalDocument[]; incomplete: boolean }> {
  const query = queryTerms(question);
  if (!query.length) return { matches: [], docs: [], incomplete: false };
  let incomplete = rebuildFailed;
  if (!rebuildFailed) {
    try { await rebuildMissingIndexes(); }
    catch { incomplete = true; }
  }
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([SHARDS, DOCUMENTS, META, TASKS], "readonly");
    let output = { matches: [] as IndexMatch[], docs: [] as LocalDocument[], incomplete };
    transaction.oncomplete = () => resolve(output);
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
    const keys = new Map<string, [number, string]>();
    let pendingTerms = query.length;
    const shardStore = transaction.objectStore(SHARDS);
    const collectShards = () => {
      let pendingShards = keys.size;
      const indexes: DocumentIndex[] = [];
      const processIndexes = () => {
        const metadata = transaction.objectStore(META).getAll() as IDBRequest<LocalDocumentMeta[]>;
        const tasks = transaction.objectStore(TASKS).getAll() as IDBRequest<IndexJob[]>;
        const rankReady = () => {
          if (metadata.readyState !== "done" || tasks.readyState !== "done") return;
          try {
            const latestTasks = new Map<string, IndexJob>();
            for (const task of tasks.result) {
              const previous = latestTasks.get(task.sourceId);
              if (!previous || previous.startedAt < task.startedAt) latestTasks.set(task.sourceId, task);
            }
            output.incomplete ||= metadata.result.some((meta) => normalizeDocument(meta).indexStatus === "failed")
              || [...latestTasks.values()].some((task) => task.status === "failed" || task.status === "partial");
            const readyIds = new Set(metadata.result.filter((meta) => normalizeDocument(meta).indexStatus === "ready").map((meta) => meta.id));
            const ranked = rankIndexes(indexes.filter((index) => readyIds.has(index.id)), question, maxHits);
            let position = 0;
            const seenDocs = new Set<string>();
            const next = () => {
              if (output.matches.length >= maxHits || position >= ranked.length) return;
              const hit = ranked[position++];
              const doc = transaction.objectStore(DOCUMENTS).get(hit.id) as IDBRequest<LocalDocument | undefined>;
              doc.onsuccess = () => {
                if (doc.result) {
                  const normalized = normalizeDocument(doc.result);
                  if (normalized.indexStatus === "ready") {
                    output.matches.push(hit);
                    if (!seenDocs.has(hit.id)) {
                      seenDocs.add(hit.id);
                      output.docs.push(normalized);
                    }
                  }
                }
                next();
              };
            };
            next();
          } catch (error) {
            transaction.abort();
            reject(error);
          }
        };
        metadata.onsuccess = rankReady;
        tasks.onsuccess = rankReady;
      };
      if (!pendingShards) {
        processIndexes();
        return;
      }
      for (const key of keys.values()) {
        const read = shardStore.get(key) as IDBRequest<DocumentIndex | undefined>;
        read.onsuccess = () => {
          if (read.result) indexes.push(read.result);
          if (--pendingShards === 0) processIndexes();
        };
      }
    };
    for (const term of query) {
      const request = shardStore.index("byTerm").getAllKeys(term);
      request.onsuccess = () => {
        for (const key of request.result) {
          if (!Array.isArray(key) || typeof key[0] !== "number" || typeof key[1] !== "string") {
            transaction.abort();
            reject(new Error("本地索引键格式错误"));
            return;
          }
          keys.set(`${key[0]}:${key[1]}`, [key[0], key[1]]);
        }
        if (--pendingTerms === 0) collectShards();
      };
    }
  });
}

async function writeDocument(input: LocalDocumentInput, onlyIfCurrent: boolean, sourceIfMissing?: KnowledgeSource, expectedSource?: KnowledgeSource, syncToken?: string): Promise<boolean> {
  const doc = normalizeDocument({
    ...input,
    sourceId: input.sourceId || MANUAL_SOURCE_ID,
    format: input.format || extensionForName(input.name),
    indexStatus: input.indexStatus || "pending",
  } as LocalDocument);
  if (!await getSource(doc.sourceId || MANUAL_SOURCE_ID) && sourceIfMissing?.id !== doc.sourceId) throw new Error("资料所属的数据源不存在");
  const indexes = buildIndex(doc);
  const database = await db();
  const stores = [DOCUMENTS, SHARDS, META, SOURCES, ...(database.objectStoreNames.contains(LEGACY_INDEX) ? [LEGACY_INDEX] : [])];
  const transaction = database.transaction(stores, "readwrite");
  const finished = transactionDone(transaction);
  let wrote = false;
  const current = transaction.objectStore(DOCUMENTS).get(doc.id) as IDBRequest<LocalDocument | undefined>;
  current.onsuccess = () => {
    if (onlyIfCurrent && (!current.result || current.result.content !== doc.content || current.result.importedAt !== doc.importedAt)) return;
    const source = transaction.objectStore(SOURCES).get(doc.sourceId || MANUAL_SOURCE_ID) as IDBRequest<KnowledgeSource | undefined>;
    source.onsuccess = () => {
      const currentSource = source.result ?? sourceIfMissing;
      if (!currentSource || (currentSource.kind === "folder" && currentSource.allowedExtensions
        && !currentSource.allowedExtensions.includes(extensionForName(doc.sourcePath ?? doc.name)))) return;
      if (expectedSource && (currentSource.createdAt !== expectedSource.createdAt || currentSource.syncToken !== syncToken)) return;
      const previous = transaction.objectStore(META).get(doc.id) as IDBRequest<LocalDocumentMeta | undefined>;
      previous.onsuccess = () => {
        if (onlyIfCurrent && previous.result?.indexedVersion === LIBRARY_INDEX_VERSION && previous.result.indexStatus === "ready") return;
        for (const bucket of previous.result?.buckets ?? []) transaction.objectStore(SHARDS).delete([bucket, doc.id]);
        if (stores.includes(LEGACY_INDEX)) transaction.objectStore(LEGACY_INDEX).delete(doc.id);
        const ready: LocalDocument = { ...doc, indexStatus: "ready", indexError: undefined, indexedVersion: LIBRARY_INDEX_VERSION, buckets: indexes.map((index) => index.bucket) };
        transaction.objectStore(DOCUMENTS).put(ready);
        for (const index of indexes) transaction.objectStore(SHARDS).put(index);
        const { content: _content, pages: _pages, ...metadata } = ready;
        transaction.objectStore(META).put(metadata);
        transaction.objectStore(SOURCES).put({ ...currentSource, updatedAt: Date.now() });
        wrote = true;
      };
    };
  };
  await finished;
  if (wrote) notifyChanged();
  return wrote;
}

export async function saveDocument(doc: LocalDocumentInput, sourceIfMissing?: KnowledgeSource): Promise<boolean> {
  return writeDocument(doc, false, sourceIfMissing);
}

export async function saveSourceDocument(doc: LocalDocumentInput, source: KnowledgeSource, token: string): Promise<boolean> {
  return writeDocument(doc, false, undefined, source, token);
}

export async function updateSourceDocumentUrl(id: string, source: KnowledgeSource, token: string, revision: string, url: string): Promise<boolean> {
  const transaction = (await db()).transaction([SOURCES, META, DOCUMENTS], "readwrite");
  let updated = false;
  const request = transaction.objectStore(SOURCES).get(source.id) as IDBRequest<KnowledgeSource | undefined>;
  request.onsuccess = () => {
    if (request.result?.createdAt !== source.createdAt || request.result.syncToken !== token) return;
    const meta = transaction.objectStore(META).get(id) as IDBRequest<LocalDocumentMeta | undefined>;
    meta.onsuccess = () => {
      if (meta.result?.sourceRevision !== revision || meta.result.sourceId !== source.id) return;
      const doc = transaction.objectStore(DOCUMENTS).get(id) as IDBRequest<LocalDocument | undefined>;
      doc.onsuccess = () => {
        if (!doc.result || doc.result.sourceRevision !== revision) return;
        transaction.objectStore(META).put({ ...meta.result, sourceUrl: url });
        transaction.objectStore(DOCUMENTS).put({ ...doc.result, sourceUrl: url });
        updated = true;
      };
    };
  };
  await transactionDone(transaction);
  if (updated) notifyChanged();
  return updated;
}

async function deleteDocument(id: string, expectedSource?: KnowledgeSource, syncToken?: string): Promise<boolean> {
  const database = await db();
  const stores = [DOCUMENTS, SHARDS, META, SOURCES, ...(database.objectStoreNames.contains(LEGACY_INDEX) ? [LEGACY_INDEX] : [])];
  const transaction = database.transaction(stores, "readwrite");
  const finished = transactionDone(transaction);
  let deleted = false;
  const remove = () => {
    const previous = transaction.objectStore(META).get(id) as IDBRequest<LocalDocumentMeta | undefined>;
    previous.onsuccess = () => {
      if (!previous.result || (expectedSource && previous.result.sourceId !== expectedSource.id)) return;
      for (const bucket of previous.result.buckets ?? []) transaction.objectStore(SHARDS).delete([bucket, id]);
      if (stores.includes(LEGACY_INDEX)) transaction.objectStore(LEGACY_INDEX).delete(id);
      transaction.objectStore(DOCUMENTS).delete(id);
      transaction.objectStore(META).delete(id);
      const source = transaction.objectStore(SOURCES).get(previous.result.sourceId || MANUAL_SOURCE_ID) as IDBRequest<KnowledgeSource | undefined>;
      source.onsuccess = () => {
        if (source.result) transaction.objectStore(SOURCES).put({ ...source.result, updatedAt: Date.now() });
      };
      deleted = true;
    };
  };
  if (expectedSource) {
    const source = transaction.objectStore(SOURCES).get(expectedSource.id) as IDBRequest<KnowledgeSource | undefined>;
    source.onsuccess = () => {
      const currentSource = source.result;
      if (!currentSource) return;
      if (currentSource.createdAt === expectedSource.createdAt
        && (syncToken === undefined || currentSource.syncToken === syncToken)
        && currentSource.rootPath === expectedSource.rootPath
        && currentSource.recursive === expectedSource.recursive
        && currentSource.includeHidden === expectedSource.includeHidden
        && JSON.stringify(currentSource.allowedExtensions) === JSON.stringify(expectedSource.allowedExtensions)
        && currentSource.repoOwner === expectedSource.repoOwner
        && currentSource.repoName === expectedSource.repoName
        && currentSource.branch === expectedSource.branch
        && currentSource.folderPath === expectedSource.folderPath) remove();
    };
  } else remove();
  await finished;
  if (deleted) notifyChanged();
  return deleted;
}

export async function removeDocument(id: string): Promise<void> {
  await deleteDocument(id);
}

export async function removeSourceDocument(id: string, source: KnowledgeSource, token?: string): Promise<boolean> {
  return deleteDocument(id, source, token);
}

export function removeScannedFolderDocument(id: string, source: KnowledgeSource): Promise<boolean> {
  return deleteDocument(id, source);
}
