import React from "react";
import { FolderOpen, Trash2, Info, AlertTriangle, Wrench, Package, Clock, Files } from "lucide-react";
import { LargeFolderItem } from "@/types";
import { formatBytes } from "@/utils/formatters";
import { SAFETY_META } from "./safetyMeta";

interface DiskItemDetailProps {
  item: LargeFolderItem;
  onOpenInExplorer: (item: LargeFolderItem) => void;
  onRecycle: (item: LargeFolderItem) => void;
  isBusy: boolean;
}

const formatDate = (epochSecs: number | null) =>
  epochSecs ? new Date(epochSecs * 1000).toLocaleString("vi-VN") : "Không rõ";

/** Panel chi tiết: "Đây là gì", "Xóa có sao không", "Cách dọn đúng" */
export const DiskItemDetail: React.FC<DiskItemDetailProps> = ({ item, onOpenInExplorer, onRecycle, isBusy }) => {
  const meta = SAFETY_META[item.safety];

  return (
    <section
      aria-label={`Chi tiết ${item.title}`}
      className="rounded-2xl glass-panel border border-white/[0.08] p-5 space-y-4"
    >
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded border ${meta.badge}`}>
            {meta.emoji} {meta.label}
          </span>
          <span className="text-sm font-mono font-bold text-white">{formatBytes(item.size_bytes)}</span>
        </div>
        <h3 className="font-display font-bold text-base text-white">{item.title}</h3>
        <p className="text-[11px] font-mono text-slate-300 break-all">{item.path}</p>
      </div>

      <dl className="space-y-3 text-xs">
        <div>
          <dt className="flex items-center gap-1.5 font-semibold text-slate-100">
            <Info className="w-3.5 h-3.5 text-cyan-300" aria-hidden="true" /> Đây là gì?
          </dt>
          <dd className="mt-1 text-slate-200 leading-relaxed">{item.description}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1.5 font-semibold text-slate-100">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-300" aria-hidden="true" /> Xóa có sao không?
          </dt>
          <dd className="mt-1 text-slate-200 leading-relaxed">{item.consequence}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1.5 font-semibold text-slate-100">
            <Wrench className="w-3.5 h-3.5 text-emerald-300" aria-hidden="true" /> Cách dọn đúng
          </dt>
          <dd className="mt-1 text-slate-200 leading-relaxed">
            {item.action === "show_guide" ? (
              <code className="block p-2 rounded-lg bg-surface-950 border border-white/[0.06] font-mono text-[11px] text-sky-200 whitespace-pre-wrap select-text">
                {item.how_to_clean}
              </code>
            ) : (
              item.how_to_clean
            )}
          </dd>
        </div>
      </dl>

      <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-slate-300">
        <li className="flex items-center gap-1.5">
          <Package className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Ứng dụng: {item.owner_app ?? "—"}</span>
        </li>
        <li className="flex items-center gap-1.5">
          <Files className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{item.is_file ? "Tệp đơn" : `${item.file_count.toLocaleString("vi-VN")} tệp`}</span>
        </li>
        <li className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Sửa cuối: {formatDate(item.last_modified)}</span>
        </li>
      </ul>

      <div className="flex items-center gap-2 flex-wrap pt-1">
        <button
          onClick={() => onOpenInExplorer(item)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium bg-surface-850 hover:bg-surface-800 text-slate-100 border border-white/[0.08] focus-visible:ring-2 focus-visible:ring-cyan-400"
        >
          <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Mở trong Explorer</span>
        </button>
        {item.action === "recycle" && (
          <button
            onClick={() => onRecycle(item)}
            disabled={isBusy}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-500/40 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Chuyển vào Thùng rác</span>
          </button>
        )}
      </div>
    </section>
  );
};
