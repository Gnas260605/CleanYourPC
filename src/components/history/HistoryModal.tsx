import React, { useState, useEffect } from "react";
import { 
  X, 
  History, 
  Trash2, 
  HardDrive, 
  ShieldCheck, 
  CheckCircle2, 
  Zap, 
  Lock, 
  Clock, 
  Calendar, 
  Loader2,
  FileCheck,
  AlertTriangle
} from "lucide-react";
import { HistorySummary, OptimizationLog } from "@/types";
import { formatBytes } from "@/utils/formatters";
import { isTauriContext } from "@/hooks/useHardwareMetrics";

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNotify?: (msg: string) => void;
}

const MOCK_HISTORY_LOGS: OptimizationLog[] = [
  {
    id: "hist-1",
    timestamp: Math.floor(Date.now() / 1000) - 1800, // 30 minutes ago
    action_type: "1-Click Boost",
    freed_bytes: 840 * 1024 * 1024,
    items_cleaned: 14,
    items_skipped_locked: 2,
    details: "Thu hồi RAM Working Set & Dọn sạch %TEMP% an toàn",
  },
  {
    id: "hist-2",
    timestamp: Math.floor(Date.now() / 1000) - 7200, // 2 hours ago
    action_type: "Safe Cleaner",
    freed_bytes: 1840 * 1024 * 1024,
    items_cleaned: 48,
    items_skipped_locked: 4,
    details: "Dọn dẹp Windows Temp, Thumbnail Cache & Shader Cache",
  },
  {
    id: "hist-3",
    timestamp: Math.floor(Date.now() / 1000) - 86400, // 1 day ago
    action_type: "Process Eco-Mode",
    freed_bytes: 420 * 1024 * 1024,
    items_cleaned: 3,
    items_skipped_locked: 0,
    details: "Áp dụng EcoQoS và nén bộ nhớ cho các ứng dụng chạy nền ngốn RAM",
  },
];

const LOCAL_STORAGE_HISTORY_KEY = "winpulse_optimization_history";

export const HistoryModal: React.FC<HistoryModalProps> = ({
  isOpen,
  onClose,
  onNotify,
}) => {
  const [history, setHistory] = useState<HistorySummary>({
    total_freed_bytes: 0,
    total_sessions: 0,
    logs: [],
  });
  const [isLoading, setIsLoading] = useState(false);
  const [filterType, setFilterType] = useState<string>("All");
  const [isClearing, setIsClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const fetchHistory = async () => {
    setIsLoading(true);
    if (isTauriContext()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const res = await invoke<HistorySummary>("get_optimization_history");
        if (res) {
          setHistory(res);
          setIsLoading(false);
          return;
        }
      } catch (err) {
        console.warn("Lỗi get_optimization_history từ Tauri:", err);
      }
    }

    // Web dev fallback
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_HISTORY_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as HistorySummary;
        setHistory(parsed);
      } else {
        const initialMock: HistorySummary = {
          total_freed_bytes: MOCK_HISTORY_LOGS.reduce((acc, l) => acc + l.freed_bytes, 0),
          total_sessions: MOCK_HISTORY_LOGS.length,
          logs: MOCK_HISTORY_LOGS,
        };
        localStorage.setItem(LOCAL_STORAGE_HISTORY_KEY, JSON.stringify(initialMock));
        setHistory(initialMock);
      }
    } catch (e) {
      setHistory({ total_freed_bytes: 0, total_sessions: 0, logs: [] });
    }
    setIsLoading(false);
  };

  useEffect(() => {
    if (isOpen) {
      fetchHistory();
    }
  }, [isOpen]);

  const handleClearHistory = async () => {
    setIsClearing(true);
    if (isTauriContext()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke<boolean>("clear_history");
        setHistory({
          total_freed_bytes: 0,
          total_sessions: 0,
          logs: [],
        });
        setIsClearing(false);
        setShowClearConfirm(false);
        onNotify?.("📜 Đã xóa sạch toàn bộ lịch sử tối ưu!");
        return;
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        setIsClearing(false);
        onNotify?.(`Lỗi xóa lịch sử: ${errorMsg}`);
        return;
      }
    }

    // Web Fallback
    setTimeout(() => {
      const empty: HistorySummary = {
        total_freed_bytes: 0,
        total_sessions: 0,
        logs: [],
      };
      localStorage.setItem(LOCAL_STORAGE_HISTORY_KEY, JSON.stringify(empty));
      setHistory(empty);
      setIsClearing(false);
      setShowClearConfirm(false);
      onNotify?.("📜 [Mô phỏng] Đã xóa sạch lịch sử tối ưu!");
    }, 400);
  };

  if (!isOpen) return null;

  // Calculate total locked files bypassed across all logs
  const totalLockedBypassed = history.logs.reduce(
    (acc, log) => acc + (log.items_skipped_locked || 0),
    0
  );

  // Filter logs by selected action type
  const filteredLogs = history.logs.filter((log) => {
    if (filterType === "All") return true;
    return log.action_type.toLowerCase().includes(filterType.toLowerCase());
  });

  const formatTimestamp = (timestampSec: number) => {
    try {
      const date = new Date(timestampSec * 1000);
      return date.toLocaleString("vi-VN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return "Không rõ";
    }
  };

  const getActionBadgeColor = (action: string) => {
    if (action.includes("Boost")) return "bg-cyan-500/15 text-cyan-300 border-cyan-500/30";
    if (action.includes("Clean")) return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    if (action.includes("Eco")) return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    return "bg-violet-500/15 text-violet-300 border-violet-500/30";
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl rounded-2xl glass-panel border border-cyan-500/30 shadow-glow-cyan/30 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Glow ambient background element */}
        <div className="absolute -top-24 left-1/3 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="p-5 border-b border-white/[0.08] flex items-center justify-between relative z-10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-400">
              <History className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="font-display font-bold text-base sm:text-lg text-white">
                Nhật Ký & Lịch Sử Tối Ưu Hệ Thống
              </h2>
              <p className="text-xs text-slate-400">
                Lưu trữ toàn diện các phiên dọn dẹp, dung lượng giải phóng và tệp bảo vệ an toàn
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {history.logs.length > 0 && (
              <button
                type="button"
                onClick={() => setShowClearConfirm(true)}
                title="Xóa toàn bộ lịch sử"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-850 hover:bg-rose-500/15 text-slate-400 hover:text-rose-300 border border-white/[0.06] hover:border-rose-500/30 text-xs transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Xóa lịch sử</span>
              </button>
            )}

            <button
              onClick={onClose}
              aria-label="Đóng lịch sử"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 3 Overview KPI Metric Cards */}
        <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-3 border-b border-white/[0.06] bg-surface-950/40 relative z-10 shrink-0">
          {/* KPI 1: Total Freed Space */}
          <div className="p-3.5 rounded-xl bg-gradient-to-br from-emerald-500/10 to-transparent border border-emerald-500/25">
            <div className="flex items-center justify-between text-slate-400 text-[11px] mb-1 font-medium">
              <span>Đã Giải Phóng Lũy Kế</span>
              <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="font-display font-extrabold text-xl text-emerald-300 tracking-tight">
              {formatBytes(history.total_freed_bytes)}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Ổ cứng & RAM thu hồi an toàn
            </div>
          </div>

          {/* KPI 2: Total Sessions */}
          <div className="p-3.5 rounded-xl bg-gradient-to-br from-cyan-500/10 to-transparent border border-cyan-500/25">
            <div className="flex items-center justify-between text-slate-400 text-[11px] mb-1 font-medium">
              <span>Tổng Số Phiên Tối Ưu</span>
              <Zap className="w-3.5 h-3.5 text-cyan-400" />
            </div>
            <div className="font-display font-extrabold text-xl text-cyan-300 tracking-tight">
              {history.total_sessions} phiên
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              1-Click Boost & Dọn dẹp tệp
            </div>
          </div>

          {/* KPI 3: Locked Files Protected */}
          <div className="p-3.5 rounded-xl bg-gradient-to-br from-violet-500/10 to-transparent border border-violet-500/25">
            <div className="flex items-center justify-between text-slate-400 text-[11px] mb-1 font-medium">
              <span>Tệp Được Bảo Vệ (Zero-Crash)</span>
              <ShieldCheck className="w-3.5 h-3.5 text-violet-400" />
            </div>
            <div className="font-display font-extrabold text-xl text-violet-300 tracking-tight">
              {totalLockedBypassed} tệp
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Bỏ qua êm ái khi đang bị khóa
            </div>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="px-5 py-2.5 bg-surface-900/60 border-b border-white/[0.04] flex items-center gap-2 overflow-x-auto no-scrollbar shrink-0">
          <span className="text-[11px] text-slate-400 font-medium mr-1">Bộ lọc:</span>
          {[
            { id: "All", label: "Tất cả" },
            { id: "Boost", label: "1-Click Boost" },
            { id: "Clean", label: "Safe Cleaner" },
            { id: "Eco", label: "Eco-Mode" },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setFilterType(item.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                filterType === item.id
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                  : "bg-surface-850/60 text-slate-400 hover:text-white border border-transparent"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* List of Sessions */}
        <div className="p-5 divide-y divide-white/[0.04] overflow-y-auto space-y-3 relative z-10 flex-1">
          {isLoading ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3 text-slate-400 text-xs">
              <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
              <span>Đang tải lịch sử tối ưu...</span>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="py-16 flex flex-col items-center justify-center text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-surface-900/80 border border-white/[0.06] flex items-center justify-center text-slate-400">
                <FileCheck className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-300">Chưa có bản ghi nào</h4>
                <p className="text-xs text-slate-400 max-w-sm mt-1">
                  Khi bạn thực hiện 1-Click Boost hoặc Safe Cleaner, các bản ghi tối ưu sẽ tự động xuất hiện tại đây.
                </p>
              </div>
            </div>
          ) : (
            filteredLogs.map((log) => (
              <div
                key={log.id}
                className="pt-3 first:pt-0 pb-1 flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${getActionBadgeColor(
                        log.action_type
                      )}`}
                    >
                      {log.action_type}
                    </span>

                    <span className="text-xs font-mono text-slate-400 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span>{formatTimestamp(log.timestamp)}</span>
                    </span>
                  </div>

                  <p className="text-xs text-slate-200">{log.details}</p>

                  <div className="flex items-center gap-3 text-[11px] text-slate-400">
                    <span className="flex items-center gap-1 text-emerald-400">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>{log.items_cleaned} mục tối ưu</span>
                    </span>

                    {log.items_skipped_locked > 0 && (
                      <span className="flex items-center gap-1 text-amber-400">
                        <Lock className="w-3 h-3" />
                        <span>{log.items_skipped_locked} tệp khóa bỏ qua an toàn</span>
                      </span>
                    )}
                  </div>
                </div>

                <div className="sm:text-right shrink-0">
                  <span className="text-sm font-display font-bold text-emerald-300 font-mono">
                    +{formatBytes(log.freed_bytes)}
                  </span>
                  <div className="text-[10px] text-slate-400">đã giải phóng</div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Confirmation Modal to Clear History */}
        {showClearConfirm && (
          <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
            <div className="w-full max-w-sm rounded-2xl glass-panel border border-rose-500/30 p-5 space-y-4 shadow-glow-rose/20">
              <div className="flex items-center gap-3 text-rose-400">
                <AlertTriangle className="w-6 h-6" />
                <h3 className="font-display font-bold text-base text-white">
                  Xác nhận xóa toàn bộ lịch sử?
                </h3>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Hành động này sẽ dọn sạch toàn bộ nhật ký phiên tối ưu đã lưu. Số liệu thống kê tổng cộng sẽ được đặt lại về 0.
              </p>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowClearConfirm(false)}
                  disabled={isClearing}
                  className="px-3.5 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white"
                >
                  Hủy bỏ
                </button>
                <button
                  type="button"
                  onClick={handleClearHistory}
                  disabled={isClearing}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-rose-500 text-white shadow-glow-rose hover:bg-rose-600 transition-all disabled:opacity-50"
                >
                  {isClearing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Đang xóa...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Xóa sạch</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="p-4 border-t border-white/[0.08] bg-surface-950/80 flex items-center justify-between text-xs text-slate-400 shrink-0">
          <div className="flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span>Lưu trữ cục bộ an toàn trong Windows AppData</span>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-surface-850 hover:bg-surface-800 text-slate-200 hover:text-white text-xs font-medium transition-colors"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
