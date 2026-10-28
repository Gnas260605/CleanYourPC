# 📜 Bộ quy tắc vàng phát triển dự án (RULE.md)

Tài liệu này định nghĩa các nguyên tắc phát triển **bắt buộc phải tuân thủ (Non-Negotiable Rules)** đối với mọi thành viên, module và agent khi tham gia xây dựng **WinPulse Optimizer**.

---

## 🛑 NGUYÊN TẮC BẤT KHẢ XÂM PHẠM: "ZERO-HARM SYSTEM GUARANTEE"

> **Phương châm cốt lõi:** Thà bỏ sót một tệp rác còn hơn làm hỏng một tệp của hệ thống hoặc làm gián đoạn công việc của người dùng.

### Điều 1: Danh sách Đen Tuyệt đối (Absolute Blacklist)
Nghiêm cấm mọi hành vi ghi, sửa, hoặc xóa đối với các thư mục và đối tượng sau:
- `C:\Windows\System32\*` (ngoại trừ đọc metadata).
- `C:\Windows\SysWOW64\*`.
- `C:\Boot\*`, `C:\EFI\*`, `$Recycle.Bin` (cấp root của hệ thống).
- Thư mục hồ sơ cá nhân thiết yếu: `Desktop`, `Documents`, `Pictures`, `Downloads`, `Videos`.
- Tệp nguồn cơ sở dữ liệu trình duyệt: `Login Data`, `Cookies`, `History`, `Bookmarks`, `Preferences`.
- Các dịch vụ cốt lõi: `AudioEndpointBuilder`, `Audiosrv`, `RpcSs`, `DcomLaunch`, `EventLog`, `PlugPlay`, `LanmanWorkstation`.

### Điều 2: Không can thiệp mù quáng vào Registry (No Blind Registry Cleaning)
- Nghiêm cấm tạo bất kỳ chức năng nào có mục đích "quét và xóa registry rác".
- Registry chỉ được can thiệp vào các đường dẫn khởi động đã biết trước:
  - `Software\Microsoft\Windows\CurrentVersion\Run`
  - `Software\Microsoft\Windows\CurrentVersion\RunOnce`
  - `Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved`
- Trước khi sửa đổi bất kỳ giá trị nào, **BẮT BUỘC** phải xuất (export) giá trị cũ ra file sao lưu cục bộ (`.reg` hoặc JSON backup).

### Điều 3: Nguyên tắc Dry-Run & Xác nhận minh bạch (Transparency First)
- Bất kỳ thao tác dọn dẹp nào cũng phải hỗ trợ chế độ **Dry-Run (Chạy thử nghiệm)** trước:
  1. Quét và trả về danh sách chi tiết (tên tệp, kích thước, lý do xem là rác).
  2. Người dùng xem danh sách, được quyền bỏ chọn từng mục.
  3. Chỉ xóa các mục đã được người dùng xác nhận.
- Tuyệt đối không xóa âm thầm trong nền mà không có sự đồng ý của người dùng.

### Điều 4: Không dùng Command Shell để lách quyền
- Tuyệt đối không gọi `std::process::Command::new("powershell")` hoặc `cmd.exe /c` để chạy các đoạn mã script hệ thống.
- Mọi tương tác hệ thống bắt buộc phải dùng **Windows API chính thống** thông qua crate `windows` hoặc các crate Rust chuyên dụng (`sysinfo`, `winreg`).

---

## 💻 QUY CHUẨN MÃ NGUỒN & KỸ THUẬT (Code & Engineering Standards)

### 1. Quy chuẩn Rust Backend
- **Xử lý lỗi (Error Handling)**: Không sử dụng `.unwrap()` hoặc `.expect()` trong mã nguồn production. Sử dụng `Result<T, AppError>` với `thiserror` hoặc `anyhow` để mọi lỗi đều có thông báo thân thiện tới UI.
- **Async & Threading**:
  - Không bao giờ block main thread của Tauri/Webview.
  - Các tác vụ quét ổ đĩa, đo lường metrics nặng phải chạy trên thread pool riêng thông qua `tokio::task::spawn_blocking`.
- **Tài nguyên**: Giám sát chặt chẽ việc cấp phát bộ nhớ. Crate backend khi nhàn rỗi không được vượt quá 20MB RAM.

### 2. Quy chuẩn Frontend UI / UX
- **Phong cách thẩm mỹ**:
  - Thiết kế theo phong cách hiện đại, tối giản, sang trọng (Glassmorphism, mờ nền backdrop-blur, màu sắc hài hòa, dark-mode first).
  - Không sử dụng font mặc định nhàm chán (ưu tiên các font hình học sắc sảo như *Plus Jakarta Sans*, *Outfit*, *Geist*).
- **Phản hồi người dùng**: Mọi hành động quét/dọn dẹp phải có hiệu ứng chuyển động mượt mà (smooth loading spinner, progress bar tính theo % thực tế, dung lượng cập nhật real-time).
- **Ngôn ngữ**: Giao diện hỗ trợ chuẩn i18n (Tiếng Việt và Tiếng Anh), dịch thuật ngữ hệ thống chuẩn xác, dễ hiểu với người dùng phổ thông.

---

## 🧪 QUY TRÌNH KIỂM THỬ AN TOÀN (Safety QA Checklist)

Mọi tính năng mới trước khi được merge vào nhánh chính phải vượt qua:
1. **Kiểm thử trên Máy ảo sạch (Clean VM Test)**: Chạy trên Windows 10 và 11 nguyên bản để xác nhận không gây lỗi màn hình xanh (BSOD) hay hỏng driver.
2. **Kiểm thử Tệp bị khóa (Locked File Test)**: Mở sẵn các file trong thư mục Temp bằng ứng dụng khác, chạy tính năng dọn dẹp xem app có bỏ qua nhẹ nhàng hay bị crash.
3. **Kiểm thử Quyền hạn (Privilege Boundary Test)**: Đảm bảo app vẫn hoạt động trơn tru ở quyền người dùng bình thường, chỉ yêu cầu UAC đúng lúc.
4. **Kiểm tra chữ ký & Quét mã độc**: Chạy qua Windows Defender cục bộ đảm bảo không có cảnh báo heurism.
