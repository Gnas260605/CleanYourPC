//! Disk Analyzer: tìm thư mục/tệp chiếm nhiều dung lượng, giải thích bằng tiếng Việt và cho phép
//! chuyển vào Thùng rác các mục được phân loại Safe/Caution.
//!
//! Zero-Harm:
//! - Quét CHỈ ĐỌC, không đi theo symlink/junction, bỏ qua lỗi quyền truy cập.
//! - Xóa chỉ theo (scan_id, item_id) của phiên quét backend; phân loại lại ngay trước khi xóa;
//!   đường dẫn thật phải nằm dưới thư mục gốc đã quét và qua `PathSafetyValidator`.
//! - Luôn chuyển vào Thùng rác (có thể hoàn tác), không xóa vĩnh viễn.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use crate::error::{AppError, AppResult};
use crate::folder_knowledge::{self, ClassifyInput, FolderInfo, FolderSafety};
use crate::safety::PathSafetyValidator;
use crate::scan_session::ScanSessionStore;

/// Ngưỡng tối thiểu người dùng được chọn (MB)
pub const MIN_SIZE_MB_FLOOR: u64 = 50;
/// Ngưỡng mặc định (MB)
pub const DEFAULT_MIN_SIZE_MB: u64 = 500;
/// Độ sâu tối đa khi duyệt cây thư mục
const MAX_WALK_DEPTH: usize = 48;
/// Thư mục chưa nhận diện chỉ được báo cáo riêng tới độ sâu này (sâu hơn thì gộp vào cha)
const MAX_UNKNOWN_REPORT_DEPTH: usize = 4;
/// Khoảng cách tối thiểu giữa hai sự kiện tiến độ
const PROGRESS_INTERVAL: Duration = Duration::from_millis(150);

/// Hành động UI được phép với một mục
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ItemAction {
    /// Có nút "Chuyển vào Thùng rác"
    Recycle,
    /// Chỉ hiển thị hướng dẫn dùng công cụ chính thức
    ShowGuide,
    /// Chỉ "Mở trong Explorer"
    OpenOnly,
}

impl ItemAction {
    pub fn for_safety(safety: FolderSafety) -> Self {
        match safety {
            FolderSafety::Safe | FolderSafety::Caution => ItemAction::Recycle,
            FolderSafety::UseTool => ItemAction::ShowGuide,
            FolderSafety::Keep | FolderSafety::Unknown => ItemAction::OpenOnly,
        }
    }
}

/// Một mục dung lượng lớn tìm được
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LargeFolderItem {
    pub id: String,
    pub path: String,
    pub is_file: bool,
    pub size_bytes: u64,
    pub file_count: u64,
    /// Lần sửa đổi gần nhất (epoch giây) của tệp mới nhất bên trong
    pub last_modified: Option<i64>,
    pub kind: String,
    pub title: String,
    pub description: String,
    pub consequence: String,
    pub how_to_clean: String,
    pub safety: FolderSafety,
    pub action: ItemAction,
    pub owner_app: Option<String>,
}

/// Sự kiện `disk-scan-progress`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskScanProgress {
    pub current_path: String,
    pub dirs_scanned: u64,
    pub bytes_counted: u64,
}

/// Sự kiện `disk-scan-complete`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskScanComplete {
    pub scan_id: String,
    pub items: Vec<LargeFolderItem>,
    pub cancelled: bool,
    pub elapsed_ms: u64,
    pub roots: Vec<String>,
    pub dirs_scanned: u64,
    pub bytes_counted: u64,
    /// Tổng dung lượng ổ chứa thư mục gốc đầu tiên (0 nếu không xác định)
    pub volume_total_bytes: u64,
    /// Lỗi khiến quét dừng sớm (nếu có)
    pub error: Option<String>,
}

/// Kết quả chuyển vào Thùng rác
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RecycleResult {
    /// id các mục đã thực sự rời khỏi ổ đĩa
    pub recycled_ids: Vec<String>,
    pub recycled_count: usize,
    pub recycled_bytes: u64,
    pub failed_count: usize,
    /// Thông điệp lỗi từng mục (đã dịch tiếng Việt)
    pub errors: Vec<String>,
}

/// Trạng thái Disk Analyzer (Tauri managed state)
#[derive(Debug, Default)]
pub struct DiskAnalyzerState {
    pub session: ScanSessionStore<LargeFolderItem>,
    /// Thư mục gốc của phiên quét hiện tại (allow-root khi xóa)
    roots: Mutex<Vec<PathBuf>>,
    cancel: AtomicBool,
    running: AtomicBool,
}

impl DiskAnalyzerState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Đánh dấu bắt đầu quét; trả về false nếu đang có phiên quét khác chạy
    pub fn try_begin(&self) -> bool {
        self.cancel.store(false, Ordering::SeqCst);
        self.running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    pub fn finish(&self) {
        self.running.store(false, Ordering::SeqCst);
    }

    pub fn request_cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }

    pub fn cancel_flag(&self) -> &AtomicBool {
        &self.cancel
    }

    pub fn set_roots(&self, roots: Vec<PathBuf>) -> AppResult<()> {
        let mut guard = self
            .roots
            .lock()
            .map_err(|_| AppError::InvalidState("Trạng thái Disk Analyzer bị khóa".to_string()))?;
        *guard = roots;
        Ok(())
    }

    pub fn roots(&self) -> AppResult<Vec<PathBuf>> {
        self.roots
            .lock()
            .map(|g| g.clone())
            .map_err(|_| AppError::InvalidState("Trạng thái Disk Analyzer bị khóa".to_string()))
    }
}

// ==========================================
// THƯ MỤC GỐC
// ==========================================

/// Thư mục gốc mặc định: hồ sơ người dùng (gồm AppData), ProgramData, Windows Update, Windows.old
pub fn default_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(profile) = std::env::var("USERPROFILE") {
        roots.push(PathBuf::from(profile));
    }
    if let Ok(pd) = std::env::var("ProgramData") {
        roots.push(PathBuf::from(pd));
    }
    let system_drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".to_string());
    let windir = std::env::var("SystemRoot").unwrap_or_else(|_| format!(r"{}\Windows", system_drive));
    roots.push(Path::new(&windir).join("SoftwareDistribution").join("Download"));
    roots.push(PathBuf::from(format!(r"{}\Windows.old", system_drive)));
    roots.into_iter().filter(|p| p.is_dir()).collect()
}

/// Kiểm tra thư mục gốc người dùng chọn: phải tồn tại, là thư mục thật (không phải liên kết), không phải UNC
pub fn validate_custom_root(raw: &str) -> AppResult<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidPath("Đường dẫn trống".to_string()));
    }
    if trimmed.starts_with(r"\\") || trimmed.starts_with("//") {
        return Err(AppError::InvalidPath("Không hỗ trợ quét thư mục mạng (UNC)".to_string()));
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err(AppError::InvalidPath(format!("'{}' không phải đường dẫn tuyệt đối", trimmed)));
    }
    let meta = PathSafetyValidator::ensure_not_link(&path)?;
    if !meta.is_dir() {
        return Err(AppError::InvalidPath(format!("'{}' không phải thư mục", trimmed)));
    }
    Ok(path)
}

/// Bỏ các thư mục gốc lồng nhau (giữ thư mục cha) để không đếm trùng
pub fn dedupe_roots(mut roots: Vec<PathBuf>) -> Vec<PathBuf> {
    roots.sort_by_key(|p| PathSafetyValidator::path_components(p).1.len());
    let mut out: Vec<PathBuf> = Vec::new();
    for r in roots {
        if !out.iter().any(|kept| PathSafetyValidator::is_under_root(&r, kept)) {
            out.push(r);
        }
    }
    out
}

// ==========================================
// BỘ QUÉT
// ==========================================

#[derive(Debug, Default, Clone, Copy)]
struct DirStats {
    size: u64,
    files: u64,
    last_modified: Option<i64>,
}

impl DirStats {
    fn absorb(&mut self, other: DirStats) {
        self.size += other.size;
        self.files += other.files;
        self.last_modified = self.last_modified.max(other.last_modified);
    }
}

fn modified_secs(meta: &fs::Metadata) -> Option<i64> {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
}

/// Symlink, junction, hoặc reparse point bất kỳ (kể cả placeholder đám mây ở cấp thư mục) → không đi vào
fn is_link_like(entry: &fs::DirEntry, meta: Option<&fs::Metadata>) -> bool {
    if entry.file_type().map(|t| t.is_symlink()).unwrap_or(true) {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        if let Some(m) = meta {
            if m.is_dir() && m.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                return true;
            }
        }
    }
    #[cfg(not(windows))]
    let _ = meta;
    false
}

/// Phân loại một đường dẫn trên đĩa (tự kiểm tra Cargo.toml cho thư mục `target`)
pub fn classify_path(path: &Path, is_file: bool) -> FolderInfo {
    let path_str = path.to_string_lossy();
    let parent_has_cargo_toml = !is_file
        && path
            .file_name()
            .map(|n| n.eq_ignore_ascii_case("target"))
            .unwrap_or(false)
        && path
            .parent()
            .map(|p| p.join("Cargo.toml").is_file())
            .unwrap_or(false);
    folder_knowledge::classify(&ClassifyInput {
        path: &path_str,
        is_file,
        parent_has_cargo_toml,
    })
}

struct Walker<'a, F: FnMut(&DiskScanProgress)> {
    min_size: u64,
    cancel: &'a AtomicBool,
    on_progress: F,
    items: Vec<LargeFolderItem>,
    reported_bytes: u64,
    dirs_scanned: u64,
    bytes_counted: u64,
    last_emit: Instant,
}

impl<'a, F: FnMut(&DiskScanProgress)> Walker<'a, F> {
    fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    fn maybe_emit(&mut self, current: &Path) {
        if self.last_emit.elapsed() >= PROGRESS_INTERVAL {
            self.last_emit = Instant::now();
            let progress = DiskScanProgress {
                current_path: current.to_string_lossy().to_string(),
                dirs_scanned: self.dirs_scanned,
                bytes_counted: self.bytes_counted,
            };
            (self.on_progress)(&progress);
        }
    }

    fn push(&mut self, path: &Path, is_file: bool, stats: DirStats, info: FolderInfo) {
        self.reported_bytes += stats.size;
        let action = ItemAction::for_safety(info.safety);
        self.items.push(LargeFolderItem {
            id: format!("disk_{}", self.items.len()),
            path: path.to_string_lossy().to_string(),
            is_file,
            size_bytes: stats.size,
            file_count: stats.files,
            last_modified: stats.last_modified,
            kind: info.kind,
            title: info.title,
            description: info.description,
            consequence: info.consequence,
            how_to_clean: info.how_to_clean,
            safety: info.safety,
            action,
            owner_app: info.owner_app,
        });
    }

    /// Duyệt toàn bộ cây con, trả về thống kê. `report = false` → chỉ đếm dung lượng, không báo cáo mục con.
    fn walk(&mut self, dir: &Path, depth: usize, report: bool) -> DirStats {
        let mut stats = DirStats::default();
        if depth > MAX_WALK_DEPTH || self.cancelled() {
            return stats;
        }
        let entries = match fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return stats, // Không có quyền / đã bị xóa: bỏ qua
        };
        self.dirs_scanned += 1;
        self.maybe_emit(dir);

        for entry in entries.flatten() {
            if self.cancelled() {
                break;
            }
            // DirEntry::metadata không đi theo symlink trên Windows
            let meta = entry.metadata().ok();
            if is_link_like(&entry, meta.as_ref()) {
                continue;
            }
            let meta = match meta {
                Some(m) => m,
                None => continue,
            };
            let path = entry.path();

            if meta.is_file() {
                let file_stats = DirStats {
                    size: meta.len(),
                    files: 1,
                    last_modified: modified_secs(&meta),
                };
                self.bytes_counted += file_stats.size;
                if report && file_stats.size >= self.min_size {
                    let info = classify_path(&path, true);
                    self.push(&path, true, file_stats, info);
                }
                stats.absorb(file_stats);
            } else if meta.is_dir() {
                let info = classify_path(&path, false);
                if info.safety != FolderSafety::Unknown {
                    // Thư mục nhận diện được: báo cáo nguyên khối, không đi sâu báo cáo mục con
                    let child = self.walk(&path, depth + 1, false);
                    if report && child.size >= self.min_size {
                        self.push(&path, false, child, info);
                    }
                    stats.absorb(child);
                } else {
                    let reported_before = self.reported_bytes;
                    let child_report = report && depth < MAX_UNKNOWN_REPORT_DEPTH;
                    let child = self.walk(&path, depth + 1, child_report);
                    let inside = self.reported_bytes - reported_before;
                    // Báo cáo thư mục chưa nhận diện nếu phần dung lượng "chưa được giải thích" vẫn lớn
                    if child_report && child.size.saturating_sub(inside) >= self.min_size {
                        let mut own = child;
                        own.size = child.size - inside;
                        self.push(&path, false, own, info);
                    }
                    stats.absorb(child);
                }
            }
        }
        stats
    }
}

/// Kết quả thô của bộ quét
#[derive(Debug, Default)]
pub struct ScanOutput {
    pub items: Vec<LargeFolderItem>,
    pub cancelled: bool,
    pub dirs_scanned: u64,
    pub bytes_counted: u64,
}

/// Tệp hệ thống lớn ở gốc ổ đĩa (hiberfil.sys, pagefile.sys, swapfile.sys) — chỉ đọc metadata
fn root_system_files() -> Vec<PathBuf> {
    let drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".to_string());
    ["hiberfil.sys", "pagefile.sys", "swapfile.sys"]
        .iter()
        .map(|f| PathBuf::from(format!(r"{}\{}", drive, f)))
        .collect()
}

/// Quét các thư mục gốc. Hàm chặn (chạy trong spawn_blocking).
pub fn scan<F: FnMut(&DiskScanProgress)>(
    roots: &[PathBuf],
    min_size_bytes: u64,
    include_root_system_files: bool,
    cancel: &AtomicBool,
    on_progress: F,
) -> ScanOutput {
    let mut walker = Walker {
        min_size: min_size_bytes,
        cancel,
        on_progress,
        items: Vec::new(),
        reported_bytes: 0,
        dirs_scanned: 0,
        bytes_counted: 0,
        last_emit: Instant::now(),
    };

    for root in roots {
        if walker.cancelled() {
            break;
        }
        let info = classify_path(root, false);
        if info.safety != FolderSafety::Unknown {
            let stats = walker.walk(root, 0, false);
            if stats.size >= min_size_bytes {
                walker.push(root, false, stats, info);
            }
        } else {
            walker.walk(root, 0, true);
        }
    }

    if include_root_system_files && !walker.cancelled() {
        for f in root_system_files() {
            if let Ok(meta) = fs::metadata(&f) {
                if meta.is_file() && meta.len() >= min_size_bytes {
                    let stats = DirStats {
                        size: meta.len(),
                        files: 1,
                        last_modified: modified_secs(&meta),
                    };
                    let info = classify_path(&f, true);
                    walker.push(&f, true, stats, info);
                }
            }
        }
    }

    let cancelled = walker.cancelled();
    let mut items = walker.items;
    items.sort_by_key(|i| std::cmp::Reverse(i.size_bytes));
    // Đánh lại id theo thứ tự hiển thị
    for (idx, item) in items.iter_mut().enumerate() {
        item.id = format!("disk_{}", idx);
    }
    ScanOutput {
        items,
        cancelled,
        dirs_scanned: walker.dirs_scanned,
        bytes_counted: walker.bytes_counted,
    }
}

// ==========================================
// XÓA (THÙNG RÁC) & MỞ EXPLORER
// ==========================================

/// Kiểm tra lại một mục ngay trước khi xóa. Trả về đường dẫn đã canonicalize.
pub fn validate_recycle_target(item: &LargeFolderItem, roots: &[PathBuf]) -> AppResult<PathBuf> {
    if !item.safety.allows_delete() || item.action != ItemAction::Recycle {
        return Err(AppError::PermissionDenied(format!(
            "'{}' không thuộc nhóm được phép xóa",
            item.title
        )));
    }
    let path = Path::new(&item.path);
    let meta = PathSafetyValidator::ensure_not_link(path)?;

    // Phân loại lại theo trạng thái hiện tại trên đĩa — phải vẫn là cùng luật và vẫn cho phép xóa
    let now = classify_path(path, meta.is_file());
    if now.kind != item.kind || !now.safety.allows_delete() {
        return Err(AppError::InvalidState(format!(
            "Phân loại của '{}' đã thay đổi, hãy quét lại",
            item.path
        )));
    }

    PathSafetyValidator::validate_delete_target(path, roots)
}

/// Chuyển các mục trong phiên quét vào Thùng rác
pub fn recycle_items(state: &DiskAnalyzerState, scan_id: &str, item_ids: &[String]) -> AppResult<RecycleResult> {
    let items = state.session.resolve(scan_id, item_ids)?;
    let roots = state.roots()?;
    let mut result = RecycleResult::default();
    let mut done_ids = Vec::new();

    for item in &items {
        let target = match validate_recycle_target(item, &roots) {
            Ok(t) => t,
            Err(e) => {
                warn!("🛑 Từ chối xóa {}: {}", item.path, e);
                result.failed_count += 1;
                result.errors.push(format!("{}: {}", item.title, e));
                continue;
            }
        };

        match recycle_bin::send_to_recycle_bin(&target) {
            Ok(()) if !target.exists() => {
                info!("♻️ Đã chuyển vào Thùng rác: {:?} ({} bytes)", target, item.size_bytes);
                result.recycled_count += 1;
                result.recycled_bytes += item.size_bytes;
                done_ids.push(item.id.clone());
            }
            Ok(()) => {
                result.failed_count += 1;
                result.errors.push(format!(
                    "{}: một số tệp đang được sử dụng nên chưa xóa hết",
                    item.title
                ));
            }
            Err(e) => {
                result.failed_count += 1;
                result.errors.push(format!("{}: {}", item.title, e));
            }
        }
    }

    state.session.remove(scan_id, &done_ids)?;
    result.recycled_ids = done_ids;
    Ok(result)
}

/// Mở Explorer và chọn sẵn mục (đường dẫn truyền thành tham số riêng, không ghép chuỗi shell)
pub fn open_in_explorer(state: &DiskAnalyzerState, scan_id: &str, item_id: &str) -> AppResult<()> {
    let items = state.session.resolve(scan_id, &[item_id.to_string()])?;
    let item = items
        .first()
        .ok_or_else(|| AppError::InvalidState("Không tìm thấy mục".to_string()))?;
    let path = Path::new(&item.path);
    if !path.exists() {
        return Err(AppError::InvalidPath(format!("'{}' không còn tồn tại", item.path)));
    }
    std::process::Command::new("explorer.exe")
        .arg("/select,")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| AppError::SystemError(format!("Không mở được Explorer: {}", e)))
}

/// Bỏ tiền tố verbatim `\\?\` (SHFileOperation không hỗ trợ); từ chối đường dẫn mạng
pub fn to_shell_path(path: &Path) -> AppResult<String> {
    let s = path.to_string_lossy().to_string();
    if s.starts_with(r"\\?\UNC\") || (s.starts_with(r"\\") && !s.starts_with(r"\\?\")) {
        return Err(AppError::InvalidPath("Không hỗ trợ xóa trên thư mục mạng".to_string()));
    }
    Ok(s.strip_prefix(r"\\?\").unwrap_or(&s).to_string())
}

#[cfg(windows)]
mod recycle_bin {
    use super::to_shell_path;
    use crate::error::{AppError, AppResult};
    use std::path::Path;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::{
        SHFileOperationW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT,
        FOF_WANTNUKEWARNING, FO_DELETE, SHFILEOPSTRUCTW,
    };

    /// Chuyển vào Thùng rác bằng SHFileOperationW + FOF_ALLOWUNDO.
    /// FOF_WANTNUKEWARNING: nếu mục quá lớn cho Thùng rác, Windows hỏi người dùng thay vì xóa vĩnh viễn âm thầm.
    pub fn send_to_recycle_bin(path: &Path) -> AppResult<()> {
        let shell_path = to_shell_path(path)?;
        // pFrom phải kết thúc bằng hai ký tự null
        let mut wide: Vec<u16> = shell_path.encode_utf16().collect();
        wide.push(0);
        wide.push(0);

        let flags = FOF_ALLOWUNDO.0 | FOF_NOCONFIRMATION.0 | FOF_NOERRORUI.0 | FOF_SILENT.0 | FOF_WANTNUKEWARNING.0;
        let mut op = SHFILEOPSTRUCTW {
            hwnd: HWND::default(),
            wFunc: FO_DELETE,
            pFrom: PCWSTR(wide.as_ptr()),
            pTo: PCWSTR::null(),
            fFlags: flags as u16,
            ..Default::default()
        };
        // SAFETY: `op` và buffer `wide` sống suốt lời gọi; pFrom kết thúc bằng hai null
        let code = unsafe { SHFileOperationW(&mut op) };
        if op.fAnyOperationsAborted.as_bool() {
            return Err(AppError::InvalidState("Người dùng đã hủy thao tác xóa".to_string()));
        }
        if code != 0 {
            return Err(AppError::SystemError(format!(
                "Windows không chuyển được vào Thùng rác (mã 0x{:X}) — có thể tệp đang được sử dụng hoặc thiếu quyền",
                code
            )));
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod recycle_bin {
    use crate::error::{AppError, AppResult};
    use std::path::Path;

    pub fn send_to_recycle_bin(_path: &Path) -> AppResult<()> {
        Err(AppError::SystemError("Thùng rác chỉ hỗ trợ trên Windows".to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_tree(base: &Path) {
        let _ = fs::remove_dir_all(base);
        let npm = base.join("AppData").join("Local").join("npm-cache");
        let unknown = base.join("SomeApp").join("data");
        let _ = fs::create_dir_all(&npm);
        let _ = fs::create_dir_all(&unknown);
        let _ = fs::write(npm.join("a.bin"), vec![0u8; 4096]);
        let _ = fs::write(unknown.join("b.bin"), vec![0u8; 8192]);
        let _ = fs::write(base.join("small.txt"), b"x");
    }

    #[test]
    fn test_scan_reports_classified_and_unknown_folders() {
        let base = std::env::temp_dir().join("winpulse_disk_scan_test");
        make_tree(&base);
        let cancel = AtomicBool::new(false);
        let out = scan(std::slice::from_ref(&base), 1024, false, &cancel, |_| {});
        assert!(!out.cancelled);

        let npm = out.items.iter().find(|i| i.kind == "npm-cache");
        assert!(npm.is_some(), "phải nhận diện npm-cache: {:?}", out.items);
        if let Some(npm) = npm {
            assert_eq!(npm.size_bytes, 4096);
            assert_eq!(npm.safety, FolderSafety::Safe);
            assert_eq!(npm.action, ItemAction::Recycle);
        }
        // Thư mục chưa nhận diện chỉ được báo cáo, không có quyền xóa
        assert!(out
            .items
            .iter()
            .filter(|i| i.safety == FolderSafety::Unknown)
            .all(|i| i.action == ItemAction::OpenOnly));
        // Sắp xếp giảm dần theo dung lượng
        assert!(out.items.windows(2).all(|w| w[0].size_bytes >= w[1].size_bytes));
        // Quét không xóa gì
        assert!(base.join("SomeApp").join("data").join("b.bin").exists());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn test_scan_cancel() {
        let base = std::env::temp_dir().join("winpulse_disk_scan_cancel_test");
        make_tree(&base);
        let cancel = AtomicBool::new(true);
        let out = scan(std::slice::from_ref(&base), 1, false, &cancel, |_| {});
        assert!(out.cancelled);
        assert!(out.items.is_empty());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn test_no_delete_for_keep_usetool_unknown() {
        for safety in [FolderSafety::Keep, FolderSafety::UseTool, FolderSafety::Unknown] {
            assert_ne!(ItemAction::for_safety(safety), ItemAction::Recycle);
            let item = LargeFolderItem {
                id: "x".into(),
                path: std::env::temp_dir().to_string_lossy().to_string(),
                is_file: false,
                size_bytes: 1,
                file_count: 1,
                last_modified: None,
                kind: "unknown".into(),
                title: "t".into(),
                description: String::new(),
                consequence: String::new(),
                how_to_clean: String::new(),
                safety,
                // Giả sử frontend/phiên bị sửa action → validator vẫn phải từ chối theo safety
                action: ItemAction::Recycle,
                owner_app: None,
            };
            assert!(validate_recycle_target(&item, &[std::env::temp_dir()]).is_err());
        }
    }

    #[test]
    fn test_recycle_rejects_reclassified_and_outside_root() {
        let base = std::env::temp_dir().join("winpulse_disk_recycle_test");
        make_tree(&base);
        let npm = base.join("AppData").join("Local").join("npm-cache");
        let item = LargeFolderItem {
            id: "disk_0".into(),
            path: npm.to_string_lossy().to_string(),
            is_file: false,
            size_bytes: 4096,
            file_count: 1,
            last_modified: None,
            kind: "npm-cache".into(),
            title: "Cache npm".into(),
            description: String::new(),
            consequence: String::new(),
            how_to_clean: String::new(),
            safety: FolderSafety::Safe,
            action: ItemAction::Recycle,
            owner_app: None,
        };
        // Hợp lệ khi allow-root là thư mục gốc đã quét
        assert!(validate_recycle_target(&item, std::slice::from_ref(&base)).is_ok());
        // Ngoài allow-root → từ chối
        let other = std::env::temp_dir().join("winpulse_disk_recycle_other_root");
        let _ = fs::create_dir_all(&other);
        assert!(validate_recycle_target(&item, std::slice::from_ref(&other)).is_err());
        // Phiên ghi kind khác với phân loại hiện tại → từ chối
        let mut tampered = item.clone();
        tampered.path = base.join("SomeApp").to_string_lossy().to_string();
        assert!(validate_recycle_target(&tampered, std::slice::from_ref(&base)).is_err());

        let _ = fs::remove_dir_all(&base);
        let _ = fs::remove_dir_all(&other);
    }

    #[test]
    fn test_recycle_items_rejects_ids_outside_session() {
        let state = DiskAnalyzerState::new();
        assert!(recycle_items(&state, "none", &["disk_0".to_string()]).is_err());
    }

    #[test]
    fn test_custom_root_validation_and_dedupe() {
        assert!(validate_custom_root("").is_err());
        assert!(validate_custom_root(r"\\server\share").is_err());
        assert!(validate_custom_root("relative\\path").is_err());
        assert!(validate_custom_root(&std::env::temp_dir().to_string_lossy()).is_ok());

        let a = PathBuf::from(r"C:\Users\An");
        let b = PathBuf::from(r"C:\Users\An\AppData\Local");
        let c = PathBuf::from(r"C:\ProgramData");
        let out = dedupe_roots(vec![b, a.clone(), c.clone()]);
        // Sắp xếp theo độ sâu: thư mục nông hơn đứng trước; thư mục con của C:\Users\An bị loại
        assert_eq!(out, vec![c, a]);
    }

    #[test]
    fn test_to_shell_path() {
        match to_shell_path(Path::new(r"\\?\C:\Users\An\AppData\Local\npm-cache")) {
            Ok(p) => assert_eq!(p, r"C:\Users\An\AppData\Local\npm-cache"),
            Err(e) => panic!("{:?}", e),
        }
        assert!(to_shell_path(Path::new(r"\\?\UNC\server\share\x")).is_err());
        assert!(to_shell_path(Path::new(r"\\server\share\x")).is_err());
    }
}
