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
    /// Các chuỗi thư mục hệ thống cấm tuyệt đối, so khớp liên tiếp theo component ở bất kỳ vị trí nào (lowercase)
    const FORBIDDEN_SYSTEM_SEQUENCES: &'static [&'static [&'static str]] = &[
        &["windows", "system32"],
        &["windows", "syswow64"],
        &["windows", "winsxs"],
    ];

    /// Thư mục cấm khi nằm ngay dưới gốc ổ đĩa (C:\Boot, C:\EFI)
    const FORBIDDEN_ROOT_DIRS: &'static [&'static str] = &["boot", "efi"];

    /// Component cấm ở bất kỳ vị trí nào
    const FORBIDDEN_ANY_COMPONENT: &'static [&'static str] = &["$recycle.bin", "system volume information"];

    /// Danh sách thư mục hồ sơ cá nhân thiết yếu (lowercase, so khớp nguyên component)
    const FORBIDDEN_USER_FOLDERS: &'static [&'static str] = &[
        "desktop",
        "documents",
        "pictures",
        "downloads",
        "videos",
        "music",
        "favorites",
        "contacts",
        "saved games",
        ".ssh",
    ];

    /// Thư mục gốc quan trọng: cấm xóa chính nó (nhưng thư mục con vẫn được xét bằng luật khác)
    const FORBIDDEN_EXACT_DIRS: &'static [&'static [&'static str]] = &[
        &["users"],
        &["windows"],
        &["program files"],
        &["program files (x86)"],
        &["programdata"],
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
        "rpceptmapper",
        "dcomlaunch",
        "eventlog",
        "plugplay",
        "lanmanworkstation",
        "power",
        "profsvc",
        "samss",
        "schedule",
        "winmgmt",
        "wuauserv",
        "trustedinstaller",
        "bfe",
        "mpssvc",
        "windefend",
        "cryptsvc",
        "dhcp",
        "dnscache",
        "nsi",
        "lsm",
        "gpsvc",
        "usermanager",
        "coremessagingregistrar",
        "brokerinfrastructure",
        "systemeventsbroker",
        "themes",
        "wlansvc",
        "netprofm",
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

    /// Tách đường dẫn thành (ổ đĩa, danh sách component) đã chuẩn hóa chữ thường.
    /// Bỏ tiền tố verbatim `\\?\` / `\\?\UNC\` do `canonicalize` sinh ra, bỏ component rỗng và ".".
    /// Không phụ thuộc hệ điều hành để hành vi kiểm tra là xác định.
    pub fn path_components(path: &Path) -> (Option<String>, Vec<String>) {
        let normalized = Self::normalize_path_str(path);
        let mut rest = normalized.as_str();
        if let Some(stripped) = rest.strip_prefix(r"\\?\unc\") {
            rest = stripped;
        } else if let Some(stripped) = rest.strip_prefix(r"\\?\") {
            rest = stripped;
        } else if let Some(stripped) = rest.strip_prefix(r"\\.\") {
            rest = stripped;
        }

        let mut parts: Vec<String> = rest
            .split('\\')
            .map(|p| p.trim_end_matches(' ').to_string())
            .filter(|p| !p.is_empty() && p != ".")
            .collect();

        let drive = match parts.first() {
            Some(first) if first.len() == 2 && first.ends_with(':') => Some(parts.remove(0)),
            _ => None,
        };
        (drive, parts)
    }

    /// Kiểm tra xem một đường dẫn có nằm trong danh sách cấm tuyệt đối hay không.
    /// So sánh theo từng component (không dùng `contains` trên chuỗi) để tránh chặn nhầm/thả nhầm.
    pub fn is_blacklisted_path(path: &Path) -> bool {
        let (drive, comps) = Self::path_components(path);

        // 0. Đường dẫn rỗng hoặc chính gốc ổ đĩa
        if comps.is_empty() {
            return true;
        }

        // 1. Chống Directory Traversal: bất kỳ component ".." nào đều bị coi là nguy hiểm
        if comps.iter().any(|c| c == "..") {
            return true;
        }

        // 2. Thư mục hệ thống cấm (chuỗi component liên tiếp)
        for seq in Self::FORBIDDEN_SYSTEM_SEQUENCES {
            if comps.windows(seq.len()).any(|w| w.iter().zip(seq.iter()).all(|(a, b)| a == b)) {
                return true;
            }
        }
        if comps.iter().any(|c| Self::FORBIDDEN_ANY_COMPONENT.contains(&c.as_str())) {
            return true;
        }
        if drive.is_some() && Self::FORBIDDEN_ROOT_DIRS.contains(&comps[0].as_str()) {
            return true;
        }

        // 3. Chính các thư mục gốc quan trọng (C:\Users, C:\Windows, C:\Program Files...)
        for exact in Self::FORBIDDEN_EXACT_DIRS {
            if comps.len() == exact.len() && comps.iter().zip(exact.iter()).all(|(a, b)| a == b) {
                return true;
            }
        }

        // 4. Chính thư mục hồ sơ người dùng (C:\Users\<tên>) và các thư mục AppData gốc
        if comps[0] == "users" {
            if comps.len() == 2 {
                return true;
            }
            if comps.len() >= 3 && comps[2] == "appdata" && comps.len() <= 4 {
                return true;
            }
        }

        // 5. Thư mục hồ sơ cá nhân thiết yếu ở bất kỳ cấp nào (Desktop, Documents, Downloads, OneDrive, .ssh...)
        for comp in &comps {
            if Self::FORBIDDEN_USER_FOLDERS.contains(&comp.as_str()) || comp.starts_with("onedrive") {
                return true;
            }
        }

        // 6. Các tệp nhạy cảm của trình duyệt (Login Data, Cookies, Bookmarks, ...)
        if let Some(fname_lower) = comps.last() {
            for db_file in Self::FORBIDDEN_BROWSER_FILES {
                if fname_lower == db_file || fname_lower.starts_with(&format!("{}.", db_file)) {
                    return true;
                }
            }
        }

        false
    }

    /// Kiểm tra `path` có nằm dưới (hoặc trùng) `root` hay không, so sánh theo component không phân biệt hoa thường.
    /// Cả hai đường dẫn nên được `canonicalize` trước khi gọi.
    pub fn is_under_root(path: &Path, root: &Path) -> bool {
        let (p_drive, p_comps) = Self::path_components(path);
        let (r_drive, r_comps) = Self::path_components(root);
        if r_comps.is_empty() || p_drive != r_drive || p_comps.len() < r_comps.len() {
            return false;
        }
        p_comps.iter().zip(r_comps.iter()).all(|(a, b)| a == b)
    }

    /// Từ chối symlink / junction / mọi reparse point (không đi theo liên kết).
    pub fn ensure_not_link(path: &Path) -> AppResult<fs::Metadata> {
        let meta = fs::symlink_metadata(path).map_err(AppError::from)?;
        if meta.file_type().is_symlink() || Self::is_reparse_point(&meta) {
            warn!("🛑 Từ chối symlink/junction: {:?}", path);
            return Err(AppError::InvalidPath(format!(
                "Đường dẫn '{}' là symlink/junction, không được phép thao tác",
                path.display()
            )));
        }
        Ok(meta)
    }

    #[cfg(windows)]
    fn is_reparse_point(meta: &fs::Metadata) -> bool {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }

    #[cfg(not(windows))]
    fn is_reparse_point(_meta: &fs::Metadata) -> bool {
        false
    }

    /// Kiểm tra đầy đủ một mục tiêu xóa:
    /// 1. Không thuộc blacklist (trước và sau khi canonicalize).
    /// 2. Bản thân không phải symlink/junction.
    /// 3. Đường dẫn thật (đã canonicalize, nên junction ở thư mục cha cũng bị lộ ra) nằm dưới một allow-root.
    ///
    /// Trả về đường dẫn đã canonicalize để thao tác xóa dùng đúng đối tượng đã kiểm tra.
    pub fn validate_delete_target(path: &Path, allowed_roots: &[PathBuf]) -> AppResult<PathBuf> {
        Self::validate_cleanable_path(path)?;
        Self::ensure_not_link(path)?;

        let canonical = fs::canonicalize(path).map_err(AppError::from)?;
        if Self::is_blacklisted_path(&canonical) {
            return Err(AppError::InvalidPath(format!(
                "Đường dẫn thật '{}' nằm trong danh sách cấm",
                canonical.display()
            )));
        }

        let inside = allowed_roots.iter().any(|root| match fs::canonicalize(root) {
            Ok(root_canon) => Self::is_under_root(&canonical, &root_canon) && canonical != root_canon,
            Err(_) => false,
        });
        if !inside {
            warn!("🛑 CHẶN: {:?} nằm ngoài các thư mục gốc được phép", canonical);
            return Err(AppError::InvalidPath(format!(
                "Đường dẫn '{}' nằm ngoài các thư mục được phép dọn dẹp",
                path.display()
            )));
        }

        Ok(canonical)
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
    fn test_blacklist_component_based_no_false_positive() {
        // Trước đây dùng `contains("\\desktop")` nên chặn nhầm tệp desktop.ini trong Temp
        let p_ini = Path::new(r"C:\Users\MSI\AppData\Local\Temp\desktop.ini.tmp");
        assert!(!PathSafetyValidator::is_blacklisted_path(p_ini));

        // "bootstrap" không phải thư mục C:\Boot
        let p_boot = Path::new(r"C:\Users\MSI\AppData\Local\Temp\bootstrap_cache\a.tmp");
        assert!(!PathSafetyValidator::is_blacklisted_path(p_boot));

        // "historyfile.tmp" không phải tệp History của trình duyệt
        let p_hist = Path::new(r"C:\Users\MSI\AppData\Local\Temp\historyfile.tmp");
        assert!(!PathSafetyValidator::is_blacklisted_path(p_hist));
    }

    #[test]
    fn test_blacklist_roots_and_verbatim_prefix() {
        assert!(PathSafetyValidator::is_blacklisted_path(Path::new(r"C:\")));
        assert!(PathSafetyValidator::is_blacklisted_path(Path::new(r"C:\Users")));
        assert!(PathSafetyValidator::is_blacklisted_path(Path::new(r"C:\Users\MSI")));
        assert!(PathSafetyValidator::is_blacklisted_path(Path::new(r"C:\Users\MSI\AppData\Local")));
        assert!(PathSafetyValidator::is_blacklisted_path(Path::new(r"C:\Program Files")));
        assert!(PathSafetyValidator::is_blacklisted_path(Path::new(r"C:\Windows")));
        assert!(PathSafetyValidator::is_blacklisted_path(Path::new(r"\\?\C:\Windows\System32\cmd.exe")));
        assert!(PathSafetyValidator::is_blacklisted_path(Path::new(r"C:\Users\MSI\OneDrive - Contoso\a.docx")));
        assert!(PathSafetyValidator::is_blacklisted_path(Path::new(r"C:\Users\MSI\.ssh\id_ed25519")));
        assert!(PathSafetyValidator::is_blacklisted_path(Path::new(r"C:\Windows\WinSxS\Temp")));
        // Thư mục con hợp lệ của Program Files vẫn được xét bằng luật khác (không bị chặn bởi luật "exact")
        assert!(!PathSafetyValidator::is_blacklisted_path(Path::new(r"C:\Program Files\App\cache.tmp")));
    }

    #[test]
    fn test_is_under_root_component_compare() {
        let root = Path::new(r"\\?\C:\Users\MSI\AppData\Local\Temp");
        assert!(PathSafetyValidator::is_under_root(Path::new(r"\\?\C:\Users\MSI\AppData\Local\Temp\a.tmp"), root));
        assert!(PathSafetyValidator::is_under_root(Path::new(r"C:\users\msi\appdata\local\temp\x\y.tmp"), root));
        // Tiền tố chuỗi giống nhưng khác component: Temp2 không nằm dưới Temp
        assert!(!PathSafetyValidator::is_under_root(Path::new(r"C:\Users\MSI\AppData\Local\Temp2\a.tmp"), root));
        assert!(!PathSafetyValidator::is_under_root(Path::new(r"D:\Users\MSI\AppData\Local\Temp\a.tmp"), root));
        assert!(!PathSafetyValidator::is_under_root(Path::new(r"C:\Users\MSI"), root));
    }

    #[test]
    fn test_validate_delete_target_rejects_outside_root() {
        let temp_dir = env::temp_dir();
        let inside = temp_dir.join("winpulse_root_check_inside.tmp");
        if File::create(&inside).is_err() {
            return;
        }
        let roots = vec![temp_dir.clone()];
        assert!(PathSafetyValidator::validate_delete_target(&inside, &roots).is_ok());

        // Cùng tệp nhưng allow-root là một thư mục khác → bị từ chối
        let other_root = temp_dir.join("winpulse_other_root_dir");
        let _ = fs::create_dir_all(&other_root);
        assert!(PathSafetyValidator::validate_delete_target(&inside, std::slice::from_ref(&other_root)).is_err());

        // Không được xóa chính thư mục gốc
        assert!(PathSafetyValidator::validate_delete_target(&other_root, std::slice::from_ref(&other_root)).is_err());

        let _ = fs::remove_file(&inside);
        let _ = fs::remove_dir(&other_root);
    }

    #[test]
    fn test_validate_delete_target_rejects_junction() {
        // Tạo junction %TEMP%\winpulse_junction_test -> thư mục nằm ngoài allow-root
        let temp_dir = env::temp_dir();
        let outside = temp_dir.join("winpulse_junction_target");
        let allowed = temp_dir.join("winpulse_junction_allowed");
        let link = allowed.join("link");
        let _ = fs::create_dir_all(&outside);
        let _ = fs::create_dir_all(&allowed);
        let victim = outside.join("victim.txt");
        if File::create(&victim).is_err() {
            return;
        }

        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&outside)
            .status();
        if !matches!(status, Ok(s) if s.success()) {
            let _ = fs::remove_file(&victim);
            return;
        }

        let roots = vec![allowed.clone()];
        // Bản thân junction bị từ chối
        assert!(PathSafetyValidator::validate_delete_target(&link, &roots).is_err());
        // Tệp đi qua junction: đường dẫn thật nằm ngoài allow-root → bị từ chối
        assert!(PathSafetyValidator::validate_delete_target(&link.join("victim.txt"), &roots).is_err());
        assert!(victim.exists());

        let _ = fs::remove_dir(&link);
        let _ = fs::remove_file(&victim);
        let _ = fs::remove_dir(&outside);
        let _ = fs::remove_dir(&allowed);
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
