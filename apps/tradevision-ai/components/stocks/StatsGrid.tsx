import { cn, formatMarketCap, formatVolume, pricePosition } from "@/lib/utils";
import type { StockQuote } from "@/lib/types";

interface StatsGridProps {
  quote: StockQuote;
}

function StatItem({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="p-3 rounded-lg bg-[#0D0D0F] border border-[#1E1E22]">
      <div className="text-[10px] text-[#555] uppercase tracking-widest mb-1">{label}</div>
      <div className="text-sm font-semibold text-white num">{value}</div>
      {sub && <div className="text-[10px] text-[#444] mt-0.5 num">{sub}</div>}
    </div>
  );
}

export function StatsGrid({ quote }: StatsGridProps) {
  const pos52w = pricePosition(quote.price, quote.week52Low, quote.week52High);

  return (
    <div className="glass rounded-xl border border-[#1E1E22] p-4">
      <h3 className="text-xs font-semibold text-[#666] uppercase tracking-widest mb-3">
        Key Stats
      </h3>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <StatItem label="Market Cap" value={formatMarketCap(quote.marketCap)} />
        <StatItem
          label="P/E Ratio"
          value={quote.peRatio ? quote.peRatio.toFixed(2) : "N/A"}
        />
        <StatItem
          label="EPS (TTM)"
          value={quote.eps ? `$${quote.eps.toFixed(2)}` : "N/A"}
        />
        <StatItem
          label="Div. Yield"
          value={quote.dividendYield ? `${quote.dividendYield.toFixed(2)}%` : "N/A"}
        />
        <StatItem
          label="Volume"
          value={formatVolume(quote.volume)}
          sub={`Avg: ${formatVolume(quote.avgVolume)}`}
        />
        <StatItem label="Beta" value={quote.beta?.toFixed(2) ?? "N/A"} />
        <StatItem label="Open" value={`$${quote.open.toFixed(2)}`} />
        <StatItem
          label="Day Range"
          value={`$${quote.low.toFixed(2)} – $${quote.high.toFixed(2)}`}
        />
      </div>

      {/* 52-week range bar */}
      <div className="p-3 rounded-lg bg-[#0D0D0F] border border-[#1E1E22]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-[#555] uppercase tracking-widest">52-Week Range</span>
          <span className="text-[10px] num text-[#555]">{pos52w}% of range</span>
        </div>
        <div className="flex items-center justify-between text-[10px] num text-[#666] mb-2">
          <span>${quote.week52Low.toFixed(2)}</span>
          <span className="text-white text-xs font-bold">${quote.price.toFixed(2)}</span>
          <span>${quote.week52High.toFixed(2)}</span>
        </div>
        <div className="relative h-2 bg-[#1E1E22] rounded-full overflow-visible">
          <div
            className="absolute h-2 bg-gradient-to-r from-[#FF3B5C] via-[#F59E0B] to-[#00FF88] rounded-full"
            style={{ width: `${pos52w}%` }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow border-2 border-[#09090B]"
            style={{
              left: `${pos52w}%`,
              transform: `translate(-50%, -50%)`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
