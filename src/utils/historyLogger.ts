import { OptimizationLog, HistorySummary } from "@/types";
import { isTauriContext } from "@/hooks/useHardwareMetrics";

const LOCAL_STORAGE_HISTORY_KEY = "winpulse_optimization_history";

/**
 * Ghi nhận một phiên tối ưu vào hệ thống (Tauri Backend Native hoặc Web Fallback)
 */
export async function logOptimizationSession(
  actionType: string,
  freedBytes: number,
  itemsCleaned: number,
  itemsSkippedLocked: number,
  details: string
): Promise<boolean> {
  const newLog: OptimizationLog = {
    id: `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    timestamp: Math.floor(Date.now() / 1000),
    action_type: actionType,
    freed_bytes: freedBytes,
    items_cleaned: itemsCleaned,
    items_skipped_locked: itemsSkippedLocked,
    details,
  };

  if (isTauriContext()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("record_optimization_log", { log: newLog });
      return true;
    } catch (err) {
      console.warn("Lỗi record_optimization_log từ Tauri:", err);
    }
  }

  // Web dev fallback
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_HISTORY_KEY);
    const summary: HistorySummary = raw
      ? JSON.parse(raw)
      : { total_freed_bytes: 0, total_sessions: 0, logs: [] };

    summary.logs.unshift(newLog);
    summary.total_sessions = summary.logs.length;
    summary.total_freed_bytes = summary.logs.reduce((acc, l) => acc + l.freed_bytes, 0);

    localStorage.setItem(LOCAL_STORAGE_HISTORY_KEY, JSON.stringify(summary));
    return true;
  } catch (e) {
    console.error("Lỗi lưu trữ lịch sử Web fallback:", e);
    return false;
  }
}
