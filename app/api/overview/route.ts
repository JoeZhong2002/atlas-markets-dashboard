import { NextResponse } from "next/server";

type NasdaqIndexData = {
  companyName?: string;
  primaryData?: {
    lastSalePrice?: string;
    percentageChange?: string;
    lastTradeTimestamp?: string;
  } | null;
};

type FredSeriesConfig = {
  key: string;
  name: string;
  seriesId: string;
  format: "percent" | "number" | "currency";
  changeUnit: "bp" | "percent" | "points";
  meaning: string;
};

type FredObservation = { date: string; value: number };

const NASDAQ_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "User-Agent": "Mozilla/5.0 (compatible; AtlasMarkets/2.0)",
  Origin: "https://www.nasdaq.com",
  Referer: "https://www.nasdaq.com/",
};

const FRED_SERIES: FredSeriesConfig[] = [
  { key: "US2Y", name: "美国 2 年期", seriesId: "DGS2", format: "percent", changeUnit: "bp", meaning: "政策利率预期的高敏感度代理" },
  { key: "US10Y", name: "美国 10 年期", seriesId: "DGS10", format: "percent", changeUnit: "bp", meaning: "长期增长、通胀与期限溢价" },
  { key: "REAL10Y", name: "10 年实际利率", seriesId: "DFII10", format: "percent", changeUnit: "bp", meaning: "科技股估值折现率的核心压力计" },
  { key: "HYOAS", name: "高收益债利差", seriesId: "BAMLH0A0HYM2", format: "percent", changeUnit: "bp", meaning: "融资与信用压力的直接读数" },
  { key: "VIX", name: "VIX", seriesId: "VIXCLS", format: "number", changeUnit: "percent", meaning: "未来约 30 天的股票市场隐含波动" },
  { key: "VIX3M", name: "3 个月波动率", seriesId: "VXVCLS", format: "number", changeUnit: "percent", meaning: "用于识别短期风险是否压过中期风险" },
  { key: "USD", name: "广义美元指数", seriesId: "DTWEXBGS", format: "number", changeUnit: "percent", meaning: "跨国科技公司海外收入与全球流动性压力" },
  { key: "WTI", name: "WTI 原油", seriesId: "DCOILWTICO", format: "currency", changeUnit: "percent", meaning: "通胀冲击与利率再定价的重要输入" },
  { key: "NATGAS", name: "美国天然气", seriesId: "DHHNGSP", format: "currency", changeUnit: "percent", meaning: "数据中心电力成本与能源约束代理" },
];

function numberFrom(value?: string) {
  if (!value || /n\/a/i.test(value)) return null;
  const parsed = Number(value.replace(/[$,%+,]/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function recentStartDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 45);
  return date.toISOString().slice(0, 10);
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

async function fetchFredSeries(config: FredSeriesConfig) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(config.seriesId)}&cosd=${recentStartDate()}`;
  const response = await fetch(url, {
    headers: { Accept: "text/csv,*/*;q=0.8", "User-Agent": "Mozilla/5.0 (compatible; AtlasMarkets/2.0; +https://github.com/JoeZhong2002/atlas-markets-dashboard)", Referer: "https://fred.stlouisfed.org/" },
    cache: "no-store",
    signal: AbortSignal.timeout(18_000),
  });
  if (!response.ok) throw new Error(`FRED ${response.status}`);

  const rows = (await response.text()).trim().split(/\r?\n/).slice(1);
  const observations = rows.flatMap((row): FredObservation[] => {
    const [date, rawValue] = row.split(",");
    const value = Number(rawValue);
    return date && rawValue && Number.isFinite(value) ? [{ date, value }] : [];
  });
  if (!observations.length) throw new Error(`${config.seriesId} unavailable`);

  const latest = observations.at(-1)!;
  const previous = observations.at(-2) ?? latest;
  const rawChange = latest.value - previous.value;
  const change = config.changeUnit === "bp"
    ? rawChange * 100
    : config.changeUnit === "percent" && previous.value !== 0
      ? rawChange / Math.abs(previous.value) * 100
      : rawChange;

  return {
    key: config.key,
    name: config.name,
    value: latest.value,
    change,
    changeUnit: config.changeUnit,
    format: config.format,
    asOf: latest.date,
    meaning: config.meaning,
    source: "FRED",
    sourceUrl: `https://fred.stlouisfed.org/series/${config.seriesId}`,
  };
}

async function fetchFredSeriesInBatches() {
  const results: PromiseSettledResult<Awaited<ReturnType<typeof fetchFredSeries>>>[] = [];
  for (let index = 0; index < FRED_SERIES.length; index += 3) {
    const batch = FRED_SERIES.slice(index, index + 3);
    results.push(...await Promise.allSettled(batch.map(fetchFredSeries)));
  }
  return results;
}

async function fetchCrypto() {
  const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin%2Cethereum&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true", {
    headers: {
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (compatible; AtlasMarkets/3.0; +https://github.com/JoeZhong2002/atlas-markets-dashboard)",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`CoinGecko ${response.status}`);
  const payload = await response.json() as Record<string, { usd?: number; usd_24h_change?: number; last_updated_at?: number }>;
  return [
    { key: "BTC", name: "Bitcoin", value: payload.bitcoin?.usd ?? null, changePercent: payload.bitcoin?.usd_24h_change ?? null, asOf: payload.bitcoin?.last_updated_at ? new Date(payload.bitcoin.last_updated_at * 1000).toISOString() : null },
    { key: "ETH", name: "Ethereum", value: payload.ethereum?.usd ?? null, changePercent: payload.ethereum?.usd_24h_change ?? null, asOf: payload.ethereum?.last_updated_at ? new Date(payload.ethereum.last_updated_at * 1000).toISOString() : null },
  ].filter((item) => item.value !== null).map((item) => ({ ...item, source: "CoinGecko", sourceUrl: `https://www.coingecko.com/en/coins/${item.key === "BTC" ? "bitcoin" : "ethereum"}` }));
}

function deriveSignals(signals: Awaited<ReturnType<typeof fetchFredSeries>>[]) {
  const byKey = Object.fromEntries(signals.map((item) => [item.key, item]));
  const us2y = byKey.US2Y;
  const us10y = byKey.US10Y;
  const vix = byKey.VIX;
  const vix3m = byKey.VIX3M;
  const derived = [];

  if (us2y && us10y) {
    derived.push({
      key: "CURVE2S10S",
      name: "2s10s 利差",
      value: (us10y.value - us2y.value) * 100,
      change: us10y.change - us2y.change,
      changeUnit: "bp" as const,
      format: "spread" as const,
      asOf: us10y.asOf > us2y.asOf ? us2y.asOf : us10y.asOf,
      meaning: "增长预期与政策约束的组合温度计",
      source: "FRED",
      sourceUrl: "https://fred.stlouisfed.org/graph/?g=1TIsZ",
    });
  }

  if (vix && vix3m && vix3m.value !== 0) {
    const ratio = vix.value / vix3m.value;
    derived.push({
      key: "VIXCURVE",
      name: "VIX / 3M",
      value: ratio,
      change: null,
      changeUnit: "points" as const,
      format: "ratio" as const,
      asOf: vix.asOf > vix3m.asOf ? vix3m.asOf : vix.asOf,
      meaning: ratio > 1 ? "期限结构倒挂：短期风险高于中期" : "期限结构正常：短期压力低于中期",
      source: "FRED / Cboe",
      sourceUrl: "https://www.cboe.com/tradable-products/vix/term-structure/",
    });
  }

  return derived;
}

function buildRegime(signals: Array<{ key: string; value: number; change: number | null; meaning: string }>) {
  const byKey = Object.fromEntries(signals.map((item) => [item.key, item]));
  const drivers: string[] = [];
  let riskScore = 0;

  if ((byKey.REAL10Y?.change ?? 0) >= 5) { riskScore += 1; drivers.push("实际利率上行，估值折现压力增加"); }
  if ((byKey.REAL10Y?.change ?? 0) <= -5) { riskScore -= 1; drivers.push("实际利率回落，估值压力缓解"); }
  if ((byKey.HYOAS?.change ?? 0) >= 8) { riskScore += 2; drivers.push("信用利差走阔，融资压力上升"); }
  if ((byKey.HYOAS?.change ?? 0) <= -8) { riskScore -= 1; drivers.push("信用利差收窄，风险偏好改善"); }
  if ((byKey.VIXCURVE?.value ?? 0) > 1) { riskScore += 2; drivers.push("波动率期限结构倒挂，短期避险需求升温"); }
  if ((byKey.VIX?.value ?? 0) >= 25) { riskScore += 1; drivers.push("隐含波动率处于高位"); }
  if ((byKey.WTI?.change ?? 0) >= 3) { riskScore += 1; drivers.push("油价快速上涨，通胀再定价风险增加"); }

  const tone = riskScore >= 3 ? "risk" : riskScore <= -1 ? "constructive" : "watch";
  const label = tone === "risk" ? "风险收紧" : tone === "constructive" ? "环境改善" : "信号混合";
  const summary = tone === "risk"
    ? "利率、信用或波动率正在共同抬高科技股风险溢价。"
    : tone === "constructive"
      ? "折现率与风险溢价组合正在改善，对科技股相对友好。"
      : "利率、信用与风险偏好尚未形成一致方向，宜等待更多确认。";

  return { label, tone, summary, drivers: drivers.slice(0, 3) };
}

export async function GET() {
  const [indicesSettled, macroSettled, fredSettled, cryptoSettled] = await Promise.all([
    Promise.allSettled([
      fetchIndex("NDX", "NASDAQ 100"),
      fetchIndex("SOX", "SOX 半导体"),
    ]),
    Promise.allSettled([
      fetchMacroProxy("SPY", "S&P 500 ETF"),
      fetchMacroProxy("TLT", "长期美债 ETF"),
      fetchMacroProxy("UUP", "美元 ETF"),
      fetchMacroProxy("HYG", "高收益债 ETF"),
      fetchMacroProxy("QQQ", "NASDAQ 100 ETF"),
      fetchMacroProxy("QQEW", "NASDAQ 100 等权 ETF"),
    ]),
    fetchFredSeriesInBatches(),
    fetchCrypto()
      .then((items) => ({ items, error: null }))
      .catch((error: unknown) => ({ items: [], error: error instanceof Error ? error.message : "CoinGecko request failed" })),
  ]);

  const indices = indicesSettled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const macro = macroSettled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const fred = fredSettled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const signals = [...fred, ...deriveSignals(fred)];
  const crypto = cryptoSettled.items;
  const fredFailure = fredSettled.find((item): item is PromiseRejectedResult => item.status === "rejected");
  const health = [
    { key: "quotes", name: "Nasdaq 指数", available: indices.length, total: 2, detail: indices.length ? null : "指数请求未返回有效行情" },
    { key: "proxies", name: "Nasdaq ETF", available: macro.length, total: 6, detail: macro.length ? null : "ETF 请求未返回有效行情" },
    { key: "fred", name: "FRED 宏观", available: fred.length, total: FRED_SERIES.length, detail: fredFailure?.reason instanceof Error ? fredFailure.reason.message : null },
    { key: "crypto", name: "CoinGecko", available: crypto.length, total: 2, detail: crypto.length ? null : cryptoSettled.error },
  ].map((item) => ({ ...item, status: item.available === item.total ? "live" : item.available > 0 ? "partial" : "down" }));

  return NextResponse.json({
    indices,
    macro,
    signals,
    regime: buildRegime(signals),
    health,
    crypto,
    updatedAt: new Date().toISOString(),
    live: indices.length + macro.length + signals.length + crypto.length > 0,
  }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
}
