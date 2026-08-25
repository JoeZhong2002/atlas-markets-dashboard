import { NextRequest, NextResponse } from "next/server";

type YahooQuote = {
  symbol?: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice?: number;
  regularMarketChangePercent?: number;
  postMarketChangePercent?: number;
  regularMarketVolume?: number;
  averageDailyVolume3Month?: number;
  currency?: string;
  marketState?: string;
};

export async function GET(request: NextRequest) {
  const symbols = (request.nextUrl.searchParams.get("symbols") ?? "NVDA,MSFT,AAPL")
    .split(",").map((symbol) => symbol.trim().toUpperCase()).filter((symbol) => /^[A-Z0-9.\-^]{1,12}$/.test(symbol)).slice(0, 30);

  try {
    const endpoint = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(","))}`;
    const response = await fetch(endpoint, { headers: { "User-Agent": "Mozilla/5.0 AtlasMarkets/1.0", Accept: "application/json" }, cf: { cacheTtl: 300, cacheEverything: true } });
    if (!response.ok) throw new Error(`provider ${response.status}`);
    const payload = await response.json() as { quoteResponse?: { result?: YahooQuote[] } };
    const quotes = (payload.quoteResponse?.result ?? []).map((quote) => ({
      symbol: quote.symbol ?? "",
      name: quote.shortName ?? quote.longName ?? quote.symbol ?? "",
      price: quote.regularMarketPrice ?? 0,
      changePercent: quote.regularMarketChangePercent ?? 0,
      postMarketChangePercent: quote.postMarketChangePercent ?? null,
      volumeRatio: quote.regularMarketVolume && quote.averageDailyVolume3Month ? quote.regularMarketVolume / quote.averageDailyVolume3Month : null,
      sectorChangePercent: null,
      currency: quote.currency ?? "USD",
      marketState: quote.marketState ?? "UNKNOWN",
      sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(quote.symbol ?? "")}`,
    })).filter((quote) => quote.symbol);
    return NextResponse.json({ quotes, updatedAt: new Date().toISOString(), live: true }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900" } });
  } catch {
    return NextResponse.json({ quotes: [], updatedAt: new Date().toISOString(), live: false });
  }
}
