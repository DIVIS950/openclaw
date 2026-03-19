import { NextResponse } from "next/server";
import { MOCK_INDICES, MOCK_GAINERS, MOCK_LOSERS, MOCK_SECTORS } from "@/lib/mock-data";

export async function GET() {
  return NextResponse.json(
    {
      indices: MOCK_INDICES,
      gainers: MOCK_GAINERS,
      losers: MOCK_LOSERS,
      sectors: MOCK_SECTORS,
    },
    {
      headers: { "Cache-Control": "s-maxage=30, stale-while-revalidate" },
    }
  );
}
