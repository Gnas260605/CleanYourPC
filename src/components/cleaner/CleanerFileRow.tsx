import React from "react";
import { CheckSquare, Square, HelpCircle } from "lucide-react";
import { CleanableItem } from "@/types";
import { formatBytes } from "@/utils/formatters";

interface CleanerFileRowProps {
  file: CleanableItem;
  onToggle: (id: string) => void;
}

/** Một tệp rác trong kết quả Dry-Run; bấm để chọn/bỏ chọn */
export const CleanerFileRow: React.FC<CleanerFileRowProps> = ({ file, onToggle }) => (
  <li>
    <button
      onClick={() => onToggle(file.id)}
      aria-pressed={Boolean(file.selected)}
      className={`w-full p-3.5 flex items-start sm:items-center justify-between gap-4 text-left transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400 ${
        file.selected ? "bg-cyan-500/[0.04]" : "hover:bg-white/[0.02]"
      }`}
    >
      <span className="flex items-start sm:items-center gap-3 min-w-0">
        <span className="pt-0.5 sm:pt-0 shrink-0" aria-hidden="true">
          {file.selected ? <CheckSquare className="w-4 h-4 text-cyan-400" /> : <Square className="w-4 h-4 text-slate-400" />}
        </span>
        <span className="min-w-0 space-y-0.5">
          <span className="flex items-center gap-2 flex-wrap">
            <span className={`font-semibold text-xs ${file.selected ? "text-slate-100" : "text-slate-300"}`}>{file.name}</span>
            <span className="text-[10px] font-mono px-2 rounded bg-surface-950 border border-white/[0.06] text-slate-300">
              {file.category}
            </span>
          </span>
          <span className="block text-[11px] font-mono text-slate-400 truncate max-w-xl" title={file.path}>
            {file.path}
          </span>
          <span className="flex items-center gap-1 text-[11px] text-emerald-300/90">
            <HelpCircle className="w-3 h-3 shrink-0" aria-hidden="true" />
            <span>{file.reason}</span>
          </span>
        </span>
      </span>
      <span className="font-mono text-xs font-bold text-slate-200 shrink-0">{formatBytes(file.size_bytes)}</span>
    </button>
  </li>
);
