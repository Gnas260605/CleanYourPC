# 🧠 Bộ nhớ dự án & Quyết định kiến trúc (MEMORY.md)

Tài liệu này lưu trữ toàn bộ các quyết định kiến trúc cốt lõi (Architecture Decision Records - ADR), lý do lựa chọn kỹ thuật, các đánh đổi (trade-offs), và ngữ cảnh hệ thống của **WinPulse Optimizer**.

---

## 🏛️ Danh bạ Quyết định Kiến trúc (Architecture Decision Records - ADR)

### ADR-001: Lựa chọn Framework: Tauri v2 + Rust
- **Trạng thái**: Đã phê duyệt (Accepted).
- **Bối cảnh**: Cần xây dựng một ứng dụng tối ưu máy tính cho Windows. Một công cụ tối ưu máy tính mà bản thân nó lại ngốn 200MB RAM (như Electron) sẽ bị người dùng tẩy chay ngay lập tức.
- **Quyết định**: Sử dụng **Tauri v2** kết hợp **Rust** và **Webview2**:
  - Tận dụng runtime Webview2 đã có sẵn trên mọi máy Windows 10/11 hiện đại.
  - Sử dụng Rust cho core logic giúp quản lý bộ nhớ an toàn (Zero Cost Abstraction, No GC pauses).
- **Đánh đổi (Trade-off)**: Đòi hỏi lập trình viên phải có kiến thức về Rust và hệ sinh thái Win32 API thay vì chỉ viết JavaScript thuần. Tuy nhiên lợi ích về hiệu năng (RAM < 25MB, file cài đặt < 15MB) hoàn toàn vượt trội.

---

### ADR-002: Mô hình bảo mật 2 tiến trình (Dual-Process Privilege Separation)
- **Trạng thái**: Đã phê duyệt (Accepted).
- **Bối cảnh**: Một số tác vụ dọn dẹp cần quyền Administrator (như dọn `C:\Windows\Temp`, chỉnh sửa `HKLM`, quản lý Windows Services). Nếu chạy cả app dưới quyền Admin thì mỗi lần mở máy/mở app đều hiện UAC, và vi phạm nguyên tắc bảo mật tối thiểu (Least Privilege).
- **Quyết định**:
  - Tiến trình chính (`winpulse-ui.exe`): Chạy ở **Medium Integrity Level** (quyền người dùng thông thường). Đảm nhiệm render UI, đo đạc metrics CPU/RAM, dọn dẹp thư mục cá nhân người dùng.
  - Tiến trình phụ (`winpulse-worker.exe`): Chỉ được gọi khi người dùng thực hiện tác vụ cần quyền quản trị, chạy ở **High Integrity Level** qua UAC. Giao tiếp với UI thông qua Windows Named Pipes có mã hóa token xác thực.
- **Lợi ích**: Bảo mật tối đa, người dùng trải nghiệm mượt mà, không bị popup UAC làm phiền khi chỉ mở app để xem thông số máy.

---

### ADR-003: Loại bỏ hoàn toàn tính năng dọn dẹp Registry
- **Trạng thái**: Đã phê duyệt (Accepted).
- **Bối cảnh**: Nhiều phần mềm cũ quảng cáo dọn registry để "tăng tốc 200%". Tuy nhiên thực tế trên Windows hiện đại, registry chỉ tốn vài chục MB RAM và được cache theo cấu trúc cây băm, việc xóa vài trăm key rác không đem lại bất kỳ cải thiện nào về tốc độ nhưng rủi ro làm hỏng Windows Update, ứng dụng văn phòng và driver là cực lớn.
- **Quyết định**: Tuyệt đối **KHÔNG** làm tính năng quét và xóa registry đại trà. Registry chỉ được tương tác ở các vị trí khởi động đã được kiểm định nghiêm ngặt (`Software\Microsoft\Windows\CurrentVersion\Run`).

---

### ADR-004: Tối ưu bộ nhớ bằng Windows 11 Efficiency Mode (EcoQoS) thay vì ép xả RAM
- **Trạng thái**: Đã phê duyệt (Accepted).
- **Bối cảnh**: Các thủ thuật ép xả RAM bằng cách gọi `EmptyWorkingSet()` liên tục khiến Windows đẩy bộ nhớ ra đĩa (`pagefile`), gây hiện tượng giật đơ (Disk Thrashing) khi người dùng mở lại app.
- **Quyết định**: 
  - Tận dụng API hiện đại của Windows 11: `SetProcessInformation(hProcess, ProcessPowerThrottling, ...)` với cờ `PROCESS_POWER_THROTTLING_EXECUTION_SPEED`.
  - Windows sẽ tự động hạ xung nhịp hoặc dời tiến trình nền sang các nhân tiết kiệm điện (E-cores), giúp hạ nhiệt CPU và giảm tải mà không làm đóng băng app.

---

### ADR-005: Cơ chế Vô hiệu hóa Khởi động an toàn (StartupApproved Flag)
- **Trạng thái**: Đã phê duyệt (Accepted).
- **Bối cảnh**: Khi tắt một ứng dụng khởi động cùng Windows, nếu xóa giá trị khỏi `HKCU\...\Run`, người dùng sẽ không thể khôi phục lại khi cần, và ứng dụng đó có thể tự ghi lại khóa mới khi người dùng mở nó.
- **Quyết định**:
  - Sử dụng cơ chế nhị phân `StartupApproved\Run` của chính Windows Task Manager. Khi tắt, WinPulse chỉ thay đổi cờ trạng thái sang `Disabled` thay vì xóa mất chuỗi lệnh.
  - Người dùng có thể bật lại (Enable) bất kỳ lúc nào chỉ bằng 1 nút gạt đơn giản.

---

## 💻 Ngữ cảnh môi trường phát triển & Hệ thống mục tiêu

- **Hệ điều hành mục tiêu**: Windows 10 (Build 19041+) và Windows 11 (21H2, 22H2, 23H2, 24H2+).
- **Kiến trúc CPU**: Hỗ trợ cả x86_64 (Intel / AMD) và ARM64 (Qualcomm Snapdragon X Elite).
- **Phụ thuộc Native bắt buộc**: Microsoft Edge WebView2 Evergreen Runtime (đã tích hợp sẵn 100% trên Windows 11 và Windows 10 bản mới).
- **Quy chuẩn mã hóa**: UTF-16 cho mọi chuỗi tương tác với Win32 API (`windows-rs::HSTRING`), chuyển đổi sang UTF-8 cho IPC JSON và UI.

---

## ⚠️ Danh sách theo dõi nợ kỹ thuật (Technical Debt Watchlist)

1. **Task Scheduler COM STA Threading**: Khi gọi giao diện COM `ITaskService` từ Rust đa luồng, bắt buộc phải khởi tạo `CoInitializeEx(None, COINIT_APARTMENTTHREADED)` trên một thread riêng biệt để tránh deadlock.
2. **Quyền truy cập thư mục Temp**: Một số file trong `C:\Windows\Temp` hoặc `%TEMP%` thuộc quyền sở hữu của tiến trình khác (`SYSTEM` hoặc service) có thể gây lỗi `Access Denied` ngay cả khi worker chạy quyền Admin. Cần xử lý bỏ qua nhẹ nhàng kèm ghi log debug.
3. **Chống phân tán log**: Hạn chế việc ghi log liên tục xuống ổ đĩa SSD khi đang đo lường metrics thời gian thực (chỉ lưu metrics trên RAM buffer vòng tròn - Ring Buffer dung lượng tối đa 5MB).
