import { useState } from "react";
import { 
  Sparkles, 
  Cpu, 
  MemoryStick, 
  Zap, 
  ShieldCheck, 
  RefreshCw,
  CheckCircle2,
  Layers
} from "lucide-react";
import { CircularGauge } from "./CircularGauge";
import { ThroughputCard } from "./ThroughputCard";
import { SystemSpecsCard } from "./SystemSpecsCard";
import { QuickScanModal } from "./QuickScanModal";
import { formatBytes } from "@/utils/formatters";
import { HardwareMetrics, OptimizationLog } from "@/types";
import { AnimatedCounter } from "@/components/common/AnimatedCounter";
import { triggerQuickBoost } from "@/services/apiBridge";

interface DashboardPageProps {
  metrics: HardwareMetrics;
  onRefresh?: () => void;
  onBoostNotification: (msg: string) => void;
  visualEffectsEnabled?: boolean;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  metrics,
  onRefresh,
  onBoostNotification,
  visualEffectsEnabled = true,
}) => {
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const [isDirectBoosting, setIsDirectBoosting] = useState(false);
  const [boostCelebration, setBoostCelebration] = useState<OptimizationLog | null>(null);

  const showBoostResult = (log: OptimizationLog) => {
    setBoostCelebration(log);
    onBoostNotification(
      `⚡ Quick Boost: thu gọn ${log.items_cleaned} tiến trình, ước tính ~${formatBytes(log.freed_bytes)} RAM.`
    );
    setTimeout(() => setBoostCelebration(null), 7000);
  };

  // Compute health score based on CPU & RAM usage
  const healthScore = Math.max(
    60,
    Math.round(100 - (metrics.cpu.usage * 0.25 + metrics.ram.usagePercent * 0.25))
  );

  // 1-Click Boost: gọi backend thật, hiển thị đúng kết quả backend trả về (backend tự ghi lịch sử)
  const handleInstantBoost = async () => {
    setIsDirectBoosting(true);
    try {
      showBoostResult(await triggerQuickBoost());
    } catch (err: unknown) {
      onBoostNotification(`Không thể chạy Quick Boost: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsDirectBoosting(false);
    }
  };

  return (
    <div className="space-y-6 relative">
      {/* Laser Scanning Beam over entire Dashboard during active boost */}
      {isDirectBoosting && visualEffectsEnabled && (
        <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
          <div className="absolute inset-x-0 h-1.5 laser-beam-line animate-laser-sweep" />
          <div className="absolute inset-0 bg-cyan-500/[0.04] backdrop-blur-[0.5px] transition-all" />
        </div>
      )}

      {/* Hero Banner: 1-Click Boost & Quick Health Overview */}
      <div className="relative p-6 rounded-3xl glass-panel border border-cyan-500/20 shadow-glow-cyan/20 overflow-hidden">
        {/* Glow backdrop circles */}
        <div className="absolute top-0 right-10 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-10 w-80 h-80 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-xl">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-xs font-semibold uppercase tracking-wider">
                Hệ thống thời gian thực
              </span>
              <div className="flex items-center gap-1 text-xs text-emerald-400 font-mono">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Zero-Harm Engine</span>
              </div>
            </div>

            <h1 className="font-display font-extrabold text-2xl lg:text-3xl tracking-tight text-white">
              Hiệu suất Windows đang ở mức{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-violet-300 to-emerald-400">
                {healthScore >= 85 ? "Rất Tốt" : healthScore >= 70 ? "Khá Tốt" : "Cần Tối Ưu"}
              </span>
            </h1>

            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              Tất cả các dịch vụ hệ thống và luồng tiến trình đều được giám sát liên tục. Nhấn quét nhanh để kiểm tra tệp rác, tiến trình nặng và dịch vụ không cần thiết.
            </p>
          </div>

          {/* Quick Boost Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto shrink-0">
            {onRefresh && (
              <button
                onClick={onRefresh}
                className="w-full sm:w-auto px-4 py-3.5 rounded-2xl bg-surface-850 hover:bg-surface-800 border border-white/[0.08] text-slate-300 hover:text-white text-xs font-medium flex items-center justify-center gap-2 transition-all active:scale-95"
                title="Làm mới thông số ngay"
              >
                <RefreshCw className="w-4 h-4 text-slate-400" />
                <span>Làm mới</span>
              </button>
            )}

            {/* Instant 1-Click Boost Button */}
            <button
              onClick={handleInstantBoost}
              disabled={isDirectBoosting}
              className={`w-full sm:w-auto relative group overflow-hidden px-6 py-3.5 rounded-2xl bg-gradient-to-r from-cyan-500 via-blue-600 to-violet-600 text-white font-semibold text-sm tracking-wide shadow-glow-cyan hover:shadow-glow-cyan-lg hover:brightness-110 active:scale-95 transition-all duration-200 flex items-center justify-center gap-2.5 ${
                isDirectBoosting ? "opacity-75 cursor-wait" : ""
              }`}
            >
              {/* Shimmer light pass */}
              <div className="absolute inset-0 bg-white/20 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out" />

              <Sparkles className={`w-4 h-4 text-cyan-200 ${isDirectBoosting ? "animate-spin" : "animate-pulse"}`} />
              <span>{isDirectBoosting ? "Đang tối ưu..." : "1-Click Boost Ngay"}</span>
              <Zap className="w-4 h-4 text-yellow-300" />
            </button>

            {/* Detailed Quick Scan Modal opener */}
            <button
              onClick={() => setIsScanModalOpen(true)}
              className="w-full sm:w-auto px-3.5 py-3.5 rounded-2xl bg-surface-800/80 hover:bg-surface-800 border border-white/[0.08] text-slate-300 hover:text-cyan-300 text-xs font-medium transition-all"
              title="Quét chi tiết từng bước"
            >
              <Layers className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Boost Celebration & Animated Counter Banner */}
      {boostCelebration && (
        <div className="p-5 rounded-2xl bg-gradient-to-r from-emerald-500/15 via-cyan-500/10 to-violet-500/10 border border-emerald-500/40 shadow-glow-emerald animate-in slide-in-from-top-4 duration-300 relative overflow-hidden">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-emerald-500/20 text-emerald-400 shadow-glow-emerald">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-display font-bold text-base text-white flex items-center gap-2">
                  <span>Quick Boost hoàn tất</span>
                </h3>
                <p className="text-xs text-slate-300 mt-0.5">
                  Windows đã thu gọn Working Set của các tiến trình không cốt lõi. Dung lượng RAM là số ước tính.
                </p>
              </div>
            </div>

            {/* Jumping Animated Counters */}
            <div className="flex items-center gap-4 flex-wrap">
              <div className="px-3.5 py-2 rounded-xl bg-surface-950/70 border border-emerald-500/30 text-center">
                <div className="text-[10px] text-slate-300 font-medium">RAM ước tính</div>
                <div className="font-display font-bold text-base text-emerald-400 font-mono">
                  ~<AnimatedCounter end={Math.round(boostCelebration.freed_bytes / (1024 * 1024))} suffix=" MB" />
                </div>
              </div>

              <div className="px-3.5 py-2 rounded-xl bg-surface-950/70 border border-violet-500/30 text-center">
                <div className="text-[10px] text-slate-300 font-medium">Tiến trình đã thu gọn</div>
                <div className="font-display font-bold text-base text-violet-400 font-mono">
                  <AnimatedCounter end={boostCelebration.items_cleaned} />
                </div>
              </div>

              <div className="px-3.5 py-2 rounded-xl bg-surface-950/70 border border-white/[0.08] text-center">
                <div className="text-[10px] text-slate-300 font-medium">Bỏ qua</div>
                <div className="font-display font-bold text-base text-slate-200 font-mono">
                  <AnimatedCounter end={boostCelebration.items_skipped_locked} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Speedometer Gauges Section: CPU & RAM */}
      <div className={`grid grid-cols-1 md:grid-cols-2 gap-6 relative ${isDirectBoosting ? "electric-pulse-ring" : ""}`}>
        <CircularGauge
          label="Mức tải Bộ vi xử lý (CPU)"
          value={metrics.cpu.usage}
          unit="%"
          subLabel="Nhiệt độ"
          subValue={metrics.cpu.temperature ? `${metrics.cpu.temperature}°C` : "N/A"}
          icon={<Cpu className="w-4 h-4 text-cyan-400" />}
          size={210}
        />

        <CircularGauge
          label="Mức sử dụng Bộ nhớ (RAM)"
          value={metrics.ram.usagePercent}
          unit="%"
          subLabel="Đã dùng"
          subValue={`${formatBytes(metrics.ram.usedBytes, 1)} / ${formatBytes(metrics.ram.totalBytes, 0)}`}
          icon={<MemoryStick className="w-4 h-4 text-violet-400" />}
          size={210}
        />
      </div>

      {/* Throughput Section: Disk I/O & Network */}
      <ThroughputCard disk={metrics.disk} network={metrics.network} />

      {/* System Specifications Card */}
      <SystemSpecsCard cpu={metrics.cpu} ram={metrics.ram} system={metrics.system} />

      {/* Quick Scan & Boost Modal */}
      <QuickScanModal
        isOpen={isScanModalOpen}
        onClose={() => setIsScanModalOpen(false)}
        metrics={metrics}
        onBoostApplied={showBoostResult}
      />
    </div>
  );
};
