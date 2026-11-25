export const LIBRARY_DB_VERSION = 5;
export const LIBRARY_INDEX_VERSION = 4;
export const MANUAL_SOURCE_ID = "manual-files";
export const WEB_CLIPS_SOURCE_ID = "web-clips";

export type KnowledgeSourceKind = "manual-files" | "folder" | "web-clips";
export type KnowledgeSourceStatus = "ready" | "indexing" | "partial" | "error";
export type DocumentIndexStatus = "pending" | "ready" | "failed";
export type IndexJobKind = "import" | "rebuild";
export type IndexJobStatus = "running" | "completed" | "partial" | "failed";
export type IndexJobStage = "reading" | "parsing" | "indexing" | "finished";

export interface KnowledgeSource {
  id: string;
  kind: KnowledgeSourceKind;
  name: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  rootPath?: string;
  recursive?: boolean;
  includeHidden?: boolean;
  allowedExtensions?: string[];
  lastSyncedAt?: number;
}

export interface KnowledgeSourceSummary extends KnowledgeSource {
  documentCount: number;
  indexedCount: number;
  failedCount: number;
  status: KnowledgeSourceStatus;
  latestJob?: IndexJob;
}

export interface IndexJobError {
  name: string;
  message: string;
}

export interface IndexJob {
  id: string;
  sourceId: string;
  kind: IndexJobKind;
  status: IndexJobStatus;
  stage: IndexJobStage;
  total: number;
  completed: number;
  updated: number;
  failed: number;
  errors: IndexJobError[];
  startedAt: number;
  finishedAt?: number;
}

export interface IndexJobProgress {
  stage?: IndexJobStage;
  total?: number;
  completed?: number;
  updated?: number;
  failed?: number;
  error?: IndexJobError;
}

export function createManualSource(now = Date.now()): KnowledgeSource {
  return {
    id: MANUAL_SOURCE_ID,
    kind: "manual-files",
    name: "手动导入",
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function createWebClipsSource(now = Date.now()): KnowledgeSource {
  return { id: WEB_CLIPS_SOURCE_ID, kind: "web-clips", name: "网页剪藏", enabled: true, createdAt: now, updatedAt: now };
}

export function createFolderSource(id: string, rootPath: string, name: string, now = Date.now()): KnowledgeSource {
  return {
    id,
    kind: "folder",
    name,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    rootPath,
    recursive: true,
    includeHidden: false,
  };
}

export function extensionForName(name: string): string {
  const match = /\.([^.]+)$/u.exec(name.trim());
  return match?.[1]?.toLocaleLowerCase() ?? "";
}

export function finishIndexJob(job: IndexJob, now = Date.now()): IndexJob {
  const failed = Math.max(job.failed, job.errors.length);
  const status: IndexJobStatus = failed === 0
    ? "completed"
    : job.updated > 0 || job.completed > failed ? "partial" : "failed";
  return { ...job, failed, status, stage: "finished", finishedAt: now };
}

export function sourceStatus(latestJob: IndexJob | undefined, failedDocuments: number): KnowledgeSourceStatus {
  if (latestJob?.status === "running") return "indexing";
  if (latestJob?.status === "failed") return "error";
  if (latestJob?.status === "partial" || failedDocuments > 0) return "partial";
  return "ready";
}
