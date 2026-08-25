import { NextRequest, NextResponse } from "next/server";

type NasdaqSearchItem = {
  symbol?: string;
  name?: string;
  exchange?: string;
  asset?: string;
};

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 40);
  if (!q) return NextResponse.json({ results: [] }, { headers: { "Cache-Control": "no-store" } });

  try {
    const response = await fetch(`https://api.nasdaq.com/api/autocomplete/slookup/10?search=${encodeURIComponent(q)}`, {
      headers: {
        Accept: "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (compatible; AtlasMarkets/1.0)",
        Origin: "https://www.nasdaq.com",
        Referer: "https://www.nasdaq.com/",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Nasdaq ${response.status}`);
    const payload = await response.json() as { data?: NasdaqSearchItem[] };
    const results = (payload.data ?? [])
      .filter((item) => item.symbol && ["STOCKS", "ETF"].includes(item.asset ?? ""))
      .map((item) => ({
        symbol: item.symbol!,
        name: item.name ?? item.symbol!,
        exchange: item.exchange ?? "US",
        type: item.asset === "ETF" ? "ETF" : "Equity",
      }));
    return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch {
    return NextResponse.json({ results: [], error: "search_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
