//! Cơ sở tri thức phân loại thư mục/tệp dung lượng lớn cho Disk Analyzer.
//!
//! Mỗi luật khớp theo chuỗi component của đường dẫn (không phân biệt hoa thường, so sánh nguyên
//! component — không dùng `contains` trên chuỗi), trả về mô tả tiếng Việt và mức an toàn.
//!
//! Quy tắc ưu tiên:
//! 1. Luật `Keep` LUÔN thắng (một đường dẫn vừa khớp Safe vừa khớp Keep → Keep).
//! 2. Đường dẫn nằm trong blacklist của `PathSafetyValidator` không bao giờ được Safe/Caution.
//! 3. Còn lại: luật đầu tiên khớp theo thứ tự trong `RULES` (luật cụ thể đặt trước).
//!
//! Thêm luật mới: xem skill `.claude/skills/folder-knowledge-rule`.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::safety::PathSafetyValidator;

/// Mức an toàn khi dọn một thư mục
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FolderSafety {
    /// Cache tự tái tạo, xóa không mất dữ liệu → cho phép chuyển vào Thùng rác
    Safe,
    /// Xóa được nhưng có hệ quả (tải lại, build lại, mất phiên) → cho phép xóa kèm cảnh báo
    Caution,
    /// Không xóa tay; phải dùng công cụ chính thức → chỉ hiển thị hướng dẫn
    UseTool,
    /// Dữ liệu cá nhân / hệ thống → chỉ "Mở trong Explorer"
    Keep,
    /// Không nhận diện được → chỉ "Mở trong Explorer"
    Unknown,
}

impl FolderSafety {
    /// Chỉ Safe/Caution mới có thể có nút xóa
    pub fn allows_delete(self) -> bool {
        matches!(self, FolderSafety::Safe | FolderSafety::Caution)
    }
}

/// Vị trí khớp của một chuỗi component
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Anchor {
    /// Đường dẫn KẾT THÚC bằng chuỗi (chính thư mục đó)
    End,
    /// Chuỗi xuất hiện liên tiếp ở bất kỳ đâu (đường dẫn nằm bên trong)
    Anywhere,
}

/// Điều kiện bổ sung cần kiểm tra trên hệ thống tệp (do bộ quét cung cấp)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Condition {
    None,
    /// Thư mục cha có tệp Cargo.toml (thư mục `target/` của dự án Rust)
    ParentHasCargoToml,
    /// Chỉ áp dụng cho tệp (không phải thư mục)
    FileOnly,
}

/// Một luật phân loại
#[derive(Debug, Clone, Copy)]
pub struct FolderRule {
    pub id: &'static str,
    /// Chuỗi component lowercase; "*" khớp đúng một component bất kỳ
    pub pattern: &'static [&'static str],
    pub anchor: Anchor,
    pub condition: Condition,
    pub safety: FolderSafety,
    pub title: &'static str,
    /// "Đây là gì"
    pub description: &'static str,
    /// "Xóa có sao không" — hệ quả khi xóa
    pub consequence: &'static str,
    /// "Cách dọn đúng"
    pub how_to_clean: &'static str,
}

/// Dữ liệu đầu vào để phân loại (bộ quét tự kiểm tra hệ thống tệp và điền các cờ)
#[derive(Debug, Clone, Copy, Default)]
pub struct ClassifyInput<'a> {
    pub path: &'a str,
    pub is_file: bool,
    pub parent_has_cargo_toml: bool,
}

/// Kết quả phân loại
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FolderInfo {
    /// id của luật, hoặc "unknown"
    pub kind: String,
    pub title: String,
    pub description: String,
    pub consequence: String,
    pub how_to_clean: String,
    pub safety: FolderSafety,
    /// Ứng dụng sở hữu đoán từ đường dẫn (cho mục Unknown)
    pub owner_app: Option<String>,
}

// Hàm dựng bảng luật: mỗi tham số là một cột của bảng, gom thành struct sẽ làm bảng khó đọc hơn
#[allow(clippy::too_many_arguments)]
const fn rule(
    id: &'static str,
    pattern: &'static [&'static str],
    anchor: Anchor,
    safety: FolderSafety,
    title: &'static str,
    description: &'static str,
    consequence: &'static str,
    how_to_clean: &'static str,
) -> FolderRule {
    FolderRule {
        id,
        pattern,
        anchor,
        condition: Condition::None,
        safety,
        title,
        description,
        consequence,
        how_to_clean,
    }
}

const fn with_condition(mut r: FolderRule, condition: Condition) -> FolderRule {
    r.condition = condition;
    r
}

use Anchor::{Anywhere, End};
use FolderSafety::{Caution, Keep, Safe, UseTool};

const RECYCLE_HINT: &str = "Chọn mục và bấm \"Chuyển vào Thùng rác\". Có thể khôi phục từ Thùng rác nếu cần.";

/// Bảng luật. Luật Keep đặt đầu cho dễ đọc; thứ tự giữa các luật không phải Keep quyết định độ ưu tiên.
pub const RULES: &[FolderRule] = &[
    // ===================== 🔴 KEEP — dữ liệu cá nhân =====================
    rule("user-desktop", &["users", "*", "desktop"], Anywhere, Keep, "Desktop (Màn hình nền)",
        "Tệp và thư mục bạn đặt trên màn hình nền.", "Đây là dữ liệu cá nhân — WinPulse không bao giờ xóa.",
        "Tự xem lại trong Explorer và xóa những gì bạn chắc chắn không cần."),
    rule("user-documents", &["users", "*", "documents"], Anywhere, Keep, "Documents (Tài liệu)",
        "Tài liệu cá nhân; nhiều game cũng lưu save game ở đây.", "Dữ liệu cá nhân — không xóa tự động.",
        "Tự xem lại trong Explorer. Có thể chuyển sang ổ khác qua Properties → Location."),
    rule("user-pictures", &["users", "*", "pictures"], Anywhere, Keep, "Pictures (Ảnh)",
        "Ảnh cá nhân, ảnh chụp màn hình.", "Dữ liệu cá nhân — không xóa tự động.",
        "Sao lưu lên ổ ngoài/đám mây rồi tự xóa nếu muốn."),
    rule("user-videos", &["users", "*", "videos"], Anywhere, Keep, "Videos",
        "Video cá nhân, bản ghi màn hình/game (Xbox Game Bar lưu ở Videos\\Captures).", "Dữ liệu cá nhân — không xóa tự động.",
        "Tự xem lại và xóa các bản ghi không cần."),
    rule("user-music", &["users", "*", "music"], Anywhere, Keep, "Music (Nhạc)",
        "Thư viện nhạc cá nhân.", "Dữ liệu cá nhân — không xóa tự động.", "Tự xem lại trong Explorer."),
    rule("user-downloads", &["users", "*", "downloads"], Anywhere, Keep, "Downloads (Tải về)",
        "Tệp bạn đã tải về: bộ cài, tài liệu, nén...", "Có thể chứa tệp quan trọng — không xóa tự động.",
        "Sắp xếp theo kích thước trong Explorer, xóa bộ cài (.exe/.msi/.iso) đã dùng xong."),
    rule("user-onedrive", &["users", "*", "onedrive"], Anywhere, Keep, "OneDrive",
        "Thư mục đồng bộ OneDrive.", "Xóa ở đây sẽ xóa luôn trên đám mây.",
        "Bật Files On-Demand: chuột phải → \"Free up space\" để giữ tệp trên mây, giải phóng ổ."),
    rule("ssh-keys", &[".ssh"], Anywhere, Keep, "Khóa SSH",
        "Khóa SSH dùng để đăng nhập máy chủ/Git.", "Mất khóa = mất quyền truy cập máy chủ.", "Không xóa."),
    rule("browser-profile-root", &["user data"], End, Keep, "Dữ liệu trình duyệt (User Data)",
        "Toàn bộ hồ sơ trình duyệt: mật khẩu, cookie, lịch sử, tiện ích.", "Xóa sẽ mất toàn bộ dữ liệu đăng nhập và cài đặt trình duyệt.",
        "Chỉ xóa cache bên trong (các mục \"Cache\"/\"Code Cache\") hoặc dùng Cài đặt trình duyệt → Xóa dữ liệu duyệt web."),
    rule("browser-profile", &["user data", "*"], End, Keep, "Hồ sơ trình duyệt",
        "Một hồ sơ (profile) trình duyệt Chromium.", "Xóa sẽ mất mật khẩu, cookie, lịch sử của hồ sơ này.",
        "Dùng Cài đặt trình duyệt → Xóa dữ liệu duyệt web, chọn \"Hình ảnh và tệp được lưu trong bộ nhớ đệm\"."),
    rule("firefox-profile", &["mozilla", "firefox", "profiles", "*"], End, Keep, "Hồ sơ Firefox",
        "Hồ sơ Firefox: mật khẩu, dấu trang, lịch sử.", "Xóa sẽ mất toàn bộ dữ liệu Firefox.",
        "Dùng Firefox → Settings → Privacy → Clear Data."),

    // ===================== 🔵 USE TOOL — dùng công cụ chính thức =====================
    rule("windows-winsxs", &["windows", "winsxs"], End, UseTool, "WinSxS (Component Store)",
        "Kho thành phần Windows dùng cho cập nhật và tính năng.", "Xóa tay sẽ làm hỏng Windows Update và có thể không khởi động được.",
        "Chạy (quyền Admin): Dism /Online /Cleanup-Image /StartComponentCleanup"),
    rule("windows-installer", &["windows", "installer"], End, UseTool, "Windows Installer cache",
        "Bản sao bộ cài .msi/.msp để gỡ cài đặt và vá lỗi phần mềm.", "Xóa tay làm phần mềm không gỡ/cập nhật được.",
        "Gỡ phần mềm không dùng trong Settings → Apps; không xóa thư mục này."),
    rule("windows-update-download", &["windows", "softwaredistribution", "download"], End, UseTool, "Tệp tải về của Windows Update",
        "Bản cập nhật Windows đã tải về.", "Windows tự quản lý; xóa khi đang cập nhật có thể làm hỏng lần cập nhật.",
        "Settings → System → Storage → Temporary files → \"Windows Update Cleanup\" (hoặc Disk Cleanup)."),
    rule("windows-old", &["windows.old"], End, UseTool, "Windows.old (bản Windows cũ)",
        "Bản Windows trước khi nâng cấp, giữ để quay lại phiên bản cũ.", "Xóa sẽ mất khả năng quay về bản Windows trước (thường tự xóa sau 10 ngày).",
        "Settings → System → Storage → Temporary files → \"Previous Windows installation(s)\"."),
    rule("user-temp", &["appdata", "local", "temp"], End, UseTool, "Thư mục Temp của người dùng",
        "Tệp tạm của các ứng dụng.", "Không xóa cả thư mục: ứng dụng đang chạy có thể cần tệp tạm mới tạo.",
        "Dùng tab \"Dọn dẹp an toàn\" của WinPulse (chỉ xóa tệp cũ hơn 24 giờ)."),
    rule("docker-wsl", &["appdata", "local", "docker", "wsl"], Anywhere, UseTool, "Ổ đĩa ảo Docker Desktop",
        "Ổ đĩa ảo (.vhdx) chứa image/container Docker.", "Xóa tay sẽ mất toàn bộ image, container, volume.",
        "docker system prune -a, sau đó Docker Desktop → Troubleshoot → Clean/Purge data; hoặc nén vhdx bằng Optimize-VHD."),
    with_condition(rule("wsl-vhdx", &["ext4.vhdx"], End, UseTool, "Ổ đĩa ảo WSL",
        "Ổ đĩa ảo của bản phân phối Linux trong WSL.", "Xóa tay sẽ mất toàn bộ dữ liệu Linux.",
        "Dọn trong Linux, rồi: wsl --shutdown và nén vhdx (Optimize-VHD hoặc diskpart compact vdisk)."), Condition::FileOnly),
    with_condition(rule("hiberfil", &["hiberfil.sys"], End, UseTool, "Tệp ngủ đông (hiberfil.sys)",
        "Lưu nội dung RAM khi Hibernate/Fast Startup.", "Không xóa được bằng tay khi Windows đang chạy.",
        "Nếu không dùng Hibernate: chạy powercfg /h off (quyền Admin)."), Condition::FileOnly),
    with_condition(rule("pagefile", &["pagefile.sys"], End, UseTool, "Bộ nhớ ảo (pagefile.sys)",
        "Bộ nhớ ảo Windows dùng khi RAM đầy.", "Tắt pagefile có thể làm ứng dụng/Windows bị lỗi khi hết RAM.",
        "Để Windows tự quản lý (System Properties → Advanced → Performance → Virtual memory)."), Condition::FileOnly),
    with_condition(rule("swapfile", &["swapfile.sys"], End, UseTool, "swapfile.sys",
        "Tệp hoán đổi cho ứng dụng Store.", "Windows tự quản lý.", "Không cần xử lý."), Condition::FileOnly),
    rule("steam-game", &["steamapps", "common", "*"], End, UseTool, "Game Steam đã cài",
        "Thư mục cài đặt một game Steam.", "Xóa tay làm Steam báo lỗi và có thể mất save game cục bộ.",
        "Gỡ trong Steam: Library → chuột phải game → Manage → Uninstall."),
    rule("program-files-app", &["program files", "*"], End, UseTool, "Ứng dụng đã cài (Program Files)",
        "Thư mục cài đặt một ứng dụng.", "Xóa tay để lại rác registry/dịch vụ và có thể làm hỏng ứng dụng khác.",
        "Gỡ trong Settings → Apps → Installed apps."),
    rule("program-files-x86-app", &["program files (x86)", "*"], End, UseTool, "Ứng dụng đã cài (Program Files x86)",
        "Thư mục cài đặt một ứng dụng 32-bit.", "Xóa tay để lại rác và có thể làm hỏng ứng dụng.",
        "Gỡ trong Settings → Apps → Installed apps."),

    // ===================== 🟢 SAFE — cache tự tái tạo =====================
    rule("npm-cache", &["appdata", "local", "npm-cache"], End, Safe, "Cache npm",
        "Bộ nhớ đệm gói Node.js của npm.", "Không mất dữ liệu; lần cài gói tiếp theo sẽ tải lại.", RECYCLE_HINT),
    rule("npm-cache-roaming", &["appdata", "roaming", "npm-cache"], End, Safe, "Cache npm",
        "Bộ nhớ đệm gói Node.js của npm.", "Không mất dữ liệu; lần cài gói tiếp theo sẽ tải lại.", RECYCLE_HINT),
    rule("pnpm-store", &["appdata", "local", "pnpm", "store"], End, Safe, "Kho gói pnpm",
        "Kho gói dùng chung của pnpm.", "Các dự án dùng pnpm sẽ phải tải lại gói (chạy pnpm install).",
        "Ưu tiên: pnpm store prune. Hoặc chuyển vào Thùng rác."),
    rule("pip-cache", &["appdata", "local", "pip", "cache"], End, Safe, "Cache pip (Python)",
        "Bộ nhớ đệm gói Python.", "Không mất dữ liệu; pip sẽ tải lại khi cần.", "pip cache purge, hoặc chuyển vào Thùng rác."),
    rule("cargo-registry-cache", &[".cargo", "registry", "cache"], End, Safe, "Cache crate Rust (.cargo)",
        "Các tệp .crate đã tải của Cargo.", "Không mất dữ liệu; Cargo tải lại khi build.", RECYCLE_HINT),
    rule("nuget-v3-cache", &["appdata", "local", "nuget", "v3-cache"], End, Safe, "Cache NuGet",
        "Bộ nhớ đệm HTTP của NuGet (.NET).", "Không mất dữ liệu.", "dotnet nuget locals http-cache --clear, hoặc chuyển vào Thùng rác."),
    rule("yarn-cache", &["appdata", "local", "yarn", "cache"], End, Safe, "Cache Yarn",
        "Bộ nhớ đệm gói của Yarn.", "Không mất dữ liệu; Yarn tải lại khi cần.", "yarn cache clean, hoặc chuyển vào Thùng rác."),
    rule("go-build-cache", &["appdata", "local", "go-build"], End, Safe, "Cache build Go",
        "Bộ nhớ đệm biên dịch của Go.", "Lần build Go tiếp theo sẽ chậm hơn một chút.", "go clean -cache, hoặc chuyển vào Thùng rác."),
    rule("nvidia-dxcache", &["appdata", "local", "nvidia", "dxcache"], End, Safe, "Shader cache NVIDIA (DirectX)",
        "Shader đã biên dịch của driver NVIDIA.", "Game có thể giật nhẹ lần đầu khi shader được tạo lại.", RECYCLE_HINT),
    rule("nvidia-glcache", &["appdata", "local", "nvidia", "glcache"], End, Safe, "Shader cache NVIDIA (OpenGL)",
        "Shader OpenGL đã biên dịch.", "Ứng dụng có thể chậm nhẹ lần đầu.", RECYCLE_HINT),
    rule("d3dscache", &["appdata", "local", "d3dscache"], End, Safe, "DirectX Shader Cache",
        "Shader DirectX đã biên dịch.", "Game có thể giật nhẹ lần đầu.", RECYCLE_HINT),
    rule("discord-cache", &["appdata", "roaming", "discord", "cache"], End, Safe, "Cache Discord",
        "Ảnh/tệp đệm của Discord.", "Không mất tin nhắn; ảnh sẽ tải lại.", "Thoát Discord trước, rồi chuyển vào Thùng rác."),
    rule("discord-code-cache", &["appdata", "roaming", "discord", "code cache"], End, Safe, "Code cache Discord",
        "Mã JavaScript đã biên dịch của Discord.", "Discord khởi động chậm hơn một lần.", "Thoát Discord trước, rồi chuyển vào Thùng rác."),
    rule("vscode-cache", &["appdata", "roaming", "code", "cache"], End, Safe, "Cache VS Code",
        "Bộ nhớ đệm của Visual Studio Code.", "Không mất cài đặt/tiện ích.", "Đóng VS Code trước, rồi chuyển vào Thùng rác."),
    rule("vscode-cacheddata", &["appdata", "roaming", "code", "cacheddata"], End, Safe, "CachedData VS Code",
        "Dữ liệu biên dịch đệm của các phiên bản VS Code (kể cả bản cũ).", "VS Code khởi động chậm hơn một lần.",
        "Đóng VS Code trước, rồi chuyển vào Thùng rác."),
    rule("teams-cache", &["appdata", "roaming", "microsoft", "teams", "cache"], End, Safe, "Cache Microsoft Teams",
        "Bộ nhớ đệm của Teams (bản cổ điển).", "Không mất tin nhắn; Teams tải lại dữ liệu.", "Thoát Teams trước, rồi chuyển vào Thùng rác."),
    rule("browser-cache", &["user data", "*", "cache"], End, Safe, "Cache trình duyệt",
        "Ảnh/tệp trang web được trình duyệt lưu đệm (KHÔNG gồm cookie, mật khẩu).", "Trang web tải chậm hơn một lần; vẫn giữ đăng nhập.",
        "Đóng trình duyệt trước, rồi chuyển vào Thùng rác."),
    rule("browser-code-cache", &["user data", "*", "code cache"], End, Safe, "Code cache trình duyệt",
        "Mã JavaScript đã biên dịch của các trang web.", "Trang web tải chậm hơn một lần.", "Đóng trình duyệt trước, rồi chuyển vào Thùng rác."),
    rule("browser-gpu-cache", &["user data", "*", "gpucache"], End, Safe, "GPU cache trình duyệt",
        "Shader GPU đã biên dịch của trình duyệt.", "Không mất dữ liệu.", "Đóng trình duyệt trước, rồi chuyển vào Thùng rác."),
    rule("firefox-cache", &["mozilla", "firefox", "profiles", "*", "cache2"], End, Safe, "Cache Firefox",
        "Bộ nhớ đệm trang web của Firefox.", "Trang web tải chậm hơn một lần.", "Đóng Firefox trước, rồi chuyển vào Thùng rác."),
    rule("crash-dumps", &["appdata", "local", "crashdumps"], End, Safe, "Crash Dumps",
        "Bản ghi bộ nhớ khi ứng dụng bị lỗi.", "Mất thông tin chẩn đoán lỗi cũ (chỉ cần khi gửi báo lỗi).", RECYCLE_HINT),

    // ===================== 🟡 CAUTION — xóa được nhưng có hệ quả =====================
    rule("node-modules", &["node_modules"], End, Caution, "node_modules (dự án Node.js)",
        "Thư viện đã cài của một dự án JavaScript/TypeScript.", "Dự án sẽ không chạy được cho đến khi chạy lại npm install / pnpm install.",
        "Chuyển vào Thùng rác; khi cần làm tiếp dự án thì chạy npm install."),
    rule("gradle-caches", &[".gradle", "caches"], End, Caution, "Cache Gradle",
        "Thư viện và kết quả build của Gradle (Android/Java).", "Lần build tiếp theo phải tải lại toàn bộ thư viện (lâu, tốn mạng).",
        "Đóng Android Studio/IDE trước, rồi chuyển vào Thùng rác."),
    rule("maven-repository", &[".m2", "repository"], End, Caution, "Kho Maven (.m2)",
        "Thư viện Java đã tải của Maven.", "Lần build tiếp theo phải tải lại thư viện; mất các gói cài cục bộ (mvn install).",
        "Chuyển vào Thùng rác khi chắc không cần các gói cài cục bộ."),
    with_condition(rule("rust-target", &["target"], End, Caution, "Thư mục build Rust (target)",
        "Kết quả biên dịch của một dự án Rust.", "Lần build tiếp theo sẽ biên dịch lại từ đầu (có thể lâu).",
        "cargo clean trong thư mục dự án, hoặc chuyển vào Thùng rác."), Condition::ParentHasCargoToml),
    rule("steam-shadercache", &["steamapps", "shadercache"], End, Caution, "Shader cache Steam",
        "Shader đã biên dịch sẵn cho các game Steam.", "Game sẽ biên dịch lại shader, có thể giật trong lần chơi đầu.",
        "Thoát Steam trước, rồi chuyển vào Thùng rác."),
];

/// Kiểm tra chuỗi pattern có khớp với components theo anchor
fn matches_pattern(comps: &[String], pattern: &[&str], anchor: Anchor) -> bool {
    if pattern.is_empty() || comps.len() < pattern.len() {
        return false;
    }
    let window_matches = |w: &[String]| w.iter().zip(pattern.iter()).all(|(c, p)| *p == "*" || c == p);
    match anchor {
        Anchor::End => window_matches(&comps[comps.len() - pattern.len()..]),
        Anchor::Anywhere => comps.windows(pattern.len()).any(window_matches),
    }
}

fn rule_applies(rule: &FolderRule, comps: &[String], input: &ClassifyInput) -> bool {
    let condition_ok = match rule.condition {
        Condition::None => true,
        Condition::ParentHasCargoToml => !input.is_file && input.parent_has_cargo_toml,
        Condition::FileOnly => input.is_file,
    };
    condition_ok && matches_pattern(comps, rule.pattern, rule.anchor)
}

/// Component giữ nguyên chữ hoa/thường gốc (để hiển thị tên ứng dụng), cùng quy tắc tách với `path_components`
fn original_components(path: &str) -> Vec<String> {
    let s = path.replace('/', "\\");
    let s = s
        .strip_prefix(r"\\?\")
        .unwrap_or(&s);
    let mut parts: Vec<String> = s
        .split('\\')
        .map(|p| p.trim_end_matches(' '))
        .filter(|p| !p.is_empty() && *p != ".")
        .map(|p| p.to_string())
        .collect();
    if parts.first().map(|f| f.len() == 2 && f.ends_with(':')).unwrap_or(false) {
        parts.remove(0);
    }
    parts
}

/// Đoán ứng dụng sở hữu từ đường dẫn (component sau AppData\Local|Roaming, ProgramData, Program Files)
pub fn guess_owner_app(comps: &[String], original: &[String]) -> Option<String> {
    for (i, c) in comps.iter().enumerate() {
        let next_is_owner = match c.as_str() {
            "local" | "roaming" | "locallow" => i > 0 && comps[i - 1] == "appdata",
            "programdata" | "program files" | "program files (x86)" => true,
            _ => false,
        };
        if next_is_owner {
            if let Some(name) = original.get(i + 1) {
                if !name.eq_ignore_ascii_case("packages") && !name.eq_ignore_ascii_case("programs") {
                    return Some(name.clone());
                }
                return original.get(i + 2).cloned();
            }
        }
    }
    None
}

fn info_from_rule(rule: &FolderRule) -> FolderInfo {
    FolderInfo {
        kind: rule.id.to_string(),
        title: rule.title.to_string(),
        description: rule.description.to_string(),
        consequence: rule.consequence.to_string(),
        how_to_clean: rule.how_to_clean.to_string(),
        safety: rule.safety,
        owner_app: None,
    }
}

/// Phân loại một đường dẫn
pub fn classify(input: &ClassifyInput) -> FolderInfo {
    let (_, comps) = PathSafetyValidator::path_components(Path::new(input.path));
    let original = original_components(input.path);

    // 1. Luật Keep luôn thắng
    if let Some(keep) = RULES
        .iter()
        .find(|r| r.safety == FolderSafety::Keep && rule_applies(r, &comps, input))
    {
        return info_from_rule(keep);
    }

    // 2. Luật đầu tiên khớp theo thứ tự
    if let Some(found) = RULES
        .iter()
        .find(|r| r.safety != FolderSafety::Keep && rule_applies(r, &comps, input))
    {
        let mut info = info_from_rule(found);
        // Đường dẫn bị blacklist tuyệt đối không bao giờ được xóa
        if info.safety.allows_delete() && PathSafetyValidator::is_blacklisted_path(Path::new(input.path)) {
            info.safety = FolderSafety::Keep;
            info.consequence = "Đường dẫn nằm trong danh sách bảo vệ của WinPulse.".to_string();
        }
        return info;
    }

    // 3. Không nhận diện được
    let owner = guess_owner_app(&comps, &original);
    FolderInfo {
        kind: "unknown".to_string(),
        title: match &owner {
            Some(app) => format!("Dữ liệu của {}", app),
            None => "Thư mục chưa nhận diện".to_string(),
        },
        description: "WinPulse chưa có thông tin về thư mục này.".to_string(),
        consequence: "Không rõ hệ quả — có thể là dữ liệu quan trọng của ứng dụng.".to_string(),
        how_to_clean: "Mở trong Explorer để tự kiểm tra; nếu là ứng dụng không dùng, hãy gỡ trong Settings → Apps.".to_string(),
        safety: FolderSafety::Unknown,
        owner_app: owner,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(path: &str) -> FolderInfo {
        classify(&ClassifyInput { path, is_file: false, parent_has_cargo_toml: false })
    }

    fn file(path: &str) -> FolderInfo {
        classify(&ClassifyInput { path, is_file: true, parent_has_cargo_toml: false })
    }

    #[test]
    fn test_safe_rules() {
        let cases = [
            (r"C:\Users\An\AppData\Local\npm-cache", "npm-cache"),
            (r"C:\Users\An\AppData\Roaming\npm-cache", "npm-cache-roaming"),
            (r"C:\Users\An\AppData\Local\pnpm\store", "pnpm-store"),
            (r"C:\Users\An\AppData\Local\pip\cache", "pip-cache"),
            (r"C:\Users\An\.cargo\registry\cache", "cargo-registry-cache"),
            (r"C:\Users\An\AppData\Local\NuGet\v3-cache", "nuget-v3-cache"),
            (r"C:\Users\An\AppData\Local\Yarn\Cache", "yarn-cache"),
            (r"C:\Users\An\AppData\Local\go-build", "go-build-cache"),
            (r"C:\Users\An\AppData\Local\NVIDIA\DXCache", "nvidia-dxcache"),
            (r"C:\Users\An\AppData\Local\D3DSCache", "d3dscache"),
            (r"C:\Users\An\AppData\Roaming\discord\Cache", "discord-cache"),
            (r"C:\Users\An\AppData\Roaming\Code\CachedData", "vscode-cacheddata"),
            (r"C:\Users\An\AppData\Roaming\Code\Cache", "vscode-cache"),
            (r"C:\Users\An\AppData\Roaming\Microsoft\Teams\Cache", "teams-cache"),
            (r"C:\Users\An\AppData\Local\Google\Chrome\User Data\Default\Cache", "browser-cache"),
            (r"C:\Users\An\AppData\Local\Microsoft\Edge\User Data\Profile 1\Code Cache", "browser-code-cache"),
            (r"C:\Users\An\AppData\Local\Mozilla\Firefox\Profiles\abc.default\cache2", "firefox-cache"),
            (r"C:\Users\An\AppData\Local\CrashDumps", "crash-dumps"),
        ];
        for (path, kind) in cases {
            let info = dir(path);
            assert_eq!(info.kind, kind, "{}", path);
            assert_eq!(info.safety, FolderSafety::Safe, "{}", path);
        }
    }

    #[test]
    fn test_caution_rules() {
        assert_eq!(dir(r"C:\Users\An\source\web\node_modules").safety, FolderSafety::Caution);
        assert_eq!(dir(r"C:\Users\An\.gradle\caches").kind, "gradle-caches");
        assert_eq!(dir(r"C:\Users\An\.m2\repository").kind, "maven-repository");
        assert_eq!(dir(r"D:\Steam\steamapps\shadercache").kind, "steam-shadercache");

        // target/ chỉ là Caution khi thư mục cha có Cargo.toml
        let with_cargo = classify(&ClassifyInput {
            path: r"C:\Users\An\code\app\target",
            is_file: false,
            parent_has_cargo_toml: true,
        });
        assert_eq!(with_cargo.kind, "rust-target");
        assert_eq!(with_cargo.safety, FolderSafety::Caution);
        assert_eq!(dir(r"C:\Users\An\code\app\target").safety, FolderSafety::Unknown);
    }

    #[test]
    fn test_use_tool_rules() {
        assert_eq!(dir(r"C:\Windows\WinSxS").safety, FolderSafety::UseTool);
        assert_eq!(dir(r"C:\Windows\Installer").kind, "windows-installer");
        assert_eq!(dir(r"C:\Windows\SoftwareDistribution\Download").kind, "windows-update-download");
        assert_eq!(dir(r"C:\Windows.old").kind, "windows-old");
        assert_eq!(dir(r"C:\Users\An\AppData\Local\Temp").kind, "user-temp");
        assert_eq!(dir(r"C:\Users\An\AppData\Local\Docker\wsl\disk").safety, FolderSafety::UseTool);
        assert_eq!(file(r"C:\Users\An\AppData\Local\Packages\Canonical.Ubuntu\LocalState\ext4.vhdx").kind, "wsl-vhdx");
        assert_eq!(file(r"C:\hiberfil.sys").kind, "hiberfil");
        assert_eq!(file(r"C:\pagefile.sys").kind, "pagefile");
        assert_eq!(dir(r"C:\Program Files\Adobe").kind, "program-files-app");
        assert_eq!(dir(r"D:\SteamLibrary\steamapps\common\Cyberpunk 2077").kind, "steam-game");
        // Luật FileOnly không áp dụng cho thư mục trùng tên
        assert_ne!(dir(r"C:\hiberfil.sys").kind, "hiberfil");
    }

    #[test]
    fn test_keep_rules() {
        for path in [
            r"C:\Users\An\Desktop",
            r"C:\Users\An\Documents",
            r"C:\Users\An\Pictures",
            r"C:\Users\An\Videos\Captures",
            r"C:\Users\An\Downloads",
            r"C:\Users\An\OneDrive",
            r"C:\Users\An\.ssh",
            r"C:\Users\An\AppData\Local\Google\Chrome\User Data",
            r"C:\Users\An\AppData\Local\Google\Chrome\User Data\Default",
            r"C:\Users\An\AppData\Roaming\Mozilla\Firefox\Profiles\abc.default",
        ] {
            assert_eq!(dir(path).safety, FolderSafety::Keep, "{}", path);
        }
    }

    #[test]
    fn test_keep_always_wins() {
        // node_modules (Caution) nằm trong Documents (Keep) → Keep
        assert_eq!(dir(r"C:\Users\An\Documents\proj\node_modules").safety, FolderSafety::Keep);
        // Cache trình duyệt (Safe) nằm trong Desktop (Keep) → Keep
        assert_eq!(dir(r"C:\Users\An\Desktop\portable\User Data\Default\Cache").safety, FolderSafety::Keep);
        // Cookies không bao giờ là cache
        assert_ne!(dir(r"C:\Users\An\AppData\Local\Google\Chrome\User Data\Default\Network\Cookies").safety, FolderSafety::Safe);
    }

    #[test]
    fn test_blacklisted_never_deletable() {
        // node_modules ngay trong thư mục hệ thống bị cấm → không được xóa
        let info = dir(r"C:\Windows\System32\node_modules");
        assert!(!info.safety.allows_delete());
    }

    #[test]
    fn test_unknown_and_owner_guess() {
        let info = dir(r"C:\Users\An\AppData\Local\JetBrains\IntelliJIdea2024.1");
        assert_eq!(info.safety, FolderSafety::Unknown);
        assert_eq!(info.owner_app.as_deref(), Some("JetBrains"));

        let info = dir(r"C:\ProgramData\Package Cache");
        assert_eq!(info.owner_app.as_deref(), Some("Package Cache"));

        let info = dir(r"C:\Users\An\AppData\Local\Programs\Microsoft VS Code");
        assert_eq!(info.owner_app.as_deref(), Some("Microsoft VS Code"));

        let info = dir(r"E:\Random\Folder");
        assert_eq!(info.safety, FolderSafety::Unknown);
        assert_eq!(info.owner_app, None);
    }

    #[test]
    fn test_safe_rules_need_appdata_anchor() {
        // Thư mục dự án của người dùng trùng tên không được coi là cache
        assert_eq!(dir(r"D:\projects\code\cache").safety, FolderSafety::Unknown);
        assert_eq!(dir(r"D:\backup\discord\Cache").safety, FolderSafety::Unknown);
        assert_eq!(dir(r"D:\work\NVIDIA\DXCache").safety, FolderSafety::Unknown);
    }

    #[test]
    fn test_only_safe_and_caution_allow_delete() {
        assert!(FolderSafety::Safe.allows_delete());
        assert!(FolderSafety::Caution.allows_delete());
        assert!(!FolderSafety::UseTool.allows_delete());
        assert!(!FolderSafety::Keep.allows_delete());
        assert!(!FolderSafety::Unknown.allows_delete());
    }

    #[test]
    fn test_rule_ids_unique_and_patterns_lowercase() {
        let mut ids: Vec<&str> = RULES.iter().map(|r| r.id).collect();
        ids.sort_unstable();
        let before = ids.len();
        ids.dedup();
        assert_eq!(before, ids.len(), "id luật bị trùng");
        for r in RULES {
            for p in r.pattern {
                assert_eq!(*p, p.to_lowercase(), "pattern phải viết thường: {}", r.id);
            }
        }
    }
}
