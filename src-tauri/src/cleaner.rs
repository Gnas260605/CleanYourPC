use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use crate::error::{AppError, AppResult};
use crate::safety::{DeletionOutcome, PathSafetyValidator, SafeFileOps};
use crate::scan_session::ScanSessionStore;

/// Thông tin tệp có thể dọn dẹp (kết quả quét Dry-Run)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CleanableItem {
    pub id: String,
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub category: String, // "Safe", "Balanced", "Advanced"
    pub reason: String,
}

/// Kết quả sau khi thực thi dọn dẹp các tệp
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CleanResult {
    pub freed_bytes: u64,
    pub success_count: usize,
    pub failed_count: usize,
    pub skipped_locked_count: usize,
}

/// Kiểm tra tệp tin có thời gian sửa đổi cũ hơn 24 giờ hay không
pub fn is_older_than_24_hours(path: &Path) -> bool {
    let metadata = match fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return false,
    };

    let modified = match metadata.modified() {
        Ok(t) => t,
        Err(_) => return false,
    };

    let now = SystemTime::now();
    match now.duration_since(modified) {
        Ok(duration) => duration >= Duration::from_secs(24 * 3600),
        Err(_) => false,
    }
}

/// Kết quả một lần quét: mã phiên + danh sách mục. Frontend chỉ được gửi lại `scan_id` + `id` để dọn.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CleanScanResult {
    pub scan_id: String,
    pub items: Vec<CleanableItem>,
}

/// Phiên quét của Safe Cleaner (Tauri managed state)
pub type CleanerSession = ScanSessionStore<CleanableItem>;

/// Chỉ nhận tệp thường; bỏ qua thư mục, symlink và junction (DirEntry::file_type không đi theo liên kết)
fn is_regular_file(entry: &fs::DirEntry) -> bool {
    match entry.file_type() {
        Ok(ft) => ft.is_file() && !ft.is_symlink(),
        Err(_) => false,
    }
}

/// Các thư mục gốc mà Safe Cleaner được phép xóa tệp bên trong
pub fn allowed_clean_roots() -> Vec<PathBuf> {
    let mut roots = vec![env::temp_dir()];
    if let Ok(local) = env::var("LOCALAPPDATA") {
        let local = PathBuf::from(local);
        roots.push(local.join("CrashDumps"));
        roots.push(local.join("Microsoft").join("Windows").join("Explorer"));
    }
    roots
}

/// Quét các tệp trong thư mục User Temp (`%TEMP%`), chỉ lấy tệp cũ hơn 24 giờ
fn scan_user_temp_files(max_items: usize) -> Vec<CleanableItem> {
    let mut items = Vec::new();
    let temp_dir = env::temp_dir();

    if !temp_dir.is_dir() {
        return items;
    }

    let entries = match fs::read_dir(&temp_dir) {
        Ok(e) => e,
        Err(_) => return items,
    };

    for entry_res in entries {
        if items.len() >= max_items {
            break;
        }

        let entry = match entry_res {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();
        if is_regular_file(&entry) {
            // Quy tắc an toàn: Tệp tạm phải cũ hơn 24h để không ảnh hưởng cài đặt ứng dụng
            if !is_older_than_24_hours(&path) {
                continue;
            }

            if PathSafetyValidator::is_blacklisted_path(&path) {
                continue;
            }

            if let Ok(metadata) = entry.metadata() {
                let name = entry.file_name().to_string_lossy().to_string();
                let path_str = path.to_string_lossy().to_string();
                items.push(CleanableItem {
                    id: format!("temp_{}", items.len()),
                    name,
                    path: path_str,
                    size_bytes: metadata.len(),
                    category: "Safe".to_string(),
                    reason: "Tệp tạm Windows User Temp cũ hơn 24 giờ không còn sử dụng".to_string(),
                });
            }
        }
    }

    items
}

/// Quét thư mục Crash Dumps (`%LOCALAPPDATA%\CrashDumps`)
fn scan_crash_dumps() -> Vec<CleanableItem> {
    let mut items = Vec::new();

    let local_app_data = match env::var("LOCALAPPDATA") {
        Ok(p) => p,
        Err(_) => return items,
    };

    let dumps_dir = PathBuf::from(local_app_data).join("CrashDumps");
    if !dumps_dir.is_dir() {
        return items;
    }

    let entries = match fs::read_dir(&dumps_dir) {
        Ok(e) => e,
        Err(_) => return items,
    };

    for entry_res in entries {
        let entry = match entry_res {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();
        if is_regular_file(&entry) {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.to_lowercase().ends_with(".dmp") {
                if PathSafetyValidator::is_blacklisted_path(&path) {
                    continue;
                }

                if let Ok(metadata) = entry.metadata() {
                    let path_str = path.to_string_lossy().to_string();
                    items.push(CleanableItem {
                        id: format!("dump_{}", items.len()),
                        name,
                        path: path_str,
                        size_bytes: metadata.len(),
                        category: "Safe".to_string(),
                        reason: "Bản ghi sự cố phần mềm (Crash Dump) cũ chiếm dụng bộ nhớ".to_string(),
                    });
                }
            }
        }
    }

    items
}

/// Quét bộ nhớ đệm hình thu nhỏ Explorer (`%LOCALAPPDATA%\Microsoft\Windows\Explorer`)
fn scan_thumbnail_cache() -> Vec<CleanableItem> {
    let mut items = Vec::new();

    let local_app_data = match env::var("LOCALAPPDATA") {
        Ok(p) => p,
        Err(_) => return items,
    };

    let explorer_dir = PathBuf::from(local_app_data)
        .join("Microsoft")
        .join("Windows")
        .join("Explorer");

    if !explorer_dir.is_dir() {
        return items;
    }

    let entries = match fs::read_dir(&explorer_dir) {
        Ok(e) => e,
        Err(_) => return items,
    };

    for entry_res in entries {
        let entry = match entry_res {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();
        if is_regular_file(&entry) {
            let name = entry.file_name().to_string_lossy().to_string();
            let name_lower = name.to_lowercase();
            if (name_lower.starts_with("thumbcache_") || name_lower.starts_with("iconcache_"))
                && name_lower.ends_with(".db")
            {
                if PathSafetyValidator::is_blacklisted_path(&path) {
                    continue;
                }

                if let Ok(metadata) = entry.metadata() {
                    let path_str = path.to_string_lossy().to_string();
                    items.push(CleanableItem {
                        id: format!("thumb_{}", items.len()),
                        name,
                        path: path_str,
                        size_bytes: metadata.len(),
                        category: "Balanced".to_string(),
                        reason: "Bộ nhớ đệm hình thu nhỏ Explorer (tự động tái tạo khi truy cập thư mục)".to_string(),
                    });
                }
            }
        }
    }

    items
}

/// Quét toàn bộ danh sách các tệp có thể dọn dẹp (CHẾ ĐỘ DRY-RUN: KHÔNG XÓA TỆP)
pub fn scan_cleanable_items() -> AppResult<Vec<CleanableItem>> {
    let mut all_items = Vec::new();

    // 1. Quét User Temp (giới hạn tối đa 500 mục mỗi đợt để tối ưu hiệu năng)
    let mut temp_items = scan_user_temp_files(500);
    all_items.append(&mut temp_items);

    // 2. Quét Crash Dumps
    let mut dump_items = scan_crash_dumps();
    all_items.append(&mut dump_items);

    // 3. Quét Thumbnail Cache
    let mut thumb_items = scan_thumbnail_cache();
    all_items.append(&mut thumb_items);

    info!(
        "Dry-Run scan hoàn tất: tìm thấy {} tệp tin có thể dọn dẹp",
        all_items.len()
    );

    Ok(all_items)
}

/// Quét và lưu kết quả vào phiên của backend; trả về scan id cho frontend
pub fn scan_into_session(session: &CleanerSession) -> AppResult<CleanScanResult> {
    let items = scan_cleanable_items()?;
    let scan_id = session.replace(
        "clean",
        items.iter().map(|i| (i.id.clone(), i.clone())).collect(),
    )?;
    Ok(CleanScanResult { scan_id, items })
}

/// Dọn các mục theo id trong phiên quét hiện tại (không tin đường dẫn từ UI).
pub fn clean_from_session(
    session: &CleanerSession,
    scan_id: &str,
    item_ids: &[String],
) -> AppResult<CleanResult> {
    let items = session.resolve(scan_id, item_ids)?;
    let paths: Vec<PathBuf> = items.iter().map(|i| PathBuf::from(&i.path)).collect();
    let result = execute_clean_paths(&paths, &allowed_clean_roots());

    // Bỏ khỏi phiên các mục đã không còn tồn tại / đã xóa để không thao tác lại
    let done: Vec<String> = items
        .iter()
        .filter(|i| !Path::new(&i.path).exists())
        .map(|i| i.id.clone())
        .collect();
    session.remove(scan_id, &done)?;

    Ok(result)
}

/// Thực thi xóa danh sách tệp tin:
/// - Mỗi tệp phải qua `PathSafetyValidator::validate_delete_target` (blacklist, không symlink/junction,
///   đường dẫn thật nằm dưới một trong `allowed_roots`).
/// - Chỉ xóa tệp thường, không xóa thư mục.
/// - Bỏ qua êm ái các tệp đang bị khóa (Locked File) mà không gây dừng ứng dụng hoặc crash.
pub fn execute_clean_paths(paths: &[PathBuf], allowed_roots: &[PathBuf]) -> CleanResult {
    let mut freed_bytes: u64 = 0;
    let mut success_count: usize = 0;
    let mut failed_count: usize = 0;
    let mut skipped_locked_count: usize = 0;

    for path in paths {
        // 1. Kiểm tra an toàn trước khi thao tác
        let target = match PathSafetyValidator::validate_delete_target(path, allowed_roots) {
            Ok(t) => t,
            Err(AppError::ResourceBusy(_)) => {
                skipped_locked_count += 1;
                continue;
            }
            Err(e) => {
                warn!("🛑 CHẶN: Không cho phép xóa {:?}: {}", path, e);
                failed_count += 1;
                continue;
            }
        };

        if !target.is_file() {
            warn!("Bỏ qua mục không phải tệp thường: {:?}", target);
            failed_count += 1;
            continue;
        }

        // 2. Thực hiện xóa với SafeFileOps
        match SafeFileOps::delete_file(&target, false) {
            Ok(DeletionOutcome::Deleted { bytes_freed, .. }) => {
                freed_bytes += bytes_freed;
                success_count += 1;
            }
            Ok(DeletionOutcome::SkippedLockedFile { path: p, reason }) => {
                warn!("Bỏ qua tệp bị khóa: {} ({})", p, reason);
                skipped_locked_count += 1;
            }
            Ok(DeletionOutcome::Simulated { .. }) => {
                // Không xóa thực tế
            }
            Err(AppError::ResourceBusy(_)) => {
                skipped_locked_count += 1;
            }
            Err(e) => {
                warn!("Lỗi khi xóa tệp {:?}: {:?}", path, e);
                failed_count += 1;
            }
        }
    }

    info!(
        "Dọn dẹp hoàn tất: Giải phóng {} bytes, Thành công: {}, Thất bại: {}, Bị khóa bỏ qua: {}",
        freed_bytes, success_count, failed_count, skipped_locked_count
    );

    CleanResult {
        freed_bytes,
        success_count,
        failed_count,
        skipped_locked_count,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Gọi execute_clean_paths với allow-root là %TEMP% (nơi các test tạo tệp)
    fn clean_in_temp(paths: Vec<String>) -> AppResult<CleanResult> {
        let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
        Ok(execute_clean_paths(&paths, &[env::temp_dir()]))
    }

    #[test]
    fn test_scan_cleanable_items_dry_run_only() {
        // Tạo tệp tạm giả lập trong thư mục temp
        let temp_dir = env::temp_dir();
        let test_file = temp_dir.join("winpulse_cleaner_dry_run_test.tmp");

        let mut file = match fs::File::create(&test_file) {
            Ok(f) => f,
            Err(_) => return,
        };
        let _ = file.write_all(b"Test content for cleaner dry run");
        drop(file);

        // Thực hiện quét Dry-Run
        let scan_result = scan_cleanable_items();
        assert!(scan_result.is_ok());

        // Đảm bảo tệp vẫn tồn tại sau khi quét (chế độ Dry-Run tuyệt đối không xóa)
        assert!(test_file.exists());

        // Dọn dẹp tệp test
        let _ = fs::remove_file(test_file);
    }

    #[test]
    fn test_execute_clean_items_skips_blacklist() {
        let blacklisted_paths = vec![
            r"C:\Windows\System32\kernel32.dll".to_string(),
            r"C:\Users\MSI\Desktop\important.docx".to_string(),
        ];

        let result = clean_in_temp(blacklisted_paths);
        assert!(result.is_ok());
        if let Ok(res) = result {
            // Không xóa bất kỳ tệp blacklist nào
            assert_eq!(res.success_count, 0);
            assert_eq!(res.freed_bytes, 0);
            assert_eq!(res.failed_count, 2);
        }
    }

    #[test]
    fn test_execute_clean_items_with_temp_file() {
        let temp_dir = env::temp_dir();
        let test_file = temp_dir.join("winpulse_clean_exec_test.tmp");

        let mut file = match fs::File::create(&test_file) {
            Ok(f) => f,
            Err(_) => return,
        };
        let content = b"1234567890";
        let _ = file.write_all(content);
        drop(file);

        let path_str = test_file.to_string_lossy().to_string();
        let result = clean_in_temp(vec![path_str]);
        assert!(result.is_ok());
        if let Ok(res) = result {
            assert_eq!(res.success_count, 1);
            assert_eq!(res.freed_bytes, content.len() as u64);
            assert_eq!(res.failed_count, 0);
        }
        assert!(!test_file.exists());
    }

    #[test]
    fn test_cleaner_24h_age_rule_skips_young_files() {
        // Tạo tệp tạm vừa mới sinh ra (< 1 giây tuổi)
        let temp_dir = env::temp_dir();
        let young_file = temp_dir.join("winpulse_fresh_test_file.tmp");

        let mut file = match fs::File::create(&young_file) {
            Ok(f) => f,
            Err(_) => return,
        };
        let _ = file.write_all(b"Fresh temporary data - under 24 hours old");
        drop(file);

        // 1. Kiểm tra trực tiếp hàm thẩm định tuổi tệp: Phải trả về false (không cũ hơn 24h)
        let is_old = is_older_than_24_hours(&young_file);
        assert!(!is_old, "Tệp vừa mới tạo BẮT BUỘC phải có is_older_than_24_hours = false");

        // 2. Kiểm tra bộ quét scan_user_temp_files: Phải lọc bỏ tệp này, không bao giờ đưa vào danh sách rác
        let scanned = scan_user_temp_files(500);
        let young_path_str = young_file.to_string_lossy().to_string();
        let found = scanned.iter().any(|item| item.path.eq_ignore_ascii_case(&young_path_str));
        assert!(!found, "Bộ quét User Temp tuyệt đối không được đưa tệp dưới 24h vào danh sách dọn dẹp!");

        // Dọn dẹp tệp test
        let _ = fs::remove_file(young_file);
    }

    #[test]
    fn test_execute_clean_items_locked_file_handling() {
        use std::fs::OpenOptions;
        use std::os::windows::fs::OpenOptionsExt;

        // 1. Tạo tệp tạm để thử nghiệm
        let temp_dir = env::temp_dir();
        let locked_file = temp_dir.join("winpulse_locked_exec_test.tmp");

        let mut file = match fs::File::create(&locked_file) {
            Ok(f) => f,
            Err(_) => return,
        };
        let _ = file.write_all(b"Data locked by active process");
        drop(file);

        // 2. Giữ handle khóa độc quyền với share_mode(0): Cấm mọi quyền chia sẻ bao gồm FILE_SHARE_DELETE
        let lock_holder = match OpenOptions::new()
            .read(true)
            .write(true)
            .share_mode(0) // Khóa độc quyền, ngăn cản bất kỳ ai xóa file (gây ra ERROR_SHARING_VIOLATION 32)
            .open(&locked_file)
        {
            Ok(h) => h,
            Err(e) => {
                info!("Không thể mở file độc quyền trong test: {}", e);
                let _ = fs::remove_file(locked_file);
                return;
            }
        };

        // 3. Thực thi dọn dẹp đối với tệp đang bị khóa
        // YÊU CẦU BẤT KHẢ XÂM PHẠM: Không panic, không crash, ghi nhận vào skipped_locked_count!
        let path_str = locked_file.to_string_lossy().to_string();
        let clean_result = clean_in_temp(vec![path_str.clone()]);

        assert!(clean_result.is_ok(), "Thao tác execute_clean_items không được trả về Err khi gặp file lock");
        if let Ok(res) = clean_result {
            assert_eq!(res.skipped_locked_count, 1, "Phải ghi nhận đúng 1 tệp bị khóa vào skipped_locked_count");
            assert_eq!(res.success_count, 0, "Không được tính là xóa thành công");
            assert_eq!(res.freed_bytes, 0, "Dung lượng giải phóng phải là 0");
        }

        // Tệp vẫn phải còn nguyên vẹn trên ổ đĩa do đang bị khóa
        assert!(locked_file.exists(), "Tệp bị khóa không được mất dữ liệu");

        // 4. Giải phóng handle khóa
        drop(lock_holder);

        // 5. Sau khi giải phóng lock, dọn dẹp tệp test
        let clean_retry = clean_in_temp(vec![path_str]);
        assert!(clean_retry.is_ok());
        if let Ok(res) = clean_retry {
            assert_eq!(res.success_count, 1, "Sau khi mở khóa, xóa phải thành công");
            assert_eq!(res.skipped_locked_count, 0);
        }
        assert!(!locked_file.exists());
    }

    #[test]
    fn test_clean_rejects_path_outside_allowed_roots() {
        // Tệp nằm trong %TEMP% nhưng allow-root chỉ là một thư mục con khác → không được xóa
        let temp_dir = env::temp_dir();
        let victim = temp_dir.join("winpulse_outside_root_victim.tmp");
        if fs::write(&victim, b"keep me").is_err() {
            return;
        }
        let only_root = temp_dir.join("winpulse_only_allowed_root");
        let _ = fs::create_dir_all(&only_root);

        let res = execute_clean_paths(std::slice::from_ref(&victim), std::slice::from_ref(&only_root));
        assert_eq!(res.success_count, 0);
        assert_eq!(res.failed_count, 1);
        assert!(victim.exists(), "Tệp ngoài allow-root tuyệt đối không bị xóa");

        let _ = fs::remove_file(&victim);
        let _ = fs::remove_dir(&only_root);
    }

    #[test]
    fn test_clean_from_session_rejects_ids_outside_session() {
        let session = CleanerSession::new();
        let scan_id = match session.replace(
            "clean",
            vec![(
                "temp_0".to_string(),
                CleanableItem {
                    id: "temp_0".to_string(),
                    name: "x".to_string(),
                    path: r"C:\Windows\System32\kernel32.dll".to_string(),
                    size_bytes: 1,
                    category: "Safe".to_string(),
                    reason: String::new(),
                },
            )],
        ) {
            Ok(id) => id,
            Err(e) => panic!("replace thất bại: {:?}", e),
        };

        // Id không có trong phiên → từ chối cả yêu cầu
        assert!(clean_from_session(&session, &scan_id, &["fake".to_string()]).is_err());
        // Sai scan id → từ chối
        assert!(clean_from_session(&session, "stale", &["temp_0".to_string()]).is_err());
        // Ngay cả khi mục có trong phiên, đường dẫn hệ thống vẫn bị chặn bởi validator
        match clean_from_session(&session, &scan_id, &["temp_0".to_string()]) {
            Ok(res) => {
                assert_eq!(res.success_count, 0);
                assert_eq!(res.failed_count, 1);
            }
            Err(e) => panic!("Không được trả về Err tổng thể: {:?}", e),
        }
    }
}
