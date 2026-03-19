import { NextRequest, NextResponse } from "next/server";
import { searchSymbols } from "@/lib/alpha-vantage";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q")?.trim() ?? "";

  if (!query || query.length < 1) {
    return NextResponse.json([]);
  }

  try {
    const results = await searchSymbols(query);
    return NextResponse.json(results, {
      headers: { "Cache-Control": "s-maxage=600, stale-while-revalidate" },
    });
  } catch {
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
