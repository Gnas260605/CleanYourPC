import React from "react";
import { 
  Cpu, 
  MemoryStick, 
  Monitor, 
  ShieldCheck, 
  Info 
} from "lucide-react";
import { formatBytes } from "@/utils/formatters";
import { CpuMetrics, RamMetrics, SystemInfo } from "@/types";

interface SystemSpecsCardProps {
  cpu: CpuMetrics;
  ram: RamMetrics;
  system: SystemInfo;
}

export const SystemSpecsCard: React.FC<SystemSpecsCardProps> = ({
  cpu,
  ram,
  system,
}) => {
  return (
    <div className="p-5 rounded-2xl glass-panel relative overflow-hidden">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
            <Monitor className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-display font-semibold text-sm text-slate-100">
              Thông số phần cứng & Hệ thống
            </h3>
            <p className="text-xs text-slate-400">{system.hostname} • {system.architecture}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-mono">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Hệ thống đạt chuẩn an toàn</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* CPU Spec */}
        <div className="p-3.5 rounded-xl bg-surface-900/60 border border-white/[0.04] flex items-start gap-3">
          <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 shrink-0 mt-0.5">
            <Cpu className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-medium uppercase text-slate-400 tracking-wider">
              Bộ vi xử lý (CPU)
            </span>
            <p className="font-medium text-xs text-slate-100 truncate mt-0.5" title={cpu.model}>
              {cpu.model}
            </p>
            <p className="text-[11px] font-mono text-cyan-400 mt-1">
              {cpu.cores} Cores • {cpu.threads} Threads @ {cpu.frequencyGhz} GHz
            </p>
          </div>
        </div>

        {/* RAM Spec */}
        <div className="p-3.5 rounded-xl bg-surface-900/60 border border-white/[0.04] flex items-start gap-3">
          <div className="p-2 rounded-lg bg-violet-500/10 text-violet-400 shrink-0 mt-0.5">
            <MemoryStick className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-medium uppercase text-slate-400 tracking-wider">
              Bộ nhớ RAM
            </span>
            <p className="font-medium text-xs text-slate-100 truncate mt-0.5">
              {formatBytes(ram.totalBytes, 0)} High-Speed Memory
            </p>
            <p className="text-[11px] font-mono text-violet-400 mt-1">
              {ram.speedMhz ? `${ram.speedMhz} MHz • ` : ""}Trống {formatBytes(ram.availableBytes, 1)}
            </p>
          </div>
        </div>

        {/* OS & Platform */}
        <div className="p-3.5 rounded-xl bg-surface-900/60 border border-white/[0.04] flex items-start gap-3 sm:col-span-2 lg:col-span-1">
          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0 mt-0.5">
            <Info className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-medium uppercase text-slate-400 tracking-wider">
              Hệ điều hành Windows
            </span>
            <p className="font-medium text-xs text-slate-100 truncate mt-0.5">
              {system.os}
            </p>
            <p className="text-[11px] font-mono text-emerald-400 mt-1">
              Build: {system.build}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
