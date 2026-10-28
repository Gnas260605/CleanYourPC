import React, { useCallback, useEffect, useState } from "react";
import {
  SlidersHorizontal,
  Lock,
  Power,
  Sparkles,
  Filter,
  RotateCcw,
  RotateCw,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { ServiceInfo, ServiceRecommendation, ServiceStartupType } from "@/types";
import { fetchServices, setServiceStartup, restoreServiceStartup } from "@/services/apiBridge";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";

interface ServicesOptimizerProps {
  onNotify: (msg: string) => void;
}

const STARTUP_LABEL: Record<ServiceStartupType, string> = {
  Automatic: "Tự động",
  AutomaticDelayed: "Tự động (trễ)",
  Manual: "Thủ công",
  Disabled: "Đã tắt",
  Other: "Hệ thống",
};

const RECOMMENDATION_BADGE: Record<ServiceRecommendation, { label: string; className: string }> = {
  safe_to_disable: {
    label: "Khuyên tắt",
    className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  },
  caution: {
    label: "Cần cân nhắc",
    className: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  },
  keep_default: {
    label: "Khóa bảo vệ",
    className: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  },
};

/** Hành động đang chờ người dùng xác nhận */
type PendingAction =
  | { kind: "disable"; services: ServiceInfo[] }
  | { kind: "restore"; service: ServiceInfo };

export const ServicesOptimizer: React.FC<ServicesOptimizerProps> = ({ onNotify }) => {
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<"all" | ServiceRecommendation>("all");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  const loadServices = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setServices(await fetchServices());
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadServices();
  }, [loadServices]);

  // Dịch vụ "Khuyên tắt" còn đang bật → ứng viên cho tối ưu 1 chạm
  const oneClickCandidates = services.filter(
    (s) => s.can_modify && s.recommendation === "safe_to_disable" && s.startup_type !== "Disabled"
  );

  const handleConfirm = async () => {
    if (!pending) return;
    setIsApplying(true);
    try {
      if (pending.kind === "disable") {
        let ok = 0;
        const errors: string[] = [];
        for (const svc of pending.services) {
          try {
            await setServiceStartup(svc.name, "Disabled", true);
            ok++;
          } catch (err: unknown) {
            errors.push(`${svc.name}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        if (errors.length > 0) {
          onNotify(`Đã tắt ${ok}/${pending.services.length} dịch vụ. Lỗi: ${errors[0]}`);
        } else {
          onNotify(`Đã tắt ${ok} dịch vụ. Có thể hoàn tác từng dịch vụ bằng nút "Hoàn tác".`);
        }
      } else {
        const res = await restoreServiceStartup(pending.service.name);
        onNotify(res.message);
      }
    } catch (err: unknown) {
      onNotify(`Không thể thay đổi dịch vụ: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsApplying(false);
      setPending(null);
      await loadServices();
    }
  };

  const filteredServices = services.filter(
    (svc) => filterType === "all" || svc.recommendation === filterType
  );

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="p-6 rounded-3xl glass-panel border border-cyan-500/20 relative overflow-hidden">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="p-1 rounded-lg bg-cyan-500/10 text-cyan-400">
                <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
              </span>
              <h2 className="font-display font-bold text-xl text-white">
                Tối ưu dịch vụ hệ thống (Windows Services)
              </h2>
            </div>
            <p className="text-xs text-slate-300 max-w-2xl">
              Trạng thái đọc trực tiếp từ Service Control Manager. Chỉ các dịch vụ trong danh sách hỗ trợ mới đổi được;
              startup type gốc được sao lưu để hoàn tác. Cần quyền Administrator để thay đổi.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={loadServices}
              disabled={isLoading}
              aria-label="Tải lại danh sách dịch vụ"
              className="p-2.5 rounded-xl bg-surface-850 hover:bg-surface-800 text-slate-200 border border-white/[0.08] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              <RotateCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} aria-hidden="true" />
            </button>
            <button
              onClick={() => setPending({ kind: "disable", services: oneClickCandidates })}
              disabled={oneClickCandidates.length === 0 || isApplying}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500/20 to-violet-500/20 hover:from-cyan-500/30 hover:to-violet-500/30 text-cyan-200 border border-cyan-500/40 font-semibold text-xs transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              <Sparkles className="w-4 h-4 text-cyan-400" aria-hidden="true" />
              <span>Tắt {oneClickCandidates.length} dịch vụ khuyên tắt</span>
            </button>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-5 pt-5 border-t border-white/[0.06] text-xs flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <span className="text-slate-300">Khuyên tắt (Tăng tốc & Bảo mật)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <span className="text-slate-300">Thận trọng (Tùy nhu cầu sử dụng)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
            <span className="text-slate-300">Cốt lõi Windows (Khóa cấm sửa)</span>
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex items-center gap-2 overflow-x-auto" role="group" aria-label="Lọc dịch vụ">
        <span className="text-xs text-slate-300 flex items-center gap-1 shrink-0">
          <Filter className="w-3.5 h-3.5" aria-hidden="true" /> Phân loại:
        </span>
        {(
          [
            { id: "all", label: "Tất cả dịch vụ" },
            { id: "safe_to_disable", label: "🟢 Khuyên tắt" },
            { id: "caution", label: "🟡 Cần cân nhắc" },
            { id: "keep_default", label: "🔴 Cốt lõi bảo vệ" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilterType(tab.id)}
            aria-pressed={filterType === tab.id}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all focus-visible:ring-2 focus-visible:ring-cyan-400 ${
              filterType === tab.id
                ? "bg-cyan-500/20 text-cyan-200 border border-cyan-500/30"
                : "bg-surface-900/60 text-slate-300 hover:text-slate-100 border border-white/[0.04]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Services List */}
      <div className="rounded-2xl glass-panel overflow-hidden border border-white/[0.06]">
        {isLoading && services.length === 0 ? (
          <div className="p-10 flex items-center justify-center gap-2 text-xs text-slate-300">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Đang đọc trạng thái dịch vụ...
          </div>
        ) : loadError ? (
          <div className="p-10 flex flex-col items-center gap-3 text-xs text-rose-300 text-center">
            <AlertCircle className="w-6 h-6" aria-hidden="true" />
            <span>Không đọc được danh sách dịch vụ: {loadError}</span>
            <button
              onClick={loadServices}
              className="px-3 py-1.5 rounded-lg bg-surface-850 text-slate-100 border border-white/[0.08] hover:bg-surface-800"
            >
              Thử lại
            </button>
          </div>
        ) : filteredServices.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-300">Không có dịch vụ nào trong nhóm này.</div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {filteredServices.map((svc) => {
              const badge = RECOMMENDATION_BADGE[svc.recommendation];
              const isDisabled = svc.startup_type === "Disabled";

              return (
                <div
                  key={svc.name}
                  className="p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-colors hover:bg-white/[0.02]"
                >
                  <div className="min-w-0 space-y-1.5 max-w-2xl">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-slate-100">{svc.display_name}</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-surface-950 border border-white/[0.06] text-slate-300">
                        {svc.name}
                      </span>
                      <span className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded border ${badge.className}`}>
                        {badge.label}
                      </span>
                    </div>
                    <p className="text-xs text-slate-200">{svc.description_vi}</p>
                    <p className="text-[11px] text-slate-300 italic">💡 {svc.impact_vi}</p>
                    {svc.original_startup_type && (
                      <p className="text-[11px] text-cyan-300">
                        Đã thay đổi bởi WinPulse — gốc: {STARTUP_LABEL[svc.original_startup_type]}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                    <div className="text-right text-[11px] font-mono leading-tight">
                      <div className={svc.status === "running" ? "text-emerald-300" : "text-slate-300"}>
                        {svc.status === "running" ? "Đang chạy" : svc.status === "stopped" ? "Đã dừng" : "Đang chuyển"}
                      </div>
                      <div className="text-slate-400">{STARTUP_LABEL[svc.startup_type]}</div>
                    </div>

                    {!svc.can_modify ? (
                      <div
                        className="p-2 rounded-xl bg-surface-900 border border-white/[0.06] text-slate-300 flex items-center gap-1.5 text-xs font-mono"
                        title="Dịch vụ cốt lõi được bảo vệ theo RULE.md"
                      >
                        <Lock className="w-4 h-4 text-rose-400" aria-hidden="true" />
                        <span>Bảo vệ</span>
                      </div>
                    ) : svc.original_startup_type ? (
                      <button
                        onClick={() => setPending({ kind: "restore", service: svc })}
                        disabled={isApplying}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 border border-cyan-500/40 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-cyan-400"
                      >
                        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Hoàn tác</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => setPending({ kind: "disable", services: [svc] })}
                        disabled={isApplying || isDisabled}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium bg-surface-850 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-rose-400"
                      >
                        <Power className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{isDisabled ? "Đã tắt" : "Tắt dịch vụ"}</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={pending !== null}
        title={pending?.kind === "restore" ? "Hoàn tác dịch vụ" : "Tắt dịch vụ Windows"}
        tone={pending?.kind === "restore" ? "info" : "warning"}
        confirmLabel={pending?.kind === "restore" ? "Hoàn tác" : "Tắt dịch vụ"}
        isBusy={isApplying}
        onCancel={() => setPending(null)}
        onConfirm={handleConfirm}
      >
        {pending?.kind === "disable" && (
          <>
            <p>
              Các dịch vụ sau sẽ được đặt startup type <b>Đã tắt (Disabled)</b> và dừng ngay. Giá trị gốc được sao lưu
              để bạn hoàn tác bất cứ lúc nào:
            </p>
            <ul className="space-y-1.5 max-h-48 overflow-y-auto">
              {pending.services.map((s) => (
                <li key={s.name} className="p-2 rounded-lg bg-surface-950/80 border border-white/[0.06]">
                  <div className="font-semibold text-slate-100">{s.display_name}</div>
                  <div className="text-[11px] text-slate-300">{s.impact_vi}</div>
                </li>
              ))}
            </ul>
          </>
        )}
        {pending?.kind === "restore" && pending.service.original_startup_type && (
          <p>
            Khôi phục <b>{pending.service.display_name}</b> về startup type gốc:{" "}
            <b>{STARTUP_LABEL[pending.service.original_startup_type]}</b>.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
};
