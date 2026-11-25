import assert from "node:assert/strict";
import test from "node:test";
import { createFolderSource, createManualSource, extensionForName, finishIndexJob, sourceStatus, type IndexJob } from "./model.ts";

function runningJob(overrides: Partial<IndexJob> = {}): IndexJob {
  return {
    id: "job-1",
    sourceId: "manual-files",
    kind: "import",
    status: "running",
    stage: "indexing",
    total: 2,
    completed: 0,
    updated: 0,
    failed: 0,
    errors: [],
    startedAt: 10,
    ...overrides,
  };
}

test("默认数据源身份稳定，旧资料可以安全归入同一来源", () => {
  assert.deepEqual(createManualSource(42), {
    id: "manual-files",
    kind: "manual-files",
    name: "手动导入",
    enabled: true,
    createdAt: 42,
    updatedAt: 42,
  });
});

test("文件夹源只记录用户选中的根目录与索引选项", () => {
  assert.deepEqual(createFolderSource("folder-1", "/资料/项目", "项目", 42), {
    id: "folder-1",
    kind: "folder",
    name: "项目",
    enabled: true,
    createdAt: 42,
    updatedAt: 42,
    rootPath: "/资料/项目",
    recursive: true,
    includeHidden: false,
  });
});

test("格式从文件名派生且不信任大小写", () => {
  assert.equal(extensionForName("报告.DOCX"), "docx");
  assert.equal(extensionForName("README"), "");
});

test("任务保留部分成功，不把失败批次伪装为全部失败", () => {
  const partial = finishIndexJob(runningJob({ completed: 2, updated: 1, failed: 1 }), 99);
  assert.equal(partial.status, "partial");
  assert.equal(partial.finishedAt, 99);
  assert.equal(sourceStatus(partial, 0), "partial");

  const failed = finishIndexJob(runningJob({ completed: 2, failed: 2 }), 100);
  assert.equal(failed.status, "failed");
  assert.equal(sourceStatus(failed, 0), "error");
});

test("文档失败状态不会被较早的成功任务遮住", () => {
  const completed = finishIndexJob(runningJob({ completed: 2, updated: 2 }), 99);
  assert.equal(completed.status, "completed");
  assert.equal(sourceStatus(completed, 1), "partial");
});
