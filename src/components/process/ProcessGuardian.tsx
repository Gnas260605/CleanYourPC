import React, { useState, useEffect } from "react";
import { 
  ShieldAlert, 
  Cpu, 
  Leaf, 
  Search, 
  ArrowUpDown, 
  Lock, 
  ShieldCheck,
  RotateCw,
  PowerOff,
  AlertTriangle,
  X,
  Loader2
} from "lucide-react";
import { ProcessInfo } from "@/types";
import { formatBytes } from "@/utils/formatters";
import { 
  fetchProcessList, 
  toggleEcoMode, 
  killProcessTree 
} from "@/services/apiBridge";

interface ProcessGuardianProps {
  onNotify: (msg: string) => void;
}

export const ProcessGuardian: React.FC<ProcessGuardianProps> = ({ onNotify }) => {
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [safetyFilter, setSafetyFilter] = useState<"all" | "safe" | "critical" | "eco">("all");
  const [sortBy, setSortBy] = useState<"memory" | "cpu">("memory");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [confirmKillProc, setConfirmKillProc] = useState<ProcessInfo | null>(null);
  const [isKilling, setIsKilling] = useState(false);

  // Fetch real process list from Windows kernel
  const fetchProcesses = async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    try {
      const realList = await fetchProcessList();
      if (Array.isArray(realList) && realList.length > 0) {
        setProcesses(realList);
        if (isManual) {
          onNotify(`Đã cập nhật ${realList.length} tiến trình thực tế từ Windows API.`);
        }
      }
    } catch (err) {
      console.warn("Lỗi khi tải danh sách tiến trình:", err);
      if (isManual) {
        onNotify("Không thể kết nối đến Native Hardware Engine.");
      }
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

  // Quick Action: Put all safe heavy processes into Eco-Mode
  const handleQuickOptimizeAll = async () => {
    const targets = processes.filter((p) => !p.is_critical && !p.is_eco_mode);
    if (targets.length === 0) {
      onNotify("Tất cả tiến trình an toàn đã ở chế độ Eco-Mode.");
      return;
    }

    let optimizedCount = 0;
    for (const proc of targets) {
      try {
        const ok = await toggleEcoMode(proc.pid, true);
        if (ok) optimizedCount++;
      } catch {
        // Continue with others
      }
    }

    setProcesses((prev) =>
      prev.map((proc) => {
        if (!proc.is_critical && !proc.is_eco_mode) {
          return {
            ...proc,
            is_eco_mode: true,
          };
        }
        return proc;
      })
    );
    onNotify(`Đã kích hoạt Eco-Mode cho ${optimizedCount} ứng dụng an toàn! Giảm áp lực RAM.`);
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
      if (sortBy === "memory") return b.memory_bytes - a.memory_bytes;
      return b.cpu_usage - a.cpu_usage;
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
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium bg-surface-850 hover:bg-surface-800 text-slate-300 hover:text-white border border-white/[0.08] transition-all disabled:opacity-50"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-cyan-400" : ""}`} />
              <span className="hidden sm:inline">Làm mới</span>
            </button>

            {/* Quick Eco-Mode All */}
            <button
              onClick={handleQuickOptimizeAll}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 hover:from-emerald-500/30 hover:to-cyan-500/30 text-emerald-300 border border-emerald-500/40 font-semibold text-xs transition-all shadow-glow-emerald/30 active:scale-95"
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
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm tiến trình theo tên, PID..."
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-surface-900/80 border border-white/[0.08] text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto">
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
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                safetyFilter === filter.key
                  ? "bg-violet-500/20 text-violet-300 border border-violet-500/30"
                  : "bg-surface-900/60 text-slate-400 hover:text-slate-200 border border-white/[0.04]"
              }`}
            >
              {filter.label}
            </button>
          ))}

          {/* Sort By Toggle */}
          <button
            onClick={() => setSortBy((prev) => (prev === "memory" ? "cpu" : "memory"))}
            className="px-3 py-1.5 rounded-lg text-xs font-mono flex items-center gap-1 bg-surface-850 border border-white/[0.08] text-slate-300 hover:text-white"
          >
            <ArrowUpDown className="w-3.5 h-3.5 text-cyan-400" />
            <span>Xếp theo: {sortBy === "memory" ? "RAM MB" : "CPU %"}</span>
          </button>
        </div>
      </div>

      {/* Process Table List */}
      <div className="rounded-2xl glass-panel overflow-hidden border border-white/[0.06]">
        <div className="divide-y divide-white/[0.04]">
          {filteredProcesses.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">
              Không tìm thấy tiến trình nào phù hợp với bộ lọc.
            </div>
          ) : (
            filteredProcesses.map((proc) => {
              const isCritical = proc.is_critical;
              const isEco = proc.is_eco_mode;

              return (
                <div
                  key={proc.pid}
                  className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-colors hover:bg-white/[0.02]"
                >
                  {/* Left: Process Info */}
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div
                      className={`p-2.5 rounded-xl shrink-0 mt-0.5 ${
                        isCritical
                          ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                          : isEco
                          ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30"
                          : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      }`}
                    >
                      {isCritical ? (
                        <Lock className="w-4 h-4" />
                      ) : (
                        <Cpu className="w-4 h-4" />
                      )}
                    </div>

                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-slate-100">
                          {proc.name}
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-surface-950 border border-white/[0.06] text-slate-400">
                          PID: {proc.pid}
                        </span>

                        {/* Critical / Eco Badge */}
                        {isCritical ? (
                          <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/30 flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3 text-rose-400" />
                            Cốt lõi Windows
                          </span>
                        ) : (
                          <span
                            className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                              isEco
                                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                                : "bg-cyan-500/10 text-cyan-400 border-cyan-500/20"
                            }`}
                          >
                            {isEco ? "🌱 Eco-Mode" : "⚡ Đang chạy"}
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-400 truncate max-w-lg">
                        {proc.description || (isCritical ? "Tiến trình hệ thống Windows thiết yếu" : "Ứng dụng người dùng")}
                      </p>
                    </div>
                  </div>

                  {/* Right: Metrics & Actions */}
                  <div className="flex items-center gap-4 shrink-0 self-end sm:self-center">
                    {/* Memory & CPU stats */}
                    <div className="text-right">
                      <div className="font-mono text-sm font-bold text-white">
                        {formatBytes(proc.memory_bytes)}
                      </div>
                      <div className="font-mono text-xs text-cyan-400">
                        {proc.cpu_usage.toFixed(1)}% CPU
                      </div>
                    </div>

                    {/* Actions buttons */}
                    <div className="flex items-center gap-2">
                      {/* Eco Mode Toggle */}
                      <button
                        onClick={() => handleToggleEcoMode(proc)}
                        disabled={isCritical}
                        className={`p-2 rounded-xl text-xs font-medium transition-all ${
                          isCritical
                            ? "bg-surface-900 text-slate-600 border border-white/[0.03] cursor-not-allowed opacity-50"
                            : isEco
                            ? "bg-emerald-500 text-black shadow-glow-emerald font-semibold"
                            : "bg-surface-850 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                        }`}
                        title={
                          isCritical
                            ? "Tiến trình cốt lõi - Cấm áp dụng Eco-Mode"
                            : isEco
                            ? "Tắt Eco-Mode"
                            : "Bật Eco-Mode (tiết kiệm bộ nhớ)"
                        }
                      >
                        <Leaf className="w-4 h-4" />
                      </button>

                      {/* Kill Process Button */}
                      {isCritical ? (
                        <div
                          className="p-2 rounded-xl bg-surface-900 border border-rose-500/20 text-rose-500/40 cursor-not-allowed opacity-60"
                          title="Tiến trình hệ thống cốt lõi - Cấm can thiệp theo RULE.md (Zero-Harm Guarantee)"
                        >
                          <Lock className="w-4 h-4" />
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmKillProc(proc)}
                          className="p-2 rounded-xl bg-surface-850 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 border border-rose-500/30 hover:border-rose-500/50 transition-all"
                          title={`Đóng tiến trình ${proc.name} (kill_process_tree)`}
                        >
                          <PowerOff className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Confirmation Modal for Kill Process Tree */}
      {confirmKillProc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in">
          <div className="w-full max-w-md p-6 rounded-3xl glass-panel border border-rose-500/30 shadow-glow-rose space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-2xl bg-rose-500/10 text-rose-400 border border-rose-500/20">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-lg text-white">
                    Đóng cây tiến trình?
                  </h3>
                  <p className="text-xs text-slate-400">
                    Xác nhận kết thúc an toàn (kill_process_tree)
                  </p>
                </div>
              </div>
              <button
                onClick={() => setConfirmKillProc(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 rounded-xl bg-surface-950/80 border border-white/[0.06] text-xs space-y-2 text-slate-300">
              <div className="flex justify-between">
                <span className="text-slate-400">Tên tiến trình:</span>
                <span className="font-semibold text-white">{confirmKillProc.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">PID:</span>
                <span className="font-mono text-cyan-400">{confirmKillProc.pid}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">RAM đang chiếm:</span>
                <span className="font-mono font-bold text-white">
                  {formatBytes(confirmKillProc.memory_bytes)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">CPU Usage:</span>
                <span className="font-mono text-amber-400">
                  {confirmKillProc.cpu_usage.toFixed(1)}%
                </span>
              </div>
            </div>

            <p className="text-xs text-rose-300">
              ⚠️ Cảnh báo: Mọi tài liệu chưa lưu trong ứng dụng này sẽ bị mất khi tiến trình bị đóng. Bạn có chắc chắn muốn tiếp tục?
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setConfirmKillProc(null)}
                disabled={isKilling}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-surface-850 hover:bg-surface-800 transition-colors"
              >
                Hủy bỏ
              </button>
              <button
                onClick={handleKillProcess}
                disabled={isKilling}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 transition-all shadow-glow-rose disabled:opacity-50"
              >
                {isKilling ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Đang đóng...</span>
                  </>
                ) : (
                  <>
                    <PowerOff className="w-4 h-4" />
                    <span>Đóng tiến trình</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
