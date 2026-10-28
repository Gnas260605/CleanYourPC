use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::os::windows::fs::OpenOptionsExt;
use std::path::Path;
use std::time::Instant;

use app_lib::cleaner::execute_clean_paths;
use app_lib::config::{load_settings_from_path, save_settings_to_path, AppSettings};
use app_lib::error::AppError;
use app_lib::history::{
    clear_history_at_path, get_history_from_path, record_log_to_path, OptimizationLog,
};
use app_lib::metrics::MetricsCollector;
use app_lib::process_guardian::{
    apply_process_eco_mode, is_critical_process_name, kill_process, kill_process_tree,
    optimize_working_set,
};
use app_lib::restore_point::create_restore_point;
use app_lib::startup::{export_startup_backup, get_all_startup_items};

/// INTEGRATION TEST 1: Kiểm thử toàn diện "Zero-Harm System Guarantee" đối với File Cleaner
#[test]
fn test_integration_zero_harm_cleaner_lifecycle() {
    let temp_dir = env::temp_dir();

    // 1. Tạo 1 file bình thường có thể dọn
    let normal_file = temp_dir.join("winpulse_integration_normal.tmp");
    let mut f1 = File::create(&normal_file).expect("Create normal file failed");
    f1.write_all(b"Normal temporary file content")
        .expect("Write failed");
    drop(f1);

    // 2. Tạo 1 file bị khóa độc quyền (Locked file)
    let locked_file = temp_dir.join("winpulse_integration_locked.tmp");
    let mut f2 = File::create(&locked_file).expect("Create locked file failed");
    f2.write_all(b"Exclusive locked file content")
        .expect("Write failed");
    drop(f2);
    let lock_guard = OpenOptions::new()
        .read(true)
        .write(true)
        .share_mode(0)
        .open(&locked_file)
        .expect("Lock file open failed");

    // 3. Đường dẫn cấm thuộc Absolute Blacklist
    let blacklist_file = r"C:\Windows\System32\drivers\etc\hosts".to_string();

    let items_to_clean = vec![
        normal_file.clone(),
        locked_file.clone(),
        std::path::PathBuf::from(blacklist_file),
    ];

    // 4. Thực thi dọn dẹp 3 tệp tin cùng lúc (allow-root: %TEMP%)
    // Không panic, không trả về Err tổng thể: kết quả luôn là thống kê từng tệp
    let clean_res = execute_clean_paths(&items_to_clean, std::slice::from_ref(&temp_dir));
    // Normal file: thành công (1)
    assert_eq!(clean_res.success_count, 1);
    // Locked file: bỏ qua an toàn (1)
    assert_eq!(clean_res.skipped_locked_count, 1);
    // Blacklist file: chặn triệt để (1)
    assert_eq!(clean_res.failed_count, 1);

    // Xác nhận trạng thái tệp:
    // File bình thường đã bị xóa
    assert!(!normal_file.exists());
    // File bị khóa vẫn nguyên vẹn
    assert!(locked_file.exists());
    // File hệ thống hosts tuyệt đối không bị đụng chạm
    assert!(Path::new(r"C:\Windows\System32\drivers\etc\hosts").exists());

    // Dọn dẹp tệp locked sau khi giải phóng
    drop(lock_guard);
    let _ = fs::remove_file(locked_file);
}

/// INTEGRATION TEST 2: Kiểm thử tính toàn vẹn của Process Guardian CRITICAL LOCK
#[test]
fn test_integration_process_guardian_defense_matrix() {
    let forbidden_names = [
        "csrss.exe",
        "explorer.exe",
        "dwm.exe",
        "services.exe",
        "lsass.exe",
        "smss.exe",
        "wininit.exe",
    ];

    for name in forbidden_names {
        assert!(
            is_critical_process_name(name),
            "Tên tiến trình '{}' bắt buộc phải thuộc Critical Lock!",
            name
        );
    }

    // PID 4 (System) và PID 0 (Idle) luôn được bảo vệ ở mọi API
    let system_pids = [0u32, 4u32];
    for &pid in &system_pids {
        assert!(matches!(
            kill_process(pid),
            Err(AppError::PermissionDenied(_))
        ));
        assert!(matches!(
            apply_process_eco_mode(pid, true),
            Err(AppError::PermissionDenied(_))
        ));
        assert!(matches!(
            optimize_working_set(pid),
            Err(AppError::PermissionDenied(_))
        ));
        assert!(matches!(
            kill_process_tree(pid),
            Err(AppError::PermissionDenied(_))
        ));
    }
}

/// INTEGRATION TEST 3: Kiểm thử toàn vẹn của Startup Registry và JSON Backup
#[test]
fn test_integration_startup_backup_and_query() {
    // 1. Quét danh sách startup
    let items_res = get_all_startup_items();
    assert!(items_res.is_ok());
    let _items = items_res.unwrap();

    // 2. Xuất bản sao lưu JSON
    let backup_path_res = export_startup_backup();
    assert!(backup_path_res.is_ok());
    let backup_path = backup_path_res.unwrap();
    let path = Path::new(&backup_path);
    assert!(path.exists(), "Tệp sao lưu JSON phải tồn tại");

    let content = fs::read_to_string(path).expect("Read backup file failed");
    assert!(content.contains("timestamp"));
    assert!(content.contains("items"));

    // 3. Dọn dẹp tệp sao lưu test
    let _ = fs::remove_file(path);
}

/// INTEGRATION TEST 4: Thẩm định System Restore Point Win32 API
#[test]
fn test_integration_restore_point_safety() {
    // Gọi hàm tạo restore point: đảm bảo trả về Ok(true) hoặc Err(PermissionDenied/SystemError)
    // TUYỆT ĐỐI KHÔNG PANIC, KHÔNG CRASH, KHÔNG DÙNG POWERSHELL
    let result = create_restore_point("WinPulse QA Integration Test Check");
    match result {
        Ok(success) => assert!(success),
        Err(AppError::PermissionDenied(_)) => (),
        Err(AppError::SystemError(_)) => (),
        Err(other) => panic!("Loại lỗi không mong muốn: {:?}", other),
    }
}

/// INTEGRATION TEST 5: Quản lý cấu hình Settings Persistence và khả năng phục hồi dữ liệu lỗi
#[test]
fn test_integration_settings_persistence() {
    let temp_dir = env::temp_dir().join("winpulse_integration_settings");
    let _ = fs::remove_dir_all(&temp_dir);
    let settings_file = temp_dir.join("config").join("settings.json");

    // 1. Tệp chưa tồn tại -> Mặc định
    let initial = load_settings_from_path(&settings_file).unwrap_or_default();
    assert_eq!(initial.poll_interval_ms, 1500);
    assert!(initial.minimize_to_tray);

    // 2. Lưu cấu hình mới
    let modified = AppSettings {
        auto_start_on_boot: false,
        minimize_to_tray: true,
        poll_interval_ms: 3000,
        visual_effects: false,
    };
    let save_res = save_settings_to_path(&modified, &settings_file, false);
    assert!(save_res.is_ok());

    // 3. Đọc lại và kiểm chứng
    let loaded = load_settings_from_path(&settings_file).unwrap_or_default();
    assert_eq!(loaded, modified);

    // 4. Kiểm thử phục hồi khi tệp bị hỏng nội dung (Corrupted JSON)
    let _ = fs::write(&settings_file, "{ corrupted_json_syntax: true, ");
    let recovered = load_settings_from_path(&settings_file).unwrap_or_default();
    assert_eq!(recovered, AppSettings::default());

    // Dọn dẹp
    let _ = fs::remove_dir_all(&temp_dir);
}

/// INTEGRATION TEST 6: Vòng đời Lịch sử Tối ưu (Audit History Aggregation)
#[test]
fn test_integration_history_audit_and_aggregation() {
    let temp_dir = env::temp_dir().join("winpulse_integration_history");
    let _ = fs::remove_dir_all(&temp_dir);
    let history_file = temp_dir.join("data").join("history.json");

    // 1. Kiểm tra ban đầu
    let init_summary = get_history_from_path(&history_file).unwrap_or_default();
    assert_eq!(init_summary.total_sessions, 0);
    assert_eq!(init_summary.total_freed_bytes, 0);

    // 2. Ghi nhận 3 phiên tối ưu liên tiếp
    let log1 = OptimizationLog::new("Safe Cleaner", 100 * 1024 * 1024, 15, 1, "Dọn dẹp Temp");
    let log2 = OptimizationLog::new("Quick Boost", 50 * 1024 * 1024, 8, 0, "Tối ưu RAM");
    let log3 = OptimizationLog::new("Process Eco-Mode", 0, 3, 0, "Kích hoạt EcoQoS");

    let s1 = record_log_to_path(log1, &history_file).unwrap_or_default();
    assert_eq!(s1.total_sessions, 1);
    assert_eq!(s1.total_freed_bytes, 100 * 1024 * 1024);

    let s2 = record_log_to_path(log2, &history_file).unwrap_or_default();
    assert_eq!(s2.total_sessions, 2);
    assert_eq!(s2.total_freed_bytes, 150 * 1024 * 1024);

    let s3 = record_log_to_path(log3, &history_file).unwrap_or_default();
    assert_eq!(s3.total_sessions, 3);
    assert_eq!(s3.total_freed_bytes, 150 * 1024 * 1024);
    assert_eq!(s3.logs.len(), 3);
    // Log mới nhất phải ở đầu danh sách
    assert_eq!(s3.logs[0].action_type, "Process Eco-Mode");

    // 3. Xóa sạch lịch sử
    let clear_res = clear_history_at_path(&history_file);
    assert!(clear_res.is_ok());

    let final_summary = get_history_from_path(&history_file).unwrap_or_default();
    assert_eq!(final_summary.total_sessions, 0);
    assert_eq!(final_summary.total_freed_bytes, 0);
    assert!(final_summary.logs.is_empty());

    // Dọn dẹp
    let _ = fs::remove_dir_all(&temp_dir);
}

/// Hỗ trợ đo lường RAM thực tế của tiến trình hiện tại qua Win32 API
#[cfg(windows)]
fn get_current_process_memory() -> (usize, usize) {
    use windows::Win32::System::Threading::GetCurrentProcess;
    use windows::Win32::System::ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
    use std::mem::size_of;

    unsafe {
        let mut pmc = PROCESS_MEMORY_COUNTERS::default();
        let handle = GetCurrentProcess();
        if K32GetProcessMemoryInfo(
            handle,
            &mut pmc,
            size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
        )
        .as_bool()
        {
            (pmc.WorkingSetSize, pmc.PagefileUsage)
        } else {
            (0, 0)
        }
    }
}

/// INTEGRATION TEST 7: Đo đạc hiệu năng (Benchmarking) mức tiêu thụ tài nguyên và độ trễ
#[test]
fn test_integration_metrics_benchmarking_and_resource_usage() {
    let mut collector = MetricsCollector::new();

    // 1. Thực hiện 20 chu kỳ đo đạc liên tiếp
    let start_time = Instant::now();
    let iterations = 20;
    for _ in 0..iterations {
        let metrics = collector.collect();
        assert!(metrics.is_ok(), "Collect metrics không được trả về lỗi");
    }
    let total_duration = start_time.elapsed();
    let avg_latency_ms = total_duration.as_secs_f64() * 1000.0 / (iterations as f64);

    println!(
        "\n[BENCHMARK] {} chu kỳ đo đạc hoàn thành trong {:?}. Độ trễ trung bình: {:.2}ms/tick",
        iterations, total_duration, avg_latency_ms
    );

    // Độ trễ trung bình mỗi chu kỳ phải dưới 100ms
    assert!(
        avg_latency_ms < 100.0,
        "Độ trễ thu thập metrics quá cao: {:.2}ms (tiêu chuẩn < 100ms)",
        avg_latency_ms
    );

    // 2. Đo lường Working Set RAM thực tế qua Win32 API
    #[cfg(windows)]
    {
        let (working_set, pagefile) = get_current_process_memory();
        let ws_mb = working_set as f64 / (1024.0 * 1024.0);
        let pf_mb = pagefile as f64 / (1024.0 * 1024.0);
        println!(
            "[BENCHMARK] Tiến trình thử nghiệm - Working Set: {:.2} MB, Commit/Pagefile: {:.2} MB",
            ws_mb, pf_mb
        );
        // Tiêu chuẩn RULE.md: Backend nhàn rỗi không vượt quá 25MB RAM (ngưỡng 35MB khi chạy full test suite cùng các runner)
        assert!(
            ws_mb < 35.0,
            "Mức chiếm dụng RAM vượt ngưỡng cho phép: {:.2} MB",
            ws_mb
        );
    }
}

/// INTEGRATION TEST 8: Kiểm tra rò rỉ bộ nhớ (Memory Leak Check) trong vòng lặp Metrics Emitter
#[test]
fn test_integration_metrics_memory_leak_check() {
    let mut collector = MetricsCollector::new();

    // Warm-up 10 chu kỳ để ổn định allocator
    for _ in 0..10 {
        let _ = collector.collect();
    }

    #[cfg(windows)]
    let (initial_ws, _) = get_current_process_memory();

    // Chạy 150 chu kỳ liên tục giả lập vòng lặp chạy nền trong thời gian dài
    for _ in 0..150 {
        let res = collector.collect();
        assert!(res.is_ok());
    }

    #[cfg(windows)]
    {
        let (final_ws, _) = get_current_process_memory();
        let delta_bytes = (final_ws as i64) - (initial_ws as i64);
        let delta_mb = delta_bytes as f64 / (1024.0 * 1024.0);

        println!(
            "[MEMORY LEAK CHECK] 150 chu kỳ collect: Ban đầu: {:.2} MB -> Sau: {:.2} MB (Biến thiên: {:.2} MB)",
            initial_ws as f64 / (1024.0 * 1024.0),
            final_ws as f64 / (1024.0 * 1024.0),
            delta_mb
        );

        // Biến thiên sau 150 chu kỳ không được tăng lũy tiến đột biến (> 10MB)
        assert!(
            delta_mb < 10.0,
            "Phát hiện nguy cơ rò rỉ bộ nhớ! Tăng trưởng: {:.2} MB sau 150 chu kỳ",
            delta_mb
        );
    }
}


