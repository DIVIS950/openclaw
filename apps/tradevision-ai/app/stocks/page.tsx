import Link from "next/link";
import { MOCK_SEARCH_RESULTS, TRENDING_TICKERS, MOCK_QUOTES } from "@/lib/mock-data";
import { formatPrice, formatPercent, changeTextClass } from "@/lib/utils";
import { Search, TrendingUp } from "lucide-react";
import { StockLogo } from "@/components/common/StockLogo";

export default function StocksPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Stock Explorer</h1>
        <p className="text-sm text-[#555] mt-1">
          Search for any stock to see AI-powered analysis
        </p>
      </div>

      {/* Search hint */}
      <div className="glass rounded-xl border border-[#1E1E22] p-8 text-center">
        <Search size={32} className="text-[#333] mx-auto mb-3" />
        <p className="text-[#666] mb-1">Use ⌘K to search for any stock</p>
        <p className="text-xs text-[#444]">
          Or click a trending stock below
        </p>
      </div>

      {/* Trending */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp size={14} className="text-[#00FF88]" />
          <h2 className="text-sm font-semibold text-[#888] uppercase tracking-widest">
            Trending Stocks
          </h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {TRENDING_TICKERS.map((ticker) => {
            const q = MOCK_QUOTES[ticker];
            if (!q) return null;
            return (
              <Link
                key={ticker}
                href={`/stocks/${ticker}`}
                className="glass glass-hover rounded-xl p-4 border border-[#1E1E22] group"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-[#1A1A1E] flex items-center justify-center overflow-hidden">
                    <StockLogo src={q.logoUrl} ticker={ticker} size={24} />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white num group-hover:text-[#3B82F6] transition-colors">
                      {ticker}
                    </div>
                  </div>
                </div>
                <div className="num text-lg font-bold text-white">
                  ${formatPrice(q.price)}
                </div>
                <div className={`text-xs num font-medium ${changeTextClass(q.changePercent)}`}>
                  {q.changePercent >= 0 ? "▲" : "▼"} {formatPercent(q.changePercent)}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
