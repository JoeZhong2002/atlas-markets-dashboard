import { NextRequest, NextResponse } from "next/server";

type NasdaqValue = {
  lastSalePrice?: string;
  percentageChange?: string;
  volume?: string;
  lastTradeTimestamp?: string;
};

type NasdaqInfo = {
  symbol?: string;
  companyName?: string;
  marketStatus?: string;
  primaryData?: NasdaqValue | null;
  secondaryData?: NasdaqValue | null;
  notifications?: Array<{
    eventTypes?: Array<{ message?: string; eventName?: string; url?: { value?: string } }>;
  }> | null;
};

type NasdaqSummary = {
  summaryData?: {
    ShareVolume?: { value?: string };
    AverageVolume?: { value?: string };
  };
};

const NASDAQ_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "User-Agent": "Mozilla/5.0 (compatible; AtlasMarkets/1.0)",
  Origin: "https://www.nasdaq.com",
  Referer: "https://www.nasdaq.com/",
};

function numberFrom(value?: string) {
  if (!value || /n\/a/i.test(value)) return null;
  const parsed = Number(value.replace(/[$,%+,]/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

async function nasdaqJson<T>(url: string) {
  const response = await fetch(url, { headers: NASDAQ_HEADERS, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Nasdaq ${response.status}`);
  const payload = await response.json() as { data?: T | null; status?: { rCode?: number } };
  if (!payload.data || (payload.status?.rCode && payload.status.rCode !== 200)) throw new Error("Nasdaq returned no data");
  return payload.data;
}

async function fetchQuote(symbol: string) {
  const encoded = encodeURIComponent(symbol);
  const [info, summary] = await Promise.all([
    nasdaqJson<NasdaqInfo>(`https://api.nasdaq.com/api/quote/${encoded}/info?assetclass=stocks`),
    nasdaqJson<NasdaqSummary>(`https://api.nasdaq.com/api/quote/${encoded}/summary?assetclass=stocks`).catch(() => null),
  ]);

  const hasExtendedSession = Boolean(info.secondaryData);
  const regular = info.secondaryData ?? info.primaryData;
  const latest = info.primaryData ?? info.secondaryData;
  const volume = numberFrom(summary?.summaryData?.ShareVolume?.value) ?? numberFrom(latest?.volume);
  const averageVolume = numberFrom(summary?.summaryData?.AverageVolume?.value);
  const status = info.marketStatus ?? "Unknown";
  const extendedSession = /pre-market/i.test(status) ? "盘前" : /after-hours/i.test(status) ? "盘后" : hasExtendedSession ? "盘外" : null;

  if (!latest || numberFrom(latest.lastSalePrice) === null) throw new Error(`${symbol} has no quote`);

  const events = (info.notifications ?? []).flatMap((notice) => notice.eventTypes ?? []).flatMap((event) => {
    if (!event.message) return [];
    if (!/(earnings|dividend|split|conference|meeting|investor day)/i.test(`${event.eventName ?? ""} ${event.message}`)) return [];
    const rawUrl = event.url?.value ?? "";
    return [{
      symbol,
      title: event.eventName ?? "Upcoming event",
      detail: event.message,
      sourceUrl: rawUrl.startsWith("http") ? rawUrl : `https://www.nasdaq.com${rawUrl}`,
    }];
  });

  return {
    quote: {
      symbol: info.symbol ?? symbol,
      name: info.companyName ?? symbol,
      price: numberFrom(latest.lastSalePrice),
      changePercent: numberFrom(regular?.percentageChange),
      extendedChangePercent: hasExtendedSession ? numberFrom(latest.percentageChange) : null,
      extendedSession,
      volume,
      averageVolume,
      volumeRatio: volume && averageVolume ? volume / averageVolume : null,
      currency: "USD",
      marketState: status,
      asOf: latest.lastTradeTimestamp ?? null,
      source: "Nasdaq",
      sourceUrl: `https://www.nasdaq.com/market-activity/stocks/${encodeURIComponent(symbol.toLowerCase())}`,
    },
    events,
  };
}

export async function GET(request: NextRequest) {
  const symbols = (request.nextUrl.searchParams.get("symbols") ?? "NVDA,MSFT,AAPL")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => /^[A-Z0-9.\-]{1,12}$/.test(symbol))
    .slice(0, 30);

  const settled = await Promise.allSettled(symbols.map(fetchQuote));
  const successful = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const failedSymbols = settled.flatMap((result, index) => result.status === "rejected" ? [symbols[index]] : []);

  return NextResponse.json({
    quotes: successful.map((item) => item.quote),
    events: successful.flatMap((item) => item.events).slice(0, 8),
    failedSymbols,
    updatedAt: new Date().toISOString(),
    live: successful.length > 0,
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
