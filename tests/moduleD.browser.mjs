/** Real browser tests. A/B and JSON routes are explicit test doubles only. */
import test, { before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname, sep, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fixtureDataset } from "./fixtures/moduleD.js";
import { DATA_FILES } from "../src/js/main.js";

const modulePath = process.env.PLAYWRIGHT_MODULE || "playwright";
const { chromium } = await import(isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath);
const root = fileURLToPath(new URL("../", import.meta.url));
let server, browser, page, base, pageErrors;
const bStub = `// TEST DOUBLE ONLY: no hypergraph geometry is implemented here.
export function mountHypergraph(container, store, dataset) {
  window.mockB = { mounts: 1, renders: 0, destroyed: false };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '100%'); svg.setAttribute('height', '80');
  const label = document.createElementNS(svg.namespaceURI, 'text'); label.setAttribute('y', '30');
  label.textContent = 'B TEST STUB · contract only'; svg.append(label); container.append(svg);
  const render = () => {
    const state = store.getState(), source = state.mode === 'competition' ? dataset.competitionEdges : dataset.collaborationEdges;
    svg.dataset.edges = String(source.filter(edge => edge.end_minute >= state.timeRange[0] && edge.start_minute <= state.timeRange[1] && (!state.selectedTeamId || edge.team_ids.includes(state.selectedTeamId))).length);
    svg.dataset.mode = state.mode; window.mockB.renders++;
  };
  const off = store.subscribe(render); render();
  return { destroy() { off(); svg.remove(); window.mockB.destroyed = true; } };
}`;
const aStub = `export function mountDataExplorer(container) {
  container.textContent = 'A TEST STUB · MOCK data only'; return { destroy() { container.replaceChildren(); } };
}`;
async function routeFixture({ emptyCompetition = false, missingB = false, malformed = false } = {}) {
  const dataset = structuredClone(fixtureDataset);
  if (emptyCompetition) dataset.competitionEdges = [];
  if (malformed) dataset.competitionEdges[0].event_ids = ["missing-event"];
  await page.route("**/data/processed/*.json", route => {
    const name = new URL(route.request().url()).pathname.split("/").at(-1);
    const key = Object.keys(DATA_FILES).find(key => DATA_FILES[key] === name);
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(dataset[key]) });
  });
  await page.route("**/src/js/dataExplorer.js", route => route.fulfill({ contentType: "application/javascript", body: aStub }));
  await page.route("**/src/js/hypergraph.js", route => route.fulfill(missingB
    ? { status: 404, body: "B not delivered" } : { contentType: "application/javascript", body: bStub }));
  await page.goto(`${base}/src/`);
  await page.waitForFunction(() => !document.querySelector("#app-status").textContent.includes("正在"));
}
async function state() { return page.evaluate(async () => (await import("/src/js/state.js")).getState()); }
async function capture(name) {
  await mkdir(resolve(root, "docs/screenshots"), { recursive: true });
  await page.screenshot({ path: resolve(root, "docs/screenshots", name), fullPage: true, animations: "disabled" });
}

before(async () => {
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const target = resolve(root, `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`);
      if (!target.startsWith(`${root.replace(/[\\/]$/, "")}${sep}`)) { response.writeHead(403).end(); return; }
      const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json" }[extname(target)] || "application/octet-stream";
      const body = await readFile(target);
      response.writeHead(200, { "Content-Type": `${mime}; charset=utf-8` }).end(body);
    } catch { response.writeHead(404).end("Not found"); }
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${server.address().port}`;
  const options = { headless: true };
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) options.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  else options.channel = process.env.PLAYWRIGHT_BROWSER_CHANNEL || "chrome";
  browser = await chromium.launch(options);
});
after(async () => { await browser?.close(); if (server) await new Promise(done => server.close(done)); });
beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  pageErrors = []; page.on("pageerror", error => pageErrors.push(error.message));
});
afterEach(async () => { await page?.close(); assert.deepEqual(pageErrors, []); });

test("actual repository shows actionable missing-data state without mock substitution", async () => {
  await page.goto(`${base}/src/`);
  await page.getByText("未能启动真实比赛视图。", { exact: true }).waitFor();
  assert.match(await page.locator("#app-errors").textContent(), /players.json/);
  assert.equal(await page.locator(".ct-panel").count(), 0);
  await capture("module-d-missing-data.png");
});

test("D controls mount once with existing C; mock provenance remains visible", async () => {
  await routeFixture();
  await page.locator(".ct-panel").waitFor();
  assert.match(await page.locator("#match-label").textContent(), /MOCK-INTEGRATION-ONLY/);
  assert.equal(await page.locator(".ct-panel").count(), 1);
  assert.equal(await page.locator("#hypergraph svg").count(), 1);
  await page.locator('button[data-pa-player="mock-a"]').click();
  assert.equal(await page.locator('[data-metric="passes"] .pa-metric-value').textContent(), "2");
  await capture("module-d-mock-integration.png");
});

test("empty competition is accepted and explained in D, B stub and C", async () => {
  await routeFixture({ emptyCompetition: true });
  await page.locator('button[data-pa-player="mock-a"]').click();
  await page.getByRole("button", { name: "Competition · 对抗", exact: true }).click();
  assert.match(await page.locator(".ct-status").textContent(), /不会补造/);
  assert.equal(await page.locator("#hypergraph svg").getAttribute("data-edges"), "0");
  assert.equal(await page.locator(".pa-network-empty").isVisible(), true);
  assert.equal(await page.locator("#app-errors").isVisible(), false);
});

test("inclusive endpoints, zero, last minute and fractional time update B stub and C", async () => {
  await routeFixture();
  await page.locator('button[data-pa-player="mock-a"]').click();
  await page.getByRole("button", { name: "Competition · 对抗", exact: true }).click();
  await page.getByLabel("结束分钟数值", { exact: true }).fill("1");
  assert.equal(await page.locator("#hypergraph svg").getAttribute("data-edges"), "1");
  await page.getByLabel("开始分钟数值", { exact: true }).fill("1");
  assert.deepEqual((await state()).timeRange, [1, 1]);
  assert.equal(await page.locator('[data-metric="passes"] .pa-metric-value').textContent(), "1");
  await page.getByLabel("结束分钟数值", { exact: true }).fill("0");
  assert.deepEqual((await state()).timeRange, [0, 0]);
  assert.equal(await page.locator("#hypergraph svg").getAttribute("data-edges"), "0");
  assert.equal(await page.locator('[data-metric="passes"] .pa-metric-value').textContent(), "0");
  await page.getByRole("button", { name: "查看全场", exact: true }).click();
  assert.deepEqual((await state()).timeRange, [0, 125]);
  await page.getByLabel("开始分钟数值", { exact: true }).fill("125");
  assert.deepEqual((await state()).timeRange, [125, 125]);
  assert.equal(await page.locator("#hypergraph svg").getAttribute("data-edges"), "0");
});

test("100 continuous control switches reuse one B stub SVG and retain selected player", async () => {
  await routeFixture();
  await page.locator('button[data-pa-player="mock-a"]').click();
  await page.evaluate(() => {
    for (let i = 0; i < 100; i++) document.querySelector(`[data-mode="${i % 2 ? "collaboration" : "competition"}"]`).click();
  });
  assert.equal(await page.locator("#hypergraph svg").count(), 1);
  assert.equal(await page.locator(".ct-panel").count(), 1);
  assert.equal(await page.locator(".pa-panel").count(), 1);
  assert.equal((await state()).selectedPlayerId, "mock-a");
  assert.equal((await state()).mode, "collaboration");
  assert.equal(await page.evaluate(() => window.mockB.mounts), 1);
});

test("team filter preserves cross-team edge and does not reset player", async () => {
  await routeFixture();
  await page.locator('button[data-pa-player="mock-a"]').click();
  await page.getByRole("button", { name: "Competition · 对抗", exact: true }).click();
  await page.locator(".ct-team").selectOption("mock-away");
  assert.equal(await page.locator("#hypergraph svg").getAttribute("data-edges"), "1");
  assert.equal((await state()).selectedPlayerId, "mock-a");
  assert.equal(await page.locator(".pa-team-notice").isVisible(), true);
});

test("missing B reports delivery error while C and D still work; malformed JSON is blocked", async () => {
  await routeFixture({ missingB: true });
  assert.match(await page.locator("#app-errors").textContent(), /hypergraph.js/);
  assert.equal(await page.locator(".ct-panel").count(), 1);
  assert.equal(await page.locator(".pa-panel").count(), 1);
  await page.getByRole("button", { name: "Competition · 对抗", exact: true }).click();
  assert.equal((await state()).mode, "competition");
  await page.unrouteAll();
  await routeFixture({ malformed: true });
  assert.equal(await page.locator(".ct-panel").count(), 0);
  assert.match(await page.locator("#app-errors").textContent(), /原始超边契约/);
});

test("timeline cleanup releases listeners and supports independent remount", async () => {
  await routeFixture();
  const result = await page.evaluate(async () => {
    const { mountCompetitionTimeline } = await import("/src/js/competitionTimeline.js");
    const { createStore } = await import("/src/js/state.js");
    const dataset = (await import("/tests/fixtures/moduleD.js")).fixtureDataset;
    const local = createStore({ timeRange: [0, 125] }); let subscriptions = 0;
    const wrapper = { ...local, subscribe(fn) { subscriptions++; const off = local.subscribe(fn); return () => { subscriptions--; off(); }; } };
    const host = document.createElement("div"); const sentinel = document.createElement("p"); host.append(sentinel); document.body.append(host);
    const first = mountCompetitionTimeline(host, wrapper, dataset), second = mountCompetitionTimeline(host, wrapper, dataset);
    const ids = [...host.querySelectorAll("[id]")].map(node => node.id);
    first.destroy(); first.destroy(); local.setState({ mode: "competition" }); second.destroy();
    const result = { subscriptions, uniqueIds: new Set(ids).size === ids.length, panels: host.querySelectorAll(".ct-panel").length, sentinel: sentinel.isConnected };
    host.remove(); return result;
  });
  assert.deepEqual(result, { subscriptions: 0, uniqueIds: true, panels: 0, sentinel: true });
});

test("responsive page fits 320/360/768px with labeled controls", async () => {
  await routeFixture();
  for (const width of [320, 360, 768]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.getByLabel("开始分钟", { exact: true }).isVisible(), true);
    if (width === 360) await capture("module-d-mock-mobile.png");
  }
});
