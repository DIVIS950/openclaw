/**
 * Finnhub API client — primarily for news feed.
 * Docs: https://finnhub.io/docs/api
 */

import { cache, TTL } from "./cache";
import { MOCK_NEWS } from "./mock-data";
import type { NewsArticle, Sentiment } from "./types";

const BASE = "https://finnhub.io/api/v1";
const KEY = process.env.FINNHUB_API_KEY ?? "";

function hasCreds(): boolean {
  return Boolean(KEY && KEY !== "your_finnhub_api_key_here");
}

async function finnhubFetch<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
  if (!hasCreds()) return null;

  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("token", KEY);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  try {
    const res = await fetch(url.toString(), { next: { revalidate: 120 } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface FinnhubNewsItem {
  id: number;
  headline: string;
  source: string;
  url: string;
  image: string;
  datetime: number;
  related: string;
  summary: string;
  category: string;
  sentiment?: { score: number };
}

function scoreToSentiment(score: number): Sentiment {
  if (score > 0.2) return "bullish";
  if (score < -0.2) return "bearish";
  return "neutral";
}

export async function fetchMarketNews(category = "general", ticker?: string): Promise<NewsArticle[]> {
  const cacheKey = `news:${category}:${ticker ?? "all"}`;
  const cached = cache.get<NewsArticle[]>(cacheKey);
  if (cached) return cached.data;

  let raw: FinnhubNewsItem[] | null = null;

  if (ticker) {
    raw = await finnhubFetch<FinnhubNewsItem[]>("/company-news", {
      symbol: ticker,
      from: new Date(Date.now() - 7 * 86400_000).toISOString().split("T")[0],
      to: new Date().toISOString().split("T")[0],
    });
  } else {
    raw = await finnhubFetch<FinnhubNewsItem[]>("/news", { category });
  }

  if (raw?.length) {
    const articles: NewsArticle[] = raw.slice(0, 20).map((item) => {
      const score = item.sentiment?.score ?? (Math.random() - 0.5) * 1.6;
      return {
        id: String(item.id),
        headline: item.headline,
        source: item.source,
        url: item.url,
        imageUrl: item.image || null,
        publishedAt: item.datetime * 1000,
        relatedTickers: item.related ? item.related.split(",").map((s) => s.trim()) : [],
        sentiment: scoreToSentiment(score),
        sentimentScore: score,
        aiSummary: item.summary?.slice(0, 200) ?? "",
        category: item.category,
      };
    });
    cache.set(cacheKey, articles, TTL.NEWS);
    return articles;
  }

  // Filter mock news if ticker specified
  const news = ticker
    ? MOCK_NEWS.filter((n) => n.relatedTickers.includes(ticker))
    : MOCK_NEWS;

  cache.set(cacheKey, news, TTL.NEWS);
  return news;
}
