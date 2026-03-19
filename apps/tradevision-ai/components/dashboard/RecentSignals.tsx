"use client";

import Link from "next/link";
import { SignalBadge } from "@/components/common/SignalBadge";
import { cn, formatPrice, timeAgo } from "@/lib/utils";
import type { AISignal } from "@/lib/types";
import { Zap, ChevronRight } from "lucide-react";

interface RecentSignalsProps {
  signals: AISignal[];
}

export function RecentSignals({ signals }: RecentSignalsProps) {
  return (
    <div className="glass rounded-xl p-4 border border-[#1E1E22]">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Zap size={14} className="text-[#F59E0B]" />
          <h3 className="text-sm font-semibold text-[#888] uppercase tracking-widest">
            Recent AI Signals
          </h3>
        </div>
        <Link
          href="/watchlist"
          className="text-xs text-[#3B82F6] hover:text-[#60A5FA] transition-colors flex items-center gap-1"
        >
          View all <ChevronRight size={12} />
        </Link>
      </div>

      <div className="space-y-3">
        {signals.map((signal) => (
          <Link
            key={signal.ticker}
            href={`/stocks/${signal.ticker}`}
            className="flex items-center gap-4 p-3 rounded-lg border border-[#1E1E22] bg-[#0D0D0F] hover:border-[#2A2A32] hover:bg-[#111113] transition-all group"
          >
            {/* Ticker */}
            <div className="w-14">
              <div className="text-sm font-bold text-white num">{signal.ticker}</div>
              <div className="text-[10px] text-[#555]">
                {timeAgo(signal.generatedAt)}
              </div>
            </div>

            {/* Signal badge */}
            <SignalBadge signal={signal.signal} size="sm" />

            {/* Confidence bar */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-[#555]">Confidence</span>
                <span className="text-[10px] num font-bold text-[#888]">
                  {signal.confidence}%
                </span>
              </div>
              <div className="h-1 bg-[#1E1E22] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${signal.confidence}%`,
                    background:
                      signal.signal === "hold"
                        ? "#F59E0B"
                        : signal.signal.includes("buy")
                        ? "#00FF88"
                        : "#FF3B5C",
                  }}
                />
              </div>
            </div>

            {/* Risk level */}
            <div className="text-right flex-shrink-0">
              <div
                className={cn(
                  "text-[10px] font-bold uppercase tracking-wide",
                  signal.riskLevel === "low"
                    ? "text-[#00FF88]"
                    : signal.riskLevel === "medium"
                    ? "text-[#F59E0B]"
                    : "text-[#FF3B5C]"
                )}
              >
                {signal.riskLevel}
              </div>
              <div className="text-[9px] text-[#555]">risk</div>
            </div>

            <ChevronRight size={14} className="text-[#333] group-hover:text-[#3B82F6] transition-colors flex-shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  );
}
