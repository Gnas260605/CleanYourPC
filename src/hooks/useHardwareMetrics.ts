import { useState, useEffect, useRef } from "react";
import { HardwareMetrics, BackendHardwareMetrics } from "../types";

// Helper to check if Tauri runtime is available
export function isTauriContext(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
  );
}

// Chuyển đổi an toàn từ cấu trúc dữ liệu phẳng của Rust Backend sang giao diện phân tầng của Frontend
export function mapBackendMetricsToFrontend(
  raw: BackendHardwareMetrics,
  prevMetrics?: HardwareMetrics
): HardwareMetrics {
  const primaryDisk = raw.disks && raw.disks.length > 0 ? raw.disks[0] : null;

  return {
    cpu: {
      usage: Number(raw.cpu_usage_total.toFixed(1)),
      temperature:
        prevMetrics?.cpu.temperature ??
        Math.round(45 + (raw.cpu_usage_total / 100) * 32),
      cores: raw.cpu_core_count || 8,
      threads: (raw.cpu_core_count || 8) * 2,
      model: raw.cpu_name || "Intel(R) / AMD Processor",
      frequencyGhz: Number(((raw.cpu_frequency_mhz || 3200) / 1000).toFixed(2)),
    },
    ram: {
      usedBytes: raw.ram_used_bytes,
      totalBytes: raw.ram_total_bytes,
      availableBytes: raw.ram_available_bytes,
      usagePercent: Number(raw.ram_usage_percent.toFixed(1)),
      speedMhz: prevMetrics?.ram.speedMhz ?? 4800,
    },
    disk: {
      readBytesPerSec: Math.floor(raw.disk_read_mbps * 1024 * 1024),
      writeBytesPerSec: Math.floor(raw.disk_write_mbps * 1024 * 1024),
      totalSpaceBytes: primaryDisk
        ? primaryDisk.total_bytes
        : 1024 * 1024 * 1024 * 1024,
      usedSpaceBytes: primaryDisk
        ? primaryDisk.used_bytes
        : 420 * 1024 * 1024 * 1024,
      usagePercent: primaryDisk
        ? Number(primaryDisk.usage_percent.toFixed(1))
        : 41.0,
      driveLetter: primaryDisk ? primaryDisk.mount_point : "C:",
    },
    network: {
      downloadBytesPerSec: Math.floor(raw.net_download_kbps * 1024),
      uploadBytesPerSec: Math.floor(raw.net_upload_kbps * 1024),
      adapterName:
        prevMetrics?.network.adapterName ?? "Ethernet / Wi-Fi Network",
      pingMs: prevMetrics?.network.pingMs ?? 18,
    },
    system: {
      os: prevMetrics?.system.os ?? "Windows 11 64-bit",
      build: prevMetrics?.system.build ?? "22631",
      uptimeSeconds: raw.uptime_seconds,
      hostname: prevMetrics?.system.hostname ?? "WinPulse-PC",
      architecture: "x86_64",
    },
    timestamp: raw.timestamp ? raw.timestamp * 1000 : Date.now(),
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

export function useHardwareMetrics(pollIntervalMs: number = 1000) {
  const [metrics, setMetrics] = useState<HardwareMetrics>(() =>
    generateMockMetrics()
  );
  const [isLiveTauri, setIsLiveTauri] = useState<boolean>(false);
  const [isHighLoadSim, setIsHighLoadSim] = useState<boolean>(false);
  const metricsRef = useRef<HardwareMetrics>(metrics);

  useEffect(() => {
    metricsRef.current = metrics;
  }, [metrics]);

  useEffect(() => {
    let isMounted = true;
    let unlistenFn: (() => void) | null = null;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;

    async function initMetricsConnection() {
      if (isTauriContext()) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const { listen } = await import("@tauri-apps/api/event");

          // 1. Initial snapshot fetch via invoke
          try {
            const initialData = await invoke<BackendHardwareMetrics>(
              "get_hardware_metrics"
            );
            if (isMounted && initialData) {
              setMetrics(mapBackendMetricsToFrontend(initialData, metricsRef.current));
              setIsLiveTauri(true);
            }
          } catch (invokeErr) {
            console.warn("Initial get_hardware_metrics call:", invokeErr);
          }

          // 2. Subscribe to background emitted event 'hardware-metrics'
          const unlisten = await listen<BackendHardwareMetrics>(
            "hardware-metrics",
            (event) => {
              if (isMounted && event.payload) {
                setMetrics(mapBackendMetricsToFrontend(event.payload, metricsRef.current));
                setIsLiveTauri(true);
              }
            }
          );

          if (isMounted) {
            unlistenFn = unlisten;
            return;
          } else {
            unlisten();
          }
        } catch (err) {
          console.warn("Tauri event listen initialization failed, falling back to simulation:", err);
          if (isMounted) setIsLiveTauri(false);
        }
      }

      // Fallback: Khi chạy trong trình duyệt (Chrome/Edge trên localhost:1420),
      // kết nối trực tiếp với Local Hardware HTTP Bridge (cổng 1421) để đọc dữ liệu thật từ Windows API!
      async function pollLocalHttp(): Promise<boolean> {
        try {
          const res = await fetch("http://127.0.0.1:1421/api/metrics");
          if (res.ok) {
            const data: BackendHardwareMetrics = await res.json();
            if (isMounted && data) {
              setMetrics(mapBackendMetricsToFrontend(data, metricsRef.current));
              setIsLiveTauri(true);
              return true;
            }
          }
        } catch (_) {
          // Local bridge chưa khởi động hoặc không khả dụng
        }
        return false;
      }

      // Initial HTTP attempt
      const connected = await pollLocalHttp();
      if (!connected && isMounted) {
        setIsLiveTauri(false);
      }

      if (isMounted) {
        fallbackTimer = setInterval(async () => {
          if (!isMounted) return;
          const ok = await pollLocalHttp();
          if (!ok && isMounted) {
            setIsLiveTauri(false);
            setMetrics((prev) => generateMockMetrics(prev, isHighLoadSim));
          }
        }, pollIntervalMs);
      }
    }

    initMetricsConnection();

    return () => {
      isMounted = false;
      if (unlistenFn) {
        unlistenFn();
      }
      if (fallbackTimer) {
        clearInterval(fallbackTimer);
      }
    };
  }, [pollIntervalMs, isHighLoadSim]);

  const toggleHighLoadSimulation = () => {
    setIsHighLoadSim((v) => !v);
  };

  return {
    metrics,
    isLiveTauri,
    isHighLoadSim,
    toggleHighLoadSimulation,
  };
}
