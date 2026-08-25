import { NextResponse } from "next/server";

type NasdaqIndexData = {
  companyName?: string;
  primaryData?: {
    lastSalePrice?: string;
    percentageChange?: string;
    lastTradeTimestamp?: string;
  } | null;
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

async function fetchIndex(symbol: string, name: string) {
  const response = await fetch(`https://api.nasdaq.com/api/quote/${symbol}/info?assetclass=index`, {
    headers: NASDAQ_HEADERS,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Nasdaq ${response.status}`);
  const payload = await response.json() as { data?: NasdaqIndexData | null };
  const data = payload.data;
  const price = numberFrom(data?.primaryData?.lastSalePrice);
  if (!data || price === null) throw new Error(`${symbol} unavailable`);
  return {
    key: symbol,
    name,
    value: price,
    changePercent: numberFrom(data.primaryData?.percentageChange),
    asOf: data.primaryData?.lastTradeTimestamp ?? null,
    source: "Nasdaq",
    sourceUrl: `https://www.nasdaq.com/market-activity/index/${symbol.toLowerCase()}`,
  };
}

async function fetchMacroProxy(symbol: string, name: string) {
  const response = await fetch(`https://api.nasdaq.com/api/quote/${symbol}/info?assetclass=etf`, {
    headers: NASDAQ_HEADERS,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Nasdaq ${response.status}`);
  const payload = await response.json() as { data?: (NasdaqIndexData & { secondaryData?: NasdaqIndexData["primaryData"] }) | null };
  const data = payload.data;
  const latest = data?.primaryData ?? data?.secondaryData;
  const regular = data?.secondaryData ?? data?.primaryData;
  const value = numberFrom(latest?.lastSalePrice);
  if (!data || value === null) throw new Error(`${symbol} unavailable`);
  return {
    key: symbol,
    name,
    value,
    changePercent: numberFrom(regular?.percentageChange),
    asOf: latest?.lastTradeTimestamp ?? null,
    source: "Nasdaq",
    sourceUrl: `https://www.nasdaq.com/market-activity/etf/${symbol.toLowerCase()}`,
  };
}

async function fetchCrypto() {
  const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin%2Cethereum&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true", {
    headers: { Accept: "application/json", "User-Agent": "AtlasMarkets/1.0" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`CoinGecko ${response.status}`);
  const payload = await response.json() as Record<string, { usd?: number; usd_24h_change?: number; last_updated_at?: number }>;
  return [
    { key: "BTC", name: "Bitcoin", value: payload.bitcoin?.usd ?? null, changePercent: payload.bitcoin?.usd_24h_change ?? null, asOf: payload.bitcoin?.last_updated_at ? new Date(payload.bitcoin.last_updated_at * 1000).toISOString() : null },
    { key: "ETH", name: "Ethereum", value: payload.ethereum?.usd ?? null, changePercent: payload.ethereum?.usd_24h_change ?? null, asOf: payload.ethereum?.last_updated_at ? new Date(payload.ethereum.last_updated_at * 1000).toISOString() : null },
  ].filter((item) => item.value !== null).map((item) => ({ ...item, source: "CoinGecko", sourceUrl: `https://www.coingecko.com/en/coins/${item.key === "BTC" ? "bitcoin" : "ethereum"}` }));
}

export async function GET() {
  const [indicesSettled, macroSettled, cryptoSettled] = await Promise.all([
    Promise.allSettled([
      fetchIndex("NDX", "NASDAQ 100"),
      fetchIndex("SOX", "SOX 半导体"),
    ]),
    Promise.allSettled([
      fetchMacroProxy("SPY", "S&P 500 ETF"),
      fetchMacroProxy("TLT", "长期美债 ETF"),
      fetchMacroProxy("UUP", "美元指数 ETF"),
      fetchMacroProxy("HYG", "高收益债 ETF"),
    ]),
    fetchCrypto().catch(() => []),
  ]);

  const indices = indicesSettled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const macro = macroSettled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const crypto = cryptoSettled;

  return NextResponse.json({
    indices,
    macro,
    crypto,
    updatedAt: new Date().toISOString(),
    live: indices.length + macro.length + crypto.length > 0,
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
