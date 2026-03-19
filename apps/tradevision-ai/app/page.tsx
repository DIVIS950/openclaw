import { Suspense } from "react";
import { IndexCard } from "@/components/dashboard/IndexCard";
import { TickerMarquee } from "@/components/dashboard/TickerMarquee";
import { SectorHeatmap } from "@/components/dashboard/SectorHeatmap";
import { MarketPulseWidget } from "@/components/dashboard/MarketPulseWidget";
import { TopMovers } from "@/components/dashboard/TopMovers";
import { RecentSignals } from "@/components/dashboard/RecentSignals";
import {
  IndexCardSkeleton,
  CardSkeleton,
} from "@/components/common/LoadingSkeleton";
import {
  MOCK_INDICES,
  MOCK_GAINERS,
  MOCK_LOSERS,
  MOCK_SECTORS,
  MOCK_MARKET_PULSE,
  MOCK_AI_SIGNALS,
} from "@/lib/mock-data";
import { isMarketOpen } from "@/lib/utils";

export const revalidate = 30;

export default function DashboardPage() {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const marketOpen = isMarketOpen();

  // Ticker marquee data
  const marqueeItems = [...MOCK_GAINERS, ...MOCK_LOSERS].map((m) => ({
    ticker: m.ticker,
    price: m.price,
    changePercent: m.changePercent,
  }));

  return (
    <div className="space-y-6">
      {/* Welcome header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Market Overview
          </h1>
          <p className="text-sm text-[#555] mt-1">{today}</p>
        </div>
        <div
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium ${
            marketOpen
              ? "text-[#00FF88] bg-[#00FF88]/10 border-[#00FF88]/30"
              : "text-[#FF3B5C] bg-[#FF3B5C]/10 border-[#FF3B5C]/30"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              marketOpen ? "bg-[#00FF88] animate-pulse" : "bg-[#FF3B5C]"
            }`}
          />
          {marketOpen ? "NYSE Open" : "Market Closed"}
        </div>
      </div>

      {/* Index cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {MOCK_INDICES.map((index) => (
          <IndexCard key={index.ticker} index={index} />
        ))}
      </div>

      {/* Ticker marquee */}
      <div className="-mx-6">
        <TickerMarquee tickers={marqueeItems} />
      </div>

      {/* Market Pulse + Sector Heatmap */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <div className="xl:col-span-2">
          <MarketPulseWidget pulse={MOCK_MARKET_PULSE} />
        </div>
        <div className="xl:col-span-3 glass rounded-xl p-5 border border-[#1E1E22]">
          <SectorHeatmap sectors={MOCK_SECTORS} />
        </div>
      </div>

      {/* Top Movers */}
      <TopMovers gainers={MOCK_GAINERS} losers={MOCK_LOSERS} />

      {/* Recent AI Signals */}
      <RecentSignals signals={MOCK_AI_SIGNALS} />

      {/* Last updated */}
      <div className="text-center text-[11px] text-[#333] pb-2">
        Data refreshes every 30s · Last updated {new Date().toLocaleTimeString()}
      </div>
    </div>
  );
}
