---
name: task-plan
description: Use when turning a product requirement, report, or findings file into a repository-grounded v2 implementation plan before code changes. Defaults to lightweight standard mode with non-shell argv acceptance; strict mode is opt-in. Supports natural-language revisions with diff-only re-review, reviewedPlanSnapshot/reviewedReviewHash, recon gates for new files/modules/dependencies, and user-evidenced resolutions. Not for executing plans.
---

# 任务计划（task-plan）

把需求或报告变成可审阅、可执行的 `plan.md`。计划阶段只读源码，只写计划文件；不执行计划。

计划有两种模式：

- **standard（默认）**：轻量计划。架构/技术决策可按复杂度省略；验收默认使用非 shell 的 `{ program, args }`。
- **strict（`strict=true`）**：完整方案。必须有 requirements、architecture、technicalDecisions、风险缓解、依据和结构化验收；执行前必须显式批准。

shell 验收只有显式 `allowShell=true` 才允许，且只在 standard 下可用；它始终标记为高风险，不是默认行为。

## 何时使用

- 拿到产品/工程需求，想先看需求拆解、方案和验收再执行；
- 已有 findings / 审查报告，想整理成有范围和验收的修复计划；
- 需求跨模块，需要先厘清业务规则、接口边界、权限、安全和迁移风险；
- 已有 v2 `plan.md`，想用自然语言做定向修订。

不要用于：一行修复、纯问答、已有明确计划和验收的简单任务，或执行阶段。

## 输入

- `requirement`（创建模式必填；修订模式可选）：需求原文，或 findings/报告文件的 workspace 相对路径。
- `scope`（可选）：只读勘察范围，换行或逗号分隔，最多 12 项；必须是 workspace 相对路径，不能是绝对路径、`..` 或 `.git`；空则让勘察员按需求拆分。
- `planPath`（可选）：计划输出路径，默认 `plan.md`；必须是规范化 workspace 相对 `.md`。创建模式拒绝覆盖非计划文件或已批准计划；修订模式允许已批准计划，但会重置批准状态。
- `acceptance`（可选）：验收命令提示，换行分隔；只是候选，不是执行源。
- `constraints`（可选）：业务规则、共享文件、禁止改动、必须保留的 API 等。
- `language`（可选）：默认中文。
- `strict`（可选，默认 false）：创建 strict 计划；只在创建模式生效。
- `allowShell`（可选，默认 false）：创建时允许 shell 验收（高风险）；只在创建模式生效。strict 下必须 false。
- `changes`（可选）：对现有 v2 计划的自然语言修改；提供时进入修订模式，不重跑勘察。

## 计划内容

### standard 最低要求

- `goal`、`summary`、`tasks`；
- 每个 ready 任务：`files`、`steps`、`behaviorAcceptance`、`risk`；
- 验收唯一权威字段：`acceptanceKind="argv"` + 合法 `acceptanceCommand`；
- `requirements` 可为空；`architecture` 可为 null；`technicalDecisions` 可为空；
- `riskMitigation`、`rationale` 可为空。

### strict 额外要求

- `requirements` 非空，所有 ready 任务有 `requirementIds`，且每条需求被任务覆盖；
- `architecture` 非空，包含 overview/boundaries/securityPrivacy/dataMigration；
- `technicalDecisions` 非空，含仓库证据、理由、替代方案、取舍、风险；
- ready 任务有 `riskMitigation`、`rationale`、结构化 `acceptanceCommand`；
- 不允许 shell。

### 验收唯一权威

| 场景 | acceptanceKind | acceptance | acceptanceCommand |
|---|---|---|---|
| standard 默认 | `argv` | `null` | 合法 |
| standard + allowShell | `argv` | `null` | 合法 |
| standard + allowShell | `shell` | 非空、无控制字符、过危险黑名单 | `null` |
| strict | `argv` | `null` | 合法 |
| 非 ready | `none` | `null` | `null` |

argv/shell 必须恰好一个字段非空；两个都填或都空都是 schema 错误。`detectedAcceptance` 和 `acceptance` 参数只是候选。

### architecture=null

standard 允许 `architecture=null`，但 planner 必须在 assumptions 说明为什么不需要；跨模块、新依赖、权限/安全/数据迁移必须提供完整 architecture。strict 缺 architecture 直接拒绝。

## 运行

```ts
CreateWorkflow({
  saved: {
    name: "task-plan",
    args: {
      requirement, scope, planPath, acceptance, constraints, language,
      strict, allowShell, changes,
    },
  },
})
```

不要用 `script` 重写一份，也不要用 `Agent` 手动模拟。确认窗口出现后让用户确认。

## 创建流程

1. 记录 Git 基线、内容快照、HEAD/stash、平台和候选验收命令；`sourceUnchanged` 只报告，不阻塞计划。
2. 最多 6 个勘察分片；全部失败中止；部分失败写入计划并在评审中显示。
3. planner 按 mode 生成 PlanDraft；standard 轻量、strict 完整。
4. 模式感知 schema 校验；失败给一次修复机会，仍失败中止。
5. 独立评审 + 一次自动修订 + 新评审员终审；`approve` 但存在 high/missing/scope/acceptance 时降级为 revise。
6. 评审对象做运行时结构/语义校验；不合法让评审员重答一次。
7. 写入 v2 合同：`approvalRequired = mode==="strict" && review.verdict==="approve"`，`approved=false`，并写入 `reviewedPlanSnapshot`、`reviewedReviewHash`、`resolutions`。
8. 逐字写盘校验；失败重试一次；仍失败恢复旧计划。

## 修订流程（`changes` 非空）

- 读取现有 `plan.md`，必须 v2；v1 报错“请重新生成”。
- `mode`/`allowShell` 从现有合同推断；修订不能改变模式或 shell 权限。
- `requirement` 可选，作为额外上下文；不强制替换原 goal。
- 允许修订已批准计划，但修订后 `approved=false`；写盘失败恢复旧计划（含旧批准状态）。
- 计划修订员只做用户要求的修改，保持未受影响任务 id/字段不变。
- 确定性 diff 列出新增/删除/修改任务及字段；发布 `plan-diff` artifact。
- 只重审受影响任务和全局变化；有问题自动修一轮 + 新评审员终审。
- **新增文件/模块/依赖闸门**：
  - 仅新增文件且未重新勘察：相关 ready 任务标 `needs-info`，写 blocking openQuestion，不得直接 ready；
  - 新增模块或依赖：`reconRequired=true`，不写 ready 计划，要求重新运行创建模式做勘察。
- **resolutions 只能来自用户 changes**：
  - 每项必须有逐字 `evidence`，且是 changes/需求文本的子串；
  - 修订员不得自行编造决定；
  - needs-info 提升为 ready 必须存在对应用户 resolution；否则 schema/闸门拒绝。
- 更新 `review`、`reviewedPlanSnapshot`、`reviewedReviewHash`、`resolutions`；strict 下重新批准。

## 审阅与批准

生成的 Markdown 包含 `TASK_RUN_CONTRACT_START` / `TASK_RUN_CONTRACT_END` 标记和 v2 JSON 合同。

- `reviewedPlanSnapshot` 是 `stableJson(plan)`；计划内容变化必须重新运行 task-plan。
- `reviewedReviewHash` 是 `sha256(stableJson(review))`；review 被修改会被 task-run 硬拒绝。
- standard：无需单独批准，运行确认窗口即批准；review 有 high/missing/scope/acceptance 时 task-run 会返回 confirmationToken。
- strict：
  - 终审 `approve` 时 `requiresApproval=true`，用户审阅后把合同 `approved` 改为 `true`；
  - 终审非 `approve` 时 `requiresApproval=false`，计划不可执行，需用 `changes` 修订或重新生成。
- 未解决的 blocking 问题不能关联 ready 任务；回答阻塞问题不能靠 confirmationToken 绕过。
- 不要直接改合同的 `plan`；方案变化走 `changes`。`resolutions` 的 evidence 用于审计，不是防篡改签名。

## 交付

workflow 返回 `PlanReport`：计划路径、mode、allowShell、shellTaskIds、任务、评审、requiresApproval、reviewedReviewHash、changedTaskIds、changeSummary、diffMarkdown、reconRequired/reconReasons、baseline/finalStatus、sourceUnchanged、detectedAcceptance、reconFailures、planWritten/planWriteError。

`planWritten` 只有在磁盘内容与本次生成内容一致（忽略 CRLF/BOM）时才为 true。计划产物只是快照，执行以 `plan.md` 的合同为准。

批准/确认后运行：

```text
/task-run planPath=<路径>
```

## 硬规则

- 不要替用户批准计划；不要只因为文件存在就说已批准。
- v1 合同不支持；修订模式遇到 v1 直接报错。
- shell 只在 standard + `allowShell=true` 下允许，且必须标高风险；不要默认生成 shell。
- 不支持的 argv 命令标 needs-info 或要求显式 allowShell，不得静默降级。
- 不要编造 resolutions；没有用户明确决定就保留 blocking 问题。
- 不要声称“计划里写了”等于“代码已经改了”。
- `task-plan` 不存在时，让用户先保存 workflow，不要临时写脚本。
