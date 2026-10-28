/** Module D integration; owners A/B/C keep their own mount implementations. */
import * as store from "./state.js";
import { eventMinute, getDatasetTimeRange } from "./competitionTimeline.js";

export const DATA_FILES = Object.freeze({
  players: "players.json", events: "events.json", stats: "stats.json",
  collaborationEdges: "collaboration_edges.json", competitionEdges: "competition_edges.json",
});
export const MODULES = Object.freeze([
  { name: "A · 比赛概览", container: "data-explorer", path: "./dataExplorer.js", mount: "mountDataExplorer" },
  { name: "B · 超图主视图", container: "hypergraph", path: "./hypergraph.js", mount: "mountHypergraph" },
  { name: "C · 球星分析", container: "player-analysis", path: "./playerAnalysis.js", mount: "mountPlayerAnalysis" },
  { name: "D · 对抗与时间", container: "competition-timeline", path: "./competitionTimeline.js", mount: "mountCompetitionTimeline" },
]);
const id = value => typeof value === "string" && value.trim().length > 0;
const finite = value => typeof value === "number" && Number.isFinite(value);
const uniqueStrings = values => Array.isArray(values) && values.every(id) && new Set(values).size === values.length;
const sameSet = (left, right) => left.size === right.size && [...left].every(value => right.has(value));

/** Reject broken references before any module draws or counts them. */
export function validateDataset(dataset) {
  const errors = [];
  for (const key of ["players", "events", "collaborationEdges", "competitionEdges"]) {
    if (!Array.isArray(dataset[key])) errors.push(`${DATA_FILES[key]} 必须是 JSON 数组；缺失文件不能用空数组冒充。`);
  }
  if (!dataset.stats || typeof dataset.stats !== "object" || Array.isArray(dataset.stats)
    || !id(dataset.stats.match_id) || !Array.isArray(dataset.stats.teams)
    || !dataset.stats.players || typeof dataset.stats.players !== "object" || Array.isArray(dataset.stats.players)) {
    errors.push("stats.json 必须包含字符串 match_id、teams 数组及 players 对象。");
  }
  if (errors.length) throw new Error(errors.join("\n"));
  if (!dataset.players.length || !dataset.events.length) errors.push("球员或赛事事件为空：尚不能作为真实比赛演示；请先运行 A 的预处理。");
  const players = new Map();
  for (const player of dataset.players) {
    if (!player || !id(player.player_id) || !id(player.team_id) || players.has(player.player_id)) {
      errors.push("players.json 含缺失/重复的球员 ID 或球队 ID。"); continue;
    }
    players.set(player.player_id, player);
  }
  const events = new Map(), orderKeys = new Set();
  for (const event of dataset.events) {
    if (!event || !id(event.event_id) || events.has(event.event_id)) { errors.push("events.json 含缺失/重复的事件 ID。"); continue; }
    events.set(event.event_id, event);
    const key = `${event.period}:${event.event_index}`;
    if (![1, 2, 3, 4, 5].includes(event.period) || !Number.isInteger(event.event_index) || event.event_index < 0 || orderKeys.has(key)) errors.push(`${event.event_id} 的阶段/事件顺序无效或重复。`);
    orderKeys.add(key);
    if (!id(event.type) || eventMinute(event) === null) errors.push(`${event.event_id} 缺少事件类型或有效的整场时间。`);
    if (event.player_id != null && (!players.has(event.player_id) || players.get(event.player_id).team_id !== event.team_id)) errors.push(`${event.event_id} 的发起球员/球队无法追溯。`);
    if (event.recipient_id != null && !players.has(event.recipient_id)) errors.push(`${event.event_id} 的接球对象不在名单中。`);
  }
  for (const playerId of Object.keys(dataset.stats.players ?? {})) {
    if (!players.has(playerId)) errors.push(`stats.json 中 ${playerId} 不在球员名单中。`);
  }
  const allEdgeIds = new Set();
  for (const [key, type] of [["collaborationEdges", "collaboration"], ["competitionEdges", "competition"]]) {
    for (const edge of dataset[key]) {
      const label = `${DATA_FILES[key]} / ${edge?.edge_id ?? "未知边"}`;
      if (!edge || !id(edge.edge_id) || allEdgeIds.has(edge.edge_id) || edge.type !== type || edge.weight !== 1
        || !uniqueStrings(edge.player_ids) || edge.player_ids.length < 3 || !edge.player_ids.every(value => players.has(value))
        || !uniqueStrings(edge.team_ids) || !uniqueStrings(edge.event_ids) || !edge.event_ids.length
        || !edge.event_ids.every(value => events.has(value))
        || !finite(edge.start_minute) || !finite(edge.end_minute) || edge.start_minute < 0 || edge.end_minute < edge.start_minute
        || !id(edge.description) || edge.evidence_type !== (type === "competition" ? "event_window_inference" : "observed_event_sequence")) {
        errors.push(`${label} 不满足第 3.4 节原始超边契约。`); continue;
      }
      allEdgeIds.add(edge.edge_id);
      const teamIds = new Set(edge.player_ids.map(value => players.get(value).team_id));
      if (!sameSet(teamIds, new Set(edge.team_ids)) || (type === "competition" ? teamIds.size < 2 : teamIds.size !== 1)) errors.push(`${label} 的参与球队不一致。`);
      const sources = edge.event_ids.map(value => events.get(value));
      const participants = new Set(), actorTeams = new Set();
      for (const event of sources) {
        if (event.player_id) { participants.add(event.player_id); actorTeams.add(event.team_id); }
        if (event.type === "Pass" && event.recipient_id && players.get(event.recipient_id)?.team_id === event.team_id) participants.add(event.recipient_id);
      }
      if (!edge.player_ids.every(value => participants.has(value))) errors.push(`${label} 含来源事件未明确记录的参与者。`);
      if (sources.some(event => event.period === 5) || new Set(sources.map(event => event.period)).size !== 1) errors.push(`${label} 跨比赛阶段或包含点球大战。`);
      const times = sources.map(eventMinute);
      if (times.some(value => value === null) || Math.abs(Math.min(...times) - edge.start_minute) > 1e-7 || Math.abs(Math.max(...times) - edge.end_minute) > 1e-7) errors.push(`${label} 时间范围与来源事件不符。`);
      if (type === "competition") {
        const possessions = new Set(sources.map(event => event.possession_id));
        if (actorTeams.size < 2 || !sources.some(event => ["Pressure", "Duel", "Interception", "Dispossessed", "Ball Recovery"].includes(event.type))
          || possessions.size !== 1 || !id(sources[0].possession_id)) errors.push(`${label} 缺少双方发起事件、对抗事件或共同控球片段证据。`);
      }
    }
  }
  if (errors.length) throw new Error(errors.slice(0, 30).join("\n") + (errors.length > 30 ? `\n另有 ${errors.length - 30} 项错误。` : ""));
  return dataset;
}

export async function loadDataset({ baseUrl = new URL("../../data/processed/", import.meta.url), fetchImpl = globalThis.fetch } = {}) {
  const entries = Object.entries(DATA_FILES);
  const results = await Promise.allSettled(entries.map(async ([key, filename]) => {
    const response = await fetchImpl(new URL(filename, baseUrl), { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}；请提供 data/processed/${filename}`);
    try { return [key, await response.json()]; }
    catch { throw new Error("内容不是有效 JSON；请检查预处理输出，勿返回 HTML 错误页。"); }
  }));
  const errors = results.flatMap((result, index) => result.status === "rejected" ? [`${entries[index][1]}：${result.reason.message}`] : []);
  if (errors.length) throw new Error(errors.join("\n"));
  return validateDataset(Object.fromEntries(results.map(result => result.value)));
}

/** Import failures remain local; missing B never causes a parallel renderer. */
export async function mountModules(document, activeStore, dataset, importModule = path => import(path)) {
  const results = await Promise.allSettled(MODULES.map(spec => importModule(spec.path)));
  const handles = [], errors = [];
  for (const [index, result] of results.entries()) {
    const spec = MODULES[index], container = document.getElementById(spec.container);
    try {
      if (!container) throw new Error(`缺少容器 #${spec.container}`);
      if (result.status === "rejected") throw new Error(`${spec.path} 未就绪或其依赖加载失败：${result.reason.message}`);
      if (typeof result.value[spec.mount] !== "function") throw new Error(`未导出 ${spec.mount}(container, store, dataset)`);
      container.replaceChildren();
      const handle = await result.value[spec.mount](container, activeStore, dataset);
      handles.push(handle);
    } catch (error) {
      errors.push(`${spec.name}：${error.message}`);
      if (container) { const message = document.createElement("p"); message.className = "app-module-error"; message.textContent = `${spec.name} 尚未挂载。${error.message}`; container.replaceChildren(message); }
    }
  }
  return { errors, destroy() {
    for (const handle of handles) {
      try { if (typeof handle === "function") handle(); else handle?.destroy?.(); }
      catch (error) { console.error("模块清理失败：", error); }
    }
    handles.length = 0;
  } };
}

export async function startApp(document = globalThis.document) {
  const status = document.getElementById("app-status");
  const errors = document.getElementById("app-errors");
  status.textContent = "正在读取五份比赛数据…";
  let mounted;
  try {
    const dataset = await loadDataset();
    store.setState({ selectedMatchId: dataset.stats.match_id, selectedPlayerId: null, selectedTeamId: null, mode: "collaboration", timeRange: getDatasetTimeRange(dataset) });
    document.getElementById("match-label").textContent = `比赛 ${dataset.stats.match_id} · ${[...new Set(dataset.players.map(player => player.team_name || player.team_id))].join(" / ")}`;
    mounted = await mountModules(document, store, dataset);
    errors.hidden = mounted.errors.length === 0;
    errors.textContent = mounted.errors.join("\n");
    status.textContent = mounted.errors.length ? "数据已校验；部分模块尚未交付，请查看各区域提示。"
      : `已载入 ${dataset.events.length} 条赛事事件；协作 ${dataset.collaborationEdges.length} 条，对抗 ${dataset.competitionEdges.length} 条。`;
  } catch (error) {
    status.textContent = "未能启动真实比赛视图。";
    errors.hidden = false;
    errors.textContent = `${error.message}\n请按 docs/INTEGRATION_D.md 交付 A/B 数据，并从项目根目录通过 HTTP 打开 /src/。空对抗数组允许加载；缺少文件是另一种状态。`;
    for (const spec of MODULES) document.getElementById(spec.container).textContent = "等待五份有效 JSON；未填入模拟比赛数据。";
  }
  return { destroy() { mounted?.destroy(); } };
}

if (typeof document !== "undefined" && document.getElementById("football-app")) {
  startApp().then(app => globalThis.addEventListener("pagehide", () => app.destroy(), { once: true }));
}
