/** B's actual renderer + A/C/D, with locally rebuilt real match data. */
import test, { before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname, sep, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const modulePath = process.env.PLAYWRIGHT_MODULE || "playwright";
const { chromium } = await import(isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath);
const root = fileURLToPath(new URL("../", import.meta.url));
let server, browser, page, base, errors;
const currentState = () => page.evaluate(async () => (await import("/src/js/state.js")).getState());
const patchState = patch => page.evaluate(async patch => (await import("/src/js/state.js")).setState(patch), patch);
const chooseStar = id => page.locator(`.pa-shortcut[data-pa-player="${id}"]`).click();
async function capture(name) {
  await mkdir(resolve(root, "docs/screenshots"), { recursive: true });
  await page.locator(".app-graph").screenshot({ path: resolve(root, `docs/screenshots/${name}.png`), animations: "disabled" });
}
before(async () => {
  await readFile(resolve(root, "data/processed/collaboration_edges.json"));
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const target = resolve(root, `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`);
      if (!target.startsWith(root.replace(/[\\/]$/, "") + sep)) { response.writeHead(403).end(); return; }
      const content = await readFile(target);
      const mime = { ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".png": "image/png" }[extname(target)] || "application/octet-stream";
      response.writeHead(200, { "Content-Type": mime }).end(content);
    } catch { response.writeHead(404).end("Not found"); }
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done)); base = `http://127.0.0.1:${server.address().port}`;
  const options = { headless: true, args: ["--no-sandbox", "--disable-gpu"] };
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) options.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  else options.channel = process.env.PLAYWRIGHT_BROWSER_CHANNEL || "chromium";
  browser = await chromium.launch(options);
});
after(async () => { await browser?.close(); if (server) await new Promise(done => server.close(done)); });
beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 1500, height: 1050 } });
  page.setDefaultTimeout(10000); errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && !message.text().includes("404")) errors.push(message.text()); });
  await page.goto(`${base}/src/`);
  await page.locator(".hg-edge").first().waitFor();
});
afterEach(async () => { await page?.close(); assert.deepEqual(errors, []); });

test("real A/B/C/D mount with a single graph and no external runtime requests", async () => {
  assert.match(await page.locator("#app-status").textContent(), /4407.*协作 531 条.*对抗 385 条/);
  assert.equal(await page.locator("#app-errors").isVisible(), false);
  assert.equal(await page.locator("#hypergraph svg").count(), 1);
  assert.equal(await page.locator(".hg-edge").count(), 12);
  const counts = await page.locator(".hg-edge").evaluateAll(paths => paths.map(path => Number(path.dataset.playerCount)));
  assert.ok(counts.every(count => count >= 3));
  const outside = await page.evaluate(() => performance.getEntriesByType("resource").filter(entry => new URL(entry.name).origin !== location.origin).map(entry => entry.name));
  assert.deepEqual(outside, []);
});
test("C star selection highlights every visible member edge and B selection updates C", async () => {
  await chooseStar("5503");
  assert.equal((await currentState()).selectedPlayerId, "5503");
  assert.ok(await page.locator('.hg-node-selected[data-player-id="5503"]').count());
  const membership = await page.locator(".hg-edge").evaluateAll(paths => paths.map(path => ({ dim: path.classList.contains("hg-dim"), contains: path.__data__.playerIds.includes("5503") })));
  assert.ok(membership.some(item => item.contains)); assert.ok(membership.every(item => item.dim !== item.contains));
  await mkdir(resolve(root, "docs/screenshots"), { recursive: true });
  await page.locator(".hg-stage").screenshot({ path: resolve(root, "docs/screenshots/hypergraph-b-main.png") });
  const player = await page.locator('.hg-node:not([data-player-id="5503"])').first().getAttribute("data-player-id");
  await page.locator(`.hg-node[data-player-id="${player}"]`).focus(); await page.keyboard.press("Enter");
  assert.equal((await currentState()).selectedPlayerId, player);
  assert.equal(await page.locator(".pa-identity h2").count() + await page.locator(".pa-name").count() > 0, true);
  await page.locator(".hg-clear").click(); assert.equal((await currentState()).selectedPlayerId, null);
});
test("edge click exposes all members, original IDs and source events", async () => {
  await page.locator(".hg-choice").first().click();
  assert.equal(await page.locator(".hg-edge-selected").count(), 1);
  assert.ok(await page.locator(".hg-member").count() >= 3);
  await page.locator(".hg-evidence-list summary").first().click();
  assert.match(await page.locator(".hg-event-id").first().textContent(), /^[a-f\d-]{36}$/);
  assert.match(await page.locator(".hg-event").first().textContent(), /Pass \/ complete/);
  await capture("hypergraph-b-collaboration");
});
test("zoom, pan, reset and real pointer drag change the SVG geometry", async () => {
  const viewport = page.locator(".hg-viewport");
  await page.locator(".hg-in").click(); assert.match(await viewport.getAttribute("transform"), /scale\(1\.3\)/);
  await page.locator(".hg-reset").click(); assert.match(await viewport.getAttribute("transform"), /scale\(1\)/);
  const node = page.locator(".hg-node").first(), before = await node.getAttribute("transform");
  await node.scrollIntoViewIfNeeded();
  const circle = await node.locator("circle").boundingBox();
  await page.mouse.move(circle.x + circle.width / 2, circle.y + circle.height / 2);
  await page.mouse.down(); await page.mouse.move(circle.x + 45, circle.y + 35, { steps: 8 }); await page.mouse.up();
  assert.notEqual(await node.getAttribute("transform"), before);
  const svg = await page.locator(".hg-svg").boundingBox();
  await page.mouse.move(svg.x + 8, svg.y + 8); await page.mouse.down(); await page.mouse.move(svg.x + 35, svg.y + 30, { steps: 4 }); await page.mouse.up();
  assert.notEqual(await viewport.getAttribute("transform"), "translate(0,0) scale(1)");
  await page.locator(".hg-reset").click();
  await node.focus(); const keyboardBefore = await node.getAttribute("transform"); await page.keyboard.press("ArrowRight");
  assert.notEqual(await node.getAttribute("transform"), keyboardBefore);
});
test("D mode switch uses the same SVG and competition evidence is labeled inference", async () => {
  await chooseStar("5503");
  await page.locator(".hg-svg").evaluate(svg => { svg.dataset.instanceMarker = "same-svg"; });
  await page.getByRole("button", { name: "Competition · 对抗", exact: true }).click();
  assert.equal(await page.locator(".hg-panel").getAttribute("data-raw-count"), "385");
  assert.equal(await page.locator(".hg-svg").getAttribute("data-instance-marker"), "same-svg");
  assert.match(await page.locator(".hg-explanation").textContent(), /事件窗口推断/);
  assert.match(await page.locator(".pa-edge-total").textContent(), /87 个/);
  const dash = await page.locator(".hg-edge").first().evaluate(path => getComputedStyle(path).strokeDasharray);
  assert.notEqual(dash, "none");
  await page.locator(".hg-choice").first().click(); await capture("hypergraph-b-competition");
});
test("team, exact time boundaries and an empty interval agree with D and C", async () => {
  await patchState({ selectedTeamId: "771", selectedPlayerId: "3009" });
  assert.equal(await page.locator(".hg-panel").getAttribute("data-raw-count"), "229");
  const valid = await page.locator(".hg-edge").evaluateAll(paths => paths.every(path => path.__data__.edges.every(edge => edge.team_ids.includes("771")))); assert.equal(valid, true);
  const edge = await page.locator(".hg-edge").first().evaluate(path => path.__data__.edges[0]);
  await patchState({ timeRange: [edge.start_minute, edge.start_minute] });
  const visibleRaw = await page.evaluate(async () => {
    const { selectHypergraphEdges } = await import("/src/js/hypergraph.js"); const { getState } = await import("/src/js/state.js");
    const dataset = await (await import("/src/js/main.js")).loadDataset(); return selectHypergraphEdges(dataset, getState()).edges.map(edge => edge.edge_id);
  });
  assert.ok(visibleRaw.includes(edge.edge_id));
  await patchState({ timeRange: [200, 210] });
  assert.equal(await page.locator(".hg-edge").count(), 0); assert.equal(await page.locator(".hg-empty").isVisible(), true);
  assert.equal(await page.locator(".hg-svg").count(), 1);
  await page.getByRole("button", { name: "查看全场", exact: true }).click(); assert.ok(await page.locator(".hg-edge").count());
});
test("C's optional combination request prioritizes and selects the exact complete set", async () => {
  await chooseStar("5503");
  await page.locator(".pa-combinations button").first().click();
  assert.equal(await page.locator(".hg-edge-selected").count(), 1);
  const selected = await page.locator(".hg-edge-selected").evaluate(path => path.__data__);
  assert.ok(selected.requested); assert.ok(selected.playerIds.includes("5503"));
  await patchState({ mode: "competition" }); assert.equal(await page.locator(".hg-edge-selected").count(), 0);
});
test("Top K limit is explicit and does not change C's raw participation count", async () => {
  await chooseStar("5503");
  const before = await page.locator(".pa-edge-total").textContent();
  await page.getByLabel("主图最多显示组合数").selectOption("24");
  assert.equal(await page.locator(".hg-edge").count(), 24);
  assert.equal(await page.locator(".pa-edge-total").textContent(), before);
  assert.match(await page.locator(".hg-summary").textContent(), /显示 24 个组合/);
});
test("100 alternating state changes retain one renderer and consistent counts", async () => {
  await page.evaluate(async () => {
    const store = await import("/src/js/state.js");
    for (let index = 0; index < 100; index++) store.setState({ mode: index % 2 ? "collaboration" : "competition", selectedPlayerId: index % 2 ? "5503" : "3009" });
  });
  assert.equal(await page.locator("#hypergraph svg").count(), 1); assert.equal(await page.locator(".hg-panel").count(), 1);
  assert.equal(await page.locator(".hg-panel").getAttribute("data-raw-count"), "531");
});
test("320/360/768px screens keep graph and evidence inside the page", async () => {
  await chooseStar("5503"); await page.locator(".hg-choice").first().click();
  for (const width of [320, 360, 768]) {
    await page.setViewportSize({ width, height: 950 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px overflow`);
    if (width === 360) await capture("hypergraph-b-mobile");
  }
});
test("destroy, replacement data and re-mount clean up only B's container", async () => {
  const result = await page.evaluate(async () => {
    const { mountHypergraph } = await import("/src/js/hypergraph.js"), store = await import("/src/js/state.js");
    const dataset = await (await import("/src/js/main.js")).loadDataset();
    const container = document.getElementById("hypergraph"); container.__hypergraphHandle.destroy();
    const handle = mountHypergraph(container, store, dataset);
    handle.updateDataset({ ...dataset, collaborationEdges: [] });
    const empty = container.querySelector(".hg-empty").textContent;
    handle.updateDataset({ ...dataset, collaborationEdges: undefined });
    const missing = container.querySelector(".hg-empty").textContent;
    handle.updateDataset(dataset); mountHypergraph(container, store, dataset);
    const count = container.querySelectorAll("svg").length;
    container.__hypergraphHandle.destroy(); container.__hypergraphHandle?.destroy(); handle.destroy();
    store.setState({ selectedPlayerId: "5503" });
    return { empty, missing, count, after: container.childElementCount, player: document.querySelectorAll(".pa-panel").length };
  });
  assert.match(result.empty, /没有满足/); assert.match(result.missing, /尚未提供/);
  assert.equal(result.count, 1); assert.equal(result.after, 0); assert.equal(result.player, 1);
});
