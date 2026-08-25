import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Atlas Markets dashboard shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Atlas Markets · 科技投资晨报<\/title>/i);
  assert.match(html, /美股科技投资晨报/);
  assert.match(html, /自选股行情/);
  assert.match(html, /价格波动证据/);
  assert.match(html, /刷新数据/);
  assert.match(html, /添加自选股/);
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Building your site/i);
});

test("keeps watchlist persistence and live-data routes in the source", async () => {
  const [dashboard, market, search, evidence, overview, readme] = await Promise.all([
    readFile(new URL("../app/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/market/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/search/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/evidence/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/overview/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /atlas-watchlist-v1/);
  assert.match(dashboard, /window\.localStorage\.setItem/);
  assert.match(dashboard, /slice\(0, 30\)/);
  assert.match(dashboard, /\/api\/market/);
  assert.match(dashboard, /\/api\/evidence/);
  assert.match(dashboard, /\/api\/overview/);
  assert.match(market, /api\.nasdaq\.com/);
  assert.match(search, /autocomplete\/slookup/);
  assert.match(evidence, /MAX_AGE_MS = 72/);
  assert.match(overview, /api\.coingecko\.com/);
  assert.match(readme, /## 本地运行/);
  assert.match(readme, /## Fork 后创建自己的版本/);
  assert.match(readme, /## 开源许可证/);
});
