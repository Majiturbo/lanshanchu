import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { getSource, listDocuments, listSources, lookupDocuments, markDocumentIndexFailed, markSourceSynced, putSource, rebuildMissingIndexes, removeDocument, removeScannedFolderDocument, removeSource, saveDocument, updateFolderFormats } from "./db.ts";
import { createFolderSource } from "./model.ts";

const DB = "lanshan-library";

function completed(request: IDBRequest | IDBOpenDBRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  });
}

async function seedV4Database() {
  await completed(indexedDB.deleteDatabase(DB));
  const open = indexedDB.open(DB, 4);
  open.onupgradeneeded = () => {
    open.result.createObjectStore("documents", { keyPath: "id" });
    open.result.createObjectStore("meta", { keyPath: "id" });
    const shards = open.result.createObjectStore("shards", { keyPath: ["bucket", "id"] });
    shards.createIndex("byTerm", "terms", { multiEntry: true });
  };
  await completed(open);
  const transaction = open.result.transaction(["documents", "meta"], "readwrite");
  const legacy = { id: "legacy", name: "旧资料.md", content: "海棠计划使用蓝色灯笼。", importedAt: 42 };
  transaction.objectStore("documents").put(legacy);
  transaction.objectStore("meta").put({ id: legacy.id, name: legacy.name, importedAt: legacy.importedAt });
  await transactionDone(transaction);
  open.result.close();
}

test("v4 资料迁移到数据源后保留原文并可重建、检索和移除", async () => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  await seedV4Database();

  const before = await listDocuments();
  assert.equal(before.length, 1);
  assert.equal(before[0].sourceId, "manual-files");
  assert.equal(before[0].format, "md");
  assert.equal(before[0].indexStatus, "pending");

  const failedFolder = createFolderSource("failed-folder", "/资料/失败", "失败", 43);
  await putSource(failedFolder);
  await saveDocument({ id: "stale", sourceId: failedFolder.id, sourcePath: "旧.md", name: "旧.md", content: "蓝色灯笼蓝色灯笼蓝色灯笼", importedAt: 44 });
  await markDocumentIndexFailed((await listDocuments(failedFolder.id))[0], new Error("新文件解析失败"));

  await rebuildMissingIndexes();
  const sources = await listSources();
  const manual = sources.find((source) => source.id === "manual-files")!;
  assert.equal(manual.documentCount, 1);
  assert.equal(manual.indexedCount, 1);
  assert.equal(manual.status, "ready");
  assert.equal(manual.latestJob?.status, "completed");
  assert.equal((await listDocuments(failedFolder.id))[0].indexStatus, "failed");

  const result = await lookupDocuments("蓝色灯笼");
  assert.deepEqual(result.docs.map((doc) => doc.id), ["legacy"]);
  assert.deepEqual(result.matches.map((match) => match.id), ["legacy"]);
  assert.equal(result.incomplete, true);

  await removeDocument("legacy");
  assert.deepEqual(await listDocuments("manual-files"), []);
  assert.equal((await listSources()).find((source) => source.id === "manual-files")?.documentCount, 0);

  await removeSource(failedFolder.id);

  const folder = createFolderSource("folder-1", "/资料", "资料", 60);
  await putSource(folder);
  await saveDocument({ id: "folder-doc", sourceId: folder.id, sourcePath: "说明.md", name: "说明.md", content: "文件夹原文", importedAt: 61 });
  assert.equal((await listDocuments(folder.id)).length, 1);
  await removeSource(folder.id);
  assert.equal((await listSources()).some((source) => source.id === folder.id), false);
  assert.equal((await listDocuments()).length, 0);
});

test("修改文件夹格式时立即清理旧索引，迟到的同步不能恢复排除资料或覆盖设置", async () => {
  const source = createFolderSource("formats-folder", "/资料/格式", "格式");
  await putSource(source);
  await saveDocument({ id: "old-md", sourceId: source.id, sourcePath: "旧.MD", name: "旧.MD", content: "排除标记黄鹤楼", importedAt: 1 });
  await saveDocument({ id: "keep-pdf", sourceId: source.id, sourcePath: "保留.pdf", name: "保留.pdf", content: "保留标记青玉案", importedAt: 2 });
  assert.deepEqual((await lookupDocuments("黄鹤楼")).docs.map((doc) => doc.id), ["old-md"]);

  await updateFolderFormats(source.id, ["pdf"]);
  assert.deepEqual((await lookupDocuments("黄鹤楼")).docs, []);
  assert.deepEqual((await lookupDocuments("青玉案")).docs.map((doc) => doc.id), ["keep-pdf"]);
  assert.equal(await saveDocument({ id: "late-md", sourceId: source.id, sourcePath: "迟到.md", name: "迟到.md", content: "排除标记黄鹤楼", importedAt: 3 }), false);
  assert.equal(await removeScannedFolderDocument("keep-pdf", source), false);
  await markSourceSynced(source.id);
  assert.deepEqual((await getSource(source.id))?.allowedExtensions, ["pdf"]);
  assert.deepEqual((await listDocuments(source.id)).map((doc) => doc.id), ["keep-pdf"]);
  assert.equal(await removeScannedFolderDocument("keep-pdf", (await getSource(source.id))!), true);
  await removeSource(source.id);
});
