import { X } from "lucide-react";

/**
 * 对话框跟系统习惯：macOS 用底部「完成 / 取消」、不点遮罩关闭；
 * Windows 与网页用右上角叉号，并可点遮罩关闭。
 * 按当前系统判断（不要求在桌面应用里），浏览器在 Mac 上开发时也能看到同样效果。
 */
export const MAC_DIALOG = /Macintosh/.test(navigator.userAgent);

/** 右上角关闭叉号：非 Mac 才有 */
export function DialogCloseIcon({ onClose, label }: { onClose: () => void; label: string }) {
  if (MAC_DIALOG) return null;
  return (
    <button type="button" className="icon-btn" aria-label={label} onClick={onClose}>
      <X size={16} strokeWidth={1.6} />
    </button>
  );
}

/** 底部「完成」：Mac 关掉设置 / 历史 / 总结这类即改即存的面板 */
export function DialogDone({ onClose }: { onClose: () => void }) {
  if (!MAC_DIALOG) return null;
  return (
    <footer className="dialog-foot">
      <button type="button" className="btn btn-primary" onClick={onClose}>完成</button>
    </footer>
  );
}

/** 遮罩点击：Mac 模态框不靠点外面关掉 */
export function scrimClose(onClose: () => void): { onClick?: () => void } {
  return MAC_DIALOG ? {} : { onClick: onClose };
}
