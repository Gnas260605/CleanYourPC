import { useState, useEffect } from "react";
import { Titlebar } from "./components/layout/Titlebar";
import { Header } from "./components/layout/Header";
import { Navbar } from "./components/layout/Navbar";
import { DashboardPage } from "./components/dashboard/DashboardPage";
import { StartupManager } from "./components/startup/StartupManager";
import { ProcessGuardian } from "./components/process/ProcessGuardian";
import { SafeCleaner } from "./components/cleaner/SafeCleaner";
import { ServicesOptimizer } from "./components/services/ServicesOptimizer";
import { DiskAnalyzer } from "./components/analyzer/DiskAnalyzer";
import { SettingsModal } from "./components/settings/SettingsModal";
import { HistoryModal } from "./components/history/HistoryModal";
import { useHardwareMetrics, isTauriContext } from "./hooks/useHardwareMetrics";
import { useNavBadges } from "./hooks/useNavBadges";
import { ActiveTab, AppSettings } from "./types";
import { ToastStack, useToasts } from "./components/common/ToastStack";

const DEFAULT_SETTINGS: AppSettings = {
  auto_start_on_boot: false,
  minimize_to_tray: true,
  poll_interval_ms: 1500,
  visual_effects: true,
};

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("dashboard");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  // Load initial settings
  useEffect(() => {
    async function loadSettings() {
      if (isTauriContext()) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const s = await invoke<AppSettings>("get_app_settings");
          if (s) {
            setSettings(s);
            return;
          }
        } catch (err) {
          console.warn("Lỗi load get_app_settings tại App:", err);
        }
      }

      try {
        const stored = localStorage.getItem("winpulse_app_settings");
        if (stored) {
          setSettings(JSON.parse(stored));
        }
      } catch (e) {
        console.error("Local storage error:", e);
      }
    }

    loadSettings();
  }, []);

  const {
    metrics,
    status: metricsStatus,
    isHighLoadSim,
    toggleHighLoadSimulation,
    retry: retryMetrics,
  } = useHardwareMetrics(settings.poll_interval_ms);

  const badges = useNavBadges();

  const { toasts, notify: showNotification, dismiss: dismissToast } = useToasts();

  return (
    <div className="h-screen max-h-screen w-full flex flex-col bg-surface-950 text-slate-100 cyber-bg subtle-grid selection:bg-cyan-500/30 selection:text-white overflow-hidden">
      {/* 1. Custom Frameless Titlebar with Window Controls */}
      <Titlebar onNotify={showNotification} />

      {/* 2. Application Action Header */}
      <Header
        uptimeSeconds={metrics.system.uptimeSeconds}
        status={metricsStatus}
        isHighLoadSim={isHighLoadSim}
        onToggleHighLoad={toggleHighLoadSimulation}
        onNotify={showNotification}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenHistory={() => setIsHistoryOpen(true)}
      />

      {/* 3. Thanh điều hướng (ngang) / sidebar (≥ 1024px) + nội dung */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        <Navbar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          startupCount={badges.startupCount}
          junkBytes={badges.junkBytes}
          heavyProcessCount={badges.heavyProcessCount}
        />

        {/* 4. Main Content Area */}
        <main className="flex-1 min-h-0 min-w-0 w-full p-4 sm:p-6 lg:p-8 overflow-y-auto">
          <div className="max-w-7xl mx-auto">
            {activeTab === "dashboard" && metricsStatus === "offline" && (
              <div className="mb-6 p-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-rose-200">
                <span>
                  Không kết nối được backend đo phần cứng. Số liệu bên dưới chưa phải dữ liệu thật — hãy chạy WinPulse bằng
                  ứng dụng desktop.
                </span>
                <button
                  onClick={retryMetrics}
                  className="px-3 py-1.5 rounded-lg bg-surface-850 text-slate-100 border border-white/[0.08] hover:bg-surface-800 shrink-0"
                >
                  Thử lại
                </button>
              </div>
            )}

            {activeTab === "dashboard" && (
              <DashboardPage
                metrics={metrics}
                hasData={metricsStatus === "live" || metricsStatus === "mock"}
                onBoostNotification={showNotification}
                visualEffectsEnabled={settings.visual_effects}
              />
            )}

            {activeTab === "startup" && (
              <StartupManager onNotify={showNotification} onItemsChange={badges.onStartupItemsChange} />
            )}

            {activeTab === "process" && (
              <ProcessGuardian onNotify={showNotification} onProcessesChange={badges.onProcessesChange} />
            )}

            {activeTab === "cleaner" && (
              <SafeCleaner onNotify={showNotification} onScanComplete={badges.onJunkScanned} />
            )}

            {/* Giữ Disk Analyzer luôn mount để phiên quét đang chạy không mất kết quả khi chuyển tab */}
            <div hidden={activeTab !== "analyzer"}>
              <DiskAnalyzer onNotify={showNotification} />
            </div>

            {activeTab === "services" && (
              <ServicesOptimizer onNotify={showNotification} />
            )}
          </div>
        </main>
      </div>

      {/* 5. Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onNotify={showNotification}
        onSettingsSaved={(newSettings) => setSettings(newSettings)}
      />

      {/* 6. Optimization History Modal */}
      <HistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        onNotify={showNotification}
      />

      {/* Hàng đợi thông báo */}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {/* Footer Status Bar */}
      <footer className="h-9 shrink-0 border-t border-white/[0.05] bg-surface-950/90 px-6 flex items-center justify-between text-[11px] text-slate-400 select-none">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-glow-emerald" />
            <span>Zero-Harm Shield: Active</span>
          </span>
          <span className="text-slate-700">|</span>
          <span className="text-slate-400">Offline Local IPC • No Telemetry</span>
        </div>

        <div className="font-mono text-slate-400">
          WinPulse Optimizer v1.0.0 • Rust + Tauri v2 + React 18
        </div>
      </footer>
    </div>
  );
}

export default App;
