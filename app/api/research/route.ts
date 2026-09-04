import { NextRequest, NextResponse } from "next/server";

type NasdaqEarningsRow = {
  fiscalQtrEnd?: string;
  dateReported?: string;
  eps?: number | string;
  consensusForecast?: number | string;
  percentageSurprise?: number | string;
};

type NasdaqRatingAction = {
  firm?: string;
  analyst?: string;
  date?: string;
  action?: string;
  ratingPrior?: string;
  ratingCurrent?: string;
  priceTargetPrior?: number | string;
  priceTargetCurrent?: number | string;
};

type NasdaqArticle = {
  id?: number;
  title?: string;
  description?: string;
  created?: string;
  ago?: string;
  publisher?: string;
  url?: string;
};

type SecTicker = { cik_str: number; ticker: string; title: string };
type SecSubmissions = {
  name?: string;
  filings?: {
    recent?: {
      accessionNumber?: string[];
      filingDate?: string[];
      reportDate?: string[];
      acceptanceDateTime?: string[];
      form?: string[];
      primaryDocument?: string[];
      primaryDocDescription?: string[];
      items?: string[];
    };
  };
};

const WINDOW_DAYS = 7;
const WINDOW_MS = WINDOW_DAYS * 86_400_000;
const NASDAQ_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "User-Agent": "Mozilla/5.0 (compatible; AtlasMarkets/3.0)",
  Origin: "https://www.nasdaq.com",
  Referer: "https://www.nasdaq.com/",
};
const SEC_HEADERS = {
  Accept: "application/json",
  "User-Agent": "Atlas Markets research dashboard github.com/JoeZhong2002/atlas-markets-dashboard",
};

const INSTITUTIONS = [
  { name: "JPMorgan", patterns: ["JP MORGAN", "JPMORGAN", "J.P. MORGAN"] },
  { name: "Morgan Stanley", patterns: ["MORGAN STANLEY"] },
  { name: "Goldman Sachs", patterns: ["GOLDMAN SACHS"] },
  { name: "BofA", patterns: ["B OF A", "BANK OF AMERICA", "BOFA"] },
  { name: "Citi", patterns: ["CITIGROUP", "CITI"] },
  { name: "UBS", patterns: ["UBS"] },
  { name: "Jefferies", patterns: ["JEFFERIES"] },
];

const RATING_TERMS = /price target|target price|upgrade|downgrade|rating|initiates?|reiterates?|maintains?|raises?|lowers?|cuts?|boosts?|目标价|评级/i;
let secTickersPromise: Promise<Map<string, SecTicker>> | null = null;

function asNumber(value: number | string | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/[$,%+,]/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(value?: string) {
  if (!value) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00Z`)
    : /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(value)
      ? new Date(`${value} 12:00:00 GMT-0400`)
      : new Date(value);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

function publishedFrom(article: NasdaqArticle) {
  const ago = (article.ago ?? "").toLowerCase();
  const match = ago.match(/(\d+)\s+(minute|hour|day)s?\s+ago/);
  if (match) {
    const amount = Number(match[1]);
    const multiplier = match[2] === "minute" ? 60_000 : match[2] === "hour" ? 3_600_000 : 86_400_000;
    return new Date(Date.now() - amount * multiplier);
  }
  return parseDate(article.created);
}

function absoluteNasdaqUrl(url?: string) {
  if (!url) return null;
  return url.startsWith("http") ? url : `https://www.nasdaq.com${url}`;
}

async function fetchJson<T>(url: string, headers = NASDAQ_HEADERS) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`${new URL(url).hostname} ${response.status}`);
  return await response.json() as T;
}

async function secTickers() {
  if (!secTickersPromise) {
    secTickersPromise = fetchJson<Record<string, SecTicker>>("https://www.sec.gov/files/company_tickers.json", SEC_HEADERS)
      .then((payload) => new Map(Object.values(payload).map((item) => [item.ticker.toUpperCase(), item])))
      .catch((error) => {
        secTickersPromise = null;
        throw error;
      });
  }
  return secTickersPromise;
}

async function fetchSecFilings(symbol: string, cutoff: number) {
  try {
    const ticker = (await secTickers()).get(symbol);
    if (!ticker) throw new Error(`${symbol} CIK unavailable`);
    const cik = String(ticker.cik_str).padStart(10, "0");
    const payload = await fetchJson<SecSubmissions>(`https://data.sec.gov/submissions/CIK${cik}.json`, SEC_HEADERS);
    const recent = payload.filings?.recent;
    if (!recent?.accessionNumber) return [];

    return recent.accessionNumber.flatMap((accession, index) => {
      const form = recent.form?.[index] ?? "";
      const filed = recent.filingDate?.[index] ?? "";
      const filedAt = parseDate(filed);
      const items = recent.items?.[index] ?? "";
      const isEarnings = ["10-Q", "10-K", "20-F", "6-K"].includes(form) || (form === "8-K" && /(^|,)2\.02(,|$)/.test(items));
      if (!filedAt || filedAt.getTime() < cutoff || !isEarnings) return [];
      const primaryDocument = recent.primaryDocument?.[index] ?? "";
      const accessionCompact = accession.replace(/-/g, "");
      const filingUrl = primaryDocument
        ? `https://www.sec.gov/Archives/edgar/data/${ticker.cik_str}/${accessionCompact}/${encodeURIComponent(primaryDocument)}`
        : `https://www.sec.gov/Archives/edgar/data/${ticker.cik_str}/${accessionCompact}/`;
      return [{
        accession,
        form,
        filedAt: filed,
        acceptedAt: recent.acceptanceDateTime?.[index] ?? null,
        reportDate: recent.reportDate?.[index] ?? null,
        description: recent.primaryDocDescription?.[index] || `${form} filing`,
        items: items || null,
        earningsRelated: true,
        source: "SEC EDGAR",
        sourceUrl: filingUrl,
      }];
    }).slice(0, 3);
  } catch {
    const payload = await fetchJson<{ data?: { rows?: Array<{ formType?: string; filed?: string; period?: string; view?: { htmlLink?: string } }> } | null }>(
      `https://api.nasdaq.com/api/company/${encodeURIComponent(symbol)}/sec-filings?limit=30`,
    );
    return (payload.data?.rows ?? []).flatMap((row, index) => {
      const form = row.formType ?? "";
      const filedAt = parseDate(row.filed);
      if (!filedAt || filedAt.getTime() < cutoff || !["10-Q", "10-K", "20-F", "6-K", "8-K"].includes(form) || !row.view?.htmlLink) return [];
      return [{
        accession: `nasdaq-${symbol}-${form}-${row.filed ?? index}`,
        form,
        filedAt: row.filed ?? "",
        acceptedAt: null,
        reportDate: row.period ?? null,
        description: `${form} financial filing`,
        items: null,
        earningsRelated: form !== "8-K",
        source: "Nasdaq SEC Filings",
        sourceUrl: row.view.htmlLink,
      }];
    }).slice(0, 3);
  }
}

async function fetchNasdaqEarnings(symbol: string, cutoff: number) {
  const payload = await fetchJson<{ data?: { earningsSurpriseTable?: { rows?: NasdaqEarningsRow[] } } | null }>(
    `https://api.nasdaq.com/api/company/${encodeURIComponent(symbol)}/earnings-surprise`,
  );
  const row = (payload.data?.earningsSurpriseTable?.rows ?? []).find((item) => {
    const reported = parseDate(item.dateReported);
    return reported && reported.getTime() >= cutoff && reported.getTime() <= Date.now() + 86_400_000;
  });
  if (!row) return null;
  return {
    fiscalQuarter: row.fiscalQtrEnd ?? null,
    reportedAt: row.dateReported ?? null,
    eps: asNumber(row.eps),
    consensusEps: asNumber(row.consensusForecast),
    surprisePercent: asNumber(row.percentageSurprise),
    sourceUrl: `https://www.nasdaq.com/market-activity/stocks/${symbol.toLowerCase()}/earnings`,
  };
}

async function fetchNasdaqAnalyst(symbol: string) {
  const [ratingsPayload, targetPayload] = await Promise.all([
    fetchJson<{ data?: { meanRatingType?: string; ratingsSummary?: string; brokerNames?: string[]; upgradesDowngrades?: NasdaqRatingAction[] } | null }>(
      `https://api.nasdaq.com/api/analyst/${encodeURIComponent(symbol)}/ratings`,
    ),
    fetchJson<{ data?: { consensusOverview?: { lowPriceTarget?: number; highPriceTarget?: number; priceTarget?: number; buy?: number; sell?: number; hold?: number }; historicalConsensus?: Array<{ z?: { date?: string; consensus?: string }; y?: number }> } | null }>(
      `https://api.nasdaq.com/api/analyst/${encodeURIComponent(symbol)}/targetprice`,
    ),
  ]);
  const ratings = ratingsPayload.data;
  const target = targetPayload.data?.consensusOverview;
  const brokerNames = ratings?.brokerNames ?? [];
  const topFirms = INSTITUTIONS.filter((institution) => institution.patterns.some((pattern) => brokerNames.some((name) => name.toUpperCase().includes(pattern)))).map((item) => item.name);
  return {
    consensus: ratings?.meanRatingType ?? null,
    summary: ratings?.ratingsSummary ?? null,
    distribution: { buy: target?.buy ?? null, hold: target?.hold ?? null, sell: target?.sell ?? null },
    target: {
      average: target?.priceTarget ?? null,
      high: target?.highPriceTarget ?? null,
      low: target?.lowPriceTarget ?? null,
    },
    topFirms,
    actions: ratings?.upgradesDowngrades ?? [],
    sourceUrl: `https://www.nasdaq.com/market-activity/stocks/${symbol.toLowerCase()}/analyst-research`,
  };
}

async function fetchRatingEvidence(symbol: string, cutoff: number) {
  const payload = await fetchJson<{ data?: { rows?: NasdaqArticle[] } | null }>(
    `https://api.nasdaq.com/api/news/topic/articlebysymbol?q=${encodeURIComponent(`${symbol}|stocks`)}&offset=0&limit=30`,
  );
  return (payload.data?.rows ?? []).flatMap((article) => {
    const publishedAt = publishedFrom(article);
    const text = `${article.title ?? ""} ${article.description ?? ""}`.toUpperCase();
    const institutions = INSTITUTIONS.filter((institution) => institution.patterns.some((pattern) => text.includes(pattern))).map((item) => item.name);
    const url = absoluteNasdaqUrl(article.url);
    if (!publishedAt || publishedAt.getTime() < cutoff || !url || !institutions.length || !RATING_TERMS.test(text)) return [];
    return [{
      id: String(article.id ?? `${symbol}-${publishedAt.getTime()}`),
      title: (article.title ?? "").trim(),
      description: (article.description ?? "").trim() || null,
      publisher: article.publisher ? `${article.publisher} · Nasdaq` : "Nasdaq",
      publishedAt: publishedAt.toISOString(),
      institutions,
      sourceUrl: url,
    }];
  }).slice(0, 5);
}

function buildInsights(symbol: string, earnings: Awaited<ReturnType<typeof fetchNasdaqEarnings>>, analyst: Awaited<ReturnType<typeof fetchNasdaqAnalyst>> | null, filings: Awaited<ReturnType<typeof fetchSecFilings>>, evidence: Awaited<ReturnType<typeof fetchRatingEvidence>>) {
  const insights: Array<{ tone: "positive" | "negative" | "neutral"; title: string; detail: string; sourceIds: string[] }> = [];
  if (earnings && earnings.eps !== null && earnings.consensusEps !== null) {
    const delta = earnings.surprisePercent ?? ((earnings.eps - earnings.consensusEps) / Math.abs(earnings.consensusEps || 1) * 100);
    const tone = delta > 0 ? "positive" : delta < 0 ? "negative" : "neutral";
    insights.push({
      tone,
      title: `EPS ${delta > 0 ? "高于" : delta < 0 ? "低于" : "符合"}市场预期`,
      detail: `${symbol} 报告 EPS ${earnings.eps.toFixed(2)}，Nasdaq 共识为 ${earnings.consensusEps.toFixed(2)}，差异 ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%。`,
      sourceIds: ["S2"],
    });
  }
  if (analyst?.consensus) {
    const target = analyst.target.average;
    insights.push({
      tone: "neutral",
      title: `分析师共识为 ${analyst.consensus}`,
      detail: target === null
        ? `Nasdaq 当前提供评级共识，但未提供可用的平均目标价。`
        : `Nasdaq 当前平均目标价为 $${target.toFixed(2)}，区间 $${analyst.target.low?.toFixed(2) ?? "—"}–$${analyst.target.high?.toFixed(2) ?? "—"}。`,
      sourceIds: ["S3"],
    });
  }
  if (evidence.length) {
    insights.push({
      tone: "neutral",
      title: `${evidence.length} 条顶级机构动态可核验`,
      detail: `过去 7 天在 Nasdaq 聚合内容中识别到 ${Array.from(new Set(evidence.flatMap((item) => item.institutions))).join("、")} 的评级或目标价相关动态。`,
      sourceIds: evidence.map((_, index) => `S${4 + index}`),
    });
  } else if (earnings || filings.length) {
    insights.push({
      tone: "neutral",
      title: "暂无逐家投行变动证据",
      detail: "Nasdaq 当前仅提供评级共识与覆盖机构，过去 7 天未检索到可验证的指定机构评级或目标价文章。",
      sourceIds: analyst ? ["S3"] : [],
    });
  }
  return insights;
}

async function researchSymbol(symbol: string, cutoff: number) {
  const [filingsResult, earningsResult, analystResult, evidenceResult] = await Promise.allSettled([
    fetchSecFilings(symbol, cutoff),
    fetchNasdaqEarnings(symbol, cutoff),
    fetchNasdaqAnalyst(symbol),
    fetchRatingEvidence(symbol, cutoff),
  ]);
  const rawFilings = filingsResult.status === "fulfilled" ? filingsResult.value : [];
  const earnings = earningsResult.status === "fulfilled" ? earningsResult.value : null;
  const earningsDate = parseDate(earnings?.reportedAt ?? undefined);
  const filings = rawFilings.filter((filing) => filing.earningsRelated || (earningsDate && Math.abs((parseDate(filing.filedAt)?.getTime() ?? 0) - earningsDate.getTime()) <= 2 * 86_400_000));
  const analyst = analystResult.status === "fulfilled" ? analystResult.value : null;
  const ratingEvidence = evidenceResult.status === "fulfilled" ? evidenceResult.value : [];
  const hasRecentEvent = Boolean(earnings || filings.length || ratingEvidence.length || analyst?.actions.length);
  const sources = [
    ...filings.slice(0, 1).map((filing) => ({ id: "S1", label: `${filing.source} · ${filing.form}`, url: filing.sourceUrl, publishedAt: filing.filedAt, kind: "filing" })),
    ...(earnings ? [{ id: "S2", label: "Nasdaq Earnings", url: earnings.sourceUrl, publishedAt: earnings.reportedAt, kind: "earnings" }] : []),
    ...(analyst ? [{ id: "S3", label: "Nasdaq Analyst Research", url: analyst.sourceUrl, publishedAt: null, kind: "analyst" }] : []),
    ...ratingEvidence.map((item, index) => ({ id: `S${4 + index}`, label: item.publisher, url: item.sourceUrl, publishedAt: item.publishedAt, kind: "article" })),
  ];
  return {
    symbol,
    hasRecentEvent,
    filings,
    earnings,
    analyst,
    ratingEvidence,
    insights: buildInsights(symbol, earnings, analyst, filings, ratingEvidence),
    sources,
    health: {
      sec: filingsResult.status === "fulfilled",
      earnings: earningsResult.status === "fulfilled",
      analyst: analystResult.status === "fulfilled",
      news: evidenceResult.status === "fulfilled",
    },
  };
}

export async function GET(request: NextRequest) {
  const symbols = Array.from(new Set((request.nextUrl.searchParams.get("symbols") ?? "NVDA,MSFT,AAPL")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => /^[A-Z0-9.\-]{1,12}$/.test(symbol))))
    .slice(0, 30);
  const cutoff = Date.now() - WINDOW_MS;
  const results = await Promise.allSettled(symbols.map((symbol) => researchSymbol(symbol, cutoff)));
  const items = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const activeItems = items.filter((item) => item.hasRecentEvent);
  const health = {
    requested: symbols.length,
    completed: items.length,
    withRecentEvents: activeItems.length,
    degraded: items.filter((item) => Object.values(item.health).some((ok) => !ok)).length,
  };

  return NextResponse.json({
    items: activeItems,
    coverage: items.map((item) => ({ symbol: item.symbol, hasRecentEvent: item.hasRecentEvent, health: item.health })),
    windowDays: WINDOW_DAYS,
    updatedAt: new Date().toISOString(),
    health,
    methodology: {
      primaryFilings: "SEC EDGAR; Nasdaq SEC filing index fallback",
      earningsAndConsensus: "Nasdaq",
      institutionEvents: "Nasdaq-hosted articles; best effort only",
    },
    live: items.length > 0,
  }, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}
