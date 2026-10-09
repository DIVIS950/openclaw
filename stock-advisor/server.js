import express from "express";
import { fileURLToPath } from "node:url";
import { analyzeStock, investingIdeas, resolveQuery, ClaudeError } from "./lib/claude.js";
import { searchMarkets } from "./lib/polymarket.js";
import { getStockSnapshot, searchCompanies } from "./lib/stocks.js";

const app = express();
app.use(express.json({ limit: "32kb" }));
app.use(express.static(fileURLToPath(new URL("./public", import.meta.url))));

const cleanText = (value, max = 200) => (typeof value === "string" ? value.trim().slice(0, max) : "");
// Errors whose message is safe and useful to show in the page.
class PublicError extends Error {}
const userMessage = (err) =>
  err instanceof ClaudeError || err instanceof PublicError ? err.message : "Something went wrong. Check the server log.";

app.get("/api/config", (_req, res) => {
  res.json({ claudeReady: Boolean(process.env.ANTHROPIC_API_KEY) });
});

// Streams the analysis as Server-Sent Events so the page can show each step live:
// step -> resolved -> stock -> markets -> analysis -> done (or error).
app.get("/api/analyze", async (req, res) => {
  const query = cleanText(req.query.query);
  const symbolOverride = cleanText(req.query.symbol, 20);
  const profile = {
    risk: cleanText(req.query.risk, 20) || undefined,
    horizon: cleanText(req.query.horizon, 30) || undefined,
  };

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  let closed = false;
  req.on("close", () => (closed = true));
  const send = (event, data) => {
    if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const step = (id, state) => send("step", { id, state });

  try {
    if (!query) throw new ClaudeError("Type a company, product or person.");

    step("resolve", "active");
    const resolved = await resolveQuery(query);
    // Claude may pick a symbol Yahoo doesn't know; fall back to Yahoo's own search.
    let candidates = resolved.tickers.map((t) => t.symbol);
    if (!candidates.length) candidates = (await searchCompanies(query).catch(() => [])).map((c) => c.symbol);
    const symbol = symbolOverride || candidates[0];
    send("resolved", { ...resolved, symbol: symbol ?? null });
    step("resolve", "done");
    if (!symbol || closed) return;

    step("data", "active");
    step("markets", "active");
    const [stock, markets] = await Promise.all([
      getStockSnapshot(symbol)
        .catch((err) => {
          console.error("[yahoo]", err.message);
          throw new PublicError(`Couldn't load stock data for ${symbol}. Try again in a minute.`);
        })
        .then((s) => (send("stock", s), step("data", "done"), s)),
      searchMarkets([...resolved.polymarketTerms, resolved.entityName]).then(
        (m) => (send("markets", m), step("markets", "done"), m),
      ),
    ]);
    if (closed) return;

    step("think", "active");
    const analysis = await analyzeStock({ query, resolved, stock, markets, profile });
    send("analysis", analysis);
    step("think", "done");
  } catch (err) {
    console.error("[analyze]", err);
    send("fail", { error: userMessage(err) });
  } finally {
    send("done", {});
    res.end();
  }
});

app.post("/api/ideas", async (req, res) => {
  const b = req.body ?? {};
  try {
    res.json(await investingIdeas({
      budget: cleanText(b.budget, 60),
      horizon: cleanText(b.horizon, 60),
      risk: cleanText(b.risk, 30),
      interests: cleanText(b.interests, 300),
    }));
  } catch (err) {
    console.error("[ideas]", err);
    res.status(err instanceof ClaudeError ? 400 : 500).json({ error: userMessage(err) });
  }
});

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
app.listen(port, host, () => {
  console.log(`Stock Advisor running at http://${host}:${port}`);
  if (!process.env.ANTHROPIC_API_KEY) console.warn("ANTHROPIC_API_KEY is not set: AI features will fail.");
});
