// ─── Stock & Market Types ────────────────────────────────────────────────────

export type Signal = "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";
export type RiskLevel = "low" | "medium" | "high";
export type Sentiment = "bullish" | "bearish" | "neutral";
export type TimeFrame = "1D" | "1W" | "1M" | "3M" | "1Y" | "5Y" | "MAX";
export type ChartType = "candlestick" | "line" | "area";

export interface StockQuote {
  ticker: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  volume: number;
  avgVolume: number;
  marketCap: number;
  peRatio: number | null;
  eps: number | null;
  dividendYield: number | null;
  week52High: number;
  week52Low: number;
  beta: number | null;
  logoUrl: string;
  exchange: string;
  currency: string;
  lastUpdated: number; // unix ms
}

export interface CandleData {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TimeSeriesPoint {
  time: number; // unix ms
  value: number;
}

export interface CompanyProfile {
  ticker: string;
  name: string;
  description: string;
  sector: string;
  industry: string;
  ceo: string;
  employees: number;
  headquarters: string;
  website: string;
  founded: number;
  logoUrl: string;
}

// ─── AI Signal Types ─────────────────────────────────────────────────────────

export interface AISignal {
  ticker: string;
  signal: Signal;
  confidence: number; // 0-100
  riskLevel: RiskLevel;
  reasoning: string[];
  targetPrice: number | null;
  stopLoss: number | null;
  generatedAt: number; // unix ms
  modelVersion: string;
}

// ─── News Types ───────────────────────────────────────────────────────────────

export interface NewsArticle {
  id: string;
  headline: string;
  source: string;
  url: string;
  imageUrl: string | null;
  publishedAt: number; // unix ms
  relatedTickers: string[];
  sentiment: Sentiment;
  sentimentScore: number; // -1 to 1
  aiSummary: string;
  category: string;
}

// ─── Market Index Types ───────────────────────────────────────────────────────

export interface MarketIndex {
  name: string;
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  sparkline: number[]; // last N prices for mini chart
}

export interface SectorPerformance {
  sector: string;
  changePercent: number;
  marketCap: number; // billions
  color?: string;
}

export interface TopMover {
  ticker: string;
  name: string;
  price: number;
  changePercent: number;
  volume: number;
  sparkline: number[];
}

export interface MarketPulse {
  sentimentScore: number; // 0-100
  summary: string;
  bullishFactors: string[];
  bearishFactors: string[];
  generatedAt: number;
}

// ─── Watchlist & Portfolio Types ──────────────────────────────────────────────

export interface WatchlistItem {
  ticker: string;
  name: string;
  addedAt: number;
  notes: string;
}

export interface PortfolioHolding {
  id: string;
  ticker: string;
  name: string;
  shares: number;
  avgBuyPrice: number;
  addedAt: number;
}

export interface PortfolioHoldingWithData extends PortfolioHolding {
  currentPrice: number;
  currentValue: number;
  totalCost: number;
  pnl: number;
  pnlPercent: number;
  dayChange: number;
  dayChangePercent: number;
  logoUrl: string;
  color: string; // for chart
}

// ─── Search Types ─────────────────────────────────────────────────────────────

export interface SearchResult {
  ticker: string;
  name: string;
  exchange: string;
  type: string;
  logoUrl: string;
}

// ─── Chat Types ───────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  relatedTickers?: string[];
}

// ─── API Response Wrappers ────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  cached: boolean;
  lastUpdated: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  hasMore: boolean;
}
