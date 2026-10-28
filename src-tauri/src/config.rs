use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};
use winreg::enums::*;
use winreg::RegKey;

use crate::error::{AppError, AppResult};

const REG_RUN_PATH: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const APP_REG_NAME: &str = "WinPulseOptimizer";

/// Cấu hình toàn cục của WinPulse Optimizer
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppSettings {
    /// Tự động khởi động cùng Windows
    pub auto_start_on_boot: bool,
    /// Đóng cửa sổ sẽ ẩn xuống khay hệ thống (System Tray)
    pub minimize_to_tray: bool,
    /// Chu kỳ thu thập chỉ số phần cứng (mili-giây)
    pub poll_interval_ms: u64,
    /// Bật/tắt hiệu ứng đồ họa giao diện
    pub visual_effects: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            auto_start_on_boot: false,
            minimize_to_tray: true,
            poll_interval_ms: 1500,
            visual_effects: true,
        }
    }
}

/// Trả về đường dẫn chuẩn của tệp settings.json tại %LOCALAPPDATA%\WinPulseOptimizer\settings.json
pub fn get_settings_file_path() -> PathBuf {
    let base = env::var("LOCALAPPDATA").unwrap_or_else(|_| {
        env::var("USERPROFILE")
            .map(|p| format!(r"{}\AppData\Local", p))
            .unwrap_or_else(|_| ".".to_string())
    });
    Path::new(&base).join("WinPulseOptimizer").join("settings.json")
}

/// Đọc cấu hình từ một đường dẫn tùy chọn (hỗ trợ kiểm thử an toàn)
pub fn load_settings_from_path(path: &Path) -> AppResult<AppSettings> {
    if !path.exists() {
        info!("Tệp cấu hình chưa tồn tại tại {:?}. Sử dụng cấu hình mặc định.", path);
        return Ok(AppSettings::default());
    }

    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(err) => {
            warn!("Không thể đọc tệp cấu hình {:?}: {}. Trở về mặc định.", path, err);
            return Ok(AppSettings::default());
        }
    };

    match serde_json::from_str::<AppSettings>(&content) {
        Ok(settings) => Ok(settings),
        Err(err) => {
            warn!("Nội dung tệp cấu hình {:?} bị lỗi ({}), sử dụng cấu hình mặc định.", path, err);
            Ok(AppSettings::default())
        }
    }
}

/// Lưu cấu hình vào đường dẫn tùy chọn và tùy biến việc cập nhật Windows Registry
pub fn save_settings_to_path(
    settings: &AppSettings,
    path: &Path,
    update_registry: bool,
) -> AppResult<AppSettings> {
    // 1. Tự động tạo thư mục cha nếu chưa tồn tại
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| {
                AppError::IoError(format!(
                    "Không thể tạo thư mục lưu cấu hình tại {:?}: {}",
                    parent, e
                ))
            })?;
        }
    }

    // 2. Chuyển đổi sang định dạng JSON có format đẹp
    let json_data = serde_json::to_string_pretty(settings).map_err(|e| {
        AppError::InvalidState(format!("Lỗi mã hóa JSON cấu hình: {}", e))
    })?;

    // 3. Ghi dữ liệu an toàn vào tệp
    fs::write(path, json_data).map_err(|e| {
        AppError::IoError(format!("Không thể ghi tệp cấu hình tại {:?}: {}", path, e))
    })?;

    // 4. Xử lý cập nhật Windows Registry cho Run Key (Auto-start on Boot)
    if update_registry {
        if let Err(err) = sync_auto_start_registry(settings.auto_start_on_boot) {
            warn!("Cảnh báo: Không thể đồng bộ Registry Auto-start: {}", err);
            // Không ngắt luồng hoàn toàn nếu user không đủ quyền ghi Registry,
            // nhưng trả về lỗi nếu cần thiết hoặc log cảnh báo.
        }
    }

    info!("Lưu cấu hình thành công vào {:?}", path);
    Ok(settings.clone())
}

/// Đồng bộ trạng thái Auto-start on Boot vào `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
pub fn sync_auto_start_registry(enable: bool) -> AppResult<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    if enable {
        let current_exe = env::current_exe().map_err(|e| {
            AppError::IoError(format!(
                "Không thể xác định đường dẫn thực thi ứng dụng: {}",
                e
            ))
        })?;

        let exe_path_str = format!("\"{}\"", current_exe.to_string_lossy());

        let (run_key, _) = hkcu
            .create_subkey_with_flags(REG_RUN_PATH, KEY_SET_VALUE)
            .map_err(|e| {
                AppError::RegistryError(format!(
                    "Không thể mở/tạo Registry key Run (HKCU\\{}): {}",
                    REG_RUN_PATH, e
                ))
            })?;

        run_key
            .set_value(APP_REG_NAME, &exe_path_str)
            .map_err(|e| {
                AppError::RegistryError(format!(
                    "Không thể thiết lập giá trị tự khởi động '{}': {}",
                    APP_REG_NAME, e
                ))
            })?;

        info!("Đã kích hoạt tự khởi động cùng Windows: {}", exe_path_str);
    } else {
        if let Ok(run_key) = hkcu.open_subkey_with_flags(REG_RUN_PATH, KEY_SET_VALUE) {
            // Xóa giá trị nếu tồn tại; bỏ qua nếu không tìm thấy
            let _ = run_key.delete_value(APP_REG_NAME);
            info!("Đã hủy bỏ tự khởi động cùng Windows cho '{}'", APP_REG_NAME);
        }
    }

    Ok(())
}

/// Đọc cấu hình từ %LOCALAPPDATA%\WinPulseOptimizer\settings.json
pub fn load_settings() -> AppResult<AppSettings> {
    let path = get_settings_file_path();
    load_settings_from_path(&path)
}

/// Lưu cấu hình vào %LOCALAPPDATA%\WinPulseOptimizer\settings.json và cập nhật Registry
pub fn save_settings(settings: AppSettings) -> AppResult<AppSettings> {
    let path = get_settings_file_path();
    save_settings_to_path(&settings, &path, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_settings() {
        let default_config = AppSettings::default();
        assert!(!default_config.auto_start_on_boot);
        assert!(default_config.minimize_to_tray);
        assert_eq!(default_config.poll_interval_ms, 1500);
        assert!(default_config.visual_effects);
    }

    #[test]
    fn test_load_save_settings_isolated() {
        let temp_dir = env::temp_dir().join("winpulse_test_settings");
        let _ = fs::remove_dir_all(&temp_dir);
        let settings_file = temp_dir.join("subfolder").join("settings.json");

        // Load khi file chưa tồn tại -> trả về Default
        let loaded_default = load_settings_from_path(&settings_file).unwrap_or_default();
        assert_eq!(loaded_default, AppSettings::default());

        // Thay đổi và lưu lại (không sync registry trong unit test để tránh chạm vào HKCU máy dev)
        let custom_settings = AppSettings {
            auto_start_on_boot: true,
            minimize_to_tray: false,
            poll_interval_ms: 2000,
            visual_effects: false,
        };

        let saved = save_settings_to_path(&custom_settings, &settings_file, false);
        assert!(saved.is_ok());

        // Đọc lại kiểm tra tính khớp
        let reloaded = load_settings_from_path(&settings_file).unwrap_or_default();
        assert_eq!(reloaded, custom_settings);

        // Dọn dẹp temp
        let _ = fs::remove_dir_all(&temp_dir);
    }
}
