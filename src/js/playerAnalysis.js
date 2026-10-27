/**
 * Module C. No global store, chart dependency, or writes to another module's DOM.
 * Required API: mountPlayerAnalysis(container, store, dataset).
 * Statistics use normalized events; ambiguous/missing observations stay unknown.
 */
const METRICS = [
  ["passes", "传球", "次"],
  ["pass_accuracy", "传球成功率", ""],
  ["shots", "射门", "次"],
  ["goals", "进球", "个"],
  ["assists", "助攻", "次"],
  ["xg", "预期进球 xG", ""],
];
const KEYS = ["passes", "successful_passes", "pass_accuracy", "shots", "goals", "assists", "xg"];
const PASS_FAILURES = new Set(["incomplete", "failed", "out", "offside", "pass offside", "injury clearance"]);
const SHOT_NON_GOALS = new Set(["saved", "blocked", "off t", "off target", "post", "wayward", "saved off target", "saved to post"]);
const STYLE_URL = new URL("../css/playerAnalysis.css", import.meta.url).href;
let mountSequence = 0;

const finite = value => typeof value === "number" && Number.isFinite(value);
const identifier = value => value == null || value === "" ? null : String(value);
const outcome = value => typeof value === "string" ? value.trim().toLowerCase().replaceAll("_", " ") : "";
const normalizedName = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const isRegulationEvent = event => event && typeof event === "object" && Number(event.period) !== 5;
const validXg = value => finite(value) && value >= 0 && value <= 1;
const unique = values => [...new Set(values)];
const minutes = value => `${Number(value.toFixed(2))}′`;

/** Normalized match time, in minutes. Never sort periods by wall-clock seconds. */
export function eventMinute(event) {
  if (finite(event?.time_seconds) && event.time_seconds >= 0) return event.time_seconds / 60;
  if (finite(event?.minute) && event.minute >= 0 && (event.second == null || (finite(event.second) && event.second >= 0 && event.second < 60))) {
    return event.minute + (event.second ?? 0) / 60;
  }
  return null;
}

export function getMatchTimeRange(dataset = {}) {
  let end = 0;
  for (const event of Array.isArray(dataset.events) ? dataset.events : []) {
    if (isRegulationEvent(event)) end = Math.max(end, eventMinute(event) ?? 0);
  }
  for (const edges of [dataset.collaborationEdges, dataset.competitionEdges]) {
    for (const edge of Array.isArray(edges) ? edges : []) {
      if (finite(edge?.end_minute) && edge.end_minute >= 0) end = Math.max(end, edge.end_minute);
    }
  }
  return [0, end];
}

function normalizedState(dataset, state = {}) {
  const range = state.timeRange;
  const timeRange = Array.isArray(range) && range.length === 2 && range.every(finite)
    ? [Math.max(0, Math.min(...range)), Math.max(0, Math.max(...range))]
    : getMatchTimeRange(dataset);
  return {
    selectedPlayerId: identifier(state.selectedPlayerId),
    selectedTeamId: identifier(state.selectedTeamId),
    mode: state.mode === "competition" ? "competition" : "collaboration",
    timeRange,
  };
}

/**
 * Derive event metrics, optionally over an inclusive minute range.
 * period=5 (penalty shootout) is excluded. Missing outcomes are NOT completions.
 * Optional goal_assist must be an explicit boolean on every relevant Pass.
 */
export function derivePlayerMetrics(events, playerId, timeRange = null) {
  const values = Object.fromEntries(KEYS.map(key => [key, null]));
  const reasons = {};
  const unknown = (keys, reason) => keys.forEach(key => { values[key] = null; reasons[key] = reason; });
  if (!Array.isArray(events)) {
    unknown(KEYS, "尚未提供比赛事件，无法计算。");
    return { values, reasons };
  }
  const playerEvents = events.filter(event => isRegulationEvent(event) && identifier(event.player_id) === identifier(playerId));
  if (playerEvents.some(event => typeof event.type !== "string" || !event.type)) {
    unknown(KEYS, "有球员事件缺少类型，暂不能提供完整统计。");
    return { values, reasons };
  }
  const inRange = event => !timeRange || (eventMinute(event) !== null && eventMinute(event) >= timeRange[0] && eventMinute(event) <= timeRange[1]);
  const passes = playerEvents.filter(event => event.type === "Pass" && inRange(event));
  const shots = playerEvents.filter(event => event.type === "Shot" && inRange(event));
  values.passes = passes.length;
  values.shots = shots.length;

  const passOutcomes = passes.map(event => outcome(event.outcome));
  if (passOutcomes.every(result => result === "complete" || result === "completed" || PASS_FAILURES.has(result))) {
    values.successful_passes = passOutcomes.filter(result => result === "complete" || result === "completed").length;
    values.pass_accuracy = passes.length ? values.successful_passes / passes.length : null;
    if (!passes.length) reasons.pass_accuracy = "本时段没有传球，成功率的分母为零。";
  } else unknown(["successful_passes", "pass_accuracy"], "部分传球缺少可识别的结果，不能计算完整成功率。");

  const shotOutcomes = shots.map(event => outcome(event.outcome));
  if (shotOutcomes.every(result => result === "goal" || SHOT_NON_GOALS.has(result))) {
    values.goals = shotOutcomes.filter(result => result === "goal").length;
  } else unknown(["goals"], "部分射门缺少可识别的结果，不能确认进球总数。");

  if (passes.every(event => typeof event.goal_assist === "boolean")) {
    values.assists = passes.filter(event => event.goal_assist).length;
  } else unknown(["assists"], "事件未完整提供助攻标记；全场助攻可查看下方对照值。");

  const xgAvailable = events.some(event => isRegulationEvent(event) && event.type === "Shot" && validXg(event.xg));
  if (xgAvailable && shots.every(event => validXg(event.xg))) {
    values.xg = Math.round(shots.reduce((sum, event) => sum + event.xg, 0) * 1e6) / 1e6;
  } else unknown(["xg"], shots.length ? "射门 xG 缺失或不完整，暂不展示总量。" : "数据未提供可用的射门 xG 字段。");

  if (timeRange) {
    const missingTime = type => playerEvents.some(event => event.type === type && eventMinute(event) === null);
    if (missingTime("Pass")) unknown(["passes", "successful_passes", "pass_accuracy", "assists"], "有传球事件缺少有效时间，时段统计不完整。");
    if (missingTime("Shot")) unknown(["shots", "goals", "xg"], "有射门事件缺少有效时间，时段统计不完整。");
  }
  return { values, reasons };
}

function fullMatchMetrics(dataset, playerId) {
  const derived = derivePlayerMetrics(dataset.events, playerId);
  const record = dataset.stats?.players?.[playerId];
  const sources = Object.fromEntries(KEYS.map(key => [key, "events"]));
  if (record && typeof record === "object") {
    for (const key of KEYS) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
      sources[key] = "stats";
      const value = record[key];
      const valid = finite(value) && value >= 0 && (key !== "pass_accuracy" || value <= 1) && (["pass_accuracy", "xg"].includes(key) || Number.isInteger(value));
      derived.values[key] = valid ? value : null;
      if (!valid) derived.reasons[key] = value == null ? "全场统计未提供该指标。" : "全场统计数值无效。";
      else delete derived.reasons[key];
    }
  }
  return { ...derived, sources };
}

/** Count raw, unique, contract-valid hyperedges, never their display weights. */
export function selectPlayerEdges(dataset = {}, inputState = {}) {
  const state = normalizedState(dataset, inputState);
  const players = new Map((Array.isArray(dataset.players) ? dataset.players : []).filter(Boolean).map(player => [identifier(player.player_id), player]));
  const source = state.mode === "competition" ? dataset.competitionEdges : dataset.collaborationEdges;
  const knownEvents = Array.isArray(dataset.events)
    ? new Map(dataset.events.filter(event => event && identifier(event.event_id)).map(event => [identifier(event.event_id), event]))
    : null;
  const edges = [];
  const seen = new Set();
  let invalidCount = 0;
  for (const edge of Array.isArray(source) ? source : []) {
    const playerIds = unique((Array.isArray(edge?.player_ids) ? edge.player_ids : []).map(identifier).filter(Boolean));
    const teamIds = unique(playerIds.map(id => identifier(players.get(id)?.team_id)).filter(Boolean));
    const declaredTeams = unique((Array.isArray(edge?.team_ids) ? edge.team_ids : []).map(identifier).filter(Boolean));
    const valid = edge && identifier(edge.edge_id) && edge.type === state.mode && edge.weight === 1 && playerIds.length >= 3
      && playerIds.every(id => players.has(id)) && declaredTeams.length === teamIds.length && declaredTeams.every(id => teamIds.includes(id))
      && (state.mode === "competition" ? teamIds.length >= 2 : teamIds.length === 1)
      && finite(edge.start_minute) && finite(edge.end_minute) && edge.start_minute >= 0 && edge.end_minute >= edge.start_minute
      && Array.isArray(edge.event_ids) && edge.event_ids.length > 0
      && edge.event_ids.every(id => identifier(id) && (!knownEvents || (knownEvents.has(identifier(id)) && isRegulationEvent(knownEvents.get(identifier(id))))));
    if (!valid) { invalidCount++; continue; }
    const edgeId = identifier(edge.edge_id);
    if (seen.has(edgeId)) continue;
    seen.add(edgeId);
    if (!playerIds.includes(state.selectedPlayerId)) continue;
    if (state.selectedTeamId && !teamIds.includes(state.selectedTeamId)) continue;
    if (edge.end_minute < state.timeRange[0] || edge.start_minute > state.timeRange[1]) continue;
    edges.push({ ...edge, edge_id: edgeId, player_ids: playerIds, team_ids: teamIds });
  }
  return { edges, invalidCount, available: Array.isArray(source) };
}

/** Pure analysis model shared by the UI and meaningful unit tests. */
export function analyzePlayer(dataset = {}, inputState = {}, { topN = 5 } = {}) {
  const state = normalizedState(dataset, inputState);
  const players = new Map((Array.isArray(dataset.players) ? dataset.players : []).filter(Boolean).map(player => [identifier(player.player_id), player]));
  const player = players.get(state.selectedPlayerId) ?? null;
  if (!player) return { player: null, state };
  const selection = selectPlayerEdges(dataset, state);
  const partnerCounts = new Map();
  const groups = new Map();
  for (const edge of selection.edges) {
    for (const id of edge.player_ids) {
      if (id !== state.selectedPlayerId) partnerCounts.set(id, (partnerCounts.get(id) ?? 0) + 1);
    }
    const ids = [...edge.player_ids].sort();
    const key = JSON.stringify(ids);
    if (!groups.has(key)) groups.set(key, { key, playerIds: ids, edges: [], count: 0 });
    const group = groups.get(key);
    group.edges.push(edge);
    group.count++;
  }
  const partners = [...partnerCounts].map(([playerId, count]) => ({
    playerId, player: players.get(playerId), count,
    sameTeam: identifier(players.get(playerId)?.team_id) === identifier(player.team_id),
  })).sort((a, b) => b.count - a.count || a.playerId.localeCompare(b.playerId));
  const combinations = [...groups.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const limit = Number.isInteger(topN) && topN > 0 ? topN : 5;
  const full = fullMatchMetrics(dataset, state.selectedPlayerId);
  const matchRange = getMatchTimeRange(dataset);
  const coversFullMatch = state.timeRange[0] <= matchRange[0] && state.timeRange[1] >= matchRange[1];
  return {
    player, state, ...selection, partners: partners.slice(0, limit), combinations: combinations.slice(0, limit),
    partnerCount: partners.length, combinationCount: combinations.length,
    current: derivePlayerMetrics(dataset.events, state.selectedPlayerId, state.timeRange), full, coversFullMatch,
    outsideTeam: Boolean(state.selectedTeamId && identifier(player.team_id) !== state.selectedTeamId),
  };
}

function formatMetric(key, value) {
  if (!finite(value)) return "N/A";
  if (key === "pass_accuracy") return `${(value * 100).toFixed(1)}%`;
  if (key === "xg") return value.toFixed(2);
  return String(value);
}

function element(document, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * Returns { destroy(), updateDataset(nextDataset) }.
 * Optional bubbling event: playeranalysis:select-edges. It requests, never claims,
 * a combination highlight; B/D may listen without changing the required store.
 */
export function mountPlayerAnalysis(container, store, initialDataset = {}) {
  if (!container || typeof container.append !== "function" || !container.ownerDocument) throw new TypeError("C 模块需要一个有效的 DOM 容器。");
  if (!store || ["getState", "setState", "subscribe"].some(key => typeof store[key] !== "function")) throw new TypeError("C 模块需要 getState/setState/subscribe 状态接口。");
  const document = container.ownerDocument;
  const window = document.defaultView;
  const uid = `pa-${++mountSequence}`;
  let dataset = initialDataset ?? {};
  let query = "";
  let selectedCombination = null;
  let selectionContext = "";
  let model;
  let destroyed = false;
  const root = element(document, "section", "pa-panel");
  root.setAttribute("aria-label", "球星聚焦与个人表现分析");
  const style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = STYLE_URL;
  root.innerHTML = `
    <header class="pa-heading"><div><span class="pa-eyebrow">PLAYER FOCUS</span><h2>每位球员，都是关系的中心</h2></div><span class="pa-module-mark">C</span></header>
    <div class="pa-search"><label for="${uid}-search">搜索球员</label><input id="${uid}-search" type="search" placeholder="姓名、球队、球衣号…" autocomplete="off"><div class="pa-shortcuts" aria-label="球星快捷选择"></div><div class="pa-search-meta"></div><div class="pa-results" aria-label="球员搜索结果"></div></div>
    <p class="pa-announcement" role="status" aria-live="polite" aria-atomic="true"></p>
    <div class="pa-empty pa-start"><span class="pa-empty-symbol" aria-hidden="true">◎</span><h3>从一位球员开始</h3><p>搜索或选择球员，查看个人表现与多人关系。</p></div>
    <div class="pa-content" hidden>
      <div class="pa-identity"><div class="pa-shirt" aria-hidden="true"></div><div class="pa-player-title"><span class="pa-team"></span><h3 class="pa-name"></h3><p class="pa-position"></p></div><button class="pa-clear" type="button">取消选择</button></div>
      <p class="pa-team-notice" hidden></p>
      <section class="pa-performance" aria-label="球员比赛指标"><div class="pa-section-heading"><h3>个人表现</h3><span class="pa-range"></span></div><p class="pa-scope-note">大号数字按当前时段的事件计算；下方对照全场统计。</p><div class="pa-metrics"></div><details class="pa-methods"><summary>指标口径与缺失值</summary><ul><li>传球仅计该球员发起的传球；成功率＝明确成功传球／全部传球。没有传球时显示 N/A。</li><li>进球仅计结果明确为进球的射门，不计乌龙球；点球大战不计入事件指标。</li><li>时段助攻需每次传球提供明确的助攻标记，缺失时显示 N/A。</li><li>xG 仅汇总完整、有效的射门 xG；部分缺失时不把已知部分冒充总量。</li><li>全场对照优先使用比赛汇总统计；缺少字段时尝试从事件计算，已声明缺失的指标保留 N/A。</li></ul></details></section>
      <section class="pa-network" aria-label="超图关系分析"><div class="pa-section-heading"><h3 class="pa-network-title"></h3><span class="pa-edge-total"></span></div><p class="pa-network-note"></p><div class="pa-network-empty pa-empty" hidden></div><div class="pa-network-grid"><div><h4 class="pa-partner-title"></h4><ol class="pa-partners"></ol></div><div><h4>高频多人组合 · Top 5</h4><ol class="pa-combinations"></ol></div></div><p class="pa-validation" hidden></p><div class="pa-evidence" hidden></div></section>
    </div>`;
  const find = selector => root.querySelector(selector);
  const input = find("input");
  const results = find(".pa-results");
  const shortcuts = find(".pa-shortcuts");
  const metricNodes = new Map();
  for (const [key, label, unit] of METRICS) {
    const tile = element(document, "div", "pa-metric");
    tile.dataset.metric = key;
    const name = element(document, "span", "pa-metric-label", label);
    const value = element(document, "strong", "pa-metric-value");
    const suffix = element(document, "span", "pa-unit", unit);
    const main = element(document, "div", "pa-metric-main");
    main.append(value, suffix);
    const full = element(document, "span", "pa-metric-full");
    const reason = element(document, "span", "pa-metric-reason");
    tile.append(name, main, full, reason);
    find(".pa-metrics").append(tile);
    metricNodes.set(key, { value, full, reason, suffix });
  }

  function choosePlayer(playerId) {
    store.setState({ selectedPlayerId: playerId });
  }

  function renderSearch() {
    const state = normalizedState(dataset, store.getState());
    const all = (Array.isArray(dataset.players) ? dataset.players : []).filter(player => player && identifier(player.player_id));
    const available = all.filter(player => !state.selectedTeamId || identifier(player.team_id) === state.selectedTeamId);
    const search = normalizedName(query.trim());
    const matched = available.filter(player => {
      const name = normalizedName(player.player_name);
      const alias = name.includes("messi") ? "梅西" : name.includes("mbappe") ? "姆巴佩" : "";
      return normalizedName(`${player.player_name} ${player.team_name} ${player.shirt_number ?? ""} ${alias}`).includes(search);
    });
    const focusedId = document.activeElement?.dataset?.paPlayer;
    results.replaceChildren();
    for (const player of matched.slice(0, 40)) {
      const button = element(document, "button", "pa-result");
      button.type = "button";
      button.dataset.paPlayer = identifier(player.player_id);
      button.setAttribute("aria-pressed", String(identifier(player.player_id) === state.selectedPlayerId));
      button.append(element(document, "span", "pa-result-name", player.player_name || "未命名球员"), element(document, "span", "pa-result-meta", `${player.team_name || "球队未知"} · ${player.shirt_number ?? "—"}`));
      results.append(button);
      if (focusedId === identifier(player.player_id)) button.focus({ preventScroll: true });
    }
    if (!matched.length) results.append(element(document, "p", "pa-search-empty", all.length ? "没有匹配的球员，请调整关键词或球队筛选。" : "尚未提供球员名单。"));
    find(".pa-search-meta").textContent = matched.length > 40 ? `找到 ${matched.length} 位，展示前 40 位；可继续输入姓名。` : `${matched.length} 位球员`;
    shortcuts.replaceChildren();
    for (const [needle, label] of [["messi", "Messi"], ["mbappe", "Mbappé"]]) {
      const player = available.find(candidate => normalizedName(candidate.player_name).includes(needle));
      if (!player) continue;
      const button = element(document, "button", "pa-shortcut", label);
      button.type = "button";
      button.dataset.paPlayer = identifier(player.player_id);
      button.setAttribute("aria-pressed", String(identifier(player.player_id) === state.selectedPlayerId));
      shortcuts.append(button);
    }
  }

  function emitCombination(group) {
    container.dispatchEvent(new window.CustomEvent("playeranalysis:select-edges", {
      bubbles: true,
      detail: {
        playerId: model.state.selectedPlayerId, mode: model.state.mode, timeRange: [...model.state.timeRange],
        edgeIds: group ? group.edges.map(edge => edge.edge_id) : [], playerIds: group ? [...group.playerIds] : [],
      },
    }));
  }

  function renderEvidence(group) {
    const target = find(".pa-evidence");
    target.replaceChildren();
    target.hidden = !group;
    if (!group) return;
    target.append(element(document, "h4", "", `组合依据 · ${group.count} 个关系片段`));
    const list = element(document, "ul", "pa-evidence-list");
    const eventIds = new Set((Array.isArray(dataset.events) ? dataset.events : []).map(event => identifier(event?.event_id)).filter(Boolean));
    for (const edge of [...group.edges].sort((a, b) => a.start_minute - b.start_minute)) {
      const row = element(document, "li");
      row.append(element(document, "span", "pa-evidence-time", `${minutes(edge.start_minute)}–${minutes(edge.end_minute)}`));
      row.append(element(document, "span", "pa-evidence-id", edge.edge_id));
      const details = document.createElement("details");
      details.append(element(document, "summary", "", `${edge.event_ids.length} 条来源事件`));
      for (const id of edge.event_ids) details.append(element(document, "code", "pa-event-id", `${id}${eventIds.has(identifier(id)) ? "" : "（事件未载入）"}`));
      row.append(details);
      list.append(row);
    }
    target.append(list);
  }

  function renderNetwork() {
    const competition = model.state.mode === "competition";
    find(".pa-network-title").textContent = competition ? "跨队对抗关联" : "多人协作关系";
    find(".pa-edge-total").textContent = model.available ? `参与 ${model.edges.length} 个超边片段` : "等待关系数据";
    find(".pa-network-note").textContent = competition
      ? "与时段相交的完整片段计一次。关系由事件窗口推断，不代表逐帧站位或直接一对一对抗。"
      : "与时段相交的完整超边计一次；共同参与频次不等于直接传球次数或配合成功率。";
    find(".pa-partner-title").textContent = competition ? "共同参与球员 · Top 5" : "队友共同参与频次 · Top 5";
    const empty = find(".pa-network-empty");
    empty.hidden = model.edges.length > 0;
    empty.textContent = model.available ? "当前模式、球队和时间范围内，没有该球员参与的有效超边。" : "当前模式的关系数据尚未提供；个人指标仍可独立查看。";
    find(".pa-network-grid").hidden = model.edges.length === 0;
    const partners = find(".pa-partners");
    partners.replaceChildren();
    const max = model.partners[0]?.count ?? 1;
    for (const partner of model.partners) {
      const row = element(document, "li", "pa-partner");
      const label = element(document, "div", "pa-partner-label");
      label.append(element(document, "span", "pa-partner-name", partner.player?.player_name || partner.playerId));
      if (competition) label.append(element(document, "span", "pa-relation", partner.sameTeam ? "队友" : "对手"));
      label.append(element(document, "span", "pa-partner-count", `${partner.count} 次`));
      const track = element(document, "div", "pa-bar-track");
      track.setAttribute("aria-hidden", "true");
      const bar = element(document, "div", "pa-bar");
      bar.style.width = `${partner.count / max * 100}%`;
      track.append(bar);
      row.append(label, track);
      partners.append(row);
    }
    const combinations = find(".pa-combinations");
    combinations.replaceChildren();
    const playerMap = new Map((Array.isArray(dataset.players) ? dataset.players : []).filter(Boolean).map(player => [identifier(player.player_id), player]));
    for (const [index, group] of model.combinations.entries()) {
      const row = element(document, "li");
      const button = element(document, "button", "pa-combination");
      button.type = "button";
      button.dataset.combination = String(index);
      button.setAttribute("aria-pressed", String(group.key === selectedCombination));
      const names = group.playerIds.filter(id => id !== model.state.selectedPlayerId).map(id => playerMap.get(id)?.player_name || id).join(" ＋ ");
      button.append(element(document, "span", "pa-combination-names", `${model.player.player_name} ＋ ${names}`), element(document, "span", "pa-combination-count", `${group.count} 次`));
      row.append(button);
      combinations.append(row);
    }
    const validation = find(".pa-validation");
    validation.hidden = !model.invalidCount;
    validation.textContent = `${model.invalidCount} 条格式不完整的关系记录未纳入计数。`;
    renderEvidence(model.combinations.find(group => group.key === selectedCombination));
  }

  function render() {
    if (destroyed) return;
    model = analyzePlayer(dataset, store.getState());
    renderSearch();
    const context = JSON.stringify(model.state);
    if (context !== selectionContext) {
      const hadSelection = selectedCombination !== null;
      selectedCombination = null;
      selectionContext = context;
      if (hadSelection) emitCombination(null);
    }
    find(".pa-start").hidden = Boolean(model.player);
    find(".pa-content").hidden = !model.player;
    const announcement = find(".pa-announcement");
    if (!model.player) {
      announcement.textContent = model.state.selectedPlayerId ? "当前球员不在已提供的名单中，请重新选择。" : "尚未选择球员。";
      return;
    }
    const player = model.player;
    find(".pa-shirt").textContent = player.shirt_number ?? "—";
    find(".pa-name").textContent = player.player_name || "未命名球员";
    find(".pa-team").textContent = player.team_name || "球队未知";
    find(".pa-position").textContent = player.position || "位置未提供";
    find(".pa-team-notice").hidden = !model.outsideTeam;
    find(".pa-team-notice").textContent = "当前球员不属于筛选球队；个人指标保留，关系按球队筛选。";
    find(".pa-range").textContent = `${minutes(model.state.timeRange[0])}–${minutes(model.state.timeRange[1])}${model.coversFullMatch ? " · 覆盖全场" : ""}`;
    for (const [key] of METRICS) {
      const nodes = metricNodes.get(key);
      const value = model.current.values[key];
      nodes.value.textContent = formatMetric(key, value);
      nodes.value.classList.toggle("pa-unavailable", value == null);
      nodes.suffix.hidden = value == null;
      nodes.full.textContent = `全场 ${formatMetric(key, model.full.values[key])} · ${model.full.sources[key] === "stats" ? "比赛统计" : "事件计算"}`;
      nodes.reason.textContent = model.current.reasons[key] ?? (key === "passes" && model.current.values.successful_passes != null ? `其中成功 ${model.current.values.successful_passes} 次` : "");
      if (model.full.reasons[key]) nodes.full.textContent += `（${model.full.reasons[key]}）`;
    }
    renderNetwork();
    announcement.textContent = `已选择 ${player.player_name || "球员"}，${minutes(model.state.timeRange[0])}至${minutes(model.state.timeRange[1])}，${model.available ? `参与 ${model.edges.length} 个关系片段` : "关系数据尚未提供"}。`;
  }

  const onInput = () => { query = input.value; renderSearch(); };
  const onPlayerClick = event => {
    const button = event.target.closest?.("button[data-pa-player]");
    if (button && root.contains(button)) choosePlayer(button.dataset.paPlayer);
  };
  const onSearchKey = event => {
    if (event.key === "Enter") {
      const first = results.querySelector("button[data-pa-player]");
      if (first) { event.preventDefault(); choosePlayer(first.dataset.paPlayer); }
    }
  };
  const onClear = () => choosePlayer(null);
  const onCombination = event => {
    const button = event.target.closest?.("button[data-combination]");
    if (!button) return;
    const group = model.combinations[Number(button.dataset.combination)];
    if (!group) return;
    selectedCombination = selectedCombination === group.key ? null : group.key;
    emitCombination(selectedCombination ? group : null);
    renderNetwork();
    const next = find(`button[data-combination="${button.dataset.combination}"]`);
    next?.focus({ preventScroll: true });
  };
  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onSearchKey);
  results.addEventListener("click", onPlayerClick);
  shortcuts.addEventListener("click", onPlayerClick);
  find(".pa-clear").addEventListener("click", onClear);
  find(".pa-combinations").addEventListener("click", onCombination);
  container.append(style, root);
  const unsubscribe = store.subscribe(render);
  render();
  return {
    updateDataset(nextDataset) {
      if (destroyed) return;
      if (selectedCombination !== null) emitCombination(null);
      dataset = nextDataset ?? {};
      selectedCombination = null;
      render();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (selectedCombination !== null) emitCombination(null);
      if (typeof unsubscribe === "function") unsubscribe();
      input.removeEventListener("input", onInput);
      input.removeEventListener("keydown", onSearchKey);
      results.removeEventListener("click", onPlayerClick);
      shortcuts.removeEventListener("click", onPlayerClick);
      find(".pa-clear").removeEventListener("click", onClear);
      find(".pa-combinations").removeEventListener("click", onCombination);
      root.remove();
      style.remove();
    },
  };
}
