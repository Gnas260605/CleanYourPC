import React, { useEffect, useMemo, useRef, useState } from "react";
import { HardDrive, Play, Square, Loader2, CheckSquare, Square as SquareIcon, Trash2, AlertCircle } from "lucide-react";
import { DiskScanComplete, DiskScanProgress, FolderSafety, LargeFolderItem } from "@/types";
import { formatBytes } from "@/utils/formatters";
import { isTauriContext } from "@/hooks/useHardwareMetrics";
import {
  cancelLargeFolderScan,
  onDiskScanComplete,
  onDiskScanProgress,
  openDiskItemInExplorer,
  recycleLargeFolderItems,
  startLargeFolderScan,
} from "@/services/apiBridge";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { DiskItemDetail } from "./DiskItemDetail";
import { SAFETY_META, SAFETY_ORDER } from "./safetyMeta";

interface DiskAnalyzerProps {
  onNotify: (msg: string) => void;
}

const THRESHOLDS_MB = [100, 250, 500, 1000, 2000];

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Tab "Phân tích ổ đĩa": tìm thư mục chiếm nhiều dung lượng, giải thích nó là gì,
 * và chỉ cho phép chuyển vào Thùng rác các mục 🟢/🟡 (backend kiểm tra lại trước khi xóa).
 */
export const DiskAnalyzer: React.FC<DiskAnalyzerProps> = ({ onNotify }) => {
  const [useDefaultRoots, setUseDefaultRoots] = useState(true);
  const [customRoot, setCustomRoot] = useState("");
  const [minSizeMb, setMinSizeMb] = useState(500);
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState<DiskScanProgress | null>(null);
  const [result, setResult] = useState<DiskScanComplete | null>(null);
  const [filter, setFilter] = useState<FolderSafety | "all">("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingRecycle, setPendingRecycle] = useState<LargeFolderItem[] | null>(null);
  const [isRecycling, setIsRecycling] = useState(false);

  // onNotify từ App không ổn định giữa các lần render → giữ trong ref để chỉ đăng ký sự kiện một lần
  const notifyRef = useRef(onNotify);
  notifyRef.current = onNotify;

  // Nhận tiến độ & kết quả từ backend
  useEffect(() => {
    const onNotify = (msg: string) => notifyRef.current(msg);
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    Promise.all([
      onDiskScanProgress((p) => setProgress(p)),
      onDiskScanComplete((done) => {
        setIsScanning(false);
        setProgress(null);
        setResult(done);
        setSelectedIds(new Set());
        setActiveId(done.items[0]?.id ?? null);
        if (done.error) {
          onNotify(`Lỗi khi lưu kết quả quét: ${done.error}`);
        } else if (done.cancelled) {
          onNotify(`Đã hủy quét — hiển thị ${done.items.length} mục tìm được đến lúc hủy.`);
        } else {
          onNotify(`Quét xong trong ${(done.elapsed_ms / 1000).toFixed(1)} giây: ${done.items.length} mục lớn.`);
        }
      }),
    ]).then((fns) => {
      if (disposed) fns.forEach((f) => f());
      else unlisteners.push(...fns);
    });
    return () => {
      disposed = true;
      unlisteners.forEach((f) => f());
    };
  }, []);

  const items = result?.items ?? [];
  const counts = useMemo(() => {
    const c: Record<FolderSafety, number> = { Safe: 0, Caution: 0, UseTool: 0, Keep: 0, Unknown: 0 };
    items.forEach((i) => c[i.safety]++);
    return c;
  }, [items]);
  const visible = items.filter((i) => filter === "all" || i.safety === filter);
  const activeItem = items.find((i) => i.id === activeId) ?? null;
  const selectedItems = items.filter((i) => selectedIds.has(i.id) && i.action === "recycle");
  const selectedBytes = selectedItems.reduce((acc, i) => acc + i.size_bytes, 0);
  const barBase = result?.volume_total_bytes || Math.max(1, ...items.map((i) => i.size_bytes));

  const handleStart = async () => {
    const roots = useDefaultRoots ? undefined : [customRoot.trim()];
    if (!useDefaultRoots && !customRoot.trim()) {
      onNotify("Nhập đường dẫn thư mục cần quét, ví dụ D:\\");
      return;
    }
    setIsScanning(true);
    setProgress(null);
    try {
      await startLargeFolderScan(roots, minSizeMb);
    } catch (err) {
      setIsScanning(false);
      onNotify(`Không thể bắt đầu quét: ${errorText(err)}`);
    }
  };

  const handleCancel = async () => {
    try {
      await cancelLargeFolderScan();
    } catch (err) {
      onNotify(`Không thể hủy: ${errorText(err)}`);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleOpen = async (item: LargeFolderItem) => {
    if (!result) return;
    try {
      await openDiskItemInExplorer(result.scan_id, item.id);
    } catch (err) {
      onNotify(`Không mở được Explorer: ${errorText(err)}`);
    }
  };

  const handleConfirmRecycle = async () => {
    if (!result || !pendingRecycle) return;
    setIsRecycling(true);
    try {
      const res = await recycleLargeFolderItems(
        result.scan_id,
        pendingRecycle.map((i) => i.id)
      );
      const gone = new Set(res.recycled_ids);
      setResult((prev) => (prev ? { ...prev, items: prev.items.filter((i) => !gone.has(i.id)) } : prev));
      setSelectedIds((prev) => new Set([...prev].filter((id) => !gone.has(id))));
      if (activeId && gone.has(activeId)) setActiveId(null);
      onNotify(
        res.failed_count > 0
          ? `Đã chuyển ${res.recycled_count} mục (${formatBytes(res.recycled_bytes)}) vào Thùng rác; ${res.failed_count} mục lỗi: ${res.errors[0] ?? ""}`
          : `Đã chuyển ${res.recycled_count} mục (${formatBytes(res.recycled_bytes)}) vào Thùng rác. Có thể khôi phục từ Thùng rác.`
      );
    } catch (err) {
      onNotify(`Không thể xóa: ${errorText(err)}`);
    } finally {
      setIsRecycling(false);
      setPendingRecycle(null);
    }
  };

  if (!isTauriContext()) {
    return (
      <div className="p-10 rounded-2xl glass-panel border border-white/[0.08] text-center text-sm text-slate-200">
        Phân tích ổ đĩa chỉ khả dụng trong ứng dụng desktop WinPulse.
      </div>
    );
  }

  const cautionPending = pendingRecycle?.filter((i) => i.safety === "Caution") ?? [];
  const pendingBytes = pendingRecycle?.reduce((acc, i) => acc + i.size_bytes, 0) ?? 0;

  return (
    <div className="space-y-6">
      {/* Banner & điều khiển quét */}
      <div className="p-6 rounded-3xl glass-panel border border-sky-500/20 space-y-5">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="p-1 rounded-lg bg-sky-500/10 text-sky-300">
              <HardDrive className="w-4 h-4" aria-hidden="true" />
            </span>
            <h2 className="font-display font-bold text-xl text-white">Phân tích ổ đĩa</h2>
          </div>
          <p className="text-xs text-slate-200 max-w-3xl">
            Tìm thư mục chiếm nhiều dung lượng và giải thích nó là gì. Mặc định không xóa gì; chỉ mục 🟢/🟡 mới có nút
            "Chuyển vào Thùng rác" và luôn có hộp thoại xác nhận.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_auto] gap-3 items-end">
          <fieldset className="space-y-2">
            <legend className="text-[11px] font-semibold text-slate-200 mb-1">Phạm vi quét</legend>
            <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
              <input
                type="radio"
                name="disk-roots"
                checked={useDefaultRoots}
                onChange={() => setUseDefaultRoots(true)}
                disabled={isScanning}
              />
              Thư mục mặc định (hồ sơ người dùng, AppData, ProgramData, Windows Update, Windows.old)
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
              <input
                type="radio"
                name="disk-roots"
                checked={!useDefaultRoots}
                onChange={() => setUseDefaultRoots(false)}
                disabled={isScanning}
              />
              Thư mục khác:
              <input
                type="text"
                value={customRoot}
                onChange={(e) => {
                  setCustomRoot(e.target.value);
                  setUseDefaultRoots(false);
                }}
                placeholder="D:\\"
                aria-label="Đường dẫn thư mục cần quét"
                disabled={isScanning}
                className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-surface-950 border border-white/[0.1] text-xs font-mono text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 select-text"
              />
            </label>
          </fieldset>

          <label className="text-[11px] font-semibold text-slate-200 space-y-1">
            <span className="block">Chỉ hiện mục từ</span>
            <select
              value={minSizeMb}
              onChange={(e) => setMinSizeMb(Number(e.target.value))}
              disabled={isScanning}
              className="px-2.5 py-2 rounded-lg bg-surface-950 border border-white/[0.1] text-xs text-slate-100 focus-visible:ring-2 focus-visible:ring-sky-400"
            >
              {THRESHOLDS_MB.map((mb) => (
                <option key={mb} value={mb}>
                  {mb >= 1000 ? `${mb / 1000} GB` : `${mb} MB`}
                </option>
              ))}
            </select>
          </label>

          {isScanning ? (
            <button
              onClick={handleCancel}
              className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 text-xs font-semibold focus-visible:ring-2 focus-visible:ring-rose-400"
            >
              <Square className="w-4 h-4" aria-hidden="true" /> Hủy quét
            </button>
          ) : (
            <button
              onClick={handleStart}
              className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-100 border border-sky-500/40 text-xs font-semibold focus-visible:ring-2 focus-visible:ring-sky-400"
            >
              <Play className="w-4 h-4" aria-hidden="true" /> {result ? "Quét lại" : "Bắt đầu quét"}
            </button>
          )}
        </div>

        {isScanning && (
          <div className="space-y-2" role="status" aria-live="polite">
            <div className="h-1.5 rounded-full bg-surface-900 overflow-hidden">
              <div className="h-full w-1/3 bg-sky-400 rounded-full animate-indeterminate" />
            </div>
            <div className="flex items-center gap-2 text-[11px] text-slate-200">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden="true" />
              <span className="font-mono">
                {progress
                  ? `${progress.dirs_scanned.toLocaleString("vi-VN")} thư mục • ${formatBytes(progress.bytes_counted)}`
                  : "Đang bắt đầu..."}
              </span>
              {progress && (
                <span className="truncate text-slate-400 font-mono" title={progress.current_path}>
                  {progress.current_path}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {result && (
        <>
          {/* Bộ lọc theo mức an toàn */}
          <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="Lọc theo mức an toàn">
            <button
              onClick={() => setFilter("all")}
              aria-pressed={filter === "all"}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border focus-visible:ring-2 focus-visible:ring-sky-400 ${
                filter === "all" ? "bg-sky-500/20 text-sky-100 border-sky-500/40" : "bg-surface-900/60 text-slate-200 border-white/[0.06]"
              }`}
            >
              Tất cả ({items.length})
            </button>
            {SAFETY_ORDER.map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                aria-pressed={filter === s}
                title={SAFETY_META[s].hint}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border focus-visible:ring-2 focus-visible:ring-sky-400 ${
                  filter === s ? SAFETY_META[s].badge : "bg-surface-900/60 text-slate-200 border-white/[0.06]"
                }`}
              >
                {SAFETY_META[s].emoji} {SAFETY_META[s].label} ({counts[s]})
              </button>
            ))}
            <span className="ml-auto text-[11px] text-slate-300 font-mono">
              {result.dirs_scanned.toLocaleString("vi-VN")} thư mục • {(result.elapsed_ms / 1000).toFixed(1)} giây
            </span>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
            {/* Danh sách */}
            <div className="rounded-2xl glass-panel overflow-hidden border border-white/[0.06]">
              <div className="p-3 bg-surface-900/80 border-b border-white/[0.06] flex items-center justify-between gap-3 flex-wrap">
                <span className="text-xs text-slate-200 font-mono">
                  Đã chọn: {selectedItems.length} mục ({formatBytes(selectedBytes)})
                </span>
                <button
                  onClick={() => setPendingRecycle(selectedItems)}
                  disabled={selectedItems.length === 0 || isRecycling}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-100 border border-emerald-500/40 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-emerald-400"
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" /> Chuyển vào Thùng rác
                </button>
              </div>

              {visible.length === 0 ? (
                <div className="p-10 text-center text-xs text-slate-300">
                  {items.length === 0
                    ? `Không có thư mục nào lớn hơn ${minSizeMb} MB trong phạm vi đã quét.`
                    : "Không có mục nào trong nhóm này."}
                </div>
              ) : (
                <ul className="divide-y divide-white/[0.04] max-h-[560px] overflow-y-auto">
                  {visible.map((item) => {
                    const meta = SAFETY_META[item.safety];
                    const canSelect = item.action === "recycle";
                    const isActive = item.id === activeId;
                    const pct = Math.min(100, (item.size_bytes / barBase) * 100);
                    return (
                      <li
                        key={item.id}
                        className={`p-3 flex items-start gap-3 transition-colors ${
                          isActive ? "bg-sky-500/[0.07]" : "hover:bg-white/[0.02]"
                        }`}
                      >
                        {canSelect ? (
                          <button
                            onClick={() => toggleSelect(item.id)}
                            aria-label={`${selectedIds.has(item.id) ? "Bỏ chọn" : "Chọn"} ${item.title}`}
                            aria-pressed={selectedIds.has(item.id)}
                            className="pt-0.5 shrink-0 rounded focus-visible:ring-2 focus-visible:ring-sky-400"
                          >
                            {selectedIds.has(item.id) ? (
                              <CheckSquare className="w-4 h-4 text-emerald-300" />
                            ) : (
                              <SquareIcon className="w-4 h-4 text-slate-400" />
                            )}
                          </button>
                        ) : (
                          <span className="w-4 shrink-0" aria-hidden="true" />
                        )}
                        <button
                          onClick={() => setActiveId(item.id)}
                          className="flex-1 min-w-0 text-left space-y-1 rounded focus-visible:ring-2 focus-visible:ring-sky-400"
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${meta.badge}`}>
                              {meta.emoji} {meta.label}
                            </span>
                            <span className="text-xs font-semibold text-slate-100 truncate">{item.title}</span>
                          </div>
                          <p className="text-[11px] font-mono text-slate-300 truncate" title={item.path}>
                            {item.path}
                          </p>
                          <div className="h-1.5 rounded-full bg-surface-950 overflow-hidden" aria-hidden="true">
                            <div className={`h-full rounded-full ${meta.bar}`} style={{ width: `${Math.max(pct, 0.5)}%` }} />
                          </div>
                        </button>
                        <span className="text-xs font-mono font-bold text-slate-100 shrink-0">
                          {formatBytes(item.size_bytes)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Chi tiết */}
            {activeItem ? (
              <DiskItemDetail
                item={activeItem}
                isBusy={isRecycling}
                onOpenInExplorer={handleOpen}
                onRecycle={(item) => setPendingRecycle([item])}
              />
            ) : (
              <div className="p-6 rounded-2xl glass-panel border border-white/[0.06] text-xs text-slate-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" aria-hidden="true" /> Chọn một mục để xem giải thích chi tiết.
              </div>
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        isOpen={pendingRecycle !== null && pendingRecycle.length > 0}
        title="Chuyển vào Thùng rác"
        tone={cautionPending.length > 0 ? "warning" : "info"}
        confirmLabel={`Chuyển ${pendingRecycle?.length ?? 0} mục vào Thùng rác`}
        isBusy={isRecycling}
        onCancel={() => setPendingRecycle(null)}
        onConfirm={handleConfirmRecycle}
      >
        <p>
          Tổng dung lượng: <b className="text-white">{formatBytes(pendingBytes)}</b>. Các mục được chuyển vào Thùng rác
          và có thể khôi phục. Nếu mục quá lớn so với Thùng rác, Windows sẽ hỏi lại trước khi xóa vĩnh viễn.
        </p>
        <ul className="space-y-1.5 max-h-56 overflow-y-auto">
          {pendingRecycle?.map((i) => (
            <li key={i.id} className="p-2 rounded-lg bg-surface-950/80 border border-white/[0.06]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-100">
                  {SAFETY_META[i.safety].emoji} {i.title}
                </span>
                <span className="font-mono text-slate-200 shrink-0">{formatBytes(i.size_bytes)}</span>
              </div>
              <div className="text-[11px] font-mono text-slate-300 truncate" title={i.path}>
                {i.path}
              </div>
              {i.safety === "Caution" && <div className="text-[11px] text-amber-200 mt-0.5">⚠ {i.consequence}</div>}
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    </div>
  );
};
