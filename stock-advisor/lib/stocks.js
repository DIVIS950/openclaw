// Stock data from Yahoo Finance (free, no key; unofficial so it can occasionally break).
import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const SUMMARY_MODULES = [
  "assetProfile",
  "financialData",
  "defaultKeyStatistics",
  "summaryDetail",
  "recommendationTrend",
];

const pick = (obj, keys) =>
  Object.fromEntries(keys.filter((k) => obj?.[k] != null).map((k) => [k, obj[k]]));

export async function searchCompanies(query) {
  const result = await yahooFinance.search(query, { quotesCount: 6, newsCount: 0 });
  return (result.quotes ?? [])
    .filter((q) => q.symbol && (q.quoteType === "EQUITY" || q.quoteType === "ETF"))
    .map((q) => ({ symbol: q.symbol, name: q.longname ?? q.shortname ?? q.symbol, exchange: q.exchange }));
}

export async function getStockSnapshot(symbol) {
  const period1 = new Date(Date.now() - 365 * 24 * 3600 * 1000);
  const [quote, summary, chart, search] = await Promise.all([
    yahooFinance.quote(symbol),
    yahooFinance.quoteSummary(symbol, { modules: SUMMARY_MODULES }).catch(() => ({})),
    yahooFinance.chart(symbol, { period1, interval: "1d" }).catch(() => ({ quotes: [] })),
    yahooFinance.search(symbol, { quotesCount: 0, newsCount: 8 }).catch(() => ({ news: [] })),
  ]);

  const history = (chart.quotes ?? [])
    .filter((p) => p.close != null)
    .map((p) => ({ date: new Date(p.date).toISOString().slice(0, 10), close: p.close }));
  const first = history[0]?.close;
  const last = history.at(-1)?.close;

  return {
    symbol,
    name: quote.longName ?? quote.shortName ?? symbol,
    currency: quote.currency ?? "USD",
    exchange: quote.fullExchangeName ?? quote.exchange,
    price: quote.regularMarketPrice,
    changePercent: quote.regularMarketChangePercent,
    marketCap: quote.marketCap,
    fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
    fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
    oneYearReturnPercent: first && last ? ((last - first) / first) * 100 : null,
    profile: pick(summary.assetProfile, ["sector", "industry", "country", "fullTimeEmployees", "website", "longBusinessSummary"]),
    financials: pick(summary.financialData, [
      "revenueGrowth", "earningsGrowth", "grossMargins", "operatingMargins", "profitMargins",
      "totalCash", "totalDebt", "debtToEquity", "freeCashflow", "returnOnEquity",
      "targetMeanPrice", "targetHighPrice", "targetLowPrice", "recommendationKey", "numberOfAnalystOpinions",
    ]),
    valuation: {
      ...pick(summary.summaryDetail, ["trailingPE", "forwardPE", "dividendYield", "beta"]),
      ...pick(summary.defaultKeyStatistics, ["pegRatio", "priceToBook", "enterpriseToEbitda", "shortPercentOfFloat"]),
    },
    analystTrend: summary.recommendationTrend?.trend?.[0] ?? null,
    news: (search.news ?? []).map((n) => ({
      title: n.title,
      publisher: n.publisher,
      link: n.link,
      published: n.providerPublishTime ? new Date(n.providerPublishTime).toISOString() : null,
    })),
    history,
  };
}
