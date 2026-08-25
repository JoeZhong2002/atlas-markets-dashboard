import { NextRequest, NextResponse } from "next/server";

type YahooSearchQuote = { symbol?: string; shortname?: string; longname?: string; exchange?: string; quoteType?: string; isYahooFinance?: boolean };

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 50);
  if (!q) return NextResponse.json({ results: [] });
  try {
    const response = await fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&enableFuzzyQuery=false`, { headers: { "User-Agent": "Mozilla/5.0 AtlasMarkets/1.0", Accept: "application/json" }, cf: { cacheTtl: 900, cacheEverything: true } });
    if (!response.ok) throw new Error(`provider ${response.status}`);
    const payload = await response.json() as { quotes?: YahooSearchQuote[] };
    const results = (payload.quotes ?? []).filter((item) => item.symbol && ["EQUITY", "ETF"].includes(item.quoteType ?? "")).map((item) => ({ symbol: item.symbol!, name: item.shortname ?? item.longname ?? item.symbol!, exchange: item.exchange ?? "US", type: item.quoteType ?? "Equity" }));
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [] });
  }
}
