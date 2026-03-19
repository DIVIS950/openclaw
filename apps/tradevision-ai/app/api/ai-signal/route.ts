import { NextRequest, NextResponse } from "next/server";
import { generateAISignal } from "@/lib/anthropic";
import { MOCK_QUOTES } from "@/lib/mock-data";

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker")?.toUpperCase();
  if (!ticker) {
    return NextResponse.json({ error: "Missing ticker" }, { status: 400 });
  }

  const quote = MOCK_QUOTES[ticker];
  if (!quote) {
    return NextResponse.json({ error: "Unknown ticker" }, { status: 404 });
  }

  try {
    const signal = await generateAISignal(quote);
    return NextResponse.json(signal, {
      headers: { "Cache-Control": "s-maxage=600, stale-while-revalidate" },
    });
  } catch (err) {
    return NextResponse.json({ error: "Failed to generate signal" }, { status: 500 });
  }
}
