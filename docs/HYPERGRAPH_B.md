# B：协作超边与唯一主超图交付

分支：`feature/hypergraph-B`。遵循根目录《Football_Hypergraph_四人分工与AI协作说明.md》第 3、4.1、6、10 节与 `GITHUB_WORKFLOW.md`。交付只扩展 B 文件及相关集成测试，不修改 A/C/D 生产模块、共享 JSON 字段、store 或挂载参数。

## 前序依赖确认

开发前已成功执行既有 `python3 scripts/prepare_data.py`，下载并校验 A 固定版本源文件，重建 50 名名单球员、4407 条事件、统计以及 D 的 385 条对抗超边。既有 44 项 Python、63 项 Node 测试通过；另运行 A 独立源数据审计及 4 项真实 A/C/D Node 集成检查。前序代码和真实数据可用于 B 开发，不再依赖模拟文件。

源固定为 StatsBomb Open Data commit `4b73468fc5b0f1950f9f66fada70ad3a4f9327cb`，比赛 `3869685`。数据字典和许可处理沿用 [DATA_A.md](DATA_A.md)。原始及派生逐事件 JSON 保留本地重建，不提交到源码。

## 运行与成果检查

Python 3.10+，浏览器支持 ES Module。在仓库根目录执行：

```bash
python3 scripts/prepare_data.py
python3 -m http.server 8000 --bind 127.0.0.1
```

Windows 可以将 `python3` 换成 `python`。打开 <http://127.0.0.1:8000/src/>。完整源缓存存在时用 `python3 scripts/prepare_data.py --offline`。现有准备脚本会自动发现 B 的新脚本，无需改动 A/D 的流水线。网页与 B 算法无需 npm 安装、Pandas、后端或 CDN；D3 7.9.0 随 B 源码提供。

默认应显示 4407 条事件、531 条协作超边、385 条对抗超边，载入诊断没有模块缺失。主图按完整球员集合聚合显示 Top 12（可选 Top 24），明确显示过滤后原始片段数、组合数和实际显示数。图中的 `×N` 是组合频次，JSON 中每条原始边仍是 `weight=1`。

人工检查顺序：

1. 确认主图、两队图例、包络编号和至少三人成员关系。默认协作有 531 个原始片段、331 个完整组合。
2. 从 C 面板选择 Messi，主图优先显示关联组合并高亮；全场协作参与数应为 81。切 Mbappé 后为 32。未显示的组合只受明确 Top-K 限制，不从原始计数中删除。
3. 点击图中球员或聚焦球员节点后按 Enter，C 面板更换球员。方向键可移动聚焦节点；鼠标可拖动节点。
4. 滚轮或“放大/缩小”改变缩放，拖动空白处平移，“重置视图”恢复。节点位置仅为关系布局，不是球场站位。
5. 点击包络、编号或下方组合按钮，确认完整成员、每个原始片段的时间、超边 ID。展开片段查看事件 ID、发起者、传球对象和结果。
6. 切 Competition：沿用同一个 SVG，边界变虚线，明确标为事件窗口推断。Messi 全场参与 87 个对抗窗口；不是 87 次独立对抗。
7. 更换球队与分钟端点，图、D 计数和 C 关系同步。选中一支球队时，对抗边保留所有跨队参与者。无边区间显示空状态。
8. 在 C 的组合列表/矩阵选择一个组合，主图选择对应完整成员集合。切球员、模式、球队或时间后清除组合选择。
9. 用 320/360/768px 窗口检查页面无整体横向溢出，仍能使用组合按钮阅读成员与证据。

## 文件与接口

| 文件 | 用途 |
|---|---|
| `scripts/build_collaboration.py` | 标准库 CLI、纯构建函数、独立审计摘要 |
| `data/processed/collaboration_edges.json` | 本地重建的真实原始协作超边，不纳入 Git |
| `src/js/hypergraph.js` | 唯一 D3 主图；纯选择/聚合/包络函数；模块生命周期 |
| `src/css/hypergraph.css` | 仅 `.hg-panel` 命名空间，模块挂载时加载 |
| `src/js/vendor/d3.v7.9.0.js`、`D3-LICENSE` | D3 官方发行包加最小 ESM 导出及 ISC 许可 |
| `tests/test_build_collaboration.py` | 合成数据的算法/CLI 边界测试 |
| `tests/audit_hypergraph_B.py` | 独立对照全部原始事件审计真实协作边 |
| `tests/hypergraph.test.mjs` | 选择、聚合、退化几何、真实五文件与 B/C/D 一致性 |
| `tests/hypergraph.browser.mjs` | 真实 A/B/C/D 页面、交互、截图和生命周期 |
| `docs/report/part_B.md` | 方法、视觉编码、真实案例与局限 |
| `docs/slides/part_B_outline.md` | 三页展示提纲、讲稿与检查路径 |
| `docs/slides/part_B.pptx`、`scripts/build_slides_B.py` | 可编辑三页 PPT 与可选生成脚本 |

唯一必需挂载接口不变：

```javascript
import { mountHypergraph } from './hypergraph.js';
const graph = mountHypergraph(container, store, dataset);
graph.updateDataset(nextDataset); // 可选，替换输入并清理旧几何
graph.destroy();                  // 退订、移除文档事件监听与本容器内容，可重复调用
```

读取 `mode/timeRange/selectedTeamId/selectedPlayerId`；点击球员只写 `selectedPlayerId`。时间严格使用 `edge.end_minute >= start && edge.start_minute <= end`。C 的 `playeranalysis:select-edges` 是可选冒泡事件，检查当前球员、模式和时间后接入，不增加 store 字段。只挂载一个 SVG，状态变化使用 D3 data join 更新。

## 协作构建规则和边界

按 `(period, event_index)` 排序，只使用第 1–4 节。控球 ID 不等于球队，球队仍通过球员名单和事件字段核对。连续成功 Pass 的下一发起者必须等于上一传球对象；同队 Carry、Ball Receipt*、Dribble 可以桥接，但不新增参与者。其他事件、对手事件、失败/Unknown 传球、非法球员或传球对象、缺失时间/控球、阶段/控球变化与时钟回退均切断链。

每次有效 Pass 结束时提取尾部窗口：最多 4 次传球、20 秒、5 名球员。去重至少三人才输出；人数超过上限跳过整个候选，不截断成员。保存实际 Pass 的源 ID、最早/最晚分钟及稳定边 ID。默认产生 531 条边：阿根廷 302、法国 229；三人 262、四人 187、五人 82。重复组合可在前端合并，但所有来源片段仍可展开。

```bash
python3 scripts/build_collaboration.py --max-passes 4 --max-seconds 20 --max-players 5
python3 scripts/build_collaboration.py --help
```

支持 `--players/--events/--output/--diagnostics`，默认路径相对脚本所在仓库。默认审计为 `output/collaboration-build-audit.json`。合法无边写 `[]` 且退出码 0；缺输入、无效身份/顺序、无效参数或写失败返回非零（通常 2），不会把失败伪装成成功空数据。保留旧产物时会明确提示其不是新成功输出；准备流水线会停止。输出原子替换，不允许覆盖输入。

## 自动验收命令

先执行数据准备；真实检查缺少文件会报错，不自动回退 fixture。

```bash
python3 -m unittest discover -s tests -p test_build_collaboration.py -v
python3 tests/audit_hypergraph_B.py
node --test tests/hypergraph.test.mjs
```

浏览器检查需要 Node.js 22.7+、Playwright；生产网页不需要这些依赖。

```bash
npm install --no-save --package-lock=false playwright@1.56.1
npx playwright install chromium
node --test tests/hypergraph.browser.mjs
```

测试会自动启动临时 HTTP 服务，无需提前占用 8000 端口。可用 `PLAYWRIGHT_MODULE` 指定已有 Playwright 的 `index.mjs`，`PLAYWRIGHT_BROWSER_CHANNEL=chrome` 选择已有 Chrome，或 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定浏览器。

全组非浏览器回归：

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
python3 tests/audit_data_A.py
python3 tests/audit_hypergraph_B.py
node --test tests/dataExplorer.test.mjs tests/playerAnalysis.test.mjs tests/moduleD.test.mjs tests/integration.real.test.mjs tests/hypergraph.test.mjs
```

浏览器全组回归可运行 `tests/dataExplorer.browser.mjs tests/playerAnalysis.browser.mjs tests/moduleD.browser.mjs tests/integration.real.browser.mjs tests/hypergraph.browser.mjs`，按 README 选择浏览器。历史 A/C/D 浏览器测试的“B 未交付”场景已改为显式拦截 B 文件 404，继续保留缺失边界测试，不再假定 B 永远不存在。

实际结果及截图见 [TEST_RESULTS_B.md](TEST_RESULTS_B.md)。组员本人仍应按前述步骤操作、审阅并计时排练；自动检查不冒称个人审核。

## 交接与提交

B 的图形问题由 B 修复。D 的入口已自动导入 `hypergraph.js`，无需编辑 `main.js/index.html/state.js/style.css`。A 的 README 及整组报告可引用本文，不改写他人阶段性历史记录。

本地开发完成后先 `git status`、`git diff`、`git diff --check`，精确暂存 B 源码、测试、文档和截图，不加入原始/派生事件 JSON，也不把用户原有未跟踪的两份团队说明混入提交。通过 `feature/hypergraph-B` 的 PR 审核再合入 main。AI 具体用途、个人审核状态、案例局限和截图随报告交给 A 汇总。

精确提交示例（先检查成果；实际提交和发布状态以 Git 分支及 GitHub 为准）：

```bash
git status --short --branch
git diff -- tests/integration.real.browser.mjs
git add scripts/build_collaboration.py scripts/build_slides_B.py src/js/hypergraph.js src/css/hypergraph.css src/js/vendor/
git add tests/test_build_collaboration.py tests/audit_hypergraph_B.py tests/hypergraph.test.mjs tests/hypergraph.browser.mjs tests/integration.real.browser.mjs
git add docs/HYPERGRAPH_B.md docs/TEST_RESULTS_B.md docs/hypergraph-build-audit-real.json docs/report/part_B.md docs/slides/part_B_outline.md docs/slides/part_B.pptx docs/screenshots/hypergraph-b-*.png
git diff --cached --check
git diff --cached --stat
git commit -m "feat(hypergraph): add traceable collaboration and dual-mode D3 view"
git push -u origin feature/hypergraph-B
```

随后创建 base=`main`、compare=`feature/hypergraph-B` 的 PR，按 `GITHUB_WORKFLOW.md` 附上运行命令、测试结果、截图、接口保持不变的说明及 AI 用途，邀请另一位成员审核。不要直接推送 main。

PPT 文件可直接打开，重建仅额外需要 `python-pptx`：

```bash
python3 -m pip install python-pptx
python3 scripts/build_slides_B.py
```

先运行 B 浏览器测试生成 `hypergraph-b-main.png`。PPT 有三页备注、可编辑原生示意与统计图；已检查结构和元素边界，仍需在展示电脑实际打开并计时排练。仓库 README 和 A/C/D 历史记录中的“B 尚未交付”属于早期状态；当前交付以本文及 B 验收记录为准，由 A 汇总时更新其说明。
