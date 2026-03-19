"use client";

import Link from "next/link";
import { SparklineChart } from "@/components/common/SparklineChart";
import { cn, formatPrice, formatPercent, changeTextClass } from "@/lib/utils";
import { formatVolume } from "@/lib/utils";
import type { TopMover } from "@/lib/types";
import { TrendingUp, TrendingDown } from "lucide-react";

interface TopMoversProps {
  gainers: TopMover[];
  losers: TopMover[];
}

function MoverRow({ mover, isGainer }: { mover: TopMover; isGainer: boolean }) {
  return (
    <Link
      href={`/stocks/${mover.ticker}`}
      className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-white/5 transition-colors group"
    >
      {/* Rank indicator */}
      <div
        className={cn(
          "w-1.5 h-8 rounded-full flex-shrink-0",
          isGainer ? "bg-[#00FF88]" : "bg-[#FF3B5C]"
        )}
        style={{
          opacity: 0.6,
          boxShadow: isGainer
            ? "0 0 8px rgba(0,255,136,0.6)"
            : "0 0 8px rgba(255,59,92,0.6)",
        }}
      />

      {/* Ticker + name */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold text-white num group-hover:text-[#3B82F6] transition-colors">
          {mover.ticker}
        </div>
        <div className="text-[10px] text-[#555] truncate">{mover.name}</div>
      </div>

      {/* Sparkline */}
      <SparklineChart
        data={mover.sparkline}
        width={56}
        height={24}
        color={isGainer ? "#00FF88" : "#FF3B5C"}
      />

      {/* Price + change */}
      <div className="text-right flex-shrink-0">
        <div className="text-sm num font-semibold text-white">
          ${formatPrice(mover.price)}
        </div>
        <div
          className={cn(
            "text-xs num font-bold",
            changeTextClass(mover.changePercent)
          )}
        >
          {mover.changePercent >= 0 ? "+" : ""}
          {mover.changePercent.toFixed(2)}%
        </div>
      </div>
    </Link>
  );
}

export function TopMovers({ gainers, losers }: TopMoversProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Gainers */}
      <div className="glass rounded-xl p-4 border border-[#1E1E22]">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp size={14} className="text-[#00FF88]" />
          <h3 className="text-sm font-semibold text-[#888] uppercase tracking-widest">
            Top Gainers
          </h3>
        </div>
        <div className="space-y-0.5">
          {gainers.map((m) => (
            <MoverRow key={m.ticker} mover={m} isGainer />
          ))}
        </div>
      </div>

      {/* Losers */}
      <div className="glass rounded-xl p-4 border border-[#1E1E22]">
        <div className="flex items-center gap-2 mb-3">
          <TrendingDown size={14} className="text-[#FF3B5C]" />
          <h3 className="text-sm font-semibold text-[#888] uppercase tracking-widest">
            Top Losers
          </h3>
        </div>
        <div className="space-y-0.5">
          {losers.map((m) => (
            <MoverRow key={m.ticker} mover={m} isGainer={false} />
          ))}
        </div>
      </div>
    </div>
  );
}
