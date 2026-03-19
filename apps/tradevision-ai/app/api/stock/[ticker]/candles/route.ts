import { NextRequest, NextResponse } from "next/server";
import { fetchCandles } from "@/lib/alpha-vantage";
import type { TimeFrame } from "@/lib/types";

export async function GET(
  req: NextRequest,
  { params }: { params: { ticker: string } }
) {
  const ticker = params.ticker.toUpperCase();
  const interval = (req.nextUrl.searchParams.get("interval") ?? "1D") as TimeFrame;

  try {
    const candles = await fetchCandles(ticker, interval);
    return NextResponse.json(candles, {
      headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate" },
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch candles" }, { status: 500 });
  }
}
