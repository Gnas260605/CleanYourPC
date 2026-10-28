use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};
use sysinfo::{
    CpuRefreshKind, Disks, MemoryRefreshKind, Networks, ProcessRefreshKind, RefreshKind, System,
};
use tokio::sync::Mutex;
use tracing::{error, info, warn};

use crate::error::{AppError, AppResult};

/// Thông tin chi tiết một phân vùng ổ đĩa
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskPartitionInfo {
    pub name: String,
    pub mount_point: String,
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub used_bytes: u64,
    pub usage_percent: f32,
    pub file_system: String,
}

/// Dữ liệu đo lường phần cứng thời gian thực gửi lên Frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareMetrics {
    pub timestamp: u64,

    // CPU Metrics
    pub cpu_usage_total: f32,
    pub cpu_usage_per_core: Vec<f32>,
    pub cpu_name: String,
    pub cpu_core_count: usize,
    pub cpu_frequency_mhz: u64,

    // RAM Metrics
    pub ram_total_bytes: u64,
    pub ram_used_bytes: u64,
    pub ram_available_bytes: u64,
    pub ram_usage_percent: f32,

    // Pagefile / Swap
    pub swap_total_bytes: u64,
    pub swap_used_bytes: u64,

    // Disk Throughput & Partitions
    pub disk_read_mbps: f64,
    pub disk_write_mbps: f64,
    pub disks: Vec<DiskPartitionInfo>,

    // Network Speeds
    pub net_upload_kbps: f64,
    pub net_download_kbps: f64,

    // System Uptime
    pub uptime_seconds: u64,
}

/// Thông tin tổng quan hệ thống máy tính
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    pub os_name: String,
    pub os_version: String,
    pub kernel_version: String,
    pub host_name: String,
    pub cpu_brand: String,
    pub cpu_core_count: usize,
    pub total_memory_bytes: u64,
    pub disks: Vec<DiskPartitionInfo>,
}

/// Collector quản lý state của sysinfo và tính toán tốc độ I/O
pub struct MetricsCollector {
    system: System,
    networks: Networks,
    disks: Disks,
    last_refresh: Instant,
    last_metrics: Option<HardwareMetrics>,
}

impl MetricsCollector {
    /// Khởi tạo collector với cấu hình tối ưu để tiết kiệm RAM (< 20MB)
    pub fn new() -> Self {
        let refresh_kind = RefreshKind::new()
            .with_cpu(CpuRefreshKind::everything())
            .with_memory(MemoryRefreshKind::everything());

        let mut system = System::new_with_specifics(refresh_kind);
        system.refresh_cpu_usage();
        system.refresh_memory();

        let networks = Networks::new_with_refreshed_list();
        let disks = Disks::new_with_refreshed_list();

        Self {
            system,
            networks,
            disks,
            last_refresh: Instant::now(),
            last_metrics: None,
        }
    }

    /// Thu thập và tính toán metrics hiện tại
    pub fn collect(&mut self) -> AppResult<HardwareMetrics> {
        let now = Instant::now();
        let elapsed_secs = (now.duration_since(self.last_refresh).as_secs_f64()).max(0.1);
        self.last_refresh = now;

        // 1. Refresh CPU & RAM
        self.system.refresh_cpu_usage();
        self.system.refresh_memory();

        // 2. Refresh Networks
        self.networks.refresh();

        // 3. Refresh Disks thông tin phân vùng
        self.disks.refresh();

        // 4. Refresh I/O tiến trình để tính Disk Read/Write throughput
        let proc_kind = ProcessRefreshKind::new().with_disk_usage();
        self.system.refresh_processes_specifics(proc_kind);

        // Tính tổng Disk I/O từ các tiến trình đang hoạt động
        let mut total_disk_read_bytes: u64 = 0;
        let mut total_disk_written_bytes: u64 = 0;
        for process in self.system.processes().values() {
            let usage = process.disk_usage();
            total_disk_read_bytes = total_disk_read_bytes.saturating_add(usage.read_bytes);
            total_disk_written_bytes = total_disk_written_bytes.saturating_add(usage.written_bytes);
        }

        let disk_read_mbps = (total_disk_read_bytes as f64 / (1024.0 * 1024.0)) / elapsed_secs;
        let disk_write_mbps = (total_disk_written_bytes as f64 / (1024.0 * 1024.0)) / elapsed_secs;

        // Tính tổng Network upload/download speeds
        let mut total_net_rx: u64 = 0;
        let mut total_net_tx: u64 = 0;
        for (_interface_name, data) in self.networks.iter() {
            total_net_rx = total_net_rx.saturating_add(data.received());
            total_net_tx = total_net_tx.saturating_add(data.transmitted());
        }

        let net_download_kbps = (total_net_rx as f64 / 1024.0) / elapsed_secs;
        let net_upload_kbps = (total_net_tx as f64 / 1024.0) / elapsed_secs;

        // CPU metrics
        let cpu_usage_total = self.system.global_cpu_info().cpu_usage();
        let cpu_usage_per_core: Vec<f32> = self.system.cpus().iter().map(|c| c.cpu_usage()).collect();
        let cpu_name = self.system.cpus().first()
            .map(|c| c.brand().trim().to_string())
            .unwrap_or_else(|| "Unknown Processor".to_string());
        let cpu_core_count = self.system.cpus().len();
        let cpu_frequency_mhz = self.system.cpus().first()
            .map(|c| c.frequency())
            .unwrap_or_default();

        // RAM metrics
        let ram_total_bytes = self.system.total_memory();
        let ram_used_bytes = self.system.used_memory();
        let ram_available_bytes = self.system.available_memory();
        let ram_usage_percent = if ram_total_bytes > 0 {
            ((ram_used_bytes as f64 / ram_total_bytes as f64) * 100.0) as f32
        } else {
            0.0
        };

        // Swap / Pagefile
        let swap_total_bytes = self.system.total_swap();
        let swap_used_bytes = self.system.used_swap();

        // Disks partition list
        let mut disk_partitions = Vec::new();
        for disk in self.disks.iter() {
            let total = disk.total_space();
            let avail = disk.available_space();
            let used = total.saturating_sub(avail);
            let pct = if total > 0 {
                ((used as f64 / total as f64) * 100.0) as f32
            } else {
                0.0
            };

            disk_partitions.push(DiskPartitionInfo {
                name: disk.name().to_string_lossy().to_string(),
                mount_point: disk.mount_point().to_string_lossy().to_string(),
                total_bytes: total,
                available_bytes: avail,
                used_bytes: used,
                usage_percent: pct,
                file_system: disk.file_system().to_string_lossy().to_string(),
            });
        }

        let uptime_seconds = System::uptime();
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or_default();

        let metrics = HardwareMetrics {
            timestamp,
            cpu_usage_total,
            cpu_usage_per_core,
            cpu_name,
            cpu_core_count,
            cpu_frequency_mhz,
            ram_total_bytes,
            ram_used_bytes,
            ram_available_bytes,
            ram_usage_percent,
            swap_total_bytes,
            swap_used_bytes,
            disk_read_mbps,
            disk_write_mbps,
            disks: disk_partitions,
            net_upload_kbps,
            net_download_kbps,
            uptime_seconds,
        };

        self.last_metrics = Some(metrics.clone());
        Ok(metrics)
    }

    /// Lấy thông tin cố định của hệ điều hành và phần cứng
    pub fn get_system_info(&mut self) -> AppResult<SystemInfo> {
        let os_name = System::name().unwrap_or_else(|| "Windows".to_string());
        let os_version = System::os_version().unwrap_or_else(|| "Unknown".to_string());
        let kernel_version = System::kernel_version().unwrap_or_else(|| "Unknown".to_string());
        let host_name = System::host_name().unwrap_or_else(|| "LocalPC".to_string());

        let cpu_brand = self.system.cpus().first()
            .map(|c| c.brand().trim().to_string())
            .unwrap_or_else(|| "Unknown CPU".to_string());
        let cpu_core_count = self.system.cpus().len();
        let total_memory_bytes = self.system.total_memory();

        self.disks.refresh();
        let mut disk_partitions = Vec::new();
        for disk in self.disks.iter() {
            let total = disk.total_space();
            let avail = disk.available_space();
            let used = total.saturating_sub(avail);
            let pct = if total > 0 {
                ((used as f64 / total as f64) * 100.0) as f32
            } else {
                0.0
            };

            disk_partitions.push(DiskPartitionInfo {
                name: disk.name().to_string_lossy().to_string(),
                mount_point: disk.mount_point().to_string_lossy().to_string(),
                total_bytes: total,
                available_bytes: avail,
                used_bytes: used,
                usage_percent: pct,
                file_system: disk.file_system().to_string_lossy().to_string(),
            });
        }

        Ok(SystemInfo {
            os_name,
            os_version,
            kernel_version,
            host_name,
            cpu_brand,
            cpu_core_count,
            total_memory_bytes,
            disks: disk_partitions,
        })
    }
}

/// Trạng thái MetricsState được chia sẻ an toàn luồng với Tauri
#[derive(Clone)]
pub struct MetricsState {
    collector: Arc<Mutex<MetricsCollector>>,
}

impl MetricsState {
    pub fn new() -> Self {
        Self {
            collector: Arc::new(Mutex::new(MetricsCollector::new())),
        }
    }

    /// Lấy metrics hiện tại bất đồng bộ, không block main thread
    pub async fn get_metrics(&self) -> AppResult<HardwareMetrics> {
        let collector = self.collector.clone();
        tokio::task::spawn_blocking(move || {
            let mut guard = collector.blocking_lock();
            guard.collect()
        })
        .await
        .map_err(|e| AppError::HardwareMetricsError(format!("Task spawn_blocking failed: {}", e)))?
    }

    /// Lấy system info bất đồng bộ
    pub async fn get_system_info(&self) -> AppResult<SystemInfo> {
        let collector = self.collector.clone();
        tokio::task::spawn_blocking(move || {
            let mut guard = collector.blocking_lock();
            guard.get_system_info()
        })
        .await
        .map_err(|e| AppError::HardwareMetricsError(format!("Task spawn_blocking failed: {}", e)))?
    }

    /// Khởi động vòng lặp nền định kỳ đo lường và phát event 'hardware-metrics' cho UI
    pub fn start_background_loop(&self, app_handle: tauri::AppHandle, interval_ms: u64) {
        let collector = self.collector.clone();
        tauri::async_runtime::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_millis(interval_ms));
            info!("Bắt đầu background metrics loop với chu kỳ {}ms", interval_ms);

            loop {
                ticker.tick().await;

                let collector_clone = collector.clone();
                let collect_result = tokio::task::spawn_blocking(move || {
                    let mut guard = collector_clone.blocking_lock();
                    guard.collect()
                }).await;

                match collect_result {
                    Ok(Ok(metrics)) => {
                        use tauri::Emitter;
                        if let Err(e) = app_handle.emit("hardware-metrics", &metrics) {
                            warn!("Không thể emit hardware-metrics tới Webview: {}", e);
                        }
                    }
                    Ok(Err(app_err)) => {
                        error!("Lỗi thu thập hardware metrics: {:?}", app_err);
                    }
                    Err(join_err) => {
                        error!("Lỗi join task hardware metrics: {:?}", join_err);
                    }
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_metrics_collector_creation() {
        let mut collector = MetricsCollector::new();
        let metrics = collector.collect();
        assert!(metrics.is_ok(), "Collect metrics phải thành công");
        
        let m = metrics.unwrap_or_else(|_| panic!("Failed to collect"));
        assert!(m.ram_total_bytes > 0, "RAM total phải lớn hơn 0");
        assert!(m.ram_usage_percent >= 0.0 && m.ram_usage_percent <= 100.0, "RAM % phải từ 0-100");
        assert!(m.cpu_core_count > 0, "Số lượng CPU core phải > 0");
        assert!(!m.cpu_name.is_empty(), "Tên CPU không được để trống");
    }

    #[test]
    fn test_system_info_collection() {
        let mut collector = MetricsCollector::new();
        let sys_info = collector.get_system_info();
        assert!(sys_info.is_ok(), "Get system info phải thành công");

        let info = sys_info.unwrap_or_else(|_| panic!("Failed to get sys info"));
        assert!(!info.os_name.is_empty(), "OS name không được trống");
        assert!(info.total_memory_bytes > 0, "Total memory phải > 0");
        assert!(info.cpu_core_count > 0, "CPU core count phải > 0");
    }
}

