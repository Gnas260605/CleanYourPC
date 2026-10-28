import React from "react";
import { 
  HardDrive, 
  Wifi, 
  ArrowDownToLine, 
  ArrowUpFromLine, 
  Gauge, 
  Radio 
} from "lucide-react";
import { formatBytes, formatSpeed } from "@/utils/formatters";
import { DiskMetrics, NetworkMetrics } from "@/types";

interface ThroughputCardProps {
  disk: DiskMetrics;
  network: NetworkMetrics;
}

export const ThroughputCard: React.FC<ThroughputCardProps> = ({ disk, network }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Disk I/O Card */}
      <div className="p-5 rounded-2xl glass-panel relative overflow-hidden group">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-400">
              <HardDrive className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-display font-semibold text-sm text-slate-100">
                Ổ đĩa hệ thống ({disk.driveLetter})
              </h3>
              <p className="text-xs text-slate-400">Tốc độ đọc / ghi tức thời</p>
            </div>
          </div>
        </div>

        {/* Real-time Read / Write Metrics */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="p-3 rounded-xl bg-surface-900/60 border border-white/[0.04]">
            <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
              <ArrowDownToLine className="w-3.5 h-3.5 text-cyan-400" />
              <span>Đọc (Read)</span>
            </div>
            <div className="font-mono text-base font-bold text-slate-100">
              {formatSpeed(disk.readBytesPerSec)}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-surface-900/60 border border-white/[0.04]">
            <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
              <ArrowUpFromLine className="w-3.5 h-3.5 text-violet-400" />
              <span>Ghi (Write)</span>
            </div>
            <div className="font-mono text-base font-bold text-slate-100">
              {formatSpeed(disk.writeBytesPerSec)}
            </div>
          </div>
        </div>

        {/* Storage capacity bar */}
        <div>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-slate-400">Dung lượng đã dùng:</span>
            <span className="font-mono text-slate-200">
              {formatBytes(disk.usedSpaceBytes, 0)} / {formatBytes(disk.totalSpaceBytes, 0)} ({disk.usagePercent.toFixed(0)}%)
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-surface-900 overflow-hidden border border-white/[0.05]">
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-cyan-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, disk.usagePercent)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Network Card */}
      <div className="p-5 rounded-2xl glass-panel relative overflow-hidden group">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <Wifi className="w-4 h-4" />
            </div>
            <div className="truncate max-w-[200px]">
              <h3 className="font-display font-semibold text-sm text-slate-100 truncate">
                Mạng băng thông
              </h3>
              <p className="text-xs text-slate-400 truncate">{network.adapterName}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <Radio className="w-3 h-3 animate-pulse" />
            <span>{network.pingMs !== undefined ? `${network.pingMs} ms` : "—"}</span>
          </div>
        </div>

        {/* Real-time Download / Upload */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="p-3 rounded-xl bg-surface-900/60 border border-white/[0.04]">
            <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
              <ArrowDownToLine className="w-3.5 h-3.5 text-emerald-400" />
              <span>Tải xuống</span>
            </div>
            <div className="font-mono text-base font-bold text-slate-100">
              {formatSpeed(network.downloadBytesPerSec)}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-surface-900/60 border border-white/[0.04]">
            <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
              <ArrowUpFromLine className="w-3.5 h-3.5 text-cyan-400" />
              <span>Tải lên</span>
            </div>
            <div className="font-mono text-base font-bold text-slate-100">
              {formatSpeed(network.uploadBytesPerSec)}
            </div>
          </div>
        </div>

        {/* Status indicator */}
        <div className="flex items-center justify-between text-xs px-3 py-2 rounded-xl bg-surface-900/40 border border-white/[0.04]">
          <div className="flex items-center gap-2">
            <Gauge className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-slate-300">Độ trễ hệ thống</span>
          </div>
          <span className="text-emerald-400 font-mono font-medium">Rất ổn định (Low jitter)</span>
        </div>
      </div>
    </div>
  );
};
