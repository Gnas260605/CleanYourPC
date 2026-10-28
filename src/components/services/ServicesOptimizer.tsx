import { useState } from "react";
import { 
  SlidersHorizontal, 
  Lock, 
  Power, 
  Sparkles,
  Filter
} from "lucide-react";
import { ServiceItem } from "@/types";

const INITIAL_SERVICES: ServiceItem[] = [
  {
    name: "DiagTrack",
    displayName: "Connected User Experiences and Telemetry",
    status: "running",
    startupType: "Automatic",
    recommendation: "safe_to_disable",
    vietnameseDescription: "Dịch vụ thu thập thông tin người dùng và gửi nhật ký chẩn đoán về máy chủ Microsoft.",
    impactDescription: "Tắt dịch vụ này giúp tăng tính riêng tư, giảm ngốn CPU & Disk ngầm mà không gây bất kỳ lỗi phần mềm nào.",
    selectedForDisable: true,
  },
  {
    name: "SysMain",
    displayName: "SysMain (SuperFetch)",
    status: "running",
    startupType: "Automatic",
    recommendation: "safe_to_disable",
    vietnameseDescription: "Dịch vụ tự động load trước các ứng dụng hay dùng vào bộ nhớ đệm RAM.",
    impactDescription: "Thường gây ra hiện tượng 100% Disk spike trên ổ cứng HDD và hao tốn 1.5 - 2GB RAM vô ích trên SSD đời mới.",
    selectedForDisable: true,
  },
  {
    name: "RemoteRegistry",
    displayName: "Remote Registry",
    status: "stopped",
    startupType: "Disabled",
    recommendation: "safe_to_disable",
    vietnameseDescription: "Cho phép người dùng từ xa sửa đổi Registry của máy tính qua mạng nội bộ.",
    impactDescription: "Là lỗ hổng bảo mật phổ biến. Microsoft cũng khuyến cáo nên tắt trên máy cá nhân.",
    selectedForDisable: false,
  },
  {
    name: "XboxGipSvc",
    displayName: "Xbox Accessory Management Service",
    status: "running",
    startupType: "Manual",
    recommendation: "safe_to_disable",
    vietnameseDescription: "Quản lý kết nối các phụ kiện tay cầm tay cầm chơi game Xbox chính hãng.",
    impactDescription: "Nếu bạn không sử dụng tay cầm Xbox, tắt dịch vụ này sẽ giảm bớt các tiến trình chạy ngầm.",
    selectedForDisable: false,
  },
  {
    name: "WSearch",
    displayName: "Windows Search Indexer",
    status: "running",
    startupType: "Automatic",
    recommendation: "caution",
    vietnameseDescription: "Lập chỉ mục tìm kiếm tệp và thư mục trên máy tính.",
    impactDescription: "Tắt dịch vụ sẽ giảm tải CPU/Disk đáng kể, nhưng thanh tìm kiếm Start Menu sẽ chậm hơn khi tìm tệp cục bộ.",
    selectedForDisable: false,
  },
  // CORE SYSTEM SERVICES - PROTECTED BY RULE.MD
  {
    name: "Audiosrv",
    displayName: "Windows Audio Service",
    status: "running",
    startupType: "Automatic",
    recommendation: "keep_default",
    vietnameseDescription: "Quản lý âm thanh cho tất cả các chương trình chạy trên hệ thống.",
    impactDescription: "DỊCH VỤ CỐT LÕI (RULE.md): Nghiêm cấm tắt, nếu tắt máy tính sẽ mất hoàn toàn âm thanh.",
    selectedForDisable: false,
  },
  {
    name: "RpcSs",
    displayName: "Remote Procedure Call (RPC)",
    status: "running",
    startupType: "Automatic",
    recommendation: "keep_default",
    vietnameseDescription: "Hệ thống truyền thông điệp nội bộ giữa các tiến trình Windows.",
    impactDescription: "DỊCH VỤ SỐNG CÒN (RULE.md): Tắt dịch vụ này sẽ làm Windows bị lỗi màn hình xanh (BSOD) lập tức.",
    selectedForDisable: false,
  },
];

interface ServicesOptimizerProps {
  onNotify: (msg: string) => void;
}

export const ServicesOptimizer: React.FC<ServicesOptimizerProps> = ({ onNotify }) => {
  const [services, setServices] = useState<ServiceItem[]>(INITIAL_SERVICES);
  const [filterType, setFilterType] = useState<string>("all");

  const handleToggleService = (name: string) => {
    setServices((prev) =>
      prev.map((svc) => {
        if (svc.name === name) {
          if (svc.recommendation === "keep_default") {
            onNotify(`Dịch vụ ${svc.displayName} được bảo vệ bởi RULE.md, không thể can thiệp!`);
            return svc;
          }

          const nextStatus = svc.status === "running" ? "stopped" : "running";
          onNotify(
            `Dịch vụ ${svc.displayName} đã được ${
              nextStatus === "stopped" ? "tạm dừng và chuyển sang Manual" : "kích hoạt lại"
            }.`
          );
          return {
            ...svc,
            status: nextStatus,
            startupType: nextStatus === "stopped" ? "Manual" : "Automatic",
          };
        }
        return svc;
      })
    );
  };

  // Quick 1-click safe services optimization
  const handleOptimizeSafeServices = () => {
    let count = 0;
    setServices((prev) =>
      prev.map((svc) => {
        if (svc.recommendation === "safe_to_disable" && svc.status === "running") {
          count++;
          return { ...svc, status: "stopped", startupType: "Manual" };
        }
        return svc;
      })
    );
    onNotify(`Đã tối ưu hóa an toàn ${count} dịch vụ không cần thiết (Telemetry & SysMain)!`);
  };

  const filteredServices = services.filter((svc) => {
    if (filterType === "all") return true;
    return svc.recommendation === filterType;
  });

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="p-6 rounded-3xl glass-panel border border-cyan-500/20 relative overflow-hidden">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="p-1 rounded-lg bg-cyan-500/10 text-cyan-400">
                <SlidersHorizontal className="w-4 h-4" />
              </span>
              <h2 className="font-display font-bold text-xl text-white">
                Tối ưu dịch vụ hệ thống (Windows Services)
              </h2>
            </div>
            <p className="text-xs text-slate-300 max-w-2xl">
              Giải thích tường minh bằng tiếng Việt chức năng của từng dịch vụ. Bảo vệ tuyệt đối các dịch vụ cốt lõi theo RULE.md (Audio, RPC, PlugPlay).
            </p>
          </div>

          {/* Quick Safe Optimize Button */}
          <button
            onClick={handleOptimizeSafeServices}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500/20 to-violet-500/20 hover:from-cyan-500/30 hover:to-violet-500/30 text-cyan-300 border border-cyan-500/40 font-semibold text-xs transition-all shadow-glow-cyan/20 active:scale-95"
          >
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <span>Tối Ưu 1 Chạm (Khuyên Dùng)</span>
          </button>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-5 pt-5 border-t border-white/[0.06] text-xs flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <span className="text-slate-300">Khuyên tắt (Tăng tốc & Bảo mật)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <span className="text-slate-300">Thận trọng (Tùy nhu cầu sử dụng)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
            <span className="text-slate-300">Cốt lõi Windows (Khóa cấm sửa)</span>
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex items-center gap-2 overflow-x-auto">
        <span className="text-xs text-slate-400 flex items-center gap-1 shrink-0">
          <Filter className="w-3.5 h-3.5" /> Phân loại:
        </span>
        {[
          { id: "all", label: "Tất cả dịch vụ" },
          { id: "safe_to_disable", label: "🟢 Khuyên tắt" },
          { id: "caution", label: "🟡 Cần cân nhắc" },
          { id: "keep_default", label: "🔴 Cốt lõi bảo vệ" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilterType(tab.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              filterType === tab.id
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                : "bg-surface-900/60 text-slate-400 hover:text-slate-200 border border-white/[0.04]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Services List */}
      <div className="rounded-2xl glass-panel overflow-hidden border border-white/[0.06]">
        <div className="divide-y divide-white/[0.04]">
          {filteredServices.map((svc) => {
            const isSafe = svc.recommendation === "safe_to_disable";
            const isCaution = svc.recommendation === "caution";
            const isProtected = svc.recommendation === "keep_default";

            return (
              <div
                key={svc.name}
                className="p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-colors hover:bg-white/[0.02]"
              >
                {/* Left Info */}
                <div className="min-w-0 space-y-1.5 max-w-2xl">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-slate-100">
                      {svc.displayName}
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-surface-950 border border-white/[0.06] text-slate-400">
                      Service: {svc.name}
                    </span>
                    <span
                      className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded border ${
                        isSafe
                          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                          : isCaution
                          ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                          : "bg-rose-500/15 text-rose-400 border-rose-500/30"
                      }`}
                    >
                      {isSafe
                        ? "Khuyên tắt"
                        : isCaution
                        ? "Cần cân nhắc"
                        : "Khóa bảo vệ"}
                    </span>
                  </div>

                  <p className="text-xs text-slate-300">
                    {svc.vietnameseDescription}
                  </p>

                  <p className="text-[11px] text-slate-400 italic">
                    💡 {svc.impactDescription}
                  </p>
                </div>

                {/* Right Action Switch / Lock */}
                <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                  <span className="text-xs font-mono text-slate-400">
                    {svc.status === "running" ? "Đang chạy" : "Đã tắt"}
                  </span>

                  {isProtected ? (
                    <div
                      className="p-2 rounded-xl bg-surface-900 border border-white/[0.06] text-slate-500 flex items-center gap-1.5 text-xs font-mono"
                      title="Dịch vụ cốt lõi được bảo vệ theo RULE.md"
                    >
                      <Lock className="w-4 h-4 text-rose-400" />
                      <span>Bảo vệ</span>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleToggleService(svc.name)}
                      className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all ${
                        svc.status === "running"
                          ? "bg-surface-850 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30"
                          : "bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40"
                      }`}
                    >
                      <Power className="w-3.5 h-3.5" />
                      <span>{svc.status === "running" ? "Dừng dịch vụ" : "Bật lại"}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
