# B 本轮实际验收记录

分支 `feature/hypergraph-B`，基线 `3aef603`。仅记录本轮实际执行；不把历史文档的通过数当成本轮结果。个人代码审核和课堂计时排练尚未由成员确认。

## 依赖基线与最终结果

| 检查 | 实际结果 | 证据范围 |
|---|---:|---|
| 开发前 A/D 真实数据重建 | 成功 | 50 名名单球员、4407 条事件、统计、385 条对抗超边；固定来源 SHA256 校验 |
| 开发前既有 Python / Node 基线 | 44 / 63 通过 | A/C/D 数据、状态、统计与接口 |
| B 算法与 CLI | 14/14 通过 | 恰好三人、空/两人、窗口上限、失败/未知传球、非法对象、阶段/控球/时钟、原子输出与 CLI 错误 |
| 最终全组 Python | 58/58 通过 | 既有 44 + B 14 |
| 最终全组 Node | 75/75 通过 | A 20、C 30、D 13、既有真实集成 4、B 8 |
| 最终浏览器，默认主题 | 59/59 通过 | A 17、C 15、D 9、既有真实集成 7、B 11 |
| A 浅色主题额外回归 | 17/17 通过 | 同一组 A 用例在浅色主题重复执行 |
| A 独立原始数据审计 | 通过 | 全部 4407 条源事件、50 人统计、来源时间和结果 |
| B 独立原始事件审计 | 通过 | 全部 531 条边的完整成员、原始成功结果、连续性、控球/阶段/球队、所有中间事件、时间及权重 |
| 最终离线全流水线 | 成功 | 重新生成五份 JSON，仍为协作 531 / 对抗 385，再次通过 B 审计 |
| 三页 PPTX | 结构及边界检查通过 | 三页、原生可编辑文本/示意图/图表、每页讲稿、真实截图 |

浏览器执行合计 **76 次**，浅色重复执行不称为新增独立用例。B 自有测试为 **14 Python + 8 Node + 11 浏览器**；源数据审计另计，不把逐条审计次数虚报成测试用例。

环境：Python 3.11.4、Node.js v24.16.0、Playwright 1.56.1、Chromium Headless Shell 141.0.7390.37。浏览器及缺少的运行库、中文字体仅准备于临时目录；无生产环境依赖。常规电脑按 README/B 交接说明安装 Playwright 或使用已有 Chrome/Edge 即可。

## 满足最小交接要求的用例

| 类型 | 输入/操作 | 实际检查 |
|---|---|---|
| 正常 1 | A 真实决赛事件、默认 4 次传球/20 秒/5 人 | 531 条原始协作边：Argentina 302、France 229；每条至少三人且可追溯 |
| 正常 2 | 选择 Messi → 切对抗 → 点击组合 | 协作参与 81 / 对抗参与 87；沿用同一个 SVG，完整成员及源事件可展开；C 面板和主图双向选择 |
| 边界 | 空数组、两人链、200–210 分钟空区间 | 合法空协作数组，网页明确空状态，不生成两两替代图 |
| 边界 | 超边开始或结束的精确时间点 | 相交规则含端点，B/C/D 原始边集合一致 |
| 连续操作 | 100 次模式/球员更新 | 始终一个 B 组件、一个 SVG，最终计数正确 |
| 可用性 | 鼠标拖拽/平移、按钮缩放、键盘选择和移动 | 几何/变换实际改变，点击选择同步 C |
| 生命周期 | 数据替换、销毁、重新挂载 | 退订和监听清理，B 不影响 C 容器 |
| 窄屏 | 320/360/768px | 无页面整体横向溢出，完整组合与证据可读 |

## 真实结果与截图

协作超边为三人 262、四人 187、五人 82，共 331 个不同完整组合；Messi 81、Mbappé 32 个协作片段。默认 Top 12/24 仅控制图形复杂度，不改变原始计数。审计摘要见 [hypergraph-build-audit-real.json](hypergraph-build-audit-real.json)。

- [协作模式与来源事件](screenshots/hypergraph-b-collaboration.png)
- [对抗模式复用同一渲染器](screenshots/hypergraph-b-competition.png)
- [Messi 主图截图，用于 PPT](screenshots/hypergraph-b-main.png)
- [360px 手机视图](screenshots/hypergraph-b-mobile.png)

四张均由本轮真实浏览器产生并打开目视检查；中文字体已补齐，无模拟比赛数值。其他成员原有截图在回归后恢复，只交付 B 的新截图。

## 复现命令与日志

```bash
python3 scripts/prepare_data.py
python3 -m unittest discover -s tests -p 'test_*.py' -v
python3 tests/audit_data_A.py
python3 tests/audit_hypergraph_B.py
node --test tests/dataExplorer.test.mjs tests/playerAnalysis.test.mjs tests/moduleD.test.mjs tests/integration.real.test.mjs tests/hypergraph.test.mjs
node --test --test-concurrency=1 tests/dataExplorer.browser.mjs tests/playerAnalysis.browser.mjs tests/moduleD.browser.mjs tests/integration.real.browser.mjs tests/hypergraph.browser.mjs
```

浏览器安装/选择方式见 [HYPERGRAPH_B.md](HYPERGRAPH_B.md)。A 浅色主题另外设置 `DE_THEME=light` 后运行 `tests/dataExplorer.browser.mjs`；Windows PowerShell 使用 `$env:DE_THEME='light'`，运行后 `Remove-Item Env:DE_THEME`。本地完整日志保留在忽略的 `output/B/`，派生数据与日志不随源码发布；可重复执行上述命令。

## 调试过程与验收边界

首轮单元检查发现封闭曲线需显式关闭路径，已补 `Z` 并复验。另一个失败来自滑窗测试将最后一名球员误设为对手，修正合成 fixture 后通过。首次浏览器启动缺少四个动态库，随后在临时目录解压依赖；首次交互批次为 10/11，拖拽测试未将目标节点滚入视口，定位后真实鼠标与键盘检查通过。最初截图缺少中文字体，补齐后已全部重拍。以上失败均不计为通过，表格记录最终执行。

既有 A/C/D 浏览器测试的缺 B 场景改为显式拦截 B 两个文件的 404，以继续验证“未提供”和“真实零条”的区别；该场景并不代替 B 正式图形验收。共享生产代码及数据/状态契约未改动。

PPT 已重新读取并检查包结构、三页备注、原生图表与形状边界；未在用户的 PowerPoint/WPS 原生应用中打开，仍需成员本人检查字体并最多三分钟试讲。最终整组报告和课程 ZIP 由 A/D 汇总，本轮不冒称已向教师提交或已完成人工审核。

Codex 辅助完成 B 的依赖确认、实现、自动化验证、源事件审计、截图检查与材料起草。最终应如实记录成员本人审核日期与姓名。
