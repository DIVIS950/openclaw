export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { StockChart } from "@/components/stocks/StockChart";
import { AISignalCard } from "@/components/stocks/AISignalCard";
import { StatsGrid } from "@/components/stocks/StatsGrid";
import { CompanyProfile } from "@/components/stocks/CompanyProfile";
import { ChartSkeleton, CardSkeleton } from "@/components/common/LoadingSkeleton";
import { PriceDisplay } from "@/components/common/PriceDisplay";
import { StockLogo } from "@/components/common/StockLogo";
import { WatchlistToggle } from "@/components/watchlist/WatchlistToggle";
import {
  MOCK_QUOTES,
  MOCK_AI_SIGNALS,
  MOCK_PROFILES,
  MOCK_NEWS,
  generateMockCandles,
} from "@/lib/mock-data";
import { getLogoUrl, timeAgo, formatVolume } from "@/lib/utils";

interface PageProps {
  params: { ticker: string };
}

export async function generateMetadata({ params }: PageProps) {
  const ticker = params.ticker.toUpperCase();
  const quote = MOCK_QUOTES[ticker];
  return {
    title: quote
      ? `${ticker} — ${quote.name} | TradeVision AI`
      : `${ticker} | TradeVision AI`,
  };
}

export default async function StockPage({ params }: PageProps) {
  const ticker = params.ticker.toUpperCase();

  const quote = MOCK_QUOTES[ticker] ?? {
    ticker,
    name: ticker,
    price: 100 + Math.random() * 200,
    change: (Math.random() - 0.5) * 10,
    changePercent: (Math.random() - 0.5) * 5,
    open: 100,
    high: 110,
    low: 95,
    previousClose: 99,
    volume: 10_000_000,
    avgVolume: 12_000_000,
    marketCap: 100_000_000_000,
    peRatio: 25,
    eps: 4.0,
    dividendYield: 1.2,
    week52High: 130,
    week52Low: 70,
    beta: 1.1,
    logoUrl: getLogoUrl(ticker),
    exchange: "NASDAQ",
    currency: "USD",
    lastUpdated: Date.now(),
  };

  const signal = MOCK_AI_SIGNALS.find((s) => s.ticker === ticker) ?? {
    ticker,
    signal: "hold" as const,
    confidence: 55,
    riskLevel: "medium" as const,
    reasoning: [
      "Limited data available for this ticker",
      "Price action shows consolidation pattern",
      "Monitor volume and momentum indicators",
      "Consider waiting for clearer directional signal",
    ],
    targetPrice: null,
    stopLoss: parseFloat((quote.price * 0.92).toFixed(2)),
    generatedAt: Date.now(),
    modelVersion: "mock",
  };

  const profile = MOCK_PROFILES[ticker] ?? {
    ticker,
    name: quote.name,
    description: `${quote.name} is a publicly traded company listed on the ${quote.exchange} exchange. Real company profile data is available with a valid Finnhub API key.`,
    sector: "Technology",
    industry: "N/A",
    ceo: "N/A",
    employees: 0,
    headquarters: "N/A",
    website: `${ticker.toLowerCase()}.com`,
    founded: 2000,
    logoUrl: getLogoUrl(ticker),
  };

  const relatedNews = MOCK_NEWS.filter((n) =>
    n.relatedTickers.includes(ticker)
  );

  const initialCandles = generateMockCandles(quote.price, 78, 5 * 60_000);

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* Hero section */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div className="flex items-center gap-4">
          {/* Logo */}
          <div className="w-14 h-14 rounded-xl bg-[#111113] border border-[#1E1E22] flex items-center justify-center overflow-hidden flex-shrink-0">
            <StockLogo src={quote.logoUrl} ticker={ticker} size={40} />
          </div>

          {/* Name + ticker */}
          <div>
            <div className="flex items-center gap-3 mb-0.5">
              <h1 className="text-3xl font-black text-white num tracking-tight">
                {ticker}
              </h1>
              <span className="text-[10px] text-[#555] bg-[#111113] border border-[#1E1E22] px-2 py-0.5 rounded-full">
                {quote.exchange}
              </span>
            </div>
            <div className="text-sm text-[#666]">{quote.name}</div>
          </div>
        </div>

        {/* Price */}
        <div className="flex flex-col items-start lg:items-end gap-2">
          <PriceDisplay
            price={quote.price}
            change={quote.change}
            changePercent={quote.changePercent}
            size="xl"
            showChange
          />
          <div className="flex items-center gap-3">
            <span className="text-xs text-[#555] num">
              Vol: {formatVolume(quote.volume)}
            </span>
            <WatchlistToggle ticker={ticker} name={quote.name} />
          </div>
        </div>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Left: Chart */}
        <div className="xl:col-span-2 space-y-4">
          <StockChart
            ticker={ticker}
            initialData={initialCandles}
          />
          <StatsGrid quote={quote} />
          <CompanyProfile profile={profile} />

          {/* Related news */}
          {relatedNews.length > 0 && (
            <div className="glass rounded-xl border border-[#1E1E22] p-4">
              <h3 className="text-xs font-semibold text-[#666] uppercase tracking-widest mb-3">
                Related News
              </h3>
              <div className="space-y-3">
                {relatedNews.map((article) => (
                  <div
                    key={article.id}
                    className="border-l-2 border-[#1E1E22] pl-3"
                  >
                    <div className="text-sm text-[#888] font-medium leading-snug mb-1">
                      {article.headline}
                    </div>
                    <div className="text-xs text-[#555] flex items-center gap-2">
                      <span>{article.source}</span>
                      <span>·</span>
                      <span>{timeAgo(article.publishedAt)}</span>
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                        style={{
                          color:
                            article.sentiment === "bullish"
                              ? "#00FF88"
                              : article.sentiment === "bearish"
                              ? "#FF3B5C"
                              : "#F59E0B",
                          background:
                            article.sentiment === "bullish"
                              ? "rgba(0,255,136,0.1)"
                              : article.sentiment === "bearish"
                              ? "rgba(255,59,92,0.1)"
                              : "rgba(245,158,11,0.1)",
                        }}
                      >
                        {article.sentiment === "bullish"
                          ? "🟢 Bullish"
                          : article.sentiment === "bearish"
                          ? "🔴 Bearish"
                          : "🟡 Neutral"}
                      </span>
                    </div>
                    <p className="text-xs text-[#555] mt-1 leading-relaxed">
                      {article.aiSummary}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: AI Signal */}
        <div className="space-y-4">
          <AISignalCard signal={signal} />

          {/* Last updated notice */}
          <div className="text-center text-[10px] text-[#333]">
            Data refreshes every 30s
          </div>
        </div>
      </div>
    </div>
  );
}
