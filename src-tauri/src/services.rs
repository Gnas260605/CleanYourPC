//! Tối ưu dịch vụ Windows qua Service Control Manager (SCM).
//!
//! Nguyên tắc Zero-Harm:
//! - Chỉ hiển thị và chỉ cho phép đổi các dịch vụ trong `SERVICE_CATALOG` (allowlist có mô tả tiếng Việt).
//! - Dịch vụ `KeepDefault` hoặc nằm trong `PathSafetyValidator::is_core_system_service` luôn bị từ chối.
//! - Trước lần thay đổi đầu tiên, startup type gốc được sao lưu vào JSON để hoàn tác.
//! - Thiếu quyền Administrator → trả lỗi rõ ràng, không giả vờ thành công.

use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use crate::error::{AppError, AppResult};
use crate::safety::PathSafetyValidator;

/// Mức khuyến nghị của một dịch vụ
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ServiceRecommendation {
    /// Tắt an toàn trên đa số máy cá nhân
    SafeToDisable,
    /// Tắt được nhưng mất một tính năng cụ thể
    Caution,
    /// Cốt lõi, khóa không cho sửa
    KeepDefault,
}

/// Một mục trong danh mục dịch vụ được hỗ trợ
#[derive(Debug, Clone, Copy)]
pub struct CatalogEntry {
    pub name: &'static str,
    pub fallback_display_name: &'static str,
    pub recommendation: ServiceRecommendation,
    pub description_vi: &'static str,
    pub impact_vi: &'static str,
}

/// Danh mục dịch vụ được hiển thị. Chỉ mục khác `KeepDefault` mới được phép thay đổi.
pub const SERVICE_CATALOG: &[CatalogEntry] = &[
    CatalogEntry {
        name: "DiagTrack",
        fallback_display_name: "Connected User Experiences and Telemetry",
        recommendation: ServiceRecommendation::SafeToDisable,
        description_vi: "Thu thập dữ liệu chẩn đoán/telemetry và gửi về máy chủ Microsoft.",
        impact_vi: "Tắt giúp tăng riêng tư, giảm CPU/Disk chạy ngầm; không ảnh hưởng ứng dụng thông thường.",
    },
    CatalogEntry {
        name: "dmwappushservice",
        fallback_display_name: "Device Management WAP Push message Routing Service",
        recommendation: ServiceRecommendation::SafeToDisable,
        description_vi: "Định tuyến thông điệp quản lý thiết bị, đi kèm telemetry.",
        impact_vi: "Máy cá nhân không dùng MDM của doanh nghiệp có thể tắt an toàn.",
    },
    CatalogEntry {
        name: "RemoteRegistry",
        fallback_display_name: "Remote Registry",
        recommendation: ServiceRecommendation::SafeToDisable,
        description_vi: "Cho phép người dùng từ xa đọc/sửa Registry của máy qua mạng.",
        impact_vi: "Tắt giúp giảm bề mặt tấn công; máy cá nhân gần như không cần.",
    },
    CatalogEntry {
        name: "MapsBroker",
        fallback_display_name: "Downloaded Maps Manager",
        recommendation: ServiceRecommendation::SafeToDisable,
        description_vi: "Quản lý bản đồ ngoại tuyến cho ứng dụng Maps.",
        impact_vi: "Không dùng bản đồ ngoại tuyến thì tắt không ảnh hưởng gì.",
    },
    CatalogEntry {
        name: "RetailDemo",
        fallback_display_name: "Retail Demo Service",
        recommendation: ServiceRecommendation::SafeToDisable,
        description_vi: "Chế độ trưng bày máy tại cửa hàng.",
        impact_vi: "Không cần trên máy đang sử dụng.",
    },
    CatalogEntry {
        name: "Fax",
        fallback_display_name: "Fax",
        recommendation: ServiceRecommendation::SafeToDisable,
        description_vi: "Gửi/nhận fax qua modem.",
        impact_vi: "Không dùng fax thì tắt an toàn.",
    },
    CatalogEntry {
        name: "SysMain",
        fallback_display_name: "SysMain (SuperFetch)",
        recommendation: ServiceRecommendation::Caution,
        description_vi: "Nạp trước ứng dụng hay dùng vào RAM để mở nhanh hơn.",
        impact_vi: "Trên HDD có thể gây Disk 100%; trên SSD lợi ích nhỏ. Tắt có thể làm ứng dụng mở chậm hơn một chút.",
    },
    CatalogEntry {
        name: "WSearch",
        fallback_display_name: "Windows Search",
        recommendation: ServiceRecommendation::Caution,
        description_vi: "Lập chỉ mục tệp để tìm kiếm nhanh trong Start Menu/Explorer.",
        impact_vi: "Tắt giảm tải CPU/Disk nhưng tìm kiếm tệp sẽ chậm hơn rõ rệt; Outlook có thể tìm kém hơn.",
    },
    CatalogEntry {
        name: "XboxGipSvc",
        fallback_display_name: "Xbox Accessory Management Service",
        recommendation: ServiceRecommendation::Caution,
        description_vi: "Quản lý tay cầm và phụ kiện Xbox.",
        impact_vi: "Không dùng tay cầm Xbox thì tắt được; có dùng thì tay cầm có thể không cập nhật firmware.",
    },
    CatalogEntry {
        name: "XblAuthManager",
        fallback_display_name: "Xbox Live Auth Manager",
        recommendation: ServiceRecommendation::Caution,
        description_vi: "Xác thực tài khoản Xbox Live cho game và ứng dụng Xbox.",
        impact_vi: "Tắt sẽ làm game Microsoft Store/Game Pass không đăng nhập được.",
    },
    CatalogEntry {
        name: "XblGameSave",
        fallback_display_name: "Xbox Live Game Save",
        recommendation: ServiceRecommendation::Caution,
        description_vi: "Đồng bộ save game lên đám mây Xbox Live.",
        impact_vi: "Tắt sẽ không đồng bộ save game Game Pass/Store.",
    },
    CatalogEntry {
        name: "WerSvc",
        fallback_display_name: "Windows Error Reporting Service",
        recommendation: ServiceRecommendation::Caution,
        description_vi: "Gửi báo cáo lỗi ứng dụng tới Microsoft và tạo crash dump.",
        impact_vi: "Tắt giảm ghi đĩa khi app lỗi, nhưng mất thông tin để chẩn đoán sự cố.",
    },
    // --- Dịch vụ cốt lõi: chỉ hiển thị, khóa không cho sửa ---
    CatalogEntry {
        name: "Audiosrv",
        fallback_display_name: "Windows Audio",
        recommendation: ServiceRecommendation::KeepDefault,
        description_vi: "Quản lý âm thanh cho mọi chương trình.",
        impact_vi: "DỊCH VỤ CỐT LÕI: tắt sẽ mất hoàn toàn âm thanh.",
    },
    CatalogEntry {
        name: "RpcSs",
        fallback_display_name: "Remote Procedure Call (RPC)",
        recommendation: ServiceRecommendation::KeepDefault,
        description_vi: "Nền tảng giao tiếp giữa các tiến trình Windows.",
        impact_vi: "DỊCH VỤ SỐNG CÒN: Windows không thể hoạt động nếu thiếu dịch vụ này.",
    },
    CatalogEntry {
        name: "wuauserv",
        fallback_display_name: "Windows Update",
        recommendation: ServiceRecommendation::KeepDefault,
        description_vi: "Tải và cài bản cập nhật bảo mật của Windows.",
        impact_vi: "Không nên tắt: máy sẽ thiếu bản vá bảo mật.",
    },
    CatalogEntry {
        name: "WinDefend",
        fallback_display_name: "Microsoft Defender Antivirus Service",
        recommendation: ServiceRecommendation::KeepDefault,
        description_vi: "Diệt virus tích hợp của Windows.",
        impact_vi: "Không can thiệp: Windows tự quản lý khi bạn cài phần mềm diệt virus khác.",
    },
];

/// Startup type mà người dùng được phép đặt
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum StartupType {
    Automatic,
    AutomaticDelayed,
    Manual,
    Disabled,
    /// Boot/System: chỉ đọc, không bao giờ đặt từ app
    Other,
}

impl StartupType {
    /// Phân tích startup type do frontend yêu cầu. Chỉ chấp nhận Manual / Disabled / Automatic.
    pub fn parse_user_choice(s: &str) -> AppResult<Self> {
        match s {
            "Manual" => Ok(StartupType::Manual),
            "Disabled" => Ok(StartupType::Disabled),
            "Automatic" => Ok(StartupType::Automatic),
            other => Err(AppError::InvalidState(format!(
                "Kiểu khởi động '{}' không được hỗ trợ",
                other
            ))),
        }
    }
}

/// Trạng thái dịch vụ trả về cho frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceInfo {
    pub name: String,
    pub display_name: String,
    /// "running" | "stopped" | "pending"
    pub status: String,
    pub startup_type: StartupType,
    pub recommendation: ServiceRecommendation,
    pub description_vi: String,
    pub impact_vi: String,
    /// Có được phép đổi startup type hay không (đã tính allowlist + core service)
    pub can_modify: bool,
    /// Startup type gốc nếu đã từng bị WinPulse thay đổi (để hoàn tác)
    pub original_startup_type: Option<StartupType>,
}

/// Kết quả một thao tác đổi dịch vụ
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceChangeResult {
    pub name: String,
    pub startup_type: StartupType,
    pub status: String,
    pub message: String,
}

/// Bản sao lưu startup type gốc
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServiceBackupEntry {
    pub startup_type: StartupType,
}

pub type ServiceBackup = BTreeMap<String, ServiceBackupEntry>;

/// Tra mục catalog theo tên (không phân biệt hoa thường)
pub fn find_catalog_entry(name: &str) -> Option<&'static CatalogEntry> {
    SERVICE_CATALOG
        .iter()
        .find(|e| e.name.eq_ignore_ascii_case(name.trim()))
}

/// Một dịch vụ chỉ được sửa khi có trong catalog, không phải KeepDefault và không phải core service
pub fn is_modifiable(name: &str) -> bool {
    match find_catalog_entry(name) {
        Some(entry) => {
            entry.recommendation != ServiceRecommendation::KeepDefault
                && !PathSafetyValidator::is_core_system_service(entry.name)
        }
        None => false,
    }
}

/// Kiểm tra yêu cầu đổi dịch vụ, trả về mục catalog chuẩn (tên đúng chữ hoa/thường)
pub fn validate_change_request(name: &str) -> AppResult<&'static CatalogEntry> {
    let entry = find_catalog_entry(name).ok_or_else(|| {
        AppError::InvalidState(format!("Dịch vụ '{}' không nằm trong danh sách được hỗ trợ", name))
    })?;
    if !is_modifiable(entry.name) {
        warn!("🛑 Từ chối thay đổi dịch vụ được bảo vệ: {}", entry.name);
        return Err(AppError::PermissionDenied(format!(
            "Dịch vụ '{}' là dịch vụ cốt lõi được bảo vệ, không được phép thay đổi",
            entry.name
        )));
    }
    Ok(entry)
}

// ==========================================
// SAO LƯU STARTUP TYPE GỐC
// ==========================================

pub fn get_backup_file_path() -> PathBuf {
    let base = env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".to_string());
    Path::new(&base)
        .join("WinPulseOptimizer")
        .join("services_backup.json")
}

pub fn load_backup_from(path: &Path) -> ServiceBackup {
    match fs::read_to_string(path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => ServiceBackup::new(),
    }
}

pub fn save_backup_to(path: &Path, backup: &ServiceBackup) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(backup)
        .map_err(|e| AppError::IoError(format!("Không thể tạo JSON sao lưu dịch vụ: {}", e)))?;
    fs::write(path, json)?;
    Ok(())
}

/// Ghi startup type gốc vào backup nếu dịch vụ chưa có bản sao lưu (giữ giá trị gốc đầu tiên)
pub fn remember_original(backup: &mut ServiceBackup, name: &str, original: StartupType) -> bool {
    if backup.contains_key(name) {
        return false;
    }
    backup.insert(name.to_string(), ServiceBackupEntry { startup_type: original });
    true
}

// ==========================================
// API CÔNG KHAI
// ==========================================

/// Đọc trạng thái thật của các dịch vụ trong catalog (bỏ qua dịch vụ không có trên máy)
pub fn get_services() -> AppResult<Vec<ServiceInfo>> {
    let backup = load_backup_from(&get_backup_file_path());
    let mut out = Vec::new();
    for entry in SERVICE_CATALOG {
        match scm::query(entry.name) {
            Ok(Some((display_name, status, startup_type))) => out.push(ServiceInfo {
                name: entry.name.to_string(),
                display_name: if display_name.is_empty() {
                    entry.fallback_display_name.to_string()
                } else {
                    display_name
                },
                status,
                startup_type,
                recommendation: entry.recommendation,
                description_vi: entry.description_vi.to_string(),
                impact_vi: entry.impact_vi.to_string(),
                can_modify: is_modifiable(entry.name),
                original_startup_type: backup.get(entry.name).map(|b| b.startup_type),
            }),
            Ok(None) => {} // Dịch vụ không tồn tại trên phiên bản Windows này
            Err(e) => warn!("Không đọc được dịch vụ {}: {:?}", entry.name, e),
        }
    }
    Ok(out)
}

/// Đổi startup type của một dịch vụ được phép; sao lưu giá trị gốc trước khi đổi.
/// `stop_now = true` thì dừng dịch vụ ngay (best-effort) khi chuyển sang Manual/Disabled.
pub fn set_service_startup(name: &str, startup: &str, stop_now: bool) -> AppResult<ServiceChangeResult> {
    let entry = validate_change_request(name)?;
    let target = StartupType::parse_user_choice(startup)?;

    let current = match scm::query(entry.name)? {
        Some((_, _, st)) => st,
        None => {
            return Err(AppError::InvalidState(format!(
                "Dịch vụ '{}' không tồn tại trên máy này",
                entry.name
            )))
        }
    };

    // 1. Sao lưu trước — không sao lưu được thì không thay đổi
    let backup_path = get_backup_file_path();
    let mut backup = load_backup_from(&backup_path);
    if remember_original(&mut backup, entry.name, current) {
        save_backup_to(&backup_path, &backup)?;
    }

    // 2. Đổi startup type (lỗi quyền được trả về rõ ràng)
    scm::set_start_type(entry.name, target)?;

    // 3. Dừng dịch vụ nếu được yêu cầu
    let mut message = format!("Đã đặt '{}' sang {:?}", entry.name, target);
    if stop_now && target != StartupType::Automatic {
        match scm::stop(entry.name) {
            Ok(()) => message.push_str(", đã gửi lệnh dừng dịch vụ"),
            Err(e) => {
                warn!("Không dừng được dịch vụ {}: {:?}", entry.name, e);
                message.push_str(" (dịch vụ chưa dừng được, sẽ có hiệu lực sau khi khởi động lại)");
            }
        }
    }

    let status = scm::query(entry.name)?
        .map(|(_, s, _)| s)
        .unwrap_or_else(|| "stopped".to_string());
    info!("{}", message);

    Ok(ServiceChangeResult {
        name: entry.name.to_string(),
        startup_type: target,
        status,
        message,
    })
}

/// Hoàn tác về startup type gốc đã sao lưu
pub fn restore_service_startup(name: &str) -> AppResult<ServiceChangeResult> {
    let entry = validate_change_request(name)?;
    let backup_path = get_backup_file_path();
    let mut backup = load_backup_from(&backup_path);
    let original = backup.get(entry.name).copied().ok_or_else(|| {
        AppError::InvalidState(format!("Không có bản sao lưu cho dịch vụ '{}'", entry.name))
    })?;

    scm::set_start_type(entry.name, original.startup_type)?;

    let mut message = format!("Đã khôi phục '{}' về {:?}", entry.name, original.startup_type);
    if matches!(original.startup_type, StartupType::Automatic | StartupType::AutomaticDelayed) {
        if let Err(e) = scm::start(entry.name) {
            warn!("Không khởi động lại được dịch vụ {}: {:?}", entry.name, e);
            message.push_str(" (dịch vụ sẽ chạy sau khi khởi động lại máy)");
        }
    }

    backup.remove(entry.name);
    save_backup_to(&backup_path, &backup)?;

    let status = scm::query(entry.name)?
        .map(|(_, s, _)| s)
        .unwrap_or_else(|| "stopped".to_string());

    Ok(ServiceChangeResult {
        name: entry.name.to_string(),
        startup_type: original.startup_type,
        status,
        message,
    })
}

// ==========================================
// SERVICE CONTROL MANAGER (Win32)
// ==========================================

#[cfg(windows)]
mod scm {
    use super::StartupType;
    use crate::error::{AppError, AppResult};
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Foundation::{BOOL, ERROR_ACCESS_DENIED, ERROR_SERVICE_DOES_NOT_EXIST};
    use windows::Win32::System::Services::{
        ChangeServiceConfig2W, ChangeServiceConfigW, CloseServiceHandle, ControlService,
        OpenSCManagerW, OpenServiceW, QueryServiceConfig2W, QueryServiceConfigW, QueryServiceStatus,
        StartServiceW, ENUM_SERVICE_TYPE, QUERY_SERVICE_CONFIGW, SC_HANDLE, SC_MANAGER_CONNECT,
        SERVICE_AUTO_START, SERVICE_CHANGE_CONFIG, SERVICE_CONFIG_DELAYED_AUTO_START_INFO,
        SERVICE_CONTROL_STOP, SERVICE_DELAYED_AUTO_START_INFO, SERVICE_DEMAND_START,
        SERVICE_DISABLED, SERVICE_ERROR, SERVICE_NO_CHANGE, SERVICE_QUERY_CONFIG,
        SERVICE_QUERY_STATUS, SERVICE_RUNNING, SERVICE_START, SERVICE_START_TYPE, SERVICE_STATUS,
        SERVICE_STOP, SERVICE_STOPPED,
    };

    /// Handle SCM/dịch vụ tự đóng khi ra khỏi phạm vi
    struct Handle(SC_HANDLE);
    impl Drop for Handle {
        fn drop(&mut self) {
            // SAFETY: handle hợp lệ do OpenSCManagerW/OpenServiceW trả về, chỉ đóng một lần
            unsafe {
                let _ = CloseServiceHandle(self.0);
            }
        }
    }

    fn map_err(name: &str, err: windows::core::Error) -> AppError {
        if err.code() == ERROR_ACCESS_DENIED.to_hresult() {
            AppError::PermissionDenied(format!(
                "Cần chạy WinPulse với quyền Administrator để thay đổi dịch vụ '{}'",
                name
            ))
        } else {
            AppError::from(err)
        }
    }

    fn open_service(name: &str, access: u32) -> AppResult<Option<Handle>> {
        // SAFETY: tham số là chuỗi HSTRING hợp lệ trong suốt lời gọi; handle được bọc trong Handle
        unsafe {
            let manager = OpenSCManagerW(PCWSTR::null(), PCWSTR::null(), SC_MANAGER_CONNECT)
                .map_err(|e| map_err(name, e))?;
            let manager = Handle(manager);
            match OpenServiceW(manager.0, &HSTRING::from(name), access) {
                Ok(h) => Ok(Some(Handle(h))),
                Err(e) if e.code() == ERROR_SERVICE_DOES_NOT_EXIST.to_hresult() => Ok(None),
                Err(e) => Err(map_err(name, e)),
            }
        }
    }

    fn query_status(h: &Handle) -> windows::core::Result<SERVICE_STATUS> {
        let mut status = SERVICE_STATUS::default();
        // SAFETY: con trỏ tới biến cục bộ hợp lệ
        unsafe { QueryServiceStatus(h.0, &mut status)? };
        Ok(status)
    }

    fn status_text(status: &SERVICE_STATUS) -> String {
        if status.dwCurrentState == SERVICE_RUNNING {
            "running".to_string()
        } else if status.dwCurrentState == SERVICE_STOPPED {
            "stopped".to_string()
        } else {
            "pending".to_string()
        }
    }

    fn is_delayed(h: &Handle) -> bool {
        let mut buf = [0u8; std::mem::size_of::<SERVICE_DELAYED_AUTO_START_INFO>()];
        let mut needed = 0u32;
        // SAFETY: buffer đủ kích thước cho SERVICE_DELAYED_AUTO_START_INFO
        unsafe {
            if QueryServiceConfig2W(h.0, SERVICE_CONFIG_DELAYED_AUTO_START_INFO, Some(&mut buf), &mut needed).is_err() {
                return false;
            }
            let info = std::ptr::read_unaligned(buf.as_ptr() as *const SERVICE_DELAYED_AUTO_START_INFO);
            info.fDelayedAutostart.as_bool()
        }
    }

    /// Trả về (display name, trạng thái, startup type) hoặc None nếu dịch vụ không tồn tại
    pub fn query(name: &str) -> AppResult<Option<(String, String, StartupType)>> {
        let h = match open_service(name, SERVICE_QUERY_CONFIG | SERVICE_QUERY_STATUS)? {
            Some(h) => h,
            None => return Ok(None),
        };

        let status = query_status(&h).map_err(|e| map_err(name, e))?;

        // Lần 1 lấy kích thước buffer, lần 2 đọc cấu hình
        let mut needed = 0u32;
        // SAFETY: gọi thăm dò kích thước, lỗi ERROR_INSUFFICIENT_BUFFER là mong đợi
        unsafe {
            let _ = QueryServiceConfigW(h.0, None, 0, &mut needed);
        }
        if needed == 0 {
            return Err(AppError::SystemError(format!("Không đọc được cấu hình dịch vụ '{}'", name)));
        }
        // Buffer căn chỉnh theo u64 để chứa QUERY_SERVICE_CONFIGW
        let mut buf = vec![0u64; (needed as usize).div_ceil(8)];
        let cfg_ptr = buf.as_mut_ptr() as *mut QUERY_SERVICE_CONFIGW;
        // SAFETY: buffer có kích thước >= needed byte và căn chỉnh 8
        let (start_type, display_name) = unsafe {
            QueryServiceConfigW(h.0, Some(cfg_ptr), needed, &mut needed).map_err(|e| map_err(name, e))?;
            let cfg = &*cfg_ptr;
            let display = if cfg.lpDisplayName.is_null() {
                String::new()
            } else {
                cfg.lpDisplayName.to_string().unwrap_or_default()
            };
            (cfg.dwStartType, display)
        };

        let startup_type = if start_type == SERVICE_AUTO_START {
            if is_delayed(&h) {
                StartupType::AutomaticDelayed
            } else {
                StartupType::Automatic
            }
        } else if start_type == SERVICE_DEMAND_START {
            StartupType::Manual
        } else if start_type == SERVICE_DISABLED {
            StartupType::Disabled
        } else {
            StartupType::Other
        };

        Ok(Some((display_name, status_text(&status), startup_type)))
    }

    pub fn set_start_type(name: &str, target: StartupType) -> AppResult<()> {
        let (start, delayed): (SERVICE_START_TYPE, Option<bool>) = match target {
            StartupType::Automatic => (SERVICE_AUTO_START, Some(false)),
            StartupType::AutomaticDelayed => (SERVICE_AUTO_START, Some(true)),
            StartupType::Manual => (SERVICE_DEMAND_START, None),
            StartupType::Disabled => (SERVICE_DISABLED, None),
            StartupType::Other => {
                return Err(AppError::InvalidState("Không hỗ trợ đặt kiểu khởi động Boot/System".to_string()))
            }
        };

        let h = open_service(name, SERVICE_CHANGE_CONFIG | SERVICE_QUERY_CONFIG)?
            .ok_or_else(|| AppError::InvalidState(format!("Dịch vụ '{}' không tồn tại", name)))?;

        // SAFETY: handle hợp lệ, các tham số chuỗi null = không đổi
        unsafe {
            ChangeServiceConfigW(
                h.0,
                ENUM_SERVICE_TYPE(SERVICE_NO_CHANGE),
                start,
                SERVICE_ERROR(SERVICE_NO_CHANGE),
                PCWSTR::null(),
                PCWSTR::null(),
                None,
                PCWSTR::null(),
                PCWSTR::null(),
                PCWSTR::null(),
                PCWSTR::null(),
            )
            .map_err(|e| map_err(name, e))?;

            if let Some(flag) = delayed {
                let info = SERVICE_DELAYED_AUTO_START_INFO {
                    fDelayedAutostart: BOOL::from(flag),
                };
                ChangeServiceConfig2W(
                    h.0,
                    SERVICE_CONFIG_DELAYED_AUTO_START_INFO,
                    Some(&info as *const _ as *const core::ffi::c_void),
                )
                .map_err(|e| map_err(name, e))?;
            }
        }
        Ok(())
    }

    pub fn stop(name: &str) -> AppResult<()> {
        let h = open_service(name, SERVICE_STOP | SERVICE_QUERY_STATUS)?
            .ok_or_else(|| AppError::InvalidState(format!("Dịch vụ '{}' không tồn tại", name)))?;
        let current = query_status(&h).map_err(|e| map_err(name, e))?;
        if current.dwCurrentState == SERVICE_STOPPED {
            return Ok(());
        }
        let mut status = SERVICE_STATUS::default();
        // SAFETY: handle hợp lệ, con trỏ tới biến cục bộ
        unsafe { ControlService(h.0, SERVICE_CONTROL_STOP, &mut status) }.map_err(|e| map_err(name, e))
    }

    pub fn start(name: &str) -> AppResult<()> {
        let h = open_service(name, SERVICE_START | SERVICE_QUERY_STATUS)?
            .ok_or_else(|| AppError::InvalidState(format!("Dịch vụ '{}' không tồn tại", name)))?;
        let current = query_status(&h).map_err(|e| map_err(name, e))?;
        if current.dwCurrentState == SERVICE_RUNNING {
            return Ok(());
        }
        // SAFETY: handle hợp lệ, không truyền tham số
        unsafe { StartServiceW(h.0, None) }.map_err(|e| map_err(name, e))
    }
}

/// Bản giả cho nền tảng khác Windows (chỉ để biên dịch/kiểm thử logic thuần)
#[cfg(not(windows))]
mod scm {
    use super::StartupType;
    use crate::error::{AppError, AppResult};

    fn unsupported() -> AppError {
        AppError::SystemError("Service Control Manager chỉ có trên Windows".to_string())
    }
    pub fn query(_name: &str) -> AppResult<Option<(String, String, StartupType)>> {
        Ok(None)
    }
    pub fn set_start_type(_name: &str, _target: StartupType) -> AppResult<()> {
        Err(unsupported())
    }
    pub fn stop(_name: &str) -> AppResult<()> {
        Err(unsupported())
    }
    pub fn start(_name: &str) -> AppResult<()> {
        Err(unsupported())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_core_and_unknown_services_rejected() {
        // Dịch vụ cốt lõi trong catalog bị khóa
        assert!(validate_change_request("Audiosrv").is_err());
        assert!(validate_change_request("rpcss").is_err());
        assert!(validate_change_request("wuauserv").is_err());
        // Dịch vụ không nằm trong catalog bị từ chối
        assert!(validate_change_request("PlugPlay").is_err());
        assert!(validate_change_request("LanmanWorkstation").is_err());
        assert!(validate_change_request("").is_err());
        // Dịch vụ trong allowlist được chấp nhận, trả về tên chuẩn
        match validate_change_request("diagtrack") {
            Ok(e) => assert_eq!(e.name, "DiagTrack"),
            Err(e) => panic!("DiagTrack phải được phép: {:?}", e),
        }
    }

    #[test]
    fn test_catalog_never_allows_core_service() {
        for entry in SERVICE_CATALOG {
            if PathSafetyValidator::is_core_system_service(entry.name) {
                assert!(!is_modifiable(entry.name), "{} là core service", entry.name);
                assert_eq!(entry.recommendation, ServiceRecommendation::KeepDefault);
            }
        }
    }

    #[test]
    fn test_parse_user_choice_rejects_boot_system() {
        assert!(StartupType::parse_user_choice("Manual").is_ok());
        assert!(StartupType::parse_user_choice("Disabled").is_ok());
        assert!(StartupType::parse_user_choice("Automatic").is_ok());
        assert!(StartupType::parse_user_choice("Boot").is_err());
        assert!(StartupType::parse_user_choice("System").is_err());
        assert!(StartupType::parse_user_choice("Other").is_err());
    }

    #[test]
    fn test_backup_keeps_first_original_value() {
        let mut backup = ServiceBackup::new();
        assert!(remember_original(&mut backup, "SysMain", StartupType::Automatic));
        // Lần đổi thứ hai không ghi đè giá trị gốc
        assert!(!remember_original(&mut backup, "SysMain", StartupType::Disabled));
        assert_eq!(
            backup.get("SysMain").map(|b| b.startup_type),
            Some(StartupType::Automatic)
        );

        let path = env::temp_dir().join("winpulse_services_backup_test.json");
        assert!(save_backup_to(&path, &backup).is_ok());
        assert_eq!(load_backup_from(&path), backup);
        let _ = fs::remove_file(&path);
    }
}
