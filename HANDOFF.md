# 🤝 Tài liệu bàn giao & Hướng dẫn bước tiếp theo (HANDOFF.md)

Tài liệu này tổng kết trạng thái hiện tại của dự án **WinPulse Optimizer**, danh mục các tài liệu đã hoàn thành, và lộ trình các bước kỹ thuật cần thực thi tiếp theo cho phiên làm việc tiếp theo.

---

## 📌 1. Trạng thái hiện tại của dự án (Current Status)

- [x] **Khảo sát & Phân tích hiện trạng**: Phân tích trực tiếp từ dữ liệu thực tế máy tính người dùng (CPU 91%, Disk 87%, tiến trình nền ngốn RAM/Disk như Antigravity IDE, Chrome, các updater).
- [x] **Xây dựng Tài liệu Kế hoạch (`PLAN.md`)**: Lộ trình 6 giai đoạn phát triển, chia sprint cụ thể và tiêu chí nghiệm thu (DoD).
- [x] **Thiết kế Kiến trúc Hệ thống (`ARCHITECTURE.md`)**: Lựa chọn Tauri v2 + Rust, mô hình bảo mật 2 tiến trình phân tách quyền hạn (Privilege Separation) qua Named Pipes IPC.
- [x] **Phân rã Chức năng & Ma trận An toàn (`SPECS.md`)**: Đặc tả 6 module nghiệp vụ (Startup, Process/RAM Guardian, Safe Cleaner, Services, Hardware Monitor, 1-Click Boost).
- [x] **Đánh giá Thực tế & Rủi ro (`REAL_WORLD_ANALYSIS.md`)**: Phân tích chi tiết tại sao KHÔNG dọn dẹp Registry, không ép xả RAM mù quáng, cách tránh Antivirus False-Positive và tối ưu cho Windows 11.
- [x] **Thiết lập Bộ quy tắc vàng (`RULE.md`)**: Cam kết "Zero-Harm System Guarantee", danh sách đen cấm chạm, quy chuẩn mã nguồn Rust/Frontend.
- [x] **Bộ nhớ Quyết định Kiến trúc (`MEMORY.md`)**: Lưu trữ 5 quyết định kiến trúc cốt lõi (ADR-001 đến ADR-005) và danh sách nợ kỹ thuật cần lưu ý.

---

## 🛠️ 2. Yêu cầu môi trường phát triển (Prerequisites)

Để bắt đầu bước lập trình mã nguồn ở phiên tiếp theo, máy tính cần cài sẵn các công cụ sau:

1. **Rust Toolchain**:
   - Cài đặt qua `rustup`: [https://rustup.rs](https://rustup.rs) (phiên bản Rust `1.78+`).
   - Kiểm tra trong terminal: `cargo --version` và `rustc --version`.
2. **Visual Studio C++ Build Tools**:
   - Cần cài đặt gói *"Desktop development with C++"* cùng với **Windows 10/11 SDK** để biên dịch mã nguồn Win32 API.
3. **Node.js & Package Manager**:
   - Node.js bản LTS (`v20.x` hoặc `v22.x`) kèm theo `npm` hoặc `pnpm`.
4. **Tauri CLI v2**:
   - Cài đặt toàn cục: `cargo install tauri-cli --version "^2.0.0"` hoặc dùng `npx @tauri-apps/cli`.

---

## 🚀 3. Kế hoạch hành động cho phiên tiếp theo (Next Action Steps)

Lập trình viên / Agent tiếp theo hãy thực hiện tuần tự các bước sau:

### Bước 1: Khởi tạo khung dự án Tauri v2 (Scaffolding)
Chạy lệnh khởi tạo ứng dụng trong thư mục `d:\Individua_Project\pc-optimizer`:
```bash
# Trong thư mục d:\Individua_Project\pc-optimizer
npx @tauri-apps/cli init
```
- Tên ứng dụng: `winpulse-optimizer`
- Window title: `WinPulse Optimizer`
- Frontend framework: `Vite + TypeScript + TailwindCSS` (hoặc `Svelte 5 / React`)

### Bước 2: Cấu hình dependencies cho Rust (`Cargo.toml`)
Thêm các thư viện cốt lõi vào `src-tauri/Cargo.toml`:
```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tokio = { version = "1", features = ["full"] }
sysinfo = "0.30"
winreg = "0.52"
tracing = "0.1"
tracing-subscriber = "0.3"

[target.'cfg(windows)'.dependencies]
windows = { version = "0.58", features = [
    "Win32_Foundation",
    "Win32_System_Threading",
    "Win32_System_ProcessStatus",
    "Win32_System_Services",
    "Win32_Storage_FileSystem",
    "Win32_System_Restore",
    "Win32_UI_Shell",
    "Win32_System_Registry",
    "Win32_System_Power"
] }
```

### Bước 3: Triển khai Module đo lường phần cứng (`metrics.rs`)
- Xây dựng background loop với `sysinfo` để lấy:
  - CPU % tổng thể và từng core.
  - RAM đang dùng và RAM khả dụng.
  - Disk read/write throughput (MB/s).
- Gửi dữ liệu lên UI thông qua Tauri Events (`tauri::Emitter::emit("hardware-metrics", payload)`).

### Bước 4: Triển khai Module Quét tệp rác an toàn (`cleaner.rs`)
- Quét các thư mục trong WhiteList cấp 🟢 SAFE:
  - `%TEMP%` (tệp cũ hơn 24 giờ).
  - `%LOCALAPPDATA%\CrashDumps`.
- Hỗ trợ hàm `scan_junk()` trả về danh sách tệp và dung lượng dự kiến mà không xóa.

### Bước 5: Thiết kế giao diện Dashboard thời gian thực
- Dựng UI trang chủ hiển thị:
  - Đồng hồ đo tốc độ CPU & RAM.
  - Nút bấm "Quét nhanh 1 chạm" (Quick Scan).
  - Bảng thống kê dung lượng rác đã tìm thấy.

---

## 📞 4. Ghi chú liên hệ & Duy trì dự án

- **Quy tắc quan trọng nhất**: Đọc kỹ [`RULE.md`](./RULE.md) trước khi viết bất kỳ hàm xóa tệp hay can thiệp tiến trình nào.
- Mọi thắc mắc về kiến trúc bảo mật: Tham khảo [`ARCHITECTURE.md`](./ARCHITECTURE.md).
- Toàn bộ lý do kỹ thuật đằng sau các quyết định: Tham khảo [`MEMORY.md`](./MEMORY.md).
