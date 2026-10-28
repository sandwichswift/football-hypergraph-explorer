/** SYNTHETIC development fixtures. Names are illustrative; NO match truth. */
export const fixtureNotice = "模拟数据 · 仅用于 C 模块开发与联调，不代表真实比赛统计";
const people = [
  ["messi", "Lionel Messi", "arg", "Argentina", "Forward", 10],
  ["dimaria", "Ángel Di María", "arg", "Argentina", "Winger", 11],
  ["alvarez", "Julián Álvarez", "arg", "Argentina", "Forward", 9],
  ["depaul", "Rodrigo De Paul", "arg", "Argentina", "Midfielder", 7],
  ["dybala", "Paulo Dybala", "arg", "Argentina", "Forward", 21],
  ["mbappe", "Kylian Mbappé", "fra", "France", "Forward", 10],
  ["griezmann", "Antoine Griezmann", "fra", "France", "Midfielder", 7],
  ["giroud", "Olivier Giroud", "fra", "France", "Forward", 9],
  ["tchouameni", "Aurélien Tchouaméni", "fra", "France", "Midfielder", 8],
];
const players = people.map(([id, player_name, team, team_name, position, shirt_number]) => ({
  player_id: `demo-${id}`, player_name, team_id: `demo-${team}`, team_name, position, shirt_number,
}));
const byId = new Map(players.map(player => [player.player_id, player]));
const events = [];
function event(id, player, minute, type = "Pass", extra = {}) {
  const player_id = `demo-${player}`;
  const base = {
    event_id: id, event_index: events.length + 1, period: minute < 45 ? 1 : minute < 90 ? 2 : minute < 105 ? 3 : 4,
    minute: Math.floor(minute), second: Math.round((minute % 1) * 60), time_seconds: Math.round(minute * 60),
    team_id: byId.get(player_id).team_id, player_id, type, possession_id: `demo-pos-${Math.floor(minute)}`,
    recipient_id: null, outcome: type === "Pass" ? "complete" : null, location: null, related_event_ids: [], xg: null,
    ...(type === "Pass" ? { goal_assist: false } : {}), ...extra,
  };
  events.push(base);
  return id;
}
const collab = [];
function sequence(id, members, start) {
  const event_ids = [];
  for (let i = 0; i < members.length; i++) {
    event_ids.push(event(`${id}-ev${i + 1}`, members[i], start + i * .2, "Pass", { recipient_id: `demo-${members[(i + 1) % members.length]}` }));
  }
  collab.push({
    edge_id: id, type: "collaboration", player_ids: members.map(member => `demo-${member}`),
    team_ids: [byId.get(`demo-${members[0]}`).team_id], start_minute: start, end_minute: start + (members.length - 1) * .2,
    event_ids, weight: 1, evidence_type: "observed_event_sequence", description: "Synthetic bounded passing sequence",
  });
}
sequence("demo-c1", ["messi", "dimaria", "alvarez"], 12);
sequence("demo-c2", ["messi", "dimaria", "alvarez"], 25);
sequence("demo-c3", ["messi", "depaul", "alvarez"], 34);
sequence("demo-c4", ["messi", "dimaria", "alvarez"], 54);
sequence("demo-c5", ["messi", "depaul", "dimaria", "alvarez"], 103);
sequence("demo-c6", ["mbappe", "tchouameni", "giroud"], 18);
sequence("demo-c7", ["mbappe", "tchouameni", "griezmann"], 58);
sequence("demo-c8", ["mbappe", "tchouameni", "giroud"], 82);
event("demo-shot1", "messi", 23, "Shot", { outcome: "Goal", xg: .3, location: [102, 40] });
event("demo-shot2", "messi", 74, "Shot", { outcome: "Saved", xg: .12, location: [94, 27] });
event("demo-pass-incomplete", "messi", 76, "Pass", { outcome: "incomplete", recipient_id: "demo-dimaria" });
event("demo-shot3", "messi", 109, "Shot", { outcome: "Blocked", xg: .08, location: [106, 52] });
event("demo-assist", "messi", 111, "Pass", { goal_assist: true, recipient_id: "demo-alvarez" });
event("demo-shot4", "alvarez", 111.2, "Shot", { outcome: "Goal", xg: .22, location: [108, 37] });
event("demo-shot5", "mbappe", 81, "Shot", { outcome: "Goal", xg: .25, location: [103, 44] });
event("demo-shot6", "mbappe", 118, "Shot", { outcome: "Saved", xg: .18, location: [97, 29] });
event("demo-shot7", "giroud", 42, "Shot", { outcome: "Off T", xg: .07, location: [92, 50] });
event("demo-shot-missing", "griezmann", 61, "Shot", { outcome: null, xg: null });
event("demo-pass-missing", "griezmann", 62, "Pass", { outcome: null, goal_assist: undefined });
const competitionEdges = [];
for (const [id, members, minute] of [
  ["demo-k1", ["messi", "depaul", "tchouameni"], 35],
  ["demo-k2", ["messi", "depaul", "tchouameni"], 65],
  ["demo-k3", ["mbappe", "griezmann", "depaul"], 85],
]) {
  const event_ids = members.map((player, i) => event(`${id}-ev${i + 1}`, player, minute + i * .1, i === 0 ? "Carry" : "Pressure"));
  competitionEdges.push({
    edge_id: id, type: "competition", player_ids: members.map(member => `demo-${member}`), team_ids: ["demo-arg", "demo-fra"],
    start_minute: minute, end_minute: minute + .2, event_ids, weight: 1,
    evidence_type: "event_window_inference", description: "Synthetic event-window inference; not tracking data",
  });
}
event("demo-end", "depaul", 125, "Pressure");
events.sort((a, b) => a.time_seconds - b.time_seconds);
events.forEach((record, index) => { record.event_index = index + 1; });

// Independently specified fixture expectations, not numbers for the actual final.
const stats = {
  match_id: "synthetic-player-c", teams: [], players: {
    "demo-messi": { passes: 7, successful_passes: 6, pass_accuracy: 6 / 7, shots: 3, goals: 1, assists: 1, xg: .5 },
    "demo-mbappe": { passes: 3, successful_passes: 3, pass_accuracy: 1, shots: 2, goals: 1, assists: 0, xg: .43 },
    "demo-griezmann": { passes: 2, successful_passes: null, pass_accuracy: null, shots: 1, goals: null, assists: null, xg: null },
  },
};
export const fixtureDataset = { players, events, stats, collaborationEdges: collab, competitionEdges };
