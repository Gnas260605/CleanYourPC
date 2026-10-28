# 🧩 Đặc tả yêu cầu & Phân rã chức năng (SPECS.md)

Tài liệu này phân rã toàn bộ các tính năng của **WinPulse Optimizer** thành các module độc lập, kèm theo điều kiện tiên quyết, phân cấp quyền hạn (UAC) và **Ma trận An toàn (Safety Classification)**.

---

## 🛡️ Ma trận An toàn (Safety Classification)

Mỗi hành động trong WinPulse được gán một nhãn mức độ an toàn để bảo vệ người dùng:

| Cấp độ | Ký hiệu | Ý nghĩa | Hành vi ứng dụng |
| :--- | :---: | :--- | :--- |
| **SAFE** | 🟢 | Hoàn toàn vô hại, không ảnh hưởng đến bất kỳ ứng dụng hay dữ liệu nào. | Tự động chọn mặc định khi quét nhanh. |
| **CAUTION** | 🟡 | Giải phóng tài nguyên tốt nhưng có thể yêu cầu người dùng đăng nhập lại hoặc mất lịch sử tạm. | Không chọn mặc định; bắt buộc hiển thị giải thích và cần người dùng tích chọn. |
| **DANGER / SYSTEM** | 🔴 | Can thiệp sâu vào dịch vụ hệ thống hoặc cấu hình Windows. | Cảnh báo đỏ, yêu cầu xác nhận UAC Administrator, bắt buộc tự động tạo Điểm khôi phục (Restore Point). |

---

## 📦 Phân rã chi tiết từng Module

### Module 1: Quản lý khởi động (Startup & Autostart Manager)

*Mục đích:* Giảm triệt để thời gian khởi động máy tính bằng cách loại bỏ các ứng dụng tự khởi động ngầm không cần thiết.

#### Chức năng chi tiết:
1. **Quét đa nguồn (Multi-Source Scanning)**:
   - Registry User: `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` và `RunOnce`.
   - Registry Machine: `HKLM\Software\Microsoft\Windows\CurrentVersion\Run` và `RunOnce` *(Cần quyền Admin)*.
   - Thư mục Startup: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup` và `C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Startup`.
   - Windows Task Scheduler: Các tác vụ kích hoạt khi đăng nhập (`At log on` hoặc `At startup`).
   - UWP/AppX Startup: Ứng dụng từ Microsoft Store có quyền chạy khi khởi động.
2. **Đánh giá tác động khởi động (Startup Impact Score)**:
   - Phân tích thời gian CPU tiêu tốn lúc boot (High / Medium / Low / None) dựa trên dữ liệu Windows Startup Tracking.
3. **Cơ chế Vô hiệu hóa an toàn (Safe Toggle - Không xóa vĩnh viễn)**:
   - Tuyệt đối không xóa thẳng tay bản ghi.
   - Sử dụng cơ chế `StartupApproved` chuẩn của Windows (chuyển byte cờ để Windows bỏ qua lúc nạp, cho phép bật lại bất kỳ lúc nào chỉ bằng 1 nút gạt).
4. **Phát hiện ứng dụng khởi động ẩn danh (Unknown / Suspicious autostarts)**:
   - Cảnh báo các file `.exe` chạy từ thư mục lạ như `AppData\Local\Temp`.

---

### Module 2: Giám sát & Tối ưu tiến trình (Process & Memory Guardian)

*Mục đích:* Ngăn chặn các tiến trình nền rò rỉ RAM hoặc chiếm dụng CPU vô lý, đảm bảo ứng dụng đang dùng được ưu tiên tối đa.

#### Chức năng chi tiết:
1. **Phân loại tiến trình thông minh**:
   - Nhóm ứng dụng đang tương tác (Foreground / Active Window).
   - Nhóm ứng dụng nền (Background Apps: Chrome tabs phụ, Discord thu nhỏ, Steam, trình cập nhật).
   - Nhóm tiến trình hệ thống cốt lõi (Windows Core: `csrss.exe`, `explorer.exe`, `lsass.exe`, `services.exe` -> **Khóa bảo vệ, cấm can thiệp**).
2. **Áp dụng Windows 11 Efficiency Mode (EcoQoS)**:
   - Sử dụng API `SetProcessInformation(hProcess, ProcessPowerThrottling, ...)` để hạ quyền ưu tiên CPU của các app nền mà **không làm crash app**.
   - Giúp giảm nhiệt độ CPU và kéo dài thời lượng pin đối với laptop.
3. **Tối ưu bộ nhớ thông minh (Smart Memory Hygiene)**:
   - **Nói KHÔNG với việc ép dọn RAM liên tục** (gây hiện tượng Disk Thrashing).
   - Chỉ kích hoạt thu hẹp Working Set (`SetProcessWorkingSetSize`) khi:
     - Tổng lượng RAM hệ thống vượt ngưỡng cảnh báo (> 85%).
     - Tiến trình đích đã chạy ngầm và không có tương tác người dùng trong hơn 30 phút.
4. **Kill-Tree An toàn**:
   - Cho phép buộc dừng một nhóm tiến trình nặng (ví dụ: tắt toàn bộ cây tiến trình của một ứng dụng bị đơ mà không để lại tiến trình zombie).

---

### Module 3: Dọn dẹp ổ đĩa an toàn (Smart & Safe Disk Cleaner)

*Mục đích:* Giải phóng hàng chục GB dung lượng ổ cứng bị chiếm dụng bởi tệp tạm, bộ nhớ đệm và nhật ký lỗi mà không làm hỏng dữ liệu người dùng.

#### Danh mục mục tiêu dọn dẹp & Phân cấp an toàn:

| Mục tiêu dọn dẹp | Đường dẫn / Đối tượng | Cấp độ | Cần Admin? | Ghi chú |
| :--- | :--- | :---: | :---: | :--- |
| **User Temp Files** | `%TEMP%\*` (Tệp cũ hơn 24 giờ) | 🟢 SAFE | Không | Bỏ qua các tệp đang bị khóa (Locked files). |
| **Crash Dumps** | `%LOCALAPPDATA%\CrashDumps` | 🟢 SAFE | Không | Báo cáo lỗi của các phần mềm đã đóng. |
| **Thumbnail Cache** | `%LOCALAPPDATA%\Microsoft\Windows\Explorer\thumbcache_*.db` | 🟡 CAUTION | Không | Làm mới thumbnail, có thể làm icon load lại hơi chậm 1 lần. |
| **Browser Caches** | Chrome/Edge/Brave/Firefox Cache | 🟢 SAFE | Không | Chỉ xóa cache hình ảnh/video, **giữ nguyên Cookies & Mật khẩu**. |
| **Recycle Bin** | Thùng rác người dùng | 🟡 CAUTION | Không | Yêu cầu người dùng xác nhận trước khi làm rỗng. |
| **Windows System Temp** | `C:\Windows\Temp\*` | 🟢 SAFE | Có | Tệp tạm cấp độ hệ thống. |
| **Windows Update Cleanup** | `SoftwareDistribution\Download` | 🟡 CAUTION | Có | Các gói cập nhật đã cài xong, an toàn để dọn. |
| **Windows Delivery Optimization**| Cache tải phân tán cập nhật P2P | 🟢 SAFE | Có | Giải phóng từ 1GB - 10GB. |
| **Minidump / Memory Dumps** | `C:\Windows\Minidump`, `MEMORY.DMP` | 🟡 CAUTION | Có | Dữ liệu ghi nhớ sau lỗi màn hình xanh (BSOD). |
| **Registry Cleaner** | Toàn bộ Windows Registry | 🔴 **LOẠI BỎ** | - | **WinPulse KHÔNG dọn Registry** (Xem phân tích thực tế). |

---

### Module 4: Tối ưu hóa dịch vụ Windows (Windows Services & Telemetry)

*Mục đích:* Tắt các dịch vụ ngầm vô ích, dịch vụ theo dõi thu thập dữ liệu (Telemetry), và các dịch vụ cập nhật dư thừa của bên thứ ba.

#### Phân nhóm dịch vụ:
1. **Dịch vụ Update của phần mềm bên thứ 3** *(🟢 SAFE)*:
   - Các dịch vụ như `GoogleChromeElevationService`, `BraveElevationService`, `FoxitUpdateService`, `AdobeUpdateService`.
   - Có thể chuyển sang chế độ khởi động `Manual` (Thủ công) thay vì `Automatic` để khi mở app mới kiểm tra cập nhật.
2. **Dịch vụ chẩn đoán & Telemetry của Microsoft** *(🟡 CAUTION)*:
   - `Connected User Experiences and Telemetry` (`DiagTrack`).
   - `dmwappushservice` (Dịch vụ định tuyến tin nhắn WAP).
   - Tắt dịch vụ này giúp giảm ghi đĩa ngầm mà không ảnh hưởng đến tính năng của Windows.
3. **Dịch vụ hệ thống được bảo vệ (Protected System Services)** *(🔴 KHÓA CHẶT)*:
   - `Windows Audio`, `Plug and Play`, `RPC`, `Windows Defender`, `Network Connections`... -> Bị khóa hoàn toàn trên UI, người dùng không thể vô tình tắt được.

---

### Module 5: Bảng điều khiển giám sát phần cứng (Real-time Hardware Dashboard)

*Mục đích:* Cung cấp một trung tâm quan sát trực quan, hiện đại, giúp người dùng nắm bắt tình trạng máy tính trong nháy mắt.

#### Các chỉ số theo dõi:
1. **CPU**:
   - % Tải tổng thể và tải trên từng Core / Thread.
   - Xung nhịp hiện tại (Frequency GHz).
   - Top 5 tiến trình chiếm CPU cao nhất thời gian thực.
2. **RAM**:
   - % Bộ nhớ đang sử dụng.
   - Dung lượng thực tế (In Use / Available / Cached / Committed).
   - Biểu đồ biến thiên 60 giây gần nhất.
3. **Ổ đĩa (Storage)**:
   - Tốc độ đọc/ghi hiện tại (Read/Write MB/s).
   - Dung lượng còn trống của các phân vùng ổ đĩa (C:, D:...).
   - Cảnh báo ổ đĩa nếu dung lượng trống dưới 10% (nguy cơ nghẽn I/O).
4. **Mạng (Network)**:
   - Tốc độ tải xuống (Download) và tải lên (Upload) thời gian thực (Kbps/Mbps).
5. **Chỉ số sức khỏe hệ thống (System Health Score - 0 đến 100 điểm)**:
   - Thuật toán tính điểm dựa trên: % RAM nhàn rỗi, số lượng app khởi động cùng máy, dung lượng rác tích tụ và thời gian uptime của máy.

---

### Module 6: Chế độ tăng tốc thông minh (1-Click Boost & Profiles)

*Mục đích:* Người dùng phổ thông chỉ cần bấm 1 nút là máy tính đạt hiệu năng cao nhất cho công việc cụ thể.

1. **Quick Boost (Tăng tốc tức thì)**:
   - Dọn dẹp cache của các ứng dụng vừa đóng.
   - Thu gọn bộ nhớ của các app nền không hoạt động.
   - Tạm dừng các tác vụ tự động update ngầm.
2. **Game Mode Profile**:
   - Chuyển Power Plan của Windows sang **High Performance** / **Ultimate Performance**.
   - Bật Windows Game Bar Game Mode.
   - Tạm dừng dịch vụ Windows Update và Windows Search Indexer trong thời gian chơi game.
   - Tự động hoàn trả cấu hình ban đầu khi thoát game.
3. **Focus / Dev Mode Profile**:
   - Tắt thông báo phiền toái (Focus Assist).
   - Tối ưu I/O cho các tiến trình lập trình (IDE, Git, Docker, Terminal).
