import { useEffect, useRef, useState } from "react";
import { listDocuments, rebuildMissingIndexes, removeDocument, saveDocument, type LocalDocumentMeta } from "../library/db.ts";
import { parseDocument } from "../library/parse.ts";
import { settingsActions, useSettings } from "../settings/store.ts";

export function LocalLibrarySection() {
  const input = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<LocalDocumentMeta[]>([]);
  const [busy, setBusy] = useState(true);
  const [status, setStatus] = useState("正在准备本地索引…");
  const [error, setError] = useState("");
  const deepLocalSearch = useSettings((state) => state.deepLocalSearch);

  useEffect(() => {
    const onBlocked = () => setStatus("其他窗口正在使用资料库；关闭后会继续建立索引。");
    addEventListener("lanshan:library-blocked", onBlocked);
    void refresh();
    return () => removeEventListener("lanshan:library-blocked", onBlocked);
  }, []);

  const refresh = async () => {
    setBusy(true);
    setStatus("正在准备本地索引…");
    setError("");
    try { await rebuildMissingIndexes(); }
    catch { setError("索引未全部建成；请释放本机空间或移除资料后重试。"); }
    try { setDocs(await listDocuments()); }
    catch (err) { setError(err instanceof Error ? err.message : "本地资料读取失败"); }
    finally { setBusy(false); setStatus(""); }
  };

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setStatus("正在读取文件并建立索引…");
    setError("");
    try {
      for (const file of Array.from(files)) {
        const parsed = await parseDocument(file);
        await saveDocument({ id: crypto.randomUUID(), name: file.name, ...parsed, importedAt: Date.now() });
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败");
      setDocs(await listDocuments().catch(() => []));
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

  return <section className="settings-section local-library-section">
    <h3>本地资料</h3>
    <p className="memory-hint">主动导入 TXT、Markdown、PDF 或 DOCX；资料保存在这台设备上，命中的片段会交给模型用于回答。文件更新请先移除旧版再导入。已有回答的引用仍保留。</p>
    <div className="field">
      <span className="field-label" id="local-deep-label">本地深度检索</span>
      <div className="segmented" role="radiogroup" aria-labelledby="local-deep-label">
        {([[true, "开启"], [false, "关闭"]] as const).map(([value, label]) => <button key={label} type="button" role="radio" aria-checked={deepLocalSearch === value} onClick={() => settingsActions.update({ deepLocalSearch: value })}>{label}</button>)}
      </div>
    </div>
    <p className="memory-hint">开启后每次命中资料会增加最多两次模型判断，并发送少量候选片段。</p>
    <input ref={input} type="file" accept=".txt,.md,.markdown,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple hidden onChange={(e) => void importFiles(e.target.files)} />
    <button type="button" className="local-library-add" disabled={busy} onClick={() => input.current?.click()}>加入文件</button>
    {status && <p className="memory-hint" role="status">{status}</p>}
    {error && <p className="local-library-error" role="alert">{error}</p>}
    {error && !busy && <button type="button" className="local-library-add" onClick={() => void refresh()}>重试建索引</button>}
    {!status && <p className="memory-hint">已索引 {docs.filter((doc) => doc.indexedVersion === 4).length} / {docs.length} 份资料</p>}
    {docs.length > 0 && <ul className="local-library-list">{docs.map((doc) => <li key={doc.id}>
      <span title={doc.name}>{doc.name}</span>
      <button type="button" disabled={busy} aria-label={`移除 ${doc.name}`} onClick={() => void remove(doc.id)}>移除</button>
    </li>)}</ul>}
  </section>;
}
