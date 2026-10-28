/**
 * Module A: Match Overview（比赛概览）
 *
 * Team contract (docs/TEAM_TASKS.md §3.5):
 *   mountDataExplorer(container, store, dataset, options?) -> { updateDataset, destroy }
 *   options.theme: "dark"（默认）| "light"
 *
 * Pure helpers are exported for unit tests:
 *   exploreMatch, eventMinute, getDataTimeRange, periodSpans, xgTimeline, matchClockLabel,
 *   matchStory, shortPlayerName, resolveTimeBrush, shotRadius
 *
 * Rules kept from the data contract:
 *   - every number comes from the dataset; missing values render as "N/A", never 0;
 *   - shootout events (period 5) never enter match statistics;
 *   - all DOM writes stay inside `container`; shared state changes only via store.setState.
 */

const STYLE_URL = new URL("../css/dataExplorer.css", import.meta.url).href;
const LOGO_URL = new URL("../assets/statsbomb-logo.png", import.meta.url).href;
const SVG_NS = "http://www.w3.org/2000/svg";

const REGULAR_PERIODS = [1, 2, 3, 4];
/** Nominal start minute of each period on the StatsBomb match clock. */
const PERIOD_START = { 1: 0, 2: 45, 3: 90, 4: 105, 5: 120 };
/** Regulation end minute, used for "45+2′" style stoppage labels. */
const PERIOD_END = { 1: 45, 2: 90, 3: 105, 4: 120 };
const PERIOD_NAMES = { 1: "上半场", 2: "下半场", 3: "加时上半场", 4: "加时下半场", 5: "点球大战" };
const PERIOD_SHORT = { 1: "上半场", 2: "下半场", 3: "加时上", 4: "加时下" };

const TEAM_NAMES = { Argentina: "阿根廷", France: "法国" };
const TEAM_CODES = { Argentina: "ARG", France: "FRA" };
/**
 * Chinese display names for players who appear in headlines and chart annotations
 * (scorers, shootout takers, goalkeepers). Display aliases only; every other
 * player keeps the full source name from players.json.
 */
const PLAYER_SHORT_NAMES = {
  5503: "梅西",
  2995: "迪马利亚",
  3009: "姆巴佩",
  5743: "迪巴拉",
  16308: "帕雷德斯",
  28263: "蒙铁尔",
  6909: "马丁内斯",
  10481: "琼阿梅尼",
  22097: "科洛·穆阿尼",
  8217: "科曼",
  3099: "洛里斯",
};
const COUNT_WORDS = { 1: "一度", 2: "两度", 3: "三度" };
const TYPE_NAMES = {
  Pass: "传球",
  "Ball Receipt*": "接球",
  Carry: "带球",
  Pressure: "施压",
  "Ball Recovery": "球权回收",
  Duel: "对抗",
  Dribble: "过人",
  "Dribbled Past": "被过",
  Block: "封堵",
  "Foul Committed": "犯规",
  "Foul Won": "被犯规",
  Clearance: "解围",
  "Goal Keeper": "门将动作",
  Shot: "射门",
  Dispossessed: "被抢断",
  Miscontrol: "停球失误",
  Interception: "拦截",
  "50/50": "五五球",
  Substitution: "换人",
  "Tactical Shift": "阵型调整",
  "Injury Stoppage": "伤停",
  "Half Start": "阶段开始",
  "Half End": "阶段结束",
  "Starting XI": "首发阵容",
  "Bad Behaviour": "不当行为",
  Offside: "越位",
  Shield: "护球出界",
  "Player On": "球员回场",
  "Player Off": "球员离场",
};
const OUTCOME_NAMES = {
  complete: "成功",
  incomplete: "未成功",
  out: "出界",
  "pass offside": "越位",
  unknown: "未知",
  "injury clearance": "伤停解围",
  goal: "进球",
  saved: "被扑出",
  "saved twice": "两次扑救",
  blocked: "被封堵",
  "off t": "偏出",
  post: "击中门柱",
  wayward: "偏离",
  won: "赢得",
  lost: "失去",
  "lost in play": "失去（比赛继续）",
  "lost out": "失去（出界）",
  "success in play": "成功（比赛继续）",
  success: "成功",
};
/** Pass outcomes the StatsBomb specification defines; anything else counts as "unknown". */
const KNOWN_PASS_OUTCOMES = ["complete", "incomplete", "out", "pass offside", "injury clearance"];
const SHOT_GOAL = "goal";
const PAGE_SIZE = 12;

/* ------------------------------------------------------------------ helpers */

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const id = (value) => (value == null || value === "" ? null : String(value));
const list = (value) => (Array.isArray(value) ? value : []);
const regular = (event) => REGULAR_PERIODS.includes(Number(event?.period));
const typeOf = (event) => (typeof event?.type === "string" && event.type ? event.type : "Unknown");
const validXg = (value) => finite(value) && value >= 0 && value <= 1;
const display = (value) => (finite(value) ? value.toLocaleString("zh-CN") : "N/A");
const pct = (value) => (finite(value) ? `${(value * 100).toFixed(1)}%` : "N/A");
const xgText = (value) => (finite(value) ? value.toFixed(2) : "N/A");
const numberLabel = (value) => Number(value.toFixed(2));
const typeName = (type) => TYPE_NAMES[type] || type;
const typeLabel = (type) => (TYPE_NAMES[type] ? `${TYPE_NAMES[type]} ${type}` : type);
const teamCode = (team) =>
  TEAM_CODES[team?.team_name] ||
  String(team?.team_name || team?.team_id || "?")
    .slice(0, 3)
    .toUpperCase();
const teamLabel = (team) => TEAM_NAMES[team?.team_name] || team?.team_name || team?.team_id || "未知球队";
const outcomeLabel = (outcome) => (outcome ? OUTCOME_NAMES[outcome] || outcome : "—");
const rawClock = (event) => `${event?.minute ?? "?"}:${String(event?.second ?? "?").padStart(2, "0")}`;
const byMatchOrder = (a, b) =>
  Number(a.period) - Number(b.period) || Number(a.event_index) - Number(b.event_index);

/** Minutes on the source match clock (StatsBomb minute + second / 60). */
export function eventMinute(event) {
  if (finite(event?.time_seconds) && event.time_seconds >= 0) return event.time_seconds / 60;
  const { minute, second } = event ?? {};
  if (finite(minute) && minute >= 0 && finite(second) && second >= 0 && second < 60) {
    return minute + second / 60;
  }
  return null;
}

/** Resolve a brush without inventing a continuous clock across period boundaries. */
export function resolveTimeBrush(start, end) {
  if (
    !REGULAR_PERIODS.includes(Number(start?.period)) ||
    !REGULAR_PERIODS.includes(Number(end?.period)) ||
    !finite(start?.minute) || start.minute < 0 ||
    !finite(end?.minute) || end.minute < 0
  ) return { accepted: false, reason: "invalid" };
  if (Number(start.period) !== Number(end.period)) return { accepted: false, reason: "cross-period" };
  return {
    accepted: true,
    period: Number(start.period),
    timeRange: [start.minute, end.minute].sort((a, b) => a - b).map((value) => Math.round(value * 100) / 100),
  };
}

/** A circle's fill area is pi * 3.6^2 * xG, with no minimum visible radius. */
export function shotRadius(xg) {
  return validXg(xg) ? Math.sqrt(xg) * 3.6 : null;
}

/** Full regular-time window [0, last minute of period 4]; shootout excluded. */
export function getDataTimeRange(dataset = {}) {
  const minutes = list(dataset.events)
    .filter(regular)
    .map((event) => eventMinute(event) ?? 0);
  return [0, Math.max(0, ...minutes)];
}

/**
 * Broadcast-style minute label: 22:24 on the clock is the 23rd minute;
 * first-half stoppage at 46:10 becomes "45+2′".
 */
export function matchClockLabel(event) {
  const minute = event?.minute;
  if (!Number.isInteger(minute) || minute < 0) return "?";
  const shown = minute + 1;
  const end = PERIOD_END[Number(event?.period)];
  return end && shown > end ? `${end}+${shown - end}′` : `${shown}′`;
}

/**
 * Each regular period's span on the source clock. Periods overlap on the clock
 * (first-half stoppage runs past 45′ while the second half restarts at 45′),
 * so charts draw one panel per period instead of one continuous axis.
 */
export function periodSpans(events = []) {
  const spans = [];
  for (const period of REGULAR_PERIODS) {
    const minutes = list(events)
      .filter((event) => Number(event?.period) === period)
      .map(eventMinute)
      .filter(finite);
    if (!minutes.length) continue;
    const start = Math.min(PERIOD_START[period], ...minutes);
    const end = Math.max(...minutes);
    spans.push({ period, start, end: end > start ? end : start + 1 });
  }
  return spans;
}

/**
 * Cumulative xG per team in match order, regular periods only.
 * `complete` is false when any shot lacks a valid source xG, so callers never
 * draw a partial total as if it were the full value.
 */
export function xgTimeline(events = [], teamIds = []) {
  const shots = list(events)
    .filter((event) => regular(event) && event.type === "Shot")
    .sort(byMatchOrder);
  const complete = shots.length > 0 && shots.every((event) => validXg(event.xg));
  const teams = teamIds.map((teamId) => {
    let cumulative = 0;
    const steps = [];
    for (const event of shots) {
      if (id(event.team_id) !== teamId || !validXg(event.xg)) continue;
      cumulative += event.xg;
      steps.push({ event, minute: eventMinute(event), period: Number(event.period), cumulative });
    }
    return { team_id: teamId, steps, total: complete ? cumulative : null };
  });
  const maxXg = Math.max(0, ...teams.flatMap((team) => team.steps.map((step) => step.cumulative)));
  return { complete, shotCount: shots.length, teams, maxXg };
}

function passMetrics(passes) {
  const outcomesKnown = passes.every(
    (event) => typeof event.outcome === "string" && event.outcome.trim().length > 0,
  );
  const successful = passes.filter((event) => event.outcome === "complete").length;
  return {
    passes: passes.length,
    successfulPasses: outcomesKnown ? successful : null,
    passAccuracy: outcomesKnown && passes.length ? successful / passes.length : null,
    unknownPasses: passes.filter((event) => !KNOWN_PASS_OUTCOMES.includes(event.outcome)).length,
  };
}

function sumXg(shots, hasXg) {
  if (!hasXg || !shots.every((event) => validXg(event.xg))) return null;
  return shots.reduce((sum, event) => sum + event.xg, 0);
}

const COMPARISON_ROWS = [
  { key: "shots", label: "射门", type: "Shot" },
  { key: "xg", label: "xG", format: xgText },
  { key: "passes", label: "传球", type: "Pass" },
  { key: "pass_accuracy", label: "传球成功率", format: pct, percent: true },
  { key: "pressure", label: "施压", type: "Pressure" },
  { key: "recovery", label: "球权回收", type: "Ball Recovery" },
  { key: "interception", label: "拦截", type: "Interception" },
  { key: "fouls", label: "犯规", type: "Foul Committed" },
];

function compareTeams(events, teams, hasXg) {
  return COMPARISON_ROWS.map((row) => {
    const values = {};
    for (const team of teams) {
      const own = events.filter((event) => id(event.team_id) === team.team_id);
      if (row.type) values[team.team_id] = own.filter((event) => event.type === row.type).length;
      else if (row.key === "xg") {
        values[team.team_id] = sumXg(
          own.filter((event) => event.type === "Shot"),
          hasXg,
        );
      } else {
        values[team.team_id] = passMetrics(own.filter((event) => event.type === "Pass")).passAccuracy;
      }
    }
    return { ...row, values };
  });
}

/** Pure data model, also used by tests. No fabricated metrics for missing inputs. */
export function exploreMatch(dataset = {}, state = {}, filters = {}) {
  const players = list(dataset.players).filter((player) => player && id(player.player_id));
  const events = list(dataset.events).filter((event) => event && typeof event === "object");
  const playerNames = new Map(players.map((player) => [id(player.player_id), player.player_name]));

  const teams = new Map();
  for (const team of list(dataset.stats?.teams)) {
    if (team && id(team.team_id)) teams.set(id(team.team_id), { ...team, team_id: id(team.team_id) });
  }
  for (const player of players) {
    const teamId = id(player.team_id);
    if (teamId && !teams.has(teamId)) {
      teams.set(teamId, { team_id: teamId, team_name: player.team_name || `球队 ${teamId}` });
    }
  }
  const teamList = [...teams.values()].map((team, slot) => ({ ...team, slot: slot % 2 }));

  const validRange =
    Array.isArray(state.timeRange) && state.timeRange.length === 2 && state.timeRange.every(finite);
  const timeRange = validRange
    ? [Math.max(0, Math.min(...state.timeRange)), Math.max(0, Math.max(...state.timeRange))]
    : getDataTimeRange(dataset);
  const selectedTeamId = id(state.selectedTeamId);
  const period = Number(filters.period) || null;

  // Time + period scope, both teams. Feeds the team comparison.
  const scopedBothTeams = events.filter((event) => {
    const minute = eventMinute(event);
    return (
      regular(event) &&
      (!period || Number(event.period) === period) &&
      minute !== null &&
      minute >= timeRange[0] &&
      minute <= timeRange[1]
    );
  });
  // + team filter. Feeds distribution, shot map and roster baseline.
  const scoped = scopedBothTeams.filter((event) => !selectedTeamId || id(event.team_id) === selectedTeamId);

  const types = [...new Set(events.filter(regular).map(typeOf))].sort();
  const eventType =
    typeof filters.eventType === "string" && types.includes(filters.eventType) ? filters.eventType : "";
  // + event type. Feeds the metric strip, roster counts and the evidence table.
  const filtered = scoped.filter((event) => !eventType || typeOf(event) === eventType).sort(byMatchOrder);

  const counts = new Map();
  for (const event of scoped) counts.set(typeOf(event), (counts.get(typeOf(event)) || 0) + 1);
  const distribution = [...counts]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

  const involvement = new Map();
  for (const event of filtered) {
    const participants = new Set([id(event.player_id), id(event.recipient_id)].filter(Boolean));
    for (const playerId of participants) involvement.set(playerId, (involvement.get(playerId) || 0) + 1);
  }
  const recordedIds = new Set(
    events.filter(regular).flatMap((event) => [id(event.player_id), id(event.recipient_id)]),
  );
  const roster = players
    .filter((player) => !selectedTeamId || id(player.team_id) === selectedTeamId)
    .map((player) => ({
      ...player,
      involvement: involvement.get(id(player.player_id)) || 0,
      hasRecordedEvents: recordedIds.has(id(player.player_id)),
    }))
    .sort(
      (a, b) => b.involvement - a.involvement || String(a.player_name).localeCompare(String(b.player_name)),
    );

  const hasXg = events.some((event) => regular(event) && event.type === "Shot" && validXg(event.xg));
  const shotsFiltered = filtered.filter((event) => event.type === "Shot");

  const goals = events
    .filter(
      (event) =>
        regular(event) &&
        ((event.type === "Shot" && event.outcome === SHOT_GOAL) || event.type === "Own Goal For"),
    )
    .sort(byMatchOrder)
    .map((event) => ({
      event,
      team_id: id(event.team_id),
      player_id: id(event.player_id),
      player_name: playerNames.get(id(event.player_id)) || null,
      own_goal: event.type === "Own Goal For",
      label: matchClockLabel(event),
    }));

  const shootout = teamList.map((team) => ({
    team_id: team.team_id,
    kicks: events
      .filter(
        (event) => Number(event.period) === 5 && event.type === "Shot" && id(event.team_id) === team.team_id,
      )
      .sort(byMatchOrder)
      .map((event) => ({ event, scored: event.outcome === SHOT_GOAL })),
  }));

  return {
    teams: teamList,
    types,
    distribution,
    events: filtered,
    roster,
    timeRange,
    selectedTeamId,
    eventType,
    period,
    selectedPlayerId: id(state.selectedPlayerId),
    sourceAvailable: Array.isArray(dataset.events),
    totalEvents: events.length,
    regularEvents: events.filter(regular).length,
    shootoutEvents: events.filter((event) => Number(event.period) === 5).length,
    missingTimes: events.filter((event) => regular(event) && eventMinute(event) === null).length,
    hasExtraTime: events.some((event) => [3, 4].includes(Number(event.period))),
    goals,
    shootout,
    shots: scoped.filter((event) => event.type === "Shot").sort(byMatchOrder),
    comparison: compareTeams(scopedBothTeams, teamList, hasXg),
    metrics: {
      events: filtered.length,
      involvedPlayers: involvement.size,
      ...passMetrics(filtered.filter((event) => event.type === "Pass")),
      shots: shotsFiltered.length,
      xg: sumXg(shotsFiltered, hasXg),
    },
  };
}

/** Short display name: Chinese alias when known, otherwise the full source name. */
export function shortPlayerName(playerId, fullName) {
  return PLAYER_SHORT_NAMES[id(playerId)] || fullName || "姓名未提供";
}

/**
 * One-sentence result derived from the goal sequence and the score fields,
 * e.g. "阿根廷两度领先，两度被法国扳平，点球大战 4–2 胜出".
 */
export function matchStory(model) {
  const [home, away] = model?.teams ?? [];
  if (!home || !away) return "";
  const running = { [home.team_id]: 0, [away.team_id]: 0 };
  const leads = { [home.team_id]: 0, [away.team_id]: 0 };
  const equalisers = { [home.team_id]: 0, [away.team_id]: 0 };
  for (const goal of list(model.goals)) {
    const scorer = goal.team_id;
    if (!(scorer in running)) continue;
    const other = scorer === home.team_id ? away.team_id : home.team_id;
    const margin = running[scorer] - running[other];
    running[scorer] += 1;
    if (margin === 0) leads[scorer] += 1;
    else if (margin === -1) equalisers[scorer] += 1;
  }
  const homeScore = finite(home.score) ? home.score : running[home.team_id];
  const awayScore = finite(away.score) ? away.score : running[away.team_id];
  const times = (count) => COUNT_WORDS[count] || `${count} 次`;
  if (homeScore !== awayScore) {
    const [winner, loser] = homeScore > awayScore ? [home, away] : [away, home];
    const [high, low] = [Math.max(homeScore, awayScore), Math.min(homeScore, awayScore)];
    return `${teamLabel(winner)} ${high}–${low} 战胜${teamLabel(loser)}`;
  }
  const shootout = finite(home.shootout_score) && finite(away.shootout_score);
  if (!shootout || home.shootout_score === away.shootout_score) {
    return `${teamLabel(home)} ${homeScore}–${awayScore} 战平${teamLabel(away)}`;
  }
  const [winner, loser] = home.shootout_score > away.shootout_score ? [home, away] : [away, home];
  const penalties = `点球大战 ${winner.shootout_score}–${loser.shootout_score} 胜出`;
  const winnerLeads = leads[winner.team_id];
  const loserLeads = leads[loser.team_id];
  if (winnerLeads > 0 && loserLeads === 0 && equalisers[loser.team_id] === winnerLeads) {
    return `${teamLabel(winner)}${times(winnerLeads)}领先，${times(winnerLeads)}被${teamLabel(loser)}扳平，${penalties}`;
  }
  if (loserLeads > 0 && winnerLeads === 0 && equalisers[winner.team_id] === loserLeads) {
    return `${teamLabel(winner)}${times(loserLeads)}扳平比分，${penalties}`;
  }
  return `${teamLabel(winner)}${penalties}`;
}

/* --------------------------------------------------------------- DOM utils */

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svg(doc, tag, attributes = {}, className) {
  const node = doc.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  if (className) node.setAttribute("class", className);
  return node;
}

let mountCount = 0;

const TEMPLATE = `
  <header class="de-card de-match">
    <div class="de-scoreboard"></div>
    <p class="de-headline"></p>
  </header>

  <div class="de-toolbar">
    <div class="de-seg de-team-group" role="group" aria-label="筛选球队"></div>
    <div class="de-seg de-period-group" role="group" aria-label="筛选比赛阶段"></div>
    <label class="de-select">
      <select class="de-type" aria-label="筛选事件类型"></select>
    </label>
    <button type="button" class="de-reset">重置</button>
    <p class="de-context">
      <span class="de-window"></span>
      <span class="de-count" role="status" aria-live="polite"></span>
    </p>
  </div>

  <div class="de-metrics"></div>

  <div class="de-row de-row-a">
    <section class="de-card de-xg">
      <div class="de-card-head">
        <h3>xG 走势</h3>
        <div class="de-xg-legend"></div>
        <button type="button" class="de-chip de-xg-all">全场</button>
      </div>
      <p class="de-xg-help">拖选限单个阶段；阶段仅筛选 A，原始分钟区间与其他模块共享。</p>
      <div class="de-xg-plot" title="在同一比赛阶段内拖动选择时间段"></div>
      <p class="de-brush-message" role="status" aria-live="polite" aria-atomic="true"></p>
      <p class="de-xg-empty" hidden></p>
    </section>
    <section class="de-card de-compare">
      <div class="de-card-head"><h3>两队对比</h3></div>
      <div class="de-compare-rows"></div>
    </section>
  </div>

  <div class="de-row de-row-b">
    <section class="de-card de-shotmap">
      <div class="de-card-head">
        <h3>射门分布</h3>
        <p class="de-pitch-legend"></p>
      </div>
      <div class="de-pitches"></div>
      <p class="de-shot-note">圆面积与 xG 成正比；实色表示进球，浅色表示未进。问号表示 xG 缺失，0 表示零 xG，均不赋予正面积。虚线仅表示悬停或键盘焦点的交互区域。</p>
    </section>
    <section class="de-card de-chart-panel">
      <div class="de-card-head"><h3>事件构成</h3></div>
      <div class="de-bars"></div>
      <p class="de-chart-empty" hidden>这个范围内没有事件。</p>
    </section>
  </div>

  <section class="de-card de-tabs-card">
    <div class="de-tabs" role="tablist" aria-label="详细数据">
      <button type="button" role="tab" class="de-tab" data-de-tab="players" aria-selected="true">球员</button>
      <button type="button" role="tab" class="de-tab" data-de-tab="events" aria-selected="false">事件记录</button>
      <span class="de-tab-meta de-roster-count"></span>
    </div>

    <div class="de-tab-panel de-roster-panel" role="tabpanel" data-de-panel="players">
      <p class="de-roster-note">“无关联事件”只表示本场第 1–4 节没有该球员发起或被列为传球对象的记录，包含已登场但没有关联事件的球员。</p>
      <div class="de-roster"></div>
    </div>

    <div class="de-tab-panel de-event-panel" role="tabpanel" data-de-panel="events" hidden>
      <div class="de-table-scroll">
        <table class="de-table">
          <thead>
            <tr><th>时间</th><th>事件</th><th>球员 → 传球对象</th><th>结果</th><th>原始序号</th></tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
      <p class="de-table-empty" hidden>没有符合当前条件的事件。</p>
      <div class="de-pagination">
        <span class="de-page-count"></span>
        <button type="button" class="de-chip de-prev">上一页</button>
        <button type="button" class="de-chip de-next">下一页</button>
      </div>
      <details class="de-evidence">
        <summary>原始记录</summary>
        <pre class="de-record"></pre>
      </details>
    </div>
  </section>

  <footer class="de-foot">
    <p class="de-attribution">
      <img class="de-source-logo" alt="StatsBomb" />
      <span>数据：<a href="https://github.com/hudl/open-data" target="_blank" rel="noreferrer">StatsBomb Open Data</a>，比赛 <span class="de-match-id"></span></span>
    </p>
    <p class="de-quality" role="status"></p>
    <details class="de-notes">
      <summary>统计口径</summary>
      <ul>
        <li class="de-scope-note">比分含加时赛，点球大战单独显示；其余统计只计第 1–4 阶段。</li>
        <li class="de-clock-note">时间沿用数据源的比赛时钟：上半场补时与下半场开场的分钟数会重叠，所以 xG 走势按阶段分段画；要精确看某个半场，请同时选择比赛阶段。事件类型与比赛阶段仅筛选本概览；球队、时间段及球员选择通过共享状态与其他模块联动。</li>
        <li>传球成功率 = 已确认成功的传球 / 全部传球；结果为“未知”的传球计入分母、不算成功。</li>
        <li>xG 只累加数据源提供的 StatsBomb xG；射门图中圆的面积与 xG 成正比。</li>
        <li>球员数字是该球员发起或被列为传球对象的事件数，每条只计一次；传球对象不代表一定接到球。“无关联事件”不等于未登场。</li>
        <li>进球者的中文简称只用于比分区和图上标注，其余地方保留数据源全名。</li>
      </ul>
    </details>
  </footer>
  <div class="de-tip" role="tooltip" hidden></div>`;

/* ------------------------------------------------------------------- mount */

export function mountDataExplorer(container, store, initialDataset = {}, options = {}) {
  if (!container?.ownerDocument || !store?.getState || !store?.setState || !store?.subscribe) {
    throw new TypeError("mountDataExplorer requires a DOM container and getState/setState/subscribe store");
  }
  const theme = options?.theme === "light" ? "light" : "dark";
  const uid = `de${(mountCount += 1)}`;
  const doc = container.ownerDocument;
  const view = doc.defaultView;
  const style = element(doc, "link");
  style.rel = "stylesheet";
  style.href = STYLE_URL;
  const root = element(doc, "section", "de-root");
  root.dataset.theme = theme;
  root.setAttribute("aria-label", "比赛概览");
  root.innerHTML = TEMPLATE;

  const find = (selector) => root.querySelector(selector);
  find(".de-source-logo").src = LOGO_URL;
  const typeSelect = find(".de-type");
  const tip = find(".de-tip");
  const xgPlot = find(".de-xg-plot");

  let dataset = initialDataset ?? {};
  let eventType = "";
  let period = "";
  let page = 0;
  let destroyed = false;
  let model;
  let context = "";
  let xgWidth = 0;

  /* ---------- tooltip */

  function showTip(lines, x, y) {
    tip.replaceChildren(...lines.map((line, index) => element(doc, index ? "span" : "strong", "", line)));
    tip.hidden = false;
    const box = tip.getBoundingClientRect();
    const left = Math.min(Math.max(8, x + 14), view.innerWidth - box.width - 8);
    const top = y + 14 + box.height > view.innerHeight ? y - box.height - 12 : y + 14;
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }
  const hideTip = () => {
    tip.hidden = true;
  };

  /* ---------- small builders */

  const teamById = (teamId) => model.teams.find((team) => team.team_id === teamId);
  const fullName = (playerId) =>
    list(dataset.players).find((player) => id(player.player_id) === id(playerId))?.player_name ||
    "姓名未提供";
  const short = (playerId) => shortPlayerName(playerId, fullName(playerId));

  function segmented(host, items, current, dataKey) {
    host.replaceChildren();
    for (const item of items) {
      const button = element(doc, "button", "de-seg-btn");
      button.type = "button";
      button.dataset[dataKey] = item.value;
      button.setAttribute("aria-pressed", String(item.value === current));
      if (item.slot !== undefined) button.append(element(doc, "i", `de-dot de-slot-${item.slot}`));
      button.append(doc.createTextNode(item.label));
      host.append(button);
    }
  }

  /* ---------- match header */

  function teamSide(team, place) {
    const side = element(doc, "div", `de-team-card de-${place} de-slot-${team.slot}`);
    const badge = element(doc, "span", "de-badge", teamCode(team));
    badge.setAttribute("aria-hidden", "true");
    const title = element(doc, "div", "de-team-title");
    title.append(
      element(doc, "span", "de-team-name", teamLabel(team)),
      element(doc, "span", "de-team-en", team.team_name || ""),
    );
    const top = element(doc, "div", "de-team-top");
    top.append(badge, title);
    const scorers = new Map();
    for (const goal of model.goals.filter((item) => item.team_id === team.team_id)) {
      const key = `${goal.own_goal ? "own-" : ""}${goal.player_id}`;
      const name = `${short(goal.player_id)}${goal.own_goal ? "（乌龙）" : ""}`;
      if (!scorers.has(key)) scorers.set(key, { name, minutes: [] });
      scorers.get(key).minutes.push(goal.label);
    }
    const goals = element(doc, "ul", "de-goals");
    goals.setAttribute("aria-label", `${teamLabel(team)}进球`);
    for (const scorer of scorers.values()) {
      const item = element(doc, "li");
      item.append(element(doc, "span", "", scorer.name), element(doc, "b", "", scorer.minutes.join(" ")));
      goals.append(item);
    }
    side.append(top, goals);
    return side;
  }

  function scoreCenter(home, away) {
    const center = element(doc, "div", "de-score-center");
    const score = element(doc, "div", "de-score-line");
    score.append(
      element(doc, "span", "de-score", display(home?.score)),
      element(doc, "span", "de-score-sep", ":"),
      element(doc, "span", "de-score", display(away?.score)),
    );
    center.append(score);
    if (model.hasExtraTime) center.append(element(doc, "span", "de-stage", "加时赛后"));
    const kicksFor = (team) => {
      const kicks = model.shootout.find((item) => item.team_id === team.team_id)?.kicks ?? [];
      const row = element(doc, "span", "de-kicks");
      const sequence = kicks.map((kick) => (kick.scored ? "罚进" : "未进")).join("、") || "无记录";
      row.setAttribute("aria-label", `${teamLabel(team)}点球大战：${sequence}`);
      for (const kick of kicks) {
        const dot = element(doc, "i", `de-kick de-slot-${team.slot}${kick.scored ? " is-in" : ""}`);
        dot.title = `${short(kick.event.player_id)}：${kick.scored ? "罚进" : "未进"}`;
        row.append(dot);
      }
      return row;
    };
    const hasShootout = model.shootout.some((item) => item.kicks.length) || finite(home?.shootout_score);
    if (hasShootout && home && away) {
      const shootout = element(doc, "div", "de-shootout-row");
      const label = `点球 ${display(home.shootout_score)}–${display(away.shootout_score)}`;
      shootout.append(kicksFor(home), element(doc, "span", "de-shootout-score", label), kicksFor(away));
      center.append(shootout);
    }
    return center;
  }

  function renderHead() {
    find(".de-headline").textContent = matchStory(model) || "";
    const board = find(".de-scoreboard");
    board.replaceChildren();
    if (!model.teams.length) {
      board.append(element(doc, "p", "de-no-match", "尚未提供球队及比分数据"));
      return;
    }
    const [home, away] = model.teams;
    board.append(teamSide(home, "home"), scoreCenter(home, away));
    if (away) board.append(teamSide(away, "away"));
  }

  /* ---------- toolbar + metrics */

  function renderToolbar() {
    segmented(
      find(".de-team-group"),
      [
        { value: "", label: "两队" },
        ...model.teams.map((team) => ({ value: team.team_id, label: teamLabel(team), slot: team.slot })),
      ],
      model.selectedTeamId || "",
      "deTeam",
    );
    segmented(
      find(".de-period-group"),
      [
        { value: "", label: "全场" },
        ...REGULAR_PERIODS.map((value) => ({ value: String(value), label: PERIOD_SHORT[value] })),
      ],
      String(model.period || ""),
      "dePeriod",
    );
    typeSelect.replaceChildren();
    for (const [value, label] of [["", "全部事件"], ...model.types.map((type) => [type, typeLabel(type)])]) {
      const option = element(doc, "option", "", label);
      option.value = value;
      typeSelect.append(option);
    }
    typeSelect.value = model.eventType;

    const range = model.timeRange.map(numberLabel);
    find(".de-window").textContent = `${range[0]}′–${range[1]}′`;
    find(".de-count").textContent = `${model.metrics.events.toLocaleString("zh-CN")} 条事件`;

    const metrics = find(".de-metrics");
    metrics.replaceChildren();
    const { metrics: m } = model;
    const items = [
      ["events", "事件", display(m.events), `${m.involvedPlayers} 名球员参与`],
      ["passes", "传球", display(m.passes), `确认成功 ${display(m.successfulPasses)} 次`],
      ["pass-accuracy", "传球成功率", pct(m.passAccuracy), `${m.unknownPasses} 次结果未知`],
      ["shots", "射门 / xG", `${display(m.shots)} / ${xgText(m.xg)}`, "xG 来自数据源"],
    ];
    for (const [key, label, value, note] of items) {
      const item = element(doc, "div", "de-metric");
      item.dataset.metric = key;
      item.append(
        element(doc, "span", "de-metric-label", label),
        element(doc, "strong", "de-metric-value", value),
        element(doc, "small", "de-metric-note", note),
      );
      metrics.append(item);
    }
  }

  /* ---------- xG flow */

  function renderXg() {
    const timeline = xgTimeline(
      list(dataset.events),
      model.teams.map((team) => team.team_id),
    );
    const spans = periodSpans(list(dataset.events));
    const legend = find(".de-xg-legend");
    legend.replaceChildren();
    for (const team of model.teams) {
      const total = timeline.teams.find((item) => item.team_id === team.team_id)?.total;
      const key = element(doc, "span", "de-legend-item");
      key.append(element(doc, "i", `de-dot de-slot-${team.slot}`), doc.createTextNode(teamLabel(team)));
      key.append(element(doc, "b", "", xgText(total)));
      legend.append(key);
    }
    const empty = !timeline.complete || !spans.length;
    const emptyNote = find(".de-xg-empty");
    emptyNote.hidden = !empty;
    emptyNote.textContent = timeline.shotCount
      ? "部分射门缺少数据源 xG，不绘制累计曲线。"
      : "当前数据没有射门记录。";
    xgPlot.replaceChildren();
    if (empty) return;

    const width = Math.max(280, Math.round(xgPlot.clientWidth || xgWidth || 640));
    xgWidth = width;
    const height = Math.min(360, Math.max(220, Math.round(width * 0.44)));
    const margin = { top: 28, right: 10, bottom: 38, left: 28 };
    const gap = 0;
    const plotWidth = width - margin.left - margin.right - gap * (spans.length - 1);
    const plotHeight = height - margin.top - margin.bottom;
    const totalSpan = spans.reduce((sum, span) => sum + (span.end - span.start), 0);
    let cursor = margin.left;
    const panels = spans.map((span) => {
      const panelWidth = (plotWidth * (span.end - span.start)) / totalSpan;
      const panel = { ...span, x: cursor, width: panelWidth };
      cursor += panelWidth + gap;
      return panel;
    });
    const xOf = (panel, minute) =>
      panel.x +
      ((Math.min(Math.max(minute, panel.start), panel.end) - panel.start) / (panel.end - panel.start)) *
        panel.width;
    const yMax = Math.max(1, Math.ceil(timeline.maxXg * 2) / 2);
    const yOf = (value) => margin.top + plotHeight - (value / yMax) * plotHeight;
    const baseline = margin.top + plotHeight;

    const chart = svg(
      doc,
      "svg",
      { width, height, viewBox: `0 0 ${width} ${height}`, role: "img" },
      "de-xg-svg",
    );
    chart.setAttribute(
      "aria-label",
      `xG 累计走势：${model.teams
        .map(
          (team) =>
            `${teamLabel(team)} ${xgText(timeline.teams.find((item) => item.team_id === team.team_id)?.total)}`,
        )
        .join("，")}`,
    );

    // Soft area gradients, one per team.
    const defs = svg(doc, "defs");
    for (const team of model.teams) {
      const gradient = svg(doc, "linearGradient", {
        id: `${uid}-area-${team.slot}`,
        x1: 0,
        x2: 0,
        y1: 0,
        y2: 1,
      });
      gradient.append(
        svg(doc, "stop", { offset: "0%" }, `de-stop-top de-slot-${team.slot}`),
        svg(doc, "stop", { offset: "100%" }, `de-stop-bottom de-slot-${team.slot}`),
      );
      defs.append(gradient);
    }
    chart.append(defs);

    const grid = svg(doc, "g", {}, "de-grid-lines");
    const step = yMax > 2 ? 1 : 0.5;
    for (let value = 0; value <= yMax + 1e-9; value += step) {
      const y = yOf(value);
      grid.append(svg(doc, "line", { x1: margin.left, x2: width - margin.right, y1: y, y2: y }));
      const label = svg(doc, "text", { x: margin.left - 8, y: y + 3.5, "text-anchor": "end" }, "de-axis");
      label.textContent = String(value);
      grid.append(label);
    }
    chart.append(grid);

    const axes = svg(doc, "g", {}, "de-period-axes");
    // A hairline marks the break between periods.
    for (const panel of panels.slice(1)) {
      const x = panel.x;
      axes.append(
        svg(doc, "line", { x1: x, x2: x, y1: margin.top - 6, y2: baseline + 4 }, "de-period-break"),
      );
    }
    let lastTickX = -Infinity;
    for (const panel of panels) {
      const first = Math.ceil(panel.start / 15) * 15;
      for (let minute = first; minute <= panel.end; minute += 15) {
        const x = xOf(panel, minute);
        // Skip a label that would collide with the previous one (e.g. 105′ at a period break).
        if (x - lastTickX >= 28) {
          const tick = svg(doc, "text", { x, y: baseline + 15, "text-anchor": "middle" }, "de-axis");
          tick.textContent = `${minute}′`;
          axes.append(tick);
          lastTickX = x;
        }
      }
      const name = svg(
        doc,
        "text",
        { x: panel.x + panel.width / 2, y: baseline + 31, "text-anchor": "middle" },
        "de-axis de-axis-period",
      );
      name.textContent = PERIOD_SHORT[panel.period];
      axes.append(name);
    }
    chart.append(axes);

    // Step series per team, one sub-path per period, with an area under each.
    const areas = svg(doc, "g", {}, "de-xg-areas");
    const lines = svg(doc, "g", {}, "de-xg-lines");
    const goalsLayer = svg(doc, "g", {}, "de-xg-goals");
    for (const series of timeline.teams) {
      const team = teamById(series.team_id);
      const slot = team?.slot ?? 0;
      const goalPoints = [];
      let carried = 0;
      let path = "";
      let area = "";
      for (const panel of panels) {
        let level = carried;
        const startX = xOf(panel, panel.start).toFixed(1);
        let segment = `M${startX} ${yOf(level).toFixed(1)}`;
        for (const item of series.steps.filter((entry) => entry.period === panel.period)) {
          segment += `H${xOf(panel, item.minute).toFixed(1)}V${yOf(item.cumulative).toFixed(1)}`;
          level = item.cumulative;
          if (item.event.outcome === SHOT_GOAL) {
            goalPoints.push({
              x: xOf(panel, item.minute),
              y: yOf(item.cumulative),
              who: width < 560 ? "" : short(item.event.player_id),
              minute: matchClockLabel(item.event),
            });
          }
        }
        const endX = (panel.x + panel.width).toFixed(1);
        segment += `H${endX}`;
        path += segment;
        area += `${segment}V${baseline}H${startX}Z`;
        carried = level;
      }
      areas.append(svg(doc, "path", { d: area, fill: `url(#${uid}-area-${slot})` }, "de-xg-area"));
      lines.append(svg(doc, "path", { d: path }, `de-xg-line de-slot-${slot}`));

      // Goals close together share one label, e.g. "姆巴佩 80′ 81′".
      const labels = [];
      for (const point of goalPoints) {
        goalsLayer.append(
          svg(doc, "circle", { cx: point.x, cy: point.y, r: 4.5 }, `de-xg-goal de-slot-${slot}`),
        );
        const previous = labels.at(-1);
        if (previous && point.x - previous.x < 34) {
          if (previous.who !== point.who) previous.text += ` ${point.who}`;
          previous.text += ` ${point.minute}`;
          previous.x = point.x;
          previous.y = Math.min(previous.y, point.y);
        } else labels.push({ ...point, text: `${point.who} ${point.minute}`.trim() });
      }
      for (const item of labels) {
        // Rough width: CJK glyphs ~12px, digits and marks ~7px at 12px type.
        const estimate = [...item.text].reduce((sum, char) => sum + (/[㐀-鿿]/.test(char) ? 12 : 7), 0);
        const fitsLeft = item.x - 8 - estimate >= margin.left;
        const label = svg(
          doc,
          "text",
          { x: fitsLeft ? item.x - 8 : item.x + 8, y: item.y - 8, "text-anchor": fitsLeft ? "end" : "start" },
          "de-goal-label",
        );
        label.textContent = item.text;
        goalsLayer.append(label);
      }
    }
    chart.append(areas, lines);

    // Time outside the selected range is veiled; overlapping clock minutes show up in both halves.
    const [rangeStart, rangeEnd] = model.timeRange;
    const fullRange = panels.every((panel) => rangeStart <= panel.start && rangeEnd >= panel.end);
    const shade = svg(doc, "g", {}, "de-range");
    const outside = (x, w) =>
      shade.append(
        svg(
          doc,
          "rect",
          { x, y: margin.top - 6, width: Math.max(0, w), height: plotHeight + 6 },
          "de-range-out",
        ),
      );
    for (const panel of panels) {
      if (fullRange && !model.period) continue;
      const start = Math.max(rangeStart, panel.start);
      const end = Math.min(rangeEnd, panel.end);
      if ((model.period && model.period !== panel.period) || end < start) {
        outside(panel.x, panel.width);
        continue;
      }
      const x1 = xOf(panel, start);
      const x2 = xOf(panel, end);
      if (x1 > panel.x) outside(panel.x, x1 - panel.x);
      if (x2 < panel.x + panel.width) outside(x2, panel.x + panel.width - x2);
    }
    chart.append(shade, goalsLayer);

    // Interaction layer: crosshair, tooltip and brushing.
    const guide = svg(doc, "line", { y1: margin.top, y2: baseline, x1: 0, x2: 0 }, "de-guide");
    guide.style.display = "none";
    const brush = svg(doc, "rect", { y: margin.top, height: plotHeight, x: 0, width: 0, rx: 4 }, "de-brush");
    brush.style.display = "none";
    const hit = svg(
      doc,
      "rect",
      { x: margin.left, y: margin.top, width: width - margin.left - margin.right, height: plotHeight },
      "de-hit",
    );
    chart.append(guide, brush, hit);

    const locate = (clientX) => {
      const bounds = chart.getBoundingClientRect();
      const x = ((clientX - bounds.left) / bounds.width) * width;
      const panel = panels.find((item) => x <= item.x + item.width + gap / 2) ?? panels.at(-1);
      const ratio = Math.min(1, Math.max(0, (x - panel.x) / panel.width));
      const minute = panel.start + ratio * (panel.end - panel.start);
      return { panel, minute, x: xOf(panel, minute) };
    };
    const levelAt = (series, panel, minute) => {
      let value = 0;
      for (const item of series.steps) {
        if (item.period < panel.period || (item.period === panel.period && item.minute <= minute)) {
          value = item.cumulative;
        }
      }
      return value;
    };
    let anchor = null;
    hit.addEventListener("pointerdown", (event) => {
      anchor = locate(event.clientX);
      hit.setPointerCapture?.(event.pointerId);
      brush.style.display = "";
      brush.setAttribute("x", anchor.x);
      brush.setAttribute("width", 0);
    });
    hit.addEventListener("pointermove", (event) => {
      const here = locate(event.clientX);
      guide.style.display = "";
      guide.setAttribute("x1", here.x);
      guide.setAttribute("x2", here.x);
      if (anchor) {
        brush.setAttribute("x", Math.min(anchor.x, here.x));
        brush.setAttribute("width", Math.abs(here.x - anchor.x));
      }
      showTip(
        [
          `${Math.floor(here.minute)}′ ${PERIOD_SHORT[here.panel.period]}`,
          ...timeline.teams.map(
            (series) =>
              `${teamLabel(teamById(series.team_id))} xG ${levelAt(series, here.panel, here.minute).toFixed(2)}`,
          ),
        ],
        event.clientX,
        event.clientY,
      );
    });
    hit.addEventListener("pointerup", (event) => {
      if (!anchor) return;
      const here = locate(event.clientX);
      const moved = Math.abs(here.x - anchor.x) > 4;
      const selection = resolveTimeBrush(
        { period: anchor.panel.period, minute: anchor.minute },
        { period: here.panel.period, minute: here.minute },
      );
      anchor = null;
      brush.style.display = "none";
      hideTip();
      if (!moved) return;
      if (!selection.accepted) {
        find(".de-brush-message").textContent = selection.reason === "cross-period"
          ? "不能跨比赛阶段拖选，已保留原有筛选。请在同一阶段内重新拖选。"
          : "未能识别拖选范围，已保留原有筛选。";
        return;
      }
      // The period remains A-local. The frozen shared contract still contains only clock minutes.
      period = String(selection.period);
      store.setState({ timeRange: selection.timeRange });
      find(".de-brush-message").textContent = `已选择${PERIOD_NAMES[selection.period]} ${selection.timeRange.map(numberLabel).join("–")} 分钟。阶段仅筛选 A，其他模块仍按共享分钟区间筛选。`;
    });
    hit.addEventListener("pointercancel", () => {
      anchor = null;
      brush.style.display = "none";
    });
    hit.addEventListener("pointerleave", () => {
      guide.style.display = "none";
      if (!anchor) hideTip();
    });
    xgPlot.append(chart);
  }

  /* ---------- team comparison */

  function renderComparison() {
    const host = find(".de-compare-rows");
    host.replaceChildren();
    const [home, away] = model.teams;
    if (!home || !away) {
      host.append(element(doc, "p", "de-empty", "需要两支球队的数据才能对比。"));
      return;
    }
    const head = element(doc, "div", "de-compare-head");
    for (const team of [home, away]) {
      const key = element(doc, "span", `de-legend-item de-slot-${team.slot}`);
      key.append(element(doc, "i", `de-dot de-slot-${team.slot}`), doc.createTextNode(teamLabel(team)));
      head.append(key);
    }
    host.append(head);
    for (const row of model.comparison) {
      const a = row.values[home.team_id];
      const b = row.values[away.team_id];
      const scale = Math.max(finite(a) ? a : 0, finite(b) ? b : 0) || 1;
      const format = row.format || display;
      const item = element(doc, "div", "de-compare-row");
      item.dataset.compare = row.key;
      const values = element(doc, "div", "de-compare-values");
      const value = (number, team, lead) =>
        element(
          doc,
          "span",
          `de-compare-value de-slot-${team.slot}${lead ? " is-lead" : ""}`,
          format(number),
        );
      values.append(
        value(a, home, finite(a) && finite(b) && a > b),
        element(doc, "span", "de-compare-label", row.label),
        value(b, away, finite(a) && finite(b) && b > a),
      );
      const bars = element(doc, "div", "de-compare-bars");
      for (const [number, team] of [
        [a, home],
        [b, away],
      ]) {
        const track = element(doc, "span", "de-compare-track");
        const fill = element(doc, "span", `de-compare-fill de-slot-${team.slot}`);
        fill.style.width = `${finite(number) ? (number / scale) * 100 : 0}%`;
        track.append(fill);
        bars.append(track);
      }
      item.append(values, bars);
      host.append(item);
    }
  }

  /* ---------- shot maps */

  /**
   * Attacking half, rotated so the goal is at the top.
   * StatsBomb (x, y), x toward goal 0..120, maps to screen (y, 120 - x).
   */
  function halfPitch(team, withSizeKey) {
    const pitch = svg(doc, "svg", { viewBox: "-3 -4 86 67", role: "img" }, "de-pitch");
    pitch.setAttribute("aria-label", `${teamLabel(team)}射门位置图，进攻方向朝上`);
    const stripes = svg(doc, "g", {}, "de-pitch-stripes");
    for (let index = 1; index < 6; index += 2) {
      stripes.append(svg(doc, "rect", { x: 0, y: index * 10, width: 80, height: 10 }));
    }
    const lines = svg(doc, "g", {}, "de-pitch-lines");
    const shapes = [
      ["rect", { x: 0, y: 0, width: 80, height: 60, rx: 0.6 }],
      ["rect", { x: 18, y: 0, width: 44, height: 18 }],
      ["rect", { x: 30, y: 0, width: 20, height: 6 }],
      ["rect", { x: 36, y: -2, width: 8, height: 2 }],
      ["path", { d: "M32 18 A10 10 0 0 0 48 18" }],
      ["path", { d: "M30 60 A10 10 0 0 1 50 60" }],
    ];
    for (const [tag, attributes] of shapes) lines.append(svg(doc, tag, attributes));
    for (const [cx, cy] of [
      [40, 12],
      [40, 60],
    ]) {
      lines.append(svg(doc, "circle", { cx, cy, r: 0.45 }, "de-spot"));
    }
    pitch.append(svg(doc, "rect", { x: -3, y: -4, width: 86, height: 67, rx: 2 }, "de-turf"), stripes, lines);

    const layer = svg(doc, "g", {}, "de-shots");
    // Larger shots first so small ones stay on top and remain hoverable.
    const shots = model.shots
      .filter((shot) => id(shot.team_id) === team.team_id && Array.isArray(shot.location))
      .sort((a, b) => (b.xg ?? 0) - (a.xg ?? 0));
    for (const shot of shots) {
      const [x, y] = shot.location;
      const goal = shot.outcome === SHOT_GOAL;
      const dimmed = model.selectedPlayerId && id(shot.player_id) !== model.selectedPlayerId;
      const radius = shotRadius(shot.xg);
      const cx = y.toFixed(2), cy = Math.max(-1, 120 - x).toFixed(2);
      const target = svg(doc, "g", { tabindex: 0, role: "button" }, `de-shot-target${dimmed ? " is-dim" : ""}`);
      target.dataset.deShot = String(shot.event_id);
      target.setAttribute(
        "aria-label",
        `${fullName(shot.player_id)}，${matchClockLabel(shot)}，xG ${radius === null ? "缺失" : xgText(shot.xg)}，${outcomeLabel(shot.outcome)}`,
      );
      // Pointer and keyboard targets are deliberately larger than the encoded fill area.
      target.append(svg(doc, "circle", { cx, cy, r: Math.max(2.8, (radius ?? 0) + 0.5) }, "de-shot-hit"));
      const mark = svg(
        doc,
        "circle",
        {
          cx,
          cy,
          r: radius ?? 0,
          "aria-hidden": "true",
        },
        `de-shot de-slot-${team.slot}${goal ? " is-goal" : ""}${dimmed ? " is-dim" : ""}`,
      );
      target.append(mark);
      if (radius === null || radius === 0) {
        const symbol = svg(doc, "text", { x: cx, y: Number(cy) + 0.8, "text-anchor": "middle", "aria-hidden": "true" }, radius === null ? "de-shot-missing" : "de-shot-zero");
        symbol.textContent = radius === null ? "?" : "0";
        target.append(symbol);
      }
      layer.append(target);
    }
    pitch.append(layer);

    if (withSizeKey) {
      // Drawn in pitch units so the key is to scale with the shots.
      const key = svg(doc, "g", { transform: "translate(4 51)" }, "de-size-key");
      let cursor = 0;
      for (const value of [0.05, 0.3, 0.8]) {
        const radius = shotRadius(value);
        cursor += radius;
        key.append(svg(doc, "circle", { cx: cursor, cy: 0, r: radius }));
        const label = svg(doc, "text", { x: cursor, y: radius + 3.4, "text-anchor": "middle" });
        label.textContent = String(value);
        key.append(label);
        cursor += radius + 4.2;
      }
      const caption = svg(doc, "text", { x: cursor + 0.5, y: 1 });
      caption.textContent = "xG";
      key.append(caption);
      pitch.append(key);
    }

    const hidden = Boolean(model.selectedTeamId) && model.selectedTeamId !== team.team_id;
    const card = element(doc, "figure", `de-pitch-card de-slot-${team.slot}${hidden ? " is-off" : ""}`);
    const own = model.shots.filter((shot) => id(shot.team_id) === team.team_id);
    const goals = own.filter((shot) => shot.outcome === SHOT_GOAL).length;
    const xg = own.every((shot) => validXg(shot.xg)) ? own.reduce((sum, shot) => sum + shot.xg, 0) : null;
    const caption = element(doc, "figcaption", "de-pitch-caption");
    const name = element(doc, "span", "de-pitch-team");
    name.append(element(doc, "i", `de-dot de-slot-${team.slot}`), doc.createTextNode(teamLabel(team)));
    const numbers = element(doc, "span", "de-pitch-numbers");
    if (hidden) numbers.textContent = "未选";
    else if (!own.length) numbers.textContent = "没有射门";
    else {
      for (const [value, unit] of [
        [own.length, "射门"],
        [goals, "进球"],
        [xgText(xg), "xG"],
      ]) {
        const pair = element(doc, "span");
        pair.append(element(doc, "b", "", String(value)), doc.createTextNode(unit));
        numbers.append(pair);
      }
    }
    caption.append(name, numbers);
    card.append(pitch, caption);
    return card;
  }

  function renderShots() {
    const host = find(".de-pitches");
    host.replaceChildren();
    model.teams.forEach((team, index) => host.append(halfPitch(team, index === 0)));
    const legend = find(".de-pitch-legend");
    legend.replaceChildren(
      element(doc, "i", "de-fill-key is-goal"),
      element(doc, "span", "", "实色 · 进球"),
      element(doc, "i", "de-fill-key"),
      element(doc, "span", "", "浅色 · 未进"),
    );
  }

  /* ---------- event mix */

  function renderDistribution() {
    const bars = find(".de-bars");
    bars.replaceChildren();
    const maxCount = model.distribution[0]?.count || 1;
    for (const row of model.distribution.slice(0, 10)) {
      const button = element(doc, "button", "de-bar");
      button.type = "button";
      button.dataset.deType = row.type;
      button.setAttribute("aria-pressed", String(model.eventType === row.type));
      button.setAttribute("aria-label", `${typeLabel(row.type)}，${row.count} 条，点击筛选`);
      const label = element(doc, "span", "de-bar-label", typeName(row.type));
      label.title = row.type;
      const track = element(doc, "span", "de-bar-track");
      const fill = element(doc, "span", "de-bar-fill");
      fill.style.width = `${(row.count / maxCount) * 100}%`;
      track.append(fill);
      button.append(label, track, element(doc, "span", "de-bar-count", display(row.count)));
      bars.append(button);
    }
    bars.classList.toggle("has-selection", Boolean(model.eventType));
    find(".de-chart-empty").hidden = Boolean(model.distribution.length);
  }

  /* ---------- tabs: roster + event log */

  function renderRoster(focusedPlayer) {
    const host = find(".de-roster");
    host.replaceChildren();
    find(".de-roster-count").textContent = `${model.roster.length} 名登记球员`;
    const maxInvolvement = Math.max(1, ...model.roster.map((player) => player.involvement));
    const teams = model.teams.filter(
      (team) => !model.selectedTeamId || team.team_id === model.selectedTeamId,
    );
    const makeButton = (player, team) => {
      const slot = team?.slot ?? 0;
      const button = element(doc, "button", `de-player de-slot-${slot}`);
      button.type = "button";
      button.dataset.dePlayer = String(player.player_id);
      button.setAttribute("aria-pressed", String(model.selectedPlayerId === id(player.player_id)));
      if (!player.involvement) button.classList.add("is-quiet");
      button.append(
        element(doc, "span", "de-shirt", player.shirt_number == null ? "—" : String(player.shirt_number)),
      );
      const info = element(doc, "span", "de-player-info");
      const name = element(doc, "strong", "", player.player_name || "姓名未提供");
      name.title = player.player_name || "";
      info.append(name, element(doc, "small", "", player.position || "位置未提供"));
      const meter = element(doc, "span", "de-player-meter");
      const fill = element(doc, "span");
      fill.style.width = `${(player.involvement / maxInvolvement) * 100}%`;
      meter.append(fill);
      button.append(info, meter, element(doc, "span", "de-player-events", `${player.involvement}`));
      return button;
    };
    const unknownTeam = model.roster.filter(
      (player) => !teams.some((team) => team.team_id === id(player.team_id)),
    );
    for (const team of teams) {
      const column = element(doc, "div", `de-roster-col de-slot-${team.slot}`);
      const members = model.roster.filter((player) => id(player.team_id) === team.team_id);
      const title = element(doc, "h4");
      title.append(element(doc, "i", `de-dot de-slot-${team.slot}`), doc.createTextNode(teamLabel(team)));
      title.append(element(doc, "span", "", "参与事件"));
      column.append(title);
      for (const player of members.filter((item) => item.hasRecordedEvents)) column.append(makeButton(player, team));
      const withoutEvents = members.filter((item) => !item.hasRecordedEvents);
      if (withoutEvents.length) {
        const details = element(doc, "details", "de-bench");
        details.append(element(doc, "summary", "", `无关联事件 ${withoutEvents.length} 人`));
        for (const player of withoutEvents) details.append(makeButton(player, team));
        column.append(details);
      }
      host.append(column);
    }
    if (unknownTeam.length) {
      const column = element(doc, "div", "de-roster-col");
      column.append(element(doc, "h4", "", "球队未提供"));
      for (const player of unknownTeam) column.append(makeButton(player, null));
      host.append(column);
    }
    if (!model.roster.length) host.append(element(doc, "p", "de-empty", "没有符合球队筛选的球员。"));
    if (focusedPlayer) {
      [...host.querySelectorAll("button")]
        .find((button) => button.dataset.dePlayer === focusedPlayer)
        ?.focus({ preventScroll: true });
    }
  }

  function renderTable() {
    page = Math.min(page, Math.max(0, Math.ceil(model.events.length / PAGE_SIZE) - 1));
    const tbody = find("tbody");
    tbody.replaceChildren();
    for (const event of model.events.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
      const row = element(doc, "tr");
      const team = teamById(id(event.team_id));
      const clock = element(doc, "td");
      const button = element(doc, "button", "de-event-select");
      button.type = "button";
      button.dataset.deEvent = String(event.event_id);
      button.append(
        element(doc, "span", "", rawClock(event)),
        element(doc, "small", "", PERIOD_NAMES[event.period] || "阶段未知"),
      );
      clock.append(button);
      const typeCell = element(doc, "td");
      typeCell.append(
        element(doc, "i", `de-dot de-slot-${team?.slot ?? 0}`),
        doc.createTextNode(typeLabel(typeOf(event))),
      );
      const players = `${event.player_id ? fullName(event.player_id) : "—"}${
        event.recipient_id ? ` → ${fullName(event.recipient_id)}` : ""
      }`;
      row.append(
        clock,
        typeCell,
        element(doc, "td", "de-event-player", players),
        element(doc, "td", "", outcomeLabel(event.outcome)),
        element(doc, "td", "de-num", String(event.event_index ?? "—")),
      );
      tbody.append(row);
    }
    const total = model.events.length;
    find(".de-page-count").textContent = total
      ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} / ${total}`
      : "0 / 0";
    find(".de-prev").disabled = page === 0;
    find(".de-next").disabled = (page + 1) * PAGE_SIZE >= total;
    find(".de-table-empty").hidden = Boolean(total);
  }

  function selectTab(name) {
    for (const tab of root.querySelectorAll(".de-tab")) {
      tab.setAttribute("aria-selected", String(tab.dataset.deTab === name));
    }
    for (const panel of root.querySelectorAll(".de-tab-panel")) panel.hidden = panel.dataset.dePanel !== name;
  }

  function renderFooter() {
    find(".de-quality").textContent = !model.sourceAvailable
      ? "尚未提供事件数组；此处不能视为比赛零事件。"
      : `源数据 ${model.totalEvents.toLocaleString("zh-CN")} 条；第 1–4 节 ${model.regularEvents.toLocaleString(
          "zh-CN",
        )} 条；点球大战 ${model.shootoutEvents} 条已排除。${
          model.missingTimes ? `另有 ${model.missingTimes} 条无有效时间，未纳入时间筛选。` : ""
        }`;
    find(".de-match-id").textContent = dataset.stats?.match_id || "未提供";
  }

  function showRecord(eventId) {
    const record = list(dataset.events).find((item) => String(item.event_id) === eventId);
    if (!record) return;
    find(".de-record").textContent = JSON.stringify(record, null, 2);
    find(".de-evidence").open = true;
  }

  function render() {
    if (destroyed) return;
    find(".de-brush-message").textContent = "";
    model = exploreMatch(dataset, store.getState(), { eventType, period });
    const nextContext = JSON.stringify([model.selectedTeamId, model.timeRange, eventType, period]);
    if (context !== nextContext) {
      page = 0;
      context = nextContext;
      find(".de-record").textContent = "点击事件记录中的时间，查看可追溯的 ID、坐标与来源字段。";
      find(".de-evidence").open = false;
    }
    const active = doc.activeElement;
    const focusedPlayer = root.contains(active) ? active?.dataset?.dePlayer : null;
    const focusedShot = root.contains(active) ? active?.dataset?.deShot : null;
    hideTip();
    renderHead();
    renderToolbar();
    renderXg();
    renderComparison();
    renderShots();
    renderDistribution();
    renderRoster(focusedPlayer);
    renderTable();
    renderFooter();
    if (focusedShot) root.querySelector(`[data-de-shot="${CSS.escape(focusedShot)}"]`)?.focus({ preventScroll: true });
  }

  /* ---------- events */

  const onType = () => {
    eventType = typeSelect.value;
    render();
  };
  const onClick = (event) => {
    const shot = event.target.closest?.("[data-de-shot]");
    if (shot && root.contains(shot)) {
      const record = model.shots.find((item) => String(item.event_id) === shot.dataset.deShot);
      if (record?.player_id) store.setState({ selectedPlayerId: id(record.player_id) });
      showRecord(shot.dataset.deShot);
      return;
    }
    const button = event.target.closest?.("button");
    if (!button || !root.contains(button)) return;
    const data = button.dataset;
    if (data.deTab) selectTab(data.deTab);
    else if (data.dePlayer) store.setState({ selectedPlayerId: data.dePlayer });
    else if (data.deTeam !== undefined) store.setState({ selectedTeamId: data.deTeam || null });
    else if (data.dePeriod !== undefined) {
      period = data.dePeriod;
      render();
    } else if (data.deType) {
      eventType = eventType === data.deType ? "" : data.deType;
      render();
      root
        .querySelector(`.de-bar[data-de-type="${CSS.escape(data.deType)}"]`)
        ?.focus({ preventScroll: true });
    } else if (data.deEvent) showRecord(data.deEvent);
    else if (button.classList.contains("de-reset")) {
      eventType = "";
      period = "";
      store.setState({ selectedTeamId: null, selectedPlayerId: null, timeRange: getDataTimeRange(dataset) });
    } else if (button.classList.contains("de-xg-all")) {
      period = "";
      store.setState({ timeRange: getDataTimeRange(dataset) });
    } else if (button.classList.contains("de-prev")) {
      page = Math.max(0, page - 1);
      renderTable();
    } else if (button.classList.contains("de-next")) {
      page += 1;
      renderTable();
    }
  };
  const onKey = (event) => {
    const shot = event.target.closest?.("[data-de-shot]");
    if (shot && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      onClick({ target: shot });
      return;
    }
    const tab = event.target.closest?.(".de-tab");
    if (tab && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
      const tabs = [...root.querySelectorAll(".de-tab")];
      const next =
        tabs[(tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      selectTab(next.dataset.deTab);
      next.focus();
    }
  };
  const shotLines = (target) => {
    const shot = model.shots.find((item) => String(item.event_id) === target.dataset.deShot);
    if (!shot) return null;
    return [
      fullName(shot.player_id),
      `${matchClockLabel(shot)}（${rawClock(shot)}，${PERIOD_NAMES[shot.period]}）`,
      `xG ${xgText(shot.xg)}，${outcomeLabel(shot.outcome)}`,
    ];
  };
  const onOver = (event) => {
    const target = event.target.closest?.("[data-de-shot]");
    const lines = target && shotLines(target);
    if (lines) showTip(lines, event.clientX, event.clientY);
  };
  const onOut = (event) => {
    if (event.target.closest?.("[data-de-shot]")) hideTip();
  };
  const onFocus = (event) => {
    const target = event.target.closest?.("[data-de-shot]");
    const lines = target && shotLines(target);
    if (!lines) return;
    const box = target.getBoundingClientRect();
    showTip(lines, box.right, box.bottom);
  };

  typeSelect.addEventListener("change", onType);
  root.addEventListener("click", onClick);
  root.addEventListener("keydown", onKey);
  root.addEventListener("pointerover", onOver);
  root.addEventListener("pointerout", onOut);
  root.addEventListener("focusin", onFocus);
  root.addEventListener("focusout", hideTip);

  const resizeObserver =
    typeof view?.ResizeObserver === "function"
      ? new view.ResizeObserver(() => {
          if (!destroyed && model && Math.abs((xgPlot.clientWidth || 0) - xgWidth) > 8) renderXg();
        })
      : null;

  container.append(style, root);
  resizeObserver?.observe(xgPlot);
  const unsubscribe = store.subscribe(render);
  render();

  return {
    updateDataset(nextDataset) {
      if (destroyed) return;
      dataset = nextDataset ?? {};
      eventType = "";
      period = "";
      page = 0;
      context = "";
      render();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (typeof unsubscribe === "function") unsubscribe();
      resizeObserver?.disconnect();
      typeSelect.removeEventListener("change", onType);
      root.removeEventListener("click", onClick);
      root.removeEventListener("keydown", onKey);
      root.removeEventListener("pointerover", onOver);
      root.removeEventListener("pointerout", onOut);
      root.removeEventListener("focusin", onFocus);
      root.removeEventListener("focusout", hideTip);
      root.remove();
      style.remove();
    },
  };
}
