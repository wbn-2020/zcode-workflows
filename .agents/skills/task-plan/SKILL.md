---
name: task-plan
description: Use when turning a product requirement, report, or findings file into a repository-grounded implementation proposal before code changes. It decomposes requirements, proposes architecture and technology decisions with evidence/tradeoffs/risks, defines behavior and automated acceptance, then writes an unapproved versioned plan contract for human review.
---

# 任务计划（task-plan）

把需求或报告变成可审阅、可执行的 `plan.md`。计划阶段只读源码，只写计划文件。它不仅拆文件任务，还应解释如何实现需求、采用哪些技术、为什么适合当前仓库、替代方案和风险。

## 何时使用

- 拿到一个产品/工程需求，想先审阅拆解、架构和实施步骤再执行；
- 已有 findings / 审查报告，想整理成有范围和验收的修复计划；
- 需求跨越多个模块，需要先厘清业务规则、数据/接口边界、权限、安全和迁移风险。

不要用于：一行修复、纯问答、已经有明确计划和验收的简单任务。

## 输入

- `requirement`（必填）：需求原文，或 findings / 报告文件的 workspace 相对路径。
- `scope`（可选）：只读勘察范围，换行或逗号分隔，最多 12 项；必须是 workspace 相对路径，不能是绝对路径、`..` 或 `.git`；空则让勘察员按需求拆分仓库区域。
- `planPath`（可选）：计划输出路径，默认 `plan.md`，必须是 workspace 相对、规范化且以 `.md` 结尾。不能覆盖非计划文件或已有已批准计划；已有未批准计划可以重写，写入失败会尝试恢复旧内容。
- `acceptance`（可选）：以换行分隔的自动化验收命令提示；写入计划的命令必须属于 task-run 支持的结构化 argv 白名单。
- `constraints`（可选）：业务规则、共享文件、禁止改动、必须保留的 API 等。
- `language`（可选）：默认中文。

## 计划内容

计划必须包含：

- 原子化需求条目及其可观察验收标准，并标出由哪些任务覆盖；
- 用户约束、勘察范围及当前架构证据、目标组件/数据流/接口边界，以及安全隐私、数据迁移等适用性说明；
- 每项关键技术/设计选择的仓库证据、选择理由、替代方案、取舍和风险；
- 每个任务的需求关联、文件范围、有序实现步骤、行为验收、自动化验收命令、依赖、风险与缓解措施；
- 独立评审的 verdict、摘要、问题、缺失项、范围和验收疑虑；
- 假设、未覆盖项和带阻塞标记的待确认问题。

需求与任务按严格 schema 校验。验收命令必须使用 task-run 支持的结构化程序和参数；路径型参数必须留在 workspace 内，不能使用绝对路径或 `..`。用户提供的命令提示不会直接作为 shell 命令运行。行为验收说明功能表现，测试/构建命令不能代替行为标准。

证据不足或业务决定未定时，不要替用户猜；相关任务标 `needs-info`。阻塞问题未解决时，相关任务不能是 `ready`。所有勘察分片失败时 workflow 会中止；部分失败会写入计划并在评审中显示，不能假装已覆盖。

## 运行

```ts
CreateWorkflow({
  saved: {
    name: "task-plan",
    args: { requirement, scope, planPath, acceptance, constraints, language },
  },
})
```

不要用 `script` 重写一份，也不要用 `Agent` 手动模拟。确认窗口出现后让用户确认。

## 审阅与批准

生成的 Markdown 包含 `TASK_RUN_CONTRACT_START` / `TASK_RUN_CONTRACT_END` 标记和版本化 JSON 合同。合同的 `approved` 初始为 `false`，计划只是草案；独立评审 verdict 不是 `approve` 时，`task-run` 必定拒绝。

用户审阅后：

1. 检查需求拆解、技术理由/证据、行为验收、任务范围和风险；
2. 为每个阻塞问题在合同 `resolutions` 中写入 `{ "questionId": "Q1", "decision": "..." }`；
3. 仅将合同根字段 `approved` 改为 `true`；
4. 不要直接修改合同的 `plan`。`reviewedPlanSnapshot` 用于确定性发现只修改 `plan` 而未重新评审的漂移；它与 `plan` 同在合同内，不能作为防篡改签名。任何方案数据变化都应重新运行 `task-plan` 并重新审阅，不要把同步修改快照当作批准依据。

不要只因为计划文件存在就称其已批准，也不要替用户设置批准标记。

## 交付

workflow 返回 `PlanReport`。说明计划路径、任务与评审结论、待确认问题、勘察缺口、用户约束/scope、候选验收命令文本和 `sourceUnchanged`。`PlanTask.acceptanceCommand` 才是交给 `task-run` 的结构化 `{ program, args }` argv；`detectedAcceptance` 只是仓库配置或用户输入中的候选命令提示。`planWritten` 只有在磁盘内容与本次生成内容一致（忽略 CRLF/BOM）时才为 true；`planWriteError` 记录写入失败。只有基线源码干净、Git HEAD 可读且未变化、stash 未变化、源码快照前后一致时，`sourceUnchanged` 才为 true；无法比较时为 null，发现变化时为 false。基线检查包含 staged、unstaged 和 untracked 文件（排除目标计划文件）；其他未跟踪文件也会使源码未变状态无法证明。

计划产物只是快照，执行以 `plan.md` 的合同为准。批准并解决阻塞问题后运行：

```text
/task-run planPath=<路径>
```

## 安全边界

`task-plan` 只允许写规范化 `.md` 计划文件，不会覆盖非计划文件或已批准计划；已有未批准计划写入失败时会尝试恢复旧内容。计划数据中出现 `TASK_RUN_CONTRACT` 保留标记会被拒绝。

`task-run` 只接受固定的测试/构建工具和结构化参数，不经 shell 执行任意命令。测试脚本本身仍以当前用户权限运行，这不是操作系统沙箱。`task-run` 要求除计划文件外 Git 工作树干净，Git HEAD/stash 可读且运行期间不变；不能核验时会在改源码前拒绝或把任务判为失败。
