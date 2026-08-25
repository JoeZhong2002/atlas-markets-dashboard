"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Quote = {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  postMarketChangePercent: number | null;
  volumeRatio: number | null;
  sectorChangePercent: number | null;
  currency: string;
  marketState: string;
  sourceUrl: string;
};

type SearchResult = { symbol: string; name: string; exchange: string; type: string };

type Evidence = {
  id: string;
  ticker: string;
  summary: string;
  source: string;
  sourceUrl: string;
  publishedAt: string;
  firstSeenAt: string;
  isPrimary: boolean;
};

const DEFAULT_WATCHLIST = ["NVDA", "TSM", "MSFT", "META", "AMZN", "AAPL"];
const STORAGE_KEY = "atlas-watchlist-v1";
const MAX_AGE_HOURS = 72;

const fallbackQuotes: Record<string, Quote> = {
  NVDA: { symbol: "NVDA", name: "NVIDIA", price: 192.48, changePercent: 3.24, postMarketChangePercent: 0.18, volumeRatio: 1.42, sectorChangePercent: 1.38, currency: "USD", marketState: "CLOSED", sourceUrl: "https://finance.yahoo.com/quote/NVDA" },
  TSM: { symbol: "TSM", name: "Taiwan Semiconductor", price: 251.16, changePercent: 2.17, postMarketChangePercent: -0.08, volumeRatio: 1.18, sectorChangePercent: 0.31, currency: "USD", marketState: "CLOSED", sourceUrl: "https://finance.yahoo.com/quote/TSM" },
  MSFT: { symbol: "MSFT", name: "Microsoft", price: 523.74, changePercent: 1.08, postMarketChangePercent: 0.05, volumeRatio: 0.86, sectorChangePercent: 0.44, currency: "USD", marketState: "CLOSED", sourceUrl: "https://finance.yahoo.com/quote/MSFT" },
  META: { symbol: "META", name: "Meta Platforms", price: 781.22, changePercent: 0.72, postMarketChangePercent: -0.11, volumeRatio: 0.91, sectorChangePercent: 0.26, currency: "USD", marketState: "CLOSED", sourceUrl: "https://finance.yahoo.com/quote/META" },
  AMZN: { symbol: "AMZN", name: "Amazon", price: 229.41, changePercent: -0.36, postMarketChangePercent: 0.07, volumeRatio: 0.78, sectorChangePercent: -0.51, currency: "USD", marketState: "CLOSED", sourceUrl: "https://finance.yahoo.com/quote/AMZN" },
  AAPL: { symbol: "AAPL", name: "Apple", price: 227.18, changePercent: -0.83, postMarketChangePercent: -0.06, volumeRatio: 1.07, sectorChangePercent: -1.21, currency: "USD", marketState: "CLOSED", sourceUrl: "https://finance.yahoo.com/quote/AAPL" },
};

const fallbackSearch: SearchResult[] = [
  { symbol: "AMD", name: "Advanced Micro Devices", exchange: "NASDAQ", type: "Equity" },
  { symbol: "AVGO", name: "Broadcom", exchange: "NASDAQ", type: "Equity" },
  { symbol: "GOOGL", name: "Alphabet Class A", exchange: "NASDAQ", type: "Equity" },
  { symbol: "PLTR", name: "Palantir Technologies", exchange: "NASDAQ", type: "Equity" },
  { symbol: "CRM", name: "Salesforce", exchange: "NYSE", type: "Equity" },
  { symbol: "SNOW", name: "Snowflake", exchange: "NYSE", type: "Equity" },
];

const evidenceFallback: Evidence[] = [];

const indices = [
  { name: "NASDAQ 100", value: "24,318", delta: 1.12 },
  { name: "S&P 500", value: "6,512", delta: 0.64 },
  { name: "SOX 半导体", value: "6,148", delta: 1.86 },
  { name: "美国 10Y", value: "3.91%", delta: -0.05, unit: "bp" },
  { name: "VIX", value: "14.82", delta: -6.4 },
  { name: "BTC", value: "$114,280", delta: 2.31 },
];

const events = [
  { time: "20:30", title: "美国耐用品订单", detail: "宏观数据 · 高影响" },
  { time: "22:00", title: "消费者信心指数", detail: "增长预期 · 高影响" },
  { time: "盘后", title: "云软件财报窗口", detail: "需求与 AI 变现" },
];

function pct(value: number | null) {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function ageHours(iso: string) {
  return Math.max(0, (Date.now() - new Date(iso).getTime()) / 3_600_000);
}

function nextNineAm() {
  const next = new Date();
  next.setHours(9, 0, 0, 0);
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
  return next;
}

export function Dashboard() {
  const [watchlist, setWatchlist] = useState(DEFAULT_WATCHLIST);
  const [quotes, setQuotes] = useState<Record<string, Quote>>(fallbackQuotes);
  const [evidence, setEvidence] = useState<Evidence[]>(evidenceFallback);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>(fallbackSearch);
  const [isSearching, setIsSearching] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [dataMode, setDataMode] = useState<"live" | "fallback">("fallback");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as string[];
      if (Array.isArray(parsed) && parsed.length) setWatchlist(parsed.slice(0, 30));
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(watchlist));
  }, [watchlist]);

  const refresh = useCallback(async () => {
    try {
      const [marketResponse, evidenceResponse] = await Promise.all([
        fetch(`/api/market?symbols=${encodeURIComponent(watchlist.join(","))}`, { cache: "no-store" }),
        fetch(`/api/evidence?symbols=${encodeURIComponent(watchlist.join(","))}`, { cache: "no-store" }),
      ]);
      if (!marketResponse.ok) throw new Error("market data unavailable");
      const marketData = (await marketResponse.json()) as { quotes: Quote[]; updatedAt: string; live: boolean };
      const nextQuotes = { ...quotes };
      marketData.quotes.forEach((quote) => { nextQuotes[quote.symbol] = quote; });
      setQuotes(nextQuotes);
      setLastUpdated(new Date(marketData.updatedAt));
      setDataMode(marketData.live ? "live" : "fallback");
      if (evidenceResponse.ok) {
        const evidenceData = (await evidenceResponse.json()) as { items: Evidence[] };
        setEvidence(evidenceData.items);
      }
    } catch {
      setLastUpdated(new Date());
      setDataMode("fallback");
    }
  }, [watchlist]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const wait = nextNineAm().getTime() - Date.now();
    const timer = window.setTimeout(() => void refresh(), wait);
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
        const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal });
        const data = (await response.json()) as { results: SearchResult[] };
        setResults(data.results);
      } catch {
        if (!controller.signal.aborted) {
          const q = trimmed.toLowerCase();
          setResults(fallbackSearch.filter((item) => item.symbol.toLowerCase().includes(q) || item.name.toLowerCase().includes(q)));
        }
      } finally {
        setIsSearching(false);
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, isAddOpen]);

  const displayedQuotes = useMemo(
    () => watchlist.map((symbol) => quotes[symbol] ?? {
      symbol,
      name: symbol,
      price: 0,
      changePercent: 0,
      postMarketChangePercent: null,
      volumeRatio: null,
      sectorChangePercent: null,
      currency: "USD",
      marketState: "LOADING",
      sourceUrl: `https://finance.yahoo.com/quote/${symbol}`,
    }),
    [watchlist, quotes],
  );

  const freshEvidence = useMemo(
    () => evidence
      .filter((item) => ageHours(item.publishedAt) <= MAX_AGE_HOURS)
      .sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt)),
    [evidence],
  );

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
        <a className="brand" href="#top" aria-label="Atlas Markets 首页">
          <span className="brand-mark">A</span>
          <span><b>Atlas Markets</b><small>科技投资晨报</small></span>
        </a>
        <nav className="main-nav" aria-label="主要导航">
          <a className="active" href="#top">晨间总览</a>
          <a href="#watchlist">自选股</a>
          <a href="#evidence">证据动态</a>
          <a href="#macro">宏观市场</a>
          <a href="#crypto">加密市场</a>
        </nav>
        <div className="update-state"><span className={`pulse ${dataMode}`} />{dataMode === "live" ? "实时数据" : "数据源连接中"}</div>
      </header>

      <main id="top" className="dashboard">
        <section className="hero-row">
          <div>
            <span className="eyebrow">MORNING BRIEF · ASIA/SHANGHAI</span>
            <h1>美股科技投资晨报</h1>
            <p>{lastUpdated ? `更新于 ${lastUpdated.toLocaleString("zh-CN", { hour12: false })}` : "正在连接市场数据"} · 下一次定时刷新 09:00</p>
          </div>
          <div className="hero-actions">
            <button className="button secondary" onClick={() => void refresh()}>刷新数据</button>
            <button className="button primary" onClick={() => setIsAddOpen(true)}>＋ 添加自选股</button>
          </div>
        </section>

        <section className="market-strip" aria-label="市场快照">
          {indices.map((item) => (
            <div className="market-stat" key={item.name}>
              <span>{item.name}</span>
              <strong>{item.value}</strong>
              <em className={item.delta >= 0 ? "positive" : "negative"}>{item.delta >= 0 ? "+" : ""}{item.unit === "bp" ? `${Math.round(item.delta * 100)}bp` : `${item.delta.toFixed(2)}%`}</em>
            </div>
          ))}
        </section>

        <section className="lead-grid">
          <article className="brief-card">
            <div className="risk-block"><span>风险偏好</span><strong>68</strong><small>Risk-on · 较昨日 +9</small></div>
            <div className="brief-copy">
              <div className="card-title-row"><span className="eyebrow">市场脉搏</span><span className="status-chip">不做自动归因</span></div>
              <h2>利率回落，成长股与半导体板块表现相对占优</h2>
              <p>这里只陈述可观察到的跨资产变化。具体个股波动原因不由模型主动总结，请在下方“证据动态”中查看带时间戳的原始来源。</p>
              <div className="metric-chips"><span>10Y收益率 -5bp</span><span>SOX +1.86%</span><span>上涨家数 58%</span><span>美元指数 -0.3%</span></div>
            </div>
          </article>
          <aside className="events-card">
            <div className="section-heading"><h2>今日关键事件</h2><span>北京时间</span></div>
            <div className="event-list">
              {events.map((event) => <div className="event" key={`${event.time}-${event.title}`}><time>{event.time}</time><span><b>{event.title}</b><small>{event.detail}</small></span><i /></div>)}
            </div>
          </aside>
        </section>

        <section id="watchlist" className="panel watchlist-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">WATCHLIST</span><h2>自选股行情</h2><p>{watchlist.length} 只股票 · 列表保存在当前设备</p></div>
            <button className="button secondary" onClick={() => setIsAddOpen(true)}>搜索 ticker 添加</button>
          </div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>股票</th><th>最新价</th><th>当日</th><th>盘后</th><th>量比 / 20日</th><th>相对行业</th><th>行情来源</th><th><span className="sr-only">操作</span></th></tr></thead>
              <tbody>
                {displayedQuotes.map((quote) => (
                  <tr key={quote.symbol}>
                    <td><div className="ticker-cell"><span>{quote.symbol.slice(0, 2)}</span><div><b>{quote.symbol}</b><small>{quote.name}</small></div></div></td>
                    <td>{quote.price ? new Intl.NumberFormat("en-US", { style: "currency", currency: quote.currency || "USD" }).format(quote.price) : "载入中"}</td>
                    <td className={quote.changePercent >= 0 ? "positive" : "negative"}>{pct(quote.changePercent)}</td>
                    <td className={(quote.postMarketChangePercent ?? 0) >= 0 ? "positive" : "negative"}>{pct(quote.postMarketChangePercent)}</td>
                    <td>{quote.volumeRatio ? `${quote.volumeRatio.toFixed(2)}×` : "—"}</td>
                    <td className={(quote.sectorChangePercent ?? 0) >= 0 ? "positive" : "negative"}>{pct(quote.sectorChangePercent)}</td>
                    <td><a className="source-link" href={quote.sourceUrl} target="_blank" rel="noreferrer">Yahoo Finance ↗</a></td>
                    <td><button className="icon-button" aria-label={`删除 ${quote.symbol}`} onClick={() => removeTicker(quote.symbol)}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="evidence" className="content-grid">
          <article className="panel evidence-panel">
            <div className="panel-heading evidence-heading">
              <div><span className="eyebrow">PRICE MOVEMENT EVIDENCE</span><h2>价格波动证据</h2><p>仅显示过去 72 小时的原始报道或一手材料，不生成因果结论。</p></div>
              <span className="freshness-badge">72h 鲜度门槛</span>
            </div>
            {freshEvidence.length ? (
              <div className="evidence-list">
                {freshEvidence.map((item) => (
                  <a className="evidence-item" href={item.sourceUrl} target="_blank" rel="noreferrer" key={item.id}>
                    <div className="evidence-meta"><span className="ticker-tag">{item.ticker}</span><span>{item.source}</span><span>{item.isPrimary ? "一手来源" : "原始报道"}</span><span>{Math.floor(ageHours(item.publishedAt))} 小时前</span></div>
                    <p>{item.summary}</p>
                    <div className="evidence-time"><span>发布 {new Date(item.publishedAt).toLocaleString("zh-CN", { hour12: false })}</span><span>首次发现 {new Date(item.firstSeenAt).toLocaleString("zh-CN", { hour12: false })}</span><b>查看来源 ↗</b></div>
                  </a>
                ))}
              </div>
            ) : (
              <div className="empty-evidence"><span>✓</span><div><b>暂无通过时效与来源校验的新证据</b><p>超过 72 小时、转载旧闻或无法识别原始来源的内容已自动剔除。</p></div></div>
            )}
          </article>

          <div className="side-stack">
            <article id="macro" className="panel compact-panel">
              <div className="section-heading"><h2>宏观压力表</h2><span>较前一交易日</span></div>
              <div className="mini-grid"><div><span>实际利率</span><b>1.67%</b><em className="negative">-4bp</em></div><div><span>美元指数</span><b>97.81</b><em className="negative">-0.3%</em></div><div><span>高收益债利差</span><b>287bp</b><em>稳定</em></div><div><span>流动性环境</span><b className="positive">边际改善</b></div></div>
            </article>
            <article id="crypto" className="panel compact-panel">
              <div className="section-heading"><h2>加密市场</h2><span>24小时</span></div>
              <div className="crypto-row"><div><span>BTC</span><b>$114,280</b><em className="positive">+2.31%</em></div><div><span>ETH</span><b>$4,636</b><em className="positive">+1.44%</em></div><div><span>总清算</span><b>$184M</b><em>中性</em></div></div>
            </article>
          </div>
        </section>

        <footer><span>Atlas Markets · 仅供投资研究，不构成投资建议</span><span>信息规则：原始发布时间 ≤ 72h · 去除转载旧闻 · 来源可追溯</span></footer>
      </main>

      {isAddOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setIsAddOpen(false); }}>
          <section className="search-modal" role="dialog" aria-modal="true" aria-labelledby="add-title">
            <header><div><span className="eyebrow">EDIT WATCHLIST</span><h2 id="add-title">添加自选股</h2></div><button className="icon-button close" aria-label="关闭" onClick={() => setIsAddOpen(false)}>×</button></header>
            <label className="search-field"><span>⌕</span><input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入 ticker 或公司名称，例如 AMD" /></label>
            <div className="search-status">{isSearching ? "正在搜索…" : `${results.length} 个匹配结果`}</div>
            <div className="search-results">
              {results.map((item) => {
                const added = watchlist.includes(item.symbol);
                return <button key={item.symbol} disabled={added} onClick={() => addTicker(item.symbol)}><span className="result-logo">{item.symbol.slice(0, 2)}</span><span><b>{item.symbol}</b><small>{item.name} · {item.exchange}</small></span><em>{added ? "已添加" : "+ 添加"}</em></button>;
              })}
              {!isSearching && !results.length && <div className="no-results">没有找到匹配的美股 ticker</div>}
            </div>
            <p className="modal-note">最多可添加 30 只股票；行情会在添加后自动刷新。</p>
          </section>
        </div>
      )}
    </div>
  );
}
