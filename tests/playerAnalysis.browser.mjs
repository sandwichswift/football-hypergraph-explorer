import test, { before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Optional browser test dependency; the production module has no npm dependency.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  throw new Error("Browser tests need Playwright. Install it locally, or set PLAYWRIGHT_MODULE to its index.mjs path. See docs/PLAYER_C.md.");
});
const repo = fileURLToPath(new URL("../", import.meta.url));
const screenshots = resolve(repo, "docs/screenshots");
let server, browser, page, baseUrl, errors;
const metric = key => page.locator(`[data-metric="${key}"] .pa-metric-value`);
const fullMetric = key => page.locator(`[data-metric="${key}"] .pa-metric-full`);
async function capture(name) {
  const viewport = page.viewportSize();
  const height = await page.evaluate(() => document.body.scrollHeight);
  // Paint the entire capture within the viewport, avoiding stale compositor tiles.
  await page.setViewportSize({ width: viewport.width, height: height + 64 });
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  await page.screenshot({ path: resolve(screenshots, name), animations: "disabled", clip: { x: 0, y: 0, width: viewport.width, height } });
  await page.setViewportSize(viewport);
}

before(async () => {
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const path = resolve(repo, `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`);
      if (!path.startsWith(`${repo.replace(/\/$/, "")}${sep}`)) { response.writeHead(403).end(); return; }
      const content = await readFile(path);
      const type = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".md": "text/plain" }[extname(path)] || "application/octet-stream";
      response.writeHead(200, { "Content-Type": `${type}; charset=utf-8` }).end(content);
    } catch { response.writeHead(404).end("Not found"); }
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const options = { headless: true, args: ["--disable-gpu"] };
  if (process.env.PLAYWRIGHT_BROWSER_CHANNEL) options.channel = process.env.PLAYWRIGHT_BROWSER_CHANNEL;
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) options.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  browser = await chromium.launch(options);
  await mkdir(screenshots, { recursive: true });
});
after(async () => { await browser?.close(); if (server) await new Promise(done => server.close(done)); });
beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(8000);
  errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`${baseUrl}/demos/player-c/`);
  await page.locator(".pa-name").waitFor();
  await page.waitForFunction(() => [...document.styleSheets].some(sheet => sheet.href?.endsWith("playerAnalysis.css")));
});
afterEach(async () => { await page?.close(); assert.deepEqual(errors, [], "browser console must remain error-free"); });

test("desktop preview is clearly synthetic and renders consistent metrics and the bar chart", async () => {
  assert.match(await page.locator(".lab-data-notice").textContent(), /模拟数据/);
  assert.equal(await page.locator(".pa-name").textContent(), "Lionel Messi");
  assert.equal(await metric("passes").textContent(), "7");
  assert.equal(await metric("pass_accuracy").textContent(), "85.7%");
  assert.equal(await metric("xg").textContent(), "0.50");
  assert.match(await page.locator(".pa-edge-total").textContent(), /5 个/);
  assert.equal(await page.locator(".pa-bar").count(), 3);
  assert.equal(await page.locator(".pa-combination").count(), 3);
  assert.match(await page.locator(".pa-partner").first().textContent(), /Álvarez.*5 次/);
  await capture("player-c-demo-desktop.png");
});

test("search supports accent-insensitive names, Chinese aliases and keyboard selection", async () => {
  const search = page.getByLabel("搜索球员", { exact: true });
  await search.fill("mbappe");
  assert.equal(await page.locator(".pa-result").count(), 1);
  await search.press("Enter");
  assert.equal(await page.locator(".pa-name").textContent(), "Kylian Mbappé");
  assert.equal(await page.evaluate(() => window.playerCDemo.store.getState().selectedPlayerId), "demo-mbappe");
  await search.fill("梅西");
  await page.locator(".pa-result").click();
  assert.equal(await page.locator(".pa-name").textContent(), "Lionel Messi");
  await search.fill("di maria");
  assert.equal(await page.locator(".pa-result").count(), 1);
  await search.fill("nobody matches");
  assert.match(await page.locator(".pa-search-empty").textContent(), /没有匹配/);
});

test("time filtering changes visible event metrics but preserves the labeled full-match comparison", async () => {
  await page.getByRole("button", { name: "上半场", exact: true }).click();
  assert.equal(await metric("passes").textContent(), "3");
  assert.equal(await metric("xg").textContent(), "0.30");
  assert.match(await fullMetric("passes").textContent(), /全场 7/);
  assert.match(await page.locator(".pa-range").textContent(), /0′–45′/);
  assert.match(await page.locator(".pa-edge-total").textContent(), /3 个/);
  await page.locator("#demo-start").fill("90");
  assert.deepEqual(await page.evaluate(() => window.playerCDemo.store.getState().timeRange), [90, 90]);
});

test("competition uses the current player selection, marks opponents and handles team filters", async () => {
  await page.locator("#demo-mode").selectOption("competition");
  assert.match(await page.locator(".pa-network-title").textContent(), /跨队对抗/);
  assert.match(await page.locator(".pa-edge-total").textContent(), /2 个/);
  assert.match(await page.locator(".pa-partners").textContent(), /队友/);
  assert.match(await page.locator(".pa-partners").textContent(), /对手/);
  await page.locator("#demo-team").selectOption("demo-fra");
  assert.match(await page.locator(".pa-edge-total").textContent(), /2 个/);
  assert.equal(await page.locator(".pa-team-notice").isVisible(), true);
  await page.locator("#demo-team").selectOption("");
  await capture("player-c-demo-competition.png");
});

test("empty, no-pass, missing-data and unselected scenarios render without misleading numbers", async () => {
  await page.locator("#demo-case").selectOption("no-edges");
  assert.equal(await page.locator(".pa-network-empty").isVisible(), true);
  assert.equal(await metric("shots").textContent(), "1");
  await page.locator("#demo-case").selectOption("no-passes");
  assert.equal(await metric("passes").textContent(), "0");
  assert.equal(await metric("pass_accuracy").textContent(), "N/A");
  await page.locator("#demo-case").selectOption("missing");
  assert.equal(await metric("xg").textContent(), "N/A");
  assert.equal(await metric("goals").textContent(), "N/A");
  assert.equal(await metric("assists").textContent(), "N/A");
  await page.locator("#demo-case").selectOption("unselected");
  assert.equal(await page.locator(".pa-start").isVisible(), true);
  assert.equal(await page.locator(".pa-content").isVisible(), false);
});

test("combination selection emits an optional public request and displays traceable event IDs", async () => {
  await page.evaluate(() => {
    window.capturedRequests = [];
    document.getElementById("player-panel").addEventListener("playeranalysis:select-edges", event => window.capturedRequests.push(event.detail));
  });
  await page.locator(".pa-combination").first().click();
  const request = await page.evaluate(() => window.capturedRequests.at(-1));
  assert.deepEqual(request.edgeIds, ["demo-c1", "demo-c2", "demo-c4"]);
  assert.equal(request.playerId, "demo-messi");
  assert.equal(await page.locator(".pa-evidence-list > li").count(), 3);
  await page.locator(".pa-evidence-list summary").first().click();
  assert.match(await page.locator(".pa-event-id").first().textContent(), /demo-c1-ev1/);
  await page.getByRole("button", { name: "上半场", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.capturedRequests.at(-1).edgeIds), []);
  assert.equal(await page.locator(".pa-evidence").isVisible(), false);
  await page.locator(".pa-combination").first().click();
  await page.evaluate(() => window.playerCDemo.mounted.updateDataset(structuredClone(window.playerCDemo.dataset)));
  assert.deepEqual(await page.evaluate(() => window.capturedRequests.at(-1).edgeIds), []);
});

test("lifecycle supports missing data, updates, multiple instances and idempotent cleanup", async () => {
  const result = await page.evaluate(() => {
    const { mountPlayerAnalysis, dataset } = window.playerCDemo;
    const fixture = structuredClone(dataset);
    const listeners = new Set();
    const localStore = {
      getState: () => ({ selectedPlayerId: "demo-messi", timeRange: [0, 125], mode: "collaboration" }),
      setState() {}, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    };
    const host = document.createElement("div");
    const sentinel = document.createElement("p");
    sentinel.textContent = "unrelated content";
    host.append(sentinel);
    document.body.append(host);
    const first = mountPlayerAnalysis(host, localStore, fixture);
    const second = mountPlayerAnalysis(host, localStore, fixture);
    const ids = [...host.querySelectorAll("input")].map(input => input.id);
    const initialListeners = listeners.size;
    first.updateDataset({ players: fixture.players });
    const unavailable = host.querySelector("[data-metric=passes] .pa-metric-value").textContent;
    first.destroy(); first.destroy(); second.destroy();
    const result = { uniqueIds: new Set(ids).size === ids.length, initialListeners, finalListeners: listeners.size, panels: host.querySelectorAll(".pa-panel").length, links: host.querySelectorAll("link").length, sentinel: sentinel.isConnected, unavailable };
    host.remove();
    return result;
  });
  assert.deepEqual(result, { uniqueIds: true, initialListeners: 2, finalListeners: 0, panels: 0, links: 0, sentinel: true, unavailable: "N/A" });
});

test("player names are text, never executable markup", async () => {
  await page.evaluate(() => {
    const fixture = structuredClone(window.playerCDemo.dataset);
    fixture.players[0].player_name = '<img src=x onerror="window.unsafeName=true">';
    window.playerCDemo.mounted.updateDataset(fixture);
  });
  assert.match(await page.locator(".pa-name").textContent(), /<img/);
  assert.equal(await page.locator("#player-panel img").count(), 0);
  assert.equal(await page.evaluate(() => Boolean(window.unsafeName)), false);
});

test("rapid state changes do not duplicate panels or corrupt the final view", async () => {
  await page.evaluate(() => {
    for (let i = 0; i < 100; i++) window.playerCDemo.store.setState({ mode: i % 2 ? "competition" : "collaboration", timeRange: [0, i % 2 ? 90 : 125] });
    window.playerCDemo.store.setState({ selectedPlayerId: "demo-mbappe", mode: "collaboration", timeRange: [0, 125] });
  });
  assert.equal(await page.locator(".pa-panel").count(), 1);
  assert.equal(await page.locator(".pa-name").textContent(), "Kylian Mbappé");
  assert.equal(await metric("shots").textContent(), "2");
});

test("player comparison stays local, updates with time and can swap the focused player", async () => {
  await page.getByRole("tab", { name: "球员对比", exact: true }).click();
  await page.getByLabel("选择对比球员", { exact: true }).selectOption("demo-mbappe");
  const passes = page.locator('[data-compare-metric="passes"]');
  assert.equal(await passes.locator(".pa-compare-value-primary").textContent(), "7");
  assert.equal(await passes.locator(".pa-compare-value-secondary").textContent(), "3");
  assert.match(await passes.locator(".pa-compare-difference").textContent(), /\+4次/);
  assert.match(await page.locator('[data-compare-metric="pass_accuracy"] .pa-compare-difference').textContent(), /-14.3 个百分点/);
  assert.equal(await page.evaluate(() => window.playerCDemo.store.getState().selectedPlayerId), "demo-messi");
  assert.equal(await page.evaluate(() => "comparisonPlayerId" in window.playerCDemo.store.getState()), false);
  await capture("player-c-demo-comparison.png");
  await page.getByRole("button", { name: "上半场", exact: true }).click();
  assert.equal(await passes.locator(".pa-compare-value-primary").textContent(), "3");
  assert.equal(await passes.locator(".pa-compare-value-secondary").textContent(), "1");
  await page.getByRole("button", { name: "交换主副球员", exact: true }).click();
  assert.equal(await page.locator(".pa-name").textContent(), "Kylian Mbappé");
  assert.equal(await page.locator(".pa-compare-select").inputValue(), "demo-messi");
});

test("shot map and accessible list share selection, source evidence and missing-position states", async () => {
  await page.getByRole("tab", { name: "射门分析", exact: true }).click();
  assert.equal(await page.locator(".pa-shot-mark").count(), 3);
  assert.equal(await page.locator(".pa-shot-item").count(), 3);
  await page.locator(".pa-shot-item").nth(1).click();
  assert.match(await page.locator(".pa-shot-detail").textContent(), /demo-shot2/);
  assert.equal(await page.locator(".pa-shot-halo").count(), 1);
  await capture("player-c-demo-shots.png");
  await page.locator(".pa-shot-mark").first().click();
  assert.match(await page.locator(".pa-shot-detail").textContent(), /demo-shot1/);
  await page.getByRole("button", { name: "上半场", exact: true }).click();
  assert.equal(await page.locator(".pa-shot-item").count(), 1);
  await page.locator("#demo-case").selectOption("missing");
  assert.equal(await page.locator(".pa-shot-mark").count(), 0);
  assert.equal(await page.locator(".pa-shot-item").count(), 1);
  assert.match(await page.locator(".pa-shot-item").textContent(), /xG N\/A/);
  assert.match(await page.locator(".pa-shot-coordinate-note").textContent(), /缺失或无效位置/);
});

test("membership matrix selects the same full combination and reveals readable event sequences", async () => {
  await page.getByRole("button", { name: "矩阵", exact: true }).click();
  assert.equal(await page.locator(".pa-combo-matrix").isVisible(), true);
  assert.equal(await page.locator(".pa-combinations").isVisible(), false);
  assert.equal(await page.locator(".pa-matrix tbody tr").count(), 4);
  assert.equal(await page.locator(".pa-matrix-focus .pa-member-present").count(), 3);
  await page.locator(".pa-matrix-choice").first().click();
  assert.equal(await page.locator(".pa-evidence-list > li").count(), 3);
  await page.locator(".pa-evidence-list summary").first().click();
  assert.match(await page.locator(".pa-event-description").first().textContent(), /Lionel Messi → Ángel Di María · 传球 · 成功/);
  await capture("player-c-demo-matrix.png");
  await page.getByRole("button", { name: "列表", exact: true }).click();
  assert.equal(await page.locator(".pa-combination").first().getAttribute("aria-pressed"), "true");
});

test("partner drill-down changes the public player selection", async () => {
  await page.locator(".pa-partner-drill").first().click();
  assert.equal(await page.locator(".pa-name").textContent(), "Julián Álvarez");
  assert.equal(await page.evaluate(() => window.playerCDemo.store.getState().selectedPlayerId), "demo-alvarez");
  assert.equal(await metric("goals").textContent(), "1");
});

test("analysis tabs work with arrow keys and missing comparison metrics remain N/A", async () => {
  await page.getByRole("tab", { name: "多人关系", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.getByRole("tab", { name: "射门分析", exact: true }).getAttribute("aria-selected"), "true");
  await page.keyboard.press("End");
  assert.equal(await page.getByRole("tab", { name: "球员对比", exact: true }).getAttribute("aria-selected"), "true");
  await page.getByLabel("选择对比球员", { exact: true }).selectOption("demo-griezmann");
  assert.equal(await page.locator('[data-compare-metric="xg"] .pa-compare-value-secondary').textContent(), "N/A");
  assert.match(await page.locator('[data-compare-metric="xg"] .pa-compare-difference').textContent(), /N\/A/);
  await page.evaluate(() => {
    const dataset = structuredClone(window.playerCDemo.dataset);
    dataset.players = dataset.players.filter(player => player.player_id !== "demo-griezmann");
    window.playerCDemo.mounted.updateDataset(dataset);
  });
  assert.equal(await page.locator(".pa-compare-select").inputValue(), "");
  assert.equal(await page.locator(".pa-compare-empty").isVisible(), true);
});

test("mobile and intermediate widths fit without horizontal overflow", async () => {
  for (const width of [320, 360, 768]) {
    await page.setViewportSize({ width, height: 850 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    const size = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
    assert.ok(size.content <= size.viewport, `${width}px: content overflowed to ${size.content}px`);
    assert.equal(await page.locator(".pa-name").isVisible(), true);
    assert.equal(await metric("passes").textContent(), "7");
    if (width === 360) await capture("player-c-demo-mobile.png");
    for (const tab of ["射门分析", "球员对比"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      if (tab === "球员对比") await page.locator(".pa-compare-select").selectOption("demo-mbappe");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${tab} overflowed at ${width}px`);
    }
    await page.getByRole("tab", { name: "多人关系", exact: true }).click();
    await page.getByRole("button", { name: "矩阵", exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `matrix overflowed at ${width}px`);
    await page.getByRole("button", { name: "列表", exact: true }).click();
  }
});
