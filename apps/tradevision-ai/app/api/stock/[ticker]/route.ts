import { NextRequest, NextResponse } from "next/server";
import { fetchQuote } from "@/lib/alpha-vantage";
import { MOCK_QUOTES } from "@/lib/mock-data";

export async function GET(
  req: NextRequest,
  { params }: { params: { ticker: string } }
) {
  const ticker = params.ticker.toUpperCase();

  try {
    const quote = (await fetchQuote(ticker)) ?? MOCK_QUOTES[ticker];
    if (!quote) {
      return NextResponse.json({ error: "Ticker not found" }, { status: 404 });
    }
    return NextResponse.json(quote, {
      headers: { "Cache-Control": "s-maxage=30, stale-while-revalidate" },
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch quote" }, { status: 500 });
  }
}
