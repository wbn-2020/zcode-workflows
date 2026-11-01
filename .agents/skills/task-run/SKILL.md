---
name: task-run
description: Execute a reviewed task-plan implementation package with safe dependency waves, staged changes, independent implementation review, task/stage/final checks, immutable input and source-baseline verification, and resumable evidence records. Use when the user says to implement or fix according to an existing plan, including “按刚才的方案执行”. Supports v3 packages and compatible v2 contracts. Do not re-plan or deploy implicitly.
---

# task-run：按方案实现并交付

用户主线：**task-plan 完成分析 → 用户审阅实施方案 → task-run 实现、复核、验收 → 用户上线测试**。

把“按刚才的方案执行”转换成 `CreateWorkflow({ saved: { name: "task-run", args } })`。上下文只有一个方案时直接沿用路径，不要求用户手写参数；没有方案或确实有多个候选时才澄清。不要用临时脚本或普通 Agent 模拟整个执行流程。

## 输入与授权

- `planPath`：现有实施方案入口的 workspace 相对 `.md` 路径。
- `approvalEvidence`：仅用户明确批准**当前 strict 版本**时传其原话；不从普通修改请求、文件存在或此前版本批准推断。
- `grants`：用户明确授权的检查 ID 数组，例如 `["check:C-service"]`。每项只授权当前包对应检查；`permission` 字段本身不是授权。
- `allowShell`：默认 false，仅用户明确同意 shell 检查时开启。方案和执行两端都要允许，strict 禁 shell。
- `confirmationToken`：仅用户已经确认本轮列出的风险原因时传返回的 token，不自行生成或代确认。
- `stopOnFailure`：默认 true；standard 可明确改 false，只继续独立且依赖成功的任务；strict 总是 fail-fast。
- `language`：默认中文。

模式只来自合同，task-run 没有 strict 参数。standard 的运行确认是施工授权，不需要另一个“批准 JSON”操作。strict 的明确批准可直接作为执行输入，不修改不可变合同。

## 执行前：整份通过再施工

v3 校验唯一合同指针、合同/支持文件原始 UTF-8 摘要、`reviewedPlanSnapshot`、`reviewedReviewHash`、任务与阶段依赖、文件归属、检查及权限。

以下情况整份零施工：
- 方案未完成、review 未 approve、缺关键调查证据或影响实施的决定未解决；
- 计划、评审、合同或支持文件被修改；
- 评审后的相关源码基线变化，或无法取得有效快照；
- 缺 strict 批准、shell 双端授权或服务/远端/部署检查的明确授权；
- 任务/检查的写范围覆盖方案包、计划入口或执行状态。

这些是硬阻塞，不能靠 confirmationToken 绕过。未决决定让 task-plan 用用户原话更新并复核，不先执行一半。

已有 Git 仓库绑定 HEAD、branch、stash、文件内容/模式和 Git index。standard 可保留任务外的既有脏文件，但任务自身必须干净；strict 除本方案材料和入口外要求工作树干净。没有 Git 的空目录使用文件系统快照；已有 Git 但尚无首个提交时仍保留分支、索引和状态校验。不自动 git init 或创建首个提交。

## 实现、复核、验收

1. 依赖图和文件/父目录冲突决定安全波次；共享文件、生成器及 serial 任务不并发施工。
2. 独立任务并行读取源码，在各自暂存目录准备 manifest 和文件副本；控制器先验证全部归属/原始摘要，再串行原子应用。不是让多个实现员直接并发改工作树。
3. 独立复核读取实际实现、副本、任务和接口，检查行为、错误路径、资源/锁及边界。不靠实现员一句“已完成”判成功。
4. 控制器运行合同内获授权的任务检查、阶段集成检查和最终整体检查；实现员不重复运行这些命令。
5. standard 只对原范围内普通实现/验收缺陷修复一次，最多两次尝试；strict 在首个失败检查后停止后续检查和施工，不重试。扩大业务/接口/文件范围、缺授权、超时/缺工具/快照或完整性失败均停止，不绕过检查。

默认非 shell `{program,args}`。standard 用危险命令黑名单，strict 用受控测试/构建参数。命令脚本仍以当前用户权限执行，黑名单和提示词不是操作系统沙箱。服务、远端操作和部署不能仅靠检查声明启用。

## 交付与事实边界

主交付物是执行报告，含任务状态、实际变更、每次实现与复核记录、实际检查命令/退出码/输出、失败原因、恢复路径及上线测试清单。进度看板失败不影响 `report()` 保存结果。

只凭 exit 0 不宣称所有业务行为已通过。区分：
- 本执行记录实际运行的机器检查；
- 独立代码复核支持的行为；
- 尚需用户/真实环境验证的行为。

最终快照不可读或整体检查未通过，交付未完成，不标成功。实际变更以基线与有效最终快照的比较为准；未核实的空清单不等于零改动。无实施任务的诊断说明“无需施工，未运行项目验收”，不声称完成了实现复核或未配置的阶段检查。方案里的上线、迁移、回退和观察事项属于待人工执行的计划，不是已经执行的操作或新增授权。卡片发布失败说明本地报告是否已写入，不重做已经应用的代码。

## v3 中断与恢复

- 每波实施/应用/检查前后保存检查点和不可变证据；已完成包再次调用，只有当前文件、包和最终快照一致才返回“已执行”，不重新施工。
- 同一包已有非完成记录时，普通新调用不重做。读取报告里的 `checkpointPath`，核对原 run 和最后可验证步骤。
- **恢复前在项目根目录运行 `node --disable-warning=ExperimentalWarning <本 skill 的绝对路径>/scripts/preflight.cjs <checkpointPath>`**，取得新鲜确定性核对。只有退出 0 且 `ok=true` 才 Resume/Amend；核对失败不得施工，未决更改交给用户或 task-plan 复核。
- stopped 原样继续用 `ResumeWorkflowRun`；用户主动停止只在用户要求后恢复。provider 错误先处理原因，不擅自换模型或并发。
- errored 或需要修脚本用 `AmendWorkflow`，先读 run 指定草稿并加载 dynamic-workflows，不重新 Create 整套任务。
- Amend 不继承 args 时，在该 run 草稿的 `RECOVERY_CHECKPOINT_PATH3` 填检查点路径，继承原包授权、停止策略、语言、预算、已应用归属和记录；不能写固定业务 fallback，也不能借恢复扩大权限。
- 源码已落盘但中断记录无法证明归属、最近检查仍失败、修复尚未完成、预算耗尽或串行任务处于不明确中间状态时安全停止，不能盲目重做。串行恢复必须有对应尝试的成功实施、独立复核和前后快照及摘要绑定；`appliedTaskIds` 或空结果数组不是成功证明。已失败的旧尝试可以保留，只有同 ID 后续检查已经通过才算闭环；任何完整性失败都不能被后续 exit 0 抹掉。
- 宿主原样 Resume 重放记录，不是所有检查再次执行；对外明确“既有检查记录”和“本次现场核对”的区别。

## 停止后如何继续

先根据报告和现场证据说明卡点，不把所有失败都当作技术中断：
- **缺授权或决定**：只向用户说明缺少的具体内容；业务决定交回 task-plan 更新并复核，执行授权按当前包填写，不自行批准。
- **技术中断**：按上节新鲜预检后决定能否 Resume/Amend，不能因用户说“继续”就跳过完整性门槛。
- **范围、行为或验收需要变化**：用户要求调整时，把当前方案、执行报告和检查点路径带回 task-plan，以当前实际状态重新核对。已有改动保留，不自动重做已应用任务；新方案不豁免基线或未提交改动保护。

给出可用的自然语言下一步，不要求手工编辑 JSON，也不自动启动另一轮规划或执行。

## v2 兼容

合法 v2 保持原合同批准/确认规则和串行执行；ready 任务的唯一验收字段、HEAD/stash/plan 与内容快照继续校验，修复空 resolutions、快照失败重试及最终误报等边界。v2 不自动获得 v3 的安全波次、分层验收或恢复检查点；v1 和无合同手写 Markdown 不执行。

v2 施工中断没有可供 fresh preflight 校验的完整应用归属和剩余预算，不自动 Resume/Amend 或重跑整包。先只读核对原运行和现场；确需继续时，由用户审阅后让 task-plan 针对当前实际状态生成并复核新包，不能把恢复 v3 的说明套到 v2。

不自动提交、推送、上线，不删除或回滚用户变更。只有暂存事务部分应用失败时，在摘要仍匹配自身写入的前提下恢复该事务自己的写入。
