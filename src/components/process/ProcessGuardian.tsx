import React, { useState, useEffect } from "react";
import { ShieldAlert, Leaf, Search, RotateCw, AlertCircle } from "lucide-react";
import { ProcessInfo } from "@/types";
import { formatBytes } from "@/utils/formatters";
import { 
  fetchProcessList, 
  toggleEcoMode, 
  killProcessTree 
} from "@/services/apiBridge";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ProcessRow } from "./ProcessRow";

type SortKey = "memory" | "cpu" | "name" | "pid";

interface ProcessGuardianProps {
  onNotify: (msg: string) => void;
  /** Báo danh sách thật cho badge Navbar */
  onProcessesChange?: (list: ProcessInfo[]) => void;
}

export const ProcessGuardian: React.FC<ProcessGuardianProps> = ({ onNotify, onProcessesChange }) => {
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    if (hasLoaded) onProcessesChange?.(processes);
  }, [processes, hasLoaded, onProcessesChange]);
  const [searchQuery, setSearchQuery] = useState("");
  const [safetyFilter, setSafetyFilter] = useState<"all" | "safe" | "critical" | "eco">("all");
  const [sortBy, setSortBy] = useState<SortKey>("memory");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmKillProc, setConfirmKillProc] = useState<ProcessInfo | null>(null);
  const [isKilling, setIsKilling] = useState(false);
  const [confirmEcoAll, setConfirmEcoAll] = useState(false);
  const [isApplyingEcoAll, setIsApplyingEcoAll] = useState(false);

  // Fetch real process list from Windows kernel
  const fetchProcesses = async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    try {
      const realList = await fetchProcessList();
      setProcesses(realList);
      setHasLoaded(true);
      setLoadError(null);
      if (isManual) {
        onNotify(`Đã cập nhật ${realList.length} tiến trình thực tế từ Windows API.`);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      if (isManual) setIsRefreshing(false);
    }
  };

  // Auto-refresh process list every 3s
  useEffect(() => {
    fetchProcesses();
    const interval = setInterval(() => {
      fetchProcesses();
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Toggle Eco-Mode for process via Windows 11 EcoQoS API
  const handleToggleEcoMode = async (proc: ProcessInfo) => {
    if (proc.is_critical) {
      onNotify(`Tiến trình ${proc.name} là cốt lõi hệ thống, không thể can thiệp!`);
      return;
    }

    const nextState = !proc.is_eco_mode;
    try {
      const success = await toggleEcoMode(proc.pid, nextState);
      if (success) {
        setProcesses((prev) =>
          prev.map((p) =>
            p.pid === proc.pid
              ? {
                  ...p,
                  is_eco_mode: nextState,
                }
              : p
          )
        );
        onNotify(
          `${proc.name} (PID: ${proc.pid}) đã được ${
            nextState ? "chuyển sang Windows 11 Eco-Mode (EcoQoS)" : "phục hồi chế độ bình thường"
          }.`
        );
      } else {
        onNotify(`Không thể áp dụng Eco-Mode cho ${proc.name} (Quyền hạn chế hoặc tiến trình đã thoát).`);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      onNotify(`Lỗi khi chuyển Eco-Mode cho ${proc.name}: ${errorMsg}`);
    }
  };

  // Terminate process tree via Win32 API
  const handleKillProcess = async () => {
    if (!confirmKillProc) return;
    if (confirmKillProc.is_critical) {
      onNotify(`🛑 BẢO VỆ AN TOÀN: Tuyệt đối cấm kết thúc tiến trình cốt lõi ${confirmKillProc.name}!`);
      setConfirmKillProc(null);
      return;
    }

    setIsKilling(true);
    try {
      const success = await killProcessTree(confirmKillProc.pid);
      if (success) {
        setProcesses((prev) => prev.filter((p) => p.pid !== confirmKillProc.pid));
        onNotify(
          `Đã kết thúc thành công cây tiến trình ${confirmKillProc.name} (PID: ${confirmKillProc.pid}).`
        );
      } else {
        onNotify(`Không thể kết thúc tiến trình ${confirmKillProc.name} (Có thể cần quyền Administrator).`);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      onNotify(`Lỗi khi kết thúc tiến trình ${confirmKillProc.name}: ${errorMsg}`);
    } finally {
      setIsKilling(false);
      setConfirmKillProc(null);
    }
  };

  // Bật Eco-Mode cho mọi tiến trình không cốt lõi — chỉ đánh dấu những tiến trình thực sự thành công
  const ecoAllTargets = processes.filter((p) => !p.is_critical && !p.is_eco_mode);
  const handleQuickOptimizeAll = async () => {
    setIsApplyingEcoAll(true);
    const succeeded = new Set<number>();
    for (const proc of ecoAllTargets) {
      try {
        if (await toggleEcoMode(proc.pid, true)) succeeded.add(proc.pid);
      } catch {
        // Tiếp tục với tiến trình khác (tiến trình có thể đã thoát hoặc thiếu quyền)
      }
    }
    setProcesses((prev) => prev.map((p) => (succeeded.has(p.pid) ? { ...p, is_eco_mode: true } : p)));
    const failed = ecoAllTargets.length - succeeded.size;
    onNotify(
      failed > 0
        ? `Đã bật Eco-Mode cho ${succeeded.size} tiến trình; ${failed} tiến trình bỏ qua (đã thoát hoặc thiếu quyền).`
        : `Đã bật Eco-Mode cho ${succeeded.size} tiến trình.`
    );
    setIsApplyingEcoAll(false);
    setConfirmEcoAll(false);
  };

  // Filter & Sort
  const filteredProcesses = processes
    .filter((proc) => {
      const matchesSearch =
        proc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(proc.pid).includes(searchQuery) ||
        (proc.description && proc.description.toLowerCase().includes(searchQuery.toLowerCase()));

      let matchesSafety = true;
      if (safetyFilter === "safe") matchesSafety = !proc.is_critical;
      if (safetyFilter === "critical") matchesSafety = proc.is_critical;
      if (safetyFilter === "eco") matchesSafety = proc.is_eco_mode;

      return matchesSearch && matchesSafety;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "memory":
          return b.memory_bytes - a.memory_bytes;
        case "cpu":
          return b.cpu_usage - a.cpu_usage;
        case "name":
          return a.name.localeCompare(b.name);
        case "pid":
          return a.pid - b.pid;
      }
    });

  const totalSafeMemory = processes
    .filter((p) => !p.is_critical)
    .reduce((acc, p) => acc + p.memory_bytes, 0);

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="p-6 rounded-3xl glass-panel border border-violet-500/20 relative overflow-hidden">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="p-1 rounded-lg bg-violet-500/10 text-violet-400">
                <ShieldAlert className="w-4 h-4" />
              </span>
              <h2 className="font-display font-bold text-xl text-white">
                Process Guardian & Quản trị tiến trình
              </h2>
            </div>
            <p className="text-xs text-slate-300 max-w-2xl">
              Giám sát tài nguyên thời gian thực (tự động cập nhật 3s). Hỗ trợ đặt Eco-Mode tiết kiệm RAM và đóng tiến trình treo an toàn theo quy chuẩn RULE.md Zero-Harm. Có thể tối ưu an toàn tới{" "}
              <span className="font-bold text-cyan-300">{formatBytes(totalSafeMemory)}</span>.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Refresh Button */}
            <button
              onClick={() => fetchProcesses(true)}
              disabled={isRefreshing}
              title="Làm mới danh sách tiến trình"
              aria-label="Làm mới danh sách tiến trình"
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium bg-surface-850 hover:bg-surface-800 text-slate-300 hover:text-white border border-white/[0.08] transition-all disabled:opacity-50"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-cyan-400" : ""}`} />
              <span className="hidden sm:inline">Làm mới</span>
            </button>

            {/* Quick Eco-Mode All */}
            <button
              onClick={() => setConfirmEcoAll(true)}
              disabled={ecoAllTargets.length === 0}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 hover:from-emerald-500/30 hover:to-cyan-500/30 text-emerald-300 border border-emerald-500/40 font-semibold text-xs transition-all shadow-glow-emerald/30 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Leaf className="w-4 h-4 text-emerald-400" />
              <span>Eco-Mode Toàn Bộ App An Toàn</span>
            </button>
          </div>
        </div>

        {/* Safety Legend Pills */}
        <div className="flex items-center gap-4 mt-5 pt-5 border-t border-white/[0.06] text-xs flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-glow-emerald" />
            <span className="text-slate-300">Ứng dụng bên thứ ba (Safe to Kill / Eco-Mode)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-500 shadow-glow-cyan" />
            <span className="text-slate-300">Đang bật Eco-Mode (Tiết kiệm bộ nhớ)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-glow-rose" />
            <span className="text-slate-300">Cốt lõi Windows (System Critical - Khóa bảo vệ)</span>
          </div>
        </div>
      </div>

      {/* Filter and Sort Toolbar */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm tiến trình theo tên, PID..."
            aria-label="Tìm tiến trình"
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-surface-900/80 border border-white/[0.08] text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
          {/* Safety Filter */}
          {(
            [
              { key: "all", label: "Tất cả" },
              { key: "safe", label: "Bên thứ ba" },
              { key: "critical", label: "Cốt lõi hệ thống" },
              { key: "eco", label: "Eco-Mode" },
            ] as const
          ).map((filter) => (
            <button
              key={filter.key}
              onClick={() => setSafetyFilter(filter.key)}
              aria-pressed={safetyFilter === filter.key}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-all ${
                safetyFilter === filter.key
                  ? "bg-violet-500/20 text-violet-300 border border-violet-500/30"
                  : "bg-surface-900/60 text-slate-400 hover:text-slate-200 border border-white/[0.04]"
              }`}
            >
              {filter.label}
            </button>
          ))}

          {/* Sắp xếp */}
          <label className="flex items-center gap-1.5 text-xs text-slate-300 shrink-0">
            <span>Xếp theo</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="px-2 py-1.5 rounded-lg bg-surface-850 border border-white/[0.08] text-xs text-slate-100"
            >
              <option value="memory">RAM</option>
              <option value="cpu">CPU %</option>
              <option value="name">Tên</option>
              <option value="pid">PID</option>
            </select>
          </label>
        </div>
      </div>

      {/* Process Table List */}
      <div className="rounded-2xl glass-panel overflow-hidden border border-white/[0.06]">
        {!hasLoaded && !loadError ? (
          <ul className="divide-y divide-white/[0.04]" aria-busy="true" aria-label="Đang tải danh sách tiến trình">
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="p-4 flex items-center gap-4">
                <div className="w-9 h-9 rounded-xl bg-surface-800 animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-40 rounded bg-surface-800 animate-pulse" />
                  <div className="h-2.5 w-64 rounded bg-surface-850 animate-pulse" />
                </div>
              </li>
            ))}
          </ul>
        ) : loadError && processes.length === 0 ? (
          <div className="p-10 flex flex-col items-center gap-3 text-xs text-rose-300 text-center">
            <AlertCircle className="w-6 h-6" aria-hidden="true" />
            <span>Không đọc được danh sách tiến trình: {loadError}</span>
            <button
              onClick={() => fetchProcesses(true)}
              className="px-3 py-1.5 rounded-lg bg-surface-850 text-slate-100 border border-white/[0.08] hover:bg-surface-800"
            >
              Thử lại
            </button>
          </div>
        ) : filteredProcesses.length === 0 ? (
          <div className="p-8 text-center text-slate-300 text-xs">Không tìm thấy tiến trình nào phù hợp với bộ lọc.</div>
        ) : (
          <ul className="divide-y divide-white/[0.04]">
            {filteredProcesses.map((proc) => (
              <ProcessRow
                key={proc.pid}
                proc={proc}
                onToggleEco={handleToggleEcoMode}
                onRequestKill={setConfirmKillProc}
              />
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirmKillProc !== null}
        title="Đóng cây tiến trình?"
        tone="danger"
        confirmLabel="Đóng tiến trình"
        isBusy={isKilling}
        onCancel={() => setConfirmKillProc(null)}
        onConfirm={handleKillProcess}
      >
        {confirmKillProc && (
          <>
            <dl className="p-3 rounded-xl bg-surface-950/80 border border-white/[0.06] space-y-1.5">
              <div className="flex justify-between gap-2">
                <dt className="text-slate-300">Tên tiến trình</dt>
                <dd className="font-semibold text-white">{confirmKillProc.name}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-300">PID</dt>
                <dd className="font-mono text-cyan-300">{confirmKillProc.pid}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-300">RAM đang dùng</dt>
                <dd className="font-mono font-bold text-white">{formatBytes(confirmKillProc.memory_bytes)}</dd>
              </div>
            </dl>
            <p className="text-rose-200">
              ⚠️ Tiến trình và mọi tiến trình con sẽ bị đóng ngay. Tài liệu chưa lưu trong ứng dụng này sẽ bị mất.
            </p>
          </>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        isOpen={confirmEcoAll}
        title="Bật Eco-Mode hàng loạt"
        tone="warning"
        confirmLabel={`Bật Eco-Mode cho ${ecoAllTargets.length} tiến trình`}
        isBusy={isApplyingEcoAll}
        onCancel={() => setConfirmEcoAll(false)}
        onConfirm={handleQuickOptimizeAll}
      >
        <p>
          Windows sẽ ưu tiên tiết kiệm năng lượng cho <b className="text-white">{ecoAllTargets.length}</b> tiến trình không
          cốt lõi (EcoQoS). Ứng dụng đang dùng có thể chạy chậm hơn — tắt lại từng tiến trình bằng nút 🌱.
        </p>
      </ConfirmDialog>
    </div>
  );
};
