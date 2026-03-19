"use client";

import { useState } from "react";
import { MOCK_NEWS } from "@/lib/mock-data";
import { cn, timeAgo, sentimentColor, sentimentLabel } from "@/lib/utils";
import type { NewsArticle, Sentiment } from "@/lib/types";
import { Newspaper, Filter, X, ExternalLink, Zap } from "lucide-react";

const CATEGORIES = ["All", "Earnings", "Macro", "AI", "Crypto", "Product", "Recall"];
const SENTIMENTS: Sentiment[] = ["bullish", "neutral", "bearish"];

function SentimentBadge({ sentiment }: { sentiment: Sentiment }) {
  const color = sentimentColor(sentiment);
  const emoji = sentiment === "bullish" ? "🟢" : sentiment === "bearish" ? "🔴" : "🟡";
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
      style={{ color, background: `${color}15`, border: `1px solid ${color}30` }}
    >
      {emoji} {sentimentLabel(sentiment)}
    </span>
  );
}

function NewsCard({ article, onClick }: { article: NewsArticle; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="glass glass-hover rounded-xl border border-[#1E1E22] p-4 text-left w-full group"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-[#555] uppercase tracking-wide">
            {article.source}
          </span>
          <span className="text-[10px] text-[#333]">·</span>
          <span className="text-[10px] text-[#444]">{timeAgo(article.publishedAt)}</span>
        </div>
        <SentimentBadge sentiment={article.sentiment} />
      </div>

      <h2 className="text-sm font-semibold text-white leading-snug mb-2 group-hover:text-[#3B82F6] transition-colors">
        {article.headline}
      </h2>

      <p className="text-xs text-[#666] leading-relaxed line-clamp-2">
        {article.aiSummary}
      </p>

      {article.relatedTickers.length > 0 && (
        <div className="flex gap-1.5 mt-3 flex-wrap">
          {article.relatedTickers.map((t) => (
            <span
              key={t}
              className="text-[10px] px-1.5 py-0.5 rounded bg-[#1A1A1E] text-[#888] border border-[#2A2A30] num font-mono"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {article.category && (
        <div className="mt-2">
          <span className="text-[9px] text-[#444] uppercase tracking-widest">
            {article.category}
          </span>
        </div>
      )}
    </button>
  );
}

function NewsModal({ article, onClose }: { article: NewsArticle; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative glass rounded-2xl border border-[#2A2A32] p-6 w-full max-w-2xl shadow-2xl max-h-[80vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <SentimentBadge sentiment={article.sentiment} />
              <span className="text-xs text-[#555]">{article.source} · {timeAgo(article.publishedAt)}</span>
            </div>
            <h2 className="text-lg font-bold text-white leading-snug">{article.headline}</h2>
          </div>
          <button onClick={onClose} className="text-[#555] hover:text-white transition-colors flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        {/* AI Analysis section */}
        <div className="bg-[#0D0D0F] rounded-xl border border-[#1E1E22] p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Zap size={12} className="text-[#F59E0B]" />
            <span className="text-[10px] text-[#555] uppercase tracking-widest font-semibold">
              AI Market Impact Analysis
            </span>
          </div>
          <p className="text-sm text-[#888] leading-relaxed">{article.aiSummary}</p>

          <div className="mt-3 flex items-center gap-2">
            <div className="text-[10px] text-[#555]">Sentiment Score:</div>
            <div className="flex-1 h-1.5 bg-[#1E1E22] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.abs(article.sentimentScore) * 100}%`,
                  marginLeft: article.sentimentScore < 0 ? "auto" : "0",
                  background: article.sentimentScore > 0 ? "#00FF88" : "#FF3B5C",
                }}
              />
            </div>
            <div
              className="text-[10px] num font-bold"
              style={{ color: sentimentColor(article.sentiment) }}
            >
              {article.sentimentScore > 0 ? "+" : ""}
              {article.sentimentScore.toFixed(2)}
            </div>
          </div>
        </div>

        {article.relatedTickers.length > 0 && (
          <div className="mb-4">
            <div className="text-[10px] text-[#555] uppercase tracking-widest mb-2">
              Related Stocks
            </div>
            <div className="flex flex-wrap gap-2">
              {article.relatedTickers.map((t) => (
                <a
                  key={t}
                  href={`/stocks/${t}`}
                  className="text-xs px-2.5 py-1 rounded-lg bg-[#1A1A1E] text-[#3B82F6] border border-[#3B82F6]/20 num font-mono hover:bg-[#3B82F6]/10 transition-colors"
                >
                  {t}
                </a>
              ))}
            </div>
          </div>
        )}

        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-xs text-[#3B82F6] hover:text-[#60A5FA] transition-colors"
        >
          <ExternalLink size={13} />
          Read full article on {article.source}
        </a>
      </div>
    </div>
  );
}

export default function NewsPage() {
  const [category, setCategory] = useState("All");
  const [activeSentiments, setActiveSentiments] = useState<Sentiment[]>([]);
  const [selected, setSelected] = useState<NewsArticle | null>(null);

  const filtered = MOCK_NEWS.filter((n) => {
    const catMatch = category === "All" || n.category === category;
    const sentMatch =
      activeSentiments.length === 0 || activeSentiments.includes(n.sentiment);
    return catMatch && sentMatch;
  });

  const toggleSentiment = (s: Sentiment) => {
    setActiveSentiments((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Newspaper size={22} className="text-[#3B82F6]" />
          AI News Feed
        </h1>
        <p className="text-sm text-[#555] mt-1">
          Market news with AI sentiment analysis
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Category tabs */}
        <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-all",
                category === cat
                  ? "bg-[#3B82F6]/20 text-[#3B82F6] border border-[#3B82F6]/30"
                  : "text-[#555] bg-[#111113] border border-[#1E1E22] hover:text-white"
              )}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Sentiment filters */}
        <div className="flex gap-1">
          {SENTIMENTS.map((s) => {
            const color = sentimentColor(s);
            const active = activeSentiments.includes(s);
            return (
              <button
                key={s}
                onClick={() => toggleSentiment(s)}
                className="text-[10px] font-semibold px-2.5 py-1.5 rounded-lg transition-all border"
                style={{
                  color: active ? color : "#555",
                  background: active ? `${color}15` : "#111113",
                  borderColor: active ? `${color}30` : "#1E1E22",
                }}
              >
                {s === "bullish" ? "🟢" : s === "bearish" ? "🔴" : "🟡"}
                {" "}{sentimentLabel(s)}
              </button>
            );
          })}
        </div>
      </div>

      {/* News grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map((article) => (
          <NewsCard
            key={article.id}
            article={article}
            onClick={() => setSelected(article)}
          />
        ))}
        {filtered.length === 0 && (
          <div className="col-span-2 glass rounded-xl border border-[#1E1E22] p-12 text-center">
            <Filter size={28} className="text-[#333] mx-auto mb-3" />
            <p className="text-[#666]">No articles match your filters</p>
          </div>
        )}
      </div>

      {/* Modal */}
      {selected && (
        <NewsModal article={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
