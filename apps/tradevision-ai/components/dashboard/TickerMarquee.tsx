"use client";

import { cn, formatPrice, formatPercent, changeTextClass } from "@/lib/utils";
import type { TopMover } from "@/lib/types";

interface TickerMarqueeProps {
  tickers: Array<{ ticker: string; price: number; changePercent: number }>;
}

export function TickerMarquee({ tickers }: TickerMarqueeProps) {
  // Duplicate for seamless loop
  const doubled = [...tickers, ...tickers];

  return (
    <div className="border-y border-[#1E1E22] bg-[#0D0D0F]/60 py-2 overflow-hidden">
      <div className="marquee-container">
        <div className="marquee-track">
          {doubled.map((t, i) => (
            <span key={`${t.ticker}-${i}`} className="inline-flex items-center gap-2 mr-8">
              <span className="text-xs font-bold text-white num tracking-wide">
                {t.ticker}
              </span>
              <span className="text-xs num text-[#888]">${formatPrice(t.price)}</span>
              <span
                className={cn(
                  "text-xs num font-medium",
                  changeTextClass(t.changePercent)
                )}
              >
                {t.changePercent >= 0 ? "▲" : "▼"}
                {formatPercent(Math.abs(t.changePercent))}
              </span>
              <span className="text-[#333] ml-4">|</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
