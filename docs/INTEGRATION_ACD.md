# A/B/C/D 整合与 C 真实数据验收

日期：2026-10-29，Asia/Shanghai。此记录描述 B 到位后的最终整合版；A/D 原有文档中的“未拿到其他模块”属于各自独立开发阶段。

## 交付来源与范围

保留 A 分支 `50a038f` 的数据脚本、概览、文档与测试，以及 D 分支 `acf3ddd` 的对抗建模、正式状态、时间控件与集成入口，使用合并提交保留队友作者与历史。C 丰富版增加成员矩阵、伙伴跳转、可读事件证据、射门地图/清单、同窗球员对比及视觉升级。B 分支 `614aa83` 提供成功传球链协作建模、D3 主视图、双模式切换、缩放拖拽和事件证据。

最终整合分支将上述模块接入同一份 `dataset` 与 `state.js`。C 选择球员时，B 高亮当前球员参与的可见超边；C 点击完整组合时通过 `playeranalysis:select-edges` 请求 B 精确高亮该组合；B 点击节点时通过共享 `selectedPlayerId` 回写 C。

整合改动包括 `main.js`、`src/index.html`、页面壳 CSS、A 名单布局的一行修复、C 的时钟表达，以及相应测试/文档。`state.js`、A 的规范化字段与 D 的对抗算法保持原实现，未增加共享 store 字段或必需 JSON 字段。

## 启动与数据文件

在仓库根目录：

```bash
python3 scripts/prepare_data.py
python3 -m http.server 8000 --bind 127.0.0.1
```

打开 `/src/`；Windows 可用 `python`。离线重建使用 `prepare_data.py --offline`，仍逐一检查源文件 SHA256。命令按顺序执行，任何步骤非零退出都会停止，不会把失败当作有效空输出。

A 提供 50 名名单球员、4407 条事件和统计；B 使用最多 4 次成功传球、20 秒窗口、最多 5 名球员，输出 531 条协作超边；D 使用默认 5 秒窗口、最多 8 人/24 条事件，输出 385 条原始对抗超边。B/D 的诊断与派生数据仍在本地重建，不提交逐事件 JSON。

StatsBomb 来源固定在 `4b73468fc5b0f1950f9f66fada70ad3a4f9327cb`，赛事 ID `3869685`。数据署名与许可沿用 [A 的说明](DATA_A.md) 和官方材料；只推送源码、方法和分析截图，没有公开提交原始/标准化逐事件 JSON。

## 缺失数据的明确处理

`loadDataset()` 与 `validateDataset()` 默认仍严格要求五份文件。正式启动通过可选的 `allowUnavailableEdges: true` 支持阶段性集成：仅将超边文件的 HTTP 404 保留为 `undefined`，并给出未交付说明。不会把它替换成 `[]`；坏 JSON、无效证据、500 或基础数据缺失仍阻止启动。

完整数据时默认打开协作模式。若部署环境只有一类关系文件，页面会保留“未提供”和“有效空结果”的区别，C 的个人指标仍能独立工作，主图区域也会给出局部错误说明。

整体页面将概览与球星视角放在两个页签中，概览保留足够宽度。A 以浅色主题挂载；从概览选择另一位球员会切回球星视角。视角切换是页面内部状态，没有写入全局 store。A 名单原先的 300px 最小列宽在窄容器溢出，现允许列宽缩到容器宽度，事件表依旧内部横向滚动。

## 真实统计与交互边界

- Messi：60 次传球、49 次明确成功、5 次射门、2 球、xG 1.455280；参与 87 条对抗窗口。
- Mbappé：27 次传球、19 次明确成功、6 次射门、3 球、xG 1.782554；参与 47 条对抗窗口。
- 均不含第 5 节点球大战。全场统计与源事件独立核对，时段助攻缺标记仍为 N/A。
- 含 `unknown` 传球结果的球员，C 的时段成功率为 N/A；A 汇总的保守比例保留为全场对照，并在 C 说明分母含未知结果。
- 事件按源比赛时钟筛选，补时和下一阶段可能重叠；A 的阶段只作用于 A。C 射门按阶段/源顺序排列，并显示阶段，未私改全组时间契约。
- 球场位置来自源 120×80 坐标，不猜测方向或缺失位置。组合展开保留真实事件 ID、发起者、意图接球人、类型与结果；不把失败传球的接球对象当作成功接球。
- 531 条协作超边来自可追溯的成功传球链；重叠链不是 531 次独立进攻。
- 385 条对抗超边是可能重叠的事件窗口，不是 385 次独立对抗。伙伴共同出现不是直接传球数或一对一对抗次数。

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

本轮最终执行结果：58 项 Python、75 项 Node、59 项浏览器，另完成 A 数据审计、B 协作审计和离线重建。浏览器回归覆盖 A/B/C/D 同页挂载、C→B 组合高亮、B→C 球员选择、D 模式/球队/时间筛选、事件证据、生命周期与 320/360/768px 布局，没有页面横向溢出。自动检查不能代替成员个人审阅和课堂排练。

## 截图与后续接入

真实截图 `docs/screenshots/player-c-real-{relations,shots,comparison,mobile}.png` 与 `docs/screenshots/hypergraph-b-{main,collaboration,competition,mobile}.png`；`player-c-demo-*` 和 D 的 mock 截图继续明确作为模拟测试资料。C 报告草稿已写入实际数值和源事件，B/C 展示材料已放入 `docs/slides/`。

最终页面已通过真实数据验收。其余课程报告合稿、正式幻灯片和提交包由组内另行汇总；提交前仍需成员本人审阅数值、截图和课堂讲述。

Codex 辅助完成本轮整合、C 修复、自动化验证、截图检查和文档整理；队友原有实现与作者记录保留。
