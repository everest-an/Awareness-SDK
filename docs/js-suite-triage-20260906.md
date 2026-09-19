# JS 全量套件归因报告（2026-09-06）

**结论先行：PR #1 的 22 个提交引入的 JS 回归 = 0。** 全部失败均为上游 sync 继承的存量问题；另有 3 个文件级失败是本机 `node_modules` 陈旧（环境问题），`npm install` 即修复，非代码问题。

## 方法

同机同 node（v22.19.0）双跑对照：

- **基线**：`fork/main` @ `7bf66a9` 的 worktree（`/tmp/sdk-base-triage`，node_modules 由门禁复测时独立安装）
- **本分支**：`integration/broker-parametric` @ F-072 提交
- 各跑全量 `node --test`，提取 `not ok` 测试名做集合差

## 结果

| 轮次 | tests | pass | fail | cancelled |
|---|---|---|---|---|
| 基线（fork/main） | 1277 | 1122 | 65 | 70 |
| 本分支（npm install **前**） | 1282 | 1128 | 67 | 70 |
| 本分支（npm install **后**） | 1583 | 1535 | **33** | 2 |

### 环境修正（非回归）

`npm install` 前 3 个文件整文件失败（`ERR_MODULE_NOT_FOUND: '@noble/hashes'`）：

- `test/anchoring-abi.test.mjs`
- `test/anchoring-golden.test.mjs`
- `test/card-digest-profile.test.mjs`

`@noble/hashes` 与 `@noble/curves` 在 package.json 已声明（^2.2.0），主仓 node_modules 未装。基线 worktree 能过是因为门禁复测时彼处独立执行过 `npm install`。装上后三文件全绿（5+16+6 pass, 0 fail）。

**教训**：package.json/lock 同步后（如 `2a97cbe`）必须 `npm install`，否则模块缺失会伪装成大面积测试失败。

### 逐题对比

修正后分支失败集合 ⊆ 基线失败集合（逐名比对）。唯一在 diff 中"新增"的 `集成测试: 真实项目扫描管道`（`test/f038-integration.test.mjs`）经查在基线同样失败（基线 TAP `not ok 52`），是 TAP 子测试编号差异造成的假阳性。

## 存量失败（上游 sync 债务）

修正后剩 **33 fail**（若干文件加载型失败在依赖修复后已转化为真实执行）。CI 设计（F-070）把它们保持在非阻塞层、不静默跳过——修复责任在上游 sync，本 PR 不扩 scope。完整失败清单可由 `/tmp/js_branch2.tap` 复现（TAP 全量产物）。

## 行动项

- [x] 主仓 `npm install`（已做，anchoring/card-digest 恢复绿色）
- [ ] 上游 sync 时修复 33 个存量失败（非本 PR 范围；CI 持续暴露）
- [x] HANDOFF 补充"package.json 同步后必须 npm install"注意事项
