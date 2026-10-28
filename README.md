# Football HyperGraph Explorer

Data Visualization 期中团队项目。当前已整合 A 的真实数据与比赛概览、C 的球星关系/射门/对比分析、D 的对抗建模与正式状态/时间控件。B 的协作建模和唯一主超图尚未交付，页面明确提示待接入；这不是四模块全部完成的最终提交版。

## 运行整合版（推荐）

需要 Python 3.10+。在仓库根目录运行：

```bash
python3 scripts/prepare_data.py
python3 -m http.server 8000 --bind 127.0.0.1
```

Windows 可将 `python3` 换成 `python`。浏览器打开 [整合页面](http://127.0.0.1:8000/src/)。有完整源数据缓存时，使用 `python3 scripts/prepare_data.py --offline` 重建，无需网络。

脚本依次校验/下载 A 的固定版本数据、生成三份基础 JSON，再运行 D 的对抗建模；本场得到 385 条原始事件窗口超边。没有 B 脚本时不会生成空协作文件。正式页面只将关系文件的 HTTP 404 视为“未提供”；基础数据缺失、非法 JSON、错误事件证据或服务器故障仍会报错。严格的五文件加载 API 默认行为保持不变。

1. 在“球星与关系”选择 Messi 或 Mbappé，查看时段指标与全场对照。页签提供多人组合/成员矩阵与事件证据、射门分布和球员对比。
2. 顶部模式、分钟区间和球队由 D 的正式 store 同步。当前只有对抗数据时默认对抗模式；切换协作会显示数据未提供，个人指标仍可查看。
3. “比赛概览”使用 A 的浅色仪表盘；从概览选人会回到球星视角。A 的阶段和事件类型是其本地筛选，不会成为 C 的阶段筛选。
4. 补时与下一阶段的原始分钟可能重叠。C 按共享分钟过滤、射门清单按阶段和事件顺序显示；未知成功率、时段助攻仍保留 N/A。

原始/标准化赛事数据及派生超边在本地重建，不提交逐事件 JSON；署名、许可与来源约束沿用 A 的数据说明。已移除 D 在输入缺失时产生的空占位文件，避免把它当成真实提取结果。详情与验证记录见 [整合说明](docs/INTEGRATION_ACD.md)。

## 先运行 A 模块

需要 Python 3.10 或更新版本；三个数据脚本仅使用标准库，不必安装 Pandas、Flask 或 npm 包。在项目根目录执行：

```powershell
python scripts/load_data.py
python scripts/preprocess.py
python scripts/calculate_stats.py
python -m http.server 8000 --bind 127.0.0.1
```

浏览器打开 [A 模块真实数据验收页](http://127.0.0.1:8000/demos/data-a/)。不要双击 HTML 或使用 `file://`。前端没有运行时 CDN 依赖；首次下载源数据需要网络，之后可以离线重建。

页面操作：

页面是比赛概览仪表盘，右上角可切换深色（默认）和浅色主题；较小屏幕需纵向滚动。集成时调用 `mountDataExplorer(container, store, dataset, { theme: "light" })` 可选浅色，不传第四个参数就是深色。

1. 顶部比分区：比分、进球者与分钟、点球大战逐个罚球结果，下面一句话总结比赛走势（由进球顺序生成）。
2. 筛选栏切换球队、比赛阶段和事件类型。指标、球员关联条数和事件记录响应全部条件；事件分布和射门图不受事件类型筛选影响；两队对比保留双方，只受阶段和分钟影响；xG 曲线保留全场作为参照。
3. “xG 走势”直接标出每个进球。只允许在同一比赛阶段内拖选，成功后同步 A 的阶段与共享分钟区间；跨阶段拖选会提示并保留原筛选。“全场”清除 A 的阶段筛选并恢复全场分钟。C 仍只按共享分钟计算，不跟随 A 的阶段。
4. “两队对比”中较大数值用队色标出；“射门分布”里可见圆面积与 xG 成正比，实色表示进球、浅色表示未进。透明交互区域让小圆也能点击，不改变可见面积；缺失 xG 显示问号，xG 为零不绘制正面积圆。
5. 底部标签页可在“球员”和“事件记录”之间切换；点击球员会展开下方 C 模块的个人分析。“无关联事件”只描述记录覆盖，不代表未登场，例如 Disasi 在加时末段已替补上场。
6. 页面最下面“测试工具”里的分钟输入只用于测试共享时间接口。

球队、时间和选中球员通过共享状态联动；A 的事件类型与比赛阶段只作用于 A 概览。点球大战单列，个人传球、射门、进球等指标仅统计第 1–4 节。详细口径见 [A 数据与接口说明](docs/DATA_A.md)。

## 数据重建与自测

已下载源数据时，先校验本地缓存，再重建：

```powershell
python scripts/load_data.py --offline
python scripts/preprocess.py
python scripts/calculate_stats.py
```

检查“没有预处理产物也能重建”时，可写入独立目录，无需删除其他成员的数据：

```powershell
python scripts/preprocess.py --output-dir output/rebuild-A
python scripts/calculate_stats.py --output-dir output/rebuild-A
```

A 数据测试及独立源数据核对：

```powershell
python -m unittest discover -s tests -p "test_data*.py" -v
python tests/audit_data_A.py
```

若安装了 Node.js 22.7 或更新版本，可运行无第三方依赖的前端统计测试：

```powershell
node --test tests/dataExplorer.test.mjs tests/playerAnalysis.test.mjs
```

浏览器验收另需 Playwright。测试使用临时本地服务并自动关闭；生产网页不需要安装此依赖。

Windows PowerShell，使用系统已有的 Microsoft Edge：

```powershell
npm install --no-save --package-lock=false playwright
$env:PLAYWRIGHT_MODULE='playwright'
$env:PLAYWRIGHT_BROWSER_CHANNEL='msedge'
node --test tests/dataExplorer.browser.mjs
$env:DE_THEME='light'; node --test tests/dataExplorer.browser.mjs; Remove-Item Env:DE_THEME
```

第一条测深色主题并生成 `docs/screenshots/data-a-*.png`，第二条测浅色主题并生成 `data-a-light-*.png`。

若使用 Playwright 自带 Chromium（Windows/macOS/Linux 均可）：

```powershell
npx playwright install chromium
```

Windows 将 `$env:PLAYWRIGHT_BROWSER_CHANNEL='chromium'` 后执行同一测试命令。macOS/Linux 使用 `PLAYWRIGHT_MODULE=playwright PLAYWRIGHT_BROWSER_CHANNEL=chromium node --test tests/dataExplorer.browser.mjs`。2026-10-28 已在 Windows 系统 Edge 上执行修复后的深色、浅色测试，各 17 项通过（见 [验收记录](docs/ACCEPTANCE_A.md)）。其他平台的安装步骤仅作为复现说明。

所有数据脚本默认路径以脚本所在项目为准。可用 `--raw-dir PATH` 指定原始数据目录；`preprocess.py` 和 `calculate_stats.py` 必须使用相同的 `--output-dir`。只有 `load_data.py` 使用网络；`--offline` 不联网，`--force` 重新下载固定版本，二者不能同时使用。

## 真实数据与边界

数据来自 [StatsBomb Open Data](https://github.com/hudl/open-data)，比赛 ID 为 `3869685`：2022-12-18 阿根廷对法国。上游固定在 commit `4b73468fc5b0f1950f9f66fada70ad3a4f9327cb`，下载文件逐一校验 SHA256。

| 项目 | 实际值 |
|---|---:|
| 比赛名单人数 / 有事件记录的人数 | 50 / 34 |
| 原始和标准化事件 | 4407 |
| 第 1–4 节事件 / 点球大战事件 | 4386 / 21 |
| 含加时的比分 / 点球大战比分 | 3:3 / 4:2 |
| 阿根廷传球 / 明确成功 / 射门 | 693 / 560 / 20 |
| 法国传球 / 明确成功 / 射门 | 570 / 434 / 10 |

10 次传球的源结果为 `Unknown`，不当作成功；A 的成功率是“已确认成功数 / 全部传球数”，属于按当前证据计算的保守比例。原数据有 6 次时间回退，其中 2 次是同阶段接球记录的异常时间。保留原时钟与事件顺序，并在界面、文档和诊断文件中说明，未自行修改比赛记录。

C 模块在含未知传球结果的时段将成功率显示为 `N/A`；时段助攻因 v1 事件契约未包含助攻标记而显示 `N/A`，全场助攻仍可从 `stats.json` 读取。这些差异不能通过编造字段或结果消除。

## 文件入口

| 路径 | 用途 |
|---|---|
| `scripts/load_data.py`、`preprocess.py`、`calculate_stats.py` | A 的下载、规范化和统计 |
| `data/processed/players.json`、`events.json`、`stats.json` | 本地重建的三份共享数据 |
| `src/js/dataExplorer.js`、`src/css/dataExplorer.css` | A 比赛概览模块 |
| `demos/data-a/` | A 的真实数据独立验收页面 |
| `src/js/playerAnalysis.js` | C 关系/射门/对比分析，已接入真实 A/D 数据 |
| `src/index.html` | A/C/D 整合入口；B 主超图待接入 |
| `scripts/prepare_data.py` | 重建当前已交付数据的一条命令入口 |
| `demos/player-c/` | C 原有模拟数据测试页，不能用作真实比赛结论 |
| [docs/DATA_A.md](docs/DATA_A.md) | 数据字典、统计口径、时间异常、交接接口 |
| [docs/ACCEPTANCE_A.md](docs/ACCEPTANCE_A.md) | 实际验收结果与截图（当前 109 次应用测试执行通过） |
| [docs/TASK_CHECKLIST_A.md](docs/TASK_CHECKLIST_A.md) | 按 A 原始任务逐项对照与补齐记录 |
| [docs/AI_USAGE_A.md](docs/AI_USAGE_A.md) | AI 具体用途及人工审核状态 |
| [docs/report/part_A.md](docs/report/part_A.md) | A 的报告章节草稿 |
| [docs/report/ASSEMBLY_A.md](docs/report/ASSEMBLY_A.md) | 后续整组报告与打包的依赖清单 |
| [docs/slides/part_A_outline.md](docs/slides/part_A_outline.md) | 三页、约三分钟展示文字提纲 |
| [docs/slides/part_A.pptx](docs/slides/part_A.pptx) | 可编辑的三页 A 展示幻灯片，含讲稿、来源与 2026-10-28 新截图 |
| [docs/PLAYER_C.md](docs/PLAYER_C.md) | C 模块接口、指标和真实数据联调说明 |

原始文件与三份本地数据已加入 `.gitignore`。数据受 StatsBomb 许可约束，不能把公开可下载理解为任意再分发授权。源码交接使用下载和重建脚本；公开发布或作业打包时按 [官方许可](docs/data_source/StatsBomb-LICENSE.pdf) 处理数据，不直接公开分发逐事件文件。展示分析时保留 StatsBomb 来源和官方标志。

本次使用 AI 辅助实现、调试、自动化测试和文档整理。自动验收不等于成员已完成个人审阅或课堂演示；最终报告应如实记录每位成员的实际核验与 AI 使用。A 的交付使用 `feature/data-A` 分支，通过 PR 邀请其他组员审核后再合并到 `main`。本地验收记录保留提交前的证据，发布状态以 GitHub 分支和 PR 为准。
