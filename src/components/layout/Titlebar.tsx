import React, { useState, useEffect } from "react";
import { 
  Activity, 
  Minus, 
  Square, 
  Copy, 
  X, 
  ShieldCheck 
} from "lucide-react";
import { isTauriContext } from "@/hooks/useHardwareMetrics";

interface TitlebarProps {
  onNotify?: (msg: string) => void;
}

export const Titlebar: React.FC<TitlebarProps> = ({ onNotify }) => {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    async function checkInitialMaximized() {
      if (isTauriContext()) {
        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          const appWindow = getCurrentWindow();
          const maximized = await appWindow.isMaximized();
          setIsMaximized(maximized);

          // Listen for resize/maximize changes
          unlisten = await appWindow.onResized(async () => {
            const isNowMax = await appWindow.isMaximized();
            setIsMaximized(isNowMax);
          });
        } catch (err) {
          console.warn("Titlebar window init error:", err);
        }
      }
    }

    checkInitialMaximized();

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleMinimize = async () => {
    if (isTauriContext()) {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().minimize();
        return;
      } catch (err) {
        console.warn("Tauri minimize error, trying invoke:", err);
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("window_minimize");
          return;
        } catch (invokeErr) {
          console.error("Invoke window_minimize failed:", invokeErr);
        }
      }
    }
    onNotify?.("🖥️ [Mô phỏng] Đã thu nhỏ cửa sổ ứng dụng xuống Taskbar");
  };

  const handleToggleMaximize = async () => {
    if (isTauriContext()) {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const appWindow = getCurrentWindow();
        await appWindow.toggleMaximize();
        const nextState = await appWindow.isMaximized();
        setIsMaximized(nextState);
        return;
      } catch (err) {
        console.warn("Tauri toggleMaximize error, trying invoke:", err);
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("window_maximize");
          setIsMaximized((prev) => !prev);
          return;
        } catch (invokeErr) {
          console.error("Invoke window_maximize failed:", invokeErr);
        }
      }
    }
    setIsMaximized((prev) => !prev);
    onNotify?.(
      !isMaximized
        ? "🖥️ [Mô phỏng] Đã phóng to toàn màn hình"
        : "🖥️ [Mô phỏng] Đã khôi phục kích thước cửa sổ"
    );
  };

  const handleClose = async () => {
    if (isTauriContext()) {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().close();
        return;
      } catch (err) {
        console.warn("Tauri close error, trying invoke:", err);
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("window_close");
          return;
        } catch (invokeErr) {
          console.error("Invoke window_close failed:", invokeErr);
        }
      }
    }
    onNotify?.("🖥️ [Mô phỏng] Đã nhận lệnh đóng cửa sổ (Sẽ ẩn xuống Tray nếu bật)");
  };

  return (
    <div
      data-tauri-drag-region
      className="h-9 shrink-0 w-full bg-surface-950/95 border-b border-white/[0.07] backdrop-blur-2xl flex items-center justify-between select-none z-[100] sticky top-0 px-3 transition-colors duration-200"
    >
      {/* Left: Brand Identity & Drag Region */}
      <div data-tauri-drag-region className="flex items-center gap-2.5 flex-1 h-full">
        <div className="relative flex items-center justify-center w-5 h-5 rounded-md bg-gradient-to-tr from-cyan-500/25 via-blue-500/20 to-violet-500/10 border border-cyan-500/40 shadow-glow-cyan pointer-events-none">
          <Activity className="w-3 h-3 text-cyan-400" />
        </div>

        <div className="flex items-center gap-2 pointer-events-none">
          <span className="font-display font-bold text-xs tracking-tight text-white flex items-center gap-1">
            <span>WinPulse</span>
            <span className="text-cyan-400 font-semibold">Optimizer</span>
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-surface-850 border border-white/[0.08] text-slate-400">
            v1.0.0
          </span>
        </div>

        {/* Protection Badge */}
        <div className="hidden sm:flex items-center gap-1.5 ml-3 px-2 py-0.5 whitespace-nowrap rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-[10px] font-medium pointer-events-none">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
          </span>
          <ShieldCheck className="w-3 h-3 text-emerald-400" />
          <span>Shield: Zero-Harm Active</span>
        </div>
      </div>

      {/* Middle Drag Spacer */}
      <div data-tauri-drag-region className="h-full flex-1" />

      {/* Right: Window Controls */}
      <div className="flex items-center h-full -mr-3">
        {/* Minimize Button */}
        <button
          onClick={handleMinimize}
          className="h-full w-11 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors focus:outline-none"
          title="Thu nhỏ (Minimize)"
          aria-label="Thu nhỏ"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>

        {/* Maximize / Restore Button */}
        <button
          onClick={handleToggleMaximize}
          className="h-full w-11 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors focus:outline-none"
          title={isMaximized ? "Khôi phục (Restore)" : "Phóng to (Maximize)"}
          aria-label={isMaximized ? "Khôi phục kích thước" : "Phóng to"}
        >
          {isMaximized ? (
            <Copy className="w-3 h-3 rotate-180" />
          ) : (
            <Square className="w-3 h-3" />
          )}
        </button>

        {/* Close Button */}
        <button
          onClick={handleClose}
          className="h-full w-11 flex items-center justify-center text-slate-400 hover:text-white hover:bg-rose-600 transition-colors focus:outline-none"
          title="Đóng (Close)"
          aria-label="Đóng"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
