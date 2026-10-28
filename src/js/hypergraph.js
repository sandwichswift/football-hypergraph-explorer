/** B's single, offline D3 renderer. Shared state and raw edge contracts stay frozen. */
import d3 from "./vendor/d3.v7.9.0.js";
const finite = value => typeof value === "number" && Number.isFinite(value);
const id = value => typeof value === "string" && value.trim().length > 0;
const COLORS = ["#287c91", "#ac613a", "#7266a3", "#54835b"];
const WIDTH = 760, HEIGHT = 540;
const groupKey = ids => JSON.stringify([...ids].sort());

/** Select raw edges; player selection highlights and never removes unrelated edges. */
export function selectHypergraphEdges(dataset = {}, state = {}) {
  const mode = state.mode === "competition" ? "competition" : "collaboration";
  const source = mode === "competition" ? dataset.competitionEdges : dataset.collaborationEdges;
  const roster = new Map((dataset.players ?? []).map(player => [player.player_id, player]));
  const events = new Map((dataset.events ?? []).map(event => [event.event_id, event]));
  const range = state.timeRange ?? [0, Infinity], seen = new Set(), edges = [];
  let invalidCount = 0;
  for (const edge of Array.isArray(source) ? source : []) {
    const playerIds = Array.isArray(edge?.player_ids) ? edge.player_ids : [], teams = new Set(playerIds.map(value => roster.get(value)?.team_id));
    const valid = edge && id(edge.edge_id) && edge.type === mode && edge.weight === 1
      && Array.isArray(playerIds) && playerIds.length >= 3 && new Set(playerIds).size === playerIds.length
      && playerIds.every(value => roster.has(value)) && !teams.has(undefined)
      && Array.isArray(edge.team_ids) && edge.team_ids.length === teams.size && new Set(edge.team_ids).size === teams.size
      && edge.team_ids.every(value => teams.has(value)) && (mode === "competition" ? teams.size >= 2 : teams.size === 1)
      && finite(edge.start_minute) && finite(edge.end_minute) && edge.start_minute >= 0 && edge.end_minute >= edge.start_minute
      && Array.isArray(edge.event_ids) && edge.event_ids.length > 0
      && edge.event_ids.every(value => id(value) && events.has(value) && events.get(value).period !== 5);
    if (!valid) { invalidCount++; continue; }
    if (seen.has(edge.edge_id)) continue;
    seen.add(edge.edge_id);
    if (state.selectedTeamId && !edge.team_ids.includes(state.selectedTeamId)) continue;
    if (edge.end_minute < range[0] || edge.start_minute > range[1]) continue;
    edges.push(edge);
  }
  return { edges, available: Array.isArray(source), invalidCount, mode };
}

/** Display aggregation never rewrites raw edges, times or weight. */
export function groupHypergraphEdges(edges, selectedPlayerId = null, requestedEdgeIds = []) {
  const groups = new Map(), requested = new Set(requestedEdgeIds);
  for (const edge of edges) {
    const key = groupKey(edge.player_ids);
    if (!groups.has(key)) groups.set(key, { key, playerIds: [...edge.player_ids].sort(), edges: [], requested: false });
    const group = groups.get(key);
    group.edges.push(edge);
    if (requested.has(edge.edge_id)) group.requested = true;
  }
  return [...groups.values()].sort((a, b) => Number(b.requested) - Number(a.requested)
    || Number(b.playerIds.includes(selectedPlayerId)) - Number(a.playerIds.includes(selectedPlayerId))
    || b.edges.length - a.edges.length || a.key.localeCompare(b.key));
}

/** Expanded convex envelope remains nonzero for coincident and collinear points. */
export function hyperedgePath(nodes, padding = 23) {
  if (nodes.length < 3 || nodes.some(node => !finite(node.x) || !finite(node.y))) return "";
  const samples = nodes.flatMap(node => d3.range(12).map(index => {
    const angle = index * Math.PI / 6;
    return [node.x + padding * Math.cos(angle), node.y + padding * Math.sin(angle)];
  }));
  const hull = d3.polygonHull(samples);
  return hull ? d3.line().curve(d3.curveCatmullRomClosed.alpha(0.5))(hull) + "Z" : "";
}

function layout(players, groups, teams, positions) {
  const nodes = players.map((player, index) => ({ ...player, id: player.player_id, isPlayer: true,
    x: positions.get(player.player_id)?.x ?? (170 + (teams.indexOf(player.team_id) % 2) * 400 + Math.cos(index * 2.4) * 80),
    y: positions.get(player.player_id)?.y ?? (HEIGHT / 2 + Math.sin(index * 2.4) * 160) }));
  const hubs = groups.map((group, index) => ({ id: `hub:${group.key}`, x: 240 + (index % 3) * 125, y: 130 + Math.floor(index / 3) * 55 }));
  const links = groups.flatMap(group => group.playerIds.map(player => ({ source: player, target: `hub:${group.key}` })));
  const simulation = d3.forceSimulation([...nodes, ...hubs]).stop()
    .force("link", d3.forceLink(links).id(node => node.id).distance(65).strength(0.15))
    .force("charge", d3.forceManyBody().strength(node => node.isPlayer ? -230 : -35))
    .force("collision", d3.forceCollide(node => node.isPlayer ? 30 : 16))
    .force("x", d3.forceX(node => node.isPlayer && teams.length > 1 ? 190 + (teams.indexOf(node.team_id) % 2) * 380 : WIDTH / 2).strength(0.035))
    .force("y", d3.forceY(HEIGHT / 2).strength(0.025));
  simulation.tick(150);
  for (const node of nodes) {
    node.x = Math.max(65, Math.min(WIDTH - 65, node.x));
    node.y = Math.max(55, Math.min(HEIGHT - 55, node.y));
    positions.set(node.id, { x: node.x, y: node.y });
  }
  return nodes;
}

/** Own container only; optional cross-view requests are listened to, never added to store. */
export function mountHypergraph(container, store, initialDataset) {
  if (!container || !store?.getState || !store?.subscribe || !store?.setState) throw new TypeError("B requires a container and the shared store.");
  const document = container.ownerDocument, window = document.defaultView;
  // Re-mounting the same container must dispose the preceding subscription.
  container.__hypergraphHandle?.destroy();
  const root = document.createElement("section"); root.className = "hg-panel";
  const stylesheet = document.createElement("link"); stylesheet.rel = "stylesheet";
  stylesheet.href = new URL("../css/hypergraph.css", import.meta.url).href;
  root.append(stylesheet);
  const element = (tag, className, text) => {
    const item = document.createElement(tag); item.className = className;
    if (text !== undefined) item.textContent = text;
    return item;
  };
  const top = element("div", "hg-heading"), heading = element("div", "hg-heading-copy");
  const eyebrow = element("p", "hg-eyebrow", "COLLABORATION / MULTIPLAYER SETS");
  const title = element("h3", "hg-title", "一条超边，一组共同参与者");
  heading.append(eyebrow, title); top.append(heading);
  const toolbar = element("div", "hg-toolbar");
  const label = element("label", "hg-limit-label", "显示组合 ");
  const limit = document.createElement("select"); limit.setAttribute("aria-label", "主图最多显示组合数");
  for (const value of [12, 24]) { const option = document.createElement("option"); option.value = value; option.textContent = `Top ${value}`; limit.append(option); }
  label.append(limit); toolbar.append(label);
  const buttons = {};
  for (const [action, name] of [["in", "放大"], ["out", "缩小"], ["reset", "重置视图"], ["clear", "清除球员聚焦"]]) {
    const button = element("button", `hg-${action}`, name); button.type = "button"; toolbar.append(button); buttons[action] = button;
  }
  const summary = element("p", "hg-summary"); summary.setAttribute("role", "status"); summary.setAttribute("aria-live", "polite");
  const legend = element("div", "hg-legend");
  const explanation = element("p", "hg-explanation");
  const stage = element("div", "hg-stage"), empty = element("p", "hg-empty");
  const svg = d3.select(stage).append("svg").attr("class", "hg-svg").attr("viewBox", `0 0 ${WIDTH} ${HEIGHT}`)
    .attr("role", "group").attr("aria-label", "可缩放拖动的多人超图；也可使用下方组合按钮查看成员与证据");
  svg.append("title").text("节点表示球员；包络表示至少三名球员共同参与的事件片段。");
  const viewport = svg.append("g").attr("class", "hg-viewport");
  const edgeLayer = viewport.append("g").attr("class", "hg-edges"), badgeLayer = viewport.append("g").attr("class", "hg-badges");
  const nodeLayer = viewport.append("g").attr("class", "hg-nodes");
  stage.append(empty);
  const guide = element("p", "hg-guide", "拖动节点调整布局；滚轮缩放、拖动空白处平移。布局是关系示意，不代表球场站位。包络可能覆盖非成员，以高亮节点和成员表为准。");
  const choices = element("div", "hg-choices"); choices.setAttribute("aria-label", "当前显示的完整多人组合");
  const detail = element("section", "hg-detail"); detail.setAttribute("aria-label", "超边成员与事件证据");
  root.append(top, toolbar, summary, legend, explanation, stage, guide, choices, detail);
  container.replaceChildren(root);
  let dataset = initialDataset, positions = new Map(), selection, groups = [], shown = [], nodeMap = new Map();
  let state, selectedKey = null, requested = [], destroyed = false, layoutKey = null;
  const zoom = d3.zoom().scaleExtent([0.35, 4]).extent([[0, 0], [WIDTH, HEIGHT]])
    .on("zoom", event => viewport.attr("transform", event.transform));
  svg.call(zoom).on("dblclick.zoom", null);
  buttons.in.onclick = () => svg.call(zoom.scaleBy, 1.3);
  buttons.out.onclick = () => svg.call(zoom.scaleBy, 1 / 1.3);
  buttons.reset.onclick = () => svg.call(zoom.transform, d3.zoomIdentity);
  buttons.clear.onclick = () => store.setState({ selectedPlayerId: null });
  limit.onchange = () => render();
  function playerName(playerId) { return dataset.players.find(player => player.player_id === playerId)?.player_name || playerId; }
  const minutes = value => `${value.toFixed(2)}′`;

  function showDetail() {
    detail.replaceChildren();
    const group = shown.find(item => item.key === selectedKey);
    if (!group) { detail.append(element("p", "hg-detail-hint", "点击包络、编号或下方组合，查看完整成员和原始事件。")); return; }
    detail.append(element("h4", "", `组合 ${shown.indexOf(group) + 1} · ${group.playerIds.length} 人 · ${group.edges.length} 个原始片段`));
    const members = element("div", "hg-members");
    for (const playerId of group.playerIds) {
      const button = element("button", "hg-member", playerName(playerId)); button.type = "button";
      button.onclick = () => store.setState({ selectedPlayerId: playerId }); members.append(button);
    }
    detail.append(members, element("p", "hg-detail-note", "下列各项都是 weight=1 的原始片段；相同组合只在图上合并显示。点击条目展开事件依据。"));
    const evidence = element("div", "hg-evidence-list"), events = new Map(dataset.events.map(event => [event.event_id, event]));
    for (const edge of group.edges) {
      const item = document.createElement("details"), caption = document.createElement("summary");
      caption.textContent = `${minutes(edge.start_minute)}–${minutes(edge.end_minute)} · ${edge.edge_id}`;
      const description = element("p", "hg-evidence-description", edge.description);
      const list = element("ol", "hg-event-list");
      for (const eventId of edge.event_ids) {
        const event = events.get(eventId);
        const row = element("li", "hg-event");
        row.append(element("span", "", event ? `第 ${event.period} 节 · ${minutes(event.time_seconds / 60)} · ${playerName(event.player_id)}${event.recipient_id ? ` → ${playerName(event.recipient_id)}` : ""} · ${event.type} / ${event.outcome ?? "结果未记录"}` : "来源未加载"), element("code", "hg-event-id", eventId));
        list.append(row);
      }
      item.append(caption, description, list); evidence.append(item);
    }
    detail.append(evidence);
  }
  function paintHighlights() {
    const selected = shown.find(group => group.key === selectedKey);
    const focusIds = selected ? new Set(selected.playerIds) : null;
    const relevant = group => selected ? group.key === selected.key : requested.length ? group.requested : !state.selectedPlayerId || group.playerIds.includes(state.selectedPlayerId);
    edgeLayer.selectAll("path").classed("hg-dim", group => !relevant(group)).classed("hg-edge-selected", group => selected?.key === group.key);
    badgeLayer.selectAll("g").classed("hg-dim", group => !relevant(group));
    const related = new Set(shown.filter(relevant).flatMap(group => group.playerIds));
    nodeLayer.selectAll("g").classed("hg-node-selected", node => node.id === state.selectedPlayerId)
      .classed("hg-dim", node => focusIds ? !focusIds.has(node.id) : (state.selectedPlayerId || requested.length) && !related.has(node.id));
    for (const button of choices.children) button.setAttribute("aria-pressed", String(button.dataset.groupKey === selectedKey));
  }
  function selectGroup(group) { selectedKey = selectedKey === group.key ? null : group.key; paintHighlights(); showDetail(); }
  function geometry() {
    edgeLayer.selectAll("path").attr("d", group => hyperedgePath(group.playerIds.map(playerId => nodeMap.get(playerId))));
    badgeLayer.selectAll("g").attr("transform", group => {
      const nodes = group.playerIds.map(playerId => nodeMap.get(playerId));
      return `translate(${d3.mean(nodes, node => node.x)},${d3.mean(nodes, node => node.y)})`;
    });
    nodeLayer.selectAll("g").attr("transform", node => `translate(${node.x},${node.y})`);
  }
  function render() {
    if (destroyed) return;
    const next = store.getState();
    if (state && ["mode", "selectedTeamId", "selectedPlayerId"].some(key => state[key] !== next[key])
      || state && state.timeRange.some((value, index) => value !== next.timeRange[index])) { requested = []; selectedKey = null; }
    state = next;
    selection = selectHypergraphEdges(dataset, state);
    groups = groupHypergraphEdges(selection.edges, state.selectedPlayerId, requested);
    shown = groups.slice(0, Number(limit.value));
    if (!shown.some(group => group.key === selectedKey)) selectedKey = null;
    root.dataset.mode = selection.mode;
    root.dataset.rawCount = selection.edges.length; root.dataset.displayedGroups = shown.length;
    const relatedCount = selection.edges.filter(edge => edge.player_ids.includes(state.selectedPlayerId)).length;
    summary.textContent = `${selection.edges.length} 个原始片段 / ${groups.length} 个完整组合；显示 ${shown.length} 个组合${state.selectedPlayerId ? ` · ${playerName(state.selectedPlayerId)} 关联 ${relatedCount} 个片段（关联组合优先）` : ""}。${selection.invalidCount ? `跳过 ${selection.invalidCount} 条无效关系。` : ""}`;
    eyebrow.textContent = selection.mode === "competition" ? "COMPETITION / EVENT WINDOW INFERENCE" : "COLLABORATION / COMPLETE PASS CHAINS";
    explanation.textContent = selection.mode === "competition"
      ? "虚线包络：短事件窗口推断的跨队关联，不是逐帧同时对抗。编号旁 ×N 表示该完整组合在当前筛选中出现的原始片段数。"
      : "实线包络：同队成功传球链中的至少三名球员。编号旁 ×N 表示该完整组合在当前筛选中出现的原始片段数，重叠窗口不等于独立进攻次数。";
    buttons.clear.disabled = !state.selectedPlayerId;
    const teams = [...new Set([...(dataset.stats?.teams ?? []).map(team => team.team_id), ...dataset.players.map(player => player.team_id)])];
    const color = team => COLORS[teams.indexOf(team) % COLORS.length];
    legend.replaceChildren();
    for (const team of teams) {
      const chip = element("span", "hg-team", dataset.players.find(player => player.team_id === team)?.team_name || team);
      chip.style.setProperty("--hg-team", color(team)); legend.append(chip);
    }
    legend.append(element("span", "hg-boundary", selection.mode === "competition" ? "┄ 推断对抗超边" : "━ 同队协作超边"));
    empty.hidden = shown.length > 0;
    empty.textContent = !selection.available ? "该模式的关系数据尚未提供。请先运行对应构建脚本。"
      : "当前球队或时间区间内没有满足至少三名球员条件的超边。可扩大时间区间或取消球队筛选。";
    svg.attr("hidden", shown.length ? null : "");
    const ids = new Set(shown.flatMap(group => group.playerIds));
    const signature = JSON.stringify([selection.mode, shown.map(group => group.key).sort()]);
    if (signature !== layoutKey) {
      nodeMap = new Map(layout(dataset.players.filter(player => ids.has(player.player_id)), shown, teams, positions).map(node => [node.id, node]));
      layoutKey = signature;
    }
    const paths = edgeLayer.selectAll("path").data(shown, group => group.key).join("path")
      .attr("class", "hg-edge").attr("data-player-count", group => group.playerIds.length)
      .attr("data-edge-ids", group => group.edges.map(edge => edge.edge_id).join(" "))
      .attr("fill", group => selection.mode === "competition" ? "#b16a38" : color(dataset.players.find(player => player.player_id === group.playerIds[0]).team_id))
      .attr("stroke", group => selection.mode === "competition" ? "#995225" : color(dataset.players.find(player => player.player_id === group.playerIds[0]).team_id))
      .on("click", (event, group) => { event.stopPropagation(); selectGroup(group); });
    paths.selectAll("title").data(group => [group]).join("title").text(group => `${group.playerIds.map(playerName).join("、")} · ${group.edges.length} 个片段`);
    const badges = badgeLayer.selectAll("g").data(shown, group => group.key).join(enter => {
      const item = enter.append("g").attr("class", "hg-badge"); item.append("rect").attr("x", -31).attr("y", -12).attr("width", 62).attr("height", 24).attr("rx", 12); item.append("text").attr("text-anchor", "middle").attr("dy", ".35em"); return item;
    }).on("click", (event, group) => { event.stopPropagation(); selectGroup(group); });
    badges.select("text").text((group, index) => `${String(index + 1).padStart(2, "0")} ×${group.edges.length}`);
    const nodes = nodeLayer.selectAll("g").data([...nodeMap.values()], node => node.id).join(enter => {
      const item = enter.append("g").attr("class", "hg-node").attr("role", "button").attr("tabindex", 0);
      item.append("circle").attr("r", 10); item.append("text").attr("y", 25).attr("text-anchor", "middle"); item.append("title"); return item;
    }).attr("data-player-id", node => node.id).attr("aria-label", node => `选择球员 ${node.player_name || node.id}`)
      .on("click", (event, node) => { event.stopPropagation(); store.setState({ selectedPlayerId: node.id }); })
      .on("keydown", (event, node) => {
        if (["Enter", " "].includes(event.key)) { event.preventDefault(); store.setState({ selectedPlayerId: node.id }); }
        const delta = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[event.key];
        if (delta) { event.preventDefault(); moveNode(node, node.x + delta[0], node.y + delta[1]); }
      }).call(d3.drag().on("start", event => event.sourceEvent.stopPropagation()).on("drag", (event, node) => moveNode(node, event.x, event.y)));
    nodes.select("circle").attr("fill", node => color(node.team_id));
    nodes.select("text").text(node => node.player_name?.split(" ").slice(-2).join(" ") || node.id);
    nodes.select("title").text(node => `${node.player_name || node.id} · ${node.team_name || node.team_id}`);
    choices.replaceChildren();
    shown.forEach((group, index) => {
      const button = element("button", "hg-choice", `${String(index + 1).padStart(2, "0")} · ${group.playerIds.map(playerName).join(" / ")} · ${group.edges.length} 片段`);
      button.type = "button"; button.dataset.groupKey = group.key; button.onclick = () => selectGroup(group); choices.append(button);
    });
    geometry(); paintHighlights(); showDetail();
  }
  function moveNode(node, x, y) {
    node.x = Math.max(30, Math.min(WIDTH - 30, x)); node.y = Math.max(30, Math.min(HEIGHT - 30, y));
    positions.set(node.id, { x: node.x, y: node.y }); geometry();
  }
  function combinationRequest(event) {
    const data = event.detail;
    if (!data || data.mode !== state.mode || data.playerId !== state.selectedPlayerId
      || !Array.isArray(data.timeRange) || !state.timeRange.every((value, index) => value === data.timeRange[index]) || !Array.isArray(data.edgeIds)) return;
    requested = data.edgeIds.filter(edgeId => selection.edges.some(edge => edge.edge_id === edgeId));
    selectedKey = null; render();
    if (requested.length && shown[0]?.requested) { selectedKey = shown[0].key; paintHighlights(); showDetail(); }
  }
  // Delegated bubbling request, scoped to the document that owns this container.
  document.addEventListener("playeranalysis:select-edges", combinationRequest);
  const off = store.subscribe(render);
  const handle = {
    updateDataset(next) { if (destroyed) return; dataset = next; positions.clear(); layoutKey = null; requested = []; selectedKey = null; render(); },
    destroy() {
      if (destroyed) return; destroyed = true; off();
      document.removeEventListener("playeranalysis:select-edges", combinationRequest);
      svg.on(".zoom", null); nodeLayer.selectAll("g").on(".drag", null); root.remove();
      if (container.__hypergraphHandle === handle) delete container.__hypergraphHandle;
    },
  };
  container.__hypergraphHandle = handle;
  render();
  return handle;
}
