/** Frozen section 3.5 state contract. No DOM and no module-specific fields. */
export const initialState = Object.freeze({
  selectedMatchId: null,
  selectedTeamId: null,
  selectedPlayerId: null,
  mode: "collaboration",
  timeRange: Object.freeze([0, 130]),
});

/** Factory is optional for isolated tests; production uses the singleton below. */
export function createStore(seed = {}) {
  let state = { ...initialState, timeRange: [...initialState.timeRange] };
  const listeners = new Set();
  const pending = [];
  let notifying = false;
  const snapshot = () => ({ ...state, timeRange: [...state.timeRange] });
  function setState(patch) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new TypeError("状态更新必须是对象。");
    const next = snapshot();
    for (const [key, value] of Object.entries(patch)) {
      if (!Object.hasOwn(initialState, key)) throw new TypeError(`未知状态字段：${key}`);
      if (key === "mode") {
        if (!["collaboration", "competition"].includes(value)) throw new TypeError("mode 必须是 collaboration 或 competition。");
        next.mode = value;
      } else if (key === "timeRange") {
        if (!Array.isArray(value) || value.length !== 2 || !value.every(n => typeof n === "number" && Number.isFinite(n) && n >= 0) || value[0] > value[1]) {
          throw new TypeError("timeRange 必须是非负、有限且按先后排列的分钟区间。");
        }
        next.timeRange = [...value];
      } else {
        if (value !== null && (typeof value !== "string" || !value.trim())) throw new TypeError(`${key} 必须是非空字符串或 null。`);
        next[key] = value;
      }
    }
    if (Object.keys(initialState).every(key => key === "timeRange"
      ? next.timeRange.every((n, i) => n === state.timeRange[i]) : next[key] === state[key])) return snapshot();
    state = next;
    pending.push(snapshot());
    if (!notifying) {
      notifying = true;
      try {
        while (pending.length) {
          const update = pending.shift();
          for (const listener of [...listeners]) {
            if (!listeners.has(listener)) continue;
            try { listener({ ...update, timeRange: [...update.timeRange] }); }
            catch (error) { console.error("状态订阅模块更新失败：", error); }
          }
        }
      } finally { notifying = false; }
    }
    return snapshot();
  }
  function subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("订阅者必须是函数。");
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
  setState(seed);
  return Object.freeze({ getState: snapshot, setState, subscribe });
}

const store = createStore();
export const getState = store.getState;
export const setState = store.setState;
export const subscribe = store.subscribe;
