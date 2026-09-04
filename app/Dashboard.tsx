"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Quote = {
  symbol: string;
  name: string;
  price: number | null;
  changePercent: number | null;
  extendedChangePercent: number | null;
  extendedSession: string | null;
  volume: number | null;
  averageVolume: number | null;
  volumeRatio: number | null;
  currency: string;
  marketState: string;
  asOf: string | null;
  source: string;
  sourceUrl: string;
};

type SearchResult = { symbol: string; name: string; exchange: string; type: string };
type MarketEvent = { symbol: string; title: string; detail: string; sourceUrl: string };
type Evidence = { id: string; ticker: string; summary: string; source: string; sourceUrl: string; publishedAt: string; firstSeenAt: string; isPrimary: boolean };
type IndexPoint = { key: string; name: string; value: number; changePercent: number | null; asOf: string | null; source: string; sourceUrl: string };
type MacroPoint = { key: string; name: string; value: number; changePercent: number | null; asOf: string | null; source: string; sourceUrl: string };
type CryptoPoint = { key: string; name: string; value: number; changePercent: number | null; asOf: string | null; source: string; sourceUrl: string };
type CoreSignal = {
  key: string;
  name: string;
  value: number;
  change: number | null;
  changeUnit: "bp" | "percent" | "points";
  format: "percent" | "number" | "currency" | "spread" | "ratio";
  asOf: string;
  meaning: string;
  source: string;
  sourceUrl: string;
};
type SourceHealth = { key: string; name: string; available: number; total: number; status: "live" | "partial" | "down"; detail?: string | null };
type MarketRegime = { label: string; tone: "constructive" | "watch" | "risk"; summary: string; drivers: string[] };
type Overview = {
  indices: IndexPoint[];
  macro: MacroPoint[];
  signals: CoreSignal[];
  health: SourceHealth[];
  regime: MarketRegime;
  crypto: CryptoPoint[];
};
type DataStatus = "loading" | "live" | "partial" | "error";
type CachedDashboard = {
  savedAt: string;
  quotes: Quote[];
  events: MarketEvent[];
  evidence: Evidence[];
  overview: Overview;
  research?: ResearchResponse;
};

type ResearchFiling = { accession: string; form: string; filedAt: string; acceptedAt: string | null; reportDate: string | null; description: string; items: string | null; source: string; sourceUrl: string };
type ResearchEarnings = { fiscalQuarter: string | null; reportedAt: string | null; eps: number | null; consensusEps: number | null; surprisePercent: number | null; sourceUrl: string };
type ResearchAnalyst = {
  consensus: string | null;
  summary: string | null;
  distribution: { buy: number | null; hold: number | null; sell: number | null };
  target: { average: number | null; high: number | null; low: number | null };
  topFirms: string[];
  actions: Array<{ firm?: string; analyst?: string; date?: string; action?: string; ratingPrior?: string; ratingCurrent?: string; priceTargetPrior?: number | string; priceTargetCurrent?: number | string }>;
  sourceUrl: string;
};
type RatingEvidence = { id: string; title: string; description: string | null; publisher: string; publishedAt: string; institutions: string[]; sourceUrl: string };
type ResearchInsight = { tone: "positive" | "negative" | "neutral"; title: string; detail: string; sourceIds: string[] };
type ResearchSource = { id: string; label: string; url: string; publishedAt: string | null; kind: string };
type ResearchCompany = {
  symbol: string;
  hasRecentEvent: boolean;
  filings: ResearchFiling[];
  earnings: ResearchEarnings | null;
  analyst: ResearchAnalyst | null;
  ratingEvidence: RatingEvidence[];
  insights: ResearchInsight[];
  sources: ResearchSource[];
  health: { sec: boolean; earnings: boolean; analyst: boolean; news: boolean };
};
type ResearchResponse = {
  items: ResearchCompany[];
  coverage: Array<{ symbol: string; hasRecentEvent: boolean; health: ResearchCompany["health"] }>;
  windowDays: number;
  updatedAt: string | null;
  health: { requested: number; completed: number; withRecentEvents: number; degraded: number };
  live: boolean;
};

const DEFAULT_WATCHLIST = ["NVDA", "TSM", "MSFT", "META", "AMZN", "AAPL"];
const STORAGE_KEY = "atlas-watchlist-v1";
const DATA_CACHE_KEY = "atlas-dashboard-cache-v2";
const MAX_AGE_HOURS = 72;
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;
const EMPTY_REGIME: MarketRegime = { label: "等待信号", tone: "watch", summary: "正在连接利率、信用与波动率数据。", drivers: [] };
const EMPTY_OVERVIEW: Overview = { indices: [], macro: [], signals: [], health: [], regime: EMPTY_REGIME, crypto: [] };
const EMPTY_RESEARCH: ResearchResponse = { items: [], coverage: [], windowDays: 7, updatedAt: null, health: { requested: 0, completed: 0, withRecentEvents: 0, degraded: 0 }, live: false };

const fallbackSearch: SearchResult[] = [
  { symbol: "AMD", name: "Advanced Micro Devices", exchange: "NASDAQ", type: "Equity" },
  { symbol: "AVGO", name: "Broadcom", exchange: "NASDAQ", type: "Equity" },
  { symbol: "GOOGL", name: "Alphabet Class A", exchange: "NASDAQ", type: "Equity" },
  { symbol: "PLTR", name: "Palantir Technologies", exchange: "NASDAQ", type: "Equity" },
];

const OFFICIAL_CALENDARS = [
  { key: "CPI", name: "CPI / 就业 / PPI", owner: "BLS", href: "https://www.bls.gov/schedule/news_release/" },
  { key: "PCE", name: "PCE / GDP", owner: "BEA", href: "https://www.bea.gov/news/schedule" },
  { key: "FOMC", name: "FOMC 会议", owner: "Federal Reserve", href: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" },
  { key: "FED", name: "市场隐含利率", owner: "CME FedWatch", href: "https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html" },
];

function pct(value: number | null) {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function ageHours(iso: string) {
  return Math.max(0, (Date.now() - new Date(iso).getTime()) / 3_600_000);
}

function compactNumber(value: number | null) {
  if (value === null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

function volumeShare(value: number | null) {
  if (value === null || Number.isNaN(value)) return "—";
  return value < 0.1 ? `${(value * 100).toFixed(2)}%` : `${value.toFixed(2)}×`;
}

function price(value: number | null, currency = "USD") {
  if (value === null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: value >= 1000 ? 0 : 2 }).format(value);
}

function signalValue(signal: CoreSignal) {
  if (signal.format === "percent") return `${signal.value.toFixed(2)}%`;
  if (signal.format === "spread") return `${signal.value >= 0 ? "+" : ""}${signal.value.toFixed(0)} bp`;
  if (signal.format === "ratio") return signal.value.toFixed(2);
  if (signal.format === "currency") return `$${signal.value.toFixed(2)}`;
  return signal.value.toFixed(2);
}

function signalChange(signal: CoreSignal) {
  if (signal.change === null) return signal.key === "VIXCURVE" ? (signal.value > 1 ? "倒挂" : "正常") : "—";
  if (signal.changeUnit === "bp") return `${signal.change >= 0 ? "+" : ""}${signal.change.toFixed(0)} bp`;
  if (signal.changeUnit === "percent") return `${signal.change >= 0 ? "+" : ""}${signal.change.toFixed(2)}%`;
  return `${signal.change >= 0 ? "+" : ""}${signal.change.toFixed(2)}`;
}

function cacheAgeLabel(savedAt: string) {
  const hours = Math.max(0, Math.floor((Date.now() - new Date(savedAt).getTime()) / 3_600_000));
  return hours < 1 ? "不足 1 小时" : `${hours} 小时`;
}

function nextNineAm() {
  const next = new Date();
  next.setHours(9, 0, 0, 0);
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
  return next;
}

async function getJson<T>(url: string) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status}`);
    return await response.json() as T;
  } finally {
    window.clearTimeout(timer);
  }
}

async function fetchCoinGeckoDirect(): Promise<CryptoPoint[]> {
  const payload = await getJson<Record<string, { usd?: number; usd_24h_change?: number; last_updated_at?: number }>>(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin%2Cethereum&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true",
  );
  return [
    { key: "BTC", name: "Bitcoin", coinId: "bitcoin" },
    { key: "ETH", name: "Ethereum", coinId: "ethereum" },
  ].flatMap(({ key, name, coinId }): CryptoPoint[] => {
    const point = payload[coinId];
    if (!point || typeof point.usd !== "number") return [];
    return [{
      key,
      name,
      value: point.usd,
      changePercent: typeof point.usd_24h_change === "number" ? point.usd_24h_change : null,
      asOf: point.last_updated_at ? new Date(point.last_updated_at * 1000).toISOString() : null,
      source: "CoinGecko（浏览器直连）",
      sourceUrl: `https://www.coingecko.com/en/coins/${coinId}`,
    }];
  });
}

export function Dashboard() {
  const [watchlist, setWatchlist] = useState(DEFAULT_WATCHLIST);
  const [hydrated, setHydrated] = useState(false);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [events, setEvents] = useState<MarketEvent[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [overview, setOverview] = useState<Overview>(EMPTY_OVERVIEW);
  const [research, setResearch] = useState<ResearchResponse>(EMPTY_RESEARCH);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>(fallbackSearch);
  const [isSearching, setIsSearching] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [dataStatus, setDataStatus] = useState<DataStatus>("loading");
  const [refreshMessage, setRefreshMessage] = useState("正在连接数据源");
  const [cacheNotice, setCacheNotice] = useState<string | null>(null);
  const refreshSequence = useRef(0);

  useEffect(() => {
    const task = window.setTimeout(() => {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as string[];
          if (Array.isArray(parsed) && parsed.length) setWatchlist(parsed.slice(0, 30));
        } catch {
          window.localStorage.removeItem(STORAGE_KEY);
        }
      }
      const cached = window.localStorage.getItem(DATA_CACHE_KEY);
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as CachedDashboard;
          const cacheAge = Date.now() - new Date(parsed.savedAt).getTime();
          if (cacheAge <= MAX_CACHE_AGE_MS && parsed.overview) {
            setQuotes(Object.fromEntries((parsed.quotes ?? []).map((quote) => [quote.symbol, quote])));
            setEvents(parsed.events ?? []);
            setEvidence(parsed.evidence ?? []);
            setOverview(parsed.overview);
            setResearch(parsed.research ?? EMPTY_RESEARCH);
            setLastUpdated(new Date(parsed.savedAt));
            setDataStatus("partial");
            setCacheNotice(`正在展示 ${cacheAgeLabel(parsed.savedAt)}前的最近成功快照`);
          } else {
            window.localStorage.removeItem(DATA_CACHE_KEY);
          }
        } catch {
          window.localStorage.removeItem(DATA_CACHE_KEY);
        }
      }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(task);
  }, []);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(watchlist));
  }, [watchlist, hydrated]);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const stamp = Date.now();
    setIsRefreshing(true);
    setRefreshMessage("正在刷新行情、宏观和资讯…");

    const [marketResult, evidenceResult, overviewResult, researchResult] = await Promise.allSettled([
      getJson<{ quotes: Quote[]; events: MarketEvent[]; failedSymbols: string[]; live: boolean }>(`/api/market?symbols=${encodeURIComponent(watchlist.join(","))}&_=${stamp}`),
      getJson<{ items: Evidence[]; live: boolean }>(`/api/evidence?symbols=${encodeURIComponent(watchlist.join(","))}&_=${stamp}`),
      getJson<Overview & { live: boolean }>("/api/overview"),
      getJson<ResearchResponse>(`/api/research?symbols=${encodeURIComponent(watchlist.join(","))}`),
    ]);

    if (sequence !== refreshSequence.current) return;
    let completed = 0;
    const warnings: string[] = [];
    let cached: CachedDashboard = { savedAt: new Date(0).toISOString(), quotes: [], events: [], evidence: [], overview: EMPTY_OVERVIEW };
    try {
      const stored = window.localStorage.getItem(DATA_CACHE_KEY);
      if (stored) cached = JSON.parse(stored) as CachedDashboard;
    } catch {
      window.localStorage.removeItem(DATA_CACHE_KEY);
    }

    if (marketResult.status === "fulfilled" && marketResult.value.live) {
      setQuotes(Object.fromEntries(marketResult.value.quotes.map((quote) => [quote.symbol, quote])));
      setEvents(marketResult.value.events ?? []);
      cached.quotes = marketResult.value.quotes;
      cached.events = marketResult.value.events ?? [];
      completed += 1;
      if (marketResult.value.failedSymbols?.length) warnings.push(`${marketResult.value.failedSymbols.length} 只股票暂不可用`);
    } else {
      warnings.push(cached.quotes.length ? "自选股行情沿用最近快照" : "自选股行情失败");
    }

    if (evidenceResult.status === "fulfilled" && evidenceResult.value.live) {
      setEvidence(evidenceResult.value.items);
      cached.evidence = evidenceResult.value.items;
      completed += 1;
    } else {
      warnings.push(cached.evidence.length ? "资讯沿用最近快照" : "资讯失败");
    }

    if (overviewResult.status === "fulfilled" && overviewResult.value.live) {
      const nextOverview: Overview = {
        indices: overviewResult.value.indices,
        macro: overviewResult.value.macro,
        signals: overviewResult.value.signals,
        health: overviewResult.value.health,
        regime: overviewResult.value.regime,
        crypto: overviewResult.value.crypto,
      };
      if (!nextOverview.crypto.length) {
        try {
          const directCrypto = await fetchCoinGeckoDirect();
          if (directCrypto.length) {
            nextOverview.crypto = directCrypto;
            nextOverview.health = nextOverview.health.map((item) => item.key === "crypto"
              ? { ...item, available: directCrypto.length, status: directCrypto.length === item.total ? "live" : "partial", detail: "服务器出口受限，已由当前浏览器直连恢复" }
              : item);
          }
        } catch {
          // Keep the server health detail and any last successful snapshot below.
        }
      }
      setOverview(nextOverview);
      cached.overview = nextOverview;
      completed += 1;
      const degradedSources = nextOverview.health.filter((item) => item.status !== "live");
      if (degradedSources.length) warnings.push(`${degradedSources.map((item) => item.name).join("、")}数据不完整`);
    } else {
      warnings.push(cached.overview.signals.length ? "宏观数据沿用最近快照" : "宏观/加密数据失败");
    }

    if (researchResult.status === "fulfilled" && researchResult.value.live) {
      setResearch(researchResult.value);
      cached.research = researchResult.value;
      completed += 1;
      if (researchResult.value.health.degraded) warnings.push(`${researchResult.value.health.degraded} 只股票的财报数据不完整`);
    } else {
      warnings.push(cached.research ? "财报洞察沿用最近快照" : "财报洞察失败");
    }

    const now = new Date();
    if (completed) {
      cached.savedAt = now.toISOString();
      window.localStorage.setItem(DATA_CACHE_KEY, JSON.stringify(cached));
      setLastUpdated(now);
      setCacheNotice(null);
    }
    const hasCachedData = cached.quotes.length + cached.evidence.length + cached.overview.signals.length + (cached.research?.items.length ?? 0) > 0;
    setDataStatus(completed === 4 && !warnings.length ? "live" : completed || hasCachedData ? "partial" : "error");
    setRefreshMessage(completed
      ? (warnings.length ? `部分更新：${warnings.join("；")}` : "全部数据已刷新")
      : hasCachedData ? "实时连接失败，已保留最近成功快照" : "刷新失败，请稍后重试");
    setIsRefreshing(false);
  }, [watchlist]);

  useEffect(() => {
    if (!hydrated) return;
    const task = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(task);
  }, [hydrated, refresh]);

  useEffect(() => {
    let timer: number;
    const schedule = () => {
      timer = window.setTimeout(async () => {
        await refresh();
        schedule();
      }, nextNineAm().getTime() - Date.now());
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    if (!isAddOpen) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const trimmed = query.trim();
      if (!trimmed) {
        setResults(fallbackSearch);
        return;
      }
      setIsSearching(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}&_=${Date.now()}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("search unavailable");
        const data = await response.json() as { results: SearchResult[] };
        setResults(data.results);
      } catch {
        if (!controller.signal.aborted) {
          const q = trimmed.toLowerCase();
          setResults(fallbackSearch.filter((item) => item.symbol.toLowerCase().includes(q) || item.name.toLowerCase().includes(q)));
        }
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, isAddOpen]);

  const displayedQuotes = useMemo(() => watchlist.map((symbol) => ({ symbol, quote: quotes[symbol] ?? null })), [watchlist, quotes]);
  const freshEvidence = useMemo(() => evidence.filter((item) => ageHours(item.publishedAt) <= MAX_AGE_HOURS).sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt)), [evidence]);
  const prioritySignals = useMemo(() => {
    const priority = ["REAL10Y", "US2Y", "US10Y", "HYOAS", "VIXCURVE", "VIX", "USD", "WTI"];
    return priority.flatMap((key) => overview.signals.find((item) => item.key === key) ?? []);
  }, [overview.signals]);
  const relativeSignals = useMemo(() => {
    const macro = Object.fromEntries(overview.macro.map((item) => [item.key, item]));
    const indices = Object.fromEntries(overview.indices.map((item) => [item.key, item]));
    const qqqVsSpy = macro.QQQ?.changePercent !== null && macro.SPY?.changePercent !== null && macro.QQQ && macro.SPY
      ? macro.QQQ.changePercent! - macro.SPY.changePercent!
      : null;
    const equalWeight = macro.QQEW?.changePercent !== null && macro.QQQ?.changePercent !== null && macro.QQEW && macro.QQQ
      ? macro.QQEW.changePercent! - macro.QQQ.changePercent!
      : null;
    const semis = indices.SOX?.changePercent !== null && indices.NDX?.changePercent !== null && indices.SOX && indices.NDX
      ? indices.SOX.changePercent! - indices.NDX.changePercent!
      : null;
    return [
      { key: "QQQSPY", name: "科技相对大盘", value: qqqVsSpy, meaning: "QQQ − SPY 当日表现" },
      { key: "SOXNDX", name: "半导体相对科技", value: semis, meaning: "SOX − NDX 当日表现" },
      { key: "BREADTH", name: "等权市场宽度", value: equalWeight, meaning: "QQEW − QQQ 当日表现" },
    ];
  }, [overview.indices, overview.macro]);
  const snapshot = useMemo(() => [
    ...overview.indices.map((item) => ({ ...item, display: item.value.toLocaleString("en-US", { maximumFractionDigits: 2 }), delta: pct(item.changePercent) })),
    ...overview.macro.slice(0, 2).map((item) => ({ ...item, display: price(item.value), delta: pct(item.changePercent) })),
    ...overview.crypto.map((item) => ({ ...item, display: price(item.value), delta: pct(item.changePercent) })),
  ], [overview.indices, overview.macro, overview.crypto]);
  const marketObservation = overview.indices.length
    ? overview.indices.map((item) => `${item.name} ${pct(item.changePercent)}`).join(" · ")
    : "市场指数数据暂不可用";
  const availableSources = overview.health.filter((item) => item.available > 0).length + (Object.keys(quotes).length ? 1 : 0);
  const totalSources = overview.health.length + 1;
  const researchSources = useMemo(() => Object.fromEntries(research.items.flatMap((company) => company.sources.map((source) => [`${company.symbol}-${source.id}`, source]))), [research.items]);

  function addTicker(symbol: string) {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized || watchlist.includes(normalized)) return;
    setWatchlist((current) => [...current, normalized].slice(0, 30));
  }

  function removeTicker(symbol: string) {
    setWatchlist((current) => current.filter((item) => item !== symbol));
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Atlas Markets 首页"><span className="brand-mark">A</span><span><b>Atlas Markets</b><small>科技投资晨报</small></span></a>
        <nav className="main-nav" aria-label="主要导航"><a className="active" href="#top">晨间总览</a><a href="#signals">核心信号</a><a href="#watchlist">自选股</a><a href="#research">财报洞察</a><a href="#evidence">证据动态</a><a href="#calendar">事件日历</a></nav>
        <div className="update-state"><span className={`pulse ${dataStatus}`} />{{ loading: "连接中", live: "数据正常", partial: "部分可用", error: "刷新失败" }[dataStatus]}</div>
      </header>

      <main id="top" className="dashboard">
        <section className="hero-row">
          <div><span className="eyebrow">MORNING BRIEF · ASIA/SHANGHAI</span><h1>美股科技投资晨报</h1><p>{lastUpdated ? `最近成功更新 ${lastUpdated.toLocaleString("zh-CN", { hour12: false })}` : "尚未取得有效数据"} · 每日 09:00 自动刷新</p></div>
          <div className="hero-actions"><button className="button secondary refresh-button" disabled={isRefreshing} onClick={() => void refresh()}>{isRefreshing ? "刷新中…" : "↻ 刷新数据"}</button><button className="button primary" onClick={() => setIsAddOpen(true)}>＋ 添加自选股</button></div>
        </section>

        <div className={`refresh-notice ${dataStatus}`} role="status"><span>{isRefreshing ? "◌" : dataStatus === "error" ? "!" : "✓"}</span><b>{cacheNotice ?? refreshMessage}</b>{lastUpdated && <small>{cacheNotice ? "实时数据正在后台重试" : "本次请求未使用页面缓存"}</small>}</div>

        <section className="market-strip" aria-label="市场快照">
          {snapshot.length ? snapshot.slice(0, 6).map((item) => <a className="market-stat" href={item.sourceUrl} target="_blank" rel="noreferrer" key={item.key}><span>{item.name}</span><strong>{item.display}</strong><em className={item.delta.startsWith("+") ? "positive" : item.delta.startsWith("-") ? "negative" : ""}>{item.delta}</em><small>{item.source} ↗</small></a>) : Array.from({ length: 6 }, (_, index) => <div className="market-stat unavailable" key={index}><span>等待数据</span><strong>—</strong><em>—</em></div>)}
        </section>

        <section id="signals" className="panel signal-panel">
          <div className="panel-heading signal-heading"><div><span className="eyebrow">DAILY DECISION SIGNALS</span><h2>科技股核心信号</h2><p>同时观察折现率、信用、波动率和通胀输入；变化值均相对上一有效交易日。</p></div><span className="freshness-badge">FRED 官方序列</span></div>
          <div className="signal-grid">
            {prioritySignals.length ? prioritySignals.map((signal) => <a className="signal-card" href={signal.sourceUrl} target="_blank" rel="noreferrer" key={signal.key}><div className="signal-top"><span>{signal.name}</span><i>{signal.key}</i></div><strong>{signalValue(signal)}</strong><em className={(signal.change ?? 0) > 0 ? "negative" : (signal.change ?? 0) < 0 ? "positive" : ""}>{signalChange(signal)}</em><p>{signal.meaning}</p><small>{signal.asOf} · {signal.source} ↗</small></a>) : Array.from({ length: 8 }, (_, index) => <div className="signal-card unavailable" key={index}><div className="signal-top"><span>等待核心信号</span></div><strong>—</strong><p>正在连接 FRED 数据源</p></div>)}
          </div>
          <div className="relative-row">
            {relativeSignals.map((item) => <div className="relative-signal" key={item.key}><span>{item.name}</span><strong className={item.value === null ? "" : item.value >= 0 ? "positive" : "negative"}>{item.value === null ? "—" : `${item.value >= 0 ? "+" : ""}${item.value.toFixed(2)}%`}</strong><small>{item.meaning}</small></div>)}
          </div>
        </section>

        <section className="lead-grid">
          <article className="brief-card">
            <div className={`risk-block ${overview.regime.tone}`}><span>市场状态</span><strong>{overview.regime.label}</strong><small>{availableSources}/{totalSources} 组数据源可用</small></div>
            <div className="brief-copy"><div className="card-title-row"><span className="eyebrow">REGIME READ</span><span className={`status-chip ${overview.regime.tone}`}>规则化组合判断</span></div><h2>{overview.regime.summary}</h2><p>{overview.regime.drivers.length ? overview.regime.drivers.join("；") : `${marketObservation}。等待实际利率、信用和波动率形成更完整的组合信号。`}</p><div className="metric-chips">{overview.crypto.map((item) => <span key={item.key}>{item.key} 24h {pct(item.changePercent)}</span>)}{overview.macro.filter((item) => ["QQQ", "SPY", "HYG", "TLT"].includes(item.key)).map((item) => <span key={item.key}>{item.key} {pct(item.changePercent)}</span>)}</div></div>
          </article>
          <aside className="events-card"><div className="section-heading"><h2>自选股近期事件</h2><span>Nasdaq 公告</span></div><div className="event-list">{events.length ? events.slice(0, 3).map((event) => <a className="event" href={event.sourceUrl} target="_blank" rel="noreferrer" key={`${event.symbol}-${event.detail}`}><time>{event.symbol}</time><span><b>{event.title}</b><small>{event.detail}</small></span><i /></a>) : <div className="event-empty">暂无可核验的近期事件</div>}</div></aside>
        </section>

        <section id="watchlist" className="panel watchlist-panel">
          <div className="panel-heading"><div><span className="eyebrow">WATCHLIST</span><h2>自选股行情</h2><p>{watchlist.length} 只股票 · 列表保存在当前设备</p></div><button className="button secondary" onClick={() => setIsAddOpen(true)}>搜索 ticker 添加</button></div>
          <div className="table-scroll"><table><thead><tr><th>股票</th><th>最新价</th><th>常规时段</th><th>盘前/盘后</th><th>成交量</th><th>当前量 / 日均量</th><th>更新时间 / 来源</th><th><span className="sr-only">操作</span></th></tr></thead><tbody>
            {displayedQuotes.map(({ symbol, quote }) => <tr key={symbol}><td><div className="ticker-cell"><span>{symbol.slice(0, 2)}</span><div><b>{symbol}</b><small>{quote?.name ?? "等待行情"}</small></div></div></td><td>{quote ? price(quote.price, quote.currency) : "—"}</td><td className={(quote?.changePercent ?? 0) >= 0 ? "positive" : "negative"}>{quote ? pct(quote.changePercent) : "—"}</td><td className={(quote?.extendedChangePercent ?? 0) >= 0 ? "positive" : "negative"}>{quote?.extendedSession ? `${quote.extendedSession} ${pct(quote.extendedChangePercent)}` : "—"}</td><td>{quote ? compactNumber(quote.volume) : "—"}</td><td>{quote?.volumeRatio ? `${volumeShare(quote.volumeRatio)} / ${compactNumber(quote.averageVolume)}` : "—"}</td><td>{quote ? <a className="source-link" href={quote.sourceUrl} target="_blank" rel="noreferrer"><span>{quote.asOf ?? quote.marketState}</span><b>{quote.source} ↗</b></a> : <span className="unavailable-text">暂不可用</span>}</td><td><button className="icon-button" aria-label={`删除 ${symbol}`} onClick={() => removeTicker(symbol)}>×</button></td></tr>)}
          </tbody></table></div>
        </section>

        <section id="research" className="panel research-panel">
          <div className="panel-heading research-heading">
            <div><span className="eyebrow">EARNINGS INTELLIGENCE · 7 DAYS</span><h2>财报与华尔街共识</h2><p>自动匹配当前自选股；财报以 SEC 为原始证据，评级与目标价来自 Nasdaq 公开页面。</p></div>
            <span className="freshness-badge">可溯源 · 尽力覆盖</span>
          </div>
          <div className="research-summary">
            <div><span>扫描自选股</span><strong>{research.health.completed}/{research.health.requested || watchlist.length}</strong><small>过去 7 天</small></div>
            <div><span>新增财报/机构动态</span><strong>{research.health.withRecentEvents}</strong><small>只股票</small></div>
            <div><span>SEC 文件</span><strong>{research.items.reduce((total, item) => total + item.filings.length, 0)}</strong><small>原始披露</small></div>
            <div><span>顶级机构证据</span><strong>{research.items.reduce((total, item) => total + item.ratingEvidence.length, 0)}</strong><small>Nasdaq 文章</small></div>
          </div>
          {research.items.length ? <div className="research-list">
            {research.items.map((company) => {
              const quote = quotes[company.symbol];
              const target = company.analyst?.target.average ?? null;
              const targetUpside = quote?.price && target ? (target / quote.price - 1) * 100 : null;
              return <article className="research-company" key={company.symbol}>
                <header className="research-company-header">
                  <div className="research-symbol"><span>{company.symbol.slice(0, 2)}</span><div><b>{company.symbol}</b><small>{company.earnings?.fiscalQuarter ?? company.filings[0]?.form ?? "近期机构动态"}</small></div></div>
                  <div className="research-date"><b>{company.earnings?.reportedAt ?? company.filings[0]?.filedAt ?? "近 7 天"}</b><small>{company.earnings ? "财报已发布" : company.filings.length ? "SEC 新文件" : "机构观点更新"}</small></div>
                </header>

                <div className="research-body">
                  <div className="earnings-facts">
                    <div className="subsection-title"><span>财报事实</span><small>SEC / Nasdaq</small></div>
                    {company.earnings ? <div className="fact-grid">
                      <div><span>报告 EPS</span><strong>{company.earnings.eps?.toFixed(2) ?? "—"}</strong></div>
                      <div><span>市场预期</span><strong>{company.earnings.consensusEps?.toFixed(2) ?? "—"}</strong></div>
                      <div><span>Surprise</span><strong className={(company.earnings.surprisePercent ?? 0) >= 0 ? "positive" : "negative"}>{company.earnings.surprisePercent === null ? "—" : `${company.earnings.surprisePercent >= 0 ? "+" : ""}${company.earnings.surprisePercent.toFixed(1)}%`}</strong></div>
                    </div> : <div className="research-unavailable">Nasdaq 暂无过去 7 天的 EPS surprise 记录</div>}
                    <div className="filing-row">{company.filings.length ? company.filings.map((filing, index) => <a href={filing.sourceUrl} target="_blank" rel="noreferrer" key={filing.accession}><span>S{index + 1}</span><b>{filing.form}</b><small>{filing.filedAt} · {filing.source} ↗</small></a>) : <span className="muted-line">未匹配到同期 SEC 财报文件</span>}</div>
                  </div>

                  <div className="analyst-consensus">
                    <div className="subsection-title"><span>Nasdaq 分析师共识</span><small>非逐家投行评级</small></div>
                    {company.analyst ? <>
                      <div className="consensus-head"><strong>{company.analyst.consensus ?? "—"}</strong><span>平均目标价 <b>{target === null ? "—" : `$${target.toFixed(2)}`}</b></span><em className={(targetUpside ?? 0) >= 0 ? "positive" : "negative"}>{targetUpside === null ? "现价空间 —" : `现价空间 ${targetUpside >= 0 ? "+" : ""}${targetUpside.toFixed(1)}%`}</em></div>
                      <div className="rating-split"><span>Buy <b>{company.analyst.distribution.buy ?? "—"}</b></span><span>Hold <b>{company.analyst.distribution.hold ?? "—"}</b></span><span>Sell <b>{company.analyst.distribution.sell ?? "—"}</b></span></div>
                      <div className="target-range"><span>Low {company.analyst.target.low === null ? "—" : `$${company.analyst.target.low.toFixed(2)}`}</span><i /><span>High {company.analyst.target.high === null ? "—" : `$${company.analyst.target.high.toFixed(2)}`}</span></div>
                      <div className="firm-tags">{company.analyst.topFirms.length ? company.analyst.topFirms.map((firm) => <span key={firm}>{firm}</span>) : <small>指定顶级机构未出现在当前覆盖名单</small>}</div>
                    </> : <div className="research-unavailable">Nasdaq 分析师页面暂不可用</div>}
                  </div>

                  <div className="insight-column">
                    <div className="subsection-title"><span>核心 Insight</span><small>事实约束规则</small></div>
                    <div className="insight-list">{company.insights.map((insight, index) => <div className={`insight ${insight.tone}`} key={`${insight.title}-${index}`}><i /><div><b>{insight.title}</b><p>{insight.detail}</p><div className="source-pills">{insight.sourceIds.map((sourceId) => { const source = researchSources[`${company.symbol}-${sourceId}`]; return source ? <a href={source.url} target="_blank" rel="noreferrer" key={sourceId}>{sourceId} ↗</a> : null; })}</div></div></div>)}</div>
                  </div>
                </div>

                <div className="institution-evidence">
                  <div className="subsection-title"><span>过去 7 天顶级机构动态</span><small>仅展示 Nasdaq 可验证内容</small></div>
                  {company.ratingEvidence.length ? <div className="institution-list">{company.ratingEvidence.map((item) => <a href={item.sourceUrl} target="_blank" rel="noreferrer" key={item.id}><div><span>{item.institutions.join(" · ")}</span><time>{new Date(item.publishedAt).toLocaleDateString("zh-CN")}</time></div><b>{item.title}</b><small>{item.publisher} ↗</small></a>)}</div> : <p className="institution-empty">暂无可验证的逐家机构评级或目标价变动；覆盖机构名单不等同于本周发布评级。</p>}
                </div>
              </article>;
            })}
          </div> : <div className="empty-research"><span>7D</span><div><b>{research.live ? "过去 7 天暂无新增财报或可验证机构动态" : "正在扫描自选股财报与机构动态"}</b><p>{research.live ? "Nasdaq 的当前共识不会被误标为本周评级事件；下一次刷新将自动重新检查。" : "首次加载可能需要数秒，失败时会保留最近成功快照。"}</p></div></div>}
          <div className="research-method"><span>口径说明</span><p>SEC 文件属于公司原始披露；Nasdaq 分析师页面提供市场共识和覆盖机构。具体投行变动只有在 Nasdaq 文章或接口明确披露时才展示。</p><a href="https://www.nasdaq.com/market-activity/stocks/nvda/analyst-research" target="_blank" rel="noreferrer">查看 Nasdaq 方法 ↗</a></div>
        </section>

        <section id="evidence" className="content-grid">
          <article className="panel evidence-panel">
            <div className="panel-heading evidence-heading"><div><span className="eyebrow">PRICE MOVEMENT EVIDENCE</span><h2>价格波动证据</h2><p>仅列出过去 72 小时内的报道标题，不生成因果结论。</p></div><span className="freshness-badge">72h 鲜度门槛</span></div>
            {freshEvidence.length ? <div className="evidence-list">{freshEvidence.map((item) => <a className="evidence-item" href={item.sourceUrl} target="_blank" rel="noreferrer" key={item.id}><div className="evidence-meta"><span className="ticker-tag">{item.ticker}</span><span>{item.source}</span><span>近期报道</span><span>{Math.floor(ageHours(item.publishedAt))} 小时前</span></div><p>{item.summary}</p><div className="evidence-time"><span>发布 {new Date(item.publishedAt).toLocaleString("zh-CN", { hour12: false })}</span><span>通过 72h 校验</span><b>查看来源 ↗</b></div></a>)}</div> : <div className="empty-evidence"><span>✓</span><div><b>暂无通过时效校验的新证据</b><p>超过 72 小时、带转载旧闻标记或重复标题的内容已剔除。</p></div></div>}
          </article>

          <div className="side-stack">
            <article id="macro" className="panel compact-panel"><div className="section-heading"><h2>可交易市场代理</h2><span>Nasdaq · 常规时段涨跌</span></div><div className="mini-grid">{overview.macro.length ? overview.macro.map((item) => <a href={item.sourceUrl} target="_blank" rel="noreferrer" key={item.key}><span>{item.name}</span><b>{price(item.value)}</b><em className={(item.changePercent ?? 0) >= 0 ? "positive" : "negative"}>{pct(item.changePercent)} · {item.key}</em></a>) : <div className="metric-unavailable">市场代理暂不可用</div>}</div></article>
            <article className="panel compact-panel health-panel"><div className="section-heading"><h2>数据源健康</h2><span>缺失时保留 24h 快照</span></div><div className="health-list"><div><span className={Object.keys(quotes).length ? "live" : "down"} /><b>自选股行情</b><em>{Object.keys(quotes).length}/{watchlist.length}</em></div><div><span className={research.health.completed ? research.health.degraded ? "partial" : "live" : "down"} /><b>财报与机构共识</b><em>{research.health.completed}/{research.health.requested || watchlist.length}</em></div>{overview.health.map((item) => <div key={item.key}><span className={item.status} /><b>{item.name}</b><em>{item.available}/{item.total}</em></div>)}</div></article>
            <article id="calendar" className="panel compact-panel"><div className="section-heading"><h2>宏观事件入口</h2><span>发布前查看预期与时间</span></div><div className="calendar-list">{OFFICIAL_CALENDARS.map((item) => <a href={item.href} target="_blank" rel="noreferrer" key={item.key}><span>{item.key}</span><b>{item.name}</b><small>{item.owner} ↗</small></a>)}</div><p className="calendar-note">数据公布时应比较实际值、市场预期和前值，避免只根据同比水平判断。</p></article>
            <article id="crypto" className="panel compact-panel"><div className="section-heading"><h2>加密市场</h2><span>CoinGecko · 24小时</span></div><div className="crypto-row">{overview.crypto.length ? overview.crypto.map((item) => <a href={item.sourceUrl} target="_blank" rel="noreferrer" key={item.key}><span>{item.key}</span><b>{price(item.value)}</b><em className={(item.changePercent ?? 0) >= 0 ? "positive" : "negative"}>{pct(item.changePercent)}</em></a>) : <div className="metric-unavailable">加密数据暂不可用</div>}</div></article>
          </div>
        </section>

        <footer><span>Atlas Markets · 仅供投资研究，不构成投资建议</span><span>来源：SEC · FRED · Nasdaq · Cboe · CoinGecko · 财报窗口 7 天</span></footer>
      </main>

      {isAddOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setIsAddOpen(false); }}><section className="search-modal" role="dialog" aria-modal="true" aria-labelledby="add-title"><header><div><span className="eyebrow">EDIT WATCHLIST</span><h2 id="add-title">添加自选股</h2></div><button className="icon-button close" aria-label="关闭" onClick={() => setIsAddOpen(false)}>×</button></header><label className="search-field"><span>⌕</span><input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入 ticker 或公司名称，例如 AMD" /></label><div className="search-status">{isSearching ? "正在搜索…" : `${results.length} 个匹配结果`}</div><div className="search-results">{results.map((item) => { const added = watchlist.includes(item.symbol); return <button key={item.symbol} disabled={added} onClick={() => addTicker(item.symbol)}><span className="result-logo">{item.symbol.slice(0, 2)}</span><span><b>{item.symbol}</b><small>{item.name} · {item.exchange}</small></span><em>{added ? "已添加" : "+ 添加"}</em></button>; })}{!isSearching && !results.length && <div className="no-results">没有找到匹配的美股 ticker</div>}</div><p className="modal-note">最多可添加 30 只股票；添加后会自动刷新。</p></section></div>}
    </div>
  );
}
