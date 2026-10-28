# 模块 D：对抗、时间与系统集成交接

> 2026-10-28 整合补充：下文保留 D 独立开发阶段的事实。当前 A/C/D 已接入真实数据，D 成功提取 385 条对抗超边；B 仍待交付。新的启动步骤、缺失文件行为及验证见 [A/C/D 整合说明](INTEGRATION_ACD.md)。

依据：项目根目录 `Team-Task.md` v1.0，第 3 节为冻结契约。完整实现已经逐文件写入仓库，没有伪代码占位。

## 1. 当前事实与交付范围

2026-10-28，本工作区已有 C 的 `playerAnalysis.js` 及其样式、测试；A 的数据脚本、三份正式 JSON、概览模块，以及 B 的协作边与 `hypergraph.js` 尚未交付。

`data/processed/competition_edges.json` 当前为 `[]`。原因是没有 A 的真实输入，不能认定已验证 2022 世界杯决赛，也不能把空数组解释成比赛没有对抗。生产入口不会自动导入测试 fixture。缺失文件会列出文件名和 HTTP 状态；缺失模块会显示所在区域的错误。只有五份数据全部载入且通过校验，才尝试挂载各模块。

未改动 A/B/C 代码、根 README 或冻结的 Team-Task；根 README 由 A 汇总时可引用本文。未实现另一套超图或球员分析。未添加播放功能；本版采用可靠的双端点时间筛选。

## 2. 文件、输入输出与接口

| 文件 | 完整实现与职责 |
| --- | --- |
| `scripts/build_competition.py` | Python 标准库；读取 players/events，返回原始竞争超边及独立审计摘要 |
| `data/processed/competition_edges.json` | 第 3.4 节统一超边数组；当前无真实输入而为空 |
| `src/js/state.js` | `getState()` / `setState(patch)` / `subscribe(listener)`；生产唯一状态实例 |
| `src/js/competitionTimeline.js` | `mountCompetitionTimeline(container, store, dataset)`；模式、球队、时间端点、事件分布和原始边数 |
| `src/js/main.js` | 载入五文件、校验引用与证据、初始化比赛时长、按约定挂载 A/B/C/D |
| `src/index.html` | 页面与四个独立容器、加载与错误提示 |
| `src/css/style.css` | 页面响应式布局与 `ct-*` 控件样式；不替代 C/B 自有样式 |
| `tests/test_build_competition.py` | Python 证据提取、窗口、错误和命令行测试 |
| `tests/moduleD.test.mjs` | 状态、时间、校验与装配测试；还直接验证既有 C 的响应 |
| `tests/moduleD.browser.mjs` | Chrome/Playwright 真实浏览器测试；A/B 为明确标记的接口替身 |
| `tests/fixtures/moduleD.js` | 仅测试使用的模拟数据；ID 均带 `mock-`，比赛名明确标记 MOCK |
| `docs/report/part_D.md` | Competition & Temporal 报告草稿及结论初稿 |
| `docs/slides/part_D_outline.md` | 3 页、3 分钟展示提纲 |
| `docs/screenshots/module-d-*.png` | 实际浏览器截图；文件名区分缺失数据与模拟联调 |

状态字段仍只有 `selectedMatchId`、`selectedTeamId`、`selectedPlayerId`、`mode`、`timeRange`。`timeRange` 为分钟浮点闭区间。无效 patch 原子拒绝；相同状态不重复通知；快照独立复制；支持退订、订阅内更新排队和单个订阅者出错隔离。`createStore(seed)` 仅是测试/隔离实例的额外导出，不要求其他成员使用。

挂载调用仍严格为：

```javascript
mountDataExplorer(document.getElementById("data-explorer"), store, dataset);
mountHypergraph(document.getElementById("hypergraph"), store, dataset);
mountPlayerAnalysis(document.getElementById("player-analysis"), store, dataset);
mountCompetitionTimeline(document.getElementById("competition-timeline"), store, dataset);
```

`dataset` 仅含 `players`、`events`、`stats`、`collaborationEdges`、`competitionEdges` 五个约定键。四模块收到同一个 dataset 对象与同一个 store。模式与时间变化只更新 store，不重新挂载任何模块。A/B/C 各自订阅、清理旧图形；返回清理函数或 `{destroy()}` 时，页面退出会调用它。D 控件也提供幂等 `destroy()`。

时间工具由 D 自己读取冻结字段，不依赖 C 的额外挂载外 API；测试检查 D 与现有 C 的时间口径一致。没有私下要求 C 修改接口。

## 3. 对抗证据算法与边界

1. 球员与事件 ID 必须为非空字符串且唯一。缺少 `period` 或 `event_index`、比赛顺序键重复时直接报错，禁止按秒数猜测排序。
2. 按 `(period, event_index)` 排序。只使用第 1–4 阶段，排除第 5 阶段点球大战。按连续 `(period, possession_id)` 切段；同一 ID 后来再次出现也不重新拼接。缺失时间/控球/发起球员、球员球队不一致的记录切断连续性；同段时钟倒退也切段。
3. 实际存在的 `Pressure`、`Duel`、`Interception`、`Dispossessed`、`Ball Recovery` 是锚点。没有这些记录，不能凭短时间内有两队球员就称为对抗窗口。
4. 每个锚点默认中心前后各 2.5 秒，含边界，总长度不超过 5 秒，并且仍受同一连续控球片段限制。上下文仅含上述锚点事件与 `Pass`、`Carry`、`Dribble`、`Shot`、`Ball Receipt*`；其他事件不贡献参与者。不读取坐标来补防守球员。
5. 收集这些来源事件的实际 `player_id`，以及 Pass 明确记录且在同队名单中的 `recipient_id`。未知、跨队或缺失的 Pass 接球对象不补入。明确的 Pass 接球对象只证明被记录为传球对象，不证明传球成功或成功接球。
6. 至少 3 名不同球员，至少 2 队，而且两队都必须有发起事件；不能靠一个不一致的接球字段制造第二支队伍。
7. 默认最多 8 人、24 个上下文事件。超出上限跳过整个窗口，避免截断证据或生成覆盖全队的包络；这些是设计参数，不是已验证的足球事实。
8. 同一组有序来源事件只保留一次；相同球员组合在不同时刻出现，仍是独立原始边。边 ID 由来源事件序列稳定散列生成。不同但重叠的窗口可以保留，因此边数不是独立争抢次数。
9. 每条输出严格为 `type=competition`、`weight=1`、`evidence_type=event_window_inference`。保存去重参与球员/球队、有序 `event_ids`、来源事件最早/最晚时间除以 60、证据说明；不添加不兼容字段。

主要风险：时间共现有误关联；严格控球边界会漏掉跨控球争抢；逐事件记录不覆盖无球球员；原始时间异常会减少可用片段；窗口宽度与人数上限影响结果。默认阈值尚未在真实决赛数据上做敏感性分析。无边表示证据门槛未满足，不是不存在攻防活动。数据真实性仍须由 A 对照源文件核验；结构校验不能认证原始来源。

## 4. 启动与重建

生产仅需 Python 3 和支持 ES Module 的浏览器。D 不依赖 Pandas、npm 构建或 CDN；B 的 D3 依赖由 B 交付并在联调时单独检查。

在仓库根目录执行：

```powershell
python scripts/build_competition.py
python -m http.server 8000 --bind 127.0.0.1
```

访问 `http://127.0.0.1:8000/src/`，不要通过 `file://` 打开。

脚本默认输入为 `data/processed/players.json`、`events.json`，默认输出为 `data/processed/competition_edges.json`；默认路径相对脚本所在仓库，支持从其他工作目录调用。使用自定义路径、阈值和可选审计文件：

```powershell
python scripts/build_competition.py --players data/processed/players.json --events data/processed/events.json --output data/processed/competition_edges.json --window-seconds 5 --max-players 8 --max-events 24 --diagnostics docs/competition-build-audit.json
```

审计文件是独立日志，不是第六份前端赛事文件。标准错误输出含状态、输入/输出数量、参数与跳过原因；`unusable_recipient_occurrences` 按被窗口访问的次数统计，并非唯一事件数。合法输入但无足够证据时输出 `[]`，退出码 0；输入缺失或无效时也输出 `[]` 防止旧边残留，退出码 2，并明确报错。流水线必须检查退出码。输出目录不可写等文件系统错误会使命令失败，不应忽略。输出不能覆盖输入文件。

当前首次实际运行属于“输入缺失、退出码 2”，空文件不能标记为真实数据提取成功。

## 5. 前端行为与联调顺序

1. A 交付三份 JSON 与 `dataExplorer.js`；B 交付 `collaboration_edges.json` 与 `hypergraph.js`。这些是已有约定的交付物，不是新接口申请。先抽查 A 的时间映射、ID/球队与事件类型语义。
2. 运行 A 的既有数据流水线，再运行 B 的协作脚本和 D 的竞争脚本。缺少 A/B 时不代写其数据，不锁定真实比赛名。
3. 打开 `/src/`。main 同时请求五个固定文件；文件缺失、非法 JSON、球员引用错误、伪造参与者、时间与来源不一致等会给出可读错误。空 competition 文件是合法输入。概览/主图模块缺失时只在该区域报错，已交付模块继续使用。
4. B 只挂载一次。它按 `mode` 选择 `dataset.collaborationEdges` 或 `dataset.competitionEdges`；按 `edge.end_minute >= start && edge.start_minute <= end` 过滤。D 的计数采用相同规则，球队筛选按 `team_ids` 是否包含所选队。球员选择仅请求高亮，不删除其他边。
5. C 直接订阅正式 store。点击/搜索球员后更改时段，检查时段指标变化、全场对照保持明确；N/A 不能补零。现有 C 的时间/事件指标排除点球大战；D 的对抗边与比赛范围与此一致。
6. 用两个端点滑块或数值框修改分钟。支持小数与零宽区间；跨越另一个端点时将另一端推到相同值，不产生倒序。最大分钟取事件与超边的实际最大值，不硬编码 130；“查看全场”恢复 `[0, max]`。
7. 时间条的柱子只表示每 5 分钟已记录的五类对抗事件数量；不按窗口数量虚构对抗强度，也不表示站位。模式按钮使用绿色/棕色及 `aria-pressed`，主图的编码与图例仍由 B 解释。
8. 正式验收：0、最后一分钟、边开始与结束的精确时刻、无边时段、两队筛选、连续模式切换、球员切换；检查 B 没有重复 SVG、C 不复用全场统计充当时段值、点击主图超边可查看真实来源。

当前 C 的可选 `playeranalysis:select-edges` 事件不接入主图，因为冻结协议未规定特定组合高亮函数。球员选择高亮仍使用已冻结的 `selectedPlayerId`。可选组合继续展示 C 自己的来源证据，不宣称 B 已高亮该组合。

## 6. 测试命令与记录

基础测试无需额外库：

```powershell
python -m unittest discover -s tests -p test_build_competition.py -v
node --test tests/moduleD.test.mjs tests/playerAnalysis.test.mjs
```

浏览器测试仅开发时需要 Playwright 与 Chrome；不会成为生产依赖：

```powershell
npm install --no-save --package-lock=false playwright
$env:PLAYWRIGHT_BROWSER_CHANNEL = 'chrome'
node --test tests/moduleD.browser.mjs
```

已安装 Playwright 但不在当前 node_modules 时，可把 `$env:PLAYWRIGHT_MODULE` 指向其 `index.mjs` 绝对路径。也可用 `$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定浏览器路径。浏览器测试自行创建本地 HTTP 服务，不需要同时启动 8000 端口。第一项用本仓库的真实缺失文件状态；其余通过浏览器请求替换五份 JSON 与 A/B 模块，绝不写入正式 A/B 文件。

| 类别 | 自动验证的关键断言 |
| --- | --- |
| 正常证据 | 恰好三人跨两队，源事件可追溯、时间精确、顺序稳定、权重固定 |
| 空对抗边 | 两人/无锚点/未知参与者不产生边；`[]` 可载入、页面解释为空 |
| 边界时间窗 | 锚点 ±2.5 秒包含端点，稍超出不包含；不跨阶段、控球、时间倒退 |
| 连续切换 | 状态测试 1000 次更新；浏览器点击 100 次；D/C 不重复挂载，B 替身 SVG 保持一个 |
| C 联动 | 正式 D 控件改变 `[1,1]`、`[0,0]` 时，现有 C 的传球数由 1 变为 0 |
| 缺失与异常 | 五文件 404、非法 JSON、未知事件引用、伪造参与者或时间、缺少 B 模块 |
| 生命周期与小屏 | 退订、幂等销毁、唯一输入 ID，320/360/768px 无页面横向溢出 |

运行结果以 `docs/TEST_RESULTS_D.md` 为准。所有 fixture 与接口替身只能证明实现行为，不能作为真实决赛结论，也不能替代 B 真正的布局/拖拽/点击证据验收。

## 7. 变更申请与剩余验收

**本次没有共享契约变更申请。** 没有添加必需状态字段、数据文件、边结构或 mount 参数；没有要求其他成员私下修改接口。

仍需正式验收：A 的真实赛事/许可和时间语义；真实输入下的 D 提取结果及阈值敏感性；B 的 D3 依赖、实际双模式几何与图例、拖拽缩放、事件依据展示与球星高亮；全组完整路径。当前缺这些交付物，不能宣布四模块实战联调完成。

## 8. AI 使用记录

Codex 用于读取团队协议、设计 D 的保守证据算法、编写 D 的 Python/JS/HTML/CSS、合成独立测试记录、运行自动化检查、生成运行截图，以及起草本交接文档/报告/PPT 提纲。自动化运行结果与人工验收分开记录；本次没有人工核验真实赛事数据。最终组员须审核方法、真实来源与课堂演示，并如实披露 AI 协助。
