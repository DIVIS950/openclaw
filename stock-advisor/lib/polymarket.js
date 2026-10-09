// Polymarket public market data (Gamma API). No API key needed for reading.
const GAMMA_URL = "https://gamma-api.polymarket.com";

// Gamma returns some array fields as JSON-encoded strings ("[\"Yes\",\"No\"]").
function parseList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function normalizeMarket(market, event = {}) {
  const outcomes = parseList(market.outcomes);
  const prices = parseList(market.outcomePrices).map(Number);
  const tokenIds = parseList(market.clobTokenIds);
  return {
    id: String(market.id ?? ""),
    question: market.question ?? event.title ?? "",
    eventTitle: event.title ?? "",
    url: event.slug ? `https://polymarket.com/event/${event.slug}` : null,
    endDate: market.endDate ?? event.endDate ?? null,
    volume: Number(market.volume ?? market.volumeNum ?? 0),
    outcomes: outcomes.map((name, i) => ({
      name: String(name),
      probability: Number.isFinite(prices[i]) ? prices[i] : null,
      tokenId: tokenIds[i] ?? null,
    })),
  };
}

// Flattens search results into open markets, highest volume first.
export function extractMarkets(searchResult, limit = 8) {
  const markets = [];
  for (const event of searchResult?.events ?? []) {
    for (const market of event.markets ?? []) {
      if (market.closed || market.active === false) continue;
      markets.push(normalizeMarket(market, event));
    }
  }
  markets.sort((a, b) => b.volume - a.volume);
  return markets.slice(0, limit);
}

export async function searchMarkets(terms, { fetchImpl = fetch, limit = 8 } = {}) {
  const seen = new Set();
  const results = [];
  for (const term of terms.filter(Boolean).slice(0, 3)) {
    const url = `${GAMMA_URL}/public-search?q=${encodeURIComponent(term)}&limit_per_type=10&events_status=active`;
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      for (const market of extractMarkets(await res.json(), limit)) {
        if (seen.has(market.id)) continue;
        seen.add(market.id);
        results.push(market);
      }
    } catch (err) {
      console.warn(`[polymarket] search "${term}" failed: ${err.message}`);
    }
  }
  results.sort((a, b) => b.volume - a.volume);
  return results.slice(0, limit);
}
