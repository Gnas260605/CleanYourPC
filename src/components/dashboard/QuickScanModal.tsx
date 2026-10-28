import React, { useState, useEffect } from "react";
import {
  X,
  Sparkles,
  CheckCircle2,
  Cpu,
  Trash2,
  ShieldCheck,
  ArrowRight,
  Save,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { HardwareMetrics, OptimizationLog } from "@/types";
import { formatBytes } from "@/utils/formatters";
import {
  createRestorePoint,
  fetchProcessList,
  fetchServices,
  scanCleanableFiles,
  triggerQuickBoost,
} from "@/services/apiBridge";
import { countHeavyProcesses } from "@/hooks/useNavBadges";

interface QuickScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  metrics: HardwareMetrics;
  /** Kết quả thật của trigger_quick_boost */
  onBoostApplied: (log: OptimizationLog) => void;
}

type StepStatus = "pending" | "running" | "completed" | "error";

interface ScanStep {
  id: "ram" | "temp" | "process" | "services";
  title: string;
  status: StepStatus;
  result?: string;
  icon: React.ComponentType<{ className?: string }>;
}

const INITIAL_STEPS: ScanStep[] = [
  { id: "ram", title: "Mức sử dụng RAM hiện tại", status: "pending", icon: Cpu },
  { id: "temp", title: "Quét tệp rác an toàn (%TEMP%, Crash Dumps, Thumbnails)", status: "pending", icon: Trash2 },
  { id: "process", title: "Tiến trình ngốn RAM (≥ 1 GB)", status: "pending", icon: Cpu },
  { id: "services", title: "Dịch vụ telemetry/không cần thiết đang bật", status: "pending", icon: ShieldCheck },
];

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Quét nhanh: chạy các kiểm tra CHỈ ĐỌC thật (không xóa gì), hiển thị kết quả thật.
 * Nút áp dụng chỉ chạy Quick Boost (thu gọn Working Set) + tùy chọn tạo Restore Point.
 * Dọn tệp rác và tắt dịch vụ vẫn phải làm ở tab tương ứng, có xác nhận riêng.
 */
export const QuickScanModal: React.FC<QuickScanModalProps> = ({ isOpen, onClose, metrics, onBoostApplied }) => {
  const [steps, setSteps] = useState<ScanStep[]>(INITIAL_STEPS);
  const [isFinished, setIsFinished] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [appliedLog, setAppliedLog] = useState<OptimizationLog | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [wantRestorePoint, setWantRestorePoint] = useState(true);
  const [restorePointStatus, setRestorePointStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setSteps(INITIAL_STEPS);
      setIsFinished(false);
      setIsApplying(false);
      setAppliedLog(null);
      setApplyError(null);
      setRestorePointStatus(null);
      return;
    }

    let cancelled = false;
    const update = (id: ScanStep["id"], status: StepStatus, result?: string) => {
      if (cancelled) return;
      setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, status, result } : s)));
    };

    async function runChecks() {
      update(
        "ram",
        "completed",
        metrics.ram.totalBytes > 0
          ? `Đang dùng ${metrics.ram.usagePercent}% (${formatBytes(metrics.ram.usedBytes)} / ${formatBytes(metrics.ram.totalBytes)})`
          : "Chưa có số liệu từ backend"
      );

      update("temp", "running");
      try {
        const { items } = await scanCleanableFiles();
        const total = items.reduce((acc, i) => acc + i.size_bytes, 0);
        update("temp", "completed", `${items.length} tệp, tổng ${formatBytes(total)} — dọn ở tab "Dọn dẹp an toàn"`);
      } catch (err) {
        update("temp", "error", errorText(err));
      }

      update("process", "running");
      try {
        const heavy = countHeavyProcesses(await fetchProcessList());
        update("process", "completed", heavy > 0 ? `${heavy} tiến trình đang dùng ≥ 1 GB RAM` : "Không có tiến trình nào ngốn RAM bất thường");
      } catch (err) {
        update("process", "error", errorText(err));
      }

      update("services", "running");
      try {
        const candidates = (await fetchServices()).filter(
          (s) => s.can_modify && s.recommendation === "safe_to_disable" && s.startup_type !== "Disabled"
        );
        update(
          "services",
          "completed",
          candidates.length > 0
            ? `${candidates.length} dịch vụ khuyên tắt — xem ở tab "Dịch vụ Windows"`
            : "Không còn dịch vụ khuyên tắt nào đang bật"
        );
      } catch (err) {
        update("services", "error", errorText(err));
      }

      if (!cancelled) setIsFinished(true);
    }

    runChecks();
    return () => {
      cancelled = true;
    };
    // Chỉ chạy lại khi mở modal; metrics dùng giá trị tại thời điểm mở
  }, [isOpen]);

  if (!isOpen) return null;

  const handleApply = async () => {
    setIsApplying(true);
    setApplyError(null);

    if (wantRestorePoint) {
      setRestorePointStatus("Đang tạo Điểm khôi phục hệ thống...");
      try {
        const ok = await createRestorePoint("WinPulse Optimizer Pre-Boost Restore Point");
        setRestorePointStatus(
          ok ? "Đã tạo Restore Point thành công." : "Không tạo được Restore Point (cần quyền Administrator / System Protection)."
        );
      } catch (err) {
        setRestorePointStatus(`Không tạo được Restore Point: ${errorText(err)}`);
      }
    }

    try {
      const log = await triggerQuickBoost();
      setAppliedLog(log);
      onBoostApplied(log);
    } catch (err) {
      setApplyError(errorText(err));
    } finally {
      setIsApplying(false);
    }
  };

  const completedCount = steps.filter((s) => s.status === "completed" || s.status === "error").length;
  const progress = Math.round((completedCount / steps.length) * 100);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-scan-title"
        className="relative w-full max-w-xl rounded-2xl glass-panel border border-cyan-500/30 overflow-hidden"
      >
        <div className="p-6 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <Sparkles className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2 id="quick-scan-title" className="font-display font-bold text-lg text-white">
                {isFinished ? "Kết quả Quét Nhanh" : "Đang kiểm tra hệ thống..."}
              </h2>
              <p className="text-xs text-slate-300">Chỉ đọc — quét nhanh không xóa hay thay đổi gì.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Đóng"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="font-medium text-cyan-300">{isFinished ? "Hoàn tất" : `Đang kiểm tra: ${progress}%`}</span>
              <span className="font-mono text-slate-300">
                {completedCount} / {steps.length}
              </span>
            </div>
            <div
              className="w-full h-2 rounded-full bg-surface-900 overflow-hidden border border-white/[0.06]"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full bg-gradient-to-r from-cyan-400 via-violet-400 to-emerald-400 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <ul className="space-y-2.5">
            {steps.map((step) => {
              const Icon = step.icon;
              return (
                <li
                  key={step.id}
                  className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${
                    step.status === "running"
                      ? "bg-cyan-500/10 border-cyan-500/30"
                      : step.status === "pending"
                      ? "bg-surface-900/30 border-white/[0.02] opacity-60"
                      : "bg-surface-900/60 border-white/[0.06]"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-1.5 rounded-lg bg-surface-850 text-cyan-300">
                      <Icon className="w-4 h-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-xs font-semibold text-slate-100">{step.title}</h4>
                      <p className={`text-[11px] mt-0.5 ${step.status === "error" ? "text-rose-300" : "text-slate-300"}`}>
                        {step.status === "running" ? "Đang kiểm tra..." : step.result ?? "Đang chờ"}
                      </p>
                    </div>
                  </div>
                  {step.status === "completed" && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />}
                  {step.status === "running" && <Loader2 className="w-4 h-4 text-cyan-300 animate-spin shrink-0" aria-hidden="true" />}
                  {step.status === "error" && <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" aria-hidden="true" />}
                </li>
              );
            })}
          </ul>

          {isFinished && (
            <div className="space-y-3">
              <p className="text-xs text-slate-300 leading-relaxed">
                <b className="text-white">Quick Boost</b> yêu cầu Windows thu gọn Working Set của các tiến trình không cốt lõi.
                RAM được trả lại ngay nhưng ứng dụng có thể chậm một chút khi cần nạp lại dữ liệu.
              </p>
              <label className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-surface-900/80 border border-white/[0.06] text-xs text-slate-200 cursor-pointer hover:bg-surface-900">
                <input
                  type="checkbox"
                  checked={wantRestorePoint}
                  onChange={(e) => setWantRestorePoint(e.target.checked)}
                  className="rounded border-slate-700 text-cyan-500 focus:ring-cyan-500 w-4 h-4"
                />
                <Save className="w-3.5 h-3.5 text-violet-400" aria-hidden="true" />
                <span>Tạo Điểm khôi phục hệ thống trước khi Boost</span>
              </label>

              {restorePointStatus && (
                <div className="text-[11px] font-mono text-cyan-200 px-3 py-1 rounded bg-cyan-500/10 border border-cyan-500/20">
                  {restorePointStatus}
                </div>
              )}
              {appliedLog && (
                <div className="text-[11px] text-emerald-200 px-3 py-2 rounded bg-emerald-500/10 border border-emerald-500/20">
                  Đã thu gọn {appliedLog.items_cleaned} tiến trình (ước tính ~{formatBytes(appliedLog.freed_bytes)} RAM),
                  bỏ qua {appliedLog.items_skipped_locked}.
                </div>
              )}
              {applyError && (
                <div className="text-[11px] text-rose-200 px-3 py-2 rounded bg-rose-500/10 border border-rose-500/20">
                  {applyError}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-white/[0.08] bg-surface-950/60 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-200 hover:text-white hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            {appliedLog ? "Đóng" : "Hủy bỏ"}
          </button>

          <button
            disabled={!isFinished || isApplying || appliedLog !== null}
            onClick={handleApply}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-semibold tracking-wide transition-all focus-visible:ring-2 focus-visible:ring-white ${
              appliedLog
                ? "bg-emerald-500 text-black"
                : isFinished
                ? "bg-gradient-to-r from-cyan-500 to-violet-600 text-white hover:brightness-110 active:scale-95"
                : "bg-surface-800 text-slate-400 cursor-not-allowed"
            }`}
          >
            {appliedLog ? (
              <>
                <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                <span>Đã áp dụng</span>
              </>
            ) : isApplying ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span>Đang áp dụng...</span>
              </>
            ) : (
              <>
                <span>Chạy Quick Boost</span>
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
