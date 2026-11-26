import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { beginSourceSync, completeIndexJob, getSource, listDocuments, listSources, lookupDocuments, markDocumentIndexFailed, markSourceSynced, putSource, rebuildMissingIndexes, removeDocument, removeScannedFolderDocument, removeSource, removeSourceDocument, saveDocument, saveSourceDocument, startIndexJob, updateFolderFormats, updateIndexJob, updateRssSourceUrl, updateSourceDocumentUrl } from "./db.ts";
import { createFolderSource, createWebClipsSource, WEB_CLIPS_SOURCE_ID } from "./model.ts";

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

test("重复剪藏同一网页替换原文和索引，移除后不再召回", async () => {
  const base = { id: "web:test", sourceId: WEB_CLIPS_SOURCE_ID, sourceUrl: "https://example.com/article", name: "海棠计划", format: "html" };
  await saveDocument({ ...base, content: "海棠计划使用蓝色灯笼。", importedAt: 1 }, createWebClipsSource());
  assert.equal((await getSource(WEB_CLIPS_SOURCE_ID))?.kind, "web-clips");
  assert.deepEqual((await lookupDocuments("蓝色灯笼")).docs.map((doc) => doc.id), [base.id]);
  await saveDocument({ ...base, content: "海棠计划使用紫色纸鹤。", importedAt: 2 });
  assert.deepEqual((await lookupDocuments("蓝色灯笼")).docs, []);
  assert.deepEqual((await lookupDocuments("紫色纸鹤")).docs.map((doc) => doc.id), [base.id]);
  assert.equal((await listDocuments(WEB_CLIPS_SOURCE_ID))[0].sourceUrl, base.sourceUrl);
  await removeDocument(base.id);
  assert.deepEqual((await lookupDocuments("紫色纸鹤")).docs, []);
  await removeSource(WEB_CLIPS_SOURCE_ID);
});

test("订阅源改址保留同步时间，移除后的迟到更新不会重建来源", async () => {
  const source = { id: "rss:move", kind: "rss" as const, name: "订阅", feedUrl: "https://example.com/old", enabled: true, createdAt: 1, updatedAt: 1 };
  await putSource(source);
  await markSourceSynced(source.id);
  const syncedAt = (await getSource(source.id))?.lastSyncedAt;
  await updateRssSourceUrl(source.id, "https://example.com/new");
  assert.equal((await getSource(source.id))?.feedUrl, "https://example.com/new");
  assert.equal((await getSource(source.id))?.lastSyncedAt, syncedAt);
  await removeSource(source.id);
  await updateRssSourceUrl(source.id, "https://example.com/late");
  assert.equal(await getSource(source.id), undefined);
});

test("仓库新同步和重新添加会使旧任务失去写入与清理资格", async () => {
  const source = { id: "github:race", kind: "github" as const, name: "仓库", repoOwner: "owner", repoName: "repo", branch: "main", folderPath: "", enabled: true, createdAt: 101, updatedAt: 101 };
  await putSource(source);
  const first = await beginSourceSync(source);
  const oldJob = await startIndexJob(source.id, "import", 1, source, first);
  const doc = { id: "github:race:README.md", sourceId: source.id, sourcePath: "README.md", sourceRevision: "a".repeat(40), name: "README.md", content: "第一版仓库文档", importedAt: 1 };
  assert.equal(await saveSourceDocument(doc, source, first), true);
  const second = await beginSourceSync(source);
  await assert.rejects(startIndexJob(source.id, "import", 1, source, first), /替代/);
  await assert.rejects(updateIndexJob(oldJob.id, { completed: 1, failed: 1 }, source, first), /替代/);
  await assert.rejects(completeIndexJob(oldJob.id, source, first), /替代/);
  const newJob = await startIndexJob(source.id, "import", 1, source, second);
  await updateIndexJob(newJob.id, { completed: 1, updated: 1 }, source, second);
  await completeIndexJob(newJob.id, source, second);
  assert.equal((await listSources()).find((item) => item.id === source.id)?.latestJob?.id, newJob.id);
  assert.equal(await saveSourceDocument({ ...doc, content: "迟到旧内容" }, source, first), false);
  assert.equal(await removeSourceDocument(doc.id, source, first), false);
  assert.equal(await saveSourceDocument({ ...doc, content: "第二版仓库文档", importedAt: 2 }, source, second), true);
  assert.equal(await updateSourceDocumentUrl(doc.id, source, second, doc.sourceRevision, "https://github.com/owner/repo/blob/new/README.md"), true);
  assert.equal((await listDocuments(source.id))[0].sourceUrl, "https://github.com/owner/repo/blob/new/README.md");
  await markDocumentIndexFailed({ ...doc, indexStatus: "ready" }, new Error("旧任务失败"), source, first);
  assert.equal((await listDocuments(source.id))[0].indexStatus, "ready");
  assert.equal(await removeSourceDocument(doc.id, source, second), true);
  assert.deepEqual(await listDocuments(source.id), []);
  assert.deepEqual((await lookupDocuments("第二版仓库文档")).docs, []);
  await removeSource(source.id);
  await putSource({ ...source, createdAt: 202, updatedAt: 202 });
  assert.equal(await saveSourceDocument(doc, source, first), false);
  assert.equal(await removeSourceDocument(doc.id, source, first), false);
  assert.deepEqual(await listDocuments(source.id), []);
  await removeSource(source.id);
});

test("GitLab 仓库也按同步代际保护索引与任务", async () => {
  const source = { id: "gitlab:race", kind: "gitlab" as const, name: "仓库", repoOwner: "team", repoName: "docs", branch: "main", folderPath: "README.md", enabled: true, createdAt: 303, updatedAt: 303 };
  await putSource(source);
  const first = await beginSourceSync(source);
  const oldJob = await startIndexJob(source.id, "import", 1, source, first);
  const second = await beginSourceSync(source);
  assert.equal(await saveSourceDocument({ id: "gitlab:race:README.md", sourceId: source.id, name: "README.md", content: "旧内容", importedAt: 1 }, source, first), false);
  await assert.rejects(completeIndexJob(oldJob.id, source, first), /替代/);
  const job = await startIndexJob(source.id, "import", 0, source, second);
  await completeIndexJob(job.id, source, second);
  assert.equal((await listSources()).find((item) => item.id === source.id)?.latestJob?.id, job.id);
  await removeSource(source.id);
});
