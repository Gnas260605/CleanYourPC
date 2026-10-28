use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};
use tracing::{error, info};

use crate::history::{self, OptimizationLog};
use crate::process_guardian;

/// Thực hiện Quick Boost: tối ưu Working Set của tất cả các tiến trình người dùng an toàn
pub fn perform_quick_boost(app_handle: &AppHandle) -> Result<OptimizationLog, crate::error::AppError> {
    info!("🚀 Đang thực thi Quick Boost từ System Tray / Shortcut...");

    let processes = process_guardian::get_process_list().unwrap_or_default();
    let mut optimized_count = 0usize;
    let mut skipped_count = 0usize;
    let mut estimated_freed: u64 = 0;

    for proc in &processes {
        if proc.is_critical || proc.pid <= 4 {
            continue;
        }

        match process_guardian::optimize_working_set(proc.pid) {
            Ok(_) => {
                optimized_count += 1;
                // Ước tính giải phóng xấp xỉ 20-30% dung lượng memory của process
                estimated_freed += (proc.memory_bytes as f64 * 0.25) as u64;
            }
            Err(_) => {
                skipped_count += 1;
            }
        }
    }

    let details = format!(
        "Tối ưu Working Set cho {} tiến trình người dùng. Bỏ qua {} tiến trình đang bị khóa hoặc bận.",
        optimized_count, skipped_count
    );

    let log = OptimizationLog::new(
        "Quick Boost",
        estimated_freed,
        optimized_count,
        skipped_count,
        details,
    );

    // Ghi lại lịch sử tối ưu
    let _ = history::record_log(log.clone());

    // Phát sự kiện lên UI nếu có cửa sổ đang lắng nghe
    let _ = app_handle.emit("quick-boost-completed", &log);

    info!(
        "Hoàn tất Quick Boost: Tối ưu {} tiến trình, giải phóng xấp xỉ {} MB",
        optimized_count,
        estimated_freed / (1024 * 1024)
    );

    Ok(log)
}

/// Khởi tạo System Tray Icon và Tray Menu
pub fn setup_system_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle();

    // 1. Xây dựng Menu ngữ cảnh cho System Tray
    let open_item = MenuItemBuilder::with_id("open_window", "Mở WinPulse").build(app)?;
    let boost_item = MenuItemBuilder::with_id("quick_boost", "Tối ưu nhanh (Quick Boost)").build(app)?;
    let exit_item = MenuItemBuilder::with_id("exit_app", "Thoát (Exit)").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&open_item)
        .item(&boost_item)
        .separator()
        .item(&exit_item)
        .build()?;

    // 2. Tạo Tray Icon
    let mut tray_builder = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("WinPulse Optimizer - High Performance")
        .show_menu_on_left_click(false);

    // Gán icon mặc định của ứng dụng
    if let Some(icon) = app.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
    }

    // 3. Xử lý các sự kiện click menu
    let app_handle_menu = handle.clone();
    let tray_builder = tray_builder.on_menu_event(move |_tray, event| {
        match event.id().as_ref() {
            "open_window" => {
                if let Some(window) = app_handle_menu.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            "quick_boost" => {
                if let Err(err) = perform_quick_boost(&app_handle_menu) {
                    error!("Lỗi khi thực thi Quick Boost từ Tray: {:?}", err);
                }
            }
            "exit_app" => {
                info!("Thoát ứng dụng từ System Tray.");
                app_handle_menu.exit(0);
            }
            _ => {}
        }
    });

    // 4. Xử lý sự kiện click chuột vào tray icon (Click / Double click để mở cửa sổ)
    let app_handle_icon = handle.clone();
    let _tray_icon = tray_builder
        .on_tray_icon_event(move |_tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(window) = app_handle_icon.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    info!("System Tray đã được cấu hình và kích hoạt thành công.");
    Ok(())
}
