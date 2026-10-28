use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Các loại lỗi toàn cục của ứng dụng WinPulse Optimizer.
/// Tuân thủ quy chuẩn: serialize thân thiện với Frontend, không bao giờ dùng unwrap/expect.
#[derive(Error, Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "details")]
pub enum AppError {
    #[error("Lỗi đo lường phần cứng: {0}")]
    HardwareMetricsError(String),

    #[error("Lỗi I/O tệp tin: {0}")]
    IoError(String),

    #[error("Không có quyền truy cập (Permission Denied): {0}")]
    PermissionDenied(String),

    #[error("Đường dẫn không hợp lệ hoặc nằm trong danh sách cấm bảo vệ: {0}")]
    InvalidPath(String),

    #[error("Lỗi hệ thống Windows API: {0}")]
    SystemError(String),

    #[error("Lỗi Registry: {0}")]
    RegistryError(String),

    #[error("Tài nguyên đang bận hoặc tệp bị khóa: {0}")]
    ResourceBusy(String),

    #[error("Lỗi nội bộ Tauri: {0}")]
    TauriError(String),

    #[error("Lỗi cấu hình hoặc trạng thái không hợp lệ: {0}")]
    InvalidState(String),

    #[error("Lỗi không xác định: {0}")]
    Unknown(String),
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        // Kiểm tra mã lỗi raw OS trên Windows:
        // ERROR_SHARING_VIOLATION = 32
        // ERROR_LOCK_VIOLATION = 33
        if let Some(code) = err.raw_os_error() {
            if code == 32 || code == 33 {
                return AppError::ResourceBusy(format!(
                    "Tệp đang bị tiến trình khác chiếm giữ (Sharing Violation, mã {}): {}",
                    code, err
                ));
            }
        }

        match err.kind() {
            std::io::ErrorKind::PermissionDenied => AppError::PermissionDenied(err.to_string()),
            std::io::ErrorKind::NotFound => AppError::IoError(format!("Không tìm thấy tệp/thư mục: {}", err)),
            std::io::ErrorKind::ResourceBusy => AppError::ResourceBusy(err.to_string()),
            _ => AppError::IoError(err.to_string()),
        }
    }
}

impl From<tauri::Error> for AppError {
    fn from(err: tauri::Error) -> Self {
        AppError::TauriError(err.to_string())
    }
}

#[cfg(windows)]
impl From<windows::core::Error> for AppError {
    fn from(err: windows::core::Error) -> Self {
        AppError::SystemError(format!("Windows API Error (0x{:08X}): {}", err.code().0, err.message()))
    }
}

/// Type alias tiện ích cho Result trong toàn bộ backend
pub type AppResult<T> = Result<T, AppError>;
