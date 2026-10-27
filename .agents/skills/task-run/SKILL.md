---
name: task-run
description: Use when executing a reviewed and explicitly user-approved versioned plan contract in batches. Deterministically validates the contract, approvals, dependencies, safe argv-based acceptance commands, a clean Git baseline, and per-task file-content scope snapshots. Not for planning or unplanned fixes.
---

# 按批准方案执行（task-run）

执行已审阅并由用户显式批准的 `plan.md` 执行合同。`planPath` 必须是 workspace 相对、规范化且以 `.md` 结尾的路径。执行器不重新规划，不用模型解释 Markdown；合同是唯一执行来源。

## 何时使用

- 用户已经审阅 `plan.md`，并在合同中显式批准；
- 所有阻塞问题已经在合同 `resolutions` 中记录决策；已回答的问题不会自动升级原计划的 `needs-info` 任务，若要执行该任务，需重新生成并评审包含新状态的计划；
- 要按依赖分批施工、逐批运行验收并核对文件范围。

不要用于：尚未批准的草案、没有版本化合同的旧 `plan.md`、未经计划的需求或生产部署。

## 执行前条件

执行器在调用任何修复员前，确定性校验：

- 合同标记唯一、JSON 可解析且 `contractVersion` 受支持；
- `approved: true`，独立评审 verdict 为 `approve`；
- `plan` 与 `reviewedPlanSnapshot` 一致，计划数据一旦被编辑就必须重新运行 `task-plan`；该快照与计划同在可编辑合同内，只能发现未同步的计划漂移，不能当作防篡改签名；
- 状态、需求引用、任务依赖、所有任务的文件路径与执行计划排除规则、步骤、行为验收和结构化验收命令均合法；路径必须是规范化 workspace 相对路径，不能使用 `..`、绝对路径或 Git pathspec 特殊前缀；完整任务依赖图不能有缺失引用或循环；
- 所有阻塞问题已通过 `resolutions` 回答；
- Git 可用，HEAD 和 stash 状态可读，除 `plan.md` 外工作树干净，暂存区为空。

任何校验失败都会在源码修改前拒绝整份计划。无法取得 Git 快照、HEAD 或计划文件完整性时也会拒绝，不会降级成范围检查通过。

## 验收命令与范围

验收使用合同中的 `{ "program": "...", "args": [...] }`，通过固定可执行程序和 argv 直接启动，不经 shell。仅允许受限的常见测试/构建工具与参数；路径型参数必须留在 workspace 内，不能使用绝对路径或 `..`；不支持的命令需在计划阶段改为可支持的自动化验收，或列为人工验收而不设为可执行任务。

这不是操作系统沙箱：仓库测试/build 脚本仍会以当前用户权限运行。不要把不可信仓库代码当作安全隔离环境。

每个任务在修复前、修复后和验收后比较 Git 变更文件，以及合同全部任务文件范围并集内的 ignored 文件内容快照，再按当前任务范围核对变更。任务自己的所有变更（包括验收命令造成的变更）必须落在其文件范围内；无法读取 Git 或 ignored 文件快照时任务失败关闭。执行器不自动回滚。

执行器在修复后和验收后检查 Git HEAD 与 stash；任务或验收脚本提交、重置、切换 HEAD 或用 stash 隐藏改动，会把该任务判为失败。计划文件不在 Git 快照范围内，但会在运行结束时重新读取并与启动内容比较；修改或删除计划文件会写入偏离和未覆盖，即使任务已经完成也不会视为完全成功。

`stopOnFailure=false` 只允许继续运行与失败任务无依赖关系的任务。任何依赖没有成功完成，其下游任务始终跳过。

## 运行

```ts
CreateWorkflow({
  saved: {
    name: "task-run",
    args: { planPath, stopOnFailure, language },
  },
})
```

不要用 `script` 重写一份，也不要用 `Agent` 手动模拟。

## 交付

workflow 返回 `RunReport`，包含每个任务的行为验收标准、自动化验收命令、退出码、Git 范围核验结果、改动文件、stdout/stderr、失败/跳过原因、计划文件/HEAD 完整性结果和未覆盖事项。执行报告 artifact 也展示基线与最终状态。

自动化验收命令通过只证明命令退出码为 0 且范围检查通过，不等于所有行为验收已人工确认，也不代表生产运行时已验证。不要声称运行时已验证，不要自动修改计划或回滚越界改动。

## 失败处理

- `validationErrors` 非空：没有调用修复员；报告错误并让用户修订/重新批准计划。
- 计划文件被修改或删除、Git HEAD 或 stash 发生变化、Git 不可用：拒绝执行或把当前任务标为失败，不得把无法验证描述为通过。
- 依赖任务失败或跳过：相关下游任务跳过，即使 `stopOnFailure=false`。
- 验收失败、超时、启动错误或范围检查失败：如实报告退出码、输出和变更；不自动回滚。
- Git 状态或内容快照不可用：拒绝执行或将当前任务标为失败，不得把无法验证描述为通过。
