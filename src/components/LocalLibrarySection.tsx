import { useEffect, useRef, useState } from "react";
import {
  completeIndexJob,
  listDocuments,
  listSources,
  rebuildMissingIndexes,
  removeDocument,
  saveDocument,
  startIndexJob,
  updateIndexJob,
  type KnowledgeSourceSummary,
  type LocalDocumentMeta,
} from "../library/db.ts";
import { MANUAL_SOURCE_ID } from "../library/model.ts";
import { addAndSyncFolderSources, folderSourcesAvailable, removeFolderSource, syncFolderSource } from "../library/folders.ts";
import { parseDocument } from "../library/parse.ts";
import { settingsActions, useSettings } from "../settings/store.ts";

export type LocalLibraryMode = "all" | "documents" | "retrieval";

export function LocalLibrarySection({ mode = "all" }: { mode?: LocalLibraryMode }) {
  const input = useRef<HTMLInputElement>(null);
  const snapshotVersion = useRef(0);
  const [docs, setDocs] = useState<LocalDocumentMeta[]>([]);
  const [sources, setSources] = useState<KnowledgeSourceSummary[]>([]);
  const [busy, setBusy] = useState(true);
  const [status, setStatus] = useState("正在准备本地索引…");
  const [error, setError] = useState("");
  const deepLocalSearch = useSettings((state) => state.deepLocalSearch);

  const showDocuments = mode !== "retrieval";
  const showRetrieval = mode !== "documents";

  useEffect(() => {
    if (!showDocuments) return;
    let active = true;
    const onBlocked = () => setStatus("其他窗口正在使用资料库；关闭后会继续建立索引。");
    const onChanged = () => {
      const version = ++snapshotVersion.current;
      void Promise.all([listDocuments(), listSources()]).then(([documents, nextSources]) => {
        if (!active || version !== snapshotVersion.current) return;
        setDocs(documents);
        setSources(nextSources);
      }).catch(() => undefined);
    };
    addEventListener("lanshan:library-blocked", onBlocked);
    addEventListener("lanshan:library-changed", onChanged);
    void refresh();
    return () => {
      active = false;
      removeEventListener("lanshan:library-blocked", onBlocked);
      removeEventListener("lanshan:library-changed", onChanged);
    };
  }, [showDocuments]);

  const refresh = async () => {
    setBusy(true);
    setStatus("正在准备本地索引…");
    setError("");
    try { await rebuildMissingIndexes(); }
    catch { setError("索引未全部建成；请释放本机空间或移除资料后重试。"); }
    const version = ++snapshotVersion.current;
    try {
      const [documents, nextSources] = await Promise.all([listDocuments(), listSources()]);
      if (version !== snapshotVersion.current) return;
      setDocs(documents);
      setSources(nextSources);
    }
    catch (err) { setError(err instanceof Error ? err.message : "本地资料读取失败"); }
    finally { setBusy(false); setStatus(""); }
  };

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setStatus("正在读取文件并建立索引…");
    setError("");
    const selected = Array.from(files);
    let job;
    let updated = 0;
    let failed = 0;
    try {
      job = await startIndexJob(MANUAL_SOURCE_ID, "import", selected.length);
      for (let index = 0; index < selected.length; index++) {
        const file = selected[index];
        setStatus(`正在处理 ${index + 1} / ${selected.length}：${file.name}`);
        try {
          await updateIndexJob(job.id, { stage: "parsing", completed: index, updated, failed });
          const parsed = await parseDocument(file);
          await saveDocument({
            id: crypto.randomUUID(),
            sourceId: MANUAL_SOURCE_ID,
            name: file.name,
            ...parsed,
            importedAt: Date.now(),
            sourceModifiedAt: file.lastModified || undefined,
            sourceSize: file.size,
          });
          updated++;
          await updateIndexJob(job.id, { stage: "indexing", completed: index + 1, updated, failed });
        } catch (fileError) {
          failed++;
          await updateIndexJob(job.id, {
            stage: "indexing",
            completed: index + 1,
            updated,
            failed,
            error: { name: file.name, message: fileError instanceof Error ? fileError.message : "导入失败" },
          });
        }
      }
      await completeIndexJob(job.id);
      await refresh();
      if (failed) setError(`已导入 ${updated} 份，${failed} 份失败；失败文件未进入知识库。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败");
      const [documents, nextSources] = await Promise.all([
        listDocuments().catch(() => []),
        listSources().catch(() => []),
      ]);
      setDocs(documents);
      setSources(nextSources);
    } finally {
      if (input.current) input.current.value = "";
      setBusy(false);
      setStatus("");
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setStatus("正在移除资料与索引…");
    setError("");
    try { await removeDocument(id); }
    catch { setError("移除失败，请重试"); setBusy(false); setStatus(""); return; }
    await refresh();
  };

  const addFolders = async () => {
    setBusy(true);
    setStatus("正在读取文件夹并建立索引…");
    setError("");
    try {
      await addAndSyncFolderSources();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  const syncFolder = async (source: KnowledgeSourceSummary) => {
    setBusy(true);
    setStatus(`正在同步 ${source.name}…`);
    setError("");
    try {
      await syncFolderSource(source);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  const sourceState = (source: KnowledgeSourceSummary) => {
    if (source.status === "indexing") return "索引中";
    if (source.status === "partial") return "部分失败";
    if (source.status === "error") return "同步失败";
    return `${source.indexedCount} 份已索引`;
  };

  const removeFolder = async (source: KnowledgeSourceSummary) => {
    if (!window.confirm(`从知识库移除“${source.name}”？\n\n只会清理本地索引，不会删除文件夹中的原文件。`)) return;
    setBusy(true);
    setStatus(`正在移除 ${source.name} 的索引…`);
    setError("");
    try {
      await removeFolderSource(source.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "数据源移除失败");
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  return <section className="settings-section local-library-section">
    <h3>{mode === "retrieval" ? "本地深度检索" : "数据源"}</h3>
    {showRetrieval && <>
      <div className="field local-library-retrieval">
        <span className="field-label" id="local-deep-label">本地深度检索</span>
        <div className="segmented" role="radiogroup" aria-labelledby="local-deep-label">
          {([[true, "开启"], [false, "关闭"]] as const).map(([value, label]) => <button key={label} type="button" role="radio" aria-checked={deepLocalSearch === value} onClick={() => settingsActions.update({ deepLocalSearch: value })}>{label}</button>)}
        </div>
      </div>
      <p className="memory-hint">开启后每次命中资料会增加最多两次模型判断，并发送少量候选片段。</p>
    </>}
    {showDocuments && <>
      <p className="memory-hint">手动导入的副本保存在这台设备上；桌面端也可添加文件夹，应用运行时会监听变化并增量更新。命中的片段会交给模型用于回答。</p>
      <input ref={input} type="file" accept=".txt,.text,.md,.markdown,.html,.htm,.xhtml,.csv,.tsv,.json,.jsonl,.yaml,.yml,.xml,.pdf,.docx" multiple hidden onChange={(e) => void importFiles(e.target.files)} />
      <div className="local-library-actions">
        <button type="button" className="local-library-add" disabled={busy} onClick={() => input.current?.click()}>导入文件</button>
        {folderSourcesAvailable && <button type="button" className="local-library-add" disabled={busy} onClick={() => void addFolders()}>添加文件夹</button>}
      </div>
      {status && <p className="memory-hint" role="status">{status}</p>}
      {error && <p className="local-library-error" role="alert">{error}</p>}
      {error && !busy && <button type="button" className="local-library-add" onClick={() => void refresh()}>重试建索引</button>}
      {sources.length > 0 && <ul className="local-library-sources">{sources.map((source) => <li key={source.id}>
        <div>
          <strong>{source.name}</strong>
          <span>{source.kind === "folder" ? source.rootPath : "用户主动选择的文件"}</span>
        </div>
        <div>
          <span>{sourceState(source)}</span>
          {source.kind === "folder" && <>
            <button type="button" disabled={busy} onClick={() => void syncFolder(source)}>同步</button>
            <button type="button" disabled={busy} onClick={() => void removeFolder(source)}>移除</button>
          </>}
        </div>
      </li>)}</ul>}
      {!status && <p className="memory-hint">共 {docs.filter((doc) => doc.indexStatus === "ready").length} / {docs.length} 份资料可检索</p>}
      {docs.length > 0 && <ul className="local-library-list">{docs.map((doc) => <li key={doc.id}>
        <span>{doc.sourcePath ?? doc.name}</span>
        <button type="button" disabled={busy} aria-label={`移除 ${doc.name}`} onClick={() => void remove(doc.id)}>移除</button>
      </li>)}</ul>}
    </>}
  </section>;
}
