# C 模块：球星聚焦与个人表现分析

本模块遵循用户提供的四人分工与接口说明 v1.0（2026-10-27）。实现位于 `feature/player-C`；没有修改 A/B/D 的模块或共享状态协议。仓库当前的 README 仅给出了目标目录；本模块可以在其他成员代码到位前独立开发、运行和测试。

## 1. 立即运行

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
| `docs/slides/part_C_outline.md` | 约三页、三分钟的文字展示提纲；不是正式 PPT |
| `docs/screenshots/player-c-demo-*.png` | 实际运行的模拟演示截图，正式报告应替换为真实数据版本 |

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

本模块既能处理面板内的球员选择，也会响应 B 在主图中写入的 `selectedPlayerId`。B 必须按共享状态高亮其主图中的关联超边；当前独立演示只验证状态消息，不假装已接入 B 的图形。

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

## 6. 可选的特定组合高亮请求（供 B/D 接入）

冻结 store 没有 `selectedEdgeId`。点击组合时，本模块在自己的 container 上发出可冒泡的 `playeranalysis:select-edges` 自定义事件；不会私自新增全局状态字段。

```javascript
document.getElementById("player-analysis").addEventListener(
  "playeranalysis:select-edges",
  ({ detail }) => {
    // detail = { playerId, mode, timeRange, edgeIds, playerIds }
    // B/D 选择接入自己的公开高亮函数；不是必需的 mount 接口。
  }
);
```

再次点击当前组合、切换球员/模式/时段/球队、替换数据或销毁组件会清除局部选择并发出空 `edgeIds`。在没有监听方时，组合选择仍能展示片段时间、超边 ID 和来源事件 ID，但不会声称主图已高亮特定组合。

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

已实际运行：23 项统计测试、10 项浏览器测试全部通过。覆盖真实独立的预期统计值、时间闭区间与超边相交的区别、空数据、缺失 xG/结果/助攻标记、零传球、跨队关系、非法/聚合边、输入不变性、搜索、跨视图状态、组合通知、生命周期、多实例、文本安全、100 次快速切换和 320/360/768px 布局。截图由实际浏览器运行生成；它们展示的是模拟数据界面。

## 8. 当前交付边界

C 的实现、模拟演示、自动化验证和交接材料可独立使用。尚未拿到 A/B/D 的正式产物，因此以下内容仍需集成阶段验证：真实 JSON 的字段口径、B 的实际图形高亮、D 的正式 store 与时间控制、真实比赛案例与正式报告截图。正式 PPT、真实比赛结论与最终提交压缩包应在整体联调后完成。

## 9. AI 使用记录

2026-10-27：Codex 辅助完成接口分析、C 模块代码、模拟测试数据、自动化测试、独立演示、接入文档及报告/展示文字草稿。已运行的自动化验证记录如上。正式赛事数据和其他模块尚未接入；仍需本人检查实际交互与数值，并在最终报告如实披露 AI 使用范围。
