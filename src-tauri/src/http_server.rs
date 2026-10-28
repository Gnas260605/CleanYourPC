use std::net::SocketAddr;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tracing::{error, info};

use crate::cleaner;
use crate::history;
use crate::metrics::MetricsState;
use crate::process_guardian;
use crate::restore_point;
use crate::startup;

#[derive(Deserialize)]
struct EcoRequest {
    pid: u32,
    enable: bool,
}

#[derive(Deserialize)]
struct KillRequest {
    pid: u32,
}

#[derive(Deserialize)]
struct OptimizeRequest {
    pid: u32,
}

#[derive(Deserialize)]
struct ToggleStartupRequest {
    id: String,
    location: String,
    enable: bool,
}

#[derive(Deserialize)]
struct CleanRequest {
    paths: Vec<String>,
}

#[derive(Deserialize)]
struct RestorePointRequest {
    description: Option<String>,
}

fn cors_response(status: &str, content_type: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {}\r\n\
Content-Type: {}\r\n\
Access-Control-Allow-Origin: *\r\n\
Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
Access-Control-Allow-Headers: Content-Type, Authorization\r\n\
Connection: close\r\n\
Content-Length: {}\r\n\r\n{}",
        status,
        content_type,
        body.len(),
        body
    )
}

/// Khởi chạy Local HTTP Server trên cổng 1421 để phục vụ dữ liệu thật khi giao diện chạy trong trình duyệt (Chrome/Edge)
pub fn start_http_server(metrics_state: MetricsState, port: u16) {
    tauri::async_runtime::spawn(async move {
        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        let listener = match TcpListener::bind(addr).await {
            Ok(l) => {
                info!("🌐 Local Hardware API Server đang hoạt động tại http://127.0.0.1:{}", port);
                l
            }
            Err(e) => {
                error!("Không thể bind Local Hardware API Server trên cổng {}: {:?}", port, e);
                return;
            }
        };

        loop {
            let (mut socket, _) = match listener.accept().await {
                Ok(res) => res,
                Err(_) => continue,
            };

            let state = metrics_state.clone();
            tokio::spawn(async move {
                let mut buf = [0u8; 8192];
                let n = match socket.read(&mut buf).await {
                    Ok(n) if n > 0 => n,
                    _ => return,
                };

                let request = String::from_utf8_lossy(&buf[..n]);
                let first_line = request.lines().next().unwrap_or("");
                let body = if let Some(pos) = request.find("\r\n\r\n") {
                    &request[pos + 4..]
                } else {
                    ""
                };

                // CORS Preflight
                if first_line.starts_with("OPTIONS") {
                    let response = "HTTP/1.1 204 No Content\r\n\
Access-Control-Allow-Origin: *\r\n\
Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
Access-Control-Allow-Headers: Content-Type, Authorization\r\n\
Connection: close\r\n\
Content-Length: 0\r\n\r\n";
                    let _ = socket.write_all(response.as_bytes()).await;
                    return;
                }

                // 1. Hardware Metrics
                if first_line.starts_with("GET /api/metrics") {
                    if let Ok(metrics) = state.get_metrics().await {
                        if let Ok(json) = serde_json::to_string(&metrics) {
                            let _ = socket.write_all(cors_response("200 OK", "application/json", &json).as_bytes()).await;
                            return;
                        }
                    }
                } 
                // 2. System Specs
                else if first_line.starts_with("GET /api/system") {
                    if let Ok(sys) = state.get_system_info().await {
                        if let Ok(json) = serde_json::to_string(&sys) {
                            let _ = socket.write_all(cors_response("200 OK", "application/json", &json).as_bytes()).await;
                            return;
                        }
                    }
                } 
                // 3. Process List
                else if first_line.starts_with("GET /api/processes") {
                    let procs = process_guardian::get_process_list().unwrap_or_default();
                    if let Ok(json) = serde_json::to_string(&procs) {
                        let _ = socket.write_all(cors_response("200 OK", "application/json", &json).as_bytes()).await;
                        return;
                    }
                } 
                // 4. Eco Mode Toggle
                else if first_line.starts_with("POST /api/processes/eco") {
                    if let Ok(req) = serde_json::from_str::<EcoRequest>(body) {
                        let success = process_guardian::apply_process_eco_mode(req.pid, req.enable).unwrap_or(false);
                        let json = format!("{{\"success\": {}}}", success);
                        let _ = socket.write_all(cors_response("200 OK", "application/json", &json).as_bytes()).await;
                        return;
                    }
                } 
                // 5. Kill Process
                else if first_line.starts_with("POST /api/processes/kill") {
                    if let Ok(req) = serde_json::from_str::<KillRequest>(body) {
                        let success = process_guardian::kill_process_tree(req.pid).unwrap_or(false);
                        let json = format!("{{\"success\": {}}}", success);
                        let _ = socket.write_all(cors_response("200 OK", "application/json", &json).as_bytes()).await;
                        return;
                    }
                } 
                // 6. Optimize Working Set
                else if first_line.starts_with("POST /api/processes/optimize") {
                    if let Ok(req) = serde_json::from_str::<OptimizeRequest>(body) {
                        let success = process_guardian::optimize_working_set(req.pid).unwrap_or(false);
                        let json = format!("{{\"success\": {}}}", success);
                        let _ = socket.write_all(cors_response("200 OK", "application/json", &json).as_bytes()).await;
                        return;
                    }
                } 
                // 7. Startup Items
                else if first_line.starts_with("GET /api/startup") {
                    let items = startup::get_all_startup_items().unwrap_or_default();
                    if let Ok(json) = serde_json::to_string(&items) {
                        let _ = socket.write_all(cors_response("200 OK", "application/json", &json).as_bytes()).await;
                        return;
                    }
                } 
                // 8. Toggle Startup Item
                else if first_line.starts_with("POST /api/startup/toggle") {
                    if let Ok(req) = serde_json::from_str::<ToggleStartupRequest>(body) {
                        let success = startup::toggle_startup_item(&req.id, &req.location, req.enable).unwrap_or(false);
                        let json = format!("{{\"success\": {}}}", success);
                        let _ = socket.write_all(cors_response("200 OK", "application/json", &json).as_bytes()).await;
                        return;
                    }
                } 
                // 9. Backup Startup Registry
                else if first_line.starts_with("POST /api/startup/backup") {
                    if let Ok(path) = startup::export_startup_backup() {
                        let json = format!("{{\"backup_path\": \"{}\"}}", path.replace('\\', "\\\\"));
                        let _ = socket.write_all(cors_response("200 OK", "application/json", &json).as_bytes()).await;
                        return;
                    }
                } 
                // 10. Scan Cleanable Files (Dry-run)
                else if first_line.starts_with("GET /api/cleaner/scan") {
                    let items = cleaner::scan_cleanable_items().unwrap_or_default();
                    if let Ok(json) = serde_json::to_string(&items) {
                        let _ = socket.write_all(cors_response("200 OK", "application/json", &json).as_bytes()).await;
                        return;
                    }
                } 
                // 11. Clean Files
                else if first_line.starts_with("POST /api/cleaner/clean") {
                    if let Ok(req) = serde_json::from_str::<CleanRequest>(body) {
                        let res = cleaner::execute_clean_items(req.paths).unwrap_or(cleaner::CleanResult {
                            freed_bytes: 0,
                            success_count: 0,
                            failed_count: 0,
                            skipped_locked_count: 0,
                        });
                        if let Ok(json) = serde_json::to_string(&res) {
                            let _ = socket.write_all(cors_response("200 OK", "application/json", &json).as_bytes()).await;
                            return;
                        }
                    }
                } 
                // 12. Create Restore Point
                else if first_line.starts_with("POST /api/restore-point") {
                    let desc = if let Ok(req) = serde_json::from_str::<RestorePointRequest>(body) {
                        req.description.unwrap_or_else(|| "WinPulse Optimizer Restore Point".to_string())
                    } else {
                        "WinPulse Optimizer Restore Point".to_string()
                    };
                    let success = restore_point::create_restore_point(&desc).unwrap_or(false);
                    let json = format!("{{\"success\": {}}}", success);
                    let _ = socket.write_all(cors_response("200 OK", "application/json", &json).as_bytes()).await;
                    return;
                }
                // 13. Optimization History
                else if first_line.starts_with("GET /api/history") {
                    if let Ok(hist) = history::get_history() {
                        if let Ok(json) = serde_json::to_string(&hist) {
                            let _ = socket.write_all(cors_response("200 OK", "application/json", &json).as_bytes()).await;
                            return;
                        }
                    }
                }

                let not_found = cors_response("404 Not Found", "text/plain", "Not Found");
                let _ = socket.write_all(not_found.as_bytes()).await;
            });
        }
    });
}
