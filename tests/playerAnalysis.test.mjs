import test from "node:test";
import assert from "node:assert/strict";
import { analyzePlayer, comparePlayers, derivePlayerMetrics, eventMinute, getMatchTimeRange, getPlayerShots, selectPlayerEdges } from "../src/js/playerAnalysis.js";
import { fixtureDataset } from "../demos/player-c/fixtures.js";

const state = (patch = {}) => ({ selectedPlayerId: "demo-messi", selectedTeamId: null, mode: "collaboration", timeRange: [0, 125], ...patch });
const copy = value => structuredClone(value);
const event = (type, minute, extra = {}) => ({ player_id: "p", type, minute, second: 0, period: 1, ...extra });

test("unselected or unknown player has an explicit empty model", () => {
  assert.equal(analyzePlayer(fixtureDataset, state({ selectedPlayerId: null })).player, null);
  assert.equal(analyzePlayer(fixtureDataset, state({ selectedPlayerId: "missing" })).player, null);
  assert.equal(analyzePlayer({}, {}).player, null);
});

test("normal full-range statistics match independently specified fixture totals", () => {
  const model = analyzePlayer(fixtureDataset, state());
  assert.deepEqual(model.current.values, { passes: 7, successful_passes: 6, pass_accuracy: 6 / 7, shots: 3, goals: 1, assists: 1, xg: .5 });
  assert.deepEqual(model.current.values, model.full.values);
  assert.equal(model.coversFullMatch, true);
  assert.equal(model.full.sources.passes, "stats");
});

test("a time change recomputes individual metrics while retaining full-match comparisons", () => {
  const model = analyzePlayer(fixtureDataset, state({ timeRange: [0, 45] }));
  assert.deepEqual(model.current.values, { passes: 3, successful_passes: 3, pass_accuracy: 1, shots: 1, goals: 1, assists: 0, xg: .3 });
  assert.equal(model.full.values.passes, 7);
  assert.equal(model.edges.length, 3);
  assert.equal(model.coversFullMatch, false);
});

test("raw hyperedges and exact multi-player combinations are counted separately", () => {
  const model = analyzePlayer(fixtureDataset, state());
  assert.equal(model.edges.length, 5);
  assert.equal(model.combinationCount, 3);
  assert.equal(model.combinations[0].count, 3);
  assert.equal(model.combinations[0].playerIds.length, 3);
  assert.deepEqual(Object.fromEntries(model.partners.map(item => [item.playerId, item.count])), {
    "demo-alvarez": 5, "demo-dimaria": 4, "demo-depaul": 2,
  });
});

test("edge filtering uses inclusive interval intersection, not event-point containment", () => {
  for (const timeRange of [[12.1, 12.2], [12.4, 12.4], [11, 12]]) {
    assert.equal(analyzePlayer(fixtureDataset, state({ timeRange })).edges.length, 1);
  }
  const model = analyzePlayer(fixtureDataset, state({ timeRange: [12.1, 12.2] }));
  assert.equal(model.current.values.passes, 0);
  assert.equal(analyzePlayer(fixtureDataset, state({ timeRange: [12.41, 12.5] })).edges.length, 0);
});

test("competition mode uses D's edge source and distinguishes opponents from teammates", () => {
  const model = analyzePlayer(fixtureDataset, state({ mode: "competition" }));
  assert.equal(model.edges.length, 2);
  assert.equal(model.combinations[0].count, 2);
  assert.equal(model.partners.find(item => item.playerId === "demo-tchouameni").sameTeam, false);
  assert.equal(model.partners.find(item => item.playerId === "demo-depaul").sameTeam, true);
  assert.deepEqual(model.current.values, analyzePlayer(fixtureDataset, state()).current.values);
});

test("team filters include a cross-team edge if that team participates", () => {
  assert.equal(analyzePlayer(fixtureDataset, state({ mode: "competition", selectedTeamId: "demo-fra" })).edges.length, 2);
  const model = analyzePlayer(fixtureDataset, state({ selectedTeamId: "demo-fra" }));
  assert.equal(model.edges.length, 0);
  assert.equal(model.outsideTeam, true);
  assert.equal(model.current.values.passes, 7);
});

test("no edges remains distinct from missing edge data", () => {
  const empty = analyzePlayer(fixtureDataset, state({ timeRange: [70, 80] }));
  assert.equal(empty.edges.length, 0);
  assert.equal(empty.available, true);
  assert.equal(empty.current.values.shots, 1);
  const dataset = copy(fixtureDataset);
  delete dataset.collaborationEdges;
  const missing = analyzePlayer(dataset, state());
  assert.equal(missing.available, false);
  assert.equal(missing.current.values.passes, 7);
});

test("zero passes has no NaN and has an undefined rate", () => {
  const model = analyzePlayer(fixtureDataset, state({ selectedPlayerId: "demo-giroud", timeRange: [40, 45] }));
  assert.equal(model.current.values.passes, 0);
  assert.equal(model.current.values.pass_accuracy, null);
  assert.equal(model.current.values.shots, 1);
  assert.match(model.current.reasons.pass_accuracy, /分母为零/);
});

test("missing shot and pass outcomes do not become zero goals or successful passes", () => {
  const model = analyzePlayer(fixtureDataset, state({ selectedPlayerId: "demo-griezmann", timeRange: [60, 65] }));
  assert.equal(model.current.values.passes, 1);
  assert.equal(model.current.values.shots, 1);
  for (const key of ["successful_passes", "pass_accuracy", "goals", "assists", "xg"]) assert.equal(model.current.values[key], null, key);
});

test("partial xG coverage is unknown, not a misleading partial total", () => {
  const result = derivePlayerMetrics([event("Shot", 1, { outcome: "Goal", xg: .2 }), event("Shot", 2, { outcome: "Saved", xg: null })], "p");
  assert.equal(result.values.shots, 2);
  assert.equal(result.values.xg, null);
  assert.equal(result.values.goals, 1);
});

test("no shots gives zero xG only when the dataset actually supports xG", () => {
  assert.equal(derivePlayerMetrics([], "p").values.xg, null);
  assert.equal(derivePlayerMetrics([event("Shot", 1, { player_id: "other", outcome: "Saved", xg: .1 })], "p").values.xg, 0);
});

test("missing event arrays are unavailable, whereas a provided empty array gives zero counts", () => {
  const missing = derivePlayerMetrics(undefined, "p");
  assert.equal(missing.values.passes, null);
  assert.equal(missing.values.shots, null);
  assert.equal(derivePlayerMetrics([], "p").values.passes, 0);
});

test("missing assist flags preserve N/A despite a full-match assist total", () => {
  const dataset = copy(fixtureDataset);
  dataset.events.filter(item => item.player_id === "demo-messi" && item.type === "Pass").forEach(item => delete item.goal_assist);
  const model = analyzePlayer(dataset, state());
  assert.equal(model.current.values.assists, null);
  assert.equal(model.full.values.assists, 1);
});

test("explicit null from stats is retained; omitted fields can be derived", () => {
  const dataset = copy(fixtureDataset);
  dataset.stats.players["demo-messi"] = { xg: null };
  const model = analyzePlayer(dataset, state());
  assert.equal(model.full.values.xg, null);
  assert.equal(model.full.values.passes, 7);
  assert.equal(model.full.sources.passes, "events");
});

test("shootout shots are excluded from event metrics and match duration", () => {
  const dataset = copy(fixtureDataset);
  dataset.events.push(event("Shot", 140, { player_id: "demo-messi", period: 5, outcome: "Goal", xg: .8 }));
  const model = analyzePlayer(dataset, state({ timeRange: [0, 150] }));
  assert.equal(model.current.values.shots, 3);
  assert.equal(model.current.values.goals, 1);
  assert.equal(model.current.values.xg, .5);
  assert.deepEqual(getMatchTimeRange(dataset), [0, 125]);
});

test("unknown time invalidates affected window metrics but allows full-match calculation", () => {
  const events = [event("Pass", null, { outcome: "complete", goal_assist: false })];
  assert.equal(derivePlayerMetrics(events, "p", [0, 45]).values.passes, null);
  assert.equal(derivePlayerMetrics(events, "p").values.passes, 1);
  assert.equal(derivePlayerMetrics(events, "p", [0, 45]).values.shots, 0);
});

test("match time supports seconds and minute/second fallback without treating null as zero", () => {
  assert.equal(eventMinute({ time_seconds: 750 }), 12.5);
  assert.equal(eventMinute({ minute: 12, second: 30 }), 12.5);
  assert.equal(eventMinute({ minute: 12 }), 12);
  assert.equal(eventMinute({ minute: null, time_seconds: null }), null);
  assert.equal(eventMinute({ minute: 1, second: 80 }), null);
});

test("duplicate raw edge IDs and duplicate participant IDs do not inflate counts", () => {
  const dataset = copy(fixtureDataset);
  dataset.collaborationEdges.push(copy(dataset.collaborationEdges[0]));
  dataset.collaborationEdges[0].player_ids.push("demo-messi");
  const model = analyzePlayer(dataset, state());
  assert.equal(model.edges.length, 5);
  assert.equal(model.partners.find(item => item.playerId === "demo-alvarez").count, 5);
});

test("aggregates, pairwise edges, unknown players and untraceable evidence are rejected", () => {
  const dataset = copy(fixtureDataset);
  const base = dataset.collaborationEdges[0];
  dataset.collaborationEdges = [
    { ...base, edge_id: "aggregate", weight: 8 },
    { ...base, edge_id: "pair", player_ids: ["demo-messi", "demo-alvarez"] },
    { ...base, edge_id: "unknown", player_ids: ["demo-messi", "demo-alvarez", "unknown"] },
    { ...base, edge_id: "no-evidence", event_ids: [] },
    { ...base, edge_id: "missing-evidence", event_ids: ["nonexistent"] },
    { ...base, edge_id: "bad-time", end_minute: 0 },
    { ...base, edge_id: "bad-team", team_ids: ["demo-fra"] },
  ];
  const model = analyzePlayer(dataset, state());
  assert.equal(model.edges.length, 0);
  assert.equal(model.invalidCount, 7);
});

test("competition requires actual participants from two teams", () => {
  const dataset = copy(fixtureDataset);
  dataset.competitionEdges = [{ ...dataset.collaborationEdges[0], type: "competition", team_ids: ["demo-arg", "demo-fra"] }];
  assert.equal(selectPlayerEdges(dataset, state({ mode: "competition" })).edges.length, 0);
});

test("input datasets and state are never mutated", () => {
  const dataset = copy(fixtureDataset);
  const input = state({ timeRange: [45, 0] });
  const before = copy({ dataset, input });
  analyzePlayer(dataset, input);
  assert.deepEqual({ dataset, input }, before);
});

test("all fixture hyperedges retain valid event references and participant evidence", () => {
  const byId = new Map(fixtureDataset.events.map(item => [item.event_id, item]));
  for (const edge of [...fixtureDataset.collaborationEdges, ...fixtureDataset.competitionEdges]) {
    const participants = new Set();
    for (const id of edge.event_ids) {
      assert.ok(byId.has(id));
      const source = byId.get(id);
      participants.add(source.player_id);
      if (source.recipient_id) participants.add(source.recipient_id);
    }
    assert.ok(edge.player_ids.every(id => participants.has(id)));
  }
});

test("relationship summary retains unique partners, exact groups and mean cardinality", () => {
  const model = analyzePlayer(fixtureDataset, state());
  assert.equal(model.partnerCount, 3);
  assert.equal(model.combinationCount, 3);
  assert.equal(model.meanGroupSize, 3.2);
  assert.equal(analyzePlayer(fixtureDataset, state({ timeRange: [70, 80] })).meanGroupSize, null);
});

test("player comparisons use raw units and percentage points rather than a fabricated score", () => {
  const comparison = comparePlayers(fixtureDataset, state(), "demo-mbappe");
  const rows = Object.fromEntries(comparison.rows.map(row => [row.key, row]));
  assert.equal(rows.passes.primary, 7);
  assert.equal(rows.passes.secondary, 3);
  assert.equal(rows.passes.difference, 4);
  assert.ok(Math.abs(rows.pass_accuracy.difference - (-100 / 7)) < 1e-10);
  assert.equal(rows.pass_accuracy.maximum, 1);
  assert.ok(Math.abs(rows.xg.difference - .07) < 1e-10);
  assert.equal(rows.edge_count.primary, 5);
  assert.equal(rows.edge_count.secondary, 3);
});

test("comparison tracks the current time and mode, and preserves unavailable values", () => {
  const half = comparePlayers(fixtureDataset, state({ timeRange: [0, 45] }), "demo-mbappe");
  assert.equal(half.rows.find(row => row.key === "passes").difference, 2);
  assert.equal(half.rows.find(row => row.key === "pass_accuracy").difference, 0);
  const missing = comparePlayers(fixtureDataset, state(), "demo-griezmann");
  assert.equal(missing.rows.find(row => row.key === "xg").secondary, null);
  assert.equal(missing.rows.find(row => row.key === "xg").difference, null);
  assert.equal(comparePlayers(fixtureDataset, state(), "demo-messi"), null);
  assert.equal(comparePlayers(fixtureDataset, state(), "missing"), null);
  const dataset = copy(fixtureDataset);
  delete dataset.competitionEdges;
  assert.equal(comparePlayers(dataset, state({ mode: "competition" }), "demo-mbappe").rows.find(row => row.key === "edge_count").difference, null);
});

test("shot analysis uses source positions, xG, outcomes and current time range", () => {
  const all = getPlayerShots(fixtureDataset, state());
  assert.equal(all.shots.length, 3);
  assert.equal(all.locatedCount, 3);
  assert.deepEqual(all.shots[0].location, [102, 40]);
  assert.equal(all.shots[0].eventId, "demo-shot1");
  assert.equal(all.shots[0].result, "goal");
  assert.equal(getPlayerShots(fixtureDataset, state({ timeRange: [70, 80] })).shots[0].eventId, "demo-shot2");
  assert.equal(getPlayerShots(fixtureDataset, state({ selectedPlayerId: null })).shots.length, 0);
});

test("missing/invalid shot positions remain in the list instead of being invented or clamped", () => {
  const dataset = copy(fixtureDataset);
  for (const shot of dataset.events.filter(item => item.player_id === "demo-messi" && item.type === "Shot")) shot.location = [999, 20];
  const result = getPlayerShots(dataset, state());
  assert.equal(result.shots.length, 3);
  assert.equal(result.locatedCount, 0);
  assert.ok(result.shots.every(shot => shot.location === null));
  const missing = getPlayerShots(dataset, state({ selectedPlayerId: "demo-griezmann" }));
  assert.equal(missing.shots[0].result, "unknown");
  assert.equal(missing.shots[0].xg, null);
});

test("shot views exclude penalty shootouts and report unknown times", () => {
  const dataset = copy(fixtureDataset);
  dataset.events.push(event("Shot", 140, { player_id: "demo-messi", period: 5, outcome: "Goal", xg: .8, location: [100, 40] }));
  dataset.events.push(event("Shot", null, { player_id: "demo-messi", outcome: "Goal", location: [100, 40] }));
  const before = copy(dataset);
  const result = getPlayerShots(dataset, state({ timeRange: [0, 150] }));
  assert.equal(result.shots.length, 3);
  assert.equal(result.missingTimeCount, 1);
  assert.deepEqual(dataset, before);
});

test("shot chronology follows periods and source event order across clock regressions", () => {
  const dataset = copy(fixtureDataset);
  dataset.events = [
    event("Shot", 91, { event_id: "extra", player_id: "demo-messi", period: 3, event_index: 300 }),
    event("Shot", 96, { event_id: "stoppage", player_id: "demo-messi", period: 2, event_index: 200 }),
    event("Shot", 95, { event_id: "regressed", player_id: "demo-messi", period: 2, event_index: 201 }),
  ];
  assert.deepEqual(getPlayerShots(dataset, state()).shots.map(shot => shot.eventId), ["stoppage", "regressed", "extra"]);
});
