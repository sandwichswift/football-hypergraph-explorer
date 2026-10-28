import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { selectHypergraphEdges, groupHypergraphEdges, hyperedgePath } from "../src/js/hypergraph.js";
import { fixtureDataset } from "./fixtures/moduleD.js";
import { validateDataset } from "../src/js/main.js";
import { analyzePlayer } from "../src/js/playerAnalysis.js";
import { selectTimelineEdges } from "../src/js/competitionTimeline.js";

const state = { mode: "collaboration", selectedPlayerId: null, selectedTeamId: null, timeRange: [0, 130] };
test("raw selection keeps unrelated edges for highlighting, and deduplicates only IDs", () => {
  const dataset = structuredClone(fixtureDataset);
  dataset.collaborationEdges.push(structuredClone(dataset.collaborationEdges[0]));
  const before = JSON.stringify(dataset);
  const all = selectHypergraphEdges(dataset, state);
  assert.equal(all.edges.length, fixtureDataset.collaborationEdges.length);
  assert.deepEqual(selectHypergraphEdges(dataset, { ...state, selectedPlayerId: "missing" }).edges, all.edges);
  assert.equal(JSON.stringify(dataset), before);
});
test("exact interval endpoints count and outside windows disappear", () => {
  const edge = fixtureDataset.collaborationEdges[0];
  for (const time of [edge.start_minute, edge.end_minute]) {
    assert.ok(selectHypergraphEdges(fixtureDataset, { ...state, timeRange: [time, time] }).edges.includes(edge));
  }
  assert.equal(selectHypergraphEdges(fixtureDataset, { ...state, timeRange: [200, 210] }).edges.length, 0);
});
test("team filter and competition mode share the same selector", () => {
  for (const mode of ["collaboration", "competition"]) {
    const edges = selectHypergraphEdges(fixtureDataset, { ...state, mode, selectedTeamId: fixtureDataset.players[0].team_id }).edges;
    assert.ok(edges.length > 0);
    assert.ok(edges.every(edge => edge.type === mode && edge.team_ids.includes(fixtureDataset.players[0].team_id)));
  }
});
test("unavailable, empty, malformed and pair-only relationships remain distinct", () => {
  assert.equal(selectHypergraphEdges({ ...fixtureDataset, collaborationEdges: undefined }, state).available, false);
  assert.equal(selectHypergraphEdges({ ...fixtureDataset, collaborationEdges: [] }, state).available, true);
  for (const patch of [{ player_ids: ["a", "b"] }, { player_ids: "bad" }, { weight: 8 }, { event_ids: ["missing"] }, { start_minute: NaN }]) {
    const result = selectHypergraphEdges({ ...fixtureDataset, collaborationEdges: [{ ...fixtureDataset.collaborationEdges[0], ...patch }] }, state);
    assert.equal(result.edges.length, 0); assert.equal(result.invalidCount, 1);
  }
});
test("complete member sets aggregate without changing original evidence or weights", () => {
  const first = fixtureDataset.collaborationEdges[0];
  const copy = { ...first, edge_id: "another-window", player_ids: [...first.player_ids].reverse() };
  const extra = { ...first, edge_id: "another-set", player_ids: [...first.player_ids, "extra"] };
  const groups = groupHypergraphEdges([first, copy, extra]);
  assert.equal(groups.length, 2); assert.equal(groups[0].edges.length, 2);
  assert.equal(groups[0].edges[0], first); assert.equal(first.weight, 1);
  assert.equal(groupHypergraphEdges([first, extra], null, [extra.edge_id])[0].edges[0], extra);
});
test("envelopes enclose three coincident or collinear members without NaN", () => {
  for (const nodes of [[{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }], [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]]) {
    assert.match(hyperedgePath(nodes), /^M.*Z$/); assert.doesNotMatch(hyperedgePath(nodes), /NaN|Infinity/);
  }
  assert.equal(hyperedgePath([{ x: 0, y: 0 }, { x: 1, y: 1 }]), "");
});

// Real checks require the documented prepare_data.py command. No fixture fallback.
const load = async file => JSON.parse(await readFile(new URL(`../data/processed/${file}.json`, import.meta.url), "utf8"));
const dataset = Object.fromEntries(await Promise.all(Object.entries({ players: "players", events: "events", stats: "stats", collaborationEdges: "collaboration_edges", competitionEdges: "competition_edges" }).map(async ([key, file]) => [key, await load(file)])));
test("all five real files pass D's strict, unchanged provenance validator", () => {
  assert.equal(validateDataset(dataset), dataset);
  assert.equal(dataset.collaborationEdges.length, 531);
  assert.equal(dataset.competitionEdges.length, 385);
});
test("B/C/D agree on raw edge membership for both modes and exact time boundaries", () => {
  for (const mode of ["collaboration", "competition"]) for (const team of [null, "779", "771"]) for (const range of [[0, 130], [20, 40], [80, 81], [0, 0], [124.1166667, 124.1166667]]) {
    const current = { ...state, mode, selectedTeamId: team, timeRange: range };
    const selected = selectHypergraphEdges(dataset, current).edges;
    assert.deepEqual(selected.map(edge => edge.edge_id), selectTimelineEdges(dataset, current).map(edge => edge.edge_id));
    for (const player of ["5503", "3009"]) {
      assert.deepEqual(analyzePlayer(dataset, { ...current, selectedPlayerId: player }).edges.map(edge => edge.edge_id), selected.filter(edge => edge.player_ids.includes(player)).map(edge => edge.edge_id));
    }
  }
});
