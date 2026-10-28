# 🤝 Tài liệu bàn giao & Hướng dẫn bước tiếp theo (HANDOFF.md)

Tài liệu này tổng kết trạng thái hiện tại của dự án **WinPulse Optimizer**, danh mục các tài liệu đã hoàn thành, và lộ trình các bước kỹ thuật cần thực thi tiếp theo cho phiên làm việc tiếp theo.

---

## 📌 1. Trạng thái hiện tại của dự án (Current Status)

> Cập nhật 28/10/2026. Lộ trình nâng cấp đang thực hiện: [`UPGRADE_PLAN.md`](./UPGRADE_PLAN.md) (tick checkbox khi xong từng mục).

- [x] Ứng dụng Tauri v2 + React 18 chạy được với 5 tab: Tổng quan, Khởi động, Process Guardian, Dọn dẹp an toàn, Dịch vụ Windows.
- [x] Backend Rust (`src-tauri/src/`): `metrics`, `startup`, `process_guardian`, `cleaner` + `safety`, `services`, `restore_point`, `config`, `history`, `tray`.
- [x] CI GitHub Actions `windows-latest` (`.github/workflows/ci.yml`): `npm run build`, `cargo test`, `cargo clippy -D warnings`.
- [x] Bảo mật: HTTP server cổng 1421 chỉ chạy ở bản debug, chỉ GET; dọn dẹp chỉ theo phiên quét của backend; có CSP.
- [ ] **Kiến trúc 2 tiến trình (UI + worker nâng quyền qua UAC) CHƯA được triển khai.** App hiện chạy **1 tiến trình**; các thao tác cần quyền Admin (đổi dịch vụ, tạo Restore Point) sẽ báo lỗi rõ ràng khi app không chạy bằng quyền Administrator. Xem nợ kỹ thuật trong [`MEMORY.md`](./MEMORY.md).

### Cách kiểm tra
- Frontend: `npm ci && npm run build`.
- Backend (chỉ trên Windows): `cd src-tauri && cargo test && cargo clippy -- -D warnings`.
- Trên Linux/cloud: `cargo check --target x86_64-pc-windows-msvc` (chỉ type-check, không chạy test). Xem skill `.claude/skills/verify-change`.

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

## 🚀 3. Bước tiếp theo

Làm tiếp các mục chưa tick trong [`UPGRADE_PLAN.md`](./UPGRADE_PLAN.md) theo đúng thứ tự. Mọi thay đổi chạm tới xóa tệp / kill process / registry / dịch vụ phải chạy checklist `.claude/skills/zero-harm-review`.

---

## 📞 4. Ghi chú liên hệ & Duy trì dự án

- **Quy tắc quan trọng nhất**: Đọc kỹ [`RULE.md`](./RULE.md) trước khi viết bất kỳ hàm xóa tệp hay can thiệp tiến trình nào.
- Mọi thắc mắc về kiến trúc bảo mật: Tham khảo [`ARCHITECTURE.md`](./ARCHITECTURE.md).
- Toàn bộ lý do kỹ thuật đằng sau các quyết định: Tham khảo [`MEMORY.md`](./MEMORY.md).
