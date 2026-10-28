import React, { useState } from "react";
import { 
  ShieldCheck, 
  Clock, 
  Radio, 
  Flame,
  Save,
  Loader2,
  Settings,
  History
} from "lucide-react";
import { formatUptime } from "@/utils/formatters";
import { MetricsStatus, MOCK_METRICS_ENABLED } from "@/hooks/useHardwareMetrics";
import { createRestorePoint } from "@/services/apiBridge";

const STATUS_PILL: Record<MetricsStatus, { label: string; className: string }> = {
  live: { label: "Đã kết nối backend", className: "text-cyan-400 animate-pulse" },
  connecting: { label: "Đang kết nối...", className: "text-slate-300" },
  mock: { label: "Dữ liệu giả lập (dev)", className: "text-amber-400" },
  offline: { label: "Mất kết nối backend", className: "text-rose-400" },
};

interface HeaderProps {
  uptimeSeconds: number;
  status: MetricsStatus;
  isHighLoadSim: boolean;
  onToggleHighLoad: () => void;
  onNotify?: (msg: string) => void;
  onOpenSettings?: () => void;
  onOpenHistory?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  uptimeSeconds,
  status,
  isHighLoadSim,
  onToggleHighLoad,
  onNotify,
  onOpenSettings,
  onOpenHistory,
}) => {
  const [isCreatingRestorePoint, setIsCreatingRestorePoint] = useState(false);

  const handleCreateRestorePoint = async () => {
    setIsCreatingRestorePoint(true);
    try {
      const success = await createRestorePoint("WinPulse Optimizer Manual Restore Point");
      if (success) {
        onNotify?.("🛡️ Đã tạo Điểm khôi phục hệ thống (Restore Point) thành công!");
      } else {
        onNotify?.("Không thể tạo Điểm khôi phục: Yêu cầu quyền Administrator hoặc System Protection chưa bật.");
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      onNotify?.(`Lỗi tạo Restore Point: ${errorMsg}`);
    } finally {
      setIsCreatingRestorePoint(false);
    }
  };

  const statusPill = STATUS_PILL[status];

  return (
    <header className="h-13 shrink-0 border-b border-white/[0.06] bg-surface-950/70 backdrop-blur-xl px-4 sm:px-6 flex items-center justify-between select-none z-40 transition-colors">
      {/* Left: System Status & Diagnostic Info */}
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span className="hidden sm:inline">Active Zero-Harm Shield</span>
          <span className="sm:hidden">Shield ON</span>
        </div>

        {/* Restore Point Shortcut Button */}
        <button
          onClick={handleCreateRestorePoint}
          disabled={isCreatingRestorePoint}
          title="Tạo điểm khôi phục hệ thống (System Restore Point) để bảo vệ toàn diện theo RULE.md"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 text-violet-300 text-xs font-medium transition-all active:scale-95 disabled:opacity-50"
        >
          {isCreatingRestorePoint ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-400" />
              <span className="hidden sm:inline">Đang tạo Restore Point...</span>
            </>
          ) : (
            <>
              <Save className="w-3.5 h-3.5 text-violet-400" />
              <span>Restore Point</span>
            </>
          )}
        </button>

        {/* Uptime Pill */}
        <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-850/80 border border-white/[0.06] text-slate-400 text-xs font-mono">
          <Clock className="w-3 h-3 text-slate-400" />
          <span>Up: {formatUptime(uptimeSeconds)}</span>
        </div>
      </div>

      {/* Right: History, Settings & Developer Tools */}
      <div className="flex items-center gap-2">
        {/* Engine Mode Pill */}
        <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-850/70 border border-white/[0.05] text-[11px] font-mono text-slate-400">
          <Radio className={`w-3 h-3 ${statusPill.className}`} aria-hidden="true" />
          <span>{statusPill.label}</span>
        </div>

        {/* Dev Tool: Toggle High Load Simulator (chỉ có khi npm run dev) */}
        {MOCK_METRICS_ENABLED && (
        <button
          onClick={onToggleHighLoad}
          aria-label="Bật/tắt mô phỏng quá tải (chỉ dev)"
          aria-pressed={isHighLoadSim}
          title="Mô phỏng trạng thái CPU/RAM quá tải để kiểm thử giao diện cảnh báo"
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-mono transition-all ${
            isHighLoadSim
              ? "bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-glow-rose"
              : "bg-surface-850/70 text-slate-400 hover:text-slate-200 border border-white/[0.05]"
          }`}
        >
          <Flame className="w-3 h-3 text-rose-400" />
          <span className="hidden sm:inline">{isHighLoadSim ? "High Load ON" : "Stress Sim"}</span>
        </button>
        )}

        {/* Vertical divider */}
        <div className="h-4 w-[1px] bg-white/[0.1] mx-1" />

        {/* History 📜 Button */}
        <button
          type="button"
          onClick={onOpenHistory}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-850 hover:bg-surface-800 text-slate-300 hover:text-cyan-300 border border-white/[0.06] hover:border-cyan-500/30 text-xs font-medium transition-all active:scale-95 shadow-sm group"
          title="Xem lịch sử và nhật ký tối ưu hệ thống (Optimization History)"
          aria-label="History"
        >
          <History className="w-3.5 h-3.5 text-cyan-400 group-hover:rotate-[-20deg] transition-transform" />
          <span className="hidden sm:inline">Lịch sử</span>
        </button>

        {/* Settings ⚙️ Button */}
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-850 hover:bg-surface-800 text-slate-300 hover:text-cyan-300 border border-white/[0.06] hover:border-cyan-500/30 text-xs font-medium transition-all active:scale-95 shadow-sm group"
          title="Mở Cài đặt hệ thống (Settings)"
          aria-label="Settings"
        >
          <Settings className="w-3.5 h-3.5 text-slate-400 group-hover:text-cyan-400 group-hover:rotate-45 transition-transform" />
          <span className="hidden sm:inline">Cài đặt</span>
        </button>
      </div>
    </header>
  );
};
