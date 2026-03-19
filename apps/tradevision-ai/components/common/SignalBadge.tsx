import { cn, signalLabel, signalColor, signalBgColor } from "@/lib/utils";
import type { Signal } from "@/lib/types";

interface SignalBadgeProps {
  signal: Signal;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function SignalBadge({ signal, size = "md", className }: SignalBadgeProps) {
  const label = signalLabel(signal);
  const color = signalColor(signal);
  const bg = signalBgColor(signal);

  const sizeClasses = {
    sm: "text-[10px] px-2 py-0.5 tracking-wide",
    md: "text-xs px-3 py-1 tracking-wider",
    lg: "text-sm px-4 py-1.5 tracking-widest",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center font-bold rounded-full border uppercase font-mono",
        sizeClasses[size],
        className
      )}
      style={{
        color,
        backgroundColor: bg,
        borderColor: `${color}40`,
        textShadow: `0 0 12px ${color}60`,
      }}
    >
      {label}
    </span>
  );
}
