import express from "express";
import { fileURLToPath } from "node:url";
import { analyzeStock, investingIdeas, resolveQuery, ClaudeError } from "./lib/claude.js";
import { searchMarkets } from "./lib/polymarket.js";
import { getStockSnapshot, searchCompanies } from "./lib/stocks.js";
import { placeOrder, tradingConfig, TradeError } from "./lib/trading.js";

const app = express();
app.use(express.json({ limit: "32kb" }));
app.use(express.static(fileURLToPath(new URL("./public", import.meta.url))));

const asyncRoute = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    const known = err instanceof ClaudeError || err instanceof TradeError;
    console.error(`[${req.path}]`, err);
    res.status(known ? 400 : 500).json({ error: known ? err.message : "Something went wrong. Check the server log." });
  });

const cleanText = (value, max = 200) => (typeof value === "string" ? value.trim().slice(0, max) : "");

app.get("/api/config", (_req, res) => {
  const trading = tradingConfig();
  res.json({ claudeReady: Boolean(process.env.ANTHROPIC_API_KEY), trading });
});

app.post("/api/analyze", asyncRoute(async (req, res) => {
  const query = cleanText(req.body?.query);
  if (!query) return res.status(400).json({ error: "Type a company, product or person." });

  const resolved = await resolveQuery(query);
  // Claude may pick a symbol Yahoo doesn't know; fall back to Yahoo's own search.
  let candidates = resolved.tickers.map((t) => t.symbol);
  if (!candidates.length) candidates = (await searchCompanies(query).catch(() => [])).map((c) => c.symbol);
  const symbol = cleanText(req.body?.symbol, 20) || candidates[0];
  if (!symbol) {
    return res.json({ resolved, stock: null, markets: [], analysis: null, message: resolved.note || "No listed stock found." });
  }

  const [stock, markets] = await Promise.all([
    getStockSnapshot(symbol),
    searchMarkets([...resolved.polymarketTerms, resolved.entityName]),
  ]);
  const profile = req.body?.profile && typeof req.body.profile === "object" ? req.body.profile : undefined;
  const analysis = await analyzeStock({ query, resolved, stock, markets, profile });
  res.json({ resolved, stock, markets, analysis });
}));

app.post("/api/ideas", asyncRoute(async (req, res) => {
  const b = req.body ?? {};
  res.json(await investingIdeas({
    budget: cleanText(b.budget, 60),
    horizon: cleanText(b.horizon, 60),
    risk: cleanText(b.risk, 30),
    interests: cleanText(b.interests, 300),
  }));
}));

app.post("/api/trade", asyncRoute(async (req, res) => {
  res.json(await placeOrder(req.body));
}));

const port = Number(process.env.PORT || 3000);
// Bind to localhost by default: the trade endpoint can spend real money.
const host = process.env.HOST || "127.0.0.1";
app.listen(port, host, () => {
  console.log(`Stock Advisor running at http://${host}:${port}`);
  if (!process.env.ANTHROPIC_API_KEY) console.warn("ANTHROPIC_API_KEY is not set: AI features will fail.");
});
