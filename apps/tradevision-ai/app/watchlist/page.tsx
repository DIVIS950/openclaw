"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { SparklineChart } from "@/components/common/SparklineChart";
import { SignalBadge } from "@/components/common/SignalBadge";
import { formatPrice, formatPercent, changeTextClass, timeAgo, generateSparkline } from "@/lib/utils";
import { MOCK_QUOTES, MOCK_AI_SIGNALS, TRENDING_TICKERS } from "@/lib/mock-data";
import { Star, Plus, X, TrendingUp, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export default function WatchlistPage() {
  const [tickers, setTickers] = useState<string[]>([]);
  const [addQuery, setAddQuery] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const list = JSON.parse(localStorage.getItem("watchlist") ?? "[]") as string[];
      setTickers(list.length > 0 ? list : TRENDING_TICKERS.slice(0, 4));
    } catch {
      setTickers(TRENDING_TICKERS.slice(0, 4));
    }
  }, []);

  const remove = (ticker: string) => {
    const updated = tickers.filter((t) => t !== ticker);
    setTickers(updated);
    try {
      localStorage.setItem("watchlist", JSON.stringify(updated));
    } catch {}
  };

  const add = (ticker: string) => {
    const t = ticker.toUpperCase().trim();
    if (!t || tickers.includes(t)) return;
    const updated = [...tickers, t];
    setTickers(updated);
    setAddQuery("");
    try {
      localStorage.setItem("watchlist", JSON.stringify(updated));
    } catch {}
  };

  if (!mounted) return null;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Star size={22} className="text-[#F59E0B] fill-[#F59E0B]" />
            Watchlist
          </h1>
          <p className="text-sm text-[#555] mt-1">
            {tickers.length} stock{tickers.length !== 1 ? "s" : ""} tracked
          </p>
        </div>

        {/* Add stock */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555]" />
            <input
              type="text"
              placeholder="Add ticker (e.g. TSLA)"
              value={addQuery}
              onChange={(e) => setAddQuery(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && add(addQuery)}
              className="pl-8 pr-3 py-2 text-sm bg-[#111113] border border-[#1E1E22] rounded-lg text-white placeholder-[#444] outline-none focus:border-[#3B82F6] transition-colors num w-48"
            />
          </div>
          <button
            onClick={() => add(addQuery)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#3B82F6]/20 text-[#3B82F6] border border-[#3B82F6]/30 rounded-lg hover:bg-[#3B82F6]/30 transition-colors"
          >
            <Plus size={13} />
            Add
          </button>
        </div>
      </div>

      {tickers.length === 0 ? (
        <div className="glass rounded-xl border border-[#1E1E22] p-12 text-center">
          <Star size={32} className="text-[#333] mx-auto mb-3" />
          <p className="text-[#666]">Your watchlist is empty</p>
          <p className="text-xs text-[#444] mt-1">
            Add stocks using the input above or the Watch button on any stock page
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {tickers.map((ticker) => {
            const q = MOCK_QUOTES[ticker];
            const signal = MOCK_AI_SIGNALS.find((s) => s.ticker === ticker);
            const price = q?.price ?? 100 + Math.random() * 200;
            const changePct = q?.changePercent ?? (Math.random() - 0.5) * 5;
            const sparkline = generateSparkline(price, 20, 0.015);

            return (
              <div
                key={ticker}
                className="glass glass-hover rounded-xl border border-[#1E1E22] p-4 flex items-center gap-4"
              >
                {/* Logo */}
                <div className="w-10 h-10 rounded-lg bg-[#1A1A1E] flex items-center justify-center overflow-hidden flex-shrink-0">
                  {q?.logoUrl && (
                    <img
                      src={q.logoUrl}
                      alt={ticker}
                      className="w-7 h-7 object-contain"
                      onError={() => {}}
                    />
                  )}
                </div>

                {/* Ticker + name */}
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/stocks/${ticker}`}
                    className="text-sm font-bold text-white num hover:text-[#3B82F6] transition-colors"
                  >
                    {ticker}
                  </Link>
                  <div className="text-xs text-[#555] truncate">
                    {q?.name ?? ticker}
                  </div>
                </div>

                {/* Sparkline */}
                <div className="hidden sm:block">
                  <SparklineChart
                    data={sparkline}
                    width={80}
                    height={32}
                    color={changePct >= 0 ? "#00FF88" : "#FF3B5C"}
                  />
                </div>

                {/* Signal */}
                {signal && (
                  <div className="hidden md:block">
                    <SignalBadge signal={signal.signal} size="sm" />
                  </div>
                )}

                {/* Price */}
                <div className="text-right flex-shrink-0">
                  <div className="text-sm num font-bold text-white">
                    ${formatPrice(price)}
                  </div>
                  <div className={cn("text-xs num font-medium", changeTextClass(changePct))}>
                    {changePct >= 0 ? "▲" : "▼"} {formatPercent(Math.abs(changePct))}
                  </div>
                </div>

                {/* Remove */}
                <button
                  onClick={() => remove(ticker)}
                  className="text-[#333] hover:text-[#FF3B5C] transition-colors flex-shrink-0"
                >
                  <X size={16} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Suggestion */}
      <div className="glass rounded-xl border border-[#1E1E22] p-4">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp size={13} className="text-[#00FF88]" />
          <span className="text-xs font-semibold text-[#666] uppercase tracking-widest">
            Trending — Quick Add
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {TRENDING_TICKERS.filter((t) => !tickers.includes(t)).map((t) => (
            <button
              key={t}
              onClick={() => add(t)}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-mono text-[#888] bg-[#111113] border border-[#1E1E22] rounded-lg hover:text-white hover:border-[#333] transition-colors"
            >
              <Plus size={10} />
              {t}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
