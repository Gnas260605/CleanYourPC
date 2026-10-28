import React, { useEffect, useRef } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";

export type ConfirmTone = "danger" | "warning" | "info";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  /** Nội dung chính: nêu rõ đối tượng và hệ quả */
  children: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  isBusy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const TONE_STYLES: Record<ConfirmTone, { border: string; icon: string; button: string }> = {
  danger: {
    border: "border-rose-500/40",
    icon: "text-rose-400",
    button: "bg-rose-500 hover:bg-rose-400 text-white",
  },
  warning: {
    border: "border-amber-500/40",
    icon: "text-amber-400",
    button: "bg-amber-400 hover:bg-amber-300 text-black",
  },
  info: {
    border: "border-cyan-500/40",
    icon: "text-cyan-400",
    button: "bg-cyan-400 hover:bg-cyan-300 text-black",
  },
};

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Hộp thoại xác nhận dùng chung cho mọi thao tác thay đổi hệ thống.
 * - Esc để đóng, focus bị giữ trong hộp thoại (focus trap), trả focus về phần tử cũ khi đóng.
 * - Nút mặc định được focus là "Hủy" để tránh xác nhận nhầm bằng Enter.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  children,
  confirmLabel = "Xác nhận",
  cancelLabel = "Hủy bỏ",
  tone = "warning",
  isBusy = false,
  onConfirm,
  onCancel,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useRef(`confirm-title-${Math.random().toString(36).slice(2)}`).current;
  // Giữ callback/trạng thái mới nhất trong ref để effect chỉ chạy khi mở/đóng (không giật focus mỗi lần render)
  const onCancelRef = useRef(onCancel);
  const isBusyRef = useRef(isBusy);
  onCancelRef.current = onCancel;
  isBusyRef.current = isBusy;

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isBusyRef.current) {
        e.preventDefault();
        onCancelRef.current();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const nodes = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      previouslyFocused?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen) return null;
  const styles = TONE_STYLES[tone];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isBusy) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`w-full max-w-md rounded-2xl glass-panel border ${styles.border} p-6 space-y-4`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <AlertTriangle className={`w-6 h-6 shrink-0 ${styles.icon}`} aria-hidden="true" />
            <h3 id={titleId} className="font-display font-bold text-base text-white">
              {title}
            </h3>
          </div>
          <button
            onClick={onCancel}
            disabled={isBusy}
            aria-label="Đóng hộp thoại"
            className="p-1 rounded-lg text-slate-300 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="text-xs text-slate-200 leading-relaxed space-y-2">{children}</div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={isBusy}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-200 hover:text-white hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={isBusy}
            className={`flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold transition-all disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-white ${styles.button}`}
          >
            {isBusy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            <span>{confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
