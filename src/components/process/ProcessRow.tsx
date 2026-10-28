import React from "react";
import { Cpu, Leaf, Lock, PowerOff, ShieldCheck } from "lucide-react";
import { ProcessInfo } from "@/types";
import { formatBytes } from "@/utils/formatters";

interface ProcessRowProps {
  proc: ProcessInfo;
  onToggleEco: (proc: ProcessInfo) => void;
  onRequestKill: (proc: ProcessInfo) => void;
}

/** Một dòng tiến trình: thông tin + nút Eco-Mode + nút đóng (khóa với tiến trình cốt lõi) */
export const ProcessRow: React.FC<ProcessRowProps> = ({ proc, onToggleEco, onRequestKill }) => {
  const isCritical = proc.is_critical;
  const isEco = proc.is_eco_mode;

  return (
    <li className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-colors hover:bg-white/[0.02]">
      <div className="flex items-start gap-3.5 min-w-0">
        <div
          className={`p-2.5 rounded-xl shrink-0 mt-0.5 ${
            isCritical
              ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
              : isEco
              ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30"
              : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
          }`}
          aria-hidden="true"
        >
          {isCritical ? <Lock className="w-4 h-4" /> : <Cpu className="w-4 h-4" />}
        </div>

        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-slate-100">{proc.name}</span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-surface-950 border border-white/[0.06] text-slate-300">
              PID: {proc.pid}
            </span>
            {isCritical ? (
              <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" aria-hidden="true" />
                Cốt lõi Windows
              </span>
            ) : (
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                  isEco
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                    : "bg-cyan-500/10 text-cyan-300 border-cyan-500/20"
                }`}
              >
                {isEco ? "🌱 Eco-Mode" : "⚡ Đang chạy"}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-300 truncate max-w-lg">
            {proc.description || (isCritical ? "Tiến trình hệ thống Windows thiết yếu" : "Ứng dụng người dùng")}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4 shrink-0 self-end sm:self-center">
        <div className="text-right">
          <div className="font-mono text-sm font-bold text-white">{formatBytes(proc.memory_bytes)}</div>
          <div className="font-mono text-xs text-cyan-300">{proc.cpu_usage.toFixed(1)}% CPU</div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onToggleEco(proc)}
            disabled={isCritical}
            aria-pressed={isEco}
            aria-label={
              isCritical
                ? `${proc.name}: tiến trình cốt lõi, không áp dụng Eco-Mode`
                : `${isEco ? "Tắt" : "Bật"} Eco-Mode cho ${proc.name}`
            }
            title={isCritical ? "Tiến trình cốt lõi - Cấm áp dụng Eco-Mode" : isEco ? "Tắt Eco-Mode" : "Bật Eco-Mode"}
            className={`p-2 rounded-xl text-xs font-medium transition-all ${
              isCritical
                ? "bg-surface-900 text-slate-400 border border-white/[0.03] cursor-not-allowed opacity-50"
                : isEco
                ? "bg-emerald-500 text-black font-semibold"
                : "bg-surface-850 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
            }`}
          >
            <Leaf className="w-4 h-4" aria-hidden="true" />
          </button>

          {isCritical ? (
            <span
              className="p-2 rounded-xl bg-surface-900 border border-rose-500/20 text-rose-400/60 cursor-not-allowed"
              title="Tiến trình hệ thống cốt lõi - Cấm can thiệp theo RULE.md"
              aria-label={`${proc.name} được bảo vệ, không thể đóng`}
              role="img"
            >
              <Lock className="w-4 h-4" aria-hidden="true" />
            </span>
          ) : (
            <button
              onClick={() => onRequestKill(proc)}
              aria-label={`Đóng tiến trình ${proc.name}`}
              title={`Đóng tiến trình ${proc.name}`}
              className="p-2 rounded-xl bg-surface-850 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 border border-rose-500/30 transition-all"
            >
              <PowerOff className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </li>
  );
};
