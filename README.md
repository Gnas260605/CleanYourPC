# ⚡ WinPulse Optimizer (PC Optimizer Project)

> **Modern, Safe, and Transparent Windows System Optimization Tool**  
> Xây dựng công cụ tối ưu hóa Windows thế hệ mới: Hiệu suất cao, an toàn tuyệt đối, minh bạch hoạt động và giao diện chuẩn hiện đại.

---

## 🎯 1. Tầm nhìn dự án (Project Vision)

Đa số các phần mềm dọn rác và tối ưu hệ thống hiện nay trên thị trường (như CCleaner cũ, CleanMaster, Advanced SystemCare) gặp phải các vấn đề nghiêm trọng:
1. **Quảng cáo & Bundled Malware/Bloatware**: Tự biến mình thành gánh nặng ngốn RAM/CPU hơn cả thứ nó dọn dẹp.
2. **"Tối ưu ảo" (Snake Oil)**: Lạm dụng hàm ép giải phóng RAM (`EmptyWorkingSet`), liên tục xóa cache có ích khiến CPU và Disk phải nạp lại từ đầu, làm máy chậm hơn.
3. **Phá hỏng Registry**: Quét và xóa các khóa registry không rõ ràng gây lỗi Windows Update hoặc crash ứng dụng.
4. **Thiếu minh bạch**: Người dùng không biết công cụ vừa xóa cái gì, vừa can thiệp vào tiến trình nào.

**WinPulse Optimizer sinh ra để giải quyết triệt để vấn đề này:**
- **Zero Bloat**: Tài nguyên chạy nền < 25MB RAM, 0% CPU khi rảnh rỗi.
- **An toàn tuyệt đối (Safety-First)**: Không can thiệp mù quáng, luôn có điểm phục hồi (Restore Point) và cơ chế Undo.
- **Dựa trên chuẩn Windows API hiện đại**: Sử dụng Windows Efficiency Mode (EcoQoS), Process Power Throttling API, Storage Sense API thay vì các thủ thuật lỗi thời.
- **Minh bạch 100%**: Liệt kê chi tiết từng tệp, tiến trình, dịch vụ trước khi thao tác.

---

## 📂 2. Cấu trúc tài liệu dự án

Toàn bộ tài liệu quy hoạch, kiến trúc và quy chuẩn được tổ chức trong thư mục này:

| File | Nội dung chính |
| :--- | :--- |
| **[`PLAN.md`](./PLAN.md)** | Kế hoạch triển khai chi tiết từng giai đoạn, lộ trình phát triển và milestone. |
| **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** | Phân tích kiến trúc hệ thống, mô hình bảo mật tách biệt đặc quyền (UAC Helper), IPC và sơ đồ khối. |
| **[`SPECS.md`](./SPECS.md)** | Phân rã chức năng (Functional Decomposition), danh mục tính năng và Ma trận An toàn (Safety Matrix). |
| **[`REAL_WORLD_ANALYSIS.md`](./REAL_WORLD_ANALYSIS.md)** | Đánh giá thực tế, giải mã các sai lầm/myth của app dọn dẹp cũ, xử lý Antivirus, Windows 11 API compatibility. |
| **[`RULE.md`](./RULE.md)** | Bộ quy tắc vàng khi phát triển (System Safety Rules, Coding Conventions, Review Criteria). |
| **[`HANDOFF.md`](./HANDOFF.md)** | Tài liệu bàn giao trạng thái, checklist việc cần làm tiếp theo và hướng dẫn bắt đầu. |
| **[`MEMORY.md`](./MEMORY.md)** | Bộ nhớ quyết định kiến trúc (ADR), các đánh đổi kỹ thuật (Trade-offs) và ngữ cảnh dự án. |

---

## 🛠️ 3. Tech Stack cốt lõi (Đề xuất tối ưu)

- **Core Engine & System Bindings**: **Rust** (`windows-rs`, `sysinfo`, `winreg`).
- **Application Shell**: **Tauri v2** (Cung cấp sự kết hợp hoàn hảo giữa hiệu năng của Rust và sự linh hoạt của Web UI, dung lượng cài đặt siêu nhẹ ~8MB, chiếm cực ít RAM so với Electron).
- **Frontend UI**: **TypeScript + Svelte 5 / React + TailwindCSS + Lucide Icons**.
- **Privilege Separation**: Kiến trúc 2 tiến trình (Standard UI Process + Elevated Worker via Named Pipes/IPC).
