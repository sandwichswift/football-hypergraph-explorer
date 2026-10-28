# A 模块本地验收记录

最新验收：2026-10-28，项目目录 `D:\学校作业\Football-Hypergraph`。
本地验收时分支为 `feature/data-A`，基线 HEAD 为 `6ec2ff79e94e5751eb45f69c7c7cd06ad9044eaf`；下文记录的是提交前的验收快照。

本轮四项问题、PPT 旧截图和待提交消息中的会话链接均已处理。应用测试共 109 次执行通过，提交脚本另有 16 个独立本地 Git 集成场景通过。生成这份本地验收快照时，主项目尚未暂存、提交或推送。后续发布状态以 GitHub 分支及 PR 为准；本地测试不能代替其他组员的 PR 审核。此记录只验收 A 独立交付及现有 C 的联动；整组报告、B/D 总装和成员本人的试讲不属于已通过范围。

## 1. 本轮六项处理

| 项目 | 修复后的行为 | 核验方式 |
|---|---|---|
| xG 拖选丢失比赛阶段 | 同一阶段内拖选同时设置 A 的阶段及共享分钟；反向拖选也正确。跨阶段拖选双向拒绝并提示，原筛选保持不变；“全场”清除 A 的阶段 | 纯逻辑用例、Edge 鼠标拖动；重点验证上半场补时与下半场 45–50 分钟重叠 |
| 无事件球员误称未登场 | 改为“无关联事件”，明确它只描述事件覆盖；Disasi 可展开选择 | 原始替补事件 index 4273、period 4、120:35；阵容 positions 显示 35 人登场，34 人具有 actor/recipient 记录 |
| 提交脚本不能中断恢复 | 支持已完成 0–4 步；完整核对消息、文件集合、blob 和 mode；允许本步骤合法的部分暂存，其他内容拒绝继续 | Windows PowerShell 5.1，16 个独立 Git 场景，实际在第 1/2/3 步之后中断并恢复；篡改、错误暂存、完成后再运行、CRLF 和二进制覆盖 |
| 小 xG 射门圆面积失真 | 可见圆半径采用 `sqrt(xG) × 3.6`，无半径下限及描边；透明交互圆只用于命中，支持键盘；0 和缺失值不绘制正面积圆 | 30 次真实射门逐个比较面积比例；0/null 边界、鼠标和键盘交互；实色进球、浅色未进图例 |
| PPT 第三页旧截图 | 换为本轮 Edge 生成的新版深色界面局部，更新 AI 披露与问答备注 | 截图哈希、嵌入图像、三页回读渲染、原生表格/图表/工作簿验证 |
| 提交信息含私人会话链接 | 四份 `output/git/msg-*.txt` 删除会话链接，保留实际贡献者说明 | 扫描四份待提交消息；主仓库没有相关新提交，因此无需改写已有历史 |

阶段与事件类型仍只作用于 A。现有 store 的 `timeRange` 只有原始分钟，C 不会接收 A 的 period，不能宣称跨模块精确阶段联动；该限制已在界面与文档注明。未修改共享 15 字段事件契约。

## 2. 实际执行结果

| 检查 | 当前结果 | 本地证据 |
|---|---|---|
| Python 数据与边界测试 | 32 / 32 | `output/fix-A/data/independent-data-acceptance.json` |
| A 前端模型 | 20 / 20 | `output/fix-A/model-tests.txt` |
| 原有 C 模型回归 | 23 / 23 | 同上，C 文件未改 |
| Windows Edge 深色浏览器测试 | 17 / 17，页面异常与 console error 为 0 | `output/fix-A/browser-dark.txt` |
| Windows Edge 浅色浏览器测试 | 17 / 17，页面异常与 console error 为 0 | `output/fix-A/browser-light.txt` |
| 独立原始数据核对 | 全部 4407 事件、50 名球员及两队统计一致 | `output/fix-A/data/independent-data-acceptance.json` |
| 来源与全新目录重建 | 七份固定源 SHA256 匹配，只复制数据脚本、从空产物目录重建；三份 JSON 与原输出逐字节一致 | 同上及关联日志 |
| 提交辅助脚本 | 16 / 16；独立测试仓使用本地 bare origin，零推送尝试、remote refs 为空 | `output/fix-A/commit-script-regressions.json` |
| PPTX | 3 页；结构、几何、字体、1 个原生表格、2 个原生图表及工作簿引用检查通过，错误/警告 0 | `output/fix-A/slides/validation-2026-10-28T04-31-46-963Z.json` |

109 是应用测试执行次数，同一组 17 个浏览器用例分别在深、浅主题执行；不把 4407 条数据逐条核对虚报为额外测试数。提交脚本 16 个场景另计。2026-10-27 的 74 / 94 是历史版本结果，不能代替本轮结果。

运行环境：Windows、Python 3.12.3、Node.js 24、Playwright + 系统 Microsoft Edge；提交脚本另在 Windows PowerShell 5.1 实际执行。生产 Python 只依赖标准库，生产网页无需 CDN 或 npm 构建。

## 3. 页面与交互复核

默认全场第 1–4 节共有 4386 条事件、1263 次传球、30 次射门；比分 3:3，点球大战 4:2 单列。阿根廷 Shot 为 20 条，法国为 10 条。球员选择同步现有 C，事件依据可回查原始 ID、序号和坐标。

浏览器测试还覆盖空数据与缺失字段、200–210 分钟空窗口、筛选清理、销毁重挂载、100 次状态切换、320/390px 宽度及列表内部滚动。六张最终截图已重新生成，桌面完整图与筛选图、移动图均按深浅主题分别检查；球员列表和宽事件表在内部视口滚动。390px 的加时阶段标签较紧邻，仍可辨认。

![新版深色比赛概览](screenshots/data-a-desktop.png)

[浅色桌面](screenshots/data-a-light-desktop.png) · [深色筛选](screenshots/data-a-filtered.png) · [浅色筛选](screenshots/data-a-light-filtered.png) · [深色移动端](screenshots/data-a-mobile.png) · [浅色移动端](screenshots/data-a-light-mobile.png)

## 4. PPT 与数据封存

终版 [三页 PPTX](slides/part_A.pptx) 为 505027 字节，SHA256：
`45bdd4fb904a8fe756d99053705abc1b131c633c43e18bb343b913e1a2eae757`。

第三页使用 `docs/screenshots/data-a-desktop.png`，截图 SHA256：
`31336ef330a8ea44f3ad36a88a61cba22b7de5bc6bda0fca3f8aadd1bc018aa4`。
保留原有两份图表 XML、关系与工作簿，共六个包部件逐字节不变，未重建数据快照。最终文件回读渲染三页已逐页检查。已在本机 WPS 演示原生打开三页，默认字体缺失提示消除；独立测试副本中打开嵌入工作簿，将确认成功值 994 临时改为 995、缩放图表，保存关闭后重新打开，数据标签和尺寸仍保留。该测试只修改 output 内副本；正式 PPT 仍为 994/259/10 和 20/10。Microsoft PowerPoint 本轮启动后仅显示空工作区，未完成该应用的文档打开验证；WPS 结果不冒称 PowerPoint 实测。45/60/65 秒仅为建议讲稿时长，成员本人尚未计时排练。

三份数据的 SHA256 未变化：

| 文件 | SHA256 |
|---|---|
| players.json | `7fc672fbca721c8412a61a6fd50613ebaf48e0f632b2ca06c1805a9801962ef7` |
| events.json | `bcf6278618b0bf3b5979893366102b8aea6e3f5d263a11e1a7f6a246fe879cc4` |
| stats.json | `7adcbd7c205b43233e4beede0c47295aea75d357a595dde20bac0cb4beab4aae` |

## 5. 保留的数据边界与后续职责

- 10 次传球结果 Unknown 保留未知；A 成功率使用已确认成功数占全部传球数。源时钟 6 次回退保留，其中 4 次跨阶段、2 次同阶段异常；详见 [数据说明](DATA_A.md)。
- 120 次非成功或 Unknown 传球仍有 recipient，因此称“传球对象”，不声称成功接球。
- C 的局部时间助攻 N/A、未知结果时间窗口成功率 N/A 仍按已有契约处理。C 生产代码、原 C 测试、演示和报告未改。
- B 的真实超图、D 正式 store/页面、整组 report.pdf 和课程包待后续汇总；[任务清单](TASK_CHECKLIST_A.md) 与 [汇总依赖表](report/ASSEMBLY_A.md) 保留这些待办。
- 原始和派生事件数据受 Git 忽略，源码交接使用固定来源下载与重建；遵循源许可。原始数据、派生 JSON 与详细运行日志保留本地；源码、汇总验收记录及 A 展示材料纳入功能分支交付。

## 6. 复现命令

在项目根目录执行：

```powershell
python scripts/load_data.py --offline
python scripts/preprocess.py
python scripts/calculate_stats.py
python -m unittest discover -s tests -p "test_data*.py" -v
python tests/audit_data_A.py
node --test tests/dataExplorer.test.mjs tests/playerAnalysis.test.mjs
```

首次没有缓存时，下载命令去掉 `--offline`。浏览器测试需按 README 安装 Playwright：

```powershell
$env:PLAYWRIGHT_MODULE='playwright'
$env:PLAYWRIGHT_BROWSER_CHANNEL='msedge'
$env:DE_THEME='dark'
node --test tests/dataExplorer.browser.mjs
$env:DE_THEME='light'
node --test tests/dataExplorer.browser.mjs
Remove-Item Env:DE_THEME
```

测试服务只绑定 `127.0.0.1` 并自动关闭。手动查看可另运行 `python -m http.server 8000 --bind 127.0.0.1`，打开 <http://127.0.0.1:8000/demos/data-a/>。

提交计划的只读预检命令为 `powershell -NoProfile -ExecutionPolicy Bypass -File output/git/commit-A.ps1 -CheckOnly`。它不暂存、提交、推送或修改 Git 配置；作者身份尚未配置时只提示，实际提交模式必须已有身份配置。
