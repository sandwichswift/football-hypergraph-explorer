import test, { before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Optional acceptance-test tooling. Production code has no npm dependency.
const moduleName = process.env.PLAYWRIGHT_MODULE || "playwright";
const importName = /^[A-Za-z]:[\\/]/.test(moduleName) ? pathToFileURL(moduleName).href : moduleName;
const { chromium } = await import(importName).catch(() => {
  throw new Error(
    "Browser tests need Playwright: install it locally or set PLAYWRIGHT_MODULE to its index.mjs path. On Windows PLAYWRIGHT_BROWSER_CHANNEL defaults to msedge.",
  );
});
const repo = fileURLToPath(new URL("../", import.meta.url));
// Run the whole suite once per theme: DE_THEME=dark (default) or DE_THEME=light.
const theme = process.env.DE_THEME === "light" ? "light" : "dark";
const screenshotName = (name) => (theme === "dark" ? name : name.replace("data-a-", "data-a-light-"));
const openTab = (name) => page.locator(`.de-tab[data-de-tab="${name}"]`).click();
const screenshots = resolve(repo, "docs/screenshots");
let server, browser, page, baseUrl, errors, rawEvents, normalizedEvents, players;
const metric = (key) => page.locator(`.de-root [data-metric="${key}"] .de-metric-value`);
const numberFrom = (text) => Number(text.replaceAll(",", ""));
const count = async (key) => numberFrom(await metric(key).textContent());
const rawRegular = (event) => [1, 2, 3, 4].includes(event.period);
const rawMinute = (event) => event.minute + event.second / 60;
const rawCount = ({ team, type, period, start = 0, end = Infinity } = {}) =>
  rawEvents.filter(
    (event) =>
      rawRegular(event) &&
      (!team || String(event.team?.id) === team) &&
      (!type || event.type?.name === type) &&
      (!period || event.period === period) &&
      rawMinute(event) >= start &&
      rawMinute(event) <= end,
  ).length;

const chooseTeam = (team) => page.locator(`.de-team-group [data-de-team="${team}"]`).click();
const choosePeriod = (period) => page.locator(`.de-period-group [data-de-period="${period}"]`).click();

// Derive x positions from the original match clocks, independently of the production helpers.
async function dragXg(fromPeriod, fromMinute, toPeriod, toMinute) {
  await page.locator(".de-hit").scrollIntoViewIfNeeded();
  const box = await page.locator(".de-hit").boundingBox();
  const nominal = { 1: 0, 2: 45, 3: 90, 4: 105 };
  const spans = [1, 2, 3, 4].map((period) => {
    const minutes = rawEvents.filter((event) => event.period === period).map(rawMinute);
    return { period, start: Math.min(nominal[period], ...minutes), end: Math.max(...minutes) };
  });
  const total = spans.reduce((sum, span) => sum + span.end - span.start, 0);
  const point = (period, minute) => {
    let offset = 0;
    for (const span of spans) {
      if (span.period === period) return box.x + box.width * (offset + minute - span.start) / total;
      offset += span.end - span.start;
    }
    throw new Error(`Unknown period ${period}`);
  };
  await page.mouse.move(point(fromPeriod, fromMinute), box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(point(toPeriod, toMinute), box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
}

async function paint() {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}
async function capture(name) {
  const viewport = page.viewportSize();
  const height = await page.evaluate(() => document.body.scrollHeight);
  // Keep all tiles painted in headless Edge, including the long mobile page.
  await page.setViewportSize({ width: viewport.width, height: height + 64 });
  await paint();
  await page.screenshot({
    path: resolve(screenshots, screenshotName(name)),
    animations: "disabled",
    clip: { x: 0, y: 0, width: viewport.width, height },
  });
  await page.setViewportSize(viewport);
}

before(async () => {
  try {
    [rawEvents, normalizedEvents, players] = await Promise.all(
      ["data/raw/events_3869685.json", "data/processed/events.json", "data/processed/players.json"].map(
        async (path) => JSON.parse(await readFile(resolve(repo, path), "utf8")),
      ),
    );
  } catch (error) {
    throw new Error(
      `Run the README data download and preprocessing commands before browser acceptance tests: ${error.message}`,
    );
  }
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const path = resolve(repo, `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`);
      if (!path.startsWith(`${repo.replace(/[\\/]$/, "")}${sep}`)) {
        response.writeHead(403).end();
        return;
      }
      const content = await readFile(path);
      const type =
        {
          ".html": "text/html",
          ".js": "application/javascript",
          ".css": "text/css",
          ".json": "application/json",
          ".png": "image/png",
          ".md": "text/plain",
        }[extname(path)] || "application/octet-stream";
      response.writeHead(200, { "Content-Type": `${type}; charset=utf-8` }).end(content);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const options = { headless: true, args: ["--disable-gpu"] };
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE)
    options.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  else if (process.env.PLAYWRIGHT_BROWSER_CHANNEL || process.platform === "win32")
    options.channel = process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge";
  browser = await chromium.launch(options);
  await mkdir(screenshots, { recursive: true });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((done) => server.close(done));
});
beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 1 });
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`${baseUrl}/demos/data-a/?theme=${theme}`);
  await page.locator(".de-root").waitFor();
  await page.waitForFunction(
    () =>
      window.dataADemo &&
      [...document.styleSheets].some((sheet) => sheet.href?.endsWith("dataExplorer.css")) &&
      document.querySelector(".de-source-logo")?.complete,
  );
  // The shared-time test controls live in a collapsed "测试工具" section.
  await page.locator(".da-tools").evaluate((details) => {
    details.open = true;
  });
  await paint();
});
afterEach(async () => {
  await page?.close();
  assert.deepEqual(errors, [], "no browser console errors or unhandled page exceptions");
});

test("real default data shows 4386 events, 1263 passes, 30 shots and a separate shootout score", async () => {
  assert.equal(await count("events"), 4386);
  assert.equal(await count("passes"), 1263);
  assert.equal(await metric("shots").textContent(), "30 / 5.03");
  assert.equal(await metric("pass-accuracy").textContent(), "78.7%");
  assert.match(
    await page.locator("[data-metric=pass-accuracy] .de-metric-note").textContent(),
    /10 次结果未知/,
  );
  assert.deepEqual(await page.locator(".de-score").allTextContents(), ["3", "3"]);
  assert.equal(await page.locator(".de-shootout-score").textContent(), "点球 4–2");
  assert.deepEqual(await page.locator(".de-kick.is-in").count(), 6, "4 Argentina + 2 France shootout goals");
  assert.match(await page.locator(".de-home .de-goals").textContent(), /23′ 108′/);
  assert.match(await page.locator(".de-away .de-goals").textContent(), /80′ 81′ 118′/);
  assert.equal(await page.locator(".de-shot").count(), rawCount({ type: "Shot" }));
  assert.equal(await page.locator(".de-shot.is-goal").count(), 6);
  assert.equal(await page.locator(".de-xg-line").count(), 2);
  assert.equal(await page.locator(".de-root").getAttribute("data-theme"), theme);
  assert.equal(
    await page.locator(".de-headline").textContent(),
    "阿根廷两度领先，两度被法国扳平，点球大战 4–2 胜出",
  );
  assert.equal(await page.locator(".de-player").count(), 50);
  assert.equal(await count("events"), rawCount());
  assert.equal(await count("passes"), rawCount({ type: "Pass" }));
  assert.match(await page.locator(".de-quality").textContent(), /点球大战 21 条已排除/);
  assert.equal(await page.locator(".de-source-logo").evaluate((image) => image.naturalWidth > 0), true);
  await capture("data-a-desktop.png");
});

test("team and event-type filters show Argentina 693 passes/20 shots and France 570/10", async () => {
  for (const [team, passes, shots] of [
    ["779", 693, 20],
    ["771", 570, 10],
  ]) {
    await page.getByLabel("筛选事件类型", { exact: true }).selectOption("");
    await chooseTeam(team);
    assert.equal(await count("passes"), passes);
    assert.equal(await page.locator(".de-shot").count(), shots, "shot map follows the team filter");
    assert.equal(await page.locator(".de-compare-row").count(), 8, "comparison keeps both teams");
    assert.equal(await count("events"), rawCount({ team }));
    assert.equal(await page.evaluate(() => window.dataADemo.store.getState().selectedTeamId), team);
    await page.getByLabel("筛选事件类型", { exact: true }).selectOption("Shot");
    assert.equal(await count("events"), shots);
    assert.equal(await count("events"), rawCount({ team, type: "Shot" }));
    assert.equal(await count("passes"), 0);
    assert.match(await metric("shots").textContent(), new RegExp(`^${shots} / `));
    assert.match(await page.locator(".de-clock-note").textContent(), /事件类型与比赛阶段仅筛选本概览/);
    if (team === "779") await capture("data-a-filtered.png");
  }
});

test("period selection is verified against raw source, including clock overlap, and remains local", async () => {
  await choosePeriod("1");
  assert.equal(await count("events"), rawCount({ period: 1 }));
  assert.equal(await count("passes"), rawCount({ period: 1, type: "Pass" }));
  assert.ok(
    (await page.locator(".de-event-select").allTextContents()).every((text) => text.includes("上半场")),
  );
  // Source first-half stoppage time extends beyond 45; a phase cannot be inferred from a numeric 0-45 window.
  assert.ok(rawCount({ period: 1 }) > rawCount({ period: 1, end: 45 }));
  assert.equal(await page.evaluate(() => "period" in window.dataADemo.store.getState()), false);
  await page.locator("#demo-start").fill("45");
  await page.locator("#demo-end").fill("50");
  await page.getByRole("button", { name: "应用时间", exact: true }).click();
  assert.equal(await count("events"), rawCount({ period: 1, start: 45, end: 50 }));
  await choosePeriod("2");
  assert.equal(await count("events"), rawCount({ period: 2, start: 45, end: 50 }));
});

test("0-30 clock minutes update counts and selecting Messi links the existing C panel", async () => {
  await page.getByRole("button", { name: "0–30 分钟", exact: true }).click();
  assert.equal(await count("events"), rawCount({ end: 30 }));
  assert.equal(await count("passes"), rawCount({ type: "Pass", end: 30 }));
  assert.deepEqual(await page.evaluate(() => window.dataADemo.store.getState().timeRange), [0, 30]);
  const messi = players.find((player) => player.player_name.includes("Messi"));
  await page.locator(`.de-player[data-de-player="${messi.player_id}"]`).click();
  assert.equal(await page.locator(".da-c-integration").evaluate((details) => details.open), true);
  assert.equal(
    await page.evaluate(() => window.dataADemo.store.getState().selectedPlayerId),
    messi.player_id,
  );
  assert.equal(await page.locator(".pa-name").textContent(), messi.player_name);
  const expected = rawEvents.filter(
    (event) =>
      rawRegular(event) &&
      String(event.player?.id) === messi.player_id &&
      event.type?.name === "Pass" &&
      rawMinute(event) <= 30,
  ).length;
  assert.equal(
    numberFrom(await page.locator(".pa-panel [data-metric=passes] .pa-metric-value").textContent()),
    expected,
  );
  assert.match(await page.locator(".pa-range").textContent(), /0′–30′/);
  assert.match(await page.locator(".pa-edge-total").textContent(), /等待关系数据/);
});

test("event evidence preserves source ID and fields and clears when filters change", async () => {
  await page.getByLabel("筛选事件类型", { exact: true }).selectOption("Shot");
  await openTab("events");
  await page.locator(".de-event-select").first().click();
  const record = JSON.parse(await page.locator(".de-record").textContent());
  const normalized = normalizedEvents.find((event) => event.event_id === record.event_id);
  const raw = rawEvents.find((event) => event.id === record.event_id);
  assert.deepEqual(record, normalized);
  assert.equal(record.event_index, raw.index);
  assert.equal(record.type, raw.type.name);
  assert.equal(record.time_seconds, raw.minute * 60 + raw.second);
  assert.deepEqual(record.location, raw.location);
  assert.equal(record.xg, raw.shot.statsbomb_xg);
  assert.equal(await page.locator(".de-evidence").evaluate((details) => details.open), true);
  await chooseTeam("771");
  assert.equal(await page.locator(".de-evidence").evaluate((details) => details.open), false);
  assert.doesNotMatch(await page.locator(".de-record").textContent(), new RegExp(record.event_id));
});

test("an empty 200-210 window shows an empty state without NaN and rejects invalid ranges", async () => {
  await page.locator("#demo-start").fill("200");
  await page.locator("#demo-end").fill("210");
  await page.getByRole("button", { name: "应用时间", exact: true }).click();
  assert.equal(await count("events"), 0);
  assert.equal(await count("passes"), 0);
  assert.equal(await metric("pass-accuracy").textContent(), "N/A");
  await openTab("events");
  assert.equal(await page.locator(".de-table-empty").isVisible(), true);
  assert.equal(await page.locator(".de-chart-empty").isVisible(), true);
  assert.doesNotMatch(await page.locator(".de-root").textContent(), /NaN|Infinity|undefined/);
  await page.locator("#demo-start").fill("220");
  await page.getByRole("button", { name: "应用时间", exact: true }).click();
  assert.equal(await page.locator("#demo-time-error").isVisible(), true);
  assert.deepEqual(await page.evaluate(() => window.dataADemo.store.getState().timeRange), [200, 210]);
});

test("empty dataset, missing dataset and null optional fields render safely", async () => {
  await page.evaluate(() => window.dataADemo.mounted.updateDataset({ players: [], events: [], stats: {} }));
  assert.equal(await count("events"), 0);
  assert.equal(await page.locator(".de-player").count(), 0);
  assert.equal(await metric("pass-accuracy").textContent(), "N/A");
  assert.match(await page.locator(".de-quality").textContent(), /源数据 0 条/);
  await page.evaluate(() => window.dataADemo.mounted.updateDataset(null));
  assert.match(await page.locator(".de-quality").textContent(), /尚未提供事件数组/);
  await page.evaluate(() => {
    // Explicit synthetic boundary fixture; never captured as a real-match screenshot.
    const fixture = {
      players: [
        {
          player_id: "synthetic-null",
          player_name: "SYNTHETIC missing fields",
          team_id: "synthetic-team",
          team_name: null,
          position: null,
          shirt_number: null,
        },
      ],
      events: [
        {
          event_id: "synthetic-event",
          event_index: 1,
          period: 1,
          minute: 1,
          second: 0,
          time_seconds: 60,
          team_id: "synthetic-team",
          player_id: "synthetic-null",
          type: "Pass",
          possession_id: null,
          recipient_id: null,
          outcome: null,
          location: null,
          related_event_ids: [],
          xg: null,
        },
      ],
      stats: {},
    };
    window.dataADemo.mounted.updateDataset(fixture);
  });
  assert.equal(await count("events"), 1);
  assert.equal(await count("passes"), 1);
  assert.equal(await metric("pass-accuracy").textContent(), "N/A");
  assert.match(await page.locator(".de-player").textContent(), /位置未提供/);
  assert.doesNotMatch(await page.locator(".de-root").textContent(), /NaN|Infinity|undefined/);
});

test("destroy is idempotent, repeated mounts clean up subscriptions and preserve unrelated host content", async () => {
  const result = await page.evaluate(() => {
    const { mountDataExplorer, dataset } = window.dataADemo;
    const listeners = new Set();
    const localStore = {
      getState: () => ({ selectedTeamId: null, selectedPlayerId: null, timeRange: [0, 130] }),
      setState() {},
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const host = document.createElement("div"),
      sentinel = document.createElement("p");
    sentinel.textContent = "unrelated host content";
    host.append(sentinel);
    document.body.append(host);
    let maximumListeners = 0;
    for (let index = 0; index < 5; index++) {
      const mounted = mountDataExplorer(host, localStore, dataset);
      maximumListeners = Math.max(maximumListeners, listeners.size);
      mounted.destroy();
      mounted.destroy();
      mounted.updateDataset(dataset);
    }
    const output = {
      maximumListeners,
      remainingListeners: listeners.size,
      roots: host.querySelectorAll(".de-root").length,
      links: host.querySelectorAll("link").length,
      unrelatedPreserved: sentinel.isConnected,
      children: host.children.length,
    };
    host.remove();
    return output;
  });
  assert.deepEqual(result, {
    maximumListeners: 1,
    remainingListeners: 0,
    roots: 0,
    links: 0,
    unrelatedPreserved: true,
    children: 1,
  });
  assert.equal(await page.locator(".de-root").count(), 1);
});

test("100 shared state updates leave one overview with correct final data and no duplicate elements", async () => {
  await page.evaluate(() => {
    const { store } = window.dataADemo;
    for (let index = 0; index < 100; index++)
      store.setState({ selectedTeamId: index % 2 ? "779" : "771", timeRange: [0, index % 2 ? 30 : 90] });
    store.setState({ selectedTeamId: null, timeRange: [0, 130] });
  });
  assert.equal(await page.locator(".de-root").count(), 1);
  assert.equal(await page.locator("#data-panel link").count(), 1);
  assert.equal(await page.locator(".de-team-card").count(), 2);
  assert.equal(await page.locator(".de-player").count(), 50);
  assert.equal(await page.locator(".de-table tbody tr").count(), 12);
  assert.equal(await count("events"), rawCount());
  assert.equal(await count("passes"), 1263);
});

test("clicking a shot selects the shooter, dims other shots and shows the source record", async () => {
  const messi = players.find((player) => player.player_name.includes("Messi"));
  const shot = normalizedEvents.find(
    (event) =>
      event.type === "Shot" &&
      event.player_id === messi.player_id &&
      event.period < 5 &&
      event.outcome === "goal",
  );
  await page.locator(`[data-de-shot="${shot.event_id}"]`).dispatchEvent("click");
  assert.equal(
    await page.evaluate(() => window.dataADemo.store.getState().selectedPlayerId),
    messi.player_id,
  );
  assert.deepEqual(JSON.parse(await page.locator(".de-record").textContent()), shot);
  const messiShots = normalizedEvents.filter(
    (event) => event.type === "Shot" && event.player_id === messi.player_id && event.period < 5,
  ).length;
  assert.equal(await page.locator(".de-shot:not(.is-dim)").count(), messiShots);
  assert.equal(
    await page.locator(`.de-player[data-de-player="${messi.player_id}"]`).getAttribute("aria-pressed"),
    "true",
  );
});

test("a single-period xG brush shares raw minutes and keeps the phase filter local to A", async () => {
  await dragXg(1, 10, 1, 30);
  const [start, end] = await page.evaluate(() => window.dataADemo.store.getState().timeRange);
  assert.ok(Math.abs(start - 10) < 0.02 && Math.abs(end - 30) < 0.02, `selected source-clock range ${start}-${end}`);
  assert.equal(await count("events"), rawCount({ period: 1, start, end }));
  assert.equal(await page.locator(".de-shot").count(), rawCount({ period: 1, type: "Shot", start, end }));
  assert.equal(await page.locator('.de-period-group [aria-pressed="true"]').getAttribute("data-de-period"), "1");
  assert.equal(await page.evaluate(() => "period" in window.dataADemo.store.getState()), false);
  assert.match(await page.locator(".de-xg-help").textContent(), /阶段仅筛选 A.*原始分钟区间.*共享/);
  assert.match(await page.locator(".de-brush-message").textContent(), /已选择上半场/);
  assert.equal(await page.locator(".de-brush-message").getAttribute("aria-live"), "polite");
  assert.ok((await page.locator(".de-range-out").count()) > 0, "unselected time is shaded");
  await page.locator(".de-xg-all").click();
  assert.equal(await count("events"), rawCount());
  assert.equal(await page.locator('.de-period-group [aria-pressed="true"]').getAttribute("data-de-period"), "");
});

test("forward and backward cross-period brushes preserve shared state and all A-local filters", async () => {
  await choosePeriod("2");
  await page.getByLabel("筛选事件类型", { exact: true }).selectOption("Pass");
  await page.evaluate(() => window.dataADemo.store.setState({ selectedTeamId: "779", selectedPlayerId: "5503", timeRange: [45, 50] }));
  const stateBefore = await page.evaluate(() => window.dataADemo.store.getState());
  const eventsBefore = await count("events");
  for (const [from, to] of [[[1, 48], [2, 49]], [[2, 49], [1, 48]]]) {
    await dragXg(...from, ...to);
    assert.deepEqual(await page.evaluate(() => window.dataADemo.store.getState()), stateBefore);
    assert.equal(await count("events"), eventsBefore);
    assert.equal(await page.locator('.de-period-group [aria-pressed="true"]').getAttribute("data-de-period"), "2");
    assert.equal(await page.getByLabel("筛选事件类型", { exact: true }).inputValue(), "Pass");
    assert.match(await page.locator(".de-brush-message").textContent(), /不能跨比赛阶段拖选，已保留原有筛选/);
    assert.equal(await page.locator(".de-brush-message").isVisible(), true);
  }
  // A click or sub-threshold movement must not silently change the local phase either.
  await dragXg(1, 48, 1, 48.05);
  assert.deepEqual(await page.evaluate(() => window.dataADemo.store.getState()), stateBefore);
  assert.equal(await page.locator('.de-period-group [aria-pressed="true"]').getAttribute("data-de-period"), "2");
});

test("forward stoppage and reverse second-half brushes separate overlapping source minutes", async () => {
  for (const [period, from, to] of [[1, 46, 49], [2, 49, 46]]) {
    await dragXg(period, from, period, to);
    const [start, end] = await page.evaluate(() => window.dataADemo.store.getState().timeRange);
    assert.ok(Math.abs(start - 46) < 0.02 && Math.abs(end - 49) < 0.02);
    assert.equal(await count("events"), rawCount({ period, start, end }));
    assert.ok(rawCount({ start, end }) > await count("events"), "clock minutes alone also match a different phase");
    assert.equal(await page.locator('.de-period-group [aria-pressed="true"]').getAttribute("data-de-period"), String(period));
  }
});

test("Disasi is labelled as having no associated event and remains selectable", async () => {
  await openTab("players");
  const summary = page.locator(".de-bench summary");
  assert.ok((await summary.allTextContents()).every((text) => text.startsWith("无关联事件")));
  assert.doesNotMatch((await summary.allTextContents()).join(" "), /未登场/);
  assert.match(await page.locator(".de-roster-note").textContent(), /包含已登场但没有关联事件的球员/);
  const disasi = page.locator('.de-player[data-de-player="7439"]');
  await disasi.evaluate((button) => { button.closest("details").open = true; });
  await disasi.click();
  assert.equal(await page.evaluate(() => window.dataADemo.store.getState().selectedPlayerId), "7439");
  assert.equal(await page.locator(".pa-name").textContent(), "Axel Disasi");
});

test("real low-xG circles have proportional area, larger hit targets and persistent keyboard focus", async () => {
  const smaller = rawEvents.find((event) => event.index === 979);
  const larger = rawEvents.find((event) => event.index === 2204);
  const smallTarget = page.locator(`[data-de-shot="${smaller.id}"]`);
  const largeTarget = page.locator(`[data-de-shot="${larger.id}"]`);
  const smallRadius = Number(await smallTarget.locator(".de-shot").getAttribute("r"));
  const largeRadius = Number(await largeTarget.locator(".de-shot").getAttribute("r"));
  assert.ok(smallRadius < largeRadius && largeRadius < 0.9);
  assert.ok(Math.abs(largeRadius ** 2 / smallRadius ** 2 - larger.shot.statsbomb_xg / smaller.shot.statsbomb_xg) < 1e-10);
  assert.equal(await smallTarget.locator(".de-shot").evaluate((circle) => getComputedStyle(circle).stroke), "none");
  assert.ok(Number(await smallTarget.locator(".de-shot-hit").getAttribute("r")) > smallRadius);
  await smallTarget.locator(".de-shot-hit").click();
  assert.equal(await page.evaluate(() => window.dataADemo.store.getState().selectedPlayerId), String(smaller.player.id));
  await largeTarget.focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => window.dataADemo.store.getState().selectedPlayerId), String(larger.player.id));
  assert.equal(await page.evaluate(() => document.activeElement.dataset.deShot), larger.id);
  await page.keyboard.press("Space");
  assert.deepEqual(JSON.parse(await page.locator(".de-record").textContent()), normalizedEvents.find((event) => event.event_id === larger.id));
  const radii = await page.locator(".de-pitches .de-shots").first().locator(".de-shot").evaluateAll((circles) => circles.map((circle) => Number(circle.getAttribute("r"))));
  assert.deepEqual(radii, [...radii].sort((a, b) => b - a), "small circles and hit targets are drawn last to win overlapping pointer hits");
});

test("synthetic zero and missing xG stay zero-area while pointer and keyboard selection remain available", async () => {
  await page.evaluate(() => {
    // Explicit synthetic boundary fixture; never used in real-match screenshots.
    const { dataset, mounted } = window.dataADemo;
    const seeds = dataset.events.filter((event) => event.type === "Shot" && event.period < 5).slice(0, 2);
    const events = seeds.map((event, index) => ({ ...event, event_id: `synthetic-xg-${index}`, period: 1, minute: index + 1, second: 0, time_seconds: (index + 1) * 60, xg: index === 0 ? 0 : null, location: [100, index === 0 ? 20 : 60] }));
    const players = seeds.map((event, index) => ({ ...dataset.players.find((player) => player.player_id === event.player_id), player_name: `SYNTHETIC xG ${index}` }));
    mounted.updateDataset({ events, players, stats: {} });
  });
  const zero = page.locator('[data-de-shot="synthetic-xg-0"]');
  const missing = page.locator('[data-de-shot="synthetic-xg-1"]');
  for (const target of [zero, missing]) {
    assert.equal(await target.locator(".de-shot").getAttribute("r"), "0");
    assert.ok(Number(await target.locator(".de-shot-hit").getAttribute("r")) > 0);
  }
  assert.equal(await zero.locator(".de-shot-zero").textContent(), "0");
  assert.equal(await missing.locator(".de-shot-missing").textContent(), "?");
  assert.match(await missing.getAttribute("aria-label"), /xG 缺失/);
  await zero.locator(".de-shot-hit").click();
  assert.equal(JSON.parse(await page.locator(".de-record").textContent()).event_id, "synthetic-xg-0");
  await missing.focus();
  await page.keyboard.press("Enter");
  assert.equal(JSON.parse(await page.locator(".de-record").textContent()).event_id, "synthetic-xg-1");
});

test("mobile 320px and 390px have no document overflow while the event table scrolls internally", async () => {
  await openTab("events");
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 850 });
    await paint();
    const sizes = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      tableScroll: document.querySelector(".de-table-scroll").scrollWidth,
      tableClient: document.querySelector(".de-table-scroll").clientWidth,
    }));
    assert.ok(sizes.document <= sizes.viewport, `${width}px viewport has ${sizes.document}px document width`);
    assert.ok(sizes.tableScroll > sizes.tableClient, "event table should scroll within its own container");
    assert.equal(await count("events"), 4386);
    if (width === 390) await capture("data-a-mobile.png");
  }
});
