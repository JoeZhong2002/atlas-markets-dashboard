import { NextRequest, NextResponse } from "next/server";

type NasdaqArticle = {
  id?: number;
  title?: string;
  description?: string;
  created?: string;
  ago?: string;
  publisher?: string;
  url?: string;
  primarysymbol?: string;
};

const MAX_AGE_MS = 72 * 3_600_000;
const NASDAQ_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "User-Agent": "Mozilla/5.0 (compatible; AtlasMarkets/1.0)",
  Origin: "https://www.nasdaq.com",
  Referer: "https://www.nasdaq.com/",
};

const COMPANY_ALIASES: Record<string, string[]> = {
  NVDA: ["NVDA", "NVIDIA"], TSM: ["TSM", "TSMC", "TAIWAN SEMICONDUCTOR"], MSFT: ["MSFT", "MICROSOFT"],
  META: ["META", "FACEBOOK"], AMZN: ["AMZN", "AMAZON", "AWS"], AAPL: ["AAPL", "APPLE"],
  GOOGL: ["GOOGL", "GOOGLE", "ALPHABET"], GOOG: ["GOOG", "GOOGLE", "ALPHABET"], AMD: ["AMD", "ADVANCED MICRO DEVICES"],
};

function publishedFrom(article: NasdaqArticle) {
  const ago = (article.ago ?? "").toLowerCase();
  const match = ago.match(/(\d+)\s+(minute|hour|day)s?\s+ago/);
  if (match) {
    const amount = Number(match[1]);
    const multiplier = match[2] === "minute" ? 60_000 : match[2] === "hour" ? 3_600_000 : 86_400_000;
    return new Date(Date.now() - amount * multiplier);
  }
  const parsed = article.created ? new Date(`${article.created} 12:00:00 GMT-0400`) : new Date(Number.NaN);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function canonicalTitle(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ").trim().split(" ").slice(0, 14).join(" ");
}

async function fetchSymbolNews(symbol: string) {
  const response = await fetch(`https://api.nasdaq.com/api/news/topic/articlebysymbol?q=${encodeURIComponent(`${symbol}|stocks`)}&offset=0&limit=12`, {
    headers: NASDAQ_HEADERS,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Nasdaq ${response.status}`);
  const payload = await response.json() as { data?: { rows?: NasdaqArticle[] } | null };
  return (payload.data?.rows ?? []).map((article) => ({ symbol, article }));
}

export async function GET(request: NextRequest) {
  const symbols = (request.nextUrl.searchParams.get("symbols") ?? "NVDA,MSFT,AAPL")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => /^[A-Z0-9.\-]{1,12}$/.test(symbol))
    .slice(0, 10);

  const settled = await Promise.allSettled(symbols.map(fetchSymbolNews));
  const rows = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const seen = new Set<string>();
  const now = Date.now();

  const items = rows.flatMap(({ symbol, article }, index) => {
    const published = publishedFrom(article);
    const title = (article.title ?? "").trim();
    const key = canonicalTitle(title);
    if (!published || now - published.getTime() > MAX_AGE_MS || published.getTime() > now + 5 * 60_000) return [];
    if (!title || !article.url || !key || seen.has(key)) return [];
    if (/originally published|repost|republished|syndicated|from the archives/i.test(`${title} ${article.description ?? ""}`)) return [];
    if (/should you buy|prediction:|history says|without hesitation|better buy|top \d+ stocks?|stocks? to buy|stock a buy|buy ahead|no brainer buy|worth buying|most likely to deliver/i.test(title)) return [];
    if (article.primarysymbol && article.primarysymbol.toUpperCase() !== symbol) return [];
    const aliases = COMPANY_ALIASES[symbol] ?? [symbol];
    const directlyNamed = aliases.some((alias) => title.toUpperCase().includes(alias));
    if (!article.primarysymbol && !directlyNamed && article.publisher !== "Barchart") return [];
    seen.add(key);
    return [{
      id: String(article.id ?? `${published.getTime()}-${index}`),
      ticker: symbol,
      summary: title,
      source: article.publisher ? `${article.publisher} · Nasdaq` : "Nasdaq",
      sourceUrl: article.url.startsWith("http") ? article.url : `https://www.nasdaq.com${article.url}`,
      publishedAt: published.toISOString(),
      firstSeenAt: published.toISOString(),
      isPrimary: false,
    }];
  }).sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt)).slice(0, 16);

  return NextResponse.json({
    items,
    policy: { maxAgeHours: 72, republishMarkersRemoved: true, deduplicated: true },
    updatedAt: new Date().toISOString(),
    live: settled.some((result) => result.status === "fulfilled"),
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
