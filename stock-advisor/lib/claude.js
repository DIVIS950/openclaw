// All Claude calls. Uses the official Anthropic SDK; the key comes from ANTHROPIC_API_KEY.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const client = new Anthropic();

// Server-side fallback: if a request is declined by a safety classifier,
// the API re-runs it on Anthropic's recommended fallback model.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };

const DISCLAIMER =
  "This is educational analysis, not personal financial advice. Markets are risky and you can lose money.";

export class ClaudeError extends Error {}

function textOf(response) {
  if (response.stop_reason === "refusal") {
    throw new ClaudeError("Claude declined this request. Try rephrasing it.");
  }
  return response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

async function structured({ system, prompt, schema, effort, maxTokens = 16000 }) {
  const response = await client.beta.messages.create({
    ...FALLBACK,
    model: MODEL,
    max_tokens: maxTokens,
    system,
    output_config: { effort, format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "max_tokens") throw new ClaudeError("Claude's answer was cut off. Try again.");
  return JSON.parse(textOf(response));
}

const RESOLVE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["entityType", "entityName", "tickers", "polymarketTerms", "note"],
  properties: {
    entityType: { type: "string", enum: ["company", "product", "person", "sector", "unknown"] },
    entityName: { type: "string" },
    tickers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["symbol", "name", "relation"],
        properties: {
          symbol: { type: "string" },
          name: { type: "string" },
          relation: { type: "string" },
        },
      },
    },
    polymarketTerms: { type: "array", items: { type: "string" } },
    note: { type: "string" },
  },
};

// Turns "iPhone", "Elon Musk" or "Nvidia" into the publicly traded tickers behind it.
export function resolveQuery(query) {
  return structured({
    effort: "low",
    maxTokens: 4000,
    system:
      "You map a company, product, brand or person to the publicly traded stocks most directly tied to it. " +
      "Use Yahoo Finance ticker symbols (e.g. AAPL, TSLA, 7203.T, VOW3.DE). Put the most relevant ticker first and " +
      "return at most 3. For a person, use the companies they run or are most associated with. If the thing is " +
      "private or not tradeable, return an empty tickers list and explain in note (mention a listed parent or " +
      "close competitor if one exists, and include it in tickers). polymarketTerms: 1-3 short search phrases " +
      "likely to find related prediction markets (the company name, the person's name, the product).",
    prompt: `Find the stocks for: ${query}`,
    schema: RESOLVE_SCHEMA,
  });
}

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "verdict", "confidence", "headline", "plainExplanation", "bullCase", "bearCase",
    "keyRisks", "valuationTake", "polymarketTake", "tips", "whoIsItFor",
  ],
  properties: {
    verdict: { type: "string", enum: ["Buy", "Hold", "Avoid"] },
    confidence: { type: "string", enum: ["Low", "Medium", "High"] },
    headline: { type: "string", description: "One sentence verdict." },
    plainExplanation: {
      type: "string",
      description: "2-4 short paragraphs in simple words a beginner understands. Paragraphs separated by blank lines.",
    },
    bullCase: { type: "array", items: { type: "string" } },
    bearCase: { type: "array", items: { type: "string" } },
    keyRisks: { type: "array", items: { type: "string" } },
    valuationTake: { type: "string" },
    polymarketTake: {
      type: "string",
      description: "What the prediction market odds suggest and how much weight they deserve. Say so if none are relevant.",
    },
    tips: { type: "array", items: { type: "string" }, description: "Practical tips for investing in this stock." },
    whoIsItFor: { type: "string", description: "What kind of investor this fits (horizon, risk tolerance)." },
  },
};

export function analyzeStock({ query, resolved, stock, markets, profile }) {
  const compactStock = { ...stock, history: undefined, news: stock.news.slice(0, 8) };
  // Weekly closes are enough for trend context and keep the prompt small.
  const weekly = stock.history.filter((_, i) => i % 5 === 0);
  return structured({
    effort: "high",
    system:
      "You are a careful, honest equity analyst explaining stocks to a beginner investor. Base your view on the data " +
      "provided, say plainly when data is missing, and never invent numbers. Give a clear Buy / Hold / Avoid view for a " +
      "typical long-term investor, with calibrated confidence. Treat Polymarket odds as one crowd signal: explain what " +
      "they imply, but discount thin or loosely related markets. Prefer concrete reasons over generic ones. Tips should " +
      "be practical (position sizing, diversification, time horizon, what to watch next) and specific to this stock.",
    prompt: [
      `User searched for: ${query}`,
      `Resolved: ${JSON.stringify(resolved)}`,
      profile ? `Investor profile: ${JSON.stringify(profile)}` : "",
      `Today: ${new Date().toISOString().slice(0, 10)}`,
      `Stock data (Yahoo Finance): ${JSON.stringify(compactStock)}`,
      `1-year weekly closes: ${JSON.stringify(weekly)}`,
      `Related Polymarket markets (probability = price of that outcome, 0-1): ${JSON.stringify(markets)}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    schema: ANALYSIS_SCHEMA,
  }).then((analysis) => ({ ...analysis, disclaimer: DISCLAIMER }));
}

// Investing ideas with live web search, so suggestions reflect current markets.
export async function investingIdeas({ budget, horizon, risk, interests }) {
  const messages = [
    {
      role: "user",
      content:
        `Suggest what I could invest in.\nBudget: ${budget || "not given"}\nTime horizon: ${horizon || "not given"}\n` +
        `Risk tolerance: ${risk || "medium"}\nInterests: ${interests || "none given"}`,
    },
  ];
  const parts = [];
  // Server-side web search can pause a long turn; resend to let it continue.
  for (let i = 0; i < 4; i++) {
    const response = await requestIdeas(messages);
    parts.push(textOf(response));
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }
  return { markdown: parts.filter(Boolean).join("\n\n"), disclaimer: DISCLAIMER };
}

function requestIdeas(messages) {
  return client.beta.messages.create({
    ...FALLBACK,
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium" },
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
    system:
      "You are a friendly, honest investing coach for beginners. Search the web for current market conditions before " +
      "answering. Give a short plan: an allocation idea (index funds first for most people), 3-6 specific stock or ETF " +
      "ideas with tickers and one-line reasons, what to avoid, and 3-5 habits/tips. Use simple words and Markdown " +
      "headings and bullets. Never promise returns.",
    messages,
  });
}
