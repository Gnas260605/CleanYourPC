import { isTauriContext } from "@/hooks/useHardwareMetrics";
import {
  ProcessInfo,
  StartupItem,
  CleanScanResult,
  CleanResult,
  ServiceInfo,
  ServiceChangeResult,
  OptimizationLog,
  DiskScanProgress,
  DiskScanComplete,
  RecycleResult,
} from "@/types";

// HTTP server chỉ đọc, chỉ chạy khi backend là bản debug (xem src-tauri/src/http_server.rs)
const LOCAL_HTTP_BASE = "http://127.0.0.1:1421/api";

export const DESKTOP_ONLY_MESSAGE =
  "Chức năng này chỉ khả dụng trong ứng dụng desktop WinPulse (chế độ trình duyệt chỉ để xem).";

/** Chuẩn hóa lỗi từ Tauri (AppError được serialize dạng { type, details }) thành Error có thông điệp tiếng Việt */
export function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === "string") return new Error(err);
  if (err && typeof err === "object") {
    const e = err as { type?: string; details?: unknown };
    if (typeof e.details === "string") return new Error(e.details);
    if (e.type) return new Error(e.type);
  }
  return new Error(String(err));
}

async function invokeCommand<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    throw toError(err);
  }
}

/** Lệnh chỉ đọc: trong app dùng IPC; trong trình duyệt (dev) đọc từ HTTP server debug bằng GET */
async function readOnly<T>(
  cmd: string,
  httpPath: string,
  errorMessage: string,
  args?: Record<string, unknown>
): Promise<T> {
  if (isTauriContext()) {
    return invokeCommand<T>(cmd, args);
  }
  const res = await fetch(`${LOCAL_HTTP_BASE}${httpPath}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${errorMessage}`);
  return (await res.json()) as T;
}

/** Lệnh thay đổi hệ thống: CHỈ qua IPC của app desktop, không bao giờ fallback sang HTTP */
async function mutating<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriContext()) {
    throw new Error(DESKTOP_ONLY_MESSAGE);
  }
  return invokeCommand<T>(cmd, args);
}

// 1. PROCESS GUARDIAN
export function fetchProcessList(): Promise<ProcessInfo[]> {
  return readOnly<ProcessInfo[]>(
    "get_process_list",
    "/processes",
    "Không thể đọc danh sách tiến trình"
  );
}

export function toggleEcoMode(pid: number, enable: boolean): Promise<boolean> {
  return mutating<boolean>("apply_process_eco_mode", { pid, enable });
}

export function killProcessTree(pid: number): Promise<boolean> {
  return mutating<boolean>("kill_process_tree", { pid });
}

export function optimizeWorkingSet(pid: number): Promise<boolean> {
  return mutating<boolean>("optimize_process_working_set", { pid });
}

// 2. STARTUP MANAGER
export function fetchStartupList(): Promise<StartupItem[]> {
  return readOnly<StartupItem[]>(
    "get_startup_items",
    "/startup",
    "Không thể đọc danh sách khởi động từ Registry"
  );
}

export function toggleStartupItem(id: string, location: string, enable: boolean): Promise<boolean> {
  return mutating<boolean>("toggle_startup_item", { id, location, enable });
}

/** Sao lưu cấu hình khởi động, trả về đường dẫn tệp backup do backend tạo */
export function backupStartup(): Promise<string> {
  return mutating<string>("backup_startup_registry");
}

// 3. SAFE CLEANER
/** Quét Dry-Run. Backend giữ phiên quét; chỉ `scan_id` + id của mục được gửi lại khi dọn */
export function scanCleanableFiles(): Promise<CleanScanResult> {
  return readOnly<CleanScanResult>(
    "scan_cleanable_files",
    "/cleaner/scan",
    "Không thể quét danh mục tệp rác"
  );
}

export function cleanFiles(scanId: string, itemIds: string[]): Promise<CleanResult> {
  return mutating<CleanResult>("clean_files", { scanId, itemIds });
}

// 4. RESTORE POINT
export function createRestorePoint(description?: string): Promise<boolean> {
  return mutating<boolean>("create_system_restore_point", {
    description: description || "WinPulse Optimizer Restore Point",
  });
}

// 5. WINDOWS SERVICES
export function fetchServices(): Promise<ServiceInfo[]> {
  return readOnly<ServiceInfo[]>("get_services", "/services", "Không thể đọc danh sách dịch vụ");
}

/** Đổi startup type ("Manual" | "Disabled" | "Automatic"). Backend tự sao lưu giá trị gốc */
export function setServiceStartup(
  name: string,
  startupType: "Manual" | "Disabled" | "Automatic",
  stopNow: boolean
): Promise<ServiceChangeResult> {
  return mutating<ServiceChangeResult>("set_service_startup", { name, startupType, stopNow });
}

export function restoreServiceStartup(name: string): Promise<ServiceChangeResult> {
  return mutating<ServiceChangeResult>("restore_service_startup", { name });
}

// 6. QUICK BOOST
/** Thu gọn Working Set các tiến trình không cốt lõi. Backend tự ghi lịch sử và trả về bản ghi thật */
export function triggerQuickBoost(): Promise<OptimizationLog> {
  return mutating<OptimizationLog>("trigger_quick_boost");
}

// 7. DISK ANALYZER (chỉ có trong app desktop: quét lâu, dùng sự kiện Tauri)
/** Bắt đầu quét nền. `roots` rỗng/undefined = thư mục mặc định. Kết quả đến qua onDiskScanComplete */
export function startLargeFolderScan(roots: string[] | undefined, minSizeMb: number): Promise<void> {
  return mutating<void>("start_large_folder_scan", {
    roots: roots && roots.length > 0 ? roots : null,
    minSizeMb,
  });
}

export function cancelLargeFolderScan(): Promise<void> {
  return mutating<void>("cancel_large_folder_scan");
}

/** Chuyển các mục Safe/Caution vào Thùng rác — chỉ gửi id trong phiên quét */
export function recycleLargeFolderItems(scanId: string, itemIds: string[]): Promise<RecycleResult> {
  return mutating<RecycleResult>("recycle_large_folder_items", { scanId, itemIds });
}

export function openDiskItemInExplorer(scanId: string, itemId: string): Promise<void> {
  return mutating<void>("open_disk_item_in_explorer", { scanId, itemId });
}

async function listenEvent<T>(event: string, cb: (payload: T) => void): Promise<() => void> {
  if (!isTauriContext()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return listen<T>(event, (e) => cb(e.payload));
}

export function onDiskScanProgress(cb: (p: DiskScanProgress) => void): Promise<() => void> {
  return listenEvent<DiskScanProgress>("disk-scan-progress", cb);
}

export function onDiskScanComplete(cb: (p: DiskScanComplete) => void): Promise<() => void> {
  return listenEvent<DiskScanComplete>("disk-scan-complete", cb);
}
