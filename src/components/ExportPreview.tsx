import { useEffect, useState } from "react";
import { bindExportPreview, type ExportPreviewRequest } from "../lib/exportPreview.ts";
import { usePresence } from "./presence.ts";

/** 导出前预览 Markdown：看清要分享的内容，再打开系统分享 */
export function ExportPreview() {
  const [req, setReq] = useState<ExportPreviewRequest | null>(null);
  const p = usePresence(!!req);

  useEffect(() => bindExportPreview(setReq), []);

  if (!p.mounted || !req) return null;

  const close = (ok: boolean) => {
    req.resolve(ok);
    setReq(null);
  };

  const preview = req.content.length > 1200 ? `${req.content.slice(0, 1200)}\n…` : req.content;

  return (
    <div className={`mobile-sheet${p.closing ? " is-closing" : ""}`} role="dialog" aria-label="导出预览">
      <div className="mobile-sheet-scrim" onClick={() => close(false)} />
      <div className="mobile-sheet-panel export-preview-panel">
        <div className="mobile-sheet-handle" aria-hidden="true" />
        <p className="mobile-sheet-title">导出预览</p>
        <p className="export-preview-name">{req.name}</p>
        <pre className="export-preview-body">{preview}</pre>
        <button type="button" className="mobile-sheet-item" style={{ background: "var(--solid)", color: "var(--on-solid-btn)", justifyContent: "center" }} onClick={() => close(true)}>
          分享 Markdown
        </button>
        <button type="button" className="mobile-sheet-item mobile-sheet-cancel" onClick={() => close(false)}>取消</button>
      </div>
    </div>
  );
}
