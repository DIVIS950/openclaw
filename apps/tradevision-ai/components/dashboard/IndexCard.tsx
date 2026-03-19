"use client";

import { SparklineChart } from "@/components/common/SparklineChart";
import { cn, formatPrice, formatPercent, formatChange, changeTextClass } from "@/lib/utils";
import type { MarketIndex } from "@/lib/types";

export function IndexCard({ index }: { index: MarketIndex }) {
  const isPositive = index.changePercent >= 0;

  return (
    <div
      className={cn(
        "glass glass-hover rounded-xl p-4 cursor-pointer relative overflow-hidden",
        "border border-[#1E1E22]"
      )}
    >
      {/* Background accent */}
      <div
        className={cn(
          "absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-5 pointer-events-none",
          isPositive ? "bg-[#00FF88]" : "bg-[#FF3B5C]"
        )}
      />

      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-[#666] font-medium tracking-wide uppercase">
          {index.name}
        </span>
        <span
          className={cn(
            "text-xs font-bold px-2 py-0.5 rounded-full num",
            isPositive
              ? "text-[#00FF88] bg-[#00FF88]/10"
              : "text-[#FF3B5C] bg-[#FF3B5C]/10"
          )}
        >
          {formatPercent(index.changePercent)}
        </span>
      </div>

      {/* Price */}
      <div className="num text-2xl font-bold text-white mb-0.5">
        {formatPrice(index.price)}
      </div>

      {/* Change */}
      <div className={cn("num text-xs font-medium mb-3", changeTextClass(index.change))}>
        {isPositive ? "▲" : "▼"} {formatChange(Math.abs(index.change))}
      </div>

      {/* Sparkline */}
      <SparklineChart
        data={index.sparkline}
        width={140}
        height={36}
        color={isPositive ? "#00FF88" : "#FF3B5C"}
      />
    </div>
  );
}
