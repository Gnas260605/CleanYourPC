pub mod cleaner;
pub mod commands;
pub mod config;
pub mod error;
pub mod history;
pub mod http_server;
pub mod metrics;
pub mod process_guardian;
pub mod restore_point;
pub mod safety;
pub mod startup;
pub mod tray;

use metrics::MetricsState;
use tracing::{error, info};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

/// Khởi tạo hệ thống ghi log tập trung tracing
fn init_tracing() {
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,winpulse_optimizer=debug,tauri=info"));

    let fmt_layer = tracing_subscriber::fmt::layer()
        .with_target(true)
        .with_thread_ids(false)
        .with_file(false)
        .with_line_number(false);

    let _ = tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt_layer)
        .try_init();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 1. Khởi động logging
    init_tracing();
    info!("🚀 Khởi động WinPulse Optimizer v{} Backend...", env!("CARGO_PKG_VERSION"));

    // 2. Khởi tạo Metrics State
    let metrics_state = MetricsState::new();

    // 3. Xây dựng Tauri Application Context
    let builder = tauri::Builder::default()
        .manage(metrics_state.clone())
        .invoke_handler(tauri::generate_handler![
            // Hardware & Diagnostics (Sprint 1)
            commands::get_hardware_metrics,
            commands::get_system_info,
            commands::get_quick_health_status,
            // Startup Management (Sprint 2)
            commands::get_startup_items,
            commands::toggle_startup_item,
            commands::backup_startup_registry,
            // Process Guardian & Optimization (Sprint 3)
            commands::get_process_list,
            commands::apply_process_eco_mode,
            commands::kill_process_tree,
            commands::optimize_process_working_set,
            // Disk Cleaner (Sprint 3)
            commands::scan_cleanable_files,
            commands::clean_files,
            // System Restore Point (Sprint 2)
            commands::create_system_restore_point,
            // App Settings (Sprint 4)
            commands::get_app_settings,
            commands::save_app_settings,
            // Optimization History (Sprint 4)
            commands::get_optimization_history,
            commands::record_optimization_log,
            commands::clear_history,
            // System Tray & Quick Boost (Sprint 5)
            commands::trigger_quick_boost,
            // Window Controls (Custom TitleBar)
            commands::window_minimize,
            commands::window_maximize,
            commands::window_close,
            commands::window_is_maximized,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Kiểm tra cài đặt minimize_to_tray
                let settings = config::load_settings().unwrap_or_default();
                if settings.minimize_to_tray {
                    // Ngăn chặn đóng ứng dụng hoàn toàn, ẩn cửa sổ xuống System Tray
                    api.prevent_close();
                    if let Err(err) = window.hide() {
                        error!("Không thể ẩn cửa sổ xuống khay hệ thống: {:?}", err);
                    } else {
                        info!("Cửa sổ chính đã được thu nhỏ xuống khay hệ thống (System Tray).");
                    }
                }
            }
        })
        .setup(move |app| {
            info!("WinPulse Optimizer Setup: Khởi động các dịch vụ nền và khay hệ thống.");

            // Khởi tạo khay hệ thống (System Tray)
            if let Err(err) = tray::setup_system_tray(app) {
                error!("Lỗi cấu hình System Tray: {:?}", err);
            }

            // Đọc cấu hình chu kỳ polling của người dùng
            let settings = config::load_settings().unwrap_or_default();
            let poll_interval = if settings.poll_interval_ms >= 500 {
                settings.poll_interval_ms
            } else {
                1500
            };

            // Bắt đầu background metrics emitter
            metrics_state.start_background_loop(app.handle().clone(), poll_interval);

            // Bắt đầu local HTTP API server cho trình duyệt (Chrome/Edge dev)
            http_server::start_http_server(metrics_state.clone(), 1421);

            Ok(())
        });

    // 4. Thực thi ứng dụng mà không dùng unwrap() hay expect()
    if let Err(err) = builder.run(tauri::generate_context!()) {
        error!("Lỗi nghiêm trọng khi khởi chạy WinPulse Optimizer: {:?}", err);
    }
}
