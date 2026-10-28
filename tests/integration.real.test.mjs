/** Requires locally rebuilt source data; no licensed event files are committed. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateDataset } from "../src/js/main.js";
import { analyzePlayer, comparePlayers, getMatchTimeRange, getPlayerShots } from "../src/js/playerAnalysis.js";
import { selectTimelineEdges } from "../src/js/competitionTimeline.js";

const json = async name => JSON.parse(await readFile(new URL(`../${name}`, import.meta.url), "utf8"));
const raw = await json("data/raw/events_3869685.json");
const dataset = Object.fromEntries(await Promise.all(Object.entries({ players: "players", events: "events", stats: "stats", competitionEdges: "competition_edges" })
  .map(async ([key, name]) => [key, await json(`data/processed/${name}.json`)])));
const range = getMatchTimeRange(dataset);
const state = (id, timeRange = range) => ({ selectedPlayerId: id, mode: "competition", selectedTeamId: null, timeRange });
const rawFor = (id, timeRange = range) => raw.filter(event => [1, 2, 3, 4].includes(event.period) && String(event.player?.id) === id
  && event.minute + event.second / 60 >= timeRange[0] && event.minute + event.second / 60 <= timeRange[1]);

test("real A and D outputs satisfy provenance validation while B remains unavailable", () => {
  assert.equal(validateDataset(dataset, { allowUnavailableEdges: true }), dataset);
  assert.equal(dataset.players.length, 50); assert.equal(dataset.events.length, 4407);
  assert.equal(dataset.competitionEdges.length, 385);
  assert.equal(analyzePlayer(dataset, { ...state("5503"), mode: "collaboration" }).available, false);
});

test("C star metrics independently reconcile with raw source, excluding shootouts", () => {
  for (const [id, expected] of [["5503", [60, 5, 2, 1.45528]], ["3009", [27, 6, 3, 1.782554]]]) {
    const events = rawFor(id), model = analyzePlayer(dataset, state(id));
    const passes = events.filter(event => event.type.name === "Pass");
    const shots = events.filter(event => event.type.name === "Shot");
    const values = model.current.values;
    assert.deepEqual([values.passes, values.shots, values.goals, values.xg], expected);
    assert.equal(values.passes, passes.length);
    assert.equal(values.pass_accuracy, passes.filter(event => !Object.hasOwn(event.pass, "outcome")).length / passes.length);
    assert.equal(values.goals, shots.filter(event => event.shot.outcome.name === "Goal").length);
    assert.equal(values.xg, Math.round(shots.reduce((sum, event) => sum + event.shot.statsbomb_xg, 0) * 1e6) / 1e6);
    assert.equal(values.assists, null);
    assert.equal(model.full.values.assists, events.filter(event => event.pass?.goal_assist === true).length);
    const observations = getPlayerShots(dataset, state(id));
    assert.deepEqual(observations.shots.map(shot => shot.eventId), shots.map(event => event.id));
    observations.shots.forEach((shot, index) => assert.deepEqual(shot.location, shots[index].location));
  }
});

test("real clock overlaps, exact event endpoints and unavailable outcomes remain explicit", () => {
  const time = 22 + 24 / 60;
  const exact = analyzePlayer(dataset, state("5503", [time, time]));
  assert.equal(exact.current.values.goals, 1); assert.equal(exact.current.values.shots, 1);
  assert.equal(analyzePlayer(dataset, state("5503", [0, time - 1e-7])).current.values.goals, 0);
  const narrow = analyzePlayer(dataset, state("5503", [90, 98]));
  assert.equal(narrow.current.values.passes, rawFor("5503", [90, 98]).filter(event => event.type.name === "Pass").length);
  assert.equal(analyzePlayer(dataset, state("38718")).current.values.pass_accuracy, null);
  assert.ok(analyzePlayer(dataset, state("38718")).full.values.pass_accuracy > 0);
});

test("real inferred edge evidence independently reconciles with C and D counts", () => {
  const rawById = new Map(raw.map(event => [event.id, event]));
  for (const id of ["5503", "3009"]) {
    const model = analyzePlayer(dataset, state(id));
    const edges = dataset.competitionEdges.filter(edge => edge.player_ids.includes(id));
    assert.equal(model.edges.length, edges.length);
    assert.equal(selectTimelineEdges(dataset, state(id)).length, 385);
    const partners = new Map();
    for (const edge of edges) {
      const participants = new Set();
      for (const eventId of edge.event_ids) {
        const event = rawById.get(eventId);
        assert.ok(event); assert.notEqual(event.period, 5);
        if (event.player) participants.add(String(event.player.id));
        if (event.type.name === "Pass" && event.pass.recipient) participants.add(String(event.pass.recipient.id));
      }
      assert.ok(edge.player_ids.every(player => participants.has(player)));
      for (const player of edge.player_ids) if (player !== id) partners.set(player, (partners.get(player) ?? 0) + 1);
    }
    assert.equal(model.partnerCount, partners.size);
    for (const partner of model.partners) assert.equal(partner.count, partners.get(partner.playerId));
  }
  const comparison = comparePlayers(dataset, state("5503"), "3009");
  assert.equal(comparison.rows.find(row => row.key === "goals").difference, -1);
  assert.equal(comparison.rows.find(row => row.key === "edge_count").difference, 40);
});
