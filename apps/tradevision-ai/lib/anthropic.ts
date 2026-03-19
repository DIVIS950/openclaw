/**
 * Anthropic Claude integration — AI signals, news summaries, market pulse, chat.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { AISignal, Signal, RiskLevel, MarketPulse } from "./types";
import type { StockQuote } from "./types";
import { cache, TTL } from "./cache";
import { MOCK_AI_SIGNALS, MOCK_MARKET_PULSE } from "./mock-data";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? "",
});

function hasCreds(): boolean {
  const key = process.env.ANTHROPIC_API_KEY ?? "";
  return Boolean(key && key !== "your_anthropic_api_key_here");
}

// ─── AI Signal Generation ─────────────────────────────────────────────────────

export async function generateAISignal(
  quote: StockQuote,
  recentNews: string[] = []
): Promise<AISignal> {
  const cacheKey = `signal:${quote.ticker}`;
  const cached = cache.get<AISignal>(cacheKey);
  if (cached) return cached.data;

  // Return mock if no API key
  if (!hasCreds()) {
    const mock = MOCK_AI_SIGNALS.find((s) => s.ticker === quote.ticker);
    if (mock) {
      cache.set(cacheKey, mock, TTL.AI_SIGNAL);
      return mock;
    }
    // Generate a plausible mock for unknown tickers
    const fallback = generateFallbackSignal(quote);
    cache.set(cacheKey, fallback, TTL.AI_SIGNAL);
    return fallback;
  }

  const newsContext =
    recentNews.length > 0
      ? `\nRecent news:\n${recentNews.slice(0, 3).map((n, i) => `${i + 1}. ${n}`).join("\n")}`
      : "";

  const prompt = `You are a quantitative analyst. Analyze this stock and provide a trading signal.

Stock: ${quote.ticker} (${quote.name})
Current Price: $${quote.price}
Change Today: ${quote.changePercent > 0 ? "+" : ""}${quote.changePercent.toFixed(2)}%
P/E Ratio: ${quote.peRatio ?? "N/A"}
EPS: ${quote.eps ? `$${quote.eps}` : "N/A"}
52-Week Range: $${quote.week52Low} - $${quote.week52High}
Volume vs Avg: ${quote.volume.toLocaleString()} vs ${quote.avgVolume.toLocaleString()}
Market Cap: $${(quote.marketCap / 1e9).toFixed(1)}B
Beta: ${quote.beta ?? "N/A"}
${newsContext}

Respond ONLY with valid JSON in this exact format:
{
  "signal": "strong_buy" | "buy" | "hold" | "sell" | "strong_sell",
  "confidence": <number 0-100>,
  "risk_level": "low" | "medium" | "high",
  "reasoning": ["<point 1>", "<point 2>", "<point 3>", "<point 4>"],
  "target_price": <number or null>,
  "stop_loss": <number or null>
}`;

  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });

    const text = msg.content[0].type === "text" ? msg.content[0].text : "";
    const parsed = JSON.parse(text) as {
      signal: Signal;
      confidence: number;
      risk_level: RiskLevel;
      reasoning: string[];
      target_price: number | null;
      stop_loss: number | null;
    };

    const signal: AISignal = {
      ticker: quote.ticker,
      signal: parsed.signal,
      confidence: Math.min(100, Math.max(0, parsed.confidence)),
      riskLevel: parsed.risk_level,
      reasoning: parsed.reasoning.slice(0, 5),
      targetPrice: parsed.target_price,
      stopLoss: parsed.stop_loss,
      generatedAt: Date.now(),
      modelVersion: "claude-sonnet-4-6",
    };

    cache.set(cacheKey, signal, TTL.AI_SIGNAL);
    return signal;
  } catch {
    const fallback = generateFallbackSignal(quote);
    cache.set(cacheKey, fallback, TTL.AI_SIGNAL);
    return fallback;
  }
}

function generateFallbackSignal(quote: StockQuote): AISignal {
  // Deterministic signal based on price movement
  const pct = quote.changePercent;
  let signal: Signal = "hold";
  let confidence = 50;

  if (pct > 3) { signal = "strong_buy"; confidence = 75; }
  else if (pct > 1) { signal = "buy"; confidence = 62; }
  else if (pct < -3) { signal = "strong_sell"; confidence = 73; }
  else if (pct < -1) { signal = "sell"; confidence = 60; }
  else { signal = "hold"; confidence = 55; }

  return {
    ticker: quote.ticker,
    signal,
    confidence,
    riskLevel: Math.abs(pct) > 3 ? "high" : Math.abs(pct) > 1 ? "medium" : "low",
    reasoning: [
      `Price ${pct >= 0 ? "up" : "down"} ${Math.abs(pct).toFixed(2)}% on the session with ${quote.volume > quote.avgVolume ? "above" : "below"}-average volume`,
      `Trading ${((quote.price - quote.week52Low) / (quote.week52High - quote.week52Low) * 100).toFixed(0)}% of the way through its 52-week range`,
      quote.peRatio ? `P/E of ${quote.peRatio.toFixed(1)} is ${quote.peRatio > 30 ? "elevated" : "reasonable"} relative to sector peers` : "Valuation metrics unavailable — exercise caution",
      "AI-generated signal based on price action and available fundamentals",
    ],
    targetPrice: null,
    stopLoss: parseFloat((quote.price * 0.92).toFixed(2)),
    generatedAt: Date.now(),
    modelVersion: "mock",
  };
}

// ─── Market Pulse Generation ───────────────────────────────────────────────────

export async function generateMarketPulse(): Promise<MarketPulse> {
  const cacheKey = "market:pulse";
  const cached = cache.get<MarketPulse>(cacheKey);
  if (cached) return cached.data;

  if (!hasCreds()) {
    cache.set(cacheKey, MOCK_MARKET_PULSE, TTL.AI_SIGNAL);
    return MOCK_MARKET_PULSE;
  }

  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: `You are a senior market analyst. Today is ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}. Provide a brief current market pulse assessment.

Respond ONLY with valid JSON:
{
  "sentiment_score": <number 0-100 where 0=extreme fear, 50=neutral, 100=extreme greed>,
  "summary": "<2-sentence market summary>",
  "bullish_factors": ["<factor 1>", "<factor 2>", "<factor 3>"],
  "bearish_factors": ["<factor 1>", "<factor 2>", "<factor 3>"]
}`,
        },
      ],
    });

    const text = msg.content[0].type === "text" ? msg.content[0].text : "";
    const parsed = JSON.parse(text) as {
      sentiment_score: number;
      summary: string;
      bullish_factors: string[];
      bearish_factors: string[];
    };

    const pulse: MarketPulse = {
      sentimentScore: Math.min(100, Math.max(0, parsed.sentiment_score)),
      summary: parsed.summary,
      bullishFactors: parsed.bullish_factors.slice(0, 3),
      bearishFactors: parsed.bearish_factors.slice(0, 3),
      generatedAt: Date.now(),
    };

    cache.set(cacheKey, pulse, TTL.AI_SIGNAL);
    return pulse;
  } catch {
    cache.set(cacheKey, MOCK_MARKET_PULSE, TTL.AI_SIGNAL);
    return MOCK_MARKET_PULSE;
  }
}

// ─── Streaming Chat ────────────────────────────────────────────────────────────

export function createChatStream(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  stockContext?: string
) {
  const systemPrompt = `You are TradeVision AI, an expert financial analyst and investment advisor assistant. You provide thoughtful, data-driven market analysis and investment insights.

${stockContext ? `Current market context:\n${stockContext}\n` : ""}
Guidelines:
- Be concise but insightful — 2-4 paragraphs max unless more detail is requested
- Format numbers clearly (e.g., "$150.23", "+2.4%", "$2.1T market cap")
- Always include a disclaimer that your analysis is not financial advice
- Use markdown formatting for tables and lists when helpful
- Be balanced — acknowledge both risks and opportunities`;

  return client.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });
}
