import { NextRequest, NextResponse } from "next/server";

type GdeltArticle = { url?: string; url_mobile?: string; title?: string; seendate?: string; domain?: string; sourcecountry?: string; language?: string };

const trustedOriginalDomains = [
  "reuters.com", "bloomberg.com", "wsj.com", "ft.com", "cnbc.com", "sec.gov", "federalreserve.gov",
  "nvidia.com", "microsoft.com", "apple.com", "aboutamazon.com", "about.fb.com", "tsmc.com",
];

function parseGdeltDate(value?: string) {
  if (!value || !/^\d{8}T\d{6}Z$/.test(value)) return null;
  return new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`);
}

function normalizeTitle(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ").trim().split(" ").slice(0, 12).join(" ");
}

export async function GET(request: NextRequest) {
  const symbols = (request.nextUrl.searchParams.get("symbols") ?? "NVDA,MSFT,AAPL").split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9.\-]{1,12}$/.test(s)).slice(0, 12);
  const now = Date.now();
  try {
    const query = `(${symbols.join(" OR ")}) sourcelang:english`;
    const response = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=100&format=json&timespan=72h&sort=datedesc`, { headers: { "User-Agent": "AtlasMarkets/1.0" }, cf: { cacheTtl: 900, cacheEverything: true } });
    if (!response.ok) throw new Error(`provider ${response.status}`);
    const payload = await response.json() as { articles?: GdeltArticle[] };
    const seen = new Set<string>();
    const items = (payload.articles ?? []).flatMap((article, index) => {
      const published = parseGdeltDate(article.seendate);
      const domain = (article.domain ?? "").replace(/^www\./, "").toLowerCase();
      const title = (article.title ?? "").trim();
      const sourceUrl = article.url ?? article.url_mobile ?? "";
      if (!published || now - published.getTime() > 72 * 3_600_000 || published.getTime() > now + 5 * 60_000) return [];
      if (!trustedOriginalDomains.some((trusted) => domain === trusted || domain.endsWith(`.${trusted}`))) return [];
      if (!title || !sourceUrl || /originally published|repost|republished|syndicated/i.test(title)) return [];
      const canonical = normalizeTitle(title);
      if (!canonical || seen.has(canonical)) return [];
      seen.add(canonical);
      const ticker = symbols.find((symbol) => title.toUpperCase().includes(symbol)) ?? symbols[0] ?? "MARKET";
      return [{
        id: `${published.getTime()}-${index}`,
        ticker,
        summary: title,
        source: domain,
        sourceUrl,
        publishedAt: published.toISOString(),
        firstSeenAt: published.toISOString(),
        isPrimary: ["sec.gov", "federalreserve.gov", "nvidia.com", "microsoft.com", "apple.com", "aboutamazon.com", "about.fb.com", "tsmc.com"].some((trusted) => domain === trusted || domain.endsWith(`.${trusted}`)),
      }];
    }).slice(0, 12);
    return NextResponse.json({ items, policy: { maxAgeHours: 72, trustedOriginalOnly: true, deduplicated: true }, updatedAt: new Date().toISOString() }, { headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=1800" } });
  } catch {
    return NextResponse.json({ items: [], policy: { maxAgeHours: 72, trustedOriginalOnly: true, deduplicated: true }, updatedAt: new Date().toISOString() });
  }
}
