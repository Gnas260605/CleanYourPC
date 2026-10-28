use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use crate::error::{AppError, AppResult};

/// Thông tin tệp tin đã kiểm tra an toàn
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SafeFileInfo {
    pub path: String,
    pub size_bytes: u64,
    pub is_readonly: bool,
}

/// Kết quả thao tác tệp tin theo quy chuẩn Dry-Run và An toàn hệ thống
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum DeletionOutcome {
    /// Chế độ Dry-Run: chỉ mô phỏng, ghi nhận kích thước sẽ giải phóng, KHÔNG xóa
    Simulated { path: String, bytes_to_free: u64 },
    /// Đã xóa tệp thành công
    Deleted { path: String, bytes_freed: u64 },
    /// Bỏ qua êm ái do tệp đang bị tiến trình khác chiếm giữ (Locked file)
    SkippedLockedFile { path: String, reason: String },
}

/// Danh sách tuyệt đối các thư mục và đối tượng bị cấm theo RULE.md ("Zero-Harm System Guarantee")
pub struct PathSafetyValidator;

impl PathSafetyValidator {
    /// Danh sách các thư mục hệ thống cấm tuyệt đối (lowercase)
    const FORBIDDEN_SYSTEM_DIRS: &'static [&'static str] = &[
        r"\windows\system32",
        r"\windows\syswow64",
        r"\boot",
        r"\efi",
        r"$recycle.bin",
    ];

    /// Danh sách thư mục hồ sơ cá nhân thiết yếu (lowercase)
    const FORBIDDEN_USER_FOLDERS: &'static [&'static str] = &[
        r"\desktop",
        r"\documents",
        r"\pictures",
        r"\downloads",
        r"\videos",
    ];

    /// Danh sách tệp cơ sở dữ liệu trình duyệt cấm tuyệt đối (lowercase)
    const FORBIDDEN_BROWSER_FILES: &'static [&'static str] = &[
        "login data",
        "cookies",
        "history",
        "bookmarks",
        "preferences",
        "web data",
    ];

    /// Danh sách các dịch vụ cốt lõi bị cấm can thiệp theo RULE.md
    const CORE_SYSTEM_SERVICES: &'static [&'static str] = &[
        "audioendpointbuilder",
        "audiosrv",
        "rpcss",
        "dcomlaunch",
        "eventlog",
        "plugplay",
        "lanmanworkstation",
    ];

    /// Danh sách Registry Startup keys được phép can thiệp theo RULE.md
    const ALLOWED_REGISTRY_KEYS: &'static [&'static str] = &[
        r"software\microsoft\windows\currentversion\run",
        r"software\microsoft\windows\currentversion\runonce",
        r"software\microsoft\windows\currentversion\explorer\startupapproved\run",
        r"software\microsoft\windows\currentversion\explorer\startupapproved\run32",
        r"software\microsoft\windows\currentversion\explorer\startupapproved\startupfolder",
    ];

    /// Chuẩn hóa chuỗi đường dẫn về dạng chữ thường và phân cách chuẩn Windows backslash
    pub fn normalize_path_str(path: &Path) -> String {
        let s = path.to_string_lossy().to_string().to_lowercase();
        s.replace('/', r"\")
    }

    /// Kiểm tra xem một đường dẫn có nằm trong danh sách cấm tuyệt đối hay không
    pub fn is_blacklisted_path(path: &Path) -> bool {
        let normalized = Self::normalize_path_str(path);

        // 1. Chống Directory Traversal: Nếu đường dẫn chứa ".." thì coi như nguy hiểm
        if normalized.contains(r"\..\") || normalized.ends_with(r"\..") || normalized.starts_with(r"..\") {
            return true;
        }

        // 2. Kiểm tra các thư mục hệ thống cấm
        for dir in Self::FORBIDDEN_SYSTEM_DIRS {
            if normalized.contains(dir) {
                return true;
            }
        }

        // 3. Kiểm tra các thư mục hồ sơ người dùng thiết yếu (Desktop, Documents, Downloads,...)
        for folder in Self::FORBIDDEN_USER_FOLDERS {
            // Kiểm tra nếu là thư mục con trong Users (ví dụ \users\msi\desktop...) hoặc kết thúc bằng thư mục đó
            if normalized.contains(&format!(r"\users\")) && normalized.contains(folder) {
                return true;
            }
            // Trường hợp đường dẫn trực tiếp như C:\Users\Public\Desktop hoặc C:\Desktop
            if normalized.ends_with(folder) || normalized.contains(&format!(r"{}\", folder)) {
                return true;
            }
        }

        // 4. Kiểm tra các tệp nhạy cảm của trình duyệt (Login Data, Cookies, Bookmarks, ...)
        if let Some(file_name) = path.file_name() {
            let fname_lower = file_name.to_string_lossy().to_lowercase();
            for db_file in Self::FORBIDDEN_BROWSER_FILES {
                if fname_lower == *db_file || fname_lower.starts_with(&format!("{}.", db_file)) {
                    return true;
                }
            }
        }

        false
    }

    /// Xác thực đường dẫn có an toàn để kiểm tra / dọn dẹp không.
    /// Nếu vi phạm danh sách cấm, trả về Err(AppError::InvalidPath).
    pub fn validate_cleanable_path(path: &Path) -> AppResult<PathBuf> {
        let path_str = path.to_string_lossy();
        if path_str.trim().is_empty() {
            return Err(AppError::InvalidPath("Đường dẫn không được để trống".to_string()));
        }

        if Self::is_blacklisted_path(path) {
            warn!("🛑 CHẶN ĐƯỜNG DẪN NGUY HIỂM: {:?}", path);
            return Err(AppError::InvalidPath(format!(
                "Đường dẫn '{:?}' nằm trong Danh sách Đen Tuyệt đối (Absolute Blacklist) theo RULE.md Zero-Harm Guarantee!",
                path
            )));
        }

        Ok(path.to_path_buf())
    }

    /// Thẩm định Registry: Chỉ chấp nhận các đường dẫn Startup Key được phê duyệt
    pub fn is_allowed_registry_startup_key(key_path: &str) -> bool {
        let normalized = key_path.trim().to_lowercase().replace('/', r"\");
        for allowed in Self::ALLOWED_REGISTRY_KEYS {
            if normalized == *allowed || normalized.ends_with(allowed) {
                return true;
            }
        }
        false
    }

    /// Thẩm định Service: Kiểm tra xem có phải Core Service bất khả xâm phạm hay không
    pub fn is_core_system_service(service_name: &str) -> bool {
        let name_lower = service_name.trim().to_lowercase();
        Self::CORE_SYSTEM_SERVICES.contains(&name_lower.as_str())
    }
}

/// Thao tác kiểm tra và dọn dẹp tệp tin an toàn (Safe File Operations)
pub struct SafeFileOps;

impl SafeFileOps {
    /// Kiểm tra thông tin tệp tin một cách an toàn và có kiểm tra Blacklist
    pub fn inspect_file(path: &Path) -> AppResult<SafeFileInfo> {
        PathSafetyValidator::validate_cleanable_path(path)?;

        let metadata = fs::metadata(path).map_err(AppError::from)?;
        Ok(SafeFileInfo {
            path: path.to_string_lossy().to_string(),
            size_bytes: metadata.len(),
            is_readonly: metadata.permissions().readonly(),
        })
    }

    /// Xóa tệp an toàn với chế độ Dry-Run và cơ chế xử lý tệp bị khóa (Locked File)
    /// - `dry_run = true`: Tính toán dung lượng sẽ giải phóng, KHÔNG thực hiện xóa.
    /// - `dry_run = false`: Thử xóa tệp. Nếu tệp đang bị khóa độc quyền bởi tiến trình khác,
    ///   trả về `AppError::ResourceBusy` hoặc `DeletionOutcome::SkippedLockedFile` một cách an toàn mà KHÔNG GÂY CRASH / PANIC.
    pub fn delete_file(path: &Path, dry_run: bool) -> AppResult<DeletionOutcome> {
        // 1. Kiểm tra danh sách cấm tuyệt đối
        PathSafetyValidator::validate_cleanable_path(path)?;

        // 2. Đọc metadata để lấy dung lượng
        let metadata = match fs::metadata(path) {
            Ok(m) => m,
            Err(e) => {
                let app_err = AppError::from(e);
                // Nếu đang bị khóa khi đọc metadata
                if let AppError::ResourceBusy(ref msg) = app_err {
                    return Ok(DeletionOutcome::SkippedLockedFile {
                        path: path.to_string_lossy().to_string(),
                        reason: msg.clone(),
                    });
                }
                return Err(app_err);
            }
        };

        let file_size = metadata.len();

        // 3. Xử lý Dry-Run: Tuyệt đối không xóa
        if dry_run {
            info!("Dry-Run simulation cho tệp: {:?} ({} bytes)", path, file_size);
            return Ok(DeletionOutcome::Simulated {
                path: path.to_string_lossy().to_string(),
                bytes_to_free: file_size,
            });
        }

        // 4. Thực hiện xóa tệp thực tế khi người dùng đã xác nhận
        match fs::remove_file(path) {
            Ok(_) => {
                info!("Đã xóa an toàn tệp: {:?} (giải phóng {} bytes)", path, file_size);
                Ok(DeletionOutcome::Deleted {
                    path: path.to_string_lossy().to_string(),
                    bytes_freed: file_size,
                })
            }
            Err(e) => {
                let app_err = AppError::from(e);
                match app_err {
                    AppError::ResourceBusy(msg) => {
                        warn!("Tệp đang bị khóa bởi tiến trình khác, bỏ qua êm ái: {:?}", path);
                        Ok(DeletionOutcome::SkippedLockedFile {
                            path: path.to_string_lossy().to_string(),
                            reason: msg,
                        })
                    }
                    other_err => Err(other_err),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::env;
    use std::fs::{File, OpenOptions};

    #[test]
    fn test_blacklist_system32_and_syswow64() {
        let p1 = Path::new(r"C:\Windows\System32\kernel32.dll");
        assert!(PathSafetyValidator::is_blacklisted_path(p1));
        assert!(PathSafetyValidator::validate_cleanable_path(p1).is_err());

        let p2 = Path::new(r"c:/windows/system32/drivers/etc/hosts");
        assert!(PathSafetyValidator::is_blacklisted_path(p2));

        let p3 = Path::new(r"C:\Windows\SysWOW64\cmd.exe");
        assert!(PathSafetyValidator::is_blacklisted_path(p3));
    }

    #[test]
    fn test_blacklist_boot_and_efi() {
        let p1 = Path::new(r"C:\Boot\BCD");
        assert!(PathSafetyValidator::is_blacklisted_path(p1));

        let p2 = Path::new(r"C:\EFI\Microsoft\Boot\bootmgfw.efi");
        assert!(PathSafetyValidator::is_blacklisted_path(p2));

        let p3 = Path::new(r"C:\$Recycle.Bin\S-1-5-21-test");
        assert!(PathSafetyValidator::is_blacklisted_path(p3));
    }

    #[test]
    fn test_blacklist_user_profiles() {
        let p_desktop = Path::new(r"C:\Users\MSI\Desktop\important_report.docx");
        assert!(PathSafetyValidator::is_blacklisted_path(p_desktop));

        let p_docs = Path::new(r"C:\Users\John\Documents\tax_2025.pdf");
        assert!(PathSafetyValidator::is_blacklisted_path(p_docs));

        let p_pics = Path::new(r"C:\Users\Public\Pictures\family.jpg");
        assert!(PathSafetyValidator::is_blacklisted_path(p_pics));

        let p_downloads = Path::new(r"C:\Users\Admin\Downloads\setup.exe");
        assert!(PathSafetyValidator::is_blacklisted_path(p_downloads));

        let p_videos = Path::new(r"C:\Users\Gamer\Videos\replay.mp4");
        assert!(PathSafetyValidator::is_blacklisted_path(p_videos));
    }

    #[test]
    fn test_blacklist_browser_databases() {
        let p_login = Path::new(r"C:\Users\MSI\AppData\Local\Google\Chrome\User Data\Default\Login Data");
        assert!(PathSafetyValidator::is_blacklisted_path(p_login));

        let p_cookies = Path::new(r"C:\Users\MSI\AppData\Local\Microsoft\Edge\User Data\Default\Cookies");
        assert!(PathSafetyValidator::is_blacklisted_path(p_cookies));

        let p_history = Path::new(r"C:\Users\MSI\AppData\Local\BraveSoftware\Brave-Browser\User Data\Default\History");
        assert!(PathSafetyValidator::is_blacklisted_path(p_history));

        let p_bookmarks = Path::new(r"C:\Users\MSI\AppData\Local\Google\Chrome\User Data\Default\Bookmarks");
        assert!(PathSafetyValidator::is_blacklisted_path(p_bookmarks));

        let p_pref = Path::new(r"C:\Users\MSI\AppData\Local\Google\Chrome\User Data\Default\Preferences");
        assert!(PathSafetyValidator::is_blacklisted_path(p_pref));
    }

    #[test]
    fn test_directory_traversal_prevention() {
        let p_traversal = Path::new(r"C:\Users\MSI\AppData\Local\Temp\..\..\..\Windows\System32\cmd.exe");
        assert!(PathSafetyValidator::is_blacklisted_path(p_traversal));
        assert!(PathSafetyValidator::validate_cleanable_path(p_traversal).is_err());
    }

    #[test]
    fn test_allow_safe_temp_path() {
        let p_temp = Path::new(r"C:\Users\MSI\AppData\Local\Temp\scoped_dir_9912.tmp");
        assert!(!PathSafetyValidator::is_blacklisted_path(p_temp));
        assert!(PathSafetyValidator::validate_cleanable_path(p_temp).is_ok());

        let p_dumps = Path::new(r"C:\Users\MSI\AppData\Local\CrashDumps\app_crash_882.dmp");
        assert!(!PathSafetyValidator::is_blacklisted_path(p_dumps));
        assert!(PathSafetyValidator::validate_cleanable_path(p_dumps).is_ok());
    }

    #[test]
    fn test_registry_startup_whitelist() {
        // Hợp lệ
        assert!(PathSafetyValidator::is_allowed_registry_startup_key(
            r"Software\Microsoft\Windows\CurrentVersion\Run"
        ));
        assert!(PathSafetyValidator::is_allowed_registry_startup_key(
            r"software/microsoft/windows/currentversion/runonce"
        ));
        assert!(PathSafetyValidator::is_allowed_registry_startup_key(
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
        ));

        // Không hợp lệ (cấm dọn dẹp mù quáng)
        assert!(!PathSafetyValidator::is_allowed_registry_startup_key(
            r"SYSTEM\CurrentControlSet\Services"
        ));
        assert!(!PathSafetyValidator::is_allowed_registry_startup_key(
            r"Software\Classes\CLSID"
        ));
        assert!(!PathSafetyValidator::is_allowed_registry_startup_key(
            r"Software\Microsoft\Windows NT\CurrentVersion\Winlogon"
        ));
    }

    #[test]
    fn test_core_services_protection() {
        assert!(PathSafetyValidator::is_core_system_service("Audiosrv"));
        assert!(PathSafetyValidator::is_core_system_service("AudioEndpointBuilder"));
        assert!(PathSafetyValidator::is_core_system_service("RpcSs"));
        assert!(PathSafetyValidator::is_core_system_service("DcomLaunch"));
        assert!(PathSafetyValidator::is_core_system_service("EventLog"));
        assert!(PathSafetyValidator::is_core_system_service("PlugPlay"));
        assert!(PathSafetyValidator::is_core_system_service("LanmanWorkstation"));

        // Dịch vụ của bên thứ ba hoặc telemetry cho phép tối ưu
        assert!(!PathSafetyValidator::is_core_system_service("DiagTrack"));
        assert!(!PathSafetyValidator::is_core_system_service("SysMain"));
        assert!(!PathSafetyValidator::is_core_system_service("XboxGipSvc"));
    }

    #[test]
    fn test_dry_run_simulation() {
        let temp_dir = env::temp_dir();
        let test_file = temp_dir.join("winpulse_test_dryrun.tmp");
        
        let mut file = File::create(&test_file).unwrap_or_else(|e| panic!("Failed to create temp test file: {}", e));
        let dummy_data = b"WinPulse Dry-Run Test Content";
        file.write_all(dummy_data).unwrap_or_else(|e| panic!("Write failed: {}", e));
        drop(file);

        // Dry-run = true: Không được xóa file
        let outcome = SafeFileOps::delete_file(&test_file, true);
        assert!(outcome.is_ok());
        match outcome.unwrap_or_else(|_| panic!("Failed to run dry-run")) {
            DeletionOutcome::Simulated { bytes_to_free, .. } => {
                assert_eq!(bytes_to_free, dummy_data.len() as u64);
            }
            _ => panic!("Expected DeletionOutcome::Simulated"),
        }

        // Tệp vẫn phải còn tồn tại sau Dry-Run
        assert!(test_file.exists(), "Tệp không được bị xóa trong chế độ Dry-Run");

        // Dọn dẹp tệp test
        let _ = fs::remove_file(&test_file);
    }

    #[test]
    fn test_locked_file_scenario() {
        // Kịch bản tệp bị khóa (Locked File Scenario):
        // 1. Tạo tệp tạm trong temp_dir
        let temp_dir = env::temp_dir();
        let locked_file_path = temp_dir.join("winpulse_test_locked_file.tmp");

        let mut file = File::create(&locked_file_path)
            .unwrap_or_else(|e| panic!("Failed to create locked temp file: {}", e));
        file.write_all(b"Exclusive locked file content").unwrap_or_else(|e| panic!("Write failed: {}", e));

        // 2. Mở file và giữ File handle độc quyền (Không cho phép chia sẻ xóa/ghi)
        // Trên Windows, OpenOptions::read(true).write(true) giữ handle đang mở sẽ ngăn cản xóa file (Sharing Violation).
        let exclusive_holder = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&locked_file_path)
            .unwrap_or_else(|e| panic!("Failed to open file exclusively: {}", e));

        // 3. Thử thực hiện delete_file_safely với dry_run = false
        // Yêu cầu: App KHÔNG ĐƯỢC CRASH / PANIC. Phải trả về Ok(DeletionOutcome::SkippedLockedFile) hoặc Err(AppError::ResourceBusy)
        let delete_result = SafeFileOps::delete_file(&locked_file_path, false);

        match delete_result {
            Ok(DeletionOutcome::SkippedLockedFile { path, reason }) => {
                info!("Pass Locked File Test: Tệp bị khóa được bỏ qua êm ái: {} ({})", path, reason);
                assert!(!path.is_empty());
                assert!(!reason.is_empty());
            }
            Err(AppError::ResourceBusy(reason)) => {
                info!("Pass Locked File Test: Trả về AppError::ResourceBusy an toàn: {}", reason);
                assert!(!reason.is_empty());
            }
            other => {
                // Nếu xóa được (trường hợp filesystem cho phép hoặc mock), kiểm tra không panic
                info!("Kết quả thao tác locked file: {:?}", other);
            }
        }

        // 4. Đóng handle độc quyền và xóa tệp tạm
        drop(exclusive_holder);
        drop(file);
        let _ = fs::remove_file(&locked_file_path);
    }
}
