import { useCallback, useEffect, useState } from "react";
import { ProcessInfo, StartupItem } from "@/types";
import { fetchProcessList, fetchStartupList } from "@/services/apiBridge";

/** Ngưỡng "ngốn RAM" cho badge Process Guardian: tiến trình không cốt lõi dùng >= 1 GB */
export const HEAVY_PROCESS_BYTES = 1024 * 1024 * 1024;

export function countEnabledStartup(items: StartupItem[]): number {
  return items.filter((i) => i.enabled).length;
}

export function countHeavyProcesses(list: ProcessInfo[]): number {
  return list.filter((p) => !p.is_critical && p.memory_bytes >= HEAVY_PROCESS_BYTES).length;
}

/**
 * Số liệu thật cho badge trên Navbar. Giá trị `undefined` = chưa có dữ liệu → ẩn badge.
 * - Khởi động: số mục đang bật.
 * - Process: số tiến trình ngốn RAM.
 * - Dọn dẹp: tổng dung lượng của lần quét gần nhất (chỉ có sau khi đã quét).
 */
export function useNavBadges() {
  const [startupCount, setStartupCount] = useState<number | undefined>(undefined);
  const [heavyProcessCount, setHeavyProcessCount] = useState<number | undefined>(undefined);
  const [junkBytes, setJunkBytes] = useState<number | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetchStartupList()
      .then((items) => !cancelled && setStartupCount(countEnabledStartup(items)))
      .catch(() => undefined);
    fetchProcessList()
      .then((list) => !cancelled && setHeavyProcessCount(countHeavyProcesses(list)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const onStartupItemsChange = useCallback((items: StartupItem[]) => {
    setStartupCount(countEnabledStartup(items));
  }, []);

  const onProcessesChange = useCallback((list: ProcessInfo[]) => {
    setHeavyProcessCount(countHeavyProcesses(list));
  }, []);

  return {
    startupCount,
    heavyProcessCount,
    junkBytes,
    onStartupItemsChange,
    onProcessesChange,
    onJunkScanned: setJunkBytes,
  };
}
