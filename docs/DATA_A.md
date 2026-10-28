# A 模块数据、统计与交接说明

本文件说明已实现的 A 数据管道和 Match Overview，适用于 `feature/data-A` 的本地检查。B 的协作超图、D 的竞争超边与总集成尚未接入。A 独立演示页可把真实数据交给仓库已有 C 模块；不能据此宣称完整超图项目已完成。

## 1. 数据来源与可复现性

- 来源：StatsBomb Open Data，当前上游仓库为 [hudl/open-data](https://github.com/hudl/open-data)。
- 固定提交：`4b73468fc5b0f1950f9f66fada70ad3a4f9327cb`。
- 比赛：2022-12-18，FIFA World Cup 2022 Final，Argentina 对 France。
- `match_id="3869685"`，主队 `team_id="779"`，客队 `team_id="771"`。
- 下载范围：一场比赛的 events、lineups，以及该届赛事比赛目录 `matches/43/106.json`；另下载官方许可、README 和两份字段规范。未下载全部赛事事件、360 数据或跟踪数据。

脚本 `load_data.py` 中固定了各文件的远程路径和预期 SHA256。已存在缓存也必须通过校验；损坏文件不会静默继续使用。下载内容在通过 SHA256 后才原子替换目标文件，失败不把半截文件当作有效输入。

这套命令行管道专门重建上述固定比赛，不是任意赛事导入工具。纯函数的缺失字段测试验证处理边界，不代表已经测试其他比赛。

`data/raw/source_manifest.json` 保存每个下载文件的固定 URL、SHA256 和字节数。`preprocess.py`、`calculate_stats.py` 会再次校验三份原始 JSON。后者还比较预处理数据与原始规范化结果，拒绝手工改动后未经重建的数据。

官方解释依据：

- [Open Data Specification v1.1](https://github.com/hudl/open-data/blob/4b73468fc5b0f1950f9f66fada70ad3a4f9327cb/doc/StatsBomb%20Open%20Data%20Specification%20v1.1.pdf)：第 27 页说明 `goal_assist` 只在为真时记录；第 28 页明确成功传球不记录 `outcome`。本地校验副本为 `data/raw/OPEN_DATA_SPEC.pdf`。
- [Open Data Events v4.0.0](https://github.com/hudl/open-data/blob/4b73468fc5b0f1950f9f66fada70ad3a4f9327cb/doc/Open%20Data%20Events%20v4.0.0.pdf)：事件结构、比赛阶段与时钟解释；本地副本为 `data/raw/EVENTS_SPEC.pdf`。
- [官方 README 副本](data_source/StatsBomb-README.md) 与 [官方许可副本](data_source/StatsBomb-LICENSE.pdf)。数据署名和官方标志保留于 A 页面。公开可获取不代表可以任意再分发；原始和逐事件数据仅在本地重建，已由 `.gitignore` 排除。

## 2. 运行方法

Python 3.10+，仅标准库，无 Python 第三方依赖。在项目根目录：

```powershell
python scripts/load_data.py
python scripts/preprocess.py
python scripts/calculate_stats.py
python -m http.server 8000 --bind 127.0.0.1
```

打开 [http://127.0.0.1:8000/demos/data-a/](http://127.0.0.1:8000/demos/data-a/)。三个脚本都按自身位置确定默认项目路径，不依赖调用时的当前目录。

| 脚本 | 参数 | 行为 |
|---|---|---|
| `load_data.py` | `--raw-dir PATH` | 指定原始数据目录；默认 `data/raw` |
| `load_data.py` | `--offline` | 不联网，校验所有已缓存源文件；缺失或不一致即报错 |
| `load_data.py` | `--force` | 重新下载固定提交的文件，仅在校验通过后替换；不能与 `--offline` 同用 |
| `preprocess.py` | `--raw-dir PATH --output-dir PATH` | 从校验过的原始数据输出 `players.json`、`events.json` |
| `calculate_stats.py` | `--raw-dir PATH --output-dir PATH` | 读取该输出目录的 players/events，核对原始数据，再生成 `stats.json` |

已取得数据后的离线重建：

```powershell
python scripts/load_data.py --offline
python scripts/preprocess.py
python scripts/calculate_stats.py
```

用空的 A 输出目录验收，且保留其他成员文件：

```powershell
python scripts/preprocess.py --output-dir output/rebuild-A
python scripts/calculate_stats.py --output-dir output/rebuild-A
```

两个生成脚本只写 A 对应的三个文件，不清空整个目录。网页仍默认读取 `data/processed/`；临时目录用于重建核对，不会自动成为网页数据来源。

## 3. 文件与字段

所有标识符采用源值的字符串形式，不额外加 `p`、`t` 前缀。例如 Messi 是 `"5503"`，Mbappé 是 `"3009"`。标识符不是数组下标。

### `players.json`

数组，每项为一名比赛名单中的真实球员。共 50 名，其中 34 名在事件文件中有记录；其余名单项不因没有事件而删除。名单不等于同时在场阵容。

| 字段 | 类型 | 来源与含义 |
|---|---|---|
| `player_id` | string | 源 lineup 的球员 ID |
| `player_name` | string 或 null | lineup 姓名；缺失时仅尝试源事件中的实际姓名，仍缺失则 null |
| `team_id` | string | lineup 所属球队 ID |
| `team_name` | string 或 null | 源球队名 |
| `position` | string 或 null | 第一条实际记录的 `positions[].position`；不推断场上即时位置；无记录为 null |
| `shirt_number` | number 或 null | 源 `jersey_number`；缺失为 null |

### `events.json`

保留全部 4407 条源事件，按 `(period, event_index)` 排序。保留 29 种源事件类型，包括 `Pass`、`Shot`、`Pressure`、`Duel`、`Interception`、`Ball Receipt*` 等，不创造新的比赛事件。

| 字段 | 类型 | 来源、语义和可空条件 |
|---|---|---|
| `event_id` | string | 源 `id`，可回查原始 JSON；必须唯一 |
| `event_index` | integer | 源 `index`，必须正整数且唯一；保留源顺序 |
| `period` | integer | 1 上半场、2 下半场、3 加时上半场、4 加时下半场、5 点球大战 |
| `minute` | integer | 原始比赛时钟分钟，不把补时累加到下一阶段 |
| `second` | integer | 原始比赛时钟秒，0–59 |
| `time_seconds` | integer | `minute * 60 + second`；不是严格递增的比赛经过时长 |
| `team_id` | string 或 null | 源事件球队；非空值必须能与名单球队对应 |
| `player_id` | string 或 null | 源发起球员；无具体球员的事件可为 null；非空值必须存在于 players |
| `type` | string | 源 `type.name`，保留名称与大小写 |
| `possession_id` | string 或 null | 源 `possession`；是控球序列标识，不等于事件所属球队 |
| `recipient_id` | string 或 null | 仅 Pass 的 `pass.recipient.id`；源字段缺失则 null。失败传球也可能记录意图接球人，不能将其一律认作实际接球 |
| `outcome` | string 或 null | 对应类型详情的结果名称转小写；Pass 无 outcome 字段时按官方规范转为 `complete`；详情缺失/明确 null 不伪装成成功 |
| `location` | `[number, number]` 或 null | 原始事件起点，StatsBomb 120×80 坐标体系；未补全防守者站位 |
| `related_event_ids` | string[] | 源 `related_events`；缺失为空数组，所有非空引用必须能回查 events |
| `xg` | number 或 null | 仅 Shot 的 `shot.statsbomb_xg`；非射门及源字段缺失为 null；有效值须在 0–1 |

解析类型详情时使用实际源键，例如 `Ball Receipt* → ball_receipt`、`Goal Keeper → goalkeeper`、`50/50 → 50_50`。位置或数值格式无效、重复 ID、无效引用会产生带事件 ID 的错误并退出；不悄悄丢弃记录。

### `stats.json`

顶层保持 `{ "match_id": string, "teams": [], "players": {} }`。`players` 以字符串球员 ID 为键，所有 50 名名单球员都有统计项。

| 球员统计字段 | 计算口径 |
|---|---|
| `passes` | 第 1–4 节该球员的 Pass 数 |
| `successful_passes` | 其中 `outcome == "complete"` 的已确认成功数；存在缺失/空结果时为 null |
| `pass_accuracy` | 已确认成功数 / 全部传球数；无传球或存在缺失/空结果时为 null |
| `shots` | 第 1–4 节该球员的 Shot 数 |
| `goals` | 第 1–4 节 Shot 结果为 `goal` 的数量；射门结果缺失或未知时为 null |
| `assists` | 对照原始 Pass 的 `goal_assist == true`，不凭接球关系或邻近射门猜测 |
| `xg` | 源射门 xG 之和，输出保留 6 位小数；缺失规则见下一节 |

`teams` 中两项按主队、客队顺序排列，结构如下；不是以数组位置充当 ID：

```json
{
  "team_id": "779",
  "team_name": "Argentina",
  "side": "home",
  "score": 3,
  "shootout_score": 4,
  "passes": 693,
  "successful_passes": 560,
  "pass_accuracy": 0.8080808080808081,
  "shots": 20,
  "goals": 3,
  "assists": 1,
  "xg": 2.758306
}
```

`score` 直接取比赛目录的主客队终场比分，包含加时、不含点球大战；同时与射门进球及 Own Goal For 事件核对。`shootout_score` 仅统计第 5 节 Shot Goal。其余球队字段与球员统计采用相同口径。

## 4. 统计口径与缺失信息

### 时间范围和点球大战

全部源事件为 4407 条：第 1–4 节 4386 条，第 5 节 21 条。数据文件保留点球大战供追溯；A 概览的事件筛选及普通比赛指标默认仅取第 1–4 节。该范围有 30 次射门、6 个进球；点球大战另有 8 次射门、6 次罚进。

第 1–4 节包含比赛中的点球射门，它们正常进入进球和 xG。只有点球大战的 `period=5` 被排除。阿根廷与法国含加时比分 3:3，点球大战 4:2。

### 传球结果和成功率

1263 次 Pass 中：994 次省略 outcome 字段，按官方规范表示成功；232 次 Incomplete、20 次 Out、7 次 Pass Offside、10 次 Unknown。标准化后分别为 `complete`、`incomplete`、`out`、`pass offside`、`unknown`。

Unknown 表示源数据无法确定结果，不能改写为 complete 或 incomplete。A 定义的成功率为“已确认成功 / 全部传球”，分母包括未知结果；这是当前证据下的保守比例（lower bound），并非已解决所有未知传球后的真实完成率。不能只看源 outcome 缺失就一律判成功：只有存在合法的 Pass 详情对象且确实省略 outcome 字段才适用；缺失整个 pass 对象直接报错。

显式 `outcome: null`、结果名称为空或规范化结果缺失时，成功数与成功率返回 null，页面显示 N/A。它们与源数据明确记录的 `Unknown` 不同。本次复核补齐了 Python 与前端在这些缺失情形下的一致性；固定比赛的三份输出字节保持不变。

### 助攻

助攻由源 `pass.goal_assist == true` 确认。官方规范仅在为真时记录，合法 Pass 对象没有该字段时按 false 处理；不把任意射门前最后一脚传球都记为助攻。本场 Alexis Mac Allister 和 Marcus Thuram 各 1 次。

v1 的 `events.json` 未包含 `goal_assist`，因此 `calculate_stats.py` 同时读取经 SHA 校验的原始数据，而非从标准化事件猜测助攻；未擅自增加共享事件字段。

### xG 与无记录

xG 只汇总确实存在的 `statsbomb_xg`。全局没有可用射门 xG 时，所有 xG 为 null；有源 xG 且球员没有射门时为 0；有射门但任意射门缺 xG 时，该汇总为 null，不以 0 补齐。零次传球的成功率为 null，页面显示 `N/A`。序列化禁用 NaN。

本场全部 38 次射门（含点球大战）均有源 xG；普通指标的球队 xG 为阿根廷 2.758306、法国 2.272618。本场另有 149 次 Pass 缺接球人、55 条事件缺坐标，均保留 null，不推断不存在的球员或坐标。

## 5. 原始时钟异常及使用限制

源时钟按比赛习惯在下半场从 45 分钟、加时上半场从 90 分钟、加时下半场从 105 分钟计时，因此补时会与下一节的数值分钟重叠。`time_seconds` 不能代替源事件序号排序。实际检测到 6 次相邻记录时钟回退：

| 当前 event_index | 类型 / period | 前一记录时钟 → 当前时钟 | 说明 |
|---:|---|---|---|
| 1752 | Half Start / 2 | 52:34 → 45:00 | 跨阶段 |
| 3438 | Ball Receipt* / 2 | 98:35 → 45:00 | 同阶段异常 |
| 3441 | Half Start / 3 | 98:37 → 90:00 | 跨阶段 |
| 3975 | Ball Receipt* / 3 | 106:02 → 90:00 | 同阶段异常 |
| 3978 | Half Start / 4 | 106:04 → 105:00 | 跨阶段 |
| 4387 | Half Start / 5 | 124:07 → 120:00 | 跨阶段，点球大战 |

两条同阶段异常的确切记录为：

- `event_index=3438`，`event_id=5ca1251c-07f6-4c55-b257-5f7fb9c163b2`，第 2 节 Ball Receipt*，源时钟为 45:00。
- `event_index=3975`，`event_id=05b2d26b-0e2d-4af1-bbdf-5d22b425af5b`，第 3 节 Ball Receipt*，源时钟为 90:00。

管道保留源值并按 `(period, event_index)` 排序；没有把接球记录移动到猜测的时间。每次运行会打印 6 条明确警告，`data/raw/preprocessing_diagnostics.json` 保存前后事件 ID、阶段、序号、时间、计数和缺失字段汇总。

分钟筛选仍使用这些原值，因此两条异常接球记录可能出现在不符合真实发生顺序的时间窗。阶段筛选可消除跨节分钟重叠，不能修复同节源时间错误。B/D 提取片段应优先依赖阶段和事件序号，并识别这种异常；不能为得到连续时间而静默改写源事实。

## 6. 前端接入与 C 模块兼容

正式模块导出：

```javascript
import { mountDataExplorer } from "./dataExplorer.js";
const mounted = mountDataExplorer(container, store, dataset);
mounted.updateDataset(nextDataset); // 切换数据集时更新，局部筛选随之重置。
mounted.destroy();                  // 卸载前解除订阅、清理本容器；总页面由 D 挂载。
```

输入遵循共享契约：`dataset.players`、`dataset.events`、`dataset.stats`，总集成还会提供 `collaborationEdges`、`competitionEdges`。`store` 具有 `getState()`、`setState(patch)`、`subscribe(listener)`；ID 用字符串，`timeRange` 用分钟浮点数。

A 读写球队选择、读共享时间范围、通过 `selectedPlayerId` 通知其他模块球员选择。事件类型与比赛阶段是 A 容器内部的局部筛选，未向共享 state 增加未约定字段；C 面板不会跟随这两项筛选。A 页面说明了这一边界。

xG 图拖选只接受同一比赛阶段的两个端点，并同步 A 的局部阶段；跨阶段拖选不改变共享状态或已有筛选。“全场”清除局部阶段并恢复整场分钟。这样避免把上半场 50′ 到下半场 46′ 错解为数值区间 [46,50]。C 仍按共享原始分钟筛选，可能包含补时重叠，不能把 C 的结果称为 A 同阶段统计。

球员列表中的“无关联事件”只表示第1–4节的发起者/传球对象字段没有该球员。实际登场需要名单位置时段或换人记录支持：本场 Disasi（7439）在第4节 120:35 替补上场，原事件 index=4273，但没有自身关联事件。因此 34 是事件覆盖人数，实际有登场时段的球员为 35；三个 JSON 的原字段和统计口径保持不变。

名册条数统计“发起或被列为传球对象”的事件关联次数。失败或 Unknown 传球也可能保留意图接球对象，不能把此数当作成功接球数；界面及报告使用了相同措辞。

`demos/data-a/` 只含用于验收的 store 适配器，不是 D 的正式 `state.js`。它加载真实三份 JSON，并复用已有 C 模块。当前未提供超边字段，表示 B/D 数据尚未接入，不能把它解释成比赛中不存在协作或对抗。

已有 C 的表现及预期：

- 球员、球队、共享时间范围可联动；全场统计可读取 A 的 `stats.players`。
- `events` 无助攻布尔标记，C 时段助攻显示 `N/A`；全场助攻仍为源标记统计值。
- C 对遇到 `unknown` 的时段成功率显示 `N/A`，A 则明示“已确认成功 / 全部传球”。C 的全场对照可以采用 A 提供的保守比例；两者口径不同已在验收页说明。
- `demos/player-c/` 是原有模拟数据演示，与 A 真实赛事页不同，不能把模拟值写入赛事报告。

## 7. 验证、交付范围和 AI 使用

本轮已执行 32 项 Python 测试：在原 19 项基础上补充 9 项缺失字段回归与 4 项独立完整性测试。覆盖正常数据、缺失字段、错误引用、NaN 拒绝、Unknown 结果、门将嵌套键、缺失射门结果、空数据、离线缺失与损坏缓存、全部 50 名球员统计、点球大战排除、6 处时间回退、空目录重建，以及下载校验失败时保护旧文件、拒绝手工篡改的预处理输入。

```powershell
python -m unittest discover -s tests -p "test_data*.py" -v
python tests/audit_data_A.py
node --test tests/dataExplorer.test.mjs tests/playerAnalysis.test.mjs
```

另已执行“全新原始目录联网下载 → SHA 校验 → 全新输出目录重建 → 与默认三份 JSON 字节比较”。本地记录为 `output/data-A-download-check.json`。`output/` 不随源码上传，后续可重新运行核验。

AI 用于编写数据脚本与概览、检查官方规范、补测试、定位字段映射问题、运行自动验收和整理文档。这里的“通过”仅对应实际执行的检查，不表示成员已经人工审阅所有代码或完成三分钟演示。

代码经 `feature/data-A` 分支提交，通过 PR 审核后再合并到 `main`。正式交接应包含源码、运行说明、数据重建方式、验收记录与各人报告材料；团队整体超图、最终报告、展示和课程压缩包仍需后续集成与核验。
