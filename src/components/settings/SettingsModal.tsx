import React, { useState, useEffect } from "react";
import { 
  X, 
  Settings, 
  ShieldCheck, 
  Check, 
  RotateCcw, 
  Save, 
  Cpu, 
  Monitor, 
  Bell, 
  Sparkles, 
  Info,
  Loader2,
  Lock
} from "lucide-react";
import { AppSettings } from "@/types";
import { isTauriContext } from "@/hooks/useHardwareMetrics";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNotify?: (msg: string) => void;
  onSettingsSaved?: (newSettings: AppSettings) => void;
}

const DEFAULT_SETTINGS: AppSettings = {
  auto_start_on_boot: false,
  minimize_to_tray: true,
  poll_interval_ms: 1500,
  visual_effects: true,
};

const LOCAL_STORAGE_KEY = "winpulse_app_settings";

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onNotify,
  onSettingsSaved,
}) => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [initialSettings, setInitialSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    if (!isOpen) return;

    async function fetchSettings() {
      setIsLoading(true);
      if (isTauriContext()) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const loaded = await invoke<AppSettings>("get_app_settings");
          if (loaded) {
            setSettings(loaded);
            setInitialSettings(loaded);
            setIsLoading(false);
            setHasChanges(false);
            return;
          }
        } catch (err) {
          console.warn("Lỗi đọc get_app_settings từ Tauri:", err);
        }
      }

      // Web dev fallback
      try {
        const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as AppSettings;
          setSettings(parsed);
          setInitialSettings(parsed);
        } else {
          setSettings(DEFAULT_SETTINGS);
          setInitialSettings(DEFAULT_SETTINGS);
        }
      } catch (e) {
        setSettings(DEFAULT_SETTINGS);
        setInitialSettings(DEFAULT_SETTINGS);
      }
      setIsLoading(false);
      setHasChanges(false);
    }

    fetchSettings();
  }, [isOpen]);

  const handleToggle = (key: keyof Pick<AppSettings, "auto_start_on_boot" | "minimize_to_tray" | "visual_effects">) => {
    setSettings((prev) => {
      const updated = { ...prev, [key]: !prev[key] };
      setHasChanges(JSON.stringify(updated) !== JSON.stringify(initialSettings));
      return updated;
    });
  };

  const handlePollIntervalChange = (ms: number) => {
    setSettings((prev) => {
      const updated = { ...prev, poll_interval_ms: ms };
      setHasChanges(JSON.stringify(updated) !== JSON.stringify(initialSettings));
      return updated;
    });
  };

  const handleResetDefaults = () => {
    setSettings(DEFAULT_SETTINGS);
    setHasChanges(JSON.stringify(DEFAULT_SETTINGS) !== JSON.stringify(initialSettings));
  };

  const handleSave = async () => {
    setIsSaving(true);
    if (isTauriContext()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const saved = await invoke<AppSettings>("save_app_settings", { settings });
        setIsSaving(false);
        setInitialSettings(saved || settings);
        setHasChanges(false);
        onNotify?.("⚙️ Đã lưu cấu hình ứng dụng thành công!");
        onSettingsSaved?.(saved || settings);
        onClose();
        return;
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        setIsSaving(false);
        onNotify?.(`Lỗi lưu cấu hình: ${errorMsg}`);
        return;
      }
    }

    // Web Fallback
    setTimeout(() => {
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(settings));
      } catch (e) {
        console.error("Local storage error:", e);
      }
      setIsSaving(false);
      setInitialSettings(settings);
      setHasChanges(false);
      onNotify?.("⚙️ [Mô phỏng] Đã lưu cấu hình ứng dụng thành công!");
      onSettingsSaved?.(settings);
      onClose();
    }, 400);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl rounded-2xl glass-panel border border-cyan-500/30 shadow-glow-cyan/30 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Glow ambient background element */}
        <div className="absolute -top-20 -right-20 w-72 h-72 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -left-20 w-72 h-72 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="p-5 border-b border-white/[0.08] flex items-center justify-between relative z-10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-400">
              <Settings className="w-5 h-5 animate-spin-slow" />
            </div>
            <div>
              <h2 className="font-display font-bold text-base sm:text-lg text-white">
                Cài Đặt Hệ Thống & Tùy Chọn
              </h2>
              <p className="text-xs text-slate-400">
                Tùy biến hành vi vận hành nền và trải nghiệm thị giác của WinPulse
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Đóng cài đặt"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 overflow-y-auto relative z-10">
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-400 text-xs">
              <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
              <span>Đang tải cấu hình hệ thống...</span>
            </div>
          ) : (
            <>
              {/* Option 1: Auto-start on Boot */}
              <div className="p-4 rounded-xl bg-surface-900/70 border border-white/[0.06] flex items-center justify-between gap-4 hover:border-white/[0.1] transition-all">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Monitor className="w-4 h-4 text-cyan-400" />
                    <span className="text-xs font-semibold text-slate-200">
                      Khởi động cùng Windows (Auto-start on boot)
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Tự động mở WinPulse ở chế độ nền khi đăng nhập Windows (ghi nhận an toàn vào Registry HKCU Run).
                  </p>
                </div>

                {/* Switch Toggle */}
                <button
                  type="button"
                  onClick={() => handleToggle("auto_start_on_boot")}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    settings.auto_start_on_boot ? "bg-cyan-500 shadow-glow-cyan" : "bg-surface-800"
                  }`}
                  role="switch"
                  aria-checked={settings.auto_start_on_boot}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                      settings.auto_start_on_boot ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* Option 2: Minimize to Tray on Close */}
              <div className="p-4 rounded-xl bg-surface-900/70 border border-white/[0.06] flex items-center justify-between gap-4 hover:border-white/[0.1] transition-all">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Bell className="w-4 h-4 text-violet-400" />
                    <span className="text-xs font-semibold text-slate-200">
                      Thu nhỏ vào khay hệ thống khi đóng (Minimize to tray)
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Khi bấm nút đóng [✕], ứng dụng sẽ tiếp tục chạy ẩn ở khay đồng hồ Taskbar để duy trì giám sát RAM.
                  </p>
                </div>

                {/* Switch Toggle */}
                <button
                  type="button"
                  onClick={() => handleToggle("minimize_to_tray")}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    settings.minimize_to_tray ? "bg-cyan-500 shadow-glow-cyan" : "bg-surface-800"
                  }`}
                  role="switch"
                  aria-checked={settings.minimize_to_tray}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                      settings.minimize_to_tray ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* Option 3: Visual Pulse Effects */}
              <div className="p-4 rounded-xl bg-surface-900/70 border border-white/[0.06] flex items-center justify-between gap-4 hover:border-white/[0.1] transition-all">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-semibold text-slate-200">
                      Hiệu ứng ánh sáng Visual Pulse (Cyber Delight)
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Bật tia quét laser điện trường, hiệu ứng sóng xung quanh các đồng hồ đo và viền phát sáng 60fps.
                  </p>
                </div>

                {/* Switch Toggle */}
                <button
                  type="button"
                  onClick={() => handleToggle("visual_effects")}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    settings.visual_effects ? "bg-cyan-500 shadow-glow-cyan" : "bg-surface-800"
                  }`}
                  role="switch"
                  aria-checked={settings.visual_effects}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                      settings.visual_effects ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* Option 4: Polling Interval Picker */}
              <div className="p-4 rounded-xl bg-surface-900/70 border border-white/[0.06] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-semibold text-slate-200">
                      Tần suất làm mới chỉ số phần cứng (Telemetry Frequency)
                    </span>
                  </div>
                  <span className="text-xs font-mono text-cyan-400 font-bold">
                    {(settings.poll_interval_ms / 1000).toFixed(1)}s
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Chu kỳ đọc CPU/RAM/Disk từ nhân hệ điều hành. Chu kỳ càng ngắn cập nhật càng tức thì.
                </p>

                {/* Segmented Buttons */}
                <div className="grid grid-cols-3 gap-2 pt-1">
                  {[
                    { label: "1.0s (Nhanh)", ms: 1000 },
                    { label: "1.5s (Khuyên dùng)", ms: 1500 },
                    { label: "3.0s (Tiết kiệm CPU)", ms: 3000 },
                  ].map((item) => (
                    <button
                      key={item.ms}
                      type="button"
                      onClick={() => handlePollIntervalChange(item.ms)}
                      className={`px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                        settings.poll_interval_ms === item.ms
                          ? "bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-300 border border-cyan-500/40 shadow-glow-cyan/20"
                          : "bg-surface-850 text-slate-400 hover:text-white border border-white/[0.04]"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Zero-Bloat Commitment Card */}
              <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-500/10 via-cyan-500/5 to-transparent border border-emerald-500/25 space-y-2">
                <div className="flex items-center gap-2 text-emerald-400 font-semibold text-xs">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Zero-Bloat & Zero-Telemetry Commitment</span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  WinPulse Optimizer cam kết 100% không thu thập dữ liệu người dùng, không gửi bất kỳ gói tin ra Internet, mã nguồn mở minh bạch, không cài cắm bất kỳ phần mềm tài trợ hay dịch vụ ẩn nào.
                </p>
                <div className="flex items-center gap-4 pt-1 text-[10px] font-mono text-slate-400">
                  <span className="flex items-center gap-1 text-emerald-300">
                    <Check className="w-3 h-3" /> Clean Windows Experience
                  </span>
                  <span className="flex items-center gap-1 text-cyan-300">
                    <Lock className="w-3 h-3" /> 100% Offline Local Engine
                  </span>
                </div>
              </div>

              {/* Version & License Card */}
              <div className="p-3.5 rounded-xl bg-surface-950/60 border border-white/[0.04] flex items-center justify-between text-xs">
                <div className="flex items-center gap-2.5">
                  <Info className="w-4 h-4 text-slate-400" />
                  <div>
                    <span className="font-semibold text-slate-200">WinPulse Optimizer v1.0.0</span>
                    <span className="text-[10px] text-slate-400 ml-2 font-mono">MIT License</span>
                  </div>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-surface-800 text-slate-400 border border-white/[0.05]">
                  Desktop Build
                </span>
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-5 border-t border-white/[0.08] bg-surface-950/80 flex items-center justify-between relative z-10 shrink-0">
          <button
            type="button"
            onClick={handleResetDefaults}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-white/[0.04] transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Mặc định</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-white/[0.04] transition-colors"
            >
              Hủy
            </button>

            <button
              type="button"
              disabled={isSaving || !hasChanges}
              onClick={handleSave}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold tracking-wide transition-all ${
                hasChanges && !isSaving
                  ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-glow-cyan hover:brightness-110 active:scale-95"
                  : "bg-surface-800 text-slate-400 cursor-not-allowed"
              }`}
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                  <span>Đang lưu...</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>Lưu Thay Đổi</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
