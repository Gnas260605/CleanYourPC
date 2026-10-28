import React, { useState } from "react";
import { 
  Trash2, 
  ShieldCheck, 
  CheckSquare, 
  Square, 
  RotateCw, 
  HelpCircle,
  Save,
  Loader2,
  CheckCircle2,
  X,
  FileCheck2,
  Lock
} from "lucide-react";
import { CleanableItem, CleanResult, CleanerCategory } from "@/types";
import { formatBytes } from "@/utils/formatters";
import { scanCleanableFiles, cleanFiles, createRestorePoint } from "@/services/apiBridge";

interface SafeCleanerProps {
  onNotify: (msg: string) => void;
  /** Báo tổng dung lượng của lần quét gần nhất cho badge Navbar */
  onScanComplete?: (totalBytes: number) => void;
}

export const SafeCleaner: React.FC<SafeCleanerProps> = ({ onNotify, onScanComplete }) => {
  const [selectedCategory, setSelectedCategory] = useState<CleanerCategory | "All">("Safe");
  const [files, setFiles] = useState<CleanableItem[]>([]);
  const [scanId, setScanId] = useState<string>("");
  const [isScanning, setIsScanning] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [cleanResult, setCleanResult] = useState<CleanResult | null>(null);
  const [isCreatingRestorePoint, setIsCreatingRestorePoint] = useState(false);

  // Auto-scan real temp files on component mount
  React.useEffect(() => {
    handleRunDryRunScan();
  }, []);

  // Filter files by category
  const visibleFiles = files.filter((f) => {
    if (selectedCategory === "All") return true;
    if (selectedCategory === "Safe") return f.category === "Safe";
    if (selectedCategory === "Balanced") return f.category === "Safe" || f.category === "Balanced";
    return true; // Advanced includes all
  });

  const selectedFiles = visibleFiles.filter((f) => f.selected);
  const totalSelectedSize = selectedFiles.reduce((acc, f) => acc + f.size_bytes, 0);

  // Toggle selection for a file
  const handleToggleSelect = (id: string) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, selected: !f.selected } : f))
    );
  };

  // Select all / Deselect all
  const handleSelectAll = (select: boolean) => {
    setFiles((prev) =>
      prev.map((f) => {
        const isVisible =
          selectedCategory === "All" ||
          selectedCategory === "Advanced" ||
          (selectedCategory === "Balanced" && (f.category === "Safe" || f.category === "Balanced")) ||
          (selectedCategory === "Safe" && f.category === "Safe");
        return isVisible ? { ...f, selected: select } : f;
      })
    );
  };

  // Trigger Dry-Run Scan via Windows Native Engine
  const handleRunDryRunScan = async (silent = false) => {
    setIsScanning(true);
    if (!silent) setCleanResult(null);

    try {
      const { scan_id, items: scanned } = await scanCleanableFiles();
      setScanId(scan_id);
      onScanComplete?.(scanned.reduce((acc, f) => acc + f.size_bytes, 0));
      setHasScanned(true);
      setFiles(
        scanned.map((item) => ({
          ...item,
          selected: item.category === "Safe" || item.category === "Balanced",
        }))
      );
      if (silent) return;
      if (scanned.length > 0) {
        onNotify(`Quét Dry-Run thực tế hoàn tất: Tìm thấy ${scanned.length} tệp rác an toàn theo WhiteList.`);
      } else {
        onNotify("Hệ thống rất sạch sẽ! Không tìm thấy tệp rác nào cũ hơn 24 giờ.");
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      onNotify(`Lỗi quét tệp rác: ${errorMsg}`);
    } finally {
      setIsScanning(false);
    }
  };

  // Create System Restore Point via Win32 API
  const handleCreateRestorePoint = async () => {
    setIsCreatingRestorePoint(true);
    try {
      const success = await createRestorePoint("WinPulse Optimizer Pre-Clean Restore Point");
      if (success) {
        onNotify("🛡️ Đã tạo Điểm khôi phục hệ thống (System Restore Point) thành công trên Windows!");
      } else {
        onNotify("Không thể tạo Điểm khôi phục: Cần quyền Administrator hoặc tính năng System Protection chưa bật.");
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      onNotify(`Lỗi tạo Restore Point: ${errorMsg}`);
    } finally {
      setIsCreatingRestorePoint(false);
    }
  };

  // Perform real clean after user confirmation
  const handleConfirmClean = async () => {
    setConfirmModalOpen(false);
    setIsCleaning(true);

    // Chỉ gửi id trong phiên quét; backend tự tra đường dẫn và ghi lịch sử
    const idsToClean = selectedFiles.map((f) => f.id);
    try {
      const result = await cleanFiles(scanId, idsToClean);
      setCleanResult(result);
      // Quét lại để danh sách phản ánh đúng trạng thái thật (tệp khóa/thất bại vẫn còn)
      await handleRunDryRunScan(true);

      onNotify(
        `Dọn dẹp hoàn tất! Đã giải phóng thực tế ${formatBytes(result.freed_bytes)} (${result.success_count} tệp đã xóa, ${result.skipped_locked_count} tệp khóa bỏ qua an toàn).`
      );
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      onNotify(`Lỗi dọn dẹp tệp: ${errorMsg}`);
    } finally {
      setIsCleaning(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="p-6 rounded-3xl glass-panel border border-emerald-500/20 relative overflow-hidden">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="p-1 rounded-lg bg-emerald-500/10 text-emerald-400">
                <Trash2 className="w-4 h-4" />
              </span>
              <h2 className="font-display font-bold text-xl text-white">
                Dọn dẹp an toàn (Safe Cleaner & WhiteList Engine)
              </h2>
            </div>
            <p className="text-xs text-slate-300 max-w-2xl">
              Chỉ quét trong danh mục WhiteList an toàn theo quy chuẩn RULE.md Zero-Harm. Tuyệt đối không chạm vào thư mục hệ thống (System32/Boot) hay dữ liệu người dùng (Desktop/Documents).
            </p>
          </div>

          {/* Action Buttons: Restore Point + Dry-Run Scan */}
          <div className="flex items-center gap-2 flex-wrap">
            {hasScanned && (
              <span className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                ✓ Dry-Run Ready
              </span>
            )}

            {/* Create Restore Point Button */}
            <button
              onClick={handleCreateRestorePoint}
              disabled={isCreatingRestorePoint}
              title="Tạo điểm khôi phục hệ thống Windows trước khi xóa file"
              className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-violet-500/15 hover:bg-violet-500/25 text-violet-300 hover:text-white border border-violet-500/30 text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
            >
              {isCreatingRestorePoint ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
                  <span>Đang tạo Restore Point...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 text-violet-400" />
                  <span>Tạo điểm khôi phục</span>
                </>
              )}
            </button>

            {/* Dry Run Scan Button */}
            <button
              onClick={() => handleRunDryRunScan()}
              disabled={isScanning}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface-850 hover:bg-surface-800 text-cyan-300 hover:text-white border border-cyan-500/30 text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
            >
              <RotateCw className={`w-4 h-4 ${isScanning ? "animate-spin text-cyan-400" : ""}`} />
              <span>{isScanning ? "Đang quét..." : "Quét Dry-Run"}</span>
            </button>
          </div>
        </div>

        {/* 3 Categories Selector */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6 pt-6 border-t border-white/[0.06]">
          {/* Safe Tier */}
          <button
            onClick={() => setSelectedCategory("Safe")}
            className={`p-3.5 rounded-2xl text-left border transition-all ${
              selectedCategory === "Safe"
                ? "bg-emerald-500/15 border-emerald-500/40 shadow-glow-emerald"
                : "bg-surface-900/40 border-white/[0.04] hover:bg-surface-900/70"
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-xs text-emerald-300 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400" /> Cấp độ 🟢 Safe
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                Khuyên Dùng
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              User %TEMP%, Thumbnail Cache, Crash Dumps. 0% rủi ro cho hệ thống.
            </p>
          </button>

          {/* Balanced Tier */}
          <button
            onClick={() => setSelectedCategory("Balanced")}
            className={`p-3.5 rounded-2xl text-left border transition-all ${
              selectedCategory === "Balanced"
                ? "bg-amber-500/15 border-amber-500/40 shadow-glow-amber"
                : "bg-surface-900/40 border-white/[0.04] hover:bg-surface-900/70"
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-xs text-amber-300 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400" /> Cấp độ 🟡 Balanced
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
                Tối Ưu Sâu
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Bao gồm Safe + Browser Media Cache + Delivery Optimization.
            </p>
          </button>

          {/* Advanced Tier */}
          <button
            onClick={() => setSelectedCategory("Advanced")}
            className={`p-3.5 rounded-2xl text-left border transition-all ${
              selectedCategory === "Advanced"
                ? "bg-rose-500/15 border-rose-500/40 shadow-glow-rose"
                : "bg-surface-900/40 border-white/[0.04] hover:bg-surface-900/70"
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-xs text-rose-300 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-rose-400" /> Cấp độ 🔴 Advanced
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300">
                Chuyên Gia
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Gói vá Installer cũ & Nhật ký WER. Cần kiểm tra kỹ danh sách.
            </p>
          </button>
        </div>
      </div>

      {/* Detailed Result Card if Cleaned */}
      {cleanResult && (
        <div className="p-4 rounded-2xl bg-surface-900/90 border border-emerald-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-in slide-in-from-top">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/15 text-emerald-400">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <div className="font-semibold text-sm text-white">
                Dọn dẹp thành công: Giải phóng {formatBytes(cleanResult.freed_bytes)}
              </div>
              <div className="text-xs text-slate-400 flex items-center gap-3 mt-0.5 flex-wrap">
                <span className="text-emerald-400 font-mono">✓ {cleanResult.success_count} tệp đã xóa</span>
                {cleanResult.skipped_locked_count > 0 && (
                  <span className="text-amber-400 font-mono flex items-center gap-1">
                    <Lock className="w-3 h-3" /> {cleanResult.skipped_locked_count} tệp đang khóa (bỏ qua an toàn)
                  </span>
                )}
                {cleanResult.failed_count > 0 && (
                  <span className="text-rose-400 font-mono">✗ {cleanResult.failed_count} tệp không xóa được</span>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={() => setCleanResult(null)}
            className="text-slate-400 hover:text-white text-xs px-2 py-1"
          >
            Đóng
          </button>
        </div>
      )}

      {/* Dry Run Detail Table Section */}
      <div className="rounded-2xl glass-panel overflow-hidden border border-white/[0.06]">
        {/* Table Toolbar */}
        <div className="p-4 bg-surface-900/80 border-b border-white/[0.06] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => handleSelectAll(selectedFiles.length < visibleFiles.length)}
              className="flex items-center gap-2 text-xs font-medium text-slate-300 hover:text-white"
            >
              {selectedFiles.length === visibleFiles.length && visibleFiles.length > 0 ? (
                <CheckSquare className="w-4 h-4 text-cyan-400" />
              ) : (
                <Square className="w-4 h-4 text-slate-500" />
              )}
              <span>Chọn tất cả ({visibleFiles.length} tệp)</span>
            </button>

            <span className="text-slate-600">|</span>

            <span className="text-xs font-mono text-cyan-400">
              Đã chọn: {selectedFiles.length} tệp ({formatBytes(totalSelectedSize)})
            </span>
          </div>

          {/* Clean Action Button */}
          <button
            disabled={selectedFiles.length === 0 || isCleaning}
            onClick={() => setConfirmModalOpen(true)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold tracking-wide transition-all ${
              selectedFiles.length > 0 && !isCleaning
                ? "bg-gradient-to-r from-emerald-500 to-cyan-500 text-black shadow-glow-emerald hover:brightness-110 active:scale-95"
                : "bg-surface-800 text-slate-500 cursor-not-allowed"
            }`}
          >
            {isCleaning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-black" />
                <span>Đang dọn dẹp an toàn...</span>
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                <span>Dọn dẹp các tệp đã chọn ({formatBytes(totalSelectedSize)})</span>
              </>
            )}
          </button>
        </div>

        {/* Table Content */}
        <div className="divide-y divide-white/[0.04] max-h-[440px] overflow-y-auto">
          {visibleFiles.length === 0 ? (
            <div className="p-10 text-center text-slate-400 text-xs">
              Thư mục sạch sẽ! Không còn tệp rác nào trong cấp độ này.
            </div>
          ) : (
            visibleFiles.map((file) => (
              <div
                key={file.id}
                onClick={() => handleToggleSelect(file.id)}
                className={`p-3.5 flex items-start sm:items-center justify-between gap-4 cursor-pointer transition-colors ${
                  file.selected ? "bg-cyan-500/[0.04]" : "hover:bg-white/[0.02] opacity-60"
                }`}
              >
                <div className="flex items-start sm:items-center gap-3 min-w-0">
                  <div className="pt-0.5 sm:pt-0 shrink-0">
                    {file.selected ? (
                      <CheckSquare className="w-4 h-4 text-cyan-400" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-500" />
                    )}
                  </div>

                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-xs text-slate-100">
                        {file.name}
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.2 rounded bg-surface-950 border border-white/[0.06] text-slate-400">
                        {file.category}
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-slate-400 truncate max-w-xl" title={file.path}>
                      {file.path}
                    </p>
                    <p className="text-[11px] text-emerald-400/90 flex items-center gap-1">
                      <HelpCircle className="w-3 h-3 shrink-0" />
                      <span>{file.reason}</span>
                    </p>
                  </div>
                </div>

                <div className="font-mono text-xs font-bold text-slate-200 shrink-0">
                  {formatBytes(file.size_bytes)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Confirmation Modal - RULE.md Strict Transparency */}
      {confirmModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl glass-panel border border-cyan-500/30 p-6 space-y-4 shadow-glow-cyan/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 text-cyan-400">
                <ShieldCheck className="w-6 h-6" />
                <h3 className="font-display font-bold text-base text-white">
                  Xác nhận dọn dẹp minh bạch
                </h3>
              </div>
              <button
                onClick={() => setConfirmModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Bạn chuẩn bị xóa <span className="font-bold text-white">{selectedFiles.length} tệp rác</span> với tổng dung lượng giải phóng là <span className="font-bold text-cyan-400">{formatBytes(totalSelectedSize)}</span>.
            </p>

            <div className="p-3 rounded-xl bg-surface-950/80 border border-white/[0.06] text-[11px] text-slate-400 space-y-1.5">
              <div className="flex items-center gap-1.5 text-emerald-400">
                <FileCheck2 className="w-3.5 h-3.5" />
                <span>Tuyệt đối không xóa dữ liệu cá nhân (Desktop, Documents, Downloads).</span>
              </div>
              <div className="flex items-center gap-1.5 text-emerald-400">
                <FileCheck2 className="w-3.5 h-3.5" />
                <span>Bỏ qua êm ái các tệp đang bị ứng dụng khác khóa an toàn (Zero-Crash).</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setConfirmModalOpen(false)}
                disabled={isCleaning}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white"
              >
                Hủy bỏ
              </button>
              <button
                onClick={handleConfirmClean}
                disabled={isCleaning}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold bg-emerald-500 text-black shadow-glow-emerald hover:brightness-110 transition-all disabled:opacity-50"
              >
                {isCleaning ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-black" />
                    <span>Đang xóa...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    <span>Xác nhận Xóa</span>
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
