import { isTauriContext } from "@/hooks/useHardwareMetrics";
import { ProcessInfo, StartupItem, CleanableItem, CleanResult } from "@/types";

const LOCAL_HTTP_BASE = "http://127.0.0.1:1421/api";

// 1. PROCESS GUARDIAN
export async function fetchProcessList(): Promise<ProcessInfo[]> {
  if (isTauriContext()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<ProcessInfo[]>("get_process_list");
    } catch (e) {
      console.warn("Tauri get_process_list fallback to HTTP:", e);
    }
  }

  const res = await fetch(`${LOCAL_HTTP_BASE}/processes`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: Không thể đọc danh sách tiến trình từ kernel`);
  return await res.json();
}

export async function toggleEcoMode(pid: number, enable: boolean): Promise<boolean> {
  if (isTauriContext()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<boolean>("apply_process_eco_mode", { pid, enable });
    } catch (e) {
      console.warn("Tauri apply_process_eco_mode fallback to HTTP:", e);
    }
  }

  const res = await fetch(`${LOCAL_HTTP_BASE}/processes/eco`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pid, enable }),
  });
  const data = await res.json();
  return Boolean(data.success);
}

export async function killProcessTree(pid: number): Promise<boolean> {
  if (isTauriContext()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<boolean>("kill_process_tree", { pid });
    } catch (e) {
      console.warn("Tauri kill_process_tree fallback to HTTP:", e);
    }
  }

  const res = await fetch(`${LOCAL_HTTP_BASE}/processes/kill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pid }),
  });
  const data = await res.json();
  return Boolean(data.success);
}

export async function optimizeWorkingSet(pid: number): Promise<boolean> {
  if (isTauriContext()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<boolean>("optimize_process_working_set", { pid });
    } catch (e) {
      console.warn("Tauri optimize_process_working_set fallback to HTTP:", e);
    }
  }

  const res = await fetch(`${LOCAL_HTTP_BASE}/processes/optimize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pid }),
  });
  const data = await res.json();
  return Boolean(data.success);
}

// 2. STARTUP MANAGER
export async function fetchStartupList(): Promise<StartupItem[]> {
  if (isTauriContext()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<StartupItem[]>("get_startup_items");
    } catch (e) {
      console.warn("Tauri get_startup_items fallback to HTTP:", e);
    }
  }

  const res = await fetch(`${LOCAL_HTTP_BASE}/startup`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: Không thể đọc danh sách khởi động từ Registry`);
  return await res.json();
}

export async function toggleStartupItem(id: string, location: string, enable: boolean): Promise<boolean> {
  if (isTauriContext()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<boolean>("toggle_startup_item", { id, location, enable });
    } catch (e) {
      console.warn("Tauri toggle_startup_item fallback to HTTP:", e);
    }
  }

  const res = await fetch(`${LOCAL_HTTP_BASE}/startup/toggle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, location, enable }),
  });
  const data = await res.json();
  return Boolean(data.success);
}

export async function backupStartup(): Promise<string> {
  if (isTauriContext()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<string>("backup_startup_registry");
    } catch (e) {
      console.warn("Tauri backup_startup_registry fallback to HTTP:", e);
    }
  }

  const res = await fetch(`${LOCAL_HTTP_BASE}/startup/backup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const data = await res.json();
  return data.backup_path || "C:\\Users\\MSI\\AppData\\Local\\WinPulseOptimizer\\backup.json";
}

// 3. SAFE CLEANER
export async function scanCleanableFiles(): Promise<CleanableItem[]> {
  if (isTauriContext()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<CleanableItem[]>("scan_cleanable_files");
    } catch (e) {
      console.warn("Tauri scan_cleanable_files fallback to HTTP:", e);
    }
  }

  const res = await fetch(`${LOCAL_HTTP_BASE}/cleaner/scan`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: Không thể quét danh mục tệp rác`);
  return await res.json();
}

export async function cleanFiles(paths: string[]): Promise<CleanResult> {
  if (isTauriContext()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<CleanResult>("clean_files", { paths });
    } catch (e) {
      console.warn("Tauri clean_files fallback to HTTP:", e);
    }
  }

  const res = await fetch(`${LOCAL_HTTP_BASE}/cleaner/clean`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
  });
  return await res.json();
}

// 4. RESTORE POINT
export async function createRestorePoint(description?: string): Promise<boolean> {
  if (isTauriContext()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<boolean>("create_system_restore_point", {
        description: description || "WinPulse Optimizer Restore Point",
      });
    } catch (e) {
      console.warn("Tauri create_system_restore_point fallback to HTTP:", e);
    }
  }

  const res = await fetch(`${LOCAL_HTTP_BASE}/restore-point`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });
  const data = await res.json();
  return Boolean(data.success);
}
