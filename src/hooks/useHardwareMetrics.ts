import { useState, useEffect, useRef } from "react";
import { HardwareMetrics, BackendHardwareMetrics } from "../types";

// Helper to check if Tauri runtime is available
export function isTauriContext(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
  );
}

/** Dữ liệu giả lập chỉ được bật khi chạy `npm run dev`; bản release không bao giờ hiển thị số liệu giả */
export const MOCK_METRICS_ENABLED = import.meta.env.DEV;

/** Trạng thái kết nối tới backend đo phần cứng */
export type MetricsStatus = "connecting" | "live" | "mock" | "offline";

/** Thông tin hệ điều hành thật từ lệnh get_system_info (src-tauri/src/metrics.rs) */
export interface BackendSystemInfo {
  os_name: string;
  os_version: string;
  kernel_version: string;
  host_name: string;
}

// Chuyển đổi an toàn từ cấu trúc dữ liệu phẳng của Rust Backend sang giao diện phân tầng của Frontend.
// Không bịa số liệu: giá trị backend không cung cấp (nhiệt độ, tốc độ RAM, ping) để trống.
export function mapBackendMetricsToFrontend(
  raw: BackendHardwareMetrics,
  sysInfo?: BackendSystemInfo | null
): HardwareMetrics {
  const primaryDisk = raw.disks && raw.disks.length > 0 ? raw.disks[0] : null;

  return {
    cpu: {
      usage: Number(raw.cpu_usage_total.toFixed(1)),
      temperature: undefined,
      cores: raw.cpu_core_count,
      threads: raw.cpu_core_count,
      model: raw.cpu_name || "CPU",
      frequencyGhz: Number((raw.cpu_frequency_mhz / 1000).toFixed(2)),
    },
    ram: {
      usedBytes: raw.ram_used_bytes,
      totalBytes: raw.ram_total_bytes,
      availableBytes: raw.ram_available_bytes,
      usagePercent: Number(raw.ram_usage_percent.toFixed(1)),
      speedMhz: undefined,
    },
    disk: {
      readBytesPerSec: Math.floor(raw.disk_read_mbps * 1024 * 1024),
      writeBytesPerSec: Math.floor(raw.disk_write_mbps * 1024 * 1024),
      totalSpaceBytes: primaryDisk ? primaryDisk.total_bytes : 0,
      usedSpaceBytes: primaryDisk ? primaryDisk.used_bytes : 0,
      usagePercent: primaryDisk ? Number(primaryDisk.usage_percent.toFixed(1)) : 0,
      driveLetter: primaryDisk ? primaryDisk.mount_point : "—",
    },
    network: {
      downloadBytesPerSec: Math.floor(raw.net_download_kbps * 1024),
      uploadBytesPerSec: Math.floor(raw.net_upload_kbps * 1024),
      adapterName: "Tất cả bộ điều hợp mạng",
      pingMs: undefined,
    },
    system: {
      os: sysInfo ? `${sysInfo.os_name} ${sysInfo.os_version}`.trim() : "Windows",
      build: sysInfo?.kernel_version || "—",
      uptimeSeconds: raw.uptime_seconds,
      hostname: sysInfo?.host_name || "—",
      architecture: "x86_64",
    },
    timestamp: raw.timestamp ? raw.timestamp * 1000 : Date.now(),
  };
}

/** Số liệu rỗng dùng khi chưa kết nối được backend (bản release) */
export function emptyMetrics(): HardwareMetrics {
  return {
    cpu: { usage: 0, cores: 0, threads: 0, model: "—", frequencyGhz: 0 },
    ram: { usedBytes: 0, totalBytes: 0, availableBytes: 0, usagePercent: 0 },
    disk: {
      readBytesPerSec: 0,
      writeBytesPerSec: 0,
      totalSpaceBytes: 0,
      usedSpaceBytes: 0,
      usagePercent: 0,
      driveLetter: "—",
    },
    network: { downloadBytesPerSec: 0, uploadBytesPerSec: 0, adapterName: "—" },
    system: { os: "—", build: "—", uptimeSeconds: 0, hostname: "—", architecture: "x86_64" },
    timestamp: Date.now(),
  };
}

// Generate realistic mock metrics that smoothly oscillate
export function generateMockMetrics(
  prevMetrics?: HardwareMetrics,
  forceHighLoad: boolean = false
): HardwareMetrics {
  const baseCpu = forceHighLoad ? 82 : 24;
  const cpuJitter = (Math.random() - 0.48) * 6;
  const cpuUsage = Math.min(
    99,
    Math.max(
      8,
      Number(
        (
          (prevMetrics
            ? prevMetrics.cpu.usage * 0.75 + baseCpu * 0.25
            : baseCpu) + cpuJitter
        ).toFixed(1)
      )
    )
  );

  const totalRam = 32 * 1024 * 1024 * 1024; // 32 GB (31.7 GB physical)
  const ramUsagePercent = forceHighLoad
    ? 86
    : Math.min(
        75,
        Math.max(
          45,
          Number(
            (
              (prevMetrics
                ? prevMetrics.ram.usagePercent * 0.85 + 51 * 0.15
                : 51) +
              (Math.random() - 0.5) * 1.5
            ).toFixed(1)
          )
        )
      );
  const usedRam = Math.floor((ramUsagePercent / 100) * totalRam);

  const diskRead = Math.floor(
    Math.random() * 25 * 1024 * 1024 + 1.2 * 1024 * 1024
  ); // 1.2 - 26 MB/s
  const diskWrite = Math.floor(
    Math.random() * 15 * 1024 * 1024 + 400 * 1024
  ); // 400 KB - 15 MB/s

  const netDown = Math.floor(
    Math.random() * 3.5 * 1024 * 1024 + 250 * 1024
  ); // 250 KB - 3.7 MB/s
  const netUp = Math.floor(Math.random() * 850 * 1024 + 45 * 1024); // 45 KB - 900 KB/s

  const uptime = (prevMetrics?.system.uptimeSeconds ?? 45280) + 1;

  return {
    cpu: {
      usage: cpuUsage,
      temperature: Math.round(48 + (cpuUsage / 100) * 28),
      cores: 8,
      threads: 16,
      model: "11th Gen Intel(R) Core(TM) i7-11800H",
      frequencyGhz: 3.15,
    },
    ram: {
      usedBytes: usedRam,
      totalBytes: totalRam,
      availableBytes: totalRam - usedRam,
      usagePercent: ramUsagePercent,
      speedMhz: 4800,
    },
    disk: {
      readBytesPerSec: diskRead,
      writeBytesPerSec: diskWrite,
      totalSpaceBytes: 1024 * 1024 * 1024 * 1024, // 1 TB
      usedSpaceBytes: 420 * 1024 * 1024 * 1024, // 420 GB
      usagePercent: 41.0,
      driveLetter: "C:",
    },
    network: {
      downloadBytesPerSec: netDown,
      uploadBytesPerSec: netUp,
      adapterName: "Wi-Fi 6 (Intel AX201 160MHz)",
      pingMs: Math.floor(18 + Math.random() * 8),
    },
    system: {
      os: "Windows 11 Pro 64-bit",
      build: "22631.4317 (23H2)",
      uptimeSeconds: uptime,
      hostname: "WINPULSE-RIG",
      architecture: "x86_64",
    },
    timestamp: Date.now(),
  };
}

/** Thời gian chờ dữ liệu đầu tiên trước khi báo "Không kết nối được backend" */
const CONNECT_TIMEOUT_MS = 6000;

export function useHardwareMetrics(pollIntervalMs: number = 1000) {
  const [metrics, setMetrics] = useState<HardwareMetrics>(() =>
    MOCK_METRICS_ENABLED ? generateMockMetrics() : emptyMetrics()
  );
  const [status, setStatus] = useState<MetricsStatus>("connecting");
  const [isHighLoadSim, setIsHighLoadSim] = useState<boolean>(false);
  const [retryToken, setRetryToken] = useState(0);
  const sysInfoRef = useRef<BackendSystemInfo | null>(null);

  useEffect(() => {
    let isMounted = true;
    let unlistenFn: (() => void) | null = null;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;
    let gotData = false;

    const applyLive = (raw: BackendHardwareMetrics) => {
      if (!isMounted || !raw) return;
      gotData = true;
      setMetrics(mapBackendMetricsToFrontend(raw, sysInfoRef.current));
      setStatus("live");
    };

    // Không có dữ liệu sau CONNECT_TIMEOUT_MS → dev: giả lập; release: báo mất kết nối
    const connectTimer = setTimeout(() => {
      if (isMounted && !gotData) setStatus(MOCK_METRICS_ENABLED ? "mock" : "offline");
    }, CONNECT_TIMEOUT_MS);

    async function initMetricsConnection() {
      if (isTauriContext()) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const { listen } = await import("@tauri-apps/api/event");

          try {
            sysInfoRef.current = await invoke<BackendSystemInfo>("get_system_info");
          } catch (err) {
            console.warn("get_system_info lỗi:", err);
          }

          try {
            applyLive(await invoke<BackendHardwareMetrics>("get_hardware_metrics"));
          } catch (invokeErr) {
            console.warn("Initial get_hardware_metrics call:", invokeErr);
          }

          const unlisten = await listen<BackendHardwareMetrics>("hardware-metrics", (event) =>
            applyLive(event.payload)
          );
          if (isMounted) {
            unlistenFn = unlisten;
          } else {
            unlisten();
          }
        } catch (err) {
          console.warn("Không khởi tạo được kết nối metrics Tauri:", err);
          if (isMounted) setStatus("offline");
        }
        return;
      }

      // Chế độ trình duyệt (npm run dev): đọc HTTP server debug chỉ đọc (cổng 1421) nếu backend debug đang chạy
      async function pollLocalHttp(): Promise<boolean> {
        try {
          if (!sysInfoRef.current) {
            const sysRes = await fetch("http://127.0.0.1:1421/api/system");
            if (sysRes.ok) sysInfoRef.current = await sysRes.json();
          }
          const res = await fetch("http://127.0.0.1:1421/api/metrics");
          if (res.ok) {
            applyLive(await res.json());
            return true;
          }
        } catch (_) {
          // HTTP server debug chưa khởi động
        }
        return false;
      }

      await pollLocalHttp();
      if (!isMounted) return;
      fallbackTimer = setInterval(async () => {
        if (!isMounted) return;
        const ok = await pollLocalHttp();
        if (!ok && isMounted) {
          if (MOCK_METRICS_ENABLED) {
            setStatus("mock");
            setMetrics((prev) => generateMockMetrics(prev, isHighLoadSim));
          } else {
            setStatus("offline");
          }
        }
      }, pollIntervalMs);
    }

    initMetricsConnection();

    return () => {
      isMounted = false;
      clearTimeout(connectTimer);
      if (unlistenFn) unlistenFn();
      if (fallbackTimer) clearInterval(fallbackTimer);
    };
  }, [pollIntervalMs, isHighLoadSim, retryToken]);

  const toggleHighLoadSimulation = () => {
    if (MOCK_METRICS_ENABLED) setIsHighLoadSim((v) => !v);
  };

  const retry = () => {
    setStatus("connecting");
    setRetryToken((t) => t + 1);
  };

  return {
    metrics,
    status,
    isLiveTauri: status === "live",
    isHighLoadSim,
    toggleHighLoadSimulation,
    retry,
  };
}
