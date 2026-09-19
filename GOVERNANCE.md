# Awareness-SDK 工程治理（GOVERNANCE）

本文件是本仓工程协作的**规约层**：定义依赖边界、决策权、合入门禁、默认值与迭代方向的前置证据要求。它与两份配套文件构成三层体系：

```
GOVERNANCE.md（本文件，规范） ──约束──▶ 代码迭代
        ▲ 消费证据                      │ 产生
docs/decisions/（MADR 决策记录，谱系） ◀── python/memory_cloud/tracing.py（运行时证据）
```

规则冲突时：本文件 > docs/decisions/ 单条记录 > CHANGELOG > 代码注释。
修订本文件本身是一次治理决策，须在 docs/decisions/ 新增记录说明 why。

---

## 1. 依赖边界

- **SDK → M1 单向**。本仓（Awareness-SDK）只调用 M1（github.com/everest-an/M1）的记忆能力；M1 不得反向依赖本仓。
- 调用**只经 `mt_lnn.memory_broker` 包**（git 安装）。禁止 import M1 源码模块（如 `mt_lnn.parametric_memory`）——那是 M1 的内部实现面，不是它的契约面。
- 包未安装时一切参数化功能**优雅降级**（try/except import + 降级路径），禁止硬依赖导致的 import 错误冒泡到用户。
- 违规处理：发现反向 import 或绕过 broker 直连源码的 PR，直接 revert，不需讨论。

## 2. 决策权划分

| 域 | 归属 | 内容 |
|---|---|---|
| 记忆引擎 | **M1** | ParametricMemory / GraphKnowledgeMemory、固化策略（consolidation_policy）、评测（MemoryAgentBench 等） |
| 召回链路 | **本仓** | E5+FTS5 级联（unifiedCascadeSearch）、集成槽位（五框架适配器）、产品面（daemon/MCP） |
| 自动化迭代轮（cron / agent 会话） | **只有起草权**（ADR-002） | 可：写代码、测试、起草 ADR（Proposed）、维护台账、跑基准出证据。不可：修订治理文本与门禁阈值、翻转默认值、改变 PR 状态（Draft/Ready/merge）、在登记簿新增"已通过"结论。违反即回滚（2026-09-07 F-071 事故先例）。治理修订与 PR 状态转移由**人类**显式拍板；人类授权的批量执行须在 ADR 采纳记录中注明授权来源与日期。 |

**冲突判定权在本仓，参数层只执行。** 当本仓检测（card-evolution 的 supersession 判定）认定一条知识被取代时，参数层执行 forget(旧)+write(新)；判定逻辑本身不迁移到 M1。理由（F-066）：M1 的 delta 规则冲突消解已判负，判定不是参数层的强项。**不得以"优化"名义把判定上移。**

## 3. 门禁清单

以下为硬门禁，PR 缺一不合入：

1. **动了 `unifiedCascadeSearch`** → LongMemEval 非回归验证**双条件**（F-071）：
   - (a) R@5 不低于关闭态**同环境**实测基线（排除跨环境漂移误判）；
   - (b) PR 引入零回归证据（首选 500 题 A/B 逐题 bit-identical miss set，或同等级证据）。
   两条件都须满足。证据与产物见 `benchmarks/longmemeval/FIRST_HOP_NONREGRESSION.md`。未跑 = `non-regression pending`，禁 merge。
2. **新增参数化能力** → 默认关 + 关闭态与现状**逐位一致**（回归测试锁死）。
3. **一切文档** → 禁止未实测的提升主张。数字只能来自脚本产物，能被一键复算（见 §7 主张登记簿）。
4. **迁移/打包** → 沿用 `export_reader.py` 既有 zip+JSONL 约定，不新造格式。
5. **全量测试绿**：Python（pytest）与 local（node --test）既有套件无回归。

## 4. 默认值治理

三个参数化开关的默认态与翻转条件：

| 开关 | 默认 | 翻转前置条件（三者齐备） |
|---|---|---|
| `parametricFirstHop`（召回首跳） | 关 | ① M1 memory_broker 合并 ② 真实联调通过 ③ LongMemEval 门禁通过 |
| `consolidation_write`（记录后写参数层） | 关 | 同上 + M1 consolidation_policy 合并 |
| `conflict_forget`（冲突取代执行） | 关 | 同上 |

翻转默认值本身是**一次治理决策**：须在 docs/decisions/ 立新记录，引用机制 trace 证据（命中率、降级频率、延迟），不接受无证据翻转。

## 5. 迭代方向治理

- 方向变更（移除首跳 stage、翻转默认值、改事件词表、改打包格式）**必须引用机制 trace 证据**作为依据。
- 无证据的方向调整一律拒绝；"我觉得应该"不是依据。
- JS 侧（local daemon）trace 的立项触发条件：JS↔Python broker 桥接方案合并时，JS trace 作为同一 PR 的配套项（见 F-069 后果节）。
- 与 M1 的对齐事项（broker 接口、事件词表、session 语义）在 memory_broker 合并**之前**提出，合并后修改的成本视为翻倍。

## 6. 与 trace / 决策记录的接口

- **机制 trace**（`python/memory_cloud/tracing.py`）：产出本仓运行时证据。信封沿用 M1 `JsonlMetricWriter` 形状（`{ts, event, session_id, channel, ...fields}`），扩展字段命名参照 OTel GenAI semconv（`gen_ai.*`）。默认关、hash-only、never-throw。
- **决策记录**（`docs/decisions/`）：MADR-lite 格式（状态/日期/背景/决策/后果），一决策一文件。命名空间自 ADR-001 起用 `ADR-<NNN>-<slug>.md`；F-061~F-075 为冻结遗留块（与上游 feature-flag 编号冲突，见 ADR-001）。索引见 `docs/decisions/README.md`。
- 治理消费的最低证据集：`recall`（route/hit/latency）、`broker_unavailable`（降级频率）、`transport_error`（HTTP 失败路径，F-072）。前两个事件缺失时，§5 的方向治理无从执行；`transport_error` 缺失时错误路径盲区不闭合（错误路径优先于成功路径埋点，F-072）。

## 7. 主张登记簿（Claims Register）

**本表是对外数字主张的唯一合法来源。** 任何 README、文档、PR 描述中出现的数字主张，若不在本表（或其指向的产物文件）中，即违规。格式沿用 M1 RESULTS.md 纪律：每条主张绑定复现命令与产物。

机读映射见根目录 [CLAIMS.md](CLAIMS.md)（F-073）：每行以 claim-id（C-xxx）双登记，`scripts/check_claims.py` 强制 §7↔CLAIMS 数字集合一致并检测撤回复活。**新主张双登记，缺一 exit 1。**

| 主张 | 状态 | 复现命令 | 产物/依据 |
|---|---|---|---|
| LongMemEval R@5 同环境基线（关闭首跳）（CLAIMS: C-001） | 本环境复测 95.8（479/500），2026-09-06；fork/main 同环境同值，0.2pp 为环境漂移（transformers.js 版本差） | `node run_f053_daemon_path.mjs`（benchmarks/longmemeval/，500Q，数据集见该文件头） | `benchmarks/longmemeval/FIRST_HOP_NONREGRESSION.md` + `results_f053_daemon_path_n500_base-forkmain.json` |
| Published 基线 96.0（480/500）为 Awareness-Market 标准环境（2026-08）目标（CLAIMS: C-002） | 参考目标，follow-up（跨环境数字不作绝对门禁，F-071） | 须在 Awareness-Market 标准环境复测 | `benchmarks/longmemeval/FIRST_HOP_NONREGRESSION.md` |
| 首跳开启后 R@5 ≥ 同环境基线 **AND** PR 零回归（CLAIMS: C-003） | **已通过（F-071 双条件）**：本环境 95.8 与同环境 fork/main 500 题逐题 bit-identical miss set；PR #1 维持 Ready for review | 分支与对照组命令见 FIRST_HOP_NONREGRESSION.md "How to reproduce" | `benchmarks/longmemeval/results_f053_daemon_path_n500_b999000000.json`（分支）+ `results_f053_daemon_path_n500_base-forkmain.json`（对照组） |
| 参数化层 O(1) 热区读取、精确绑定（CLAIMS: C-004） | 设计主张（非本仓实测） | — | M1 `docs/PARAMETRIC_MEMORY.md`；本仓未独立复测，引用时须注明出处 |
| 会话迁移 bit-exact（CLAIMS: C-005） | 单测级验证（mock broker） | `pytest tests/test_session_migrate.py` | 测试文件；真实 broker 联调后升级 |

禁止行为：在登记簿外新增提升数字；把"pending"写成"通过"；引用 M1 数字时省略出处。

---

*本文件由治理决策 F-069 设立。修订须同步更新决策记录。*
