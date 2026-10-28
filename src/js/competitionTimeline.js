/** Module D controls. B alone renders the main hypergraph. */
// D reads the frozen event contract directly; it does not require C-only APIs.
const finite = value => typeof value === "number" && Number.isFinite(value);
export function eventMinute(event) {
  if (finite(event?.time_seconds) && event.time_seconds >= 0) return event.time_seconds / 60;
  if (finite(event?.minute) && event.minute >= 0 && (event.second == null || (finite(event.second) && event.second >= 0 && event.second < 60))) {
    return event.minute + (event.second ?? 0) / 60;
  }
  return null;
}

export function getDatasetTimeRange(dataset = {}) {
  let maximum = 0;
  for (const event of dataset.events ?? []) {
    if (Number(event.period) !== 5) maximum = Math.max(maximum, eventMinute(event) ?? 0);
  }
  for (const edge of [...(dataset.collaborationEdges ?? []), ...(dataset.competitionEdges ?? [])]) {
    if (finite(edge.end_minute)) maximum = Math.max(maximum, edge.end_minute);
  }
  return [0, maximum];
}

export const edgeIntersects = (edge, [start, end]) => edge.end_minute >= start && edge.start_minute <= end;

export function selectTimelineEdges(dataset, state) {
  const source = state.mode === "competition" ? dataset.competitionEdges : dataset.collaborationEdges;
  return (Array.isArray(source) ? source : []).filter(edge => edgeIntersects(edge, state.timeRange)
    && (!state.selectedTeamId || edge.team_ids.includes(state.selectedTeamId)));
}

let sequence = 0;
export function mountCompetitionTimeline(container, store, dataset) {
  if (!container?.ownerDocument || !store?.getState || !store?.setState || !store?.subscribe) throw new TypeError("时间轴需要容器和统一 store。");
  const document = container.ownerDocument;
  const root = document.createElement("section");
  root.className = "ct-panel";
  const prefix = `ct-${++sequence}`;
  root.innerHTML = `
    <div class="ct-heading"><h2>关系与比赛时间</h2><span class="ct-range-label"></span></div>
    <fieldset class="ct-modes"><legend>关系模式</legend>
      <button type="button" data-mode="collaboration">Collaboration · 协作</button>
      <button type="button" data-mode="competition">Competition · 对抗</button>
    </fieldset>
    <p class="ct-explanation"></p>
    <label class="ct-team-label">参与球队 <select class="ct-team"><option value="">全部球队</option></select></label>
    <div class="ct-histogram" role="img" aria-label="每五分钟的已记录对抗事件数量；用于导航，不是对抗强度"></div>
    <p class="ct-axis-note">刻度：每 5 分钟已记录的对抗事件数；不代表完整攻防强度。</p>
    <div class="ct-endpoints">
      <div><label for="${prefix}-start">开始分钟</label><input id="${prefix}-start" class="ct-start" type="range" min="0" step="any"><input class="ct-start-number" type="number" min="0" step="any" aria-label="开始分钟数值"></div>
      <div><label for="${prefix}-end">结束分钟</label><input id="${prefix}-end" class="ct-end" type="range" min="0" step="any"><input class="ct-end-number" type="number" min="0" step="any" aria-label="结束分钟数值"></div>
    </div>
    <button class="ct-reset" type="button">查看全场</button>
    <p class="ct-status" role="status" aria-live="polite"></p>`;
  const find = selector => root.querySelector(selector);
  let destroyed = false;
  const [minimum, maximum] = getDatasetTimeRange(dataset);
  const teams = new Map((dataset.players ?? []).map(player => [player.team_id, player.team_name || player.team_id]));
  for (const [id, name] of teams) {
    const option = document.createElement("option");
    option.value = id; option.textContent = name; find(".ct-team").append(option);
  }
  for (const input of root.querySelectorAll("input")) {
    input.max = String(maximum); input.disabled = maximum === minimum;
  }
  const binCount = Math.max(1, Math.ceil(maximum / 5));
  const bins = Array(binCount).fill(0);
  const anchorTypes = new Set(["Pressure", "Duel", "Interception", "Dispossessed", "Ball Recovery"]);
  for (const event of dataset.events ?? []) {
    const minute = eventMinute(event);
    if (Number(event.period) !== 5 && anchorTypes.has(event.type) && minute !== null) bins[Math.min(binCount - 1, Math.floor(minute / 5))]++;
  }
  const peak = Math.max(1, ...bins);
  bins.forEach((count, index) => {
    const bar = document.createElement("span");
    bar.className = "ct-bin"; bar.style.height = `${Math.max(3, count / peak * 100)}%`;
    bar.title = `${index * 5}–${Math.min(maximum, (index + 1) * 5).toFixed(2)} 分钟：${count} 条对抗事件`;
    find(".ct-histogram").append(bar);
  });
  function render() {
    if (destroyed) return;
    const state = store.getState();
    root.dataset.mode = state.mode;
    for (const button of root.querySelectorAll("[data-mode]")) button.setAttribute("aria-pressed", String(button.dataset.mode === state.mode));
    [".ct-start", ".ct-start-number"].forEach(selector => { find(selector).value = String(state.timeRange[0]); });
    [".ct-end", ".ct-end-number"].forEach(selector => { find(selector).value = String(state.timeRange[1]); });
    find(".ct-team").value = state.selectedTeamId ?? "";
    find(".ct-range-label").textContent = `${Number(state.timeRange[0].toFixed(3))}′ – ${Number(state.timeRange[1].toFixed(3))}′ / ${Number(maximum.toFixed(3))}′`;
    find(".ct-explanation").textContent = state.mode === "competition"
      ? "对抗边依据同一控球片段内的短事件窗口推断，至少三人、跨至少两队；不是逐帧站位、直接一对一对抗或成功接球的证明。"
      : "协作边表示同队多人共同参与的有限事件片段。超边形状和节点编码由主视图图例解释。";
    const count = selectTimelineEdges(dataset, state).length;
    const source = state.mode === "competition" ? dataset.competitionEdges : dataset.collaborationEdges;
    find(".ct-status").textContent = !Array.isArray(source) ? "关系文件未载入，请查看页面错误说明。"
      : count ? `当前时段与球队有 ${count} 条原始${state.mode === "competition" ? "对抗" : "协作"}超边。相交片段完整计一次；球员选择只请求高亮。`
        : state.mode === "competition" ? "当前范围没有符合证据条件的对抗超边。空数据不代表比赛没有对抗；不会补造参与者。"
          : "当前范围没有协作超边。可调整时间或球队。";
    [...find(".ct-histogram").children].forEach((bar, index) => { bar.classList.toggle("ct-bin-active", (index + 1) * 5 >= state.timeRange[0] && index * 5 <= state.timeRange[1]); });
  }
  const onClick = event => {
    const button = event.target.closest?.("button");
    if (button?.dataset.mode) store.setState({ mode: button.dataset.mode });
    else if (button?.classList.contains("ct-reset")) store.setState({ timeRange: [minimum, maximum] });
  };
  const onInput = event => {
    const input = event.target;
    if (input.tagName !== "INPUT") return;
    if (input.value.trim() === "" || !Number.isFinite(Number(input.value))) return;
    const value = Math.min(maximum, Math.max(minimum, Number(input.value)));
    const [start, end] = store.getState().timeRange;
    const isStart = input.classList.contains("ct-start") || input.classList.contains("ct-start-number");
    store.setState({ timeRange: isStart ? [value, Math.max(value, end)] : [Math.min(start, value), value] });
    render();
  };
  const onChange = event => {
    if (event.target === find(".ct-team")) store.setState({ selectedTeamId: event.target.value || null });
    else if (event.target.tagName === "INPUT") render();
  };
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
  container.append(root);
  const unsubscribe = store.subscribe(render);
  render();
  return { destroy() {
    if (destroyed) return;
    destroyed = true; unsubscribe();
    root.removeEventListener("click", onClick); root.removeEventListener("input", onInput); root.removeEventListener("change", onChange);
    root.remove();
  } };
}
