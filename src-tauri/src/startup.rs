use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};
use tracing::info;
use winreg::enums::*;
use winreg::{RegKey, RegValue, HKEY};

use crate::error::{AppError, AppResult};

/// Thông tin về ứng dụng khởi động cùng Windows
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StartupItem {
    pub id: String,
    pub name: String,
    pub command: String,
    pub location: String, // "HKCU", "HKLM", "StartupFolder"
    pub enabled: bool,
    pub impact: String,   // "High", "Medium", "Low"
}

/// Dữ liệu cấu trúc sao lưu cấu hình khởi động
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartupBackupData {
    pub timestamp: u64,
    pub created_at: String,
    pub items: Vec<StartupItem>,
}

const REG_RUN_PATH: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const REG_APPROVED_RUN_PATH: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
const REG_APPROVED_FOLDER_PATH: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder";

/// Đánh giá mức độ ảnh hưởng đến thời gian khởi động máy (Startup Impact)
fn estimate_impact(name: &str, command: &str) -> String {
    let combined = format!("{} {}", name, command).to_lowercase();
    if combined.contains("docker")
        || combined.contains("discord")
        || combined.contains("steam")
        || combined.contains("curseforge")
        || combined.contains("mumu")
        || combined.contains("epic")
        || combined.contains("riot")
        || combined.contains("chrome")
        || combined.contains("brave")
        || combined.contains("edge")
        || combined.contains("electron")
    {
        "High".to_string()
    } else if combined.contains("updater")
        || combined.contains("systray")
        || combined.contains("securityhealth")
        || combined.contains("audio")
        || combined.contains("realtek")
        || combined.contains("driver")
    {
        "Low".to_string()
    } else {
        "Medium".to_string()
    }
}

/// Kiểm tra trạng thái kích hoạt của một mục qua registry StartupApproved
fn is_approved_enabled(approved_key: &Option<RegKey>, value_name: &str) -> bool {
    let key = match approved_key {
        Some(k) => k,
        None => return true, // Mặc định nếu chưa ghi trong StartupApproved thì là Enabled
    };

    match key.get_raw_value(value_name) {
        Ok(raw) => {
            if raw.bytes.is_empty() {
                true
            } else {
                // Windows Task Manager:
                // byte 0 chẵn (0x02, 0x00, 0x06): Enabled
                // byte 0 lẻ (0x03, 0x01): Disabled
                raw.bytes[0] % 2 == 0
            }
        }
        Err(_) => true,
    }
}

/// Đọc danh sách khởi động từ một Registry Key cụ thể (HKCU hoặc HKLM)
fn read_registry_startup(root: HKEY, location: &str) -> Vec<StartupItem> {
    let mut items = Vec::new();
    let reg_root = RegKey::predef(root);

    let run_key = match reg_root.open_subkey_with_flags(REG_RUN_PATH, KEY_READ) {
        Ok(k) => k,
        Err(_) => return items,
    };

    let approved_key = reg_root
        .open_subkey_with_flags(REG_APPROVED_RUN_PATH, KEY_READ)
        .ok();

    for (name, val) in run_key.enum_values().flatten() {
        let command = val.to_string();

        let enabled = is_approved_enabled(&approved_key, &name);
        let impact = estimate_impact(&name, &command);

        items.push(StartupItem {
            id: format!("{}:{}", location, name),
            name: name.clone(),
            command,
            location: location.to_string(),
            enabled,
            impact,
        });
    }

    items
}

/// Đọc thư mục Startup của người dùng (`shell:startup`)
fn read_folder_startup() -> Vec<StartupItem> {
    let mut items = Vec::new();

    let appdata = match env::var("APPDATA") {
        Ok(p) => p,
        Err(_) => return items,
    };

    let startup_dir = Path::new(&appdata).join(r"Microsoft\Windows\Start Menu\Programs\Startup");
    if !startup_dir.is_dir() {
        return items;
    }

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let approved_folder_key = hkcu
        .open_subkey_with_flags(REG_APPROVED_FOLDER_PATH, KEY_READ)
        .ok();

    let entries = match fs::read_dir(&startup_dir) {
        Ok(e) => e,
        Err(_) => return items,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            let file_name = entry.file_name().to_string_lossy().to_string();
            if file_name.eq_ignore_ascii_case("desktop.ini") {
                continue;
            }

            let command = path.to_string_lossy().to_string();
            let enabled = is_approved_enabled(&approved_folder_key, &file_name);
            let impact = estimate_impact(&file_name, &command);

            items.push(StartupItem {
                id: format!("StartupFolder:{}", file_name),
                name: file_name,
                command,
                location: "StartupFolder".to_string(),
                enabled,
                impact,
            });
        }
    }

    items
}

/// Lấy toàn bộ danh sách ứng dụng khởi động từ HKCU, HKLM và Thư mục Startup
pub fn get_all_startup_items() -> AppResult<Vec<StartupItem>> {
    let mut all_items = Vec::new();

    // 1. HKCU Run
    let mut hkcu_items = read_registry_startup(HKEY_CURRENT_USER, "HKCU");
    all_items.append(&mut hkcu_items);

    // 2. HKLM Run
    let mut hklm_items = read_registry_startup(HKEY_LOCAL_MACHINE, "HKLM");
    all_items.append(&mut hklm_items);

    // 3. Thư mục Startup
    let mut folder_items = read_folder_startup();
    all_items.append(&mut folder_items);

    info!("Đã quét được {} mục khởi động cùng hệ thống", all_items.len());
    Ok(all_items)
}

/// Bật hoặc tắt an toàn một ứng dụng khởi động bằng cơ chế StartupApproved chuẩn của Windows.
/// Tuyệt đối KHÔNG xóa registry Run gốc của người dùng.
pub fn toggle_startup_item(id: &str, location: &str, enable: bool) -> AppResult<bool> {
    // Trích xuất tên gốc của mục khởi động từ id (định dạng "location:name" hoặc id thuần túy)
    let item_name = match id.split_once(':') {
        Some((_, name)) => name,
        None => id,
    };

    if item_name.trim().is_empty() {
        return Err(AppError::InvalidState(
            "Tên mục khởi động không hợp lệ".to_string(),
        ));
    }

    // Giá trị binary 12 bytes chuẩn Windows StartupApproved:
    // Enabled: 0x02 00 00 00 ...
    // Disabled: 0x03 00 00 00 ...
    let byte_flag: u8 = if enable { 0x02 } else { 0x03 };
    let mut binary_data = vec![0u8; 12];
    binary_data[0] = byte_flag;

    let reg_val = RegValue {
        vtype: REG_BINARY,
        bytes: binary_data,
    };

    match location {
        "HKCU" => {
            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            let (approved_key, _) = hkcu
                .create_subkey(REG_APPROVED_RUN_PATH)
                .map_err(|e| AppError::RegistryError(format!("Không thể mở/tạo key StartupApproved HKCU: {}", e)))?;

            approved_key
                .set_raw_value(item_name, &reg_val)
                .map_err(|e| AppError::RegistryError(format!("Không thể lưu trạng thái mục khởi động HKCU: {}", e)))?;

            info!(
                "Đã {} mục khởi động HKCU '{}' an toàn",
                if enable { "bật" } else { "tắt" },
                item_name
            );
            Ok(true)
        }
        "HKLM" => {
            let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
            let approved_key = match hklm.open_subkey_with_flags(REG_APPROVED_RUN_PATH, KEY_SET_VALUE) {
                Ok(k) => k,
                Err(e) => {
                    if e.kind() == std::io::ErrorKind::PermissionDenied {
                        return Err(AppError::PermissionDenied(
                            "Không có quyền ghi vào HKLM. Vui lòng chạy ứng dụng dưới quyền Quản trị viên (Run as Administrator) để thay đổi mục khởi động hệ thống.".to_string(),
                        ));
                    }
                    return Err(AppError::RegistryError(format!("Lỗi truy cập HKLM StartupApproved: {}", e)));
                }
            };

            approved_key
                .set_raw_value(item_name, &reg_val)
                .map_err(|e| {
                    if e.kind() == std::io::ErrorKind::PermissionDenied {
                        AppError::PermissionDenied(
                            "Không đủ thẩm quyền ghi cấu hình vào HKLM. Vui lòng mở quyền Administrator.".to_string(),
                        )
                    } else {
                        AppError::RegistryError(format!("Lỗi lưu trạng thái mục khởi động HKLM: {}", e))
                    }
                })?;

            info!(
                "Đã {} mục khởi động HKLM '{}' an toàn",
                if enable { "bật" } else { "tắt" },
                item_name
            );
            Ok(true)
        }
        "StartupFolder" => {
            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            let (approved_key, _) = hkcu
                .create_subkey(REG_APPROVED_FOLDER_PATH)
                .map_err(|e| AppError::RegistryError(format!("Không thể mở key StartupApproved StartupFolder: {}", e)))?;

            approved_key
                .set_raw_value(item_name, &reg_val)
                .map_err(|e| AppError::RegistryError(format!("Không thể lưu trạng thái StartupFolder: {}", e)))?;

            info!(
                "Đã {} mục khởi động StartupFolder '{}' an toàn",
                if enable { "bật" } else { "tắt" },
                item_name
            );
            Ok(true)
        }
        other => Err(AppError::InvalidState(format!(
            "Vị trí khởi động không hợp lệ: '{}'. Chỉ chấp nhận HKCU, HKLM hoặc StartupFolder.",
            other
        ))),
    }
}

/// Xuất danh sách registry Run hiện thời ra tệp JSON sao lưu tại
/// `%LOCALAPPDATA%\WinPulse\backups\startup_backup_<timestamp>.json`
pub fn export_startup_backup() -> AppResult<String> {
    let local_app_data = env::var("LOCALAPPDATA").map_err(|_| {
        AppError::IoError("Không thể xác định biến môi trường %LOCALAPPDATA%".to_string())
    })?;

    let backup_dir = PathBuf::from(local_app_data).join("WinPulse").join("backups");
    fs::create_dir_all(&backup_dir).map_err(|e| {
        AppError::IoError(format!("Không thể tạo thư mục sao lưu: {}", e))
    })?;

    let duration_since_epoch = match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(d) => d.as_secs(),
        Err(_) => 0,
    };

    let filename = format!("startup_backup_{}.json", duration_since_epoch);
    let backup_path = backup_dir.join(filename);

    let items = get_all_startup_items()?;
    let backup_data = StartupBackupData {
        timestamp: duration_since_epoch,
        created_at: format!("{:?}", SystemTime::now()),
        items,
    };

    let json_content = serde_json::to_string_pretty(&backup_data).map_err(|e| {
        AppError::InvalidState(format!("Lỗi định dạng dữ liệu sao lưu JSON: {}", e))
    })?;

    fs::write(&backup_path, json_content).map_err(|e| {
        AppError::IoError(format!("Không thể ghi tệp sao lưu tại {:?}: {}", backup_path, e))
    })?;

    let path_str = backup_path.to_string_lossy().to_string();
    info!("Đã tạo tệp sao lưu cấu hình khởi động thành công: {}", path_str);
    Ok(path_str)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_estimate_impact() {
        assert_eq!(estimate_impact("Discord", "C:\\Users\\Update.exe"), "High");
        assert_eq!(estimate_impact("Steam", "steam.exe -silent"), "High");
        assert_eq!(estimate_impact("RtkAudUService", "realtek.exe"), "Low");
        assert_eq!(estimate_impact("GenericApp", "app.exe"), "Medium");
    }

    #[test]
    fn test_get_all_startup_items_does_not_panic() {
        let res = get_all_startup_items();
        assert!(res.is_ok());
        if let Ok(items) = res {
            // Máy Windows thật sẽ có ít nhất 1 vài mục trong HKCU hoặc HKLM
            for item in items {
                assert!(!item.id.is_empty());
                assert!(!item.name.is_empty());
                assert!(item.location == "HKCU" || item.location == "HKLM" || item.location == "StartupFolder");
                assert!(item.impact == "High" || item.impact == "Medium" || item.impact == "Low");
            }
        }
    }

    #[test]
    fn test_export_startup_backup() {
        let backup_result = export_startup_backup();
        assert!(backup_result.is_ok());
        if let Ok(path) = backup_result {
            let p = Path::new(&path);
            assert!(p.exists());
            // Đọc lại để kiểm tra cú pháp JSON hợp lệ
            if let Ok(content) = fs::read_to_string(p) {
                let parsed: Result<StartupBackupData, _> = serde_json::from_str(&content);
                assert!(parsed.is_ok());
            }
            // Dọn dẹp tệp test
            let _ = fs::remove_file(p);
        }
    }

    #[test]
    fn test_toggle_startup_item_invalid_location() {
        let res = toggle_startup_item("test_id", "INVALID_LOC", true);
        assert!(res.is_err());
        match res {
            Err(AppError::InvalidState(msg)) => {
                assert!(msg.contains("Chỉ chấp nhận HKCU, HKLM hoặc StartupFolder"));
            }
            _ => panic!("Phải trả về AppError::InvalidState"),
        }
    }

    #[test]
    fn test_toggle_startup_preserves_run_key_and_modifies_startup_approved() {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let test_item_name = "WinPulse_SafetyAudit_TestItem";
        let test_command = r"C:\Windows\System32\notepad.exe --test";

        // 1. Tạo mục Run giả lập trong HKCU Run
        let (run_key, _) = match hkcu.create_subkey(REG_RUN_PATH) {
            Ok(k) => k,
            Err(e) => {
                info!("Không thể mở/tạo key HKCU Run trong test: {}", e);
                return;
            }
        };

        if let Err(e) = run_key.set_value(test_item_name, &test_command) {
            info!("Không thể ghi test Run value: {}", e);
            return;
        }

        // Mở/tạo StartupApproved\Run và đảm bảo sạch ban đầu
        let (approved_key, _) = match hkcu.create_subkey(REG_APPROVED_RUN_PATH) {
            Ok(k) => k,
            Err(e) => {
                let _ = run_key.delete_value(test_item_name);
                info!("Không thể mở/tạo StartupApproved Run key: {}", e);
                return;
            }
        };
        let _ = approved_key.delete_value(test_item_name);

        // 2. Thực hiện TẮT (disable) mục khởi động
        let toggle_off = toggle_startup_item(test_item_name, "HKCU", false);
        assert!(toggle_off.is_ok(), "Toggle off phải thành công");

        // 3. XÁC NHẬN BẤT KHẢ XÂM PHẠM: Giá trị trong key Run gốc KHÔNG HỀ BỊ XÓA!
        let run_val: Result<String, _> = run_key.get_value(test_item_name);
        assert!(run_val.is_ok(), "Key Run gốc BẮT BUỘC phải còn nguyên vẹn!");
        if let Ok(cmd) = run_val {
            assert_eq!(cmd, test_command, "Lệnh khởi động gốc không được thay đổi");
        }

        // 4. XÁC NHẬN: StartupApproved có dữ liệu binary với byte[0] là 0x03 (Disabled)
        let raw_val = approved_key.get_raw_value(test_item_name);
        assert!(raw_val.is_ok(), "StartupApproved phải có giá trị binary sau khi toggle");
        if let Ok(raw) = raw_val {
            assert_eq!(raw.vtype, winreg::enums::REG_BINARY);
            assert!(!raw.bytes.is_empty());
            assert_eq!(raw.bytes[0], 0x03, "Byte 0 phải là 0x03 khi Disable");
        }

        // 5. Thực hiện BẬT LẠI (enable) mục khởi động
        let toggle_on = toggle_startup_item(test_item_name, "HKCU", true);
        assert!(toggle_on.is_ok(), "Toggle on phải thành công");

        // Xác nhận giá trị Run gốc vẫn còn
        let run_val_after: Result<String, _> = run_key.get_value(test_item_name);
        assert!(run_val_after.is_ok());

        // StartupApproved chuyển thành byte[0] là 0x02 (Enabled)
        let raw_val_on = approved_key.get_raw_value(test_item_name);
        assert!(raw_val_on.is_ok());
        if let Ok(raw_on) = raw_val_on {
            assert_eq!(raw_on.bytes[0], 0x02, "Byte 0 phải là 0x02 khi Enable");
        }

        // 6. Dọn dẹp dữ liệu test an toàn
        let _ = run_key.delete_value(test_item_name);
        let _ = approved_key.delete_value(test_item_name);
    }
}
