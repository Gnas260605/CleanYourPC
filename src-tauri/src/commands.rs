use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State, Window};
use tracing::{info, warn};

use crate::cleaner::{self, CleanResult, CleanScanResult, CleanerSession};
use crate::config::{self, AppSettings};
use crate::error::AppError;
use crate::history::{self, HistorySummary, OptimizationLog};
use crate::metrics::{HardwareMetrics, MetricsState, SystemInfo};
use crate::process_guardian::{self, ProcessInfo};
use crate::restore_point;
use crate::services::{self, ServiceChangeResult, ServiceInfo};
use crate::startup::{self, StartupItem};
use crate::tray;

/// Trạng thái sức khỏe sơ bộ của hệ thống dựa trên tải hiện thời
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickHealthStatus {
    pub cpu_level: String,       // "Normal", "Warning", "Critical"
    pub ram_level: String,       // "Normal", "Warning", "Critical"
    pub overall_status: String,  // "Optimal", "High Load", "Throttled"
    pub recommendation: String,
}

/// Tauri Command: Lấy dữ liệu phần cứng thời gian thực (CPU, RAM, Disk, Net)
#[tauri::command]
pub async fn get_hardware_metrics(
    state: State<'_, MetricsState>,
) -> Result<HardwareMetrics, AppError> {
    state.get_metrics().await
}

/// Tauri Command: Lấy thông tin cố định của cấu hình máy và hệ điều hành
#[tauri::command]
pub async fn get_system_info(
    state: State<'_, MetricsState>,
) -> Result<SystemInfo, AppError> {
    state.get_system_info().await
}

/// Tauri Command: Đánh giá nhanh tình trạng tải hệ thống và đề xuất tối ưu
#[tauri::command]
pub async fn get_quick_health_status(
    state: State<'_, MetricsState>,
) -> Result<QuickHealthStatus, AppError> {
    let metrics = state.get_metrics().await?;

    let cpu_level = if metrics.cpu_usage_total > 85.0 {
        "Critical".to_string()
    } else if metrics.cpu_usage_total > 65.0 {
        "Warning".to_string()
    } else {
        "Normal".to_string()
    };

    let ram_level = if metrics.ram_usage_percent > 85.0 {
        "Critical".to_string()
    } else if metrics.ram_usage_percent > 70.0 {
        "Warning".to_string()
    } else {
        "Normal".to_string()
    };

    let (overall_status, recommendation) = match (cpu_level.as_str(), ram_level.as_str()) {
        ("Critical", _) | (_, "Critical") => (
            "Throttled".to_string(),
            "Hệ thống đang chịu tải nặng. Bạn nên kích hoạt 1-Click Boost hoặc đóng bớt tiến trình ngốn tài nguyên.".to_string(),
        ),
        ("Warning", _) | (_, "Warning") => (
            "High Load".to_string(),
            "Mức sử dụng tài nguyên đang ở ngưỡng cao. Khuyến nghị quét dọn tệp tạm và tối ưu bộ nhớ.".to_string(),
        ),
        _ => (
            "Optimal".to_string(),
            "Hệ thống đang hoạt động ở trạng thái tốt nhất.".to_string(),
        ),
    };

    info!(
        "Yêu cầu QuickHealthStatus: CPU {}% ({}), RAM {}% ({})",
        metrics.cpu_usage_total, cpu_level, metrics.ram_usage_percent, ram_level
    );

    Ok(QuickHealthStatus {
        cpu_level,
        ram_level,
        overall_status,
        recommendation,
    })
}

// ==========================================
// STARTUP MANAGEMENT COMMANDS (Sprint 2)
// ==========================================

/// Tauri Command: Lấy toàn bộ danh sách ứng dụng khởi động cùng Windows
#[tauri::command]
pub async fn get_startup_items() -> Result<Vec<StartupItem>, AppError> {
    startup::get_all_startup_items()
}

/// Tauri Command: Bật hoặc tắt an toàn một ứng dụng khởi động
#[tauri::command]
pub async fn toggle_startup_item(
    id: String,
    location: String,
    enable: bool,
) -> Result<bool, AppError> {
    startup::toggle_startup_item(&id, &location, enable)
}

/// Tauri Command: Sao lưu danh sách cấu hình khởi động Run hiện thời ra tệp JSON
#[tauri::command]
pub async fn backup_startup_registry() -> Result<String, AppError> {
    startup::export_startup_backup()
}

// ==========================================
// PROCESS GUARDIAN & OPTIMIZER (Sprint 3)
// ==========================================

/// Tauri Command: Lấy danh sách tiến trình đang thực thi sắp xếp theo mức ngốn RAM
#[tauri::command]
pub async fn get_process_list() -> Result<Vec<ProcessInfo>, AppError> {
    process_guardian::get_process_list()
}

/// Tauri Command: Bật hoặc tắt Windows 11 EcoQoS (Efficiency Mode) cho một tiến trình
#[tauri::command]
pub async fn apply_process_eco_mode(pid: u32, enable: bool) -> Result<bool, AppError> {
    process_guardian::apply_process_eco_mode(pid, enable)
}

/// Tauri Command: Dừng toàn bộ cây tiến trình (Process Tree) có bảo vệ Critical Lock
#[tauri::command]
pub async fn kill_process_tree(pid: u32) -> Result<bool, AppError> {
    process_guardian::kill_process_tree(pid)
}

/// Tauri Command: Tối ưu bộ nhớ Working Set của một tiến trình cụ thể
#[tauri::command]
pub async fn optimize_process_working_set(pid: u32) -> Result<bool, AppError> {
    process_guardian::optimize_working_set(pid)
}

// ==========================================
// DISK CLEANER COMMANDS (Sprint 3)
// ==========================================

/// Chạy tác vụ chặn (I/O, quét đĩa) trên thread pool riêng để không treo UI
async fn run_blocking<T, F>(f: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Unknown(format!("Tác vụ nền bị hủy: {}", e)))?
}

/// Tauri Command: Quét tìm các tệp tin có thể dọn dẹp (Dry-Run: chỉ tính dung lượng).
/// Kết quả được lưu vào phiên quét của backend; frontend nhận `scan_id` để dọn sau.
#[tauri::command]
pub async fn scan_cleanable_files(
    session: State<'_, Arc<CleanerSession>>,
) -> Result<CleanScanResult, AppError> {
    let session = session.inner().clone();
    run_blocking(move || cleaner::scan_into_session(&session)).await
}

/// Tauri Command: Dọn các mục đã chọn theo id trong phiên quét (không nhận đường dẫn thô từ UI)
#[tauri::command]
pub async fn clean_files(
    session: State<'_, Arc<CleanerSession>>,
    scan_id: String,
    item_ids: Vec<String>,
) -> Result<CleanResult, AppError> {
    let session = session.inner().clone();
    let result =
        run_blocking(move || cleaner::clean_from_session(&session, &scan_id, &item_ids)).await?;

    let log = OptimizationLog::new(
        "Safe Cleaner",
        result.freed_bytes,
        result.success_count,
        result.skipped_locked_count,
        format!(
            "Dọn {} tệp rác trong phiên quét (thất bại {}, bị khóa {})",
            result.success_count, result.failed_count, result.skipped_locked_count
        ),
    );
    if let Err(e) = history::record_log(log) {
        warn!("Không ghi được lịch sử dọn dẹp: {:?}", e);
    }

    Ok(result)
}

// ==========================================
// WINDOWS SERVICES
// ==========================================

/// Ghi lịch sử cho thao tác dịch vụ (không làm hỏng kết quả nếu ghi lỗi)
fn record_service_history(result: &ServiceChangeResult) {
    let log = OptimizationLog::new("Windows Services", 0, 1, 0, result.message.clone());
    if let Err(e) = history::record_log(log) {
        warn!("Không ghi được lịch sử dịch vụ: {:?}", e);
    }
}

/// Tauri Command: Đọc trạng thái thật các dịch vụ trong danh mục hỗ trợ
#[tauri::command]
pub async fn get_services() -> Result<Vec<ServiceInfo>, AppError> {
    run_blocking(services::get_services).await
}

/// Tauri Command: Đổi startup type dịch vụ được phép (sao lưu giá trị gốc trước)
#[tauri::command]
pub async fn set_service_startup(
    name: String,
    startup_type: String,
    stop_now: bool,
) -> Result<ServiceChangeResult, AppError> {
    let result =
        run_blocking(move || services::set_service_startup(&name, &startup_type, stop_now)).await?;
    record_service_history(&result);
    Ok(result)
}

/// Tauri Command: Hoàn tác dịch vụ về startup type gốc đã sao lưu
#[tauri::command]
pub async fn restore_service_startup(name: String) -> Result<ServiceChangeResult, AppError> {
    let result = run_blocking(move || services::restore_service_startup(&name)).await?;
    record_service_history(&result);
    Ok(result)
}

// ==========================================
// RESTORE POINT COMMANDS (Sprint 2)
// ==========================================

/// Tauri Command: Tạo điểm khôi phục hệ thống (System Restore Point)
#[tauri::command]
pub async fn create_system_restore_point(description: String) -> Result<bool, AppError> {
    restore_point::create_restore_point(&description)
}

// ==========================================
// APP SETTINGS COMMANDS (Sprint 4)
// ==========================================

/// Tauri Command: Lấy cấu hình ứng dụng hiện thời
#[tauri::command]
pub async fn get_app_settings() -> Result<AppSettings, AppError> {
    config::load_settings()
}

/// Tauri Command: Lưu cấu hình ứng dụng và cập nhật Registry Auto-start
#[tauri::command]
pub async fn save_app_settings(settings: AppSettings) -> Result<AppSettings, AppError> {
    config::save_settings(settings)
}

// ==========================================
// OPTIMIZATION HISTORY COMMANDS (Sprint 4)
// ==========================================

/// Tauri Command: Lấy tóm tắt và danh sách toàn bộ lịch sử tối ưu
#[tauri::command]
pub async fn get_optimization_history() -> Result<HistorySummary, AppError> {
    history::get_history()
}

/// Tauri Command: Ghi nhận một bản ghi tối ưu mới vào lịch sử
#[tauri::command]
pub async fn record_optimization_log(log: OptimizationLog) -> Result<HistorySummary, AppError> {
    history::record_log(log)
}

/// Tauri Command: Xóa sạch toàn bộ lịch sử tối ưu
#[tauri::command]
pub async fn clear_history() -> Result<bool, AppError> {
    history::clear_history()
}

// ==========================================
// SYSTEM TRAY & QUICK BOOST COMMANDS (Sprint 5)
// ==========================================

/// Tauri Command: Kích hoạt tác vụ tối ưu nhanh (Quick Boost)
#[tauri::command]
pub async fn trigger_quick_boost(app: AppHandle) -> Result<OptimizationLog, AppError> {
    run_blocking(move || tray::perform_quick_boost(&app)).await
}

// ==========================================
// WINDOW CONTROL COMMANDS (Frameless / Custom TitleBar)
// ==========================================

/// Tauri Command: Thu nhỏ cửa sổ xuống Taskbar
#[tauri::command]
pub async fn window_minimize(window: Window) -> Result<(), AppError> {
    window.minimize().map_err(|e| AppError::TauriError(e.to_string()))
}

/// Tauri Command: Phóng to hoặc khôi phục kích thước cửa sổ
#[tauri::command]
pub async fn window_maximize(window: Window) -> Result<(), AppError> {
    let is_max = window.is_maximized().map_err(|e| AppError::TauriError(e.to_string()))?;
    if is_max {
        window.unmaximize().map_err(|e| AppError::TauriError(e.to_string()))
    } else {
        window.maximize().map_err(|e| AppError::TauriError(e.to_string()))
    }
}

/// Tauri Command: Đóng cửa sổ (sẽ trigger CloseRequested để ẩn xuống Tray nếu bật)
#[tauri::command]
pub async fn window_close(window: Window) -> Result<(), AppError> {
    window.close().map_err(|e| AppError::TauriError(e.to_string()))
}

/// Tauri Command: Kiểm tra xem cửa sổ hiện có đang phóng to hết cỡ hay không
#[tauri::command]
pub async fn window_is_maximized(window: Window) -> Result<bool, AppError> {
    window.is_maximized().map_err(|e| AppError::TauriError(e.to_string()))
}


