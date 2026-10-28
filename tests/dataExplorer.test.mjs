import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  exploreMatch,
  eventMinute,
  getDataTimeRange,
  matchClockLabel,
  matchStory,
  periodSpans,
  resolveTimeBrush,
  shortPlayerName,
  shotRadius,
  xgTimeline,
} from "../src/js/dataExplorer.js";

// Real match regressions keep expected values tied to the original source files.
const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const realEvents = readJson("../data/processed/events.json");
const realPlayers = readJson("../data/processed/players.json");
const rawEvents = readJson("../data/raw/events_3869685.json");
const rawLineups = readJson("../data/raw/lineups_3869685.json");

// Explicitly synthetic fixtures, used only to isolate model boundaries.
const players = [
  { player_id: "a", player_name: "Player A", team_id: "home", team_name: "Home" },
  { player_id: "b", player_name: "Player B", team_id: "home", team_name: "Home" },
  { player_id: "c", player_name: "Player C", team_id: "away", team_name: "Away" },
];

const event = (event_id, type, minute, player_id, team_id, extra = {}) => ({
  event_id,
  type,
  minute,
  second: 0,
  time_seconds: minute * 60,
  event_index: Number(event_id),
  period: 1,
  player_id,
  team_id,
  outcome: null,
  recipient_id: null,
  xg: null,
  ...extra,
});

const events = [
  event("1", "Pass", 10, "a", "home", { recipient_id: "b", outcome: "complete" }),
  event("2", "Pass", 11, "b", "home", { outcome: "incomplete" }),
  event("3", "Shot", 12, "c", "away", { xg: 0.25, outcome: "goal", location: [110, 40] }),
  event("4", "Shot", 120, "c", "away", { period: 5, xg: 0.78, outcome: "goal" }),
];

const dataset = {
  players,
  events,
  stats: {
    match_id: "synthetic",
    teams: [
      { team_id: "home", team_name: "Home", score: 0, shootout_score: 0 },
      { team_id: "away", team_name: "Away", score: 1, shootout_score: 1 },
    ],
    players: {},
  },
};

test("full match excludes shootout and computes denominator from completed and failed passes", () => {
  const model = exploreMatch(dataset);
  assert.equal(model.metrics.events, 3);
  assert.equal(model.metrics.passes, 2);
  assert.equal(model.metrics.passAccuracy, 0.5);
  assert.equal(model.metrics.shots, 1);
  assert.equal(model.metrics.xg, 0.25);
  assert.equal(model.shootoutEvents, 1);
  assert.deepEqual(getDataTimeRange(dataset), [0, 12]);
});

test("team and event type filters change counts while distribution remains context-wide", () => {
  const home = exploreMatch(dataset, { selectedTeamId: "home" });
  assert.equal(home.metrics.events, 2);
  assert.equal(home.roster.length, 2);

  const shots = exploreMatch(dataset, {}, { eventType: "Shot" });
  assert.equal(shots.metrics.events, 1);
  assert.equal(shots.distribution.find((row) => row.type === "Pass").count, 2);
  assert.equal(shots.metrics.passAccuracy, null);
});

test("inclusive time endpoints and numeric period filter preserve original order", () => {
  const extended = {
    ...dataset,
    events: [...events, event("5", "Pass", 10, "a", "home", { period: 2, outcome: "complete" })],
  };
  const ids = (model) => model.events.map((row) => row.event_id);
  assert.deepEqual(ids(exploreMatch(extended, { timeRange: [10, 10] })), ["1", "5"]);
  assert.deepEqual(ids(exploreMatch(extended, { timeRange: [10, 10] }, { period: "2" })), ["5"]);
});

test("empty and missing data remain safe and distinct", () => {
  assert.equal(exploreMatch({}).sourceAvailable, false);
  assert.equal(exploreMatch({ events: [] }).sourceAvailable, true);
  const empty = exploreMatch({ events: [], players: [] });
  assert.equal(empty.metrics.passAccuracy, null);
  assert.equal(empty.metrics.xg, null);
  assert.deepEqual(empty.events, []);
  assert.deepEqual(empty.goals, []);
  assert.deepEqual(empty.shots, []);
  assert.doesNotMatch(JSON.stringify(empty), /NaN/);
});

test("missing pass outcomes and partial shot xG never produce a complete statistic", () => {
  const model = exploreMatch({
    players,
    events: [
      event("1", "Pass", 10, "a", "home"),
      event("2", "Shot", 11, "a", "home", { xg: 0.3 }),
      event("3", "Shot", 12, "a", "home"),
    ],
  });
  assert.equal(model.metrics.passAccuracy, null);
  assert.equal(model.metrics.successfulPasses, null);
  assert.equal(model.metrics.xg, null);
});

test("players participating as sender and recipient in one event count only once", () => {
  const model = exploreMatch({
    players,
    events: [event("1", "Pass", 10, "a", "home", { recipient_id: "a", outcome: "complete" })],
  });
  assert.equal(model.roster.find((player) => player.player_id === "a").involvement, 1);
});

test("unknown times are excluded explicitly and null/invalid numeric clocks stay unavailable", () => {
  const model = exploreMatch({
    players,
    events: [event("1", "Pass", 10, "a", "home", { minute: null, second: null, time_seconds: null })],
  });
  assert.equal(model.missingTimes, 1);
  assert.equal(model.metrics.events, 0);
  assert.equal(eventMinute({ minute: 10, second: 60 }), null);
  assert.equal(eventMinute({ time_seconds: NaN }), null);
});

test("explicit unknown pass outcomes remain in denominator with visible unknown count", () => {
  const model = exploreMatch({
    players,
    events: [
      event("1", "Pass", 10, "a", "home", { outcome: "complete" }),
      event("2", "Pass", 11, "a", "home", { outcome: "unknown" }),
    ],
  });
  assert.equal(model.metrics.passAccuracy, 0.5);
  assert.equal(model.metrics.successfulPasses, 1);
  assert.equal(model.metrics.unknownPasses, 1);
});

test("blank pass results stay unavailable and intended recipients are not counted as successful receptions", () => {
  const model = exploreMatch({
    players,
    events: [event("1", "Pass", 10, "a", "home", { recipient_id: "b", outcome: "out" })],
  });
  assert.equal(
    model.roster.find((player) => player.player_id === "b").involvement,
    1,
    "roster records referenced participation, including intended recipients",
  );
  assert.equal(model.metrics.successfulPasses, 0);
  for (const outcome of [null, "", "  "]) {
    const missing = exploreMatch({ players, events: [event("2", "Pass", 11, "a", "home", { outcome })] });
    assert.equal(missing.metrics.successfulPasses, null);
    assert.equal(missing.metrics.passAccuracy, null);
  }
});

test("broadcast minute labels add one minute and show stoppage time as 45+N", () => {
  assert.equal(matchClockLabel({ period: 1, minute: 22, second: 24 }), "23′");
  assert.equal(matchClockLabel({ period: 1, minute: 44, second: 59 }), "45′");
  assert.equal(matchClockLabel({ period: 1, minute: 46, second: 10 }), "45+2′");
  assert.equal(matchClockLabel({ period: 2, minute: 45, second: 0 }), "46′");
  assert.equal(matchClockLabel({ period: 4, minute: 117, second: 5 }), "118′");
  assert.equal(matchClockLabel({ period: 1, minute: null }), "?");
});

test("period spans keep overlapping clock minutes in separate panels", () => {
  const spans = periodSpans([
    event("1", "Pass", 0, "a", "home"),
    event("2", "Pass", 50, "a", "home"),
    event("3", "Pass", 45, "a", "home", { period: 2 }),
    event("4", "Pass", 93, "a", "home", { period: 2 }),
    event("5", "Shot", 121, "c", "away", { period: 5 }),
  ]);
  assert.deepEqual(
    spans.map(({ period, start, end }) => [period, start, end]),
    [
      [1, 0, 50],
      [2, 45, 93],
    ],
  );
});

test("brush endpoints must belong to one regular period, in either drag direction", () => {
  for (const [from, to] of [[1, 2], [2, 1], [3, 4], [4, 3]]) {
    assert.deepEqual(resolveTimeBrush({ period: from, minute: 48 }, { period: to, minute: 49 }), {
      accepted: false,
      reason: "cross-period",
    });
  }
  for (const [start, end] of [[46.126, 49.234], [49.234, 46.126]]) {
    assert.deepEqual(resolveTimeBrush({ period: 1, minute: start }, { period: 1, minute: end }), {
      accepted: true,
      period: 1,
      timeRange: [46.13, 49.23],
    });
  }
  for (const invalid of [null, { period: 5, minute: 121 }, { period: 1, minute: NaN }, { period: 1, minute: -1 }]) {
    assert.deepEqual(resolveTimeBrush(invalid, { period: 1, minute: 49 }), { accepted: false, reason: "invalid" });
  }
});

test("same-period brushing isolates first-half stoppage and second-half clock overlap", () => {
  for (const period of [1, 2]) {
    const selection = resolveTimeBrush({ period, minute: 49 }, { period, minute: 46 });
    const model = exploreMatch({ events: realEvents, players: realPlayers }, { timeRange: selection.timeRange }, { period: selection.period });
    const source = rawEvents.filter((item) => item.period === period && item.minute + item.second / 60 >= 46 && item.minute + item.second / 60 <= 49);
    assert.deepEqual(model.events.map((item) => item.event_id), source.map((item) => item.id));
    const allClockMatches = exploreMatch({ events: realEvents }, { timeRange: selection.timeRange });
    assert.ok(allClockMatches.events.length > model.events.length, "shared clock range alone would include another phase");
  }
});

test("Disasi has no associated event but the source confirms he appeared as a substitute", () => {
  const disasi = exploreMatch({ players: realPlayers, events: realEvents }).roster.find((player) => player.player_id === "7439");
  assert.equal(disasi.hasRecordedEvents, false);
  assert.equal("played" in disasi, false, "event participation must not masquerade as appearance status");
  assert.equal(disasi.involvement, 0);
  const substitution = rawEvents.find((item) => item.substitution?.replacement?.id === 7439);
  assert.equal(substitution.id, "838765c8-45c7-4379-857c-f103770acbfc");
  assert.equal(substitution.index, 4273);
  assert.equal(substitution.period, 4);
  const lineup = rawLineups.flatMap((team) => team.lineup).find((player) => player.player_id === 7439);
  assert.equal(lineup.positions[0].from, "120:35");
  assert.match(lineup.positions[0].start_reason, /Substitution - On/);
  const messi = exploreMatch({ players: realPlayers, events: realEvents }).roster.find((player) => player.player_id === "5503");
  assert.equal(messi.hasRecordedEvents, true);
});

test("actual low-xG shots retain their source area ratio without a minimum radius", () => {
  const small = rawEvents.find((item) => item.index === 979).shot.statsbomb_xg;
  const larger = rawEvents.find((item) => item.index === 2204).shot.statsbomb_xg;
  assert.equal(small, 0.010577817);
  assert.equal(larger, 0.05953379);
  assert.ok(shotRadius(small) < shotRadius(larger));
  assert.ok(shotRadius(larger) < 0.9, "both formerly hit the same radius floor");
  const areaRatio = shotRadius(larger) ** 2 / shotRadius(small) ** 2;
  assert.ok(Math.abs(areaRatio - larger / small) < 1e-12);
  for (const item of rawEvents.filter((item) => item.period < 5 && item.type.name === "Shot")) {
    const xg = item.shot.statsbomb_xg;
    assert.ok(Math.abs(shotRadius(xg) ** 2 - 3.6 ** 2 * xg) < 1e-12);
  }
});

test("zero and missing xG do not receive invented positive circle area", () => {
  assert.equal(shotRadius(0), 0);
  assert.equal(shotRadius(1), 3.6);
  for (const value of [null, undefined, "0.1", NaN, Infinity, -0.1, 1.1]) {
    assert.equal(shotRadius(value), null);
  }
});

test("cumulative xG is drawn only when every regular-period shot has source xG", () => {
  const timeline = xgTimeline(events, ["home", "away"]);
  assert.equal(timeline.complete, true);
  assert.equal(timeline.teams.find((team) => team.team_id === "away").total, 0.25);
  assert.equal(timeline.teams.find((team) => team.team_id === "home").total, 0);
  assert.equal(timeline.maxXg, 0.25, "shootout xG is excluded");

  const partial = xgTimeline([...events, event("6", "Shot", 30, "a", "home")], ["home", "away"]);
  assert.equal(partial.complete, false);
  assert.equal(partial.teams[0].total, null);
  assert.equal(xgTimeline([], ["home"]).complete, false);
});

test("goals, shootout kicks, shot map and team comparison come from events only", () => {
  const model = exploreMatch(dataset);
  assert.deepEqual(
    model.goals.map((goal) => [goal.team_id, goal.player_name, goal.label]),
    [["away", "Player C", "13′"]],
  );
  assert.deepEqual(
    model.shootout.map((team) => [team.team_id, team.kicks.map((kick) => kick.scored)]),
    [
      ["home", []],
      ["away", [true]],
    ],
  );
  assert.deepEqual(
    model.shots.map((shot) => shot.event_id),
    ["3"],
    "shootout kicks are not plotted",
  );

  const shots = model.comparison.find((row) => row.key === "shots");
  assert.deepEqual(shots.values, { home: 0, away: 1 });
  const accuracy = model.comparison.find((row) => row.key === "pass_accuracy");
  assert.deepEqual(accuracy.values, { home: 0.5, away: null });

  // The comparison ignores the team filter so both sides stay visible.
  const filtered = exploreMatch(dataset, { selectedTeamId: "home" });
  assert.deepEqual(filtered.comparison.find((row) => row.key === "passes").values, { home: 2, away: 0 });
  assert.deepEqual(filtered.shots, []);
});

test("the headline is derived from the goal sequence and the score fields", () => {
  const teams = (homeScore, awayScore, homePens = null, awayPens = null) => [
    { team_id: "h", team_name: "Argentina", slot: 0, score: homeScore, shootout_score: homePens },
    { team_id: "a", team_name: "France", slot: 1, score: awayScore, shootout_score: awayPens },
  ];
  const goals = (...sides) => sides.map((team_id) => ({ team_id }));

  assert.equal(
    matchStory({ teams: teams(3, 3, 4, 2), goals: goals("h", "h", "a", "a", "h", "a") }),
    "阿根廷两度领先，两度被法国扳平，点球大战 4–2 胜出",
  );
  assert.equal(
    matchStory({ teams: teams(1, 1, 3, 5), goals: goals("h", "a") }),
    "法国一度扳平比分，点球大战 5–3 胜出",
  );
  assert.equal(matchStory({ teams: teams(2, 1), goals: goals("h", "a", "h") }), "阿根廷 2–1 战胜法国");
  assert.equal(matchStory({ teams: teams(0, 0), goals: [] }), "阿根廷 0–0 战平法国");
  assert.equal(matchStory({ teams: [], goals: [] }), "");
});

test("short names are display aliases with the full source name as fallback", () => {
  assert.equal(shortPlayerName("5503", "Lionel Andrés Messi Cuccittini"), "梅西");
  assert.equal(shortPlayerName("999999", "Someone Else"), "Someone Else");
  assert.equal(shortPlayerName(null, null), "姓名未提供");
});
