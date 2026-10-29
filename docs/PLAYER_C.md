# C 模块：球星聚焦与个人表现分析

本模块遵循用户提供的四人分工与接口说明 v1.0（2026-10-27）。2026-10-29 已整合 A 的真实数据、B 的主超图和 D 的正式 store/时间控件，并完成 C 的正式三页 PPT；未增加共享状态字段或修改赛事 JSON 契约。

## 1. 立即运行

推荐按仓库 README 运行 `python3 scripts/prepare_data.py`，再启动下面的服务，访问 `/src/` 使用 A/B/C/D 真实数据整合版。模拟演示保留用于边界测试。

在仓库根目录执行（Python 3）：

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

浏览器访问 `http://127.0.0.1:8000/demos/player-c/`。前端没有 npm 依赖，不需要构建，不依赖网络 CDN。不要通过 `file://` 打开 ES Module 页面。

**演示数据全部是模拟值，不是世界杯决赛真值。** 页面始终显示模拟数据标识，fixture 的球员 ID 全部带 `demo-` 前缀。姓名仅用于测试搜索与快捷选择；模拟的传球、射门、比分相关指标和关系片段均不能用于真实比赛结论。

## 2. 文件与归属

| 文件 | 用途 |
|---|---|
| `src/js/playerAnalysis.js` | 正式模块、纯统计函数与可选组合选择事件 |
| `src/css/playerAnalysis.css` | C 自有样式，所有选择器限定在 `.pa-panel` 内 |
| `demos/player-c/index.html` | 独立演示入口 |
| `demos/player-c/demo.js` | 演示用 store 适配器和筛选控件，生产模块不导入它 |
| `demos/player-c/fixtures.js` | 明确标记的模拟球员、事件、统计与原始超边 |
| `demos/player-c/demo.css` | 演示壳样式 |
| `tests/playerAnalysis.test.mjs` | 无第三方依赖的统计测试 |
| `tests/playerAnalysis.browser.mjs` | Playwright 浏览器交互与生命周期测试 |
| `docs/report/part_C.md` | 方法、编码、交互和局限的报告草稿 |
| `docs/slides/part_C.pptx` | 与 A/B 同画幅、字体和主题的正式三页 PPT，内含演讲备注 |
| `docs/slides/part_C_notes.md` | 对应的约三分钟讲稿、演示顺序和数据口径 |
| `docs/slides/part_C_outline.md` | 正式 PPT 的策划提纲及问答准备 |
| `docs/screenshots/player-c-real-*.png` | 实际运行的 A/B/C/D 真实数据整合页面截图 |
| `docs/screenshots/player-c-demo-*.png` | 实际运行的模拟演示截图，仅用于边界测试 |

未实现第二套主超图、时间轴或数据预处理脚本；独立演示的筛选控件只用于测试 D 的状态协议。

## 3. D 如何接入

在 `main.js` 数据加载完成后调用：

```javascript
import { mountPlayerAnalysis } from "./playerAnalysis.js";

const playerPanel = mountPlayerAnalysis(
  document.getElementById("player-analysis"),
  store,
  { players, events, stats, collaborationEdges, competitionEdges }
);

// 可选：新比赛或异步数据到位时替换整组输入。
playerPanel.updateDataset(nextDataset);

// 页面卸载/重新挂载前，解除订阅并移除本模块节点、样式链接。
playerPanel.destroy();
```

由 D 在页面中提供一个容器，例如 `<section id="player-analysis"></section>`。挂载时模块自动加载自己旁边的 `../css/playerAnalysis.css`，不需要改 D 的基础样式表。整个 `src/` 相对路径保持一致即可部署。主题可以在 `.pa-panel` 上覆盖 `--pa-ink`、`--pa-muted`、`--pa-accent`、`--pa-soft`、`--pa-surface`、`--pa-line`。

store 只要求现有三个方法：

```javascript
store.getState();              // 当前快照
store.setState(patch);          // 合并 patch，通知订阅者
store.subscribe(listener);     // 返回解除订阅函数
```

读取 `selectedPlayerId`、`selectedTeamId`、`mode`、`timeRange`；本模块只写 `selectedPlayerId`。球员 ID 按标识符处理，不作为数组下标。搜索支持姓名（忽略常见重音符）、球队和球衣号；Messi/Mbappé 快捷选择通过实际球员姓名寻找 ID，不硬编码真实赛事 ID。

本模块既能处理面板内的球员选择，也会响应 B 在主图中写入的 `selectedPlayerId`。B 按共享状态高亮其主图中的关联超边；C 点击完整组合时还会发出可选事件，让 B 精确高亮该组合。A 概览和 D 控件写入同一 store，因此球员、球队、分钟和模式会同时作用于 C 与 B。

## 4. 指标定义与缺失值

所有事件指标排除 `period=5` 的点球大战。其他阶段使用 A 规范化后的整场 `time_seconds / 60`；不存在时退回 `minute + second / 60`。有效时间不依赖事件数组按秒排序。

个人指标对时间点采用闭区间 `[start, end]`。时间字段缺失时，不把事件自动视为第零分钟；受影响的时段指标显示 N/A。

| 指标 | 当前时段的计算 | 缺失/边界行为 |
|---|---|---|
| 传球 | 该球员发起的 `Pass` 数量 | 未提供事件时 N/A；确有事件数组但没有传球时为 0 |
| 成功传球/成功率 | `complete`/`completed` 视为成功；成功数除以全部传球数 | 未知或缺失结果使成功数/成功率为 N/A；零传球时成功率 N/A |
| 射门 | 该球员的 `Shot` 数量 | 无射门为 0；无法定位射门时间时，时段数值 N/A |
| 进球 | `Shot.outcome` 明确为 `Goal` 的次数 | 不计乌龙球；部分射门结果未知时 N/A |
| 助攻 | 当前时段 Pass 中 `goal_assist === true` 的次数 | 每次相关 Pass 必须有显式布尔标记，否则 N/A；不从接球人或关联事件猜测助攻 |
| xG | 所有选定射门的有效 xG 之和 | 每次射门都须有 `[0,1]` 的数值；部分缺失则 N/A。无射门且整组数据确认有 xG 时为 0，否则 N/A |

已识别的失败传球结果：`incomplete`、`failed`、`out`、`offside`、`pass offside`、`injury clearance`。已识别的非进球射门结果：`saved`、`blocked`、`off t`、`off target`、`post`、`wayward`、`saved off target`、`saved to post`。大小写和下划线会统一。其他值均视为未知，而非默认成功/失败。

全场对照优先使用 `stats.players[playerId]` 中的指标。某字段被省略时可以从事件计算；显式 `null` 保留 N/A。界面标明“比赛统计”或“事件计算”。大号时段数字始终从事件计算，绝不把全场数字直接复用到局部时间窗。

### 待 A 对齐的语义

冻结的最小事件契约没有规定助攻标记，也未列出完整的射门 `outcome` 枚举。本实现不修改共享数据格式：缺失时正常降级；如果 A 采用可选的 `goal_assist: boolean`，模块已经能够读取。请由全组确认后再更新共享契约。A 的全场统计也应确认是否排除点球大战，以免与事件指标口径不同。

## 5. 超图统计与时间/球队过滤

- 从当前模式的 `collaborationEdges` 或 `competitionEdges` 中选取含该球员的原始超边。
- 时间过滤严格使用约定的相交规则：`edge.end_minute >= start && edge.start_minute <= end`。跨越边界的片段完整计一次；不把它剪成一条新的超边。
- 球队过滤检查超边是否包含该球队。对抗边可同时属于两队的筛选结果。保留当前球员的个人指标；若其不属于所选球队，会显示提示。
- 每条原始边只计 1 次，按 `edge_id` 去重；`weight != 1` 的聚合记录不当成原始数据。
- 边至少含 3 名不同球员；协作边同队，对抗边跨至少两队，球队声明与球员名单一致，时间有效且有来源事件。
- 提供 events 数组时，来源事件 ID 必须存在且不能引用点球大战事件；未提供 events 时可独立展示关系，但展开依据会标明来源事件尚未载入。
- 队友柱状图：对每条选中的原始超边，其中每名其他球员各加 1 次。它表示共同参与片段次数，不等于两人直接传球次数或协作成功率。
- 多人组合：将整条边的去重球员 ID 排序后聚合，相同完整集合才是同一组合。显示 Top 5，全部原始边计数仍保留在总数中。
- 对抗模式标题改为“共同参与球员”，逐项标记队友/对手；没有把对手称作协作队友。

## 6. 特定组合高亮请求（B 已接入）

冻结 store 没有 `selectedEdgeId`。点击组合时，本模块在自己的 container 上发出可冒泡的 `playeranalysis:select-edges` 自定义事件；不会私自新增全局状态字段。

```javascript
document.getElementById("player-analysis").addEventListener(
  "playeranalysis:select-edges",
  ({ detail }) => {
    // detail = { playerId, mode, timeRange, edgeIds, playerIds }
    // B 的正式主图会据此优先显示并高亮完整组合。
  }
);
```

再次点击当前组合、切换球员/模式/时段/球队、替换数据或销毁组件会清除局部选择并发出空 `edgeIds`。B 会校验模式、球员和时间区间后再应用请求，避免旧组合在筛选改变后误高亮。

## 7. 测试与复现

本地验证环境：Node.js v24.15.0、Python 3、Playwright、系统 Google Chrome。生产模块仅依赖浏览器原生 ES Module 和 DOM。

无依赖统计测试：

```bash
node --test tests/playerAnalysis.test.mjs
```

可选浏览器测试（测试脚本自己启动临时端口的本地服务器）：

```bash
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node --test tests/playerAnalysis.browser.mjs
```

已有系统 Chrome 时可改用：

```bash
PLAYWRIGHT_BROWSER_CHANNEL=chrome node --test tests/playerAnalysis.browser.mjs
```

如使用共享环境中的 Playwright，而不是当前仓库的 node_modules，可将环境变量 `PLAYWRIGHT_MODULE` 设为其 `index.mjs` 的绝对路径。也支持 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定浏览器可执行文件。Windows 可使用对应终端的环境变量语法。

已实际运行：30 项 C 统计测试、15 项 C 浏览器测试，以及真实 A/B/C/D 统计与整合浏览器测试。完整命令及执行总数见 `docs/INTEGRATION_ACD.md`。覆盖统计边界、缺失值、射门源顺序、三种视图、B 组合高亮、生命周期及 320/360/768px 布局。`player-c-demo-*` 是模拟界面截图；`player-c-real-*` 与 `hypergraph-b-*` 是真实数据整合页面截图，均由实际浏览器生成。

## 8. 当前交付边界

C 的搜索、个人指标、对抗/协作关系、组合证据、射门与对比已使用 A/B/D 的真实产物验证；B 的球员高亮和 C→B 组合高亮已在真实浏览器中验收。正式三页 PPT 已交付；全组报告、D 幻灯片和最终课程压缩包仍由全组汇总。

## 9. AI 使用记录

2026-10-27～29：Codex 辅助完成接口分析、C 模块代码、模拟测试数据、自动化测试、独立演示、A/B/C/D 整合及真实源数据核对、接入文档和报告/展示文字草稿。仍需成员本人审阅实际交互、方法与课堂展示，并在最终报告如实披露 AI 使用范围。

## 10. 丰富版的三个探索视角

身份区和指标区之下，提供“多人关系 / 射门分析 / 球员对比”三个键盘可用的页签。切换视角、对比球员、组合展示方式和射门选择均为 C 内部状态，不给全组 store 增加字段。隐藏的射门/对比视图在打开时才计算和绘制，避免每次时间变化都重复处理不可见内容。

### 多人关系：画像、跳转与成员矩阵

- 关系概览显示不同共同参与球员数、不同完整组合数、平均原始片段人数。平均人数为每条已选原始边的基数取算术平均；无边显示横线，不产生虚假评分。
- 柱状图支持点击队友或对手，将其写入 `selectedPlayerId`，切换聚焦对象。
- 组合既可以看完整名单，也可切换为成员矩阵：行是球员、列是 Top 5 完整组合、实心点表示成员关系。当前球员行保留突出显示。
- 列标题与组合名单请求相同的一组原始超边，不将三人组合投影成两两传球。
- 来源事件展开为“时间 · 发起人 → 接球人 · 事件类型 · 结果”，同时保留原始事件 ID。
- 自动说明只复述当前筛选中的频次事实；并列会标明，不推断战术质量或因果贡献。

### 射门分析：原始坐标与事件证据

输入继续使用现有 `events.location`，没有增加必需数据字段。

- 球场约定为 **120 × 80**（StatsBomb 坐标）；接入不同坐标体系的源时，需先由数据负责人确认/转换。只检查坐标范围不能自动识别其他坐标系。
- 坐标按来源原样绘制，不镜像、不补位置，也不推断球员进攻方向；球场线条为示意。
- 标记大小随有效 xG 增大，实心表示进球，空心表示已知未进球，虚线边界表示结果未知。未知 xG 使用固定小点，详情仍显示 N/A。
- 没有位置、位置超出约定范围的射门保留在清单中；时间缺失的射门不能归入当前区间，会在说明中计数。
- 图上选择与原生按钮清单联动，显示分钟、结果、xG、来源事件 ID 和已有坐标；只改变本地选中状态。

### 球员对比：共同时间窗、原始单位

- 对比另一名球员的六项事件指标及原始超边参与量、共同参与球员数。
- 两人的个人指标使用同一时间窗；关系沿用当前模式和球队筛选。跨队比较时，应注意所选球队可能使一人的协作边被过滤。
- 同一行的两条长度使用共同量尺；不同指标各有自己的单位与量尺，不能跨行比较条长。
- 差值＝当前主球员减去对比球员；传球成功率差异换算为**百分点**。N/A 不转换为 0，也不产生虚构综合分或排名。
- 原始计数没有按实际上场分钟归一，不宣称每 90 分钟效率，也不将计数大小自动判为表现优劣。
- 交换按钮会通过既有接口更改主球员，将原主球员留作本地对照；同一球员或已移除球员不能与自身比较。

### 新截图

- `docs/screenshots/player-c-demo-comparison.png`：同一时段的双人对比。
- `docs/screenshots/player-c-demo-shots.png`：射门位置、xG 与事件清单联动。
- `docs/screenshots/player-c-demo-matrix.png`：成员矩阵与可读事件依据。

以上均为实际浏览器中的模拟数据界面，不能作为真实比赛结论。
