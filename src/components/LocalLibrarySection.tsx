import { useEffect, useRef, useState } from "react";
import { listDocuments, removeDocument, saveDocument, type LocalDocument } from "../library/db.ts";

const MAX_BYTES = 2 * 1024 * 1024;

export function LocalLibrarySection() {
  const input = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<LocalDocument[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { listDocuments().then(setDocs).catch(() => setError("本地资料读取失败")); }, []);

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError("");
    try {
      for (const file of Array.from(files)) {
        if (!/\.(txt|md|markdown)$/i.test(file.name)) throw new Error(`${file.name}：只支持 TXT 和 Markdown`);
        if (file.size > MAX_BYTES) throw new Error(`${file.name}：文件不能超过 2 MB`);
        const content = (await file.text()).trim();
        if (!content) throw new Error(`${file.name}：文件没有文字`);
        await saveDocument({ id: crypto.randomUUID(), name: file.name, content, importedAt: Date.now() });
      }
      setDocs(await listDocuments());
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败");
      setDocs(await listDocuments().catch(() => []));
    } finally {
      if (input.current) input.current.value = "";
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError("");
    try { await removeDocument(id); setDocs(await listDocuments()); }
    catch { setError("移除失败，请重试"); }
    finally { setBusy(false); }
  };

  return <section className="settings-section local-library-section">
    <h3>本地资料</h3>
    <p className="memory-hint">主动导入 TXT 或 Markdown；提问时仅把命中的片段发送给模型。资料保存在这台设备上；文件更新请先移除旧版再导入。已有回答的引用仍保留。</p>
    <input ref={input} type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" multiple hidden onChange={(e) => void importFiles(e.target.files)} />
    <button type="button" className="local-library-add" disabled={busy} onClick={() => input.current?.click()}>加入文件</button>
    {error && <p className="local-library-error" role="alert">{error}</p>}
    {docs.length > 0 && <ul className="local-library-list">{docs.map((doc) => <li key={doc.id}>
      <span title={doc.name}>{doc.name}</span>
      <button type="button" disabled={busy} aria-label={`移除 ${doc.name}`} onClick={() => void remove(doc.id)}>移除</button>
    </li>)}</ul>}
  </section>;
}
