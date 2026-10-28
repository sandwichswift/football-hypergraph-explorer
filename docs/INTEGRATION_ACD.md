# A/C/D 整合与 C 真实数据验收

日期：2026-10-28，Asia/Shanghai。按用户要求整合远端已交付工作，并完善 C。此记录描述当前整合版；A/D 原有文档中的“未拿到其他模块”属于各自独立开发阶段。

## 交付来源与范围

保留 A 分支 `50a038f` 的数据脚本、概览、文档与测试，以及 D 分支 `acf3ddd` 的对抗建模、正式状态、时间控件与集成入口，使用合并提交保留队友作者与历史。C 丰富版增加成员矩阵、伙伴跳转、可读事件证据、射门地图/清单、同窗球员对比及视觉升级。

截至本轮检查，远端没有 `feature/hypergraph-B`，仓库也没有 `hypergraph.js` 或 `build_collaboration.py`。没有另写一个主超图或填造协作边。B 的球员高亮、缩放/拖拽及组合高亮仍待交付。

整合改动包括 `main.js`、`src/index.html`、页面壳 CSS、A 名单布局的一行修复、C 的时钟表达，以及相应测试/文档。`state.js`、A 的规范化字段与 D 的对抗算法保持原实现，未增加共享 store 字段或必需 JSON 字段。

## 启动与数据文件

在仓库根目录：

```bash
python3 scripts/prepare_data.py
python3 -m http.server 8000 --bind 127.0.0.1
```

打开 `/src/`；Windows 可用 `python`。离线重建使用 `prepare_data.py --offline`，仍逐一检查源文件 SHA256。命令按顺序执行，任何步骤非零退出都会停止，不会把失败当作有效空输出。

A 提供 50 名名单球员、4407 条事件和统计；D 使用默认 5 秒窗口、最多 8 人/24 条事件，成功输出 385 条原始对抗超边。诊断写到忽略的 `output/competition-build-audit.json`，本轮聚合审计副本为 `docs/competition-build-audit-real.json`，不含逐事件记录。不要用 D 早期输入缺失时产生的 `[]` 占位当作真实提取结果；该占位已从版本控制移除，派生超边与 A 的逐事件文件一样本地重建。

StatsBomb 来源固定在 `4b73468fc5b0f1950f9f66fada70ad3a4f9327cb`，赛事 ID `3869685`。数据署名与许可沿用 [A 的说明](DATA_A.md) 和官方材料；只推送源码、方法和分析截图，没有公开提交原始/标准化逐事件 JSON。

## 不完整交付的明确处理

`loadDataset()` 与 `validateDataset()` 默认仍严格要求五份文件。正式启动通过可选的 `allowUnavailableEdges: true` 支持阶段性集成：仅将超边文件的 HTTP 404 保留为 `undefined`，并给出未交付说明。不会把它替换成 `[]`；坏 JSON、无效证据、500 或基础数据缺失仍阻止启动。

仅有对抗数据时默认打开对抗模式。切到协作时，C 显示“关系数据尚未提供”，个人指标继续工作。主图缺失时只影响其区域，A/C/D 正常使用；载入诊断可以展开查看。

整体页面将概览与球星视角放在两个页签中，概览保留足够宽度。A 以浅色主题挂载；从概览选择另一位球员会切回球星视角。视角切换是页面内部状态，没有写入全局 store。A 名单原先的 300px 最小列宽在窄容器溢出，现允许列宽缩到容器宽度，事件表依旧内部横向滚动。

## 真实统计与交互边界

- Messi：60 次传球、49 次明确成功、5 次射门、2 球、xG 1.455280；参与 87 条对抗窗口。
- Mbappé：27 次传球、19 次明确成功、6 次射门、3 球、xG 1.782554；参与 47 条对抗窗口。
- 均不含第 5 节点球大战。全场统计与源事件独立核对，时段助攻缺标记仍为 N/A。
- 含 `unknown` 传球结果的球员，C 的时段成功率为 N/A；A 汇总的保守比例保留为全场对照，并在 C 说明分母含未知结果。
- 事件按源比赛时钟筛选，补时和下一阶段可能重叠；A 的阶段只作用于 A。C 射门按阶段/源顺序排列，并显示阶段，未私改全组时间契约。
- 球场位置来自源 120×80 坐标，不猜测方向或缺失位置。组合展开保留真实事件 ID、发起者、意图接球人、类型与结果；不把失败传球的接球对象当作成功接球。
- 385 条超边是可能重叠的事件窗口，不是 385 次独立对抗。伙伴共同出现不是直接传球数或一对一对抗次数。

## 验证命令

统计、状态与数据管道：

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
python3 tests/audit_data_A.py
node --test tests/dataExplorer.test.mjs tests/playerAnalysis.test.mjs tests/moduleD.test.mjs tests/integration.real.test.mjs
```

浏览器另需开发用 Playwright，网页本身无 npm/CDN 依赖：

```bash
PLAYWRIGHT_MODULE=playwright PLAYWRIGHT_BROWSER_CHANNEL=chrome node --test tests/dataExplorer.browser.mjs tests/playerAnalysis.browser.mjs tests/moduleD.browser.mjs tests/integration.real.browser.mjs
DE_THEME=light PLAYWRIGHT_MODULE=playwright PLAYWRIGHT_BROWSER_CHANNEL=chrome node --test tests/dataExplorer.browser.mjs
```

可将 `PLAYWRIGHT_MODULE` 指向已有 Playwright 的 `index.mjs`。Windows 环境变量写法见 README。真实测试需要先运行数据重建命令；不会在数据缺失时偷偷使用 fixture。

本轮最终执行结果在合并前记录：44 项 Python、67 项 Node、48 项浏览器（A 深色/C/D/真实整合），另 17 项 A 浅色回归。源数据独立审计和离线重建另行执行。截图来自真实浏览器，检查 320/360/768px 的全部 C 视图及 A 概览，没有页面横向溢出。自动检查不能代替成员个人审阅和课堂排练。

## 截图与后续接入

真实截图 `docs/screenshots/player-c-real-{relations,shots,comparison,mobile}.png`；`player-c-demo-*` 和 D 的 mock 截图继续明确作为模拟测试资料。C 报告草稿已写入实际数值和源事件，文字展示提纲已更新，未新增正式 PPT。

B 到位后重新运行准备脚本、严格校验协作边与双模式主图，验收 `selectedPlayerId` 的实际高亮。可选 `playeranalysis:select-edges` 仍是组合请求事件，没有声称 B 已响应。其余课程报告合稿、正式幻灯片和提交包由组内另行汇总。

Codex 辅助完成本轮整合、C 修复、自动化验证、截图检查和文档整理；队友原有实现与作者记录保留。
