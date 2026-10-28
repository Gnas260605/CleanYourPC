use serde::{Deserialize, Serialize};
use tracing::{error, info, warn};
use windows::Win32::Foundation::{GetLastError, ERROR_ACCESS_DENIED, ERROR_SERVICE_DISABLED};
use windows::Win32::System::Restore::{
    SRSetRestorePointW, RESTOREPOINTINFOW, STATEMGRSTATUS,
    BEGIN_SYSTEM_CHANGE, END_SYSTEM_CHANGE, MODIFY_SETTINGS,
    RESTOREPOINTINFO_EVENT_TYPE, RESTOREPOINTINFO_TYPE,
};

use crate::error::{AppError, AppResult};

/// Cấu hình thông số tạo Điểm khôi phục hệ thống (Restore Point)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestorePointConfig {
    pub description: String,
    pub event_type: u32,
    pub restore_point_type: u32,
}

impl Default for RestorePointConfig {
    fn default() -> Self {
        Self {
            description: "WinPulse System Optimization Restore Point".to_string(),
            event_type: BEGIN_SYSTEM_CHANGE.0,
            restore_point_type: MODIFY_SETTINGS.0,
        }
    }
}

/// Tạo Điểm khôi phục hệ thống (System Restore Point) an toàn qua Win32 API SRSetRestorePointW.
/// Tuyệt đối không panic hoặc crash; xử lý các trường hợp service bị tắt hoặc thiếu quyền Administrator.
pub fn create_restore_point(description: &str) -> AppResult<bool> {
    let clean_desc = if description.trim().is_empty() {
        "WinPulse Auto Restore Point"
    } else {
        description.trim()
    };

    let config = RestorePointConfig {
        description: clean_desc.to_string(),
        event_type: BEGIN_SYSTEM_CHANGE.0,
        restore_point_type: MODIFY_SETTINGS.0,
    };

    create_restore_point_with_config(&config)
}

/// Tạo Điểm khôi phục với cấu hình tùy biến
pub fn create_restore_point_with_config(config: &RestorePointConfig) -> AppResult<bool> {
    info!("Bắt đầu tạo System Restore Point: '{}'", config.description);

    // Chuẩn bị buffer UTF-16 cố định 256 ký tự cho szDescription trong struct packed
    let mut desc_buf = [0u16; 256];
    let wide_chars: Vec<u16> = config.description.encode_utf16().collect();
    let copy_len = wide_chars.len().min(255);
    for (i, &ch) in wide_chars.iter().take(copy_len).enumerate() {
        desc_buf[i] = ch;
    }
    desc_buf[copy_len] = 0;

    let start_info = RESTOREPOINTINFOW {
        dwEventType: RESTOREPOINTINFO_EVENT_TYPE(config.event_type),
        dwRestorePtType: RESTOREPOINTINFO_TYPE(config.restore_point_type),
        llSequenceNumber: 0,
        szDescription: desc_buf,
    };

    let mut status: STATEMGRSTATUS = unsafe { std::mem::zeroed() };

    let success = unsafe { SRSetRestorePointW(&start_info, &mut status) };
    let status_code = status.nStatus.0;
    let seq_num = status.llSequenceNumber;

    if !success.as_bool() || status_code != 0 {
        let err_code = if status_code != 0 {
            status_code
        } else {
            unsafe { GetLastError().0 }
        };

        error!("Lỗi gọi SRSetRestorePointW: mã trạng thái {}", err_code);

        return match err_code {
            code if code == ERROR_ACCESS_DENIED.0 || code == 5 => {
                Err(AppError::PermissionDenied(
                    "Cần quyền Quản trị viên (Run as Administrator) để tạo Điểm khôi phục hệ thống Windows.".to_string(),
                ))
            }
            code if code == ERROR_SERVICE_DISABLED.0 || code == 1058 => {
                Err(AppError::SystemError(
                    "Tính năng System Restore hoặc dịch vụ Volume Shadow Copy (VSS) đang bị tắt trên Windows. Vui lòng bật System Restore trong mục System Protection Settings.".to_string(),
                ))
            }
            112 => {
                Err(AppError::SystemError(
                    "Ổ đĩa hệ thống không đủ dung lượng trống để tạo điểm khôi phục.".to_string(),
                ))
            }
            other => {
                Err(AppError::SystemError(format!(
                    "Không thể tạo điểm khôi phục hệ thống (Mã lỗi Windows: {}). Vui lòng kiểm tra dịch vụ System Restore.",
                    other
                )))
            }
        };
    }

    info!(
        "Khởi tạo restore point thành công, SequenceNumber = {}",
        seq_num
    );

    // Hoàn tất chuỗi điểm khôi phục với END_SYSTEM_CHANGE
    let end_info = RESTOREPOINTINFOW {
        dwEventType: END_SYSTEM_CHANGE,
        dwRestorePtType: RESTOREPOINTINFO_TYPE(config.restore_point_type),
        llSequenceNumber: seq_num,
        szDescription: [0u16; 256],
    };

    let mut end_status: STATEMGRSTATUS = unsafe { std::mem::zeroed() };
    let end_success = unsafe { SRSetRestorePointW(&end_info, &mut end_status) };
    let end_status_code = end_status.nStatus.0;

    if !end_success.as_bool() || end_status_code != 0 {
        let end_err = if end_status_code != 0 {
            end_status_code
        } else {
            unsafe { GetLastError().0 }
        };
        warn!(
            "Cảnh báo: Không thể hoàn tất chuỗi điểm khôi phục (Sequence: {}, mã: {})",
            seq_num, end_err
        );
    } else {
        info!(
            "Điểm khôi phục '{}' (Sequence: {}) đã được ghi nhận hoàn tất an toàn.",
            config.description, seq_num
        );
    }

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_restore_point_config_default() {
        let config = RestorePointConfig::default();
        assert!(!config.description.is_empty());
        assert_eq!(config.event_type, BEGIN_SYSTEM_CHANGE.0);
        assert_eq!(config.restore_point_type, MODIFY_SETTINGS.0);
    }

    #[test]
    fn test_create_restore_point_graceful_handling() {
        // Test này kiểm tra việc gọi create_restore_point không gây crash / panic
        // Trong môi trường non-admin hoặc CI, nó sẽ trả về Err(AppError::PermissionDenied) hoặc Err(AppError::SystemError),
        // còn trong môi trường admin có System Restore bật thì trả về Ok(true).
        let result = create_restore_point("WinPulse Unit Test Restore Point");
        match result {
            Ok(created) => {
                info!("Tạo restore point thành công trong test: {}", created);
                assert!(created);
            }
            Err(AppError::PermissionDenied(msg)) => {
                info!("Xử lý phân quyền chính xác: {}", msg);
                assert!(msg.contains("Quản trị viên"));
            }
            Err(AppError::SystemError(msg)) => {
                info!("Xử lý lỗi dịch vụ tắt hoặc hệ thống chính xác: {}", msg);
                assert!(!msg.is_empty());
            }
            Err(other) => {
                info!("Lỗi khác nhưng không panic: {:?}", other);
            }
        }
    }
}
