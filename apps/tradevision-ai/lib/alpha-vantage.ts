/**
 * Alpha Vantage API client with caching + mock fallback.
 * Docs: https://www.alphavantage.co/documentation/
 */

import { cache, TTL } from "./cache";
import {
  MOCK_QUOTES,
  MOCK_SEARCH_RESULTS,
  generateMockCandles,
} from "./mock-data";
import type { StockQuote, CandleData, SearchResult } from "./types";
import { getLogoUrl } from "./utils";

const BASE = "https://www.alphavantage.co/query";
const KEY = process.env.ALPHA_VANTAGE_API_KEY ?? "";

function hasCreds(): boolean {
  return Boolean(KEY && KEY !== "your_alpha_vantage_key_here");
}

async function avFetch<T>(params: Record<string, string>): Promise<T | null> {
  if (!hasCreds()) return null;

  const url = new URL(BASE);
  url.searchParams.set("apikey", KEY);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  try {
    const res = await fetch(url.toString(), { next: { revalidate: 30 } });
    if (!res.ok) return null;
    const json = (await res.json()) as T;
    // Alpha Vantage returns error info inside the response object
    if (
      typeof json === "object" &&
      json !== null &&
      "Note" in json
    ) {
      console.warn("Alpha Vantage rate limit hit");
      return null;
    }
    return json;
  } catch {
    return null;
  }
}

// ─── Global Quote ─────────────────────────────────────────────────────────────

interface AVGlobalQuoteResponse {
  "Global Quote": {
    "01. symbol": string;
    "05. price": string;
    "09. change": string;
    "10. change percent": string;
    "02. open": string;
    "03. high": string;
    "04. low": string;
    "08. previous close": string;
    "06. volume": string;
  };
}

export async function fetchQuote(ticker: string): Promise<StockQuote | null> {
  const key = `quote:${ticker}`;
  const cached = cache.get<StockQuote>(key);
  if (cached) return cached.data;

  // Try Alpha Vantage
  const raw = await avFetch<AVGlobalQuoteResponse>({
    function: "GLOBAL_QUOTE",
    symbol: ticker,
  });

  if (raw?.["Global Quote"]?.["01. symbol"]) {
    const q = raw["Global Quote"];
    const price = parseFloat(q["05. price"]);
    const change = parseFloat(q["09. change"]);
    const pct = parseFloat(q["10. change percent"].replace("%", ""));
    const prevClose = parseFloat(q["08. previous close"]);

    const quote: StockQuote = {
      ticker,
      name: ticker, // AV basic quote doesn't return company name
      price,
      change,
      changePercent: pct,
      open: parseFloat(q["02. open"]),
      high: parseFloat(q["03. high"]),
      low: parseFloat(q["04. low"]),
      previousClose: prevClose,
      volume: parseInt(q["06. volume"], 10),
      avgVolume: 0,
      marketCap: 0,
      peRatio: null,
      eps: null,
      dividendYield: null,
      week52High: 0,
      week52Low: 0,
      beta: null,
      logoUrl: getLogoUrl(ticker),
      exchange: "NASDAQ",
      currency: "USD",
      lastUpdated: Date.now(),
    };

    cache.set(key, quote, TTL.QUOTE);
    return quote;
  }

  // Fallback to mock data
  const mock = MOCK_QUOTES[ticker.toUpperCase()];
  if (mock) {
    cache.set(key, mock, TTL.QUOTE);
    return mock;
  }

  return null;
}

// ─── Intraday Candles ─────────────────────────────────────────────────────────

interface AVTimeSeriesResponse {
  "Time Series (5min)"?: Record<
    string,
    { "1. open": string; "2. high": string; "3. low": string; "4. close": string; "5. volume": string }
  >;
  "Weekly Time Series"?: Record<
    string,
    { "1. open": string; "2. high": string; "3. low": string; "4. close": string; "5. volume": string }
  >;
  "Monthly Time Series"?: Record<
    string,
    { "1. open": string; "2. high": string; "3. low": string; "4. close": string; "5. volume": string }
  >;
}

export async function fetchCandles(
  ticker: string,
  interval: "1D" | "1W" | "1M" | "3M" | "1Y" | "5Y" | "MAX"
): Promise<CandleData[]> {
  const cacheKey = `candles:${ticker}:${interval}`;
  const cached = cache.get<CandleData[]>(cacheKey);
  if (cached) return cached.data;

  const basePrice = MOCK_QUOTES[ticker]?.price ?? 150;

  // For now, generate realistic mock candles (live chart data is expensive API-wise)
  const configs: Record<string, [number, number, number]> = {
    "1D": [78, 5 * 60_000, 300_000],   // 78 x 5min bars
    "1W": [35, 60 * 60_000, 900_000],   // 35 x 1hr bars
    "1M": [30, 24 * 3600_000, 2_000_000],
    "3M": [90, 24 * 3600_000, 3_000_000],
    "1Y": [252, 24 * 3600_000, 5_000_000],
    "5Y": [260, 7 * 24 * 3600_000, 10_000_000],
    MAX: [200, 30 * 24 * 3600_000, 15_000_000],
  };

  const [count, intervalMs] = configs[interval] ?? configs["1D"];
  const candles = generateMockCandles(basePrice, count, intervalMs);

  cache.set(cacheKey, candles, TTL.CANDLES);
  return candles;
}

// ─── Symbol Search ────────────────────────────────────────────────────────────

interface AVSearchResponse {
  bestMatches: Array<{
    "1. symbol": string;
    "2. name": string;
    "4. region": string;
    "3. type": string;
  }>;
}

export async function searchSymbols(query: string): Promise<SearchResult[]> {
  const cacheKey = `search:${query}`;
  const cached = cache.get<SearchResult[]>(cacheKey);
  if (cached) return cached.data;

  const raw = await avFetch<AVSearchResponse>({
    function: "SYMBOL_SEARCH",
    keywords: query,
  });

  if (raw?.bestMatches?.length) {
    const results: SearchResult[] = raw.bestMatches.slice(0, 8).map((m) => ({
      ticker: m["1. symbol"],
      name: m["2. name"],
      exchange: m["4. region"],
      type: m["3. type"],
      logoUrl: getLogoUrl(m["1. symbol"]),
    }));
    cache.set(cacheKey, results, TTL.SEARCH);
    return results;
  }

  // Filter mock results
  const q = query.toLowerCase();
  const results = MOCK_SEARCH_RESULTS.filter(
    (r) =>
      r.ticker.toLowerCase().includes(q) ||
      r.name.toLowerCase().includes(q)
  );
  cache.set(cacheKey, results, TTL.SEARCH);
  return results;
}
