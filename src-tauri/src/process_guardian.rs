use std::ffi::c_void;
use serde::{Deserialize, Serialize};
use sysinfo::{Pid, System};
use tracing::info;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::Threading::{
    GetProcessInformation, OpenProcess, ProcessPowerThrottling, SetProcessInformation,
    SetProcessWorkingSetSize, TerminateProcess, PROCESS_POWER_THROTTLING_CURRENT_VERSION,
    PROCESS_POWER_THROTTLING_EXECUTION_SPEED, PROCESS_POWER_THROTTLING_STATE,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_INFORMATION, PROCESS_SET_QUOTA,
    PROCESS_TERMINATE,
};

use crate::error::{AppError, AppResult};

/// Thông tin chi tiết của một tiến trình đang thực thi
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cpu_usage: f32,
    pub memory_bytes: u64,
    pub is_critical: bool,
    pub is_eco_mode: bool,
}

/// Danh sách tiến trình cốt lõi của Windows được BẢO VỆ TUYỆT ĐỐI (CRITICAL LOCK)
pub const CRITICAL_PROCESS_NAMES: &[&str] = &[
    "csrss.exe",
    "explorer.exe",
    "dwm.exe",
    "services.exe",
    "lsass.exe",
    "smss.exe",
    "wininit.exe",
    "system",
    "system idle process",
    "registry",
    "spoolsv.exe",
    "fontdrvhost.exe",
];

/// Kiểm tra xem tên tiến trình có nằm trong danh sách cấm chạm hay không
pub fn is_critical_process_name(name: &str) -> bool {
    let lower = name.trim().to_lowercase();
    for critical in CRITICAL_PROCESS_NAMES {
        if lower == *critical || lower.starts_with(critical) {
            return true;
        }
    }
    false
}

/// Kiểm tra tính chất quan trọng của tiến trình theo cả PID và Tên
pub fn is_critical_process(pid: u32, name: &str) -> bool {
    if pid <= 4 {
        return true;
    }
    is_critical_process_name(name)
}

/// Kiểm tra trạng thái Efficiency Mode (EcoQoS) của tiến trình trên Windows 11
pub fn check_eco_mode(pid: u32) -> bool {
    let handle = match unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) } {
        Ok(h) => h,
        Err(_) => return false,
    };

    let mut state = PROCESS_POWER_THROTTLING_STATE {
        Version: PROCESS_POWER_THROTTLING_CURRENT_VERSION,
        ControlMask: 0,
        StateMask: 0,
    };

    let result = unsafe {
        GetProcessInformation(
            handle,
            ProcessPowerThrottling,
            &mut state as *mut _ as *mut c_void,
            std::mem::size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32,
        )
    };

    let _ = unsafe { CloseHandle(handle) };

    if result.is_ok() {
        (state.StateMask & PROCESS_POWER_THROTTLING_EXECUTION_SPEED) != 0
    } else {
        false
    }
}

/// Tra cứu tên của một tiến trình theo PID
fn get_process_name_by_pid(pid: u32) -> Option<String> {
    let mut sys = System::new();
    sys.refresh_processes();
    sys.processes()
        .get(&Pid::from_u32(pid))
        .map(|p| p.name().to_string())
}

/// Lấy danh sách tiến trình đang chạy kèm thông số CPU, RAM, trạng thái Critical và Eco Mode
pub fn get_process_list() -> AppResult<Vec<ProcessInfo>> {
    let mut sys = System::new();
    sys.refresh_processes();

    let mut list = Vec::new();

    for (pid, proc) in sys.processes() {
        let pid_u32 = pid.as_u32();
        let name = proc.name().to_string();
        let is_crit = is_critical_process(pid_u32, &name);
        let mem = proc.memory();
        let cpu = proc.cpu_usage();
        let is_eco = if !is_crit {
            check_eco_mode(pid_u32)
        } else {
            false
        };

        list.push(ProcessInfo {
            pid: pid_u32,
            name,
            cpu_usage: cpu,
            memory_bytes: mem,
            is_critical: is_crit,
            is_eco_mode: is_eco,
        });
    }

    // Sắp xếp giảm dần theo mức chiếm dụng RAM để dễ phân tích
    list.sort_by_key(|p| std::cmp::Reverse(p.memory_bytes));

    Ok(list)
}

/// Áp dụng hoặc hủy kích hoạt Windows 11 Efficiency Mode (EcoQoS) cho tiến trình qua SetProcessInformation
pub fn apply_process_eco_mode(pid: u32, enable: bool) -> AppResult<bool> {
    // 1. Kiểm tra Critical Lock
    if pid <= 4 {
        return Err(AppError::PermissionDenied(
            "Tiến trình hệ thống quan trọng được bảo vệ tuyệt đối (System Process).".to_string(),
        ));
    }

    if let Some(name) = get_process_name_by_pid(pid) {
        if is_critical_process_name(&name) {
            return Err(AppError::PermissionDenied(format!(
                "Tiến trình hệ thống quan trọng '{}' (PID: {}) được bảo vệ tuyệt đối theo chính sách Zero-Harm.",
                name, pid
            )));
        }
    }

    // 2. Mở handle tiến trình với quyền PROCESS_SET_INFORMATION
    let handle = unsafe {
        OpenProcess(
            PROCESS_SET_INFORMATION | PROCESS_QUERY_LIMITED_INFORMATION,
            false,
            pid,
        )
    }
    .map_err(|e| {
        AppError::SystemError(format!("Không thể mở tiến trình PID {}: {}", pid, e))
    })?;

    let state = PROCESS_POWER_THROTTLING_STATE {
        Version: PROCESS_POWER_THROTTLING_CURRENT_VERSION,
        ControlMask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
        StateMask: if enable {
            PROCESS_POWER_THROTTLING_EXECUTION_SPEED
        } else {
            0
        },
    };

    let res = unsafe {
        SetProcessInformation(
            handle,
            ProcessPowerThrottling,
            &state as *const _ as *const c_void,
            std::mem::size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32,
        )
    };

    let _ = unsafe { CloseHandle(handle) };

    res.map_err(|e| {
        AppError::SystemError(format!(
            "Lỗi thiết lập chế độ EcoQoS cho tiến trình PID {}: {}",
            pid, e
        ))
    })?;

    info!(
        "Đã {} chế độ EcoQoS (Efficiency Mode) cho PID {}",
        if enable { "bật" } else { "tắt" },
        pid
    );

    Ok(true)
}

/// Tối ưu Working Set của tiến trình: Giải phóng các trang RAM không hoạt động về Paging Cache một cách an toàn
pub fn optimize_working_set(pid: u32) -> AppResult<bool> {
    if pid <= 4 {
        return Err(AppError::PermissionDenied(
            "Không được can thiệp bộ nhớ của tiến trình hệ thống lõi.".to_string(),
        ));
    }

    if let Some(name) = get_process_name_by_pid(pid) {
        if is_critical_process_name(&name) {
            return Err(AppError::PermissionDenied(format!(
                "Tiến trình '{}' nằm trong danh sách cấm tối ưu để đảm bảo tính ổn định.",
                name
            )));
        }
    }

    let handle = unsafe {
        OpenProcess(
            PROCESS_SET_QUOTA | PROCESS_QUERY_LIMITED_INFORMATION,
            false,
            pid,
        )
    }
    .map_err(|e| {
        AppError::SystemError(format!("Không thể mở tiến trình PID {}: {}", pid, e))
    })?;

    // Gọi SetProcessWorkingSetSize với (usize::MAX, usize::MAX) yêu cầu Windows dọn dẹp working set
    let res = unsafe { SetProcessWorkingSetSize(handle, usize::MAX, usize::MAX) };
    let _ = unsafe { CloseHandle(handle) };

    res.map_err(|e| {
        AppError::SystemError(format!(
            "Không thể giải phóng Working Set của PID {}: {}",
            pid, e
        ))
    })?;

    info!("Đã dọn dẹp Working Set của PID {} thành công", pid);
    Ok(true)
}

/// Đóng tiến trình an toàn qua OpenProcess và TerminateProcess, có cơ chế CRITICAL LOCK bảo vệ hệ thống
pub fn kill_process(pid: u32) -> AppResult<bool> {
    if pid <= 4 {
        return Err(AppError::PermissionDenied(
            "Tiến trình hệ thống quan trọng được bảo vệ tuyệt đối.".to_string(),
        ));
    }

    if let Some(name) = get_process_name_by_pid(pid) {
        if is_critical_process_name(&name) {
            return Err(AppError::PermissionDenied(format!(
                "Tiến trình hệ thống quan trọng '{}' (PID: {}) được bảo vệ tuyệt đối.",
                name, pid
            )));
        }
    }

    let handle = unsafe { OpenProcess(PROCESS_TERMINATE, false, pid) }.map_err(|e| {
        AppError::SystemError(format!("Không thể mở tiến trình PID {} để đóng: {}", pid, e))
    })?;

    let res = unsafe { TerminateProcess(handle, 1) };
    let _ = unsafe { CloseHandle(handle) };

    res.map_err(|e| {
        AppError::SystemError(format!(
            "Không thể đóng tiến trình PID {}: {}",
            pid, e
        ))
    })?;

    info!("Đã đóng tiến trình PID {}", pid);
    Ok(true)
}

/// Đóng toàn bộ cây tiến trình (Process Tree): Tìm tất cả các tiến trình con và đóng theo thứ tự an toàn
pub fn kill_process_tree(root_pid: u32) -> AppResult<bool> {
    if root_pid <= 4 {
        return Err(AppError::PermissionDenied(
            "Tiến trình hệ thống quan trọng được bảo vệ tuyệt đối.".to_string(),
        ));
    }

    let mut sys = System::new();
    sys.refresh_processes();

    // 1. Tìm tất cả các tiến trình con theo dạng BFS
    let mut targets_to_kill = Vec::new();
    let mut queue = vec![Pid::from_u32(root_pid)];
    targets_to_kill.push(root_pid);

    while let Some(current_pid) = queue.pop() {
        for (p_pid, p_proc) in sys.processes() {
            if p_proc.parent() == Some(current_pid) {
                let child_u32 = p_pid.as_u32();
                if !targets_to_kill.contains(&child_u32) {
                    targets_to_kill.push(child_u32);
                    queue.push(*p_pid);
                }
            }
        }
    }

    // 2. Thẩm định an toàn: Nếu BẤT KỲ tiến trình nào trong danh sách là Critical, HỦY TOÀN BỘ thao tác
    for &pid in &targets_to_kill {
        if pid <= 4 {
            return Err(AppError::PermissionDenied(
                "Phát hiện tiến trình hệ thống lõi trong cây tiến trình. Hủy thao tác.".to_string(),
            ));
        }

        if let Some(proc) = sys.processes().get(&Pid::from_u32(pid)) {
            let name = proc.name();
            if is_critical_process_name(name) {
                return Err(AppError::PermissionDenied(format!(
                    "Không thể dừng cây tiến trình vì chứa tiến trình hệ thống quan trọng '{}' (PID: {}).",
                    name, pid
                )));
            }
        }
    }

    // 3. Đóng tiến trình theo thứ tự ngược lại (con trước, cha sau)
    targets_to_kill.reverse();
    for &pid in &targets_to_kill {
        let _ = kill_process(pid);
    }

    info!(
        "Đã hoàn thành đóng cây tiến trình cho root PID {} (tổng cộng {} tiến trình)",
        root_pid,
        targets_to_kill.len()
    );

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_critical_process_lock() {
        assert!(is_critical_process_name("csrss.exe"));
        assert!(is_critical_process_name("explorer.exe"));
        assert!(is_critical_process_name("dwm.exe"));
        assert!(is_critical_process_name("services.exe"));
        assert!(is_critical_process_name("lsass.exe"));
        assert!(is_critical_process_name("smss.exe"));
        assert!(is_critical_process_name("wininit.exe"));
        assert!(is_critical_process_name("EXPLORER.EXE")); // Case insensitive

        // Ứng dụng bình thường không phải critical
        assert!(!is_critical_process_name("chrome.exe"));
        assert!(!is_critical_process_name("notepad.exe"));
        assert!(!is_critical_process_name("discord.exe"));
    }

    #[test]
    fn test_kill_process_blocks_critical() {
        // PID 4 (System)
        let res = kill_process(4);
        assert!(res.is_err());
        match res {
            Err(AppError::PermissionDenied(msg)) => {
                assert!(msg.contains("quan trọng được bảo vệ tuyệt đối"));
            }
            _ => panic!("Phải trả về PermissionDenied"),
        }

        // PID 0 (Idle)
        let res_idle = kill_process(0);
        assert!(res_idle.is_err());
    }

    #[test]
    fn test_critical_lock_blocks_live_system_processes() {
        // Quét tìm explorer.exe và dwm.exe trên hệ thống thực tế
        let mut sys = System::new();
        sys.refresh_processes();

        let mut target_pids = Vec::new();
        for (pid, proc) in sys.processes() {
            let name = proc.name().to_lowercase();
            if name == "explorer.exe" || name == "dwm.exe" || name == "services.exe" || name == "lsass.exe" {
                target_pids.push((pid.as_u32(), name));
            }
        }

        // Đảm bảo tìm thấy ít nhất 1 tiến trình hệ thống quan trọng đang chạy (như explorer hoặc dwm)
        assert!(!target_pids.is_empty(), "Hệ thống Windows đang chạy phải có ít nhất explorer/dwm/services");

        for (pid, name) in target_pids {
            info!("Kiểm thử CRITICAL LOCK với tiến trình sống: '{}' (PID: {})", name, pid);

            // 1. Thử kill tiến trình -> BẮT BUỘC BỊ TỪ CHỐI
            let kill_res = kill_process(pid);
            assert!(kill_res.is_err(), "Kill '{}' (PID {}) không được phép thành công!", name, pid);
            match kill_res {
                Err(AppError::PermissionDenied(msg)) => {
                    assert!(msg.contains("được bảo vệ tuyệt đối"));
                }
                _ => panic!("Phải trả về PermissionDenied cho '{}'", name),
            }

            // 2. Thử bật EcoQoS -> BẮT BUỘC BỊ TỪ CHỐI
            let eco_res = apply_process_eco_mode(pid, true);
            assert!(eco_res.is_err(), "Eco-mode cho '{}' (PID {}) không được phép thành công!", name, pid);
            match eco_res {
                Err(AppError::PermissionDenied(msg)) => {
                    assert!(msg.contains("được bảo vệ tuyệt đối theo chính sách Zero-Harm"));
                }
                _ => panic!("Phải trả về PermissionDenied khi bật Eco mode cho '{}'", name),
            }

            // 3. Thử tối ưu Working Set -> BẮT BUỘC BỊ TỪ CHỐI
            let opt_res = optimize_working_set(pid);
            assert!(opt_res.is_err(), "Tối ưu Working Set cho '{}' (PID {}) không được phép thành công!", name, pid);
            match opt_res {
                Err(AppError::PermissionDenied(msg)) => {
                    assert!(msg.contains("nằm trong danh sách cấm tối ưu"));
                }
                _ => panic!("Phải trả về PermissionDenied khi tối ưu Working Set cho '{}'", name),
            }

            // 4. Thử dừng cây tiến trình -> BẮT BUỘC BỊ TỪ CHỐI
            let tree_res = kill_process_tree(pid);
            assert!(tree_res.is_err(), "Kill tree cho '{}' (PID {}) không được phép thành công!", name, pid);
            match tree_res {
                Err(AppError::PermissionDenied(msg)) => {
                    assert!(msg.contains("tiến trình hệ thống quan trọng"));
                }
                _ => panic!("Phải trả về PermissionDenied khi kill tree cho '{}'", name),
            }
        }
    }

    #[test]
    fn test_get_process_list_works() {
        let list_res = get_process_list();
        assert!(list_res.is_ok());
        if let Ok(list) = list_res {
            assert!(!list.is_empty());
            // Có ít nhất 1 tiến trình và danh sách được sắp xếp theo RAM giảm dần
            if list.len() >= 2 {
                assert!(list[0].memory_bytes >= list[1].memory_bytes);
            }
        }
    }
}
