import { FolderSafety } from "@/types";

/** Nhãn, màu và mô tả ngắn cho từng mức an toàn của Disk Analyzer */
export const SAFETY_META: Record<
  FolderSafety,
  { emoji: string; label: string; hint: string; badge: string; bar: string }
> = {
  Safe: {
    emoji: "🟢",
    label: "An toàn",
    hint: "Cache tự tạo lại, xóa không mất dữ liệu",
    badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    bar: "bg-emerald-400",
  },
  Caution: {
    emoji: "🟡",
    label: "Cân nhắc",
    hint: "Xóa được nhưng có hệ quả (tải lại, build lại)",
    badge: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    bar: "bg-amber-400",
  },
  UseTool: {
    emoji: "🔵",
    label: "Dùng công cụ",
    hint: "Không xóa tay — làm theo hướng dẫn chính thức",
    badge: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    bar: "bg-sky-400",
  },
  Keep: {
    emoji: "🔴",
    label: "Giữ lại",
    hint: "Dữ liệu cá nhân / hệ thống — chỉ mở để tự xem",
    badge: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    bar: "bg-rose-400",
  },
  Unknown: {
    emoji: "⚪",
    label: "Chưa rõ",
    hint: "Chưa nhận diện được — chỉ mở để tự xem",
    badge: "bg-slate-500/15 text-slate-200 border-slate-400/30",
    bar: "bg-slate-400",
  },
};

export const SAFETY_ORDER: FolderSafety[] = ["Safe", "Caution", "UseTool", "Keep", "Unknown"];
