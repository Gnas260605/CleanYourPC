import React from "react";
import { 
  LayoutDashboard, 
  Rocket, 
  ShieldAlert, 
  Trash2, 
  SlidersHorizontal,
  HardDrive
} from "lucide-react";
import { ActiveTab } from "@/types";
import { formatBytes } from "@/utils/formatters";

interface NavbarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  /** Số liệu thật; undefined = chưa có dữ liệu → ẩn badge */
  startupCount?: number;
  junkBytes?: number;
  heavyProcessCount?: number;
}

interface NavItem {
  id: ActiveTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | number;
  badgeColor?: string;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onSelectTab,
  startupCount,
  junkBytes,
  heavyProcessCount,
}) => {
  const navItems: NavItem[] = [
    {
      id: "dashboard",
      label: "Tổng quan",
      icon: LayoutDashboard,
    },
    {
      id: "startup",
      label: "Khởi động",
      icon: Rocket,
      badge: startupCount,
      badgeColor: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
    },
    {
      id: "process",
      label: "Process Guardian",
      icon: ShieldAlert,
      badge: heavyProcessCount ? `${heavyProcessCount} ngốn RAM` : undefined,
      badgeColor: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    },
    {
      id: "cleaner",
      label: "Dọn dẹp an toàn",
      icon: Trash2,
      badge: junkBytes ? formatBytes(junkBytes) : undefined,
      badgeColor: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    },
    {
      id: "analyzer",
      label: "Phân tích ổ đĩa",
      icon: HardDrive,
    },
    {
      id: "services",
      label: "Dịch vụ Windows",
      icon: SlidersHorizontal,
    },
  ];

  return (
    <nav
      aria-label="Điều hướng chính"
      className="shrink-0 border-b lg:border-b-0 lg:border-r border-white/[0.06] bg-surface-900/60 backdrop-blur-md px-6 py-2.5 lg:px-3 lg:py-4 lg:w-60 lg:overflow-y-auto"
    >
      <div className="flex lg:flex-col items-center lg:items-stretch gap-2 max-w-7xl mx-auto overflow-x-auto lg:overflow-x-visible no-scrollbar">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              aria-current={isActive ? "page" : undefined}
              className={`relative flex items-center gap-2.5 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 select-none whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                isActive
                  ? "bg-gradient-to-r from-cyan-500/15 to-violet-500/10 text-cyan-200 border border-cyan-500/30"
                  : "text-slate-300 hover:text-white hover:bg-white/[0.04] border border-transparent"
              }`}
            >
              <Icon className={`w-4 h-4 shrink-0 transition-colors ${isActive ? "text-cyan-400" : "text-slate-300"}`} aria-hidden="true" />
              <span className="lg:flex-1 lg:text-left">{item.label}</span>

              {item.badge !== undefined && (
                <span
                  className={`text-[11px] font-mono px-2 py-0.5 rounded-full border ${
                    item.badgeColor || "bg-slate-700/50 text-slate-200 border-white/10"
                  }`}
                >
                  {item.badge}
                </span>
              )}

              {/* Vạch chỉ báo tab đang chọn: dưới (thanh ngang) / bên trái (sidebar) */}
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 left-3 right-3 h-[2px] lg:bottom-2 lg:top-2 lg:left-0 lg:right-auto lg:h-auto lg:w-[3px] bg-gradient-to-r lg:bg-gradient-to-b from-cyan-400 via-violet-400 to-cyan-400 rounded-full"
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
