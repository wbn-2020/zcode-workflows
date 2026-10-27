---
name: task-run
description: Use when executing a v2 plan contract produced by task-plan. Execution mode comes only from the contract; standard defaults to non-shell argv acceptance, while shell acceptance requires explicit allowShell=true and is high risk. Enforces reviewedPlanSnapshot/reviewedReviewHash, HEAD/stash/plan integrity, task-scope snapshots, confirmationToken binding, and standard-only one-round retry. Not for planning or v1 plans.
---

# 按计划执行（task-run）

执行 `task-plan` 生成的 v2 执行合同。执行模式只由合同 `mode` 决定；`task-run` 没有 `strict` 参数。不重新规划，不用模型解释 Markdown。

- **standard**：默认 argv 验收；只允许执行前任务外脏；运行期完整性不放宽。
- **strict**：argv 验收；执行前除 `plan.md` 外全部干净；失败立即停。

shell 验收只有计划与执行两端都显式 `allowShell=true` 才可用，且始终是高风险，不是默认行为。

## 何时使用

- 用户已有 `task-plan` 生成的 v2 `plan.md`，准备执行；
- 需要按依赖分批、逐批验收、检查文件范围和 Git 完整性；
- 需要标准模式的一轮自动修复，或 strict 的 fail-fast。

不要用于：v1 合同、没有合同的手写 `plan.md`、未计划的需求、生产部署。

## 输入

- `planPath`（必填）：v2 `plan.md` 的 workspace 相对路径，必须是规范化 `.md`。
- `allowShell`（可选，默认 false）：显式允许计划中的 shell 验收（高风险）；计划含 shell 任务时必须为 true。
- `confirmationToken`（可选）：首次运行返回的确认 token；计划/评审/决议/allowShell/reasons 变化后失效。
- `stopOnFailure`（可选，默认 true）：standard 失败后是否停止；false 只继续无依赖关系的任务。strict 合同始终 fail-fast。
- `language`（可选）：默认中文。

## 执行前校验

在调用任何修复员前，确定性校验：

- 合同标记唯一、JSON 可解析、`contractVersion === 2`；v1 明确拒绝并提示重新运行 task-plan。
- `mode` 为 standard/strict；`plan.mode` 与合同一致；`allowShell` 合法（strict 必须 false）。
- `approvalRequired` 与 `mode`/review 一致；standard 为 false。
- `reviewedPlanSnapshot === stableJson(plan)`；不一致硬拒绝。
- `reviewedReviewHash === sha256(stableJson(review))`；不一致硬拒绝，提示“review 已被修改”。
- review 结构/语义校验：字段精确、severity/taskId 合法、summary 非空。
- `review.verdict === "reject"`：硬错误，confirmationToken 不能覆盖。
- review 为 `approve` 但仍有 high/missing/scope/acceptance：硬错误（评审不一致）。
- 未解决 blocking 问题影响任何 ready 任务：硬错误，token 不能覆盖；只影响 needs-info 时允许其他任务运行。
- 依赖存在、无环；ready 不依赖非 ready；文件路径安全且不覆盖 `plan.md`。
- 验收唯一权威字段：argv 只读 `acceptanceCommand`，shell 只读 `acceptance`，非 ready 两者都为 null。
- 计划含 shell 任务时，执行参数 `allowShell` 必须 true；strict 不允许 shell。
- Git 可用；HEAD、stash 可读。

任何硬错误都在源码修改前拒绝整份计划，不生成 token。

## 工作树与运行期完整性

**standard（只放宽执行前工作树）**

- 每个 ready 任务的 `files` 范围内不得有 staged/unstaged/untracked 改动；有则拒绝并列出文件。
- `plan.md` 不算任务文件：允许 staged/unstaged/untracked。
- 任务外脏文件允许，并进入基线。
- 运行期仍然检查：HEAD、stash、plan.md 内容、`reviewedPlanSnapshot`、范围外改动。任何一项无法验证或发生变化，当前任务失败关闭。

**strict**

- 除 `plan.md` 外工作树干净；staged 排除 `plan.md` 后必须为空。
- HEAD/stash 可读；同样的全量内容快照、HEAD/stash/plan 完整性检查。

两种模式都不自动回滚；范围检查覆盖当前 workspace 工作树和任务范围并集内的 ignored 文件。无法读取快照时不得把“无法验证”描述为通过。

## 验收

- **默认 argv**：按合同中的 `{ program, args }` 直接启动，不经 shell。只允许受限的测试/构建程序和参数；路径参数必须在 workspace 内。
- **shell（高风险）**：仅 standard + 合同 `allowShell=true` + 执行参数 `allowShell=true`。使用黑名单和 30 分钟超时；这是显式高风险同意，不是操作系统沙箱。仓库测试/build 脚本仍以当前用户权限运行。
- 不支持 argv 白名单的命令应在计划阶段标 needs-info 或显式 allowShell，不得静默降级。

## confirmationToken

首次运行在合同、review、Git 预检通过后：

- `confirmationReasons` 只来自 high issue、missing、scopeConcerns、acceptanceConcerns；稳定排序。
- token payload 绑定：
  - `planHash = sha256(stableJson(plan))`
  - `reviewHash = sha256(stableJson(review))`
  - `resolutions`
  - `allowShell`
  - `reasons`
- 无 reasons：不要求 token。
- 有 reasons 且 token 缺失/不匹配：零修改，返回新 `confirmationToken` 和 reasons；用户确认后带 token 重跑。
- token 匹配：执行，并在 `overrides` 记录被覆盖的 reasons。
- **硬错误不生成 token**：review 为 reject；未解决 blocking 影响 ready；review/hash/snapshot/合同/Git/工作树校验失败；review 结构或语义不合法。
- token 是状态绑定，不是防篡改签名。计划、评审、resolutions、allowShell 或 reasons 任一变化都会使 token 失效。

## standard 重试状态机

1. 任务前快照 + HEAD/stash/plan 基线。
2. fixer 第 1 次；只改任务 `files`，禁止改 plan、跑验收、git 提交/重置/切 HEAD、起服务。
3. 修复后检查范围、HEAD、stash、plan；任一异常 → 当前任务失败，不跑验收、不重试。
4. 验收第 1 次；验收后同样检查。
5. 成功：exit 0 + 范围/完整性通过，attempts=1。
6. 普通验收失败：同一 fixer 带 stdout/stderr 再修一轮；再检查范围/HEAD/stash/plan；再验收一次。成功 attempts=2；仍失败 → failed。
7. 超时（124）、启动错误（126/127）、blocked、范围/HEAD/stash/plan 异常：不重试。
8. `stopOnFailure=true` 停止后续；false 只继续无依赖关系的任务；下游依赖失败的任务始终跳过。

## strict 执行

- 修复前/后/验收后三次快照，检查 HEAD/stash/plan 完整性。
- argv 验收；不允许 shell。
- 不自动重试；失败立即停止；`stopOnFailure=false` 在 strict 合同下不生效。

## fixer prompt 上下文

- 始终传入 `plan.goal`、`plan.summary`、当前任务 title/steps/behaviorAcceptance/risk/rationale。
- `architecture=null` 时明确写“未提供（standard）”，要求按 goal/summary/任务上下文和仓库现有模式实现，不直接访问空字段。
- `requirements=[]` 或当前任务未关联需求时，明确以 goal/summary/任务上下文为准，不访问空数组字段。
- `technicalDecisions=[]` 时明确按仓库约定实现。
- 传入 `resolutions` 中已确认的决策；不得自行扩大范围或改计划。

## 交付

`RunReport` 包含：mode、allowShell、shellTaskIds、requiresConfirmation、confirmationReasons、confirmationToken（需要确认时）、overrides、每个任务的行为验收/验收方式/命令/退出码/attempts/范围核验/改动文件/stdout/stderr、基线与最终状态、deviations、notCovered、validationErrors。

自动化验收通过只证明命令退出码为 0 且范围/完整性检查通过，不等于行为验收已人工确认，也不代表生产运行时已验证。

## 失败处理

- `validationErrors` 非空：没有调用修复员；报告错误并让用户修订/重新生成计划。
- 计划文件被修改/删除、HEAD 或 stash 变化、Git 不可用、快照不可读：拒绝执行或把当前任务标为失败，不得把无法验证描述为通过。
- 依赖失败或跳过：下游任务跳过，即使 `stopOnFailure=false`。
- 验收失败、超时、启动错误、范围检查失败：如实报告退出码、输出和变更；不自动回滚。
- 需要确认但 token 不匹配：零修改，返回新 token。
- v1 合同：明确拒绝，不静默降级。
- `task-run` 不存在：让用户先保存 workflow，不要临时写脚本。
