/** 移动端导出前预览：确认内容与文件名后再走系统分享 */

export type ExportPreviewRequest = {
  name: string;
  content: string;
  resolve: (ok: boolean) => void;
};

type Listener = (req: ExportPreviewRequest | null) => void;

let listener: Listener | null = null;

export function bindExportPreview(fn: Listener) {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

export function askExportPreview(name: string, content: string): Promise<boolean> {
  if (!listener) return Promise.resolve(true);
  return new Promise((resolve) => {
    listener!({ name, content, resolve });
  });
}
