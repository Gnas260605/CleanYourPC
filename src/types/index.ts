export interface CpuMetrics {
  usage: number; // 0 - 100%
  temperature?: number; // deg C
  cores: number;
  threads: number;
  model: string;
  frequencyGhz: number;
}

export interface RamMetrics {
  usedBytes: number;
  totalBytes: number;
  availableBytes: number;
  usagePercent: number; // 0 - 100%
  speedMhz?: number;
}

export interface DiskMetrics {
  readBytesPerSec: number;
  writeBytesPerSec: number;
  totalSpaceBytes: number;
  usedSpaceBytes: number;
  usagePercent: number;
  driveLetter: string;
}

export interface NetworkMetrics {
  downloadBytesPerSec: number;
  uploadBytesPerSec: number;
  adapterName: string;
  pingMs: number;
}

export interface SystemInfo {
  os: string;
  build: string;
  uptimeSeconds: number;
  hostname: string;
  architecture: string;
}

export interface HardwareMetrics {
  cpu: CpuMetrics;
  ram: RamMetrics;
  disk: DiskMetrics;
  network: NetworkMetrics;
  system: SystemInfo;
  timestamp: number;
}

// Rust Backend Payload Interface (from src-tauri/src/metrics.rs)
export interface BackendDiskPartitionInfo {
  name: string;
  mount_point: string;
  total_bytes: number;
  available_bytes: number;
  used_bytes: number;
  usage_percent: number;
  file_system: string;
}

export interface BackendHardwareMetrics {
  timestamp: number;
  cpu_usage_total: number;
  cpu_usage_per_core: number[];
  cpu_name: string;
  cpu_core_count: number;
  cpu_frequency_mhz: number;
  ram_total_bytes: number;
  ram_used_bytes: number;
  ram_available_bytes: number;
  ram_usage_percent: number;
  swap_total_bytes: number;
  swap_used_bytes: number;
  disk_read_mbps: number;
  disk_write_mbps: number;
  disks: BackendDiskPartitionInfo[];
  net_upload_kbps: number;
  net_download_kbps: number;
  uptime_seconds: number;
}

// --- Sprint 2 & 3: Real Backend Rust Integration Structs ---

export type StartupImpact = "High" | "Medium" | "Low";

export interface StartupItem {
  id: string;
  name: string;
  command: string;
  location: string;
  enabled: boolean;
  impact: StartupImpact;
  publisher?: string;
  source?: "HKCU" | "HKLM" | "StartupFolder" | "TaskScheduler" | string;
  startupDelaySec?: number;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  cpu_usage: number;
  memory_bytes: number;
  is_critical: boolean;
  is_eco_mode: boolean;
  description?: string;
}

export type CleanerCategory = "Safe" | "Balanced" | "Advanced";

export interface CleanableItem {
  id: string;
  name: string;
  path: string;
  size_bytes: number;
  category: CleanerCategory;
  reason: string;
  selected?: boolean;
}

/** Kết quả quét Dry-Run: backend giữ phiên quét theo `scan_id` */
export interface CleanScanResult {
  scan_id: string;
  items: CleanableItem[];
}

export interface CleanResult {
  freed_bytes: number;
  success_count: number;
  failed_count: number;
  skipped_locked_count: number;
}

// --- Sprint 4 & 5: App Settings & History Types ---

export interface AppSettings {
  auto_start_on_boot: boolean;
  minimize_to_tray: boolean;
  poll_interval_ms: number; // 1000, 1500, 3000
  visual_effects: boolean;
}

export interface OptimizationLog {
  id: string;
  timestamp: number; // Epoch seconds
  action_type: string;
  freed_bytes: number;
  items_cleaned: number;
  items_skipped_locked: number;
  details: string;
}

export interface HistorySummary {
  total_freed_bytes: number;
  total_sessions: number;
  logs: OptimizationLog[];
}

// Legacy / Helper UI Types
export type ProcessSafety = "safe" | "caution" | "critical";
export type ProcessState = "running" | "eco" | "suspended";

export interface ProcessItem {
  pid: number;
  name: string;
  cpuPercent: number;
  memoryBytes: number;
  safety: ProcessSafety;
  state: ProcessState;
  description: string;
  icon?: string;
}

export type CleanerTier = "safe" | "balanced" | "advanced";

export interface CleanerFileItem {
  id: string;
  name: string;
  path: string;
  sizeBytes: number;
  category: string;
  reason: string;
  selected: boolean;
  tier: CleanerTier;
}

export type ServiceRecommendation = "safe_to_disable" | "caution" | "keep_default";

export interface ServiceItem {
  name: string;
  displayName: string;
  status: "running" | "stopped";
  startupType: "Automatic" | "Manual" | "Disabled";
  recommendation: ServiceRecommendation;
  vietnameseDescription: string;
  impactDescription: string;
  selectedForDisable?: boolean;
}

export type ActiveTab = "dashboard" | "startup" | "process" | "cleaner" | "services";
