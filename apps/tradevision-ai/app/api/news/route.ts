import { NextRequest, NextResponse } from "next/server";
import { fetchMarketNews } from "@/lib/finnhub";

export async function GET(req: NextRequest) {
  const category = req.nextUrl.searchParams.get("category") ?? "general";
  const ticker = req.nextUrl.searchParams.get("ticker") ?? undefined;

  try {
    const news = await fetchMarketNews(category, ticker);
    return NextResponse.json(news, {
      headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate" },
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch news" }, { status: 500 });
  }
}
