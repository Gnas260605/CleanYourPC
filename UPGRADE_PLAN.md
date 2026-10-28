# UPGRADE_PLAN.md — Kế hoạch sửa lỗi & nâng cấp WinPulse Optimizer (v1.1)

> Ngày lập: 2026-10-28. Thứ tự thực hiện = thứ tự ưu tiên. Mỗi giai đoạn là 1 (hoặc vài) commit/PR nhỏ, có tiêu chí nghiệm thu (DoD) riêng.
> Trước khi động vào bất kỳ code xóa file / kill process / sửa registry: đọc `RULE.md` và dùng skill `zero-harm-review`.

---

## Giai đoạn 0 — Hạ tầng (đã làm khi tạo repo)

- [x] `git init`, `.gitignore` (bỏ `node_modules/`, `dist/`, `src-tauri/target/`).
- [x] `CLAUDE.md` + skills trong `.claude/skills/` cho agent code trên cloud.
- [ ] GitHub Actions `windows-latest`: `npm ci && npm run build`, `cargo test` trong `src-tauri/`, `cargo clippy -- -D warnings`.
  - Lý do: môi trường cloud là Linux, **không chạy được test Rust** (crate `windows`, `std::os::windows`). CI Windows là nơi xác nhận thật.

---

## Giai đoạn 1 — Sửa lỗi bảo mật (P0, làm trước tiên)

### 1.1 HTTP server cổng 1421 mở cho mọi website
`src-tauri/src/http_server.rs` không có xác thực, trả `Access-Control-Allow-Origin: *`, có endpoint kill process / xóa file / sửa startup / tạo restore point. Bất kỳ trang web nào đang mở trong trình duyệt đều gọi được.

Sửa:
- Chỉ khởi động server khi `cfg!(debug_assertions)` (bản release không có cổng mở).
- Bỏ toàn bộ endpoint **POST** (thay đổi hệ thống). Chế độ trình duyệt chỉ để xem UI → chỉ giữ GET read-only (`metrics`, `system`, `processes`, `startup`, `cleaner/scan`, `history`).
- CORS chỉ cho `http://localhost:1420` và `http://127.0.0.1:1420`; kiểm tra header `Origin`/`Host` (chống DNS rebinding) — sai thì 403.
- Route match chính xác path (không dùng `starts_with` lỏng lẻo), giới hạn kích thước request.
- `apiBridge.ts`: các hàm mutating khi không ở Tauri → ném lỗi "Chỉ khả dụng trong app desktop" thay vì gọi HTTP.

### 1.2 `clean_files` xóa bất kỳ đường dẫn nào ngoài blacklist
`cleaner::execute_clean_items` chỉ kiểm tra blacklist → frontend gửi `D:\Projects\...` hay `C:\Program Files\...` là bị xóa.

Sửa:
- Backend giữ `ScanSession` (trong Tauri state) chứa tập path từ lần quét gần nhất + scan id. `clean_files(scan_id, ids)` chỉ xóa item có trong session đó (whitelist theo kết quả quét, không tin path từ UI).
- Thêm kiểm tra allow-root: path phải nằm dưới một trong các thư mục gốc được phép (`%TEMP%`, `%LOCALAPPDATA%\CrashDumps`, thumbcache...). So sánh trên path đã `canonicalize`, không dùng `contains`.
- Từ chối symlink/junction (`symlink_metadata`), tránh bị dẫn ra ngoài.
- Test: path ngoài session bị từ chối; path qua junction bị từ chối.

### 1.3 Các điểm nhỏ
- `tauri.conf.json`: đặt CSP thật (`default-src 'self'; style-src 'self' 'unsafe-inline' fonts.googleapis.com; font-src fonts.gstatic.com; connect-src ipc: http://ipc.localhost`).
- `safety.rs::is_blacklisted_path` dùng `contains` → dễ chặn nhầm/thả nhầm; chuyển sang so sánh theo component path đã chuẩn hóa. Giữ nguyên toàn bộ test hiện có + thêm test.
- Xóa đường dẫn hardcode `C:\Users\MSI\...` trong `src/services/apiBridge.ts`.

**DoD:** test Rust mới pass trên CI Windows; `curl -X POST 127.0.0.1:1421/...` không còn tác dụng; build release không mở cổng 1421.

---

## Giai đoạn 2 — Dọn dữ liệu giả & tài liệu sai lệch (P1)

- Navbar badges (`App.tsx`: `startupCount={7}`, `junkEstimateMB={1840}`, `heavyProcessCount={2}`) → lấy số thật (từ startup list, lần scan gần nhất, process list) hoặc ẩn badge khi chưa có dữ liệu.
- Tab **Services** đang là mảng hardcode `INITIAL_SERVICES`:
  - Thêm `src-tauri/src/services.rs`: đọc trạng thái/startup type thật qua Service Control Manager (`Win32_System_Services`).
  - Đổi startup type chỉ cho danh sách cho phép (DiagTrack, SysMain, RemoteRegistry, ...), chặn `CORE_SYSTEM_SERVICES`, cần quyền admin → nếu không có quyền thì báo rõ, không giả vờ thành công. Backup startup type cũ vào JSON để hoàn tác.
- Mock metrics (`generateMockMetrics`, nút "High Load Sim") chỉ bật ở `import.meta.env.DEV`; bản release hiển thị trạng thái "Không kết nối được backend".
- Cập nhật `HANDOFF.md` (đang mô tả bước scaffold đã xong từ lâu) và ghi chú trong `ARCHITECTURE.md`: hiện tại là **1 tiến trình**, mô hình UAC helper 2 tiến trình chưa làm (ghi vào `MEMORY.md` như nợ kỹ thuật).
- `FINAL_RELEASE_REPORT.md`: bỏ nhãn "100% Production Ready" cho đến khi giai đoạn 1–2 xong.

---

## Giai đoạn 3 — Tính năng mới: Phân tích thư mục dung lượng lớn ("Disk Analyzer")

### Mục tiêu
Người dùng thấy **thư mục nào đang chiếm nhiều dung lượng**, **nó là gì**, **xóa được không**, và **xóa thế nào cho đúng** — mặc định không xóa gì, mọi thao tác đều có xác nhận.

### Backend — `src-tauri/src/disk_analyzer.rs`
- Command `start_large_folder_scan(roots?, min_size_mb = 500)`:
  - Mặc định quét: `%USERPROFILE%` (depth 3), `%LOCALAPPDATA%`, `%APPDATA%`, `C:\ProgramData`, `C:\Windows\SoftwareDistribution\Download`, `C:\Windows.old`, file lớn ở gốc ổ (`hiberfil.sys`, `pagefile.sys`).
  - Chạy trên `tokio::task::spawn_blocking`, không follow symlink/junction, bỏ qua lỗi quyền truy cập.
  - Gửi tiến độ qua event `disk-scan-progress` (path hiện tại, số thư mục đã quét, byte đã đếm); kết quả qua `disk-scan-complete`.
  - `cancel_large_folder_scan()` dùng `AtomicBool`.
- Kết quả `LargeFolderItem { id, path, size_bytes, file_count, last_modified, kind, title, description, safety, how_to_clean, action }`.

### Cơ sở tri thức — `src-tauri/src/folder_knowledge.rs`
Bảng luật match theo pattern path → mô tả tiếng Việt + mức an toàn. 4 mức:

| Mức | Ý nghĩa | Hành động trong app |
| :-- | :-- | :-- |
| 🟢 `Safe` | Cache tự tái tạo, xóa không mất dữ liệu | Nút "Chuyển vào Thùng rác" |
| 🟡 `Caution` | Xóa được nhưng có hệ quả (tải lại, build lại, mất phiên đăng nhập) | Nút xóa + cảnh báo nêu rõ hệ quả |
| 🔵 `UseTool` | Không xóa tay; phải dùng công cụ chính thức | Hiển thị hướng dẫn/lệnh (vd `wsl --shutdown` + compact, `Dism /StartComponentCleanup`, gỡ app trong Settings) |
| 🔴 `Keep` | Dữ liệu cá nhân / hệ thống | Chỉ "Mở trong Explorer", không có nút xóa |
| ⚪ `Unknown` | Không nhận diện được | Chỉ "Mở trong Explorer" + hiển thị app sở hữu nếu đoán được |

Bộ luật khởi đầu (mỗi luật có test):
- 🟢 `npm-cache`, `pnpm store`, `pip\cache`, `.cargo\registry\cache`, `NuGet\v3-cache`, `Yarn\Cache`, `go-build`, `NVIDIA\DXCache`, `D3DSCache`, `Discord\Cache`, `Code\Cache`/`CachedData`, `Microsoft\Teams\Cache`, browser `Cache`/`Code Cache` (KHÔNG đụng `Cookies`, `Login Data`...), `%TEMP%`, `CrashDumps`, `SoftwareDistribution\Download`.
- 🟡 `node_modules` (xóa được, `npm install` lại), `.gradle\caches`, `.m2\repository`, `target/` của Rust, `Windows.old` (mất khả năng quay về bản Windows cũ), Steam `shadercache`.
- 🔵 `Docker\wsl\*.vhdx`, `Packages\*\LocalState\ext4.vhdx` (WSL), `WinSxS`, `hiberfil.sys` (`powercfg /h off`), `pagefile.sys`, `Installer` (`C:\Windows\Installer`), thư mục cài game/app (gỡ qua Settings / launcher).
- 🔴 `Desktop`, `Documents`, `Pictures`, `Videos`, `Downloads`, `OneDrive`, profile trình duyệt, `.ssh`, `AppData\Roaming\*\User Data` gốc.
- Luật 🔴 luôn thắng luật khác (một path vừa match Safe vừa match Keep → Keep).

### Xóa an toàn
- Chỉ xóa item `Safe`/`Caution` có trong phiên quét hiện tại (cùng cơ chế `ScanSession` ở 1.2), kiểm tra lại `PathSafetyValidator` ngay trước khi xóa.
- **Chuyển vào Thùng rác** (`IFileOperation` với `FOFX_RECYCLEONDELETE` / `SHFileOperationW` + `FOF_ALLOWUNDO`), không xóa vĩnh viễn → người dùng hoàn tác được.
- Ghi log vào `history.rs` (path, dung lượng, thời điểm).
- `open_in_explorer(path)` dùng `explorer.exe /select,` (truyền path làm tham số riêng, không ghép chuỗi shell).

### Frontend — tab mới "Phân tích ổ đĩa"
- `src/components/analyzer/DiskAnalyzer.tsx`: nút quét, thanh tiến độ + hủy, chọn ổ/thư mục gốc, ngưỡng dung lượng.
- Danh sách xếp theo dung lượng, thanh bar tỷ lệ so với ổ đĩa, badge mức an toàn, lọc theo mức.
- Panel chi tiết: "Đây là gì", "Xóa có sao không", "Cách dọn đúng", app sở hữu, lần sửa cuối.
- Hộp thoại xác nhận nêu tổng dung lượng + hệ quả với mục 🟡.
- Thêm vào `ActiveTab`, `Navbar`, `apiBridge.ts`, `types/index.ts`.

**DoD:** quét `%USERPROFILE%` trên máy thật < 60s, không treo UI; không có mục 🔴/🔵/⚪ nào có nút xóa; test luật phân loại pass.

---

## Giai đoạn 4 — Cải thiện giao diện

- **Trạng thái thật:** loading skeleton, empty state, error state có nút thử lại cho mọi tab (hiện nhiều chỗ chỉ `console.warn`).
- **Toast:** hàng đợi nhiều toast, phân loại success/warning/error (hiện chỉ có 1 kiểu cyan).
- **Hộp thoại xác nhận dùng chung** (`ConfirmDialog`) cho kill process, xóa file, tắt startup, đổi service — focus trap, Esc để đóng.
- **Khả năng truy cập:** `aria-label` cho nút icon, focus ring rõ, tương phản chữ `slate-400` trên nền tối ≥ 4.5:1, tôn trọng `prefers-reduced-motion` (tắt radar/scan animation).
- **Bố cục:** Navbar thành sidebar dọc khi cửa sổ ≥ 1024px; bảng process/startup có sort + search; chiều rộng tối thiểu 800px không vỡ layout.
- **Font:** đang tải Google Fonts qua mạng → đóng gói font local (app offline, khớp CSP).
- **Tách component lớn** (`ProcessGuardian.tsx` 509 dòng, `SafeCleaner.tsx` 477 dòng) thành phần nhỏ khi sửa.

---

## Giai đoạn 5 — Skill cho Claude Code (đã có bản đầu)

Trong `.claude/skills/`:
- `zero-harm-review` — checklist bắt buộc trước khi merge code xóa/kill/sửa registry/service.
- `add-tauri-command` — quy trình thêm 1 command end-to-end (Rust module → `commands.rs` → `lib.rs` → `types` → `apiBridge.ts`).
- `verify-change` — cách kiểm tra trên cloud Linux (tsc, vite build, `cargo check` có giới hạn) và trên Windows/CI.
- Bổ sung dần: `folder-knowledge-rule` (cách thêm luật phân loại thư mục kèm test) khi làm giai đoạn 3.

---

## Rủi ro & lưu ý
- Cloud (Linux) không chạy được app/test Windows → mọi thay đổi Rust phải qua CI `windows-latest` trước khi coi là xong.
- Đổi signature `clean_files` là breaking change giữa frontend và backend → sửa cả hai trong cùng commit.
- Không bao giờ thêm tính năng "dọn registry" hay "giải phóng RAM toàn bộ" (xem `REAL_WORLD_ANALYSIS.md`).
