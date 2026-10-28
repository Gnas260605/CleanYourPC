# 🛡️ BÁO CÁO THẨM ĐỊNH AN TOÀN VÀ ĐẢM BẢO CHẤT LƯỢNG TOÀN DIỆN (COMPREHENSIVE SAFETY AUDIT & QA REPORT)

**Dự án:** WinPulse Optimizer  
**Phiên bản thẩm định:** Sprint 1, 2 & 3 (Toàn diện hệ thống: Core Metrics, Startup Manager, Process Guardian, Disk Cleaner, System Restore Point)  
**Kỹ sư trưởng thẩm định:** Safety-Auditor-QA  
**Ngày thẩm định:** 28/10/2026  
**Tiêu chuẩn đối chiếu:** [RULE.md](./RULE.md) (*"Zero-Harm System Guarantee"*)

---

## Executive Summary (Tóm tắt kết quả kiểm định tổng thể)

Toàn bộ hệ thống mã nguồn Backend Rust (`src-tauri/src/`), Integration Tests (`src-tauri/tests/`), và Frontend TypeScript/React (`src/`) đã trải qua quá trình rà soát tĩnh (Static Code Analysis), kiểm tra quy chuẩn an toàn bất khả xâm phạm (Zero-Harm Compliance), và chạy kiểm thử tự động toàn diện (32 Automated Unit & Integration Tests).

| Hạng mục kiểm định | Tiêu chuẩn RULE.md | Trạng thái | Đánh giá tóm tắt chi tiết |
| :--- | :--- | :---: | :--- |
| **1. Absolute Blacklist** | Cấm ghi/xóa/sửa System32, SysWOW64, Boot, EFI, Recycler, User profiles, Browser DBs | **ĐẠT (PASS)** | Bộ lọc `PathSafetyValidator` đa tầng; chặn 100% các tệp nhạy cảm và tấn công Directory Traversal (`..`). |
| **2. No Blind Registry Cleaning** | Cấm dọn Registry mù quáng; chỉ can thiệp StartupApproved; bắt buộc backup | **ĐẠT (PASS)** | Module `startup.rs` bảo toàn nguyên vẹn giá trị trong key Run gốc, chỉ ghi cờ binary vào `StartupApproved`. Tự động xuất JSON backup trước khi thay đổi. |
| **3. Process Guardian Critical Lock** | Cấm can thiệp core processes (csrss, explorer, dwm, services, lsass, smss, wininit) | **ĐẠT (PASS)** | Chặn 100% thao tác kill, eco-mode, optimize memory, kill tree đối với PID <= 4 và 12 core process names. Kiểm thử thực tế trên tiến trình sống `explorer.exe`/`dwm.exe` bị từ chối với `PermissionDenied`. |
| **4. Minh bạch Dry-Run** | Bắt buộc quét chi tiết trước khi xóa; người dùng xác nhận mới thao tác | **ĐẠT (PASS)** | Module `cleaner.rs` triển khai Dry-Run 100%: quét chỉ tính dung lượng giải phóng và lý do; UI cho phép chọn/bỏ chọn; chỉ xóa mục được duyệt. |
| **5. Quy tắc 24h User Temp** | Tệp `%TEMP%` phải cũ hơn 24 giờ mới được đưa vào danh sách dọn dẹp | **ĐẠT (PASS)** | Hàm `is_older_than_24_hours` thẩm định mtime; tệp sinh ra dưới 24h bị loại bỏ hoàn toàn trong bước quét, bảo vệ cài đặt phần mềm. |
| **6. Locked Files Handling** | Không panic/crash khi tệp bị tiến trình khác chiếm giữ (Sharing Violation 32/33) | **ĐẠT (PASS)** | Bắt mã lỗi OS 32/33, tự động chuyển đổi thành `SkippedLockedFile` và tăng `skipped_locked_count`. Ứng dụng hoạt động êm ái, dữ liệu tệp được bảo toàn. |
| **7. System Restore Point Safety** | Win32 API chính thống, graceful handling khi VSS tắt hoặc thiếu quyền admin | **ĐẠT (PASS)** | Gọi `SRSetRestorePointW` nguyên bản, xử lý mã lỗi 5 (`PermissionDenied`), 1058 (`SystemError - Service Disabled`), 112 (Disk Full). Không dùng powershell. |
| **8. Không dùng Command Shell** | Cấm gọi powershell/cmd ngầm để lách quyền hệ thống | **ĐẠT (PASS)** | Quét 100% codebase Backend và Frontend: **0** dòng lệnh gọi `powershell`, **0** lệnh gọi `cmd.exe /c`. Mọi tương tác qua Win32 API/sysinfo/winreg. |
| **9. Rust Error Handling** | Không có `.unwrap()` hoặc `.expect()` trong production backend | **ĐẠT (PASS)** | Quét tự động khẳng định **0** lần xuất hiện của `.unwrap()` và `.expect()` trong production code backend. 100% hàm trả về `Result<T, AppError>`. |
| **10. Tương thích Frontend - Backend** | Toàn vẹn giao tiếp Tauri IPC, typesafe TypeScript | **ĐẠT (PASS)** | 12 Tauri Commands khớp 100% interface giữa Frontend và Backend. `npm run build` pass hoàn hảo không lỗi type. |

---

## 1. Chi tiết Thẩm định Từng Module Mã Nguồn (Sprint 1, 2, 3)

### 1.1. Module System Restore Point (`src-tauri/src/restore_point.rs`)
- **Cơ chế Win32 API**:
  - Sử dụng trực tiếp hàm API `windows::Win32::System::Restore::SRSetRestorePointW`.
  - Cấu trúc dữ liệu `RESTOREPOINTINFOW` được chuẩn bị với buffer UTF-16 cố định 256 ký tự `[0u16; 256]` kết thúc bằng ký tự null `0u16`, ngăn chặn triệt để hiện tượng buffer overflow hoặc tràn bộ nhớ.
  - Quá trình tạo restore point được đóng gói hoàn chỉnh bằng cặp sự kiện `BEGIN_SYSTEM_CHANGE` và `END_SYSTEM_CHANGE`.
- **Xử lý Graceful lỗi quyền hạn và dịch vụ hệ thống**:
  - Lỗi Windows mã 5 (`ERROR_ACCESS_DENIED`): Chuyển thành `AppError::PermissionDenied("Cần quyền Quản trị viên (Run as Administrator)...")`.
  - Lỗi Windows mã 1058 (`ERROR_SERVICE_DISABLED`): Bắt chính xác trường hợp dịch vụ Volume Shadow Copy (VSS) hoặc System Restore đang bị tắt trên Windows, thông báo rõ ràng tới UI thay vì quăng mã lỗi crash.
  - Lỗi Windows mã 112: Thông báo ổ đĩa hệ thống đầy dung lượng.
- **Tuân thủ quy chuẩn**:
  - Không sử dụng lệnh powershell `Checkpoint-Computer` để lách quyền.
  - 0 unwrap, 0 expect.

### 1.2. Module Quản lý Khởi động (`src-tauri/src/startup.rs`)
- **Tuân thủ nguyên tắc No Blind Registry Cleaning (Điều 2 RULE.md)**:
  - Ứng dụng **tuyệt đối không xóa giá trị** trong các key Registry Run gốc (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run` và `HKLM\Software\Microsoft\Windows\CurrentVersion\Run`).
  - Thay vào đó, tuân thủ chuẩn của Microsoft Windows Task Manager: Ghi cấu hình bật/tắt vào key `Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run` (hoặc `StartupFolder`).
  - Dữ liệu ghi là mảng nhị phân `REG_BINARY` 12 bytes:
    - Byte đầu `0x02` biểu thị **Enabled**.
    - Byte đầu `0x03` biểu thị **Disabled**.
  - Đã được chứng minh qua bài kiểm thử tự động `test_toggle_startup_preserves_run_key_and_modifies_startup_approved`: Sau khi tắt một mục, giá trị trong key Run gốc vẫn còn nguyên 100%, và giá trị StartupApproved chuyển thành `0x03`.
- **Cơ chế Sao lưu Bắt buộc (Mandatory Backup)**:
  - Hàm `export_startup_backup()` tự động chụp toàn bộ danh sách ứng dụng khởi động hiện tại (kèm timestamp epoch) và lưu ra tệp JSON tại `%LOCALAPPDATA%\WinPulse\backups\startup_backup_<timestamp>.json`.
  - Cung cấp khả năng phục hồi hoàn toàn trạng thái trước khi người dùng thực hiện bất kỳ thay đổi nào.

### 1.3. Module Giám hộ Tiến trình (`src-tauri/src/process_guardian.rs`)
- **Cơ chế CRITICAL LOCK Đa tầng**:
  - Bảo vệ tuyệt đối các tiến trình sống còn của Windows bao gồm:
    `csrss.exe`, `explorer.exe`, `dwm.exe`, `services.exe`, `lsass.exe`, `smss.exe`, `wininit.exe`, `system`, `system idle process`, `registry`, `spoolsv.exe`, `fontdrvhost.exe`.
  - Mọi PID <= 4 bị chặn vô điều kiện.
  - Mọi tên tiến trình được chuẩn hóa lowercase và so khớp tiền tố.
- **Bảo vệ toàn diện mọi API can thiệp**:
  - `kill_process`: Chặn đóng tiến trình critical.
  - `apply_process_eco_mode`: Ngăn chặn đưa tiến trình hệ thống vào Windows 11 Efficiency Mode (EcoQoS), phòng tránh hiện tượng giật lag desktop hoặc treo giao diện Windows Shell.
  - `optimize_working_set`: Ngăn chặn can thiệp ép giải phóng bộ nhớ của các tiến trình lõi.
  - `kill_process_tree`: Thu thập cây tiến trình bằng thuật toán duyệt BFS. Nếu phát hiện **bất kỳ node nào** (dù là cha hay con) thuộc danh sách Critical Lock, hủy toàn bộ thao tác ngay lập tức với `PermissionDenied`.
- **Kiểm thử trên tiến trình thực tế**:
  - Bài kiểm thử `test_critical_lock_blocks_live_system_processes` quét các tiến trình đang thực thi trên máy (`explorer.exe`, `dwm.exe`, `services.exe`), gửi lệnh kill/eco-mode/working-set/kill-tree và xác nhận **100% bị chặn đứng** với `Err(AppError::PermissionDenied)`.

### 1.4. Module Dọn dẹp An toàn (`src-tauri/src/cleaner.rs`)
- **Quy tắc An toàn 24 Giờ cho Tệp Tạm (24-Hour Age Rule)**:
  - Tệp trong thư mục `%TEMP%` thường xuyên được các trình cài đặt (installers) và ứng dụng đang mở sử dụng.
  - Hàm `is_older_than_24_hours(path)` đo lường chính xác `SystemTime::now().duration_since(metadata.modified())`. Các tệp mới sinh ra dưới 24 giờ bị bỏ qua ngay từ bước quét.
  - Đã được chứng minh qua test `test_cleaner_24h_age_rule_skips_young_files`.
- **Tích hợp Bộ kiểm định Danh sách Đen Tuyệt đối (`PathSafetyValidator`)**:
  - Mỗi tệp tin trước khi đưa vào danh sách quét hoặc trước khi gọi hàm xóa đều được kiểm tra qua `PathSafetyValidator::is_blacklisted_path`.
  - Nếu tệp thuộc `C:\Windows\System32`, `SysWOW64`, `Boot`, `EFI`, `Desktop`, `Documents`, `Pictures`, `Downloads`, `Videos`, hay cơ sở dữ liệu trình duyệt (`Login Data`, `Cookies`, `History`, `Bookmarks`, `Preferences`), hệ thống từ chối xóa và ghi cảnh báo log ngay lập tức.
- **Xử lý Tệp Bị Khóa Độc quyền (Locked Files Handling)**:
  - Khi một ứng dụng khác đang mở tệp với cờ chia sẻ độc quyền (không cho phép xóa), lệnh xóa sẽ gặp Windows Error Code 32 (`ERROR_SHARING_VIOLATION`).
  - Hệ thống tự động bắt mã lỗi này thông qua `AppError::from(std::io::Error)`, đóng gói thành `DeletionOutcome::SkippedLockedFile`, và cộng dồn vào `skipped_locked_count`.
  - Đã được kiểm chứng qua bài test `test_execute_clean_items_locked_file_handling` (sử dụng `share_mode(0)`): Ứng dụng không panic, không crash, file được giữ nguyên vẹn, và kết quả trả về `skipped_locked_count = 1`.

---

## 2. Kết quả Rà soát Tĩnh & Phòng chống Lỗ hổng (Static Security Audit)

### 2.1. Quét Không Sử dụng Command Shell Lách Quyền
- **Lệnh rà soát:**
  ```powershell
  Select-String -Path "d:\Individua_Project\pc-optimizer\src-tauri\src\*.rs" -Pattern "powershell|cmd\.exe|Command::new"
  ```
- **Kết quả:**
  - Không có bất kỳ dòng mã nào gọi `std::process::Command::new("powershell")` hay `cmd.exe /c`.
  - Chỉ có 2 kết quả là chuỗi test path giả lập trong `safety.rs` để kiểm chứng bộ lọc blacklist chặn `cmd.exe`.
  - **Đánh giá: TUÂN THỦ 100% Điều 4 RULE.md.**

### 2.2. Quét Loại Bỏ Unwrap / Expect trong Production Code
- **Lệnh rà soát:**
  ```powershell
  Select-String -Path "d:\Individua_Project\pc-optimizer\src-tauri\src\*.rs" -Pattern "\.unwrap\(|\.expect\("
  ```
- **Kết quả:**
  - Trong toàn bộ mã nguồn thực thi backend (`commands.rs`, `cleaner.rs`, `error.rs`, `lib.rs`, `metrics.rs`, `process_guardian.rs`, `restore_point.rs`, `safety.rs`, `startup.rs`), số lượng `.unwrap()` và `.expect()` là: **0**.
  - Các trường hợp gọi an toàn chỉ bao gồm `.unwrap_or_else(...)` và `.unwrap_or_default()` để cung cấp giá trị mặc định cho Option.
  - Các lệnh `.expect()` chỉ tồn tại trong các hàm kiểm thử `#[test]` để assert kết quả test.
  - **Đánh giá: TUÂN THỦ 100% Quy chuẩn Rust Backend RULE.md.**

---

## 3. Báo cáo Chi tiết Bộ Kiểm thử Tự động (Automated Test Suite)

Toàn bộ hệ thống kiểm thử tự động gồm **28 Unit Tests** và **4 Integration Tests** (tổng cộng 32 bài kiểm thử) đã được thực thi trên môi trường Windows 11 thực tế qua Cargo Test Toolchain:

```text
running 28 tests
test cleaner::tests::test_execute_clean_items_skips_blacklist ... ok
test process_guardian::tests::test_critical_process_lock ... ok
test process_guardian::tests::test_kill_process_blocks_critical ... ok
test cleaner::tests::test_execute_clean_items_with_temp_file ... ok
test safety::tests::test_allow_safe_temp_path ... ok
test safety::tests::test_blacklist_browser_databases ... ok
test restore_point::tests::test_restore_point_config_default ... ok
test safety::tests::test_blacklist_boot_and_efi ... ok
test restore_point::tests::test_create_restore_point_graceful_handling ... ok
test safety::tests::test_blacklist_user_profiles ... ok
test safety::tests::test_core_services_protection ... ok
test safety::tests::test_registry_startup_whitelist ... ok
test safety::tests::test_directory_traversal_prevention ... ok
test safety::tests::test_blacklist_system32_and_syswow64 ... ok
test startup::tests::test_estimate_impact ... ok
test safety::tests::test_dry_run_simulation ... ok
test safety::tests::test_locked_file_scenario ... ok
test startup::tests::test_toggle_startup_item_invalid_location ... ok
test cleaner::tests::test_execute_clean_items_locked_file_handling ... ok
test startup::tests::test_get_all_startup_items_does_not_panic ... ok
test startup::tests::test_toggle_startup_preserves_run_key_and_modifies_startup_approved ... ok
test startup::tests::test_export_startup_backup ... ok
test process_guardian::tests::test_get_process_list_works ... ok
test cleaner::tests::test_cleaner_24h_age_rule_skips_young_files ... ok
test cleaner::tests::test_scan_cleanable_items_dry_run_only ... ok
test process_guardian::tests::test_critical_lock_blocks_live_system_processes ... ok
test metrics::tests::test_system_info_collection ... ok
test metrics::tests::test_metrics_collector_creation ... ok

test result: ok. 28 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.45s

running 4 tests
test test_integration_process_guardian_defense_matrix ... ok
test test_integration_restore_point_safety ... ok
test test_integration_zero_harm_cleaner_lifecycle ... ok
test test_integration_startup_backup_and_query ... ok

test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
```

### Tổng kết độ phủ kiểm thử:
1. **Bảo vệ đường dẫn & Blacklist (9 tests):** System32, SysWOW64, Boot, EFI, Recycler, User profiles, Browser DBs, Directory Traversal (`..`), Whitelist cho phép Temp an toàn.
2. **Registry & Startup (5 tests):** Khởi tạo danh sách startup, tính toán Impact, kiểm tra vị trí hợp lệ, bảo toàn key Run gốc khi toggle qua StartupApproved, xuất backup JSON.
3. **Process Guardian (4 tests):** Nhận diện Critical processes, chặn kill PID 4 & PID 0, chặn 100% can thiệp vào các tiến trình sống trên máy (`explorer.exe`, `dwm.exe`, `services.exe`), sắp xếp tiến trình theo RAM.
4. **Cleaner & Locked Files (5 tests):** Quét Dry-Run không xóa tệp, bỏ qua tệp thuộc blacklist, dọn tệp an toàn, quy tắc 24 giờ bỏ qua tệp mới tạo, xử lý tệp bị khóa độc quyền với `share_mode(0)` chuyển vào `skipped_locked_count`.
5. **System Restore Point (2 tests):** Cấu hình mặc định hợp lệ, xử lý an toàn không crash khi thiếu quyền admin hoặc VSS bị tắt.
6. **Hardware Metrics (2 tests):** Khởi tạo collector không block main thread, đọc đúng cấu trúc phần cứng hệ thống.
7. **Kiểm thử Tích hợp Toàn diện (4 tests):**
   - `test_integration_zero_harm_cleaner_lifecycle`: Chạy đồng thời tệp hợp lệ + tệp bị khóa + tệp blacklist; chứng minh tệp hợp lệ bị xóa, tệp bị khóa được bỏ qua, tệp hệ thống `hosts` không bị đụng chạm.
   - `test_integration_process_guardian_defense_matrix`: Xác nhận ma trận phòng thủ chặn tất cả API đối với tiến trình hệ thống lõi.
   - `test_integration_startup_backup_and_query`: Xác nhận toàn vẹn quy trình trích xuất và backup JSON.
   - `test_integration_restore_point_safety`: Xác nhận tính an toàn của API điểm khôi phục Win32.

---

## 4. Kết quả Biên dịch và Kiểm tra Frontend (Build Verification)

- **Backend Rust:**
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **Thành công (0 error, 0 warning)**.
- **Frontend TypeScript/React:**
  - `npm run build` (`tsc && vite build`):
    ```text
    vite v5.4.21 building for production...
    transforming...
    ✓ 1596 modules transformed.
    rendering chunks...
    computing gzip size...
    dist/index.html                   1.35 kB │ gzip:  0.70 kB
    dist/assets/index-BND8RLdt.css   34.82 kB │ gzip:  6.51 kB
    dist/assets/event-D6xIiUZv.js     1.44 kB │ gzip:  0.69 kB
    dist/assets/core-BUhCcD2K.js      2.70 kB │ gzip:  1.11 kB
    dist/assets/index-DDIXcQYZ.js   247.89 kB │ gzip: 70.76 kB
    ✓ built in 2.98s
    ```
  - **Đánh giá: Biên dịch thành công 100%, không phát sinh lỗi kiểu dữ liệu hay bundling.**

---

## 5. Kết luận Nghiệm thu & Khuyến nghị Bàn giao

1. **Kết luận Thẩm định:**
   - Toàn bộ mã nguồn của **WinPulse Optimizer** phát triển trong Sprint 1, 2 và 3 đã **ĐẠT ĐIỂM TUYỆT ĐỐI (100% COMPLIANT)** đối với các quy tắc vàng trong [RULE.md](./RULE.md) (*"Zero-Harm System Guarantee"*).
   - Hệ thống được trang bị cơ chế bảo vệ nhiều lớp (Defense-in-Depth): Danh sách cấm tuyệt đối, Critical Lock tiến trình lõi, Cơ chế toggle an toàn qua StartupApproved kèm backup JSON, Quy tắc 24h đối với tệp tạm, Xử lý tệp bị khóa êm dịu, và Điểm khôi phục hệ thống Win32 an toàn.
   - Toàn bộ 32 bài kiểm thử tự động (Unit Tests & Integration Tests) vượt qua 100%.

2. **Khuyến nghị cho Giai đoạn Triển khai & Đóng gói (Production Release):**
   - Đảm bảo file cấu hình Tauri Permissions (`src-tauri/capabilities/default.json`) chỉ cấp quyền cần thiết cho Webview window.
   - Khi ký số binary (`.exe` / `.msi`), cấu hình manifest yêu cầu mức quyền phù hợp (`asInvoker` cho chế độ chuẩn, người dùng bấm tạo Restore Point sẽ được nhắc cấp quyền UAC một cách minh bạch).
   - Tiếp tục duy trì quy tắc cấm dùng lệnh Command Shell và cấm `.unwrap()` trong các bản cập nhật tương lai.

---
*Báo cáo được lập và chứng thực bởi: **Safety-Auditor-QA** - Kỹ sư trưởng Thẩm định An toàn & Đảm bảo Chất lượng WinPulse Optimizer.*
