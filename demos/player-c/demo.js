import { mountPlayerAnalysis } from "../../src/js/playerAnalysis.js";
import { fixtureDataset, fixtureNotice } from "./fixtures.js";

// Demo-only adapter for D's three required methods, never imported by src/.
function createDemoStore(initial) {
  let state = { ...initial, timeRange: [...initial.timeRange] };
  const listeners = new Set();
  return {
    getState: () => ({ ...state, timeRange: [...state.timeRange] }),
    setState(patch) {
      state = { ...state, ...patch };
      for (const listener of [...listeners]) listener(this.getState());
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}
const store = createDemoStore({
  selectedMatchId: "synthetic-player-c", selectedTeamId: null, selectedPlayerId: "demo-messi",
  mode: "collaboration", timeRange: [0, 125],
});
document.querySelector(".lab-data-notice").textContent = fixtureNotice;
const host = document.getElementById("player-panel");
const mounted = mountPlayerAnalysis(host, store, fixtureDataset);
const mode = document.getElementById("demo-mode");
const team = document.getElementById("demo-team");
const start = document.getElementById("demo-start");
const end = document.getElementById("demo-end");
const cases = document.getElementById("demo-case");
mode.addEventListener("change", () => store.setState({ mode: mode.value }));
team.addEventListener("change", () => store.setState({ selectedTeamId: team.value || null }));
start.addEventListener("input", () => store.setState({ timeRange: [Number(start.value), Math.max(Number(start.value), Number(end.value))] }));
end.addEventListener("input", () => store.setState({ timeRange: [Math.min(Number(start.value), Number(end.value)), Number(end.value)] }));
document.querySelectorAll("[data-range]").forEach(button => button.addEventListener("click", () => store.setState({ timeRange: button.dataset.range.split(",").map(Number) })));
const scenarios = {
  normal: { selectedPlayerId: "demo-messi", timeRange: [0, 125] },
  "no-edges": { selectedPlayerId: "demo-messi", timeRange: [70, 80] },
  "no-passes": { selectedPlayerId: "demo-giroud", timeRange: [40, 45] },
  missing: { selectedPlayerId: "demo-griezmann", timeRange: [60, 65] },
  "no-events": { selectedPlayerId: "demo-dybala", timeRange: [0, 125] },
  unselected: { selectedPlayerId: null, timeRange: [0, 125] },
};
cases.addEventListener("change", () => store.setState({ ...scenarios[cases.value], mode: "collaboration", selectedTeamId: null }));
function syncControls() {
  const state = store.getState();
  mode.value = state.mode;
  team.value = state.selectedTeamId || "";
  [start.value, end.value] = state.timeRange.map(String);
  document.getElementById("demo-start-value").textContent = `${state.timeRange[0]}′`;
  document.getElementById("demo-end-value").textContent = `${state.timeRange[1]}′`;
  for (const button of document.querySelectorAll("[data-range]")) button.setAttribute("aria-pressed", String(button.dataset.range === state.timeRange.join(",")));
  const player = fixtureDataset.players.find(candidate => candidate.player_id === state.selectedPlayerId);
  document.getElementById("demo-signal").textContent = player ? `${player.player_name} · ${state.mode === "collaboration" ? "同队协作" : "跨队对抗"} · ${state.timeRange[0]}–${state.timeRange[1]}′` : "未选球员";
  document.getElementById("demo-edge-signal").textContent = "尚未选择多人组合";
  const scenario = Object.entries(scenarios).find(([, item]) => item.selectedPlayerId === state.selectedPlayerId && item.timeRange.join(",") === state.timeRange.join(","));
  cases.value = scenario?.[0] || "";
}
store.subscribe(syncControls);
host.addEventListener("playeranalysis:select-edges", event => {
  document.getElementById("demo-edge-signal").textContent = event.detail.edgeIds.length
    ? `已发出选择请求：${event.detail.edgeIds.join("、")}。等待 B/D 接入高亮。`
    : "已清除组合选择";
});
syncControls();
// Exposed only on the local harness for reproducible browser integration tests.
window.playerCDemo = { store, dataset: fixtureDataset, mounted, mountPlayerAnalysis };
