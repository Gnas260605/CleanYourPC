import React from "react";

interface CircularGaugeProps {
  label: string;
  value: number; // 0 - 100
  unit?: string;
  subLabel?: string;
  subValue?: string;
  icon?: React.ReactNode;
  size?: number; // width & height in px
}

export const CircularGauge: React.FC<CircularGaugeProps> = ({
  label,
  value,
  unit = "%",
  subLabel,
  subValue,
  icon,
  size = 200,
}) => {
  // Clamp value between 0 and 100
  const clampedValue = Math.min(100, Math.max(0, value));

  // Determine theme color based on load severity
  let strokeColor = "#06B6D4"; // Cyan default (< 55%)
  let glowColor = "rgba(6, 182, 212, 0.4)";
  let badgeColor = "bg-cyan-500/10 text-cyan-400 border-cyan-500/30";

  if (clampedValue >= 80) {
    strokeColor = "#F43F5E"; // Rose
    glowColor = "rgba(244, 63, 94, 0.5)";
    badgeColor = "bg-rose-500/15 text-rose-400 border-rose-500/30";
  } else if (clampedValue >= 60) {
    strokeColor = "#F59E0B"; // Amber
    glowColor = "rgba(245, 158, 11, 0.45)";
    badgeColor = "bg-amber-500/15 text-amber-400 border-amber-500/30";
  } else if (clampedValue < 40) {
    strokeColor = "#10B981"; // Emerald for chill idle
    glowColor = "rgba(16, 185, 129, 0.4)";
    badgeColor = "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
  }

  // SVG Gauge calculations
  // Arc angle: 260 degrees (leaving 100 degrees open at bottom)
  const strokeWidth = 12;
  const radius = (size - strokeWidth * 2) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const arcLength = circumference * (260 / 360);
  const strokeDashoffset = arcLength - (clampedValue / 100) * arcLength;

  // Rotation: Start at 140deg so the opening is centered at bottom (from 140deg to 400deg)
  const startAngle = 140;

  // Tick marks (total 11 ticks from 0% to 100%)
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const angleDeg = startAngle + (i / 10) * 260;
    const angleRad = (angleDeg * Math.PI) / 180;
    const tickInnerRadius = radius - 16;
    const tickOuterRadius = radius - 9;
    const x1 = center + tickInnerRadius * Math.cos(angleRad);
    const y1 = center + tickInnerRadius * Math.sin(angleRad);
    const x2 = center + tickOuterRadius * Math.cos(angleRad);
    const y2 = center + tickOuterRadius * Math.sin(angleRad);
    const isMajor = i % 2 === 0;
    return { x1, y1, x2, y2, isMajor, percent: i * 10 };
  });

  return (
    <div className="flex flex-col items-center justify-center p-5 rounded-2xl glass-panel relative group">
      {/* Background glow radial */}
      <div
        className="absolute w-36 h-36 rounded-full blur-3xl pointer-events-none transition-all duration-700 opacity-20 group-hover:opacity-35"
        style={{ backgroundColor: strokeColor }}
      />

      {/* Top Header Label */}
      <div className="w-full flex items-center justify-between mb-2 z-10">
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-display font-semibold text-sm tracking-wide text-slate-200">
            {label}
          </span>
        </div>
        <span
          className={`text-[11px] font-mono px-2 py-0.5 rounded-full border transition-colors ${badgeColor}`}
        >
          {clampedValue >= 80 ? "Nặng" : clampedValue >= 60 ? "Vừa" : "Mượt mà"}
        </span>
      </div>

      {/* Speedometer Gauge Arc */}
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          className="transform"
          style={{ filter: `drop-shadow(0 0 10px ${glowColor})` }}
        >
          {/* Defs for gradients */}
          <defs>
            <linearGradient id={`gauge-grad-${label}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#06B6D4" />
              <stop offset="60%" stopColor={strokeColor} />
              <stop offset="100%" stopColor={strokeColor} />
            </linearGradient>
          </defs>

          {/* Tick lines */}
          {ticks.map((tick, index) => (
            <line
              key={index}
              x1={tick.x1}
              y1={tick.y1}
              x2={tick.x2}
              y2={tick.y2}
              stroke="rgba(255, 255, 255, 0.15)"
              strokeWidth={tick.isMajor ? 2 : 1}
              strokeLinecap="round"
            />
          ))}

          {/* Track background */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="rgba(255, 255, 255, 0.05)"
            strokeWidth={strokeWidth}
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeDashoffset={0}
            strokeLinecap="round"
            transform={`rotate(${startAngle} ${center} ${center})`}
          />

          {/* Value Progress Arc */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={`url(#gauge-grad-${label})`}
            strokeWidth={strokeWidth}
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            transform={`rotate(${startAngle} ${center} ${center})`}
            className="transition-all duration-700 ease-out"
          />
        </svg>

        {/* Center Readout */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none mt-1">
          <div className="flex items-baseline">
            <span className="font-display font-extrabold text-4xl tracking-tight text-white transition-all">
              {clampedValue.toFixed(0)}
            </span>
            <span className="text-base font-semibold text-slate-400 ml-0.5">
              {unit}
            </span>
          </div>

          {subLabel && subValue && (
            <div className="flex items-center gap-1.5 mt-1 px-2.5 py-0.5 rounded-full bg-surface-900/80 border border-white/[0.08] text-[11px] font-mono text-slate-300">
              <span className="text-slate-400">{subLabel}:</span>
              <span className="font-semibold text-white">{subValue}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
