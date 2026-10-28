import test from "node:test";
import assert from "node:assert/strict";
import { createStore, getState, setState, subscribe } from "../src/js/state.js";
import { selectTimelineEdges, edgeIntersects, getDatasetTimeRange, eventMinute } from "../src/js/competitionTimeline.js";
import { loadDataset, validateDataset, DATA_FILES, mountModules } from "../src/js/main.js";
import { analyzePlayer, getMatchTimeRange } from "../src/js/playerAnalysis.js";
import { fixtureDataset } from "./fixtures/moduleD.js";
const copy = () => structuredClone(fixtureDataset);

test("singleton exports and snapshot arrays cannot mutate state", () => {
  const snapshot = getState(); snapshot.timeRange[0] = 999;
  assert.equal(getState().timeRange[0], 0);
  let notifications = 0;
  const off = subscribe(() => notifications++);
  setState({ selectedMatchId: "test" }); off(); setState({ selectedMatchId: null });
  assert.equal(notifications, 1);
});

test("invalid patches are rejected atomically; no-op updates do not notify", () => {
  const store = createStore(); const original = store.getState(); let calls = 0;
  store.subscribe(() => calls++);
  store.setState({ mode: "collaboration", timeRange: [0, 130] });
  for (const patch of [{ mode: "bad" }, { timeRange: [2, 1] }, { timeRange: [0, NaN] }, { timeRange: [-1, 2] }, { selectedPlayerId: 1 }, { selectedEdgeId: "x" }, { mode: "competition", selectedTeamId: "" }]) assert.throws(() => store.setState(patch), TypeError);
  assert.deepEqual(store.getState(), original); assert.equal(calls, 0);
});

test("reentrant updates are delivered in order and subscribers receive independent snapshots", () => {
  const store = createStore(), observed = [];
  store.subscribe(snapshot => { snapshot.timeRange[0] = 77; if (snapshot.mode === "competition") store.setState({ mode: "collaboration" }); });
  store.subscribe(snapshot => observed.push([snapshot.mode, snapshot.timeRange[0]]));
  store.setState({ mode: "competition" });
  assert.deepEqual(observed, [["competition", 0], ["collaboration", 0]]);
});

test("empty competition edges are valid and distinct from a missing file", () => {
  const dataset = copy(); dataset.competitionEdges = [];
  assert.equal(validateDataset(dataset), dataset);
  assert.deepEqual(selectTimelineEdges(dataset, { mode: "competition", timeRange: [0, 125] }), []);
  delete dataset.competitionEdges;
  assert.throws(() => validateDataset(dataset), /competition_edges.json/);
});

test("inclusive edge intersection handles zero-width and both exact endpoints", () => {
  const edge = fixtureDataset.competitionEdges[0];
  for (const range of [[0, 1], [1, 1], [62 / 60, 62 / 60], [1.01, 1.02]]) assert.equal(edgeIntersects(edge, range), true);
  assert.equal(edgeIntersects(edge, [0, 1 - 1e-8]), false);
  assert.equal(edgeIntersects(edge, [62 / 60 + 1e-8, 125]), false);
});

test("D and existing C use the same match clock, exclude shootout and preserve fractional endpoints", () => {
  const dataset = copy();
  dataset.events.push({ period: 5, time_seconds: 9000 });
  assert.deepEqual(getDatasetTimeRange(dataset), [0, 125]);
  assert.deepEqual(getDatasetTimeRange(dataset), getMatchTimeRange(dataset));
  assert.equal(eventMinute({ minute: 12, second: 30, time_seconds: null }), 12.5);
  assert.equal(eventMinute({ minute: null, time_seconds: null }), null);
});

test("D controls and the existing C analysis agree on range and team selection", () => {
  const dataset = copy(); const store = createStore({ selectedPlayerId: "mock-a", mode: "competition", timeRange: [1, 1] });
  assert.equal(selectTimelineEdges(dataset, store.getState()).length, 1);
  assert.equal(analyzePlayer(dataset, store.getState()).edges.length, 1);
  assert.equal(analyzePlayer(dataset, store.getState()).current.values.passes, 1);
  store.setState({ timeRange: [0, 0] });
  assert.equal(analyzePlayer(dataset, store.getState()).current.values.passes, 0);
  assert.equal(analyzePlayer(dataset, store.getState()).edges.length, 0);
});

test("1000 switches preserve selection, notify each change and leave the correct final mode", () => {
  const store = createStore({ selectedPlayerId: "mock-a", timeRange: [0, 125] }); let calls = 0;
  const off = store.subscribe(() => calls++);
  for (let i = 0; i < 1000; i++) store.setState({ mode: i % 2 === 0 ? "competition" : "collaboration", timeRange: [0, i % 2 === 0 ? 62 / 60 : 125] });
  assert.equal(calls, 1000); assert.equal(store.getState().mode, "collaboration");
  assert.equal(store.getState().selectedPlayerId, "mock-a"); off();
});

test("five JSONs load by the frozen names and report multiple HTTP failures", async () => {
  const paths = [];
  const dataset = await loadDataset({ baseUrl: "http://test/", fetchImpl: async url => {
    paths.push(url.pathname); const key = Object.keys(DATA_FILES).find(key => DATA_FILES[key] === url.pathname.slice(1));
    return { ok: true, json: async () => copy()[key] };
  } });
  assert.deepEqual(dataset, fixtureDataset); assert.equal(paths.length, 5);
  await assert.rejects(loadDataset({ baseUrl: "http://test/", fetchImpl: async () => ({ ok: false, status: 404 }) }), error => Object.values(DATA_FILES).every(name => error.message.includes(name)));
});

test("malformed JSON, invalid reference, invented actor and forged times fail explicitly", async () => {
  await assert.rejects(loadDataset({ baseUrl: "http://test/", fetchImpl: async () => ({ ok: true, json: async () => { throw Error("parse"); } }) }), /有效 JSON/);
  for (const edit of [
    dataset => dataset.competitionEdges[0].event_ids.push("missing"),
    dataset => dataset.competitionEdges[0].player_ids.push("mock-c"),
    dataset => dataset.competitionEdges[0].start_minute = 0,
    dataset => dataset.competitionEdges[0].weight = 9,
    dataset => dataset.events[3].possession_id = "other",
    dataset => dataset.events[3].team_id = "mock-home",
    dataset => dataset.competitionEdges[0].team_ids = ["mock-home"],
  ]) { const dataset = copy(); edit(dataset); assert.throws(() => validateDataset(dataset)); }
});

test("all mounts receive the identical dataset/store; missing B is isolated and cleanup works", async () => {
  const dataset = copy(), store = createStore(), calls = [], hosts = new Map();
  const document = {
    getElementById: id => { if (!hosts.has(id)) hosts.set(id, { replaceChildren() {} }); return hosts.get(id); },
    createElement: () => ({}),
  };
  const result = await mountModules(document, store, dataset, async path => {
    if (path === "./hypergraph.js") throw Error("B not delivered");
    const name = { "./dataExplorer.js": "mountDataExplorer", "./playerAnalysis.js": "mountPlayerAnalysis", "./competitionTimeline.js": "mountCompetitionTimeline" }[path];
    return { [name]: (container, actualStore, actualDataset) => {
      assert.equal(actualStore, store); assert.equal(actualDataset, dataset); calls.push(name);
      return { destroy() { calls.push(`destroy:${name}`); } };
    } };
  });
  assert.equal(result.errors.length, 1); assert.match(result.errors[0], /B not delivered/);
  assert.equal(calls.length, 3); result.destroy(); result.destroy(); assert.equal(calls.length, 6);
});
