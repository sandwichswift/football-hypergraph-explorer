/** SYNTHETIC TEST DATA ONLY. No real match IDs, observations, or statistics. */
export const fixtureDataset = {
  players: [
    { player_id: "mock-a", player_name: "Mock Alpha", team_id: "mock-home", team_name: "Mock Home", position: null, shirt_number: null },
    { player_id: "mock-b", player_name: "Mock Beta", team_id: "mock-home", team_name: "Mock Home", position: null, shirt_number: null },
    { player_id: "mock-c", player_name: "Mock Gamma", team_id: "mock-home", team_name: "Mock Home", position: null, shirt_number: null },
    { player_id: "mock-x", player_name: "Mock Opponent", team_id: "mock-away", team_name: "Mock Away", position: null, shirt_number: null },
  ],
  events: [
    { event_id: "mock-e1", event_index: 1, period: 1, time_seconds: 10, team_id: "mock-home", player_id: "mock-a", type: "Pass", possession_id: "mock-pos1", recipient_id: "mock-b", outcome: "complete" },
    { event_id: "mock-e2", event_index: 2, period: 1, time_seconds: 12, team_id: "mock-home", player_id: "mock-b", type: "Pass", possession_id: "mock-pos1", recipient_id: "mock-c", outcome: "complete" },
    { event_id: "mock-e3", event_index: 3, period: 1, time_seconds: 60, team_id: "mock-home", player_id: "mock-a", type: "Pass", possession_id: "mock-pos2", recipient_id: "mock-b", outcome: "complete" },
    { event_id: "mock-e4", event_index: 4, period: 1, time_seconds: 61, team_id: "mock-away", player_id: "mock-x", type: "Pressure", possession_id: "mock-pos2", recipient_id: null },
    { event_id: "mock-e5", event_index: 5, period: 1, time_seconds: 62, team_id: "mock-home", player_id: "mock-b", type: "Duel", possession_id: "mock-pos2", recipient_id: null },
    { event_id: "mock-e6", event_index: 6, period: 4, time_seconds: 7500, team_id: "mock-home", player_id: "mock-b", type: "Shot", possession_id: "mock-pos3", recipient_id: null, outcome: "Saved", xg: null },
  ],
  stats: { match_id: "MOCK-INTEGRATION-ONLY", teams: [], players: {} },
  collaborationEdges: [{ edge_id: "mock-collab", type: "collaboration", player_ids: ["mock-a", "mock-b", "mock-c"], team_ids: ["mock-home"], start_minute: 10 / 60, end_minute: 12 / 60, event_ids: ["mock-e1", "mock-e2"], weight: 1, evidence_type: "observed_event_sequence", description: "Synthetic same-team test segment" }],
  competitionEdges: [{ edge_id: "mock-competition", type: "competition", player_ids: ["mock-a", "mock-b", "mock-x"], team_ids: ["mock-home", "mock-away"], start_minute: 1, end_minute: 62 / 60, event_ids: ["mock-e3", "mock-e4", "mock-e5"], weight: 1, evidence_type: "event_window_inference", description: "Synthetic event-window test segment; not match truth" }],
};
