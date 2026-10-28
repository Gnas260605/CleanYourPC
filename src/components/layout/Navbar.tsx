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
    <nav className="shrink-0 border-b border-white/[0.06] bg-surface-900/60 backdrop-blur-md px-6 py-2.5">
      <div className="flex items-center gap-2 max-w-7xl mx-auto overflow-x-auto no-scrollbar">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              className={`relative flex items-center gap-2.5 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 select-none whitespace-nowrap ${
                isActive
                  ? "bg-gradient-to-r from-cyan-500/15 to-violet-500/10 text-cyan-300 border border-cyan-500/30 shadow-glow-cyan/30"
                  : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] border border-transparent"
              }`}
            >
              <Icon className={`w-4 h-4 transition-colors ${isActive ? "text-cyan-400" : "text-slate-400"}`} />
              <span>{item.label}</span>

              {item.badge !== undefined && (
                <span
                  className={`text-[11px] font-mono px-2 py-0.5 rounded-full border ${
                    item.badgeColor || "bg-slate-700/50 text-slate-300 border-white/10"
                  }`}
                >
                  {item.badge}
                </span>
              )}

              {/* Active bottom glow indicator */}
              {isActive && (
                <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-gradient-to-r from-cyan-400 via-violet-400 to-cyan-400 rounded-full shadow-glow-cyan" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
