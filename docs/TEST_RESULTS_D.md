# 模块 D 实际验证记录

日期：2026-10-28（Asia/Shanghai）。本记录只包含本轮实际执行的结果，不继承其他文档中的测试成功声明。

## 最终结果

| 检查 | 实际结果 | 范围 |
| --- | --- | --- |
| Python `unittest` | 12/12 通过，退出码 0 | 证据提取、恰好三人、两人/空数据、精确 5 秒边界、控球/阶段、时间异常、非法引用、去重、人数上限、CLI 错误/恢复 |
| D 的 Node 单元/集成测试 | 11/11 通过，退出码 0 | 冻结状态、快照隔离、重入、空竞争边、相交边界、与 C 的时钟/指标一致、1000 次更新、五文件加载、异常数据、模块装配 |
| 现有 C 的 Node 回归测试 | 23/23 通过，退出码 0 | 原有 C 指标/边过滤/缺失值等；未修改 C 文件 |
| D 的真实 Chrome 浏览器测试 | 9/9 通过，退出码 0 | 当前缺失文件页面、模拟装配、空竞争边、时间边界、100 次控件切换、球队、缺少 B、清理及 320/360/768px |
| 正式竞争脚本，使用工作区实际输入路径 | 输出 `[]`，退出码 **2** | 正常报告 A 的 `players.json` 缺失；这不是成功的真实比赛提取 |
| `git diff --check` | 退出码 0 | 已跟踪文件无差异；新增文件没有通过暂存方式纳入此检查，不能将其当作全部新增源码的静态检查 |

最终共 **55 项自动化测试通过**（12 + 11 + 23 + 9）。Python 使用桌面应用提供的运行时；Node.js 为 v24.17.0；浏览器测试使用随桌面运行时提供的 Playwright 和已安装的系统 Google Chrome。生产代码无需这些浏览器测试依赖。

## 实际执行命令

下列为可移植复现方式；本机执行时将 Python/Playwright 指向桌面工具返回的已安装路径：

```powershell
python -m unittest discover -s tests -p test_build_competition.py -v
node --test tests/moduleD.test.mjs tests/playerAnalysis.test.mjs
node --test tests/moduleD.browser.mjs
python scripts/build_competition.py --diagnostics docs/competition-build-audit.json
git diff --check
```

最后的竞争脚本必须单独检查退出码，当前应是 2；不要用后一条命令的成功退出码掩盖它。原始审计输出保存于 `competition-build-audit.json`。

## 测试数据和替身的边界

Python 和 D 的 JS fixture 均为人工合成数据，不含实际赛事观察。浏览器使用真实 D/C 模块；五份 JSON 通过请求拦截提供模拟内容，比赛名始终标注 `MOCK-INTEGRATION-ONLY`。A/B 模块同样由请求替身提供，B 替身只生成一个带文字的 SVG 并响应状态，不实现任何超图几何。

因此已证明 D 正式控件与现有 C 能共享状态、装配只挂载一次、模式切换能选择不同的数据源；**尚未证明 B 的真实 D3 渲染器可正确绘制超边、拖拽缩放或显示点击证据**。也未证明真实决赛字段口径或任何球星比赛结论。

## 运行中发现及修正

首轮 Python 有 1 项测试因系统临时目录写入限制失败，后改为项目 tests 目录内的自动清理临时文件，再运行 12 项全部通过。首轮浏览器因本地地址访问限制未能导航；获得本地测试运行权限后继续执行。随后发现测试 HTTP 服务在读取缺失文件前发送响应头，造成缺失数据测试超时；修正为先读取文件、再发送响应。最终 9 项全部通过。后续调整 D 时间工具与页面布局后，又完整重跑了上述 Python、Node 与浏览器测试，最终数量如表。

这些初始失败没有记为通过；修正的是 D 测试与集成代码，没有改动 A/B/C 文件。

## 截图与尚未运行的验收

- `screenshots/module-d-missing-data.png`：当前仓库的真实缺失数据提示。
- `screenshots/module-d-mock-integration.png`：真实浏览器中的模拟联调；A/B 为替身，C/D 为实际模块。
- `screenshots/module-d-mock-mobile.png`：360px 的模拟联调页面。

上述截图已打开检查版式。仍未运行：真实 2022 决赛数据核验；真实竞争边的事件抽样与 3/5/8 秒敏感性分析；B 正式图的双模式、事件点击、高亮、拖拽缩放；A/B/C/D 的正式全流程；全部 C 浏览器测试的重跑。缺少 A/B 正式交付物是这些验收的原因。
