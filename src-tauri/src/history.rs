use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use crate::error::{AppError, AppResult};

/// Bản ghi chi tiết của một phiên tối ưu hệ thống
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OptimizationLog {
    /// Định danh duy nhất (UUID hoặc timestamp-based ID)
    pub id: String,
    /// Thời điểm thực thi tính bằng epoch giây
    pub timestamp: i64,
    /// Loại hành động: "Safe Cleaner", "Quick Boost", "Process Eco-Mode", v.v.
    pub action_type: String,
    /// Dung lượng ổ đĩa / bộ nhớ giải phóng được (bytes)
    pub freed_bytes: u64,
    /// Số lượng tệp tin hoặc tiến trình đã dọn dẹp / tối ưu thành công
    pub items_cleaned: usize,
    /// Số lượng tệp bị khóa (Locked Files) được bỏ qua an toàn
    pub items_skipped_locked: usize,
    /// Mô tả chi tiết hoặc thông tin bổ sung
    pub details: String,
}

impl OptimizationLog {
    /// Tiện ích khởi tạo một bản ghi tối ưu mới với timestamp tự động
    pub fn new(
        action_type: impl Into<String>,
        freed_bytes: u64,
        items_cleaned: usize,
        items_skipped_locked: usize,
        details: impl Into<String>,
    ) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();
        let timestamp = now.as_secs() as i64;
        let id = format!("{}-{}", timestamp, now.subsec_nanos());

        Self {
            id,
            timestamp,
            action_type: action_type.into(),
            freed_bytes,
            items_cleaned,
            items_skipped_locked,
            details: details.into(),
        }
    }
}

/// Tổng hợp thống kê lịch sử tối ưu
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct HistorySummary {
    /// Tổng dung lượng đã giải phóng tích lũy qua tất cả các phiên (bytes)
    pub total_freed_bytes: u64,
    /// Tổng số phiên tối ưu đã ghi nhận
    pub total_sessions: usize,
    /// Danh sách các bản ghi lịch sử, sắp xếp từ mới nhất đến cũ nhất
    pub logs: Vec<OptimizationLog>,
}

/// Trả về đường dẫn chuẩn của tệp history.json tại %LOCALAPPDATA%\WinPulseOptimizer\history.json
pub fn get_history_file_path() -> PathBuf {
    let base = env::var("LOCALAPPDATA").unwrap_or_else(|_| {
        env::var("USERPROFILE")
            .map(|p| format!(r"{}\AppData\Local", p))
            .unwrap_or_else(|_| ".".to_string())
    });
    Path::new(&base).join("WinPulseOptimizer").join("history.json")
}

/// Đọc lịch sử từ một tệp chỉ định (hỗ trợ kiểm thử an toàn)
pub fn get_history_from_path(path: &Path) -> AppResult<HistorySummary> {
    if !path.exists() {
        return Ok(HistorySummary::default());
    }

    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(err) => {
            warn!("Không thể đọc tệp lịch sử {:?}: {}. Trả về rỗng.", path, err);
            return Ok(HistorySummary::default());
        }
    };

    match serde_json::from_str::<HistorySummary>(&content) {
        Ok(summary) => Ok(summary),
        Err(err) => {
            warn!("Dữ liệu tệp lịch sử {:?} không đúng định dạng: {}. Khởi tạo mới.", path, err);
            Ok(HistorySummary::default())
        }
    }
}

/// Ghi một bản ghi lịch sử mới vào tệp chỉ định và tính toán lại thống kê tổng hợp
pub fn record_log_to_path(log: OptimizationLog, path: &Path) -> AppResult<HistorySummary> {
    // 1. Tự động tạo thư mục cha nếu chưa có
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| {
                AppError::IoError(format!(
                    "Không thể tạo thư mục lưu lịch sử {:?}: {}",
                    parent, e
                ))
            })?;
        }
    }

    // 2. Đọc tóm tắt hiện có
    let mut summary = get_history_from_path(path).unwrap_or_default();

    // 3. Chèn bản ghi mới lên đầu danh sách
    summary.logs.insert(0, log);

    // 4. Cập nhật số liệu thống kê tích lũy
    summary.total_sessions = summary.logs.len();
    summary.total_freed_bytes = summary.logs.iter().map(|l| l.freed_bytes).sum();

    // 5. Lưu lại vào tệp JSON
    let json_data = serde_json::to_string_pretty(&summary).map_err(|e| {
        AppError::InvalidState(format!("Lỗi chuyển đổi lịch sử sang JSON: {}", e))
    })?;

    fs::write(path, json_data).map_err(|e| {
        AppError::IoError(format!("Không thể lưu tệp lịch sử {:?}: {}", path, e))
    })?;

    info!(
        "Đã ghi nhận phiên tối ưu. Tổng phiên: {}, Tổng dung lượng giải phóng: {} bytes",
        summary.total_sessions, summary.total_freed_bytes
    );

    Ok(summary)
}

/// Xóa toàn bộ lịch sử tối ưu tại tệp chỉ định
pub fn clear_history_at_path(path: &Path) -> AppResult<bool> {
    if !path.exists() {
        return Ok(true);
    }

    let empty_summary = HistorySummary::default();
    let json_data = serde_json::to_string_pretty(&empty_summary).map_err(|e| {
        AppError::InvalidState(format!("Lỗi chuyển đổi lịch sử rỗng sang JSON: {}", e))
    })?;

    fs::write(path, json_data).map_err(|e| {
        AppError::IoError(format!("Không thể làm sạch tệp lịch sử {:?}: {}", path, e))
    })?;

    info!("Đã xóa sạch lịch sử tối ưu tại {:?}", path);
    Ok(true)
}

/// Lấy toàn bộ lịch sử tối ưu hệ thống từ %LOCALAPPDATA%\WinPulseOptimizer\history.json
pub fn get_history() -> AppResult<HistorySummary> {
    let path = get_history_file_path();
    get_history_from_path(&path)
}

/// Ghi nhận một bản ghi tối ưu mới vào hệ thống
pub fn record_log(log: OptimizationLog) -> AppResult<HistorySummary> {
    let path = get_history_file_path();
    record_log_to_path(log, &path)
}

/// Xóa toàn bộ lịch sử tối ưu hệ thống
pub fn clear_history() -> AppResult<bool> {
    let path = get_history_file_path();
    clear_history_at_path(&path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_history_lifecycle() {
        let temp_dir = env::temp_dir().join("winpulse_test_history");
        let _ = fs::remove_dir_all(&temp_dir);
        let history_file = temp_dir.join("subfolder").join("history.json");

        // 1. Kiểm tra khi file chưa tồn tại
        let initial = get_history_from_path(&history_file).unwrap_or_default();
        assert_eq!(initial.total_sessions, 0);
        assert_eq!(initial.total_freed_bytes, 0);
        assert!(initial.logs.is_empty());

        // 2. Thêm bản ghi đầu tiên
        let log1 = OptimizationLog::new(
            "Safe Cleaner",
            1024 * 1024 * 150, // 150 MB
            42,
            3,
            "Xóa tệp tạm Windows Temp và Prefetch an toàn",
        );
        let summary1 = record_log_to_path(log1.clone(), &history_file).unwrap_or_default();
        assert_eq!(summary1.total_sessions, 1);
        assert_eq!(summary1.total_freed_bytes, 1024 * 1024 * 150);
        assert_eq!(summary1.logs.len(), 1);
        assert_eq!(summary1.logs[0].action_type, "Safe Cleaner");

        // 3. Thêm bản ghi thứ hai
        let log2 = OptimizationLog::new(
            "Quick Boost",
            1024 * 1024 * 50, // 50 MB
            5,
            0,
            "Tối ưu Working Set RAM",
        );
        let summary2 = record_log_to_path(log2.clone(), &history_file).unwrap_or_default();
        assert_eq!(summary2.total_sessions, 2);
        assert_eq!(summary2.total_freed_bytes, 1024 * 1024 * 200);
        assert_eq!(summary2.logs.len(), 2);
        // Bản ghi mới nhất phải ở đầu
        assert_eq!(summary2.logs[0].action_type, "Quick Boost");
        assert_eq!(summary2.logs[1].action_type, "Safe Cleaner");

        // 4. Xóa lịch sử
        let clear_res = clear_history_at_path(&history_file);
        assert!(clear_res.is_ok());

        let cleared = get_history_from_path(&history_file).unwrap_or_default();
        assert_eq!(cleared.total_sessions, 0);
        assert_eq!(cleared.total_freed_bytes, 0);
        assert!(cleared.logs.is_empty());

        // Dọn dẹp
        let _ = fs::remove_dir_all(&temp_dir);
    }
}
