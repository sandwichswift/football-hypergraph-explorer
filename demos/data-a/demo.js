import { mountDataExplorer, getDataTimeRange } from "../../src/js/dataExplorer.js";
import { mountPlayerAnalysis } from "../../src/js/playerAnalysis.js";

/** Test harness only; D owns the production state.js implementation. */
function createDemoStore(initial) {
  let state = { ...initial, timeRange: [...initial.timeRange] };
  const listeners = new Set();
  return {
    getState: () => ({ ...state, timeRange: [...state.timeRange] }),
    setState(patch) {
      state = { ...state, ...patch };
      for (const listener of [...listeners]) listener(this.getState());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

async function loadJson(name) {
  const response = await fetch(`../../data/processed/${name}.json`);
  if (!response.ok) throw new Error(`${name}.json：HTTP ${response.status}`);
  return response.json();
}

const host = document.getElementById("data-panel");
const theme = new URLSearchParams(location.search).get("theme") === "light" ? "light" : "dark";
document.body.dataset.theme = theme;
for (const link of document.querySelectorAll(".da-switch a")) {
  if (link.dataset.theme === theme) link.setAttribute("aria-current", "page");
}

try {
  const [players, events, stats] = await Promise.all(["players", "events", "stats"].map(loadJson));
  if (!Array.isArray(players) || !Array.isArray(events) || !stats || Array.isArray(stats)) {
    throw new Error("比赛数据不符合 players[] / events[] / stats{} 约定。");
  }
  // Hyperedges are intentionally absent: C can tell "not loaded" apart from "observed zero".
  const dataset = { players, events, stats };
  const range = getDataTimeRange(dataset);
  const store = createDemoStore({
    selectedMatchId: stats.match_id || null,
    selectedTeamId: null,
    selectedPlayerId: null,
    mode: "collaboration",
    timeRange: range,
  });
  host.replaceChildren();
  const mounted = mountDataExplorer(host, store, dataset, { theme });
  const playerMounted = mountPlayerAnalysis(document.getElementById("player-panel"), store, dataset);

  const start = document.getElementById("demo-start");
  const end = document.getElementById("demo-end");
  const error = document.getElementById("demo-time-error");
  const sync = () => {
    const [lower, upper] = store.getState().timeRange;
    start.value = String(Number(lower.toFixed(2)));
    end.value = String(Number(upper.toFixed(2)));
    error.hidden = true;
  };
  store.subscribe(sync);
  sync();

  document.getElementById("demo-apply").addEventListener("click", () => {
    const lower = start.valueAsNumber;
    const upper = end.valueAsNumber;
    if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower < 0 || upper < lower) {
      error.textContent = "请输入有效分钟数，且结束分钟不能早于起始分钟。";
      error.hidden = false;
      return;
    }
    store.setState({ timeRange: [lower, upper] });
  });
  document.getElementById("demo-all").addEventListener("click", () => store.setState({ timeRange: range }));
  document
    .getElementById("demo-first")
    .addEventListener("click", () => store.setState({ timeRange: [0, 30] }));
  // Opening the C panel when a player is chosen keeps the cross-module link visible.
  store.subscribe((state) => {
    if (state.selectedPlayerId) document.querySelector(".da-c-integration").open = true;
  });

  // Exposed only on this local demo for repeatable acceptance checks.
  window.dataADemo = { store, dataset, mounted, playerMounted, mountDataExplorer };
} catch (error) {
  host.replaceChildren();
  const message = document.createElement("p");
  message.setAttribute("role", "alert");
  message.textContent = `数据载入失败：${error.message}。请先按 README 运行 A 的数据脚本，再从项目根目录启动 HTTP 服务。`;
  host.append(message);
}
