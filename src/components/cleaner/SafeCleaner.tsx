import React, { useEffect, useState } from "react";
import { Trash2, CheckSquare, Square, RotateCw, Save, Loader2, CheckCircle2, Lock, AlertCircle } from "lucide-react";
import { CleanableItem, CleanResult, CleanerCategory } from "@/types";
import { formatBytes } from "@/utils/formatters";
import { scanCleanableFiles, cleanFiles, createRestorePoint } from "@/services/apiBridge";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { CleanerFileRow } from "./CleanerFileRow";

interface SafeCleanerProps {
  onNotify: (msg: string) => void;
  /** Báo tổng dung lượng của lần quét gần nhất cho badge Navbar */
  onScanComplete?: (totalBytes: number) => void;
}

/** Cấp độ hiển thị: Safe = chỉ mục Safe; Balanced = Safe + Balanced (đúng với những gì backend thực sự quét) */
type CleanerTierView = Extract<CleanerCategory, "Safe" | "Balanced">;

const TIERS: Array<{ id: CleanerTierView; title: string; tag: string; desc: string; active: string }> = [
  {
    id: "Safe",
    title: "🟢 Safe",
    tag: "Khuyên dùng",
    desc: "Tệp %TEMP% cũ hơn 24 giờ và Crash Dumps. Không ảnh hưởng ứng dụng.",
    active: "bg-emerald-500/15 border-emerald-500/40",
  },
  {
    id: "Balanced",
    title: "🟡 Balanced",
    tag: "Thêm cache",
    desc: "Safe + bộ nhớ đệm hình thu nhỏ Explorer (tự tạo lại, thư mục mở chậm hơn một lần).",
    active: "bg-amber-500/15 border-amber-500/40",
  },
];

const isInTier = (f: CleanableItem, tier: CleanerTierView) =>
  tier === "Balanced" ? f.category === "Safe" || f.category === "Balanced" : f.category === "Safe";

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export const SafeCleaner: React.FC<SafeCleanerProps> = ({ onNotify, onScanComplete }) => {
  const [tier, setTier] = useState<CleanerTierView>("Safe");
  const [files, setFiles] = useState<CleanableItem[]>([]);
  const [scanId, setScanId] = useState<string>("");
  const [isScanning, setIsScanning] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isCleaning, setIsCleaning] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cleanResult, setCleanResult] = useState<CleanResult | null>(null);
  const [isCreatingRestorePoint, setIsCreatingRestorePoint] = useState(false);

  const visibleFiles = files.filter((f) => isInTier(f, tier));
  const selectedFiles = visibleFiles.filter((f) => f.selected);
  const totalSelectedSize = selectedFiles.reduce((acc, f) => acc + f.size_bytes, 0);

  const handleToggleSelect = (id: string) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, selected: !f.selected } : f)));
  };

  const handleSelectAll = (select: boolean) => {
    setFiles((prev) => prev.map((f) => (isInTier(f, tier) ? { ...f, selected: select } : f)));
  };

  // Quét Dry-Run: backend lưu phiên quét, UI chỉ giữ scan_id + id của mục
  const handleRunDryRunScan = async (silent = false) => {
    setIsScanning(true);
    if (!silent) setCleanResult(null);
    try {
      const { scan_id, items } = await scanCleanableFiles();
      setScanId(scan_id);
      setScanError(null);
      onScanComplete?.(items.reduce((acc, f) => acc + f.size_bytes, 0));
      setHasScanned(true);
      setFiles(items.map((item) => ({ ...item, selected: true })));
      if (silent) return;
      onNotify(
        items.length > 0
          ? `Quét Dry-Run hoàn tất: tìm thấy ${items.length} tệp rác an toàn.`
          : "Hệ thống sạch sẽ! Không tìm thấy tệp rác nào cũ hơn 24 giờ."
      );
    } catch (err: unknown) {
      setScanError(errorText(err));
      if (!silent) onNotify(`Lỗi quét tệp rác: ${errorText(err)}`);
    } finally {
      setIsScanning(false);
    }
  };

  useEffect(() => {
    handleRunDryRunScan(true);
    // Chỉ quét tự động một lần khi mở tab
  }, []);

  const handleCreateRestorePoint = async () => {
    setIsCreatingRestorePoint(true);
    try {
      const success = await createRestorePoint("WinPulse Optimizer Pre-Clean Restore Point");
      onNotify(
        success
          ? "🛡️ Đã tạo Điểm khôi phục hệ thống thành công."
          : "Không thể tạo Điểm khôi phục: cần quyền Administrator hoặc System Protection chưa bật."
      );
    } catch (err: unknown) {
      onNotify(`Lỗi tạo Restore Point: ${errorText(err)}`);
    } finally {
      setIsCreatingRestorePoint(false);
    }
  };

  const handleConfirmClean = async () => {
    setIsCleaning(true);
    // Chỉ gửi id trong phiên quét; backend tự tra đường dẫn, kiểm tra an toàn và ghi lịch sử
    const idsToClean = selectedFiles.map((f) => f.id);
    try {
      const result = await cleanFiles(scanId, idsToClean);
      setCleanResult(result);
      onNotify(
        `Dọn dẹp xong: giải phóng ${formatBytes(result.freed_bytes)} (${result.success_count} tệp đã xóa, ${result.skipped_locked_count} tệp đang khóa bỏ qua).`
      );
      // Quét lại để danh sách phản ánh đúng trạng thái thật (tệp khóa/thất bại vẫn còn)
      await handleRunDryRunScan(true);
    } catch (err: unknown) {
      onNotify(`Lỗi dọn dẹp tệp: ${errorText(err)}`);
    } finally {
      setIsCleaning(false);
      setConfirmOpen(false);
    }
  };

  const allSelected = selectedFiles.length === visibleFiles.length && visibleFiles.length > 0;

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="p-6 rounded-3xl glass-panel border border-emerald-500/20">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="p-1 rounded-lg bg-emerald-500/10 text-emerald-400">
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </span>
              <h2 className="font-display font-bold text-xl text-white">Dọn dẹp an toàn</h2>
            </div>
            <p className="text-xs text-slate-300 max-w-2xl">
              Chỉ quét trong danh mục an toàn (WhiteList). Không chạm vào thư mục hệ thống hay dữ liệu cá nhân. Muốn tìm
              thư mục lớn khác, dùng tab "Phân tích ổ đĩa".
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleCreateRestorePoint}
              disabled={isCreatingRestorePoint}
              title="Tạo điểm khôi phục hệ thống Windows trước khi xóa"
              className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-violet-500/15 hover:bg-violet-500/25 text-violet-200 hover:text-white border border-violet-500/30 text-xs font-semibold transition-all disabled:opacity-50"
            >
              {isCreatingRestorePoint ? (
                <Loader2 className="w-4 h-4 animate-spin text-violet-300" aria-hidden="true" />
              ) : (
                <Save className="w-4 h-4 text-violet-300" aria-hidden="true" />
              )}
              <span>{isCreatingRestorePoint ? "Đang tạo Restore Point..." : "Tạo điểm khôi phục"}</span>
            </button>
            <button
              onClick={() => handleRunDryRunScan()}
              disabled={isScanning}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface-850 hover:bg-surface-800 text-cyan-200 hover:text-white border border-cyan-500/30 text-xs font-semibold transition-all disabled:opacity-50"
            >
              <RotateCw className={`w-4 h-4 ${isScanning ? "animate-spin" : ""}`} aria-hidden="true" />
              <span>{isScanning ? "Đang quét..." : "Quét Dry-Run"}</span>
            </button>
          </div>
        </div>

        {/* Cấp độ */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-6 pt-6 border-t border-white/[0.06]" role="group" aria-label="Cấp độ dọn dẹp">
          {TIERS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTier(t.id)}
              aria-pressed={tier === t.id}
              className={`p-3.5 rounded-2xl text-left border transition-all ${
                tier === t.id ? t.active : "bg-surface-900/40 border-white/[0.04] hover:bg-surface-900/70"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-xs text-slate-100">{t.title}</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.06] text-slate-200">{t.tag}</span>
              </div>
              <p className="text-[11px] text-slate-300">{t.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Kết quả lần dọn gần nhất */}
      {cleanResult && (
        <div className="p-4 rounded-2xl bg-surface-900/90 border border-emerald-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4" role="status">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/15 text-emerald-400">
              <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <div className="font-semibold text-sm text-white">Đã giải phóng {formatBytes(cleanResult.freed_bytes)}</div>
              <div className="text-xs text-slate-300 flex items-center gap-3 mt-0.5 flex-wrap">
                <span className="text-emerald-300 font-mono">✓ {cleanResult.success_count} tệp đã xóa</span>
                {cleanResult.skipped_locked_count > 0 && (
                  <span className="text-amber-300 font-mono flex items-center gap-1">
                    <Lock className="w-3 h-3" aria-hidden="true" /> {cleanResult.skipped_locked_count} tệp đang khóa (bỏ qua)
                  </span>
                )}
                {cleanResult.failed_count > 0 && (
                  <span className="text-rose-300 font-mono">✗ {cleanResult.failed_count} tệp không xóa được</span>
                )}
              </div>
            </div>
          </div>
          <button onClick={() => setCleanResult(null)} className="text-slate-300 hover:text-white text-xs px-2 py-1">
            Đóng
          </button>
        </div>
      )}

      {/* Danh sách Dry-Run */}
      <div className="rounded-2xl glass-panel overflow-hidden border border-white/[0.06]">
        <div className="p-4 bg-surface-900/80 border-b border-white/[0.06] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => handleSelectAll(!allSelected)}
              aria-pressed={allSelected}
              className="flex items-center gap-2 text-xs font-medium text-slate-200 hover:text-white"
            >
              {allSelected ? (
                <CheckSquare className="w-4 h-4 text-cyan-400" aria-hidden="true" />
              ) : (
                <Square className="w-4 h-4 text-slate-400" aria-hidden="true" />
              )}
              <span>Chọn tất cả ({visibleFiles.length} tệp)</span>
            </button>
            <span className="text-slate-400" aria-hidden="true">|</span>
            <span className="text-xs font-mono text-cyan-300">
              Đã chọn: {selectedFiles.length} tệp ({formatBytes(totalSelectedSize)})
            </span>
          </div>

          <button
            disabled={selectedFiles.length === 0 || isCleaning || !scanId}
            onClick={() => setConfirmOpen(true)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold tracking-wide transition-all ${
              selectedFiles.length > 0 && !isCleaning && scanId
                ? "bg-gradient-to-r from-emerald-500 to-cyan-500 text-black hover:brightness-110"
                : "bg-surface-800 text-slate-400 cursor-not-allowed"
            }`}
          >
            {isCleaning ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Trash2 className="w-4 h-4" aria-hidden="true" />}
            <span>{isCleaning ? "Đang dọn dẹp..." : `Dọn dẹp các tệp đã chọn (${formatBytes(totalSelectedSize)})`}</span>
          </button>
        </div>

        {!hasScanned && isScanning ? (
          <ul className="divide-y divide-white/[0.04]" aria-busy="true" aria-label="Đang quét tệp rác">
            {Array.from({ length: 5 }).map((_, i) => (
              <li key={i} className="p-4 space-y-2">
                <div className="h-3 w-48 rounded bg-surface-800 animate-pulse" />
                <div className="h-2.5 w-80 max-w-full rounded bg-surface-850 animate-pulse" />
              </li>
            ))}
          </ul>
        ) : scanError && files.length === 0 ? (
          <div className="p-10 flex flex-col items-center gap-3 text-xs text-rose-300 text-center">
            <AlertCircle className="w-6 h-6" aria-hidden="true" />
            <span>Không quét được tệp rác: {scanError}</span>
            <button
              onClick={() => handleRunDryRunScan()}
              className="px-3 py-1.5 rounded-lg bg-surface-850 text-slate-100 border border-white/[0.08] hover:bg-surface-800"
            >
              Thử lại
            </button>
          </div>
        ) : visibleFiles.length === 0 ? (
          <div className="p-10 text-center text-slate-300 text-xs">Sạch sẽ! Không còn tệp rác nào trong cấp độ này.</div>
        ) : (
          <ul className="divide-y divide-white/[0.04] max-h-[440px] overflow-y-auto">
            {visibleFiles.map((file) => (
              <CleanerFileRow key={file.id} file={file} onToggle={handleToggleSelect} />
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirmOpen}
        title="Xác nhận dọn dẹp"
        tone="warning"
        confirmLabel={`Xóa ${selectedFiles.length} tệp`}
        isBusy={isCleaning}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirmClean}
      >
        <p>
          Sẽ xóa vĩnh viễn <b className="text-white">{selectedFiles.length} tệp tạm/cache</b>, giải phóng khoảng{" "}
          <b className="text-cyan-300">{formatBytes(totalSelectedSize)}</b>. Đây là tệp tự tạo lại nên không vào Thùng rác.
        </p>
        <ul className="p-3 rounded-xl bg-surface-950/80 border border-white/[0.06] text-[11px] text-slate-200 space-y-1">
          {(["Safe", "Balanced"] as const).map((cat) => {
            const n = selectedFiles.filter((f) => f.category === cat).length;
            return n > 0 ? (
              <li key={cat}>
                {cat === "Safe" ? "🟢 Tệp tạm & Crash Dumps" : "🟡 Cache hình thu nhỏ Explorer"}: {n} tệp
              </li>
            ) : null;
          })}
          <li className="text-emerald-300">✓ Tệp đang bị ứng dụng khác khóa sẽ được bỏ qua, không gây lỗi.</li>
        </ul>
      </ConfirmDialog>
    </div>
  );
};
