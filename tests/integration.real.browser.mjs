/** Full A/C/D integration with locally rebuilt real data; B is not substituted. */
import test, { before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
let browser, server, page, base, errors;
const metric = key => page.locator(`.pa-panel [data-metric="${key}"] .pa-metric-value`);
const state = () => page.evaluate(async () => (await import("/src/js/state.js")).getState());
const choose = id => page.locator(`.pa-shortcut[data-pa-player="${id}"]`).click();
async function capture(name) {
  const viewport = page.viewportSize(), height = await page.evaluate(() => document.body.scrollHeight);
  await page.setViewportSize({ width: viewport.width, height: height + 64 });
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  await page.screenshot({ path: resolve(root, `docs/screenshots/${name}.png`), clip: { x: 0, y: 0, width: viewport.width, height }, animations: "disabled" });
  await page.setViewportSize(viewport);
}
before(async () => {
  await readFile(resolve(root, "data/processed/competition_edges.json"));
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const path = resolve(root, `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`);
      if (!path.startsWith(root.replace(/[\\/]$/, "") + sep)) { response.writeHead(403).end(); return; }
      const type = { ".js": "application/javascript", ".json": "application/json", ".html": "text/html", ".css": "text/css", ".png": "image/png" }[extname(path)] || "application/octet-stream";
      const content = await readFile(path);
      response.writeHead(200, { "Content-Type": type }).end(content);
    } catch { response.writeHead(404).end("Not found"); }
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${server.address().port}`;
  const options = { headless: true, args: ["--disable-gpu"] };
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) options.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  else options.channel = process.env.PLAYWRIGHT_BROWSER_CHANNEL || "chrome";
  browser = await chromium.launch(options);
  await mkdir(resolve(root, "docs/screenshots"), { recursive: true });
});
after(async () => { await browser?.close(); if (server) await new Promise(done => server.close(done)); });
beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(8000);
  errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/src/`);
  await page.locator(".ct-panel").waitFor();
});
afterEach(async () => { await page?.close(); assert.deepEqual(errors, []); });

test("real app mounts A/C/D and explicitly distinguishes undelivered B from zero", async () => {
  assert.match(await page.locator("#app-status").textContent(), /4407.*协作 未提供.*对抗 385 条/);
  assert.equal(await page.locator(".de-root").count(), 1);
  assert.equal(await page.locator(".pa-panel").count(), 1);
  assert.equal(await page.locator("#hypergraph svg").count(), 0);
  await choose("5503");
  assert.equal(await metric("passes").textContent(), "60");
  assert.equal(await metric("goals").textContent(), "2");
  assert.match(await page.locator(".pa-edge-total").textContent(), /87 个/);
  await capture("player-c-real-relations");
  await page.getByRole("button", { name: "Collaboration · 协作", exact: true }).click();
  assert.match(await page.locator(".pa-network-empty").textContent(), /尚未提供/);
  assert.equal(await metric("passes").textContent(), "60");
});

test("real D controls update C while full totals stay unchanged", async () => {
  await choose("3009");
  assert.equal(await metric("goals").textContent(), "3");
  await page.getByLabel("结束分钟数值", { exact: true }).fill("80");
  assert.equal(await metric("goals").textContent(), "1");
  assert.match(await page.locator('[data-metric="goals"] .pa-metric-full').textContent(), /全场 3/);
  await page.getByLabel("开始分钟数值", { exact: true }).fill("80");
  await page.getByLabel("结束分钟数值", { exact: true }).fill("81");
  assert.equal(await metric("goals").textContent(), "1");
  await page.getByRole("button", { name: "查看全场", exact: true }).click();
  assert.equal(await metric("goals").textContent(), "3");
  await page.locator(".ct-team").selectOption("779");
  assert.equal((await state()).selectedPlayerId, "3009");
  assert.equal(await page.locator(".pa-team-notice").isVisible(), true);
});

test("real shot positions, selection and source periods are retained", async () => {
  await choose("5503");
  await page.getByRole("tab", { name: "射门分析", exact: true }).click();
  assert.equal(await page.locator(".pa-shot-mark").count(), 5);
  assert.equal(await page.locator(".pa-shot-item-goal").count(), 2);
  await page.locator(".pa-shot-item").last().click();
  assert.match(await page.locator(".pa-shot-detail").textContent(), /加时下半场.*107.97′.*54b889ec/);
  await capture("player-c-real-shots");
  await page.getByLabel("结束分钟数值", { exact: true }).fill("90");
  assert.equal(await page.locator(".pa-shot-mark").count(), 2);
  assert.equal(await page.locator(".pa-shot-halo").count(), 0);
});

test("real paired metrics share time, preserve unavailable assists and support swap", async () => {
  await choose("5503");
  await page.getByRole("tab", { name: "球员对比", exact: true }).click();
  await page.getByLabel("选择对比球员", { exact: true }).selectOption("3009");
  const rows = page.locator(".pa-compare-row");
  assert.equal(await rows.count(), 8);
  const goals = page.locator('[data-compare-metric="goals"]');
  assert.equal(await goals.locator(".pa-compare-value-primary").textContent(), "2");
  assert.equal(await goals.locator(".pa-compare-value-secondary").textContent(), "3");
  assert.equal(await goals.locator(".pa-compare-difference").textContent(), "差值 -1个");
  assert.match(await rows.filter({ hasText: "助攻" }).textContent(), /N\/A/);
  await capture("player-c-real-comparison");
  await page.getByRole("button", { name: "交换主副球员", exact: true }).click();
  assert.equal((await state()).selectedPlayerId, "3009");
  assert.equal(await page.locator(".pa-compare-select").inputValue(), "5503");
});

test("real relationship matrix and expanded evidence use the actual source events", async () => {
  await choose("5503");
  await page.getByRole("button", { name: "矩阵", exact: true }).click();
  await page.locator(".pa-matrix-choice").first().click();
  assert.equal(await page.locator(".pa-evidence").isVisible(), true);
  await page.locator(".pa-evidence summary").first().click();
  assert.match(await page.locator(".pa-event-id").first().textContent(), /^[a-f\d-]{36}$/);
  assert.match(await page.locator(".pa-event-description").first().textContent(), /上半场|下半场/);
});

test("A team/time and player selections propagate through the production store", async () => {
  await page.getByRole("tab", { name: "比赛概览", exact: true }).click();
  await page.locator('[data-de-team="779"]').click();
  assert.equal((await state()).selectedTeamId, "779");
  assert.equal(await page.locator(".ct-team").inputValue(), "779");
  await page.locator('[data-de-period="1"]').click();
  const previousRange = (await state()).timeRange;
  await page.locator('.de-player[data-de-player="5503"]').click();
  assert.equal(await page.locator("#focus-workspace").isVisible(), true);
  assert.equal((await state()).selectedPlayerId, "5503");
  assert.deepEqual((await state()).timeRange, previousRange);
  assert.equal(await metric("goals").textContent(), "2"); // A's local phase is not a shared phase filter.
  assert.match(await page.locator(".pa-performance .pa-scope-note").textContent(), /不限定比赛阶段/);
});

test("real rich views and the full-width overview fit mobile and tablet screens", async () => {
  await choose("5503");
  for (const width of [320, 360, 768]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of ["多人关系", "射门分析", "球员对比"]) {
      await page.getByRole("tab", { name, exact: true }).click();
      if (name === "球员对比") await page.locator(".pa-compare-select").selectOption("3009");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px / ${name}`);
    }
    if (width === 360) await capture("player-c-real-mobile");
    await page.getByRole("tab", { name: "比赛概览", exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px / overview`);
    await page.getByRole("tab", { name: "球星与关系", exact: true }).click();
  }
});
