import { buildIndex, rankIndexes, terms, type DocumentIndex, type IndexMatch } from "./index.ts";

export interface LocalDocumentMeta {
  id: string;
  name: string;
  importedAt: number;
  /** 派生索引版本与分片，仅用于更新和移除时定位旧分片。 */
  indexedVersion?: number;
  buckets?: number[];
}

export interface LocalDocument extends LocalDocumentMeta {
  content: string;
}

const DB = "lanshan-library";
const STORE = "documents";
const LEGACY_INDEX = "indexes";
const SHARDS = "shards";
const META = "meta";
let opening: Promise<IDBDatabase> | null = null;
let rebuilding: Promise<void> | null = null;
let rebuildFailed = false;
let rebuildComplete = false;

function db(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 4);
    request.onupgradeneeded = (event) => {
      const documents = request.result.objectStoreNames.contains(STORE)
        ? request.transaction!.objectStore(STORE)
        : request.result.createObjectStore(STORE, { keyPath: "id" });
      const meta = request.result.objectStoreNames.contains(META)
        ? request.transaction!.objectStore(META)
        : request.result.createObjectStore(META, { keyPath: "id" });
      const shards = request.result.objectStoreNames.contains(SHARDS)
        ? request.transaction!.objectStore(SHARDS)
        : request.result.createObjectStore(SHARDS, { keyPath: ["bucket", "id"] });
      shards.createIndex("byTerm", "terms", { multiEntry: true });
      // v1 只有原文；先迁移小型列表数据，索引在升级后逐份构建，避免配额失败锁死旧资料。
      if (event.oldVersion === 1) {
        const cursor = documents.openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) return;
          const doc = row.value as LocalDocument;
          meta.put({ id: doc.id, name: doc.name, importedAt: doc.importedAt });
          row.continue();
        };
      }
    };
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

export async function listDocuments(): Promise<LocalDocumentMeta[]> {
  const tx = (await db()).transaction(META, "readonly");
  const request = tx.objectStore(META).getAll() as IDBRequest<LocalDocumentMeta[]>;
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.importedAt - a.importedAt));
    request.onerror = () => reject(request.error);
  });
}

async function getDocument(id: string): Promise<LocalDocument | undefined> {
  const tx = (await db()).transaction(STORE, "readonly");
  const request = tx.objectStore(STORE).get(id) as IDBRequest<LocalDocument | undefined>;
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** 旧库分批补建；每份资料单独提交，失败时已完成的部分可复用，原文仍可在设置中移除。 */
export function rebuildMissingIndexes(): Promise<void> {
  if (rebuildComplete) return Promise.resolve();
  rebuilding ??= (async () => {
    for (const meta of await listDocuments()) {
      if (meta.indexedVersion === 4) continue;
      const doc = await getDocument(meta.id);
      if (doc) await writeDocument(doc, true);
    }
  })().then(() => { rebuildFailed = false; rebuildComplete = true; }, (error) => { rebuildFailed = true; throw error; })
    .finally(() => { rebuilding = null; });
  return rebuilding;
}

/** 索引与原文在同一只读事务中取快照，避免更新时引用指向另一版内容。 */
export async function lookupDocuments(question: string): Promise<{ matches: IndexMatch[]; docs: LocalDocument[]; incomplete: boolean }> {
  const query = terms(question);
  if (!query.length) return { matches: [], docs: [], incomplete: false };
  let incomplete = rebuildFailed;
  if (!rebuildFailed) {
    try { await rebuildMissingIndexes(); }
    catch { incomplete = true; }
  }
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction([SHARDS, STORE], "readonly");
    let output = { matches: [] as IndexMatch[], docs: [] as LocalDocument[], incomplete };
    tx.oncomplete = () => resolve(output);
    tx.onerror = tx.onabort = () => reject(tx.error);
    const keys = new Map<string, [number, string]>();
    let pendingTerms = query.length;
    const shardStore = tx.objectStore(SHARDS);
    const collectShards = () => {
      let pendingShards = keys.size;
      if (!pendingShards) return;
      const indexes: DocumentIndex[] = [];
      for (const key of keys.values()) {
        const read = shardStore.get(key) as IDBRequest<DocumentIndex | undefined>;
        read.onsuccess = () => {
          if (read.result) indexes.push(read.result);
          if (--pendingShards !== 0) return;
          try {
            output.matches = rankIndexes(indexes, question);
            for (const id of new Set(output.matches.map((hit) => hit.id))) {
              const doc = tx.objectStore(STORE).get(id) as IDBRequest<LocalDocument | undefined>;
              doc.onsuccess = () => { if (doc.result) output.docs.push(doc.result); };
            }
          } catch (error) {
            tx.abort();
            reject(error);
          }
        };
      }
    };
    for (const term of query) {
      const request = shardStore.index("byTerm").getAllKeys(term);
      request.onsuccess = () => {
        for (const key of request.result) {
          if (!Array.isArray(key) || typeof key[0] !== "number" || typeof key[1] !== "string") {
            tx.abort();
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

async function writeDocument(doc: LocalDocument, onlyIfCurrent: boolean): Promise<void> {
  const indexes = buildIndex(doc);
  const database = await db();
  const stores = [STORE, SHARDS, META, ...(database.objectStoreNames.contains(LEGACY_INDEX) ? [LEGACY_INDEX] : [])];
  const tx = database.transaction(stores, "readwrite");
  const finished = transactionDone(tx);
  const current = tx.objectStore(STORE).get(doc.id) as IDBRequest<LocalDocument | undefined>;
  current.onsuccess = () => {
    if (onlyIfCurrent && (!current.result || current.result.content !== doc.content || current.result.importedAt !== doc.importedAt)) return;
    const previous = tx.objectStore(META).get(doc.id) as IDBRequest<LocalDocumentMeta | undefined>;
    previous.onsuccess = () => {
      if (onlyIfCurrent && previous.result?.indexedVersion === 4) return;
      for (const bucket of previous.result?.buckets ?? []) tx.objectStore(SHARDS).delete([bucket, doc.id]);
      if (stores.includes(LEGACY_INDEX)) tx.objectStore(LEGACY_INDEX).delete(doc.id);
      tx.objectStore(STORE).put(doc);
      for (const index of indexes) tx.objectStore(SHARDS).put(index);
      tx.objectStore(META).put({ id: doc.id, name: doc.name, importedAt: doc.importedAt, indexedVersion: 4, buckets: indexes.map((index) => index.bucket) });
    };
  };
  await finished;
}

export const saveDocument = (doc: LocalDocument): Promise<void> => writeDocument(doc, false);

export async function removeDocument(id: string): Promise<void> {
  const database = await db();
  const stores = [STORE, SHARDS, META, ...(database.objectStoreNames.contains(LEGACY_INDEX) ? [LEGACY_INDEX] : [])];
  const tx = database.transaction(stores, "readwrite");
  const finished = transactionDone(tx);
  const previous = tx.objectStore(META).get(id) as IDBRequest<LocalDocumentMeta | undefined>;
  previous.onsuccess = () => {
    for (const bucket of previous.result?.buckets ?? []) tx.objectStore(SHARDS).delete([bucket, id]);
    if (stores.includes(LEGACY_INDEX)) tx.objectStore(LEGACY_INDEX).delete(id);
    tx.objectStore(STORE).delete(id);
    tx.objectStore(META).delete(id);
  };
  await finished;
}
