/**
 * Rich mock data — used when real API keys are absent (or for dev speed).
 * All prices/numbers are plausible but fictional.
 */

import type {
  StockQuote,
  MarketIndex,
  SectorPerformance,
  TopMover,
  NewsArticle,
  AISignal,
  MarketPulse,
  CompanyProfile,
  CandleData,
  SearchResult,
} from "./types";
import { generateSparkline, getLogoUrl } from "./utils";

// ─── Market Indices ───────────────────────────────────────────────────────────

export const MOCK_INDICES: MarketIndex[] = [
  {
    name: "S&P 500",
    ticker: "SPX",
    price: 5284.32,
    change: 47.8,
    changePercent: 0.91,
    sparkline: [5210, 5222, 5198, 5241, 5256, 5248, 5263, 5271, 5280, 5284],
  },
  {
    name: "NASDAQ",
    ticker: "COMP",
    price: 16542.18,
    change: 183.6,
    changePercent: 1.12,
    sparkline: [16280, 16310, 16290, 16380, 16420, 16410, 16460, 16500, 16530, 16542],
  },
  {
    name: "DOW JONES",
    ticker: "DJI",
    price: 39847.56,
    change: -124.3,
    changePercent: -0.31,
    sparkline: [39980, 39960, 39940, 39900, 39870, 39890, 39850, 39840, 39850, 39847],
  },
  {
    name: "FTSE 100",
    ticker: "FTSE",
    price: 8342.75,
    change: 62.1,
    changePercent: 0.75,
    sparkline: [8260, 8275, 8268, 8295, 8310, 8305, 8320, 8335, 8340, 8342],
  },
];

// ─── Stock Quotes ─────────────────────────────────────────────────────────────

export const MOCK_QUOTES: Record<string, StockQuote> = {
  AAPL: {
    ticker: "AAPL",
    name: "Apple Inc.",
    price: 213.49,
    change: 3.21,
    changePercent: 1.53,
    open: 210.82,
    high: 214.2,
    low: 210.15,
    previousClose: 210.28,
    volume: 58_423_100,
    avgVolume: 61_200_000,
    marketCap: 3_280_000_000_000,
    peRatio: 32.4,
    eps: 6.59,
    dividendYield: 0.52,
    week52High: 237.23,
    week52Low: 164.08,
    beta: 1.24,
    logoUrl: getLogoUrl("AAPL"),
    exchange: "NASDAQ",
    currency: "USD",
    lastUpdated: Date.now(),
  },
  TSLA: {
    ticker: "TSLA",
    name: "Tesla, Inc.",
    price: 248.34,
    change: -7.82,
    changePercent: -3.05,
    open: 256.1,
    high: 258.4,
    low: 246.8,
    previousClose: 256.16,
    volume: 112_840_000,
    avgVolume: 98_600_000,
    marketCap: 792_000_000_000,
    peRatio: 68.1,
    eps: 3.65,
    dividendYield: null,
    week52High: 299.29,
    week52Low: 138.8,
    beta: 2.31,
    logoUrl: getLogoUrl("TSLA"),
    exchange: "NASDAQ",
    currency: "USD",
    lastUpdated: Date.now(),
  },
  NVDA: {
    ticker: "NVDA",
    name: "NVIDIA Corporation",
    price: 875.4,
    change: 28.63,
    changePercent: 3.38,
    open: 848.5,
    high: 882.0,
    low: 845.2,
    previousClose: 846.77,
    volume: 43_200_000,
    avgVolume: 39_800_000,
    marketCap: 2_150_000_000_000,
    peRatio: 72.8,
    eps: 12.02,
    dividendYield: 0.03,
    week52High: 974.0,
    week52Low: 373.1,
    beta: 1.67,
    logoUrl: getLogoUrl("NVDA"),
    exchange: "NASDAQ",
    currency: "USD",
    lastUpdated: Date.now(),
  },
  MSFT: {
    ticker: "MSFT",
    name: "Microsoft Corporation",
    price: 418.72,
    change: 5.48,
    changePercent: 1.33,
    open: 413.5,
    high: 420.1,
    low: 412.8,
    previousClose: 413.24,
    volume: 22_100_000,
    avgVolume: 23_400_000,
    marketCap: 3_110_000_000_000,
    peRatio: 36.2,
    eps: 11.57,
    dividendYield: 0.72,
    week52High: 468.35,
    week52Low: 309.45,
    beta: 0.89,
    logoUrl: getLogoUrl("MSFT"),
    exchange: "NASDAQ",
    currency: "USD",
    lastUpdated: Date.now(),
  },
  GOOGL: {
    ticker: "GOOGL",
    name: "Alphabet Inc.",
    price: 167.83,
    change: 2.12,
    changePercent: 1.28,
    open: 165.9,
    high: 168.5,
    low: 165.1,
    previousClose: 165.71,
    volume: 28_900_000,
    avgVolume: 27_100_000,
    marketCap: 2_080_000_000_000,
    peRatio: 23.4,
    eps: 7.17,
    dividendYield: null,
    week52High: 191.75,
    week52Low: 121.4,
    beta: 1.05,
    logoUrl: getLogoUrl("GOOGL"),
    exchange: "NASDAQ",
    currency: "USD",
    lastUpdated: Date.now(),
  },
  META: {
    ticker: "META",
    name: "Meta Platforms, Inc.",
    price: 524.18,
    change: 11.72,
    changePercent: 2.29,
    open: 513.4,
    high: 526.8,
    low: 511.2,
    previousClose: 512.46,
    volume: 16_700_000,
    avgVolume: 17_900_000,
    marketCap: 1_320_000_000_000,
    peRatio: 27.6,
    eps: 18.99,
    dividendYield: null,
    week52High: 589.57,
    week52Low: 271.17,
    beta: 1.18,
    logoUrl: getLogoUrl("META"),
    exchange: "NASDAQ",
    currency: "USD",
    lastUpdated: Date.now(),
  },
  AMZN: {
    ticker: "AMZN",
    name: "Amazon.com, Inc.",
    price: 192.45,
    change: -1.83,
    changePercent: -0.94,
    open: 194.2,
    high: 195.1,
    low: 191.3,
    previousClose: 194.28,
    volume: 34_800_000,
    avgVolume: 38_100_000,
    marketCap: 2_010_000_000_000,
    peRatio: 58.3,
    eps: 3.3,
    dividendYield: null,
    week52High: 224.0,
    week52Low: 118.35,
    beta: 1.12,
    logoUrl: getLogoUrl("AMZN"),
    exchange: "NASDAQ",
    currency: "USD",
    lastUpdated: Date.now(),
  },
  COIN: {
    ticker: "COIN",
    name: "Coinbase Global, Inc.",
    price: 214.82,
    change: 18.34,
    changePercent: 9.33,
    open: 196.5,
    high: 218.7,
    low: 195.2,
    previousClose: 196.48,
    volume: 24_300_000,
    avgVolume: 12_100_000,
    marketCap: 53_000_000_000,
    peRatio: 42.1,
    eps: 5.1,
    dividendYield: null,
    week52High: 298.0,
    week52Low: 51.28,
    beta: 3.24,
    logoUrl: getLogoUrl("COIN"),
    exchange: "NASDAQ",
    currency: "USD",
    lastUpdated: Date.now(),
  },
};

// ─── Top Movers ───────────────────────────────────────────────────────────────

export const MOCK_GAINERS: TopMover[] = [
  {
    ticker: "COIN",
    name: "Coinbase",
    price: 214.82,
    changePercent: 9.33,
    volume: 24_300_000,
    sparkline: generateSparkline(196.5, 15, 0.04),
  },
  {
    ticker: "NVDA",
    name: "NVIDIA",
    price: 875.4,
    changePercent: 3.38,
    volume: 43_200_000,
    sparkline: generateSparkline(848.5, 15, 0.02),
  },
  {
    ticker: "META",
    name: "Meta",
    price: 524.18,
    changePercent: 2.29,
    volume: 16_700_000,
    sparkline: generateSparkline(513.4, 15, 0.02),
  },
  {
    ticker: "AAPL",
    name: "Apple",
    price: 213.49,
    changePercent: 1.53,
    volume: 58_423_100,
    sparkline: generateSparkline(210.82, 15, 0.01),
  },
  {
    ticker: "MSFT",
    name: "Microsoft",
    price: 418.72,
    changePercent: 1.33,
    volume: 22_100_000,
    sparkline: generateSparkline(413.5, 15, 0.01),
  },
];

export const MOCK_LOSERS: TopMover[] = [
  {
    ticker: "TSLA",
    name: "Tesla",
    price: 248.34,
    changePercent: -3.05,
    volume: 112_840_000,
    sparkline: generateSparkline(256.1, 15, 0.03),
  },
  {
    ticker: "AMZN",
    name: "Amazon",
    price: 192.45,
    changePercent: -0.94,
    volume: 34_800_000,
    sparkline: generateSparkline(194.2, 15, 0.01),
  },
  {
    ticker: "INTC",
    name: "Intel",
    price: 30.14,
    changePercent: -1.82,
    volume: 48_100_000,
    sparkline: generateSparkline(30.7, 15, 0.02),
  },
  {
    ticker: "PYPL",
    name: "PayPal",
    price: 63.24,
    changePercent: -1.44,
    volume: 18_200_000,
    sparkline: generateSparkline(64.2, 15, 0.02),
  },
  {
    ticker: "NFLX",
    name: "Netflix",
    price: 625.3,
    changePercent: -0.67,
    volume: 4_200_000,
    sparkline: generateSparkline(629.5, 15, 0.01),
  },
];

// ─── Sector Performance ───────────────────────────────────────────────────────

export const MOCK_SECTORS: SectorPerformance[] = [
  { sector: "Technology", changePercent: 1.82, marketCap: 14200 },
  { sector: "Healthcare", changePercent: 0.43, marketCap: 5800 },
  { sector: "Financials", changePercent: -0.21, marketCap: 7200 },
  { sector: "Consumer Disc.", changePercent: -0.89, marketCap: 4100 },
  { sector: "Energy", changePercent: 1.14, marketCap: 3900 },
  { sector: "Comm. Services", changePercent: 2.31, marketCap: 4800 },
  { sector: "Utilities", changePercent: 0.08, marketCap: 1600 },
  { sector: "Industrials", changePercent: 0.56, marketCap: 4300 },
  { sector: "Materials", changePercent: -0.34, marketCap: 2100 },
  { sector: "Real Estate", changePercent: -1.12, marketCap: 1800 },
  { sector: "Cons. Staples", changePercent: 0.22, marketCap: 3400 },
];

// ─── Market Pulse ─────────────────────────────────────────────────────────────

export const MOCK_MARKET_PULSE: MarketPulse = {
  sentimentScore: 67,
  summary:
    "Markets lean bullish on AI infrastructure spending and easing rate expectations. Tech leads broad gains while energy and materials face modest selling pressure.",
  bullishFactors: [
    "Strong earnings beats from mega-cap tech",
    "Fed signals potential rate cuts in H2",
    "AI capex cycle shows no signs of slowing",
  ],
  bearishFactors: [
    "Elevated valuations across growth stocks",
    "Geopolitical tensions in Middle East",
    "Consumer confidence declining for 3rd month",
  ],
  generatedAt: Date.now(),
};

// ─── AI Signals ───────────────────────────────────────────────────────────────

export const MOCK_AI_SIGNALS: AISignal[] = [
  {
    ticker: "NVDA",
    signal: "strong_buy",
    confidence: 87,
    riskLevel: "medium",
    reasoning: [
      "Data center revenue grew 427% YoY, far exceeding analyst estimates",
      "Blackwell architecture adoption accelerating across hyperscalers",
      "RSI at 58 indicates room to run before overbought territory",
      "Analyst consensus price target: $1,100 (+25.7% upside)",
    ],
    targetPrice: 1100,
    stopLoss: 780,
    generatedAt: Date.now() - 15 * 60_000,
    modelVersion: "claude-sonnet-4-6",
  },
  {
    ticker: "TSLA",
    signal: "hold",
    confidence: 52,
    riskLevel: "high",
    reasoning: [
      "Vehicle deliveries miss estimates for second consecutive quarter",
      "Energy division provides upside optionality with strong growth",
      "High beta stock vulnerable to broader risk-off sentiment",
      "Price at key support level — wait for directional confirmation",
    ],
    targetPrice: null,
    stopLoss: 220,
    generatedAt: Date.now() - 42 * 60_000,
    modelVersion: "claude-sonnet-4-6",
  },
  {
    ticker: "META",
    signal: "buy",
    confidence: 74,
    riskLevel: "low",
    reasoning: [
      "Revenue growth re-accelerating led by AI-powered ad targeting",
      "Reality Labs losses narrowing quarter over quarter",
      "FCF yield of 4.2% compelling at current price",
      "MACD bullish crossover on weekly chart",
    ],
    targetPrice: 590,
    stopLoss: 480,
    generatedAt: Date.now() - 2 * 3600_000,
    modelVersion: "claude-sonnet-4-6",
  },
];

// ─── News Feed ────────────────────────────────────────────────────────────────

export const MOCK_NEWS: NewsArticle[] = [
  {
    id: "1",
    headline: "NVIDIA Smashes Earnings Estimates, Revenue Surges on AI Demand",
    source: "Reuters",
    url: "#",
    imageUrl: null,
    publishedAt: Date.now() - 25 * 60_000,
    relatedTickers: ["NVDA"],
    sentiment: "bullish",
    sentimentScore: 0.89,
    aiSummary:
      "NVIDIA reported Q4 revenue of $22.1B, beating estimates by 12%. Data center segment grew 409% YoY as hyperscalers ramp AI infrastructure investments.",
    category: "Earnings",
  },
  {
    id: "2",
    headline: "Fed Minutes Signal Patience on Rate Cuts Amid Sticky Inflation",
    source: "Bloomberg",
    url: "#",
    imageUrl: null,
    publishedAt: Date.now() - 1.5 * 3600_000,
    relatedTickers: ["SPY", "QQQ", "TLT"],
    sentiment: "bearish",
    sentimentScore: -0.42,
    aiSummary:
      "FOMC minutes reveal officials want 'greater confidence' inflation is sustainably heading to 2% target before cutting rates, pushing expectations to late 2024.",
    category: "Macro",
  },
  {
    id: "3",
    headline: "Apple Vision Pro Hits 1M Units Sold in First Year — Analyst",
    source: "Wall Street Journal",
    url: "#",
    imageUrl: null,
    publishedAt: Date.now() - 3 * 3600_000,
    relatedTickers: ["AAPL"],
    sentiment: "bullish",
    sentimentScore: 0.61,
    aiSummary:
      "Wedbush analyst Daniel Ives estimates Apple Vision Pro has sold over 1 million units globally, exceeding initial bearish projections and validating the spatial computing product line.",
    category: "Product",
  },
  {
    id: "4",
    headline: "Tesla Recalls 3,900 Cybertruck Units Over Windshield Wiper Issue",
    source: "CNBC",
    url: "#",
    imageUrl: null,
    publishedAt: Date.now() - 4.5 * 3600_000,
    relatedTickers: ["TSLA"],
    sentiment: "bearish",
    sentimentScore: -0.58,
    aiSummary:
      "Tesla issued a voluntary recall for Cybertruck vehicles due to a windshield wiper defect that could obscure driver visibility. NHTSA filing shows 3,878 vehicles affected.",
    category: "Recall",
  },
  {
    id: "5",
    headline: "Meta's Llama 4 Beats GPT-4o on Multiple Benchmarks, Open-Sources the Model",
    source: "TechCrunch",
    url: "#",
    imageUrl: null,
    publishedAt: Date.now() - 6 * 3600_000,
    relatedTickers: ["META", "GOOGL", "MSFT"],
    sentiment: "bullish",
    sentimentScore: 0.77,
    aiSummary:
      "Meta released Llama 4 multimodal model beating GPT-4o on MMLU and HumanEval benchmarks. Open-sourcing strategy aims to drive developer adoption and compete with proprietary AI ecosystem.",
    category: "AI",
  },
  {
    id: "6",
    headline: "Crypto Markets Surge: Bitcoin Hits $72K as Institutional Inflows Accelerate",
    source: "CoinDesk",
    url: "#",
    imageUrl: null,
    publishedAt: Date.now() - 8 * 3600_000,
    relatedTickers: ["COIN", "MSTR", "IBIT"],
    sentiment: "bullish",
    sentimentScore: 0.83,
    aiSummary:
      "Bitcoin crossed $72,000 for the first time since its ATH as BlackRock and Fidelity ETFs absorbed $1.2B in net inflows over three days. Coinbase surges 9% on elevated trading volumes.",
    category: "Crypto",
  },
];

// ─── Company Profiles ─────────────────────────────────────────────────────────

export const MOCK_PROFILES: Record<string, CompanyProfile> = {
  AAPL: {
    ticker: "AAPL",
    name: "Apple Inc.",
    description:
      "Apple Inc. designs, manufactures, and markets smartphones, personal computers, tablets, wearables, and accessories worldwide. The company offers iPhone, Mac, iPad, and Wearables, Home and Accessories segments. It also provides AppleCare support and cloud services, and operates various platforms including the App Store.",
    sector: "Technology",
    industry: "Consumer Electronics",
    ceo: "Tim Cook",
    employees: 164_000,
    headquarters: "Cupertino, California",
    website: "apple.com",
    founded: 1976,
    logoUrl: getLogoUrl("AAPL"),
  },
  TSLA: {
    ticker: "TSLA",
    name: "Tesla, Inc.",
    description:
      "Tesla, Inc. designs, develops, manufactures, leases, and sells electric vehicles, and energy generation and storage systems in the United States, China, and internationally. The company operates through two segments, Automotive, and Energy Generation and Storage.",
    sector: "Consumer Discretionary",
    industry: "Automobile Manufacturers",
    ceo: "Elon Musk",
    employees: 127_855,
    headquarters: "Austin, Texas",
    website: "tesla.com",
    founded: 2003,
    logoUrl: getLogoUrl("TSLA"),
  },
  NVDA: {
    ticker: "NVDA",
    name: "NVIDIA Corporation",
    description:
      "NVIDIA Corporation provides graphics, and compute and networking solutions in the United States, Taiwan, China, and internationally. The company's Data Center segment offers end-to-end computing platforms and systems for AI, HPC, and accelerated computing.",
    sector: "Technology",
    industry: "Semiconductors",
    ceo: "Jensen Huang",
    employees: 29_600,
    headquarters: "Santa Clara, California",
    website: "nvidia.com",
    founded: 1993,
    logoUrl: getLogoUrl("NVDA"),
  },
};

// ─── Search Results ───────────────────────────────────────────────────────────

export const MOCK_SEARCH_RESULTS: SearchResult[] = [
  { ticker: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", type: "Common Stock", logoUrl: getLogoUrl("AAPL") },
  { ticker: "MSFT", name: "Microsoft Corporation", exchange: "NASDAQ", type: "Common Stock", logoUrl: getLogoUrl("MSFT") },
  { ticker: "GOOGL", name: "Alphabet Inc.", exchange: "NASDAQ", type: "Common Stock", logoUrl: getLogoUrl("GOOGL") },
  { ticker: "AMZN", name: "Amazon.com Inc.", exchange: "NASDAQ", type: "Common Stock", logoUrl: getLogoUrl("AMZN") },
  { ticker: "NVDA", name: "NVIDIA Corporation", exchange: "NASDAQ", type: "Common Stock", logoUrl: getLogoUrl("NVDA") },
  { ticker: "TSLA", name: "Tesla Inc.", exchange: "NASDAQ", type: "Common Stock", logoUrl: getLogoUrl("TSLA") },
  { ticker: "META", name: "Meta Platforms Inc.", exchange: "NASDAQ", type: "Common Stock", logoUrl: getLogoUrl("META") },
  { ticker: "COIN", name: "Coinbase Global Inc.", exchange: "NASDAQ", type: "Common Stock", logoUrl: getLogoUrl("COIN") },
];

export const TRENDING_TICKERS = ["NVDA", "TSLA", "AAPL", "META", "COIN", "MSFT", "AMZN", "GOOGL"];

// ─── Candle Data Generator ─────────────────────────────────────────────────────

export function generateMockCandles(
  basePrice: number,
  count: number,
  intervalMs: number
): CandleData[] {
  const candles: CandleData[] = [];
  let price = basePrice * 0.85; // Start a bit lower

  const now = Date.now();
  for (let i = count; i >= 0; i--) {
    const time = Math.floor((now - i * intervalMs) / 1000);
    const open = price;
    const move = (Math.random() - 0.47) * price * 0.015;
    const close = open + move;
    const high = Math.max(open, close) * (1 + Math.random() * 0.008);
    const low = Math.min(open, close) * (1 - Math.random() * 0.008);
    const volume = Math.floor(Math.random() * 2_000_000 + 500_000);

    candles.push({
      time,
      open: parseFloat(open.toFixed(2)),
      high: parseFloat(high.toFixed(2)),
      low: parseFloat(low.toFixed(2)),
      close: parseFloat(close.toFixed(2)),
      volume,
    });

    price = close;
  }

  return candles;
}
