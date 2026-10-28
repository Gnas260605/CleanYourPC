import React, { useCallback, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";

export type ToastKind = "success" | "warning" | "error" | "info";

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

/** Tối đa số toast hiển thị cùng lúc; toast cũ nhất bị đẩy ra */
const MAX_TOASTS = 4;
const DURATION_MS: Record<ToastKind, number> = { success: 4500, info: 4500, warning: 7000, error: 9000 };

/** Đoán loại toast từ nội dung khi nơi gọi không chỉ định (giữ tương thích với onNotify(msg) cũ) */
export function inferToastKind(message: string): ToastKind {
  const m = message.toLowerCase();
  if (/(lỗi|không thể|không được|thất bại|từ chối|error)/.test(m)) return "error";
  if (/(cảnh báo|chưa|hủy|bỏ qua|cần quyền|mất kết nối)/.test(m)) return "warning";
  if (/(thành công|hoàn tất|đã |xong)/.test(m)) return "success";
  return "info";
}

const STYLES: Record<ToastKind, { border: string; icon: React.ReactNode }> = {
  success: { border: "border-emerald-500/40", icon: <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" /> },
  info: { border: "border-cyan-500/40", icon: <Info className="w-4 h-4 text-cyan-400 shrink-0" aria-hidden="true" /> },
  warning: { border: "border-amber-500/50", icon: <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" /> },
  error: { border: "border-rose-500/50", icon: <XCircle className="w-4 h-4 text-rose-400 shrink-0" aria-hidden="true" /> },
};

/** Hàng đợi toast: nhiều toast cùng lúc, mỗi loại có thời gian hiển thị riêng (lỗi hiển thị lâu hơn) */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback(
    (message: string, kind?: ToastKind) => {
      const id = nextId.current++;
      const resolved = kind ?? inferToastKind(message);
      setToasts((prev) => [...prev, { id, message, kind: resolved }].slice(-MAX_TOASTS));
      setTimeout(() => dismiss(id), DURATION_MS[resolved]);
    },
    [dismiss]
  );

  return { toasts, notify, dismiss };
}

export const ToastStack: React.FC<{ toasts: Toast[]; onDismiss: (id: number) => void }> = ({ toasts, onDismiss }) => (
  <div className="fixed bottom-12 right-6 z-50 flex flex-col gap-2 items-end pointer-events-none" aria-live="polite" role="status">
    {toasts.map((t) => (
      <div
        key={t.id}
        role={t.kind === "error" ? "alert" : undefined}
        className={`pointer-events-auto max-w-md flex items-start gap-3 px-4 py-3 rounded-2xl bg-surface-900/95 border ${STYLES[t.kind].border} text-xs text-white backdrop-blur-xl shadow-lg`}
      >
        {STYLES[t.kind].icon}
        <span className="font-medium leading-relaxed select-text">{t.message}</span>
        <button
          onClick={() => onDismiss(t.id)}
          aria-label="Đóng thông báo"
          className="text-slate-300 hover:text-white ml-1 rounded focus-visible:ring-2 focus-visible:ring-cyan-400"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    ))}
  </div>
);
