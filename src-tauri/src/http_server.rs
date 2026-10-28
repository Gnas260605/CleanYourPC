//! HTTP server CHỈ ĐỌC dành cho chế độ xem UI trong trình duyệt khi phát triển (`npm run dev`).
//!
//! Ràng buộc bảo mật:
//! - Chỉ được khởi động trong bản debug (`#[cfg(debug_assertions)]` tại `lib.rs`).
//! - Chỉ bind 127.0.0.1, chỉ chấp nhận GET, không có endpoint nào thay đổi hệ thống.
//! - Kiểm tra `Host` (chống DNS rebinding) và `Origin` (chỉ Vite dev server), sai → 403.
//! - Route khớp chính xác path, giới hạn kích thước request.

use std::net::SocketAddr;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tracing::{error, info, warn};

use crate::cleaner::{self, CleanScanResult};
use crate::history;
use crate::metrics::MetricsState;
use crate::process_guardian;
use crate::startup;

/// Origin của Vite dev server được phép gọi
const ALLOWED_ORIGINS: &[&str] = &["http://localhost:1420", "http://127.0.0.1:1420"];

/// Kích thước tối đa phần header của request (chỉ GET, không có body)
const MAX_REQUEST_BYTES: usize = 8192;

/// Các route chỉ đọc được hỗ trợ
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    Metrics,
    System,
    Processes,
    Startup,
    CleanerScan,
    History,
}

/// Kết quả phân tích một request
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    /// Preflight CORS hợp lệ
    Preflight { origin: Option<String> },
    /// Request GET hợp lệ tới route
    Serve { route: Route, origin: Option<String> },
    Forbidden(&'static str),
    MethodNotAllowed,
    NotFound,
    BadRequest,
}

fn header_value<'a>(lines: &[&'a str], name: &str) -> Option<&'a str> {
    lines.iter().find_map(|line| {
        let (k, v) = line.split_once(':')?;
        if k.trim().eq_ignore_ascii_case(name) {
            Some(v.trim())
        } else {
            None
        }
    })
}

fn is_allowed_host(host: &str, port: u16) -> bool {
    host == format!("127.0.0.1:{}", port) || host == format!("localhost:{}", port)
}

fn match_route(path: &str) -> Option<Route> {
    // Bỏ query string, khớp chính xác (không dùng starts_with)
    let path = path.split('?').next().unwrap_or("");
    match path {
        "/api/metrics" => Some(Route::Metrics),
        "/api/system" => Some(Route::System),
        "/api/processes" => Some(Route::Processes),
        "/api/startup" => Some(Route::Startup),
        "/api/cleaner/scan" => Some(Route::CleanerScan),
        "/api/history" => Some(Route::History),
        _ => None,
    }
}

/// Phân tích phần header của request và quyết định cách phản hồi (hàm thuần, dễ kiểm thử).
pub fn decide(raw_head: &str, port: u16) -> Decision {
    let lines: Vec<&str> = raw_head.split("\r\n").collect();
    let request_line = lines.first().copied().unwrap_or("");
    let mut parts = request_line.split_whitespace();
    let (method, path, version) = match (parts.next(), parts.next(), parts.next()) {
        (Some(m), Some(p), Some(v)) => (m, p, v),
        _ => return Decision::BadRequest,
    };
    if !version.starts_with("HTTP/1.") {
        return Decision::BadRequest;
    }

    // 1. Host phải là 127.0.0.1/localhost đúng cổng (chống DNS rebinding)
    match header_value(&lines[1..], "Host") {
        Some(host) if is_allowed_host(host, port) => {}
        _ => return Decision::Forbidden("Host không hợp lệ"),
    }

    // 2. Nếu có Origin (request từ trình duyệt) thì phải là Vite dev server
    let origin = header_value(&lines[1..], "Origin").map(|o| o.to_string());
    if let Some(o) = &origin {
        if !ALLOWED_ORIGINS.contains(&o.as_str()) {
            return Decision::Forbidden("Origin không được phép");
        }
    }

    match method {
        "OPTIONS" => Decision::Preflight { origin },
        "GET" => match match_route(path) {
            Some(route) => Decision::Serve { route, origin },
            None => Decision::NotFound,
        },
        _ => Decision::MethodNotAllowed,
    }
}

/// Header CORS chỉ trả về khi Origin đã được kiểm tra là hợp lệ
fn cors_headers(origin: Option<&str>) -> String {
    match origin {
        Some(o) => format!(
            "Access-Control-Allow-Origin: {}\r\nVary: Origin\r\nAccess-Control-Allow-Methods: GET, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\n",
            o
        ),
        None => String::new(),
    }
}

fn response(status: &str, origin: Option<&str>, content_type: &str, body: &str) -> String {
    let cors = cors_headers(origin);
    format!(
        "HTTP/1.1 {}\r\nContent-Type: {}\r\n{}X-Content-Type-Options: nosniff\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
        status,
        content_type,
        cors,
        body.len(),
        body
    )
}

async fn serve_route(route: Route, state: &MetricsState) -> Option<String> {
    match route {
        Route::Metrics => {
            let m = state.get_metrics().await.ok()?;
            serde_json::to_string(&m).ok()
        }
        Route::System => {
            let s = state.get_system_info().await.ok()?;
            serde_json::to_string(&s).ok()
        }
        Route::Processes => {
            let p = tauri::async_runtime::spawn_blocking(process_guardian::get_process_list)
                .await
                .ok()?
                .unwrap_or_default();
            serde_json::to_string(&p).ok()
        }
        Route::Startup => {
            let items = tauri::async_runtime::spawn_blocking(startup::get_all_startup_items)
                .await
                .ok()?
                .unwrap_or_default();
            serde_json::to_string(&items).ok()
        }
        Route::CleanerScan => {
            // Chế độ trình duyệt chỉ để xem: không tạo phiên quét, nên không thể dọn qua HTTP
            let items = tauri::async_runtime::spawn_blocking(cleaner::scan_cleanable_items)
                .await
                .ok()?
                .unwrap_or_default();
            serde_json::to_string(&CleanScanResult {
                scan_id: String::new(),
                items,
            })
            .ok()
        }
        Route::History => {
            let h = history::get_history().ok()?;
            serde_json::to_string(&h).ok()
        }
    }
}

/// Đọc phần header của request, tối đa MAX_REQUEST_BYTES
async fn read_head(socket: &mut tokio::net::TcpStream) -> Option<String> {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    loop {
        let n = socket.read(&mut chunk).await.ok()?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            buf.truncate(pos);
            break;
        }
        if buf.len() > MAX_REQUEST_BYTES {
            return None;
        }
    }
    String::from_utf8(buf).ok()
}

/// Khởi chạy HTTP server chỉ đọc trên 127.0.0.1:`port` (chỉ gọi trong bản debug)
pub fn start_http_server(metrics_state: MetricsState, port: u16) {
    tauri::async_runtime::spawn(async move {
        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        let listener = match TcpListener::bind(addr).await {
            Ok(l) => {
                info!("🌐 [DEBUG] HTTP server chỉ đọc tại http://127.0.0.1:{}", port);
                l
            }
            Err(e) => {
                error!("Không thể bind HTTP server debug trên cổng {}: {:?}", port, e);
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
                let reply = match read_head(&mut socket).await {
                    None => response("400 Bad Request", None, "text/plain", "Bad Request"),
                    Some(head) => match decide(&head, port) {
                        Decision::Preflight { origin } => format!(
                            "HTTP/1.1 204 No Content\r\n{}Connection: close\r\nContent-Length: 0\r\n\r\n",
                            cors_headers(origin.as_deref())
                        ),
                        Decision::Serve { route, origin } => match serve_route(route, &state).await {
                            Some(json) => response("200 OK", origin.as_deref(), "application/json", &json),
                            None => response("500 Internal Server Error", origin.as_deref(), "text/plain", "Error"),
                        },
                        Decision::Forbidden(reason) => {
                            warn!("HTTP debug server từ chối request: {}", reason);
                            response("403 Forbidden", None, "text/plain", "Forbidden")
                        }
                        Decision::MethodNotAllowed => {
                            response("405 Method Not Allowed", None, "text/plain", "Method Not Allowed")
                        }
                        Decision::NotFound => response("404 Not Found", None, "text/plain", "Not Found"),
                        Decision::BadRequest => response("400 Bad Request", None, "text/plain", "Bad Request"),
                    },
                };
                let _ = socket.write_all(reply.as_bytes()).await;
            });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const PORT: u16 = 1421;

    #[test]
    fn test_get_allowed_with_valid_host_and_origin() {
        let head = "GET /api/metrics HTTP/1.1\r\nHost: 127.0.0.1:1421\r\nOrigin: http://localhost:1420";
        assert_eq!(
            decide(head, PORT),
            Decision::Serve {
                route: Route::Metrics,
                origin: Some("http://localhost:1420".to_string())
            }
        );
        // Không có Origin (curl) vẫn được đọc
        let head = "GET /api/history?x=1 HTTP/1.1\r\nHost: localhost:1421";
        assert_eq!(
            decide(head, PORT),
            Decision::Serve { route: Route::History, origin: None }
        );
    }

    #[test]
    fn test_post_and_mutating_paths_rejected() {
        let head = "POST /api/processes/kill HTTP/1.1\r\nHost: 127.0.0.1:1421";
        assert_eq!(decide(head, PORT), Decision::MethodNotAllowed);
        let head = "POST /api/cleaner/clean HTTP/1.1\r\nHost: 127.0.0.1:1421";
        assert_eq!(decide(head, PORT), Decision::MethodNotAllowed);
        // GET tới path từng là POST cũng không tồn tại
        let head = "GET /api/processes/kill HTTP/1.1\r\nHost: 127.0.0.1:1421";
        assert_eq!(decide(head, PORT), Decision::NotFound);
    }

    #[test]
    fn test_foreign_origin_and_dns_rebinding_rejected() {
        let head = "GET /api/metrics HTTP/1.1\r\nHost: 127.0.0.1:1421\r\nOrigin: https://evil.example";
        assert!(matches!(decide(head, PORT), Decision::Forbidden(_)));
        // DNS rebinding: Host là tên miền của kẻ tấn công
        let head = "GET /api/metrics HTTP/1.1\r\nHost: evil.example:1421";
        assert!(matches!(decide(head, PORT), Decision::Forbidden(_)));
        // Thiếu Host
        let head = "GET /api/metrics HTTP/1.1";
        assert!(matches!(decide(head, PORT), Decision::Forbidden(_)));
    }

    #[test]
    fn test_exact_route_match() {
        let head = "GET /api/metricsXYZ HTTP/1.1\r\nHost: 127.0.0.1:1421";
        assert_eq!(decide(head, PORT), Decision::NotFound);
        let head = "garbage";
        assert_eq!(decide(head, PORT), Decision::BadRequest);
    }
}
