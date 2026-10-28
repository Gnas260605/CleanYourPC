import React, { useState, useEffect } from "react";
import { 
  Rocket, 
  Download, 
  Search, 
  Filter, 
  Clock, 
  AlertTriangle, 
  FileCheck,
  RotateCw,
  Loader2,
  AlertCircle
} from "lucide-react";
import { StartupItem } from "@/types";
import { fetchStartupList, toggleStartupItem, backupStartup } from "@/services/apiBridge";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";

type StartupSort = "impact" | "name" | "enabled";
const IMPACT_RANK: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

interface StartupManagerProps {
  onNotify: (msg: string) => void;
  /** Báo danh sách thật cho badge Navbar */
  onItemsChange?: (items: StartupItem[]) => void;
}

export const StartupManager: React.FC<StartupManagerProps> = ({ onNotify, onItemsChange }) => {
  const [items, setItems] = useState<StartupItem[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    if (hasLoaded) onItemsChange?.(items);
  }, [items, hasLoaded, onItemsChange]);
  const [searchQuery, setSearchQuery] = useState("");
  const [impactFilter, setImpactFilter] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupSuccess, setBackupSuccess] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<StartupSort>("impact");
  const [pendingDisable, setPendingDisable] = useState<StartupItem | null>(null);
  const [isToggling, setIsToggling] = useState(false);

  // Fetch real startup items from Windows Registry
  const loadStartupItems = async (isManualRefresh = false) => {
    setIsLoading(true);
    try {
      const realItems = await fetchStartupList();
      const normalized = realItems.map((item) => ({
        ...item,
        location: item.location || "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
        source: item.source || (item.location?.includes("HKLM") ? "HKLM" : "HKCU"),
        // Ước tính thô theo mức tác động (Windows không cung cấp số đo chính xác cho từng mục)
        startupDelaySec: item.startupDelaySec ?? (item.impact === "High" ? 2.5 : item.impact === "Medium" ? 1.2 : 0.3),
      }));
      setItems(normalized);
      setHasLoaded(true);
      setLoadError(null);
      if (isManualRefresh) {
        onNotify(`Đã nạp ${normalized.length} ứng dụng khởi động từ Windows Registry.`);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStartupItems();
  }, []);

  // Tắt cần xác nhận; bật lại thì thực hiện ngay (thao tác khôi phục)
  const requestToggle = (item: StartupItem) => {
    if (item.enabled) setPendingDisable(item);
    else handleToggle(item.id);
  };

  // Toggle item enabled state via Windows StartupApproved Registry flag
  const handleToggle = async (id: string) => {
    const target = items.find((i) => i.id === id);
    if (!target) return;
    const nextState = !target.enabled;

    setIsToggling(true);
    try {
      const success = await toggleStartupItem(
        target.id,
        target.location || "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
        nextState
      );

      if (success) {
        setItems((prev) =>
          prev.map((item) => (item.id === id ? { ...item, enabled: nextState } : item))
        );
        onNotify(
          `${target.name} đã được ${nextState ? "bật lại" : "tắt khởi động cùng Windows"}.`
        );
      } else {
        onNotify(`Không thể đổi trạng thái ${target.name} (Có thể cần quyền Administrator).`);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      onNotify(`Lỗi khi đổi trạng thái ${target.name}: ${errorMsg}`);
    } finally {
      setIsToggling(false);
      setPendingDisable(null);
    }
  };

  // Backup startup configuration to JSON file
  const handleBackup = async () => {
    setIsBackingUp(true);
    try {
      const backupPath = await backupStartup();
      setBackupSuccess(true);
      onNotify(`Đã sao lưu cấu hình Registry Startup thành công tại: ${backupPath}`);
      setTimeout(() => setBackupSuccess(false), 4000);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      onNotify(`Lỗi khi sao lưu Registry Startup: ${errorMsg}`);
    } finally {
      setIsBackingUp(false);
    }
  };

  // Filter items
  const filteredItems = items.filter((item) => {
    const matchesSearch =
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.publisher && item.publisher.toLowerCase().includes(searchQuery.toLowerCase())) ||
      item.command.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesImpact = impactFilter === "all" || item.impact === impactFilter;
    return matchesSearch && matchesImpact;
  }).sort((a, b) => {
    if (sortBy === "name") return a.name.localeCompare(b.name);
    if (sortBy === "enabled") return Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name);
    return (IMPACT_RANK[a.impact] ?? 3) - (IMPACT_RANK[b.impact] ?? 3) || a.name.localeCompare(b.name);
  });

  const enabledCount = items.filter((i) => i.enabled).length;
  const highImpactCount = items.filter((i) => i.enabled && i.impact === "High").length;
  const estimatedDelaySaved = items
    .filter((i) => !i.enabled && i.startupDelaySec)
    .reduce((acc, i) => acc + (i.startupDelaySec || 0), 0);

  return (
    <div className="space-y-6">
      {/* Top Banner & Statistics */}
      <div className="p-6 rounded-3xl glass-panel border border-cyan-500/20 relative overflow-hidden">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="p-1 rounded-lg bg-cyan-500/10 text-cyan-400">
                <Rocket className="w-4 h-4" />
              </span>
              <h2 className="font-display font-bold text-xl text-white">
                Quản lý ứng dụng khởi động (Startup Manager)
              </h2>
            </div>
            <p className="text-xs text-slate-300 max-w-2xl">
              Tắt các ứng dụng không cần thiết để Windows khởi động nhanh hơn. Lệnh gốc trong Registry được giữ nguyên; có thể sao lưu và bật lại bất cứ lúc nào.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Refresh Button */}
            <button
              onClick={() => loadStartupItems(true)}
              disabled={isLoading}
              title="Làm mới danh sách ứng dụng khởi động"
              aria-label="Làm mới danh sách ứng dụng khởi động"
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium bg-surface-850 hover:bg-surface-800 text-slate-300 hover:text-white border border-white/[0.08] transition-all disabled:opacity-50"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin text-cyan-400" : ""}`} />
              <span className="hidden sm:inline">Làm mới</span>
            </button>

            {/* Backup Button - Compliant with RULE.md */}
            <button
              onClick={handleBackup}
              disabled={isBackingUp}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all shadow-sm ${
                backupSuccess
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                  : "bg-surface-850 hover:bg-surface-800 text-cyan-300 hover:text-white border border-cyan-500/30 hover:border-cyan-400"
              }`}
            >
              {isBackingUp ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                  <span>Đang sao lưu...</span>
                </>
              ) : backupSuccess ? (
                <>
                  <FileCheck className="w-4 h-4 text-emerald-400" />
                  <span>Đã sao lưu Registry!</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 text-cyan-400" />
                  <span>Sao lưu cấu hình khởi động</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Mini stats counters */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5 pt-5 border-t border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400">
              <Rocket className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs text-slate-400">Đang bật tự khởi động</div>
              <div className="font-mono text-base font-bold text-white">
                {isLoading ? "..." : `${enabledCount} / ${items.length}`} ứng dụng
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-rose-500/10 text-rose-400">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs text-slate-400">Tác động nặng (High Impact)</div>
              <div className="font-mono text-base font-bold text-rose-400">
                {isLoading ? "..." : highImpactCount} ứng dụng
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs text-slate-400">Boot nhanh hơn (ước tính)</div>
              <div className="font-mono text-base font-bold text-emerald-400">
                ~{estimatedDelaySaved.toFixed(1)} giây
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm tên ứng dụng, đường dẫn lệnh..."
            aria-label="Tìm ứng dụng khởi động"
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-surface-900/80 border border-white/[0.08] text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
          <span className="text-xs text-slate-400 flex items-center gap-1 shrink-0">
            <Filter className="w-3.5 h-3.5" /> Lọc tác động:
          </span>
          {(["all", "High", "Medium", "Low"] as const).map((impact) => (
            <button
              key={impact}
              onClick={() => setImpactFilter(impact)}
              aria-pressed={impactFilter === impact}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-all ${
                impactFilter === impact
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm"
                  : "bg-surface-900/60 text-slate-400 hover:text-slate-200 border border-white/[0.04]"
              }`}
            >
              {impact === "all" ? "Tất cả" : impact}
            </button>
          ))}
          <label className="flex items-center gap-1.5 text-xs text-slate-300 shrink-0 ml-1">
            <span>Xếp theo</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as StartupSort)}
              className="px-2 py-1.5 rounded-lg bg-surface-850 border border-white/[0.08] text-xs text-slate-100"
            >
              <option value="impact">Mức tác động</option>
              <option value="name">Tên</option>
              <option value="enabled">Đang bật trước</option>
            </select>
          </label>
        </div>
      </div>

      {/* Startup Items List */}
      <div className="rounded-2xl glass-panel overflow-hidden border border-white/[0.06]">
        {isLoading && !hasLoaded ? (
          <div className="p-12 text-center text-slate-300 flex flex-col items-center justify-center gap-3" role="status">
            <Loader2 className="w-6 h-6 animate-spin text-cyan-400" aria-hidden="true" />
            <span className="text-xs">Đang quét danh sách Registry Startup...</span>
          </div>
        ) : loadError && !hasLoaded ? (
          <div className="p-10 flex flex-col items-center gap-3 text-xs text-rose-300 text-center">
            <AlertCircle className="w-6 h-6" aria-hidden="true" />
            <span>Không đọc được danh sách khởi động: {loadError}</span>
            <button
              onClick={() => loadStartupItems(true)}
              className="px-3 py-1.5 rounded-lg bg-surface-850 text-slate-100 border border-white/[0.08] hover:bg-surface-800"
            >
              Thử lại
            </button>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {filteredItems.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                Không tìm thấy ứng dụng khởi động nào phù hợp với bộ lọc.
              </div>
            ) : (
              filteredItems.map((item) => {
                const isHigh = item.impact === "High";
                const isMedium = item.impact === "Medium";

                return (
                  <div
                    key={item.id}
                    className={`p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-colors hover:bg-white/[0.02] ${
                      !item.enabled ? "opacity-60" : ""
                    }`}
                  >
                    {/* Left info */}
                    <div className="flex items-start gap-3.5 min-w-0">
                      <div
                        className={`p-2.5 rounded-xl shrink-0 mt-0.5 ${
                          item.enabled
                            ? isHigh
                              ? "bg-rose-500/10 text-rose-400"
                              : isMedium
                              ? "bg-amber-500/10 text-amber-400"
                              : "bg-cyan-500/10 text-cyan-400"
                            : "bg-slate-800 text-slate-400"
                        }`}
                      >
                        <Rocket className="w-4 h-4" />
                      </div>

                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-slate-100">
                            {item.name}
                          </span>
                          <span 
                            className="text-[10px] font-mono px-2 py-0.5 rounded bg-surface-950 border border-white/[0.06] text-slate-400"
                            title={item.location}
                          >
                            {item.source || "Registry"}
                          </span>
                          <span
                            className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded border ${
                              isHigh
                                ? "bg-rose-500/15 text-rose-400 border-rose-500/30"
                                : isMedium
                                ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                                : "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                            }`}
                          >
                            {item.impact} Impact
                          </span>
                        </div>

                        {item.publisher && (
                          <p className="text-xs text-slate-400">
                            {item.publisher}
                          </p>
                        )}

                        <p
                          className="text-[11px] font-mono text-slate-400 truncate max-w-lg"
                          title={item.command}
                        >
                          {item.command}
                        </p>
                      </div>
                    </div>

                    {/* Right Switch Toggle */}
                    <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                      <span className="text-xs font-mono text-slate-400">
                        {item.enabled ? "Đang chạy cùng Windows" : "Đã tắt"}
                      </span>
                      <button
                        role="switch"
                        aria-checked={item.enabled}
                        aria-label={`Khởi động ${item.name} cùng Windows`}
                        disabled={isToggling}
                        onClick={() => requestToggle(item)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          item.enabled ? "bg-cyan-500 shadow-glow-cyan" : "bg-slate-700"
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                            item.enabled ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={pendingDisable !== null}
        title="Tắt khởi động cùng Windows"
        tone="warning"
        confirmLabel="Tắt khởi động"
        isBusy={isToggling}
        onCancel={() => setPendingDisable(null)}
        onConfirm={() => pendingDisable && handleToggle(pendingDisable.id)}
      >
        {pendingDisable && (
          <>
            <p>
              <b className="text-white">{pendingDisable.name}</b> sẽ không tự chạy khi đăng nhập Windows. Lệnh gốc trong
              Registry được giữ nguyên (chỉ đổi cờ StartupApproved) — có thể bật lại bất cứ lúc nào.
            </p>
            <p className="text-[11px] font-mono text-slate-300 break-all">{pendingDisable.command}</p>
            <p className="text-amber-200">
              Ứng dụng như phần mềm diệt virus, driver âm thanh/touchpad hay đồng bộ đám mây có thể cần chạy cùng Windows.
            </p>
          </>
        )}
      </ConfirmDialog>
    </div>
  );
};
