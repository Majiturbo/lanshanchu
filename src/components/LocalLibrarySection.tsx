import { useEffect, useRef, useState } from "react";
import {
  completeIndexJob,
  listDocuments,
  listSources,
  updateFolderFormats,
  rebuildMissingIndexes,
  removeDocument,
  removeSource,
  saveDocument,
  startIndexJob,
  updateIndexJob,
  type KnowledgeSourceSummary,
  type LocalDocumentMeta,
} from "../library/db.ts";
import { MANUAL_SOURCE_ID } from "../library/model.ts";
import { addAndSyncFolderSources, folderSourcesAvailable, removeFolderSource, syncFolderSource } from "../library/folders.ts";
import { parseDocument, SUPPORTED_DOCUMENT_EXTENSIONS } from "../library/parse.ts";
import { clipWebPage } from "../library/web-clips.ts";
import { addRssSource, syncRssSource } from "../library/rss.ts";
import { addGitHubSource, syncGitHubSource } from "../library/github.ts";
import { openExternal } from "../lib/external.ts";
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
  const [formatDrafts, setFormatDrafts] = useState<Record<string, string[]>>({});
  const [webUrl, setWebUrl] = useState("");
  const [rssUrl, setRssUrl] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [repoBranch, setRepoBranch] = useState("");
  const [repoFolder, setRepoFolder] = useState("");
  const deepLocalSearch = useSettings((state) => state.deepLocalSearch);

  const showDocuments = mode !== "retrieval";
  const showRetrieval = mode !== "documents";
  const selectedFormats = (source: KnowledgeSourceSummary) => formatDrafts[source.id] ?? source.allowedExtensions ?? [...SUPPORTED_DOCUMENT_EXTENSIONS];

  const setFormats = (source: KnowledgeSourceSummary, formats: string[]) => {
    setFormatDrafts((current) => ({ ...current, [source.id]: formats }));
  };

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

  const addWebPage = async (url: string, clearInput = false) => {
    setBusy(true);
    setStatus("正在读取网页并建立本地索引…");
    setError("");
    try {
      await clipWebPage(url);
      if (clearInput) setWebUrl("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "网页剪藏失败");
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

  const addRss = async () => {
    setBusy(true);
    setStatus("正在读取订阅源并建立索引…");
    setError("");
    try {
      await addRssSource(rssUrl);
      setRssUrl("");
      await refresh();
    } catch (err) {
      await refresh();
      setError(err instanceof Error ? err.message : "订阅源导入失败");
    } finally { setBusy(false); setStatus(""); }
  };

  const syncRss = async (source: KnowledgeSourceSummary) => {
    setBusy(true);
    setStatus(`正在同步 ${source.name}…`);
    setError("");
    try { await syncRssSource(source); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "订阅源同步失败"); }
    finally { setBusy(false); setStatus(""); }
  };

  const removeRss = async (source: KnowledgeSourceSummary) => {
    if (!window.confirm(`从知识库移除“${source.name}”及已导入的文章副本？`)) return;
    setBusy(true);
    setError("");
    try { await removeSource(source.id); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "订阅源移除失败"); }
    finally { setBusy(false); }
  };

  const addGitHub = async () => {
    setBusy(true);
    setStatus("正在读取公开仓库并建立索引…");
    setError("");
    try {
      await addGitHubSource(repoUrl, repoBranch, repoFolder);
      setRepoUrl(""); setRepoBranch(""); setRepoFolder("");
      await refresh();
    } catch (err) {
      await refresh();
      setError(err instanceof Error ? err.message : "仓库导入失败");
    } finally { setBusy(false); setStatus(""); }
  };

  const syncGitHub = async (source: KnowledgeSourceSummary) => {
    setBusy(true);
    setStatus(`正在同步 ${source.name}…`);
    setError("");
    try { await syncGitHubSource(source); await refresh(); }
    catch (err) { await refresh(); setError(err instanceof Error ? err.message : "仓库同步失败"); }
    finally { setBusy(false); setStatus(""); }
  };

  const removeGitHub = async (source: KnowledgeSourceSummary) => {
    if (!window.confirm(`从知识库移除“${source.name}”及本机索引？\n\nGitHub 仓库中的文件不会删除。`)) return;
    setBusy(true);
    setError("");
    try { await removeSource(source.id); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "仓库数据源移除失败"); }
    finally { setBusy(false); }
  };

  const applyFormats = async (source: KnowledgeSourceSummary) => {
    setBusy(true);
    setStatus(`正在更新 ${source.name} 的索引…`);
    setError("");
    try {
      await updateFolderFormats(source.id, selectedFormats(source));
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
      <p className="memory-hint">主动导入的文件、网页、订阅内容和公开 GitHub 仓库文档保存在这台设备上；桌面端也可添加文件夹，应用运行时会监听变化并增量更新。命中的片段会交给模型用于回答。在线来源需手动同步，订阅只有摘要时会标明并非全文。</p>
      <input ref={input} type="file" accept={SUPPORTED_DOCUMENT_EXTENSIONS.map((extension) => `.${extension}`).join(",")} multiple hidden onChange={(e) => void importFiles(e.target.files)} />
      <div className="local-library-actions">
        <button type="button" className="local-library-add" disabled={busy} onClick={() => input.current?.click()}>导入文件</button>
        {folderSourcesAvailable && <button type="button" className="local-library-add" disabled={busy} onClick={() => void addFolders()}>添加文件夹</button>}
      </div>
      <form className="local-library-web-form" onSubmit={(event) => { event.preventDefault(); void addWebPage(webUrl, true); }}>
        <input type="url" aria-label="网页地址" placeholder="粘贴网页地址" value={webUrl} disabled={busy} onChange={(event) => setWebUrl(event.target.value)} required />
        <button type="submit" className="local-library-add" disabled={busy || !webUrl.trim()}>剪藏网页</button>
      </form>
      <form className="local-library-web-form" onSubmit={(event) => { event.preventDefault(); void addRss(); }}>
        <input type="url" aria-label="RSS 或 Atom 地址" placeholder="粘贴 RSS / Atom 地址" value={rssUrl} disabled={busy} onChange={(event) => setRssUrl(event.target.value)} required />
        <button type="submit" className="local-library-add" disabled={busy || !rssUrl.trim()}>添加订阅</button>
      </form>
      <form className="local-library-web-form local-library-github-form" onSubmit={(event) => { event.preventDefault(); void addGitHub(); }}>
        <input type="url" aria-label="GitHub 公开仓库地址" placeholder="https://github.com/所有者/仓库" value={repoUrl} disabled={busy} onChange={(event) => setRepoUrl(event.target.value)} required />
        <input type="text" aria-label="GitHub 分支" placeholder="分支（留空使用默认分支）" value={repoBranch} disabled={busy} onChange={(event) => setRepoBranch(event.target.value)} />
        <input type="text" aria-label="GitHub 子目录" placeholder="子目录（留空导入整个分支）" value={repoFolder} disabled={busy} onChange={(event) => setRepoFolder(event.target.value)} />
        <button type="submit" className="local-library-add" disabled={busy || !repoUrl.trim()}>添加仓库</button>
      </form>
      {status && <p className="memory-hint" role="status">{status}</p>}
      {error && <p className="local-library-error" role="alert">{error}</p>}
      {error === "索引未全部建成；请释放本机空间或移除资料后重试。" && !busy && <button type="button" className="local-library-add" onClick={() => void refresh()}>重试建索引</button>}
      {sources.length > 0 && <ul className="local-library-sources">{sources.map((source) => <li key={source.id}>
        <div>
          <strong>{source.name}</strong>
          <span>{source.kind === "folder" ? source.rootPath : source.kind === "web-clips" ? "用户主动保存的网页快照" : source.kind === "rss" ? source.feedUrl : source.kind === "github" ? `${source.branch}${source.folderPath ? ` / ${source.folderPath}` : " / 整个分支"}` : "用户主动选择的文件"}</span>
        </div>
        <div>
          <span>{sourceState(source)}</span>
          {source.kind === "folder" && <>
            <button type="button" disabled={busy} onClick={() => void syncFolder(source)}>{source.status === "partial" || source.status === "error" ? "重试" : "同步"}</button>
            <button type="button" disabled={busy} onClick={() => void removeFolder(source)}>移除</button>
          </>}
          {source.kind === "rss" && <>
            <button type="button" disabled={busy} onClick={() => void syncRss(source)}>同步</button>
            <button type="button" disabled={busy} onClick={() => void removeRss(source)}>移除</button>
          </>}
          {source.kind === "github" && <>
            <button type="button" disabled={busy} onClick={() => void syncGitHub(source)}>同步</button>
            <button type="button" disabled={busy} onClick={() => void removeGitHub(source)}>移除</button>
          </>}
        </div>
        {!!source.latestJob?.errors.length && <details className="local-library-source-errors">
          <summary>查看 {source.latestJob.errors.length} 项失败原因</summary>
          <ul>{source.latestJob.errors.map((item, index) => <li key={`${item.name}:${index}`}><strong>{item.name}</strong><span>{item.message}</span></li>)}</ul>
        </details>}
        {source.kind === "folder" && <details className="local-library-source-formats">
          <summary>索引格式 {selectedFormats(source).length} 项</summary>
          <div className="local-library-format-grid">{SUPPORTED_DOCUMENT_EXTENSIONS.map((extension) => <label key={extension}>
            <input type="checkbox" checked={selectedFormats(source).includes(extension)} disabled={busy} onChange={(event) => {
              const next = event.target.checked
                ? [...selectedFormats(source), extension]
                : selectedFormats(source).filter((value) => value !== extension);
              setFormats(source, SUPPORTED_DOCUMENT_EXTENSIONS.filter((value) => next.includes(value)));
            }} />
            {extension.toUpperCase()}
          </label>)}</div>
          <div className="local-library-format-actions">
            <button type="button" disabled={busy} onClick={() => setFormats(source, [...SUPPORTED_DOCUMENT_EXTENSIONS])}>全选</button>
            <button type="button" disabled={busy} onClick={() => setFormats(source, [])}>清空选择</button>
            <button type="button" disabled={busy || (source.status !== "error" && source.status !== "partial" && selectedFormats(source).join(",") === (source.allowedExtensions ?? [...SUPPORTED_DOCUMENT_EXTENSIONS]).join(","))} onClick={() => void applyFormats(source)}>应用</button>
          </div>
        </details>}
      </li>)}</ul>}
      {!status && <p className="memory-hint">共 {docs.filter((doc) => doc.indexStatus === "ready").length} / {docs.length} 份资料可检索</p>}
      {docs.length > 0 && <ul className="local-library-list">{docs.map((doc) => <li key={doc.id}>
        <span title={doc.sourceUrl ?? doc.sourcePath ?? doc.name}>{doc.sourcePath ?? doc.name}</span>
        {doc.sourceUrl && <>
          <button type="button" onClick={() => openExternal(doc.sourceUrl!)}>打开</button>
          {doc.sourceId === "web-clips" && <button type="button" disabled={busy} aria-label={`更新 ${doc.name}`} onClick={() => void addWebPage(doc.sourceUrl!)}>更新</button>}
        </>}
        <button type="button" disabled={busy} aria-label={`移除 ${doc.name}`} onClick={() => void remove(doc.id)}>移除</button>
      </li>)}</ul>}
    </>}
  </section>;
}
