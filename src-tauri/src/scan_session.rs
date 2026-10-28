use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::{AppError, AppResult};

/// Phiên quét do backend giữ: frontend chỉ gửi lại `scan_id` + id của mục,
/// không bao giờ gửi đường dẫn thô để xóa (whitelist theo kết quả quét).
#[derive(Debug)]
struct ScanSession<T> {
    scan_id: String,
    items: HashMap<String, T>,
}

/// Kho lưu phiên quét gần nhất (một phiên cho mỗi loại quét), dùng làm Tauri managed state.
#[derive(Debug)]
pub struct ScanSessionStore<T> {
    inner: Mutex<Option<ScanSession<T>>>,
}

impl<T> Default for ScanSessionStore<T> {
    fn default() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

static SCAN_COUNTER: AtomicU64 = AtomicU64::new(1);

/// Sinh mã phiên quét duy nhất trong vòng đời tiến trình
fn new_scan_id(prefix: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let seq = SCAN_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{}-{:x}-{}", prefix, nanos, seq)
}

impl<T: Clone> ScanSessionStore<T> {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> AppResult<std::sync::MutexGuard<'_, Option<ScanSession<T>>>> {
        self.inner
            .lock()
            .map_err(|_| AppError::InvalidState("Phiên quét bị khóa do lỗi trước đó".to_string()))
    }

    /// Thay phiên cũ bằng kết quả quét mới, trả về `scan_id` mới.
    pub fn replace(&self, prefix: &str, items: Vec<(String, T)>) -> AppResult<String> {
        let scan_id = new_scan_id(prefix);
        let mut guard = self.lock()?;
        *guard = Some(ScanSession {
            scan_id: scan_id.clone(),
            items: items.into_iter().collect(),
        });
        Ok(scan_id)
    }

    /// Lấy các mục theo id trong đúng phiên `scan_id`.
    /// Từ chối toàn bộ yêu cầu nếu phiên đã hết hạn hoặc có id không thuộc phiên (dấu hiệu dữ liệu bị giả mạo).
    pub fn resolve(&self, scan_id: &str, ids: &[String]) -> AppResult<Vec<T>> {
        let guard = self.lock()?;
        let session = match guard.as_ref() {
            Some(s) if s.scan_id == scan_id => s,
            _ => {
                return Err(AppError::InvalidState(
                    "Phiên quét đã hết hạn hoặc không tồn tại. Vui lòng quét lại.".to_string(),
                ))
            }
        };

        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            match session.items.get(id) {
                Some(item) => out.push(item.clone()),
                None => {
                    return Err(AppError::InvalidPath(format!(
                        "Mục '{}' không thuộc phiên quét hiện tại",
                        id
                    )))
                }
            }
        }
        Ok(out)
    }

    /// Bỏ các mục đã xử lý xong khỏi phiên (để không xóa lại lần hai).
    pub fn remove(&self, scan_id: &str, ids: &[String]) -> AppResult<()> {
        let mut guard = self.lock()?;
        if let Some(session) = guard.as_mut() {
            if session.scan_id == scan_id {
                for id in ids {
                    session.items.remove(id);
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_rejects_unknown_scan_and_id() {
        let store: ScanSessionStore<String> = ScanSessionStore::new();
        // Chưa có phiên nào
        assert!(store.resolve("x", &["a".to_string()]).is_err());

        let scan_id = match store.replace("t", vec![("a".to_string(), "path-a".to_string())]) {
            Ok(id) => id,
            Err(e) => panic!("replace thất bại: {:?}", e),
        };
        assert!(matches!(store.resolve(&scan_id, &["a".to_string()]), Ok(v) if v == vec!["path-a".to_string()]));
        // Sai scan_id
        assert!(store.resolve("sai", &["a".to_string()]).is_err());
        // Id ngoài phiên → từ chối cả yêu cầu
        assert!(store
            .resolve(&scan_id, &["a".to_string(), "b".to_string()])
            .is_err());

        // Phiên mới thay thế phiên cũ
        let scan2 = match store.replace("t", vec![]) {
            Ok(id) => id,
            Err(e) => panic!("replace thất bại: {:?}", e),
        };
        assert_ne!(scan_id, scan2);
        assert!(store.resolve(&scan_id, &["a".to_string()]).is_err());
    }

    #[test]
    fn test_remove_items() {
        let store: ScanSessionStore<u32> = ScanSessionStore::new();
        let scan_id = match store.replace("t", vec![("a".to_string(), 1), ("b".to_string(), 2)]) {
            Ok(id) => id,
            Err(e) => panic!("replace thất bại: {:?}", e),
        };
        assert!(store.remove(&scan_id, &["a".to_string()]).is_ok());
        assert!(store.resolve(&scan_id, &["a".to_string()]).is_err());
        assert!(store.resolve(&scan_id, &["b".to_string()]).is_ok());
    }
}
