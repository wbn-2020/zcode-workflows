/* zcode-workflow
description: 把需求、报告或 findings 转成可审阅的 plan.md：只读勘察、自动探测验收命令、拆分任务、独立评审；不改源码。
whenToUse: 当用户想先把需求或一堆问题拆成可审阅的计划再执行时使用。计划阶段只读，只写 plan.md；执行计划用
  task-run。不用于一行修复、纯问答或已经有明确计划的简单任务。
args:
  requirement:
    type: string
    description: 需求原文，或 findings/报告文件的 workspace 相对路径。
    required: true
  scope:
    type: string
    description: 可选：只读勘察范围，换行/逗号分隔的目录或文件；空则让勘察员提出分片。
  planPath:
    type: string
    description: 可选：计划输出路径，默认 plan.md。
    default: plan.md
  acceptance:
    type: string
    description: 可选：验收命令，换行分隔；空则自动探测。
  constraints:
    type: string
    description: 可选：共享文件、最大批次、禁止改动、必须保留的 API 等。
  language:
    type: string
    description: 输出语言，默认中文。
    default: 中文
*/
interface ReconShard {
  /** Short name for the area, in the user's language. */
  name: string;
  /** Workspace-relative files or directories to inspect. */
  paths: string[];
  /** What this shard should focus on. */
  focus: string;
}

interface Recon {
  /** Which shard this is. */
  shard: string;
  /** Three to five sentences on the current state. */
  summary: string;
  /** Key entry points, with path:line. */
  entryPoints: string[];
  /** Interfaces, data, or behavior that must be preserved. */
  constraints: string[];
  /** Likely pitfalls or unknowns. */
  risks: string[];
  /** Existing technology, architecture, and conventions relevant to the requirement. */
  technologyEvidence: string[];
}

interface ShardProposal {
  shards: ReconShard[];
  summary: string;
}

interface RequirementItem {
  /** Stable requirement id, e.g. R1. */
  id: string;
  /** One independently verifiable behavior or constraint from the request. */
  statement: string;
  /** Observable outcomes that satisfy this requirement. */
  acceptanceCriteria: string[];
}

interface TechnicalDecision {
  /** Concern or component the decision applies to. */
  area: string;
  /** Recommended technology or design, grounded in repository evidence. */
  recommendation: string;
  /** Repository paths, existing APIs, or conventions supporting this choice. */
  evidence: string[];
  /** Why this choice best fits the requirement and current repository. */
  rationale: string;
  /** Credible alternatives considered. */
  alternatives: string[];
  /** Benefits and costs of the recommendation. */
  tradeoffs: string;
  /** Consequences to mitigate or verify. */
  risks: string[];
}

interface OpenQuestion {
  /** Stable id used to record the user's decision in the execution contract. */
  id: string;
  /** One question that needs a user decision or missing evidence. */
  question: string;
  /** Whether this decision blocks the affected task. */
  blocking: boolean;
  /** Tasks affected by the answer; empty means plan-wide. */
  relatedTaskIds: string[];
}

interface AcceptanceCommand {
  /** Executable selected from task-run's non-shell command allowlist. */
  program: string;
  /** Arguments passed directly as argv; never interpreted by a shell. */
  args: string[];
}

interface PlanTask {
  /** Stable id, e.g. "T1". */
  id: string;
  /** Short imperative title. */
  title: string;
  /** Requirement ids this task implements or verifies. */
  requirementIds: string[];
  /** Workspace-relative files or directories this task may edit. */
  files: string[];
  /** Ordered implementation steps a fixer can follow. */
  steps: string[];
  /** User-visible behavior and outcomes that must hold when this task is done. */
  behaviorAcceptance: string[];
  /** Structured command executed directly without a shell; null for tasks not ready to execute. */
  acceptanceCommand: AcceptanceCommand | null;
  /** Ids of tasks that must finish first. */
  dependsOn: string[];
  /** What could go wrong, and what to watch. */
  risk: string;
  /** Concrete steps that reduce the task's stated risks. */
  riskMitigation: string[];
  /** "ready" to execute; "needs-info" blocked on a decision; "do-not-fix" deliberately skipped. */
  status: "ready" | "needs-info" | "do-not-fix";
  /** Why this task exists, tied to the requirement or a finding. */
  rationale: string;
}

interface PlanDraft {
  /** Plan title. */
  title: string;
  /** Two or three sentences: what this plan achieves. */
  summary: string;
  /** Atomic requirements extracted from the user's request. */
  requirements: RequirementItem[];
  /** Target architecture and relevant boundaries, including why areas do not apply. */
  architecture: {
    overview: string;
    boundaries: string[];
    securityPrivacy: string[];
    dataMigration: string[];
  };
  /** Repository-grounded technology and design decisions. */
  technicalDecisions: TechnicalDecision[];
  /** Tasks in dependency order. */
  tasks: PlanTask[];
  /** Findings deliberately not fixed, with a reason each. */
  notDoing: string[];
  /** Questions only the user can answer. */
  openQuestions: OpenQuestion[];
  /** Assumptions made from the available evidence. */
  assumptions: string[];
}

interface ExecutionContract {
  /** Contract version consumed by task-run. */
  contractVersion: number;
  /** Must remain false until a person reviews and approves plan.md. */
  approved: boolean;
  /** Independent review result for the exact plan snapshot below. */
  review: { verdict: "approve" | "revise" | "reject"; summary: string };
  /** Canonical plan JSON used to detect an unsynchronized edit; it is not a tamper-proof signature. */
  reviewedPlanSnapshot: string;
  /** User decisions for blocking questions, added after reviewing the plan. */
  resolutions: { questionId: string; decision: string }[];
  /** Structured implementation plan; the only task data task-run executes. */
  plan: PlanDraft;
}

interface PlanIssue {
  /** Task id the issue applies to, or "global". */
  taskId: string;
  /** What is wrong. */
  problem: string;
  /** The concrete change that fixes it. */
  fix: string;
  severity: "high" | "medium" | "low";
}

interface PlanReview {
  /** "approve" only when the plan can be executed as written. */
  verdict: "approve" | "revise" | "reject";
  issues: PlanIssue[];
  /** Requirement or evidence the plan fails to cover. */
  missing: string[];
  /** Scope or file-ownership concerns. */
  scopeConcerns: string[];
  /** Acceptance commands that are missing, too weak, or not runnable. */
  acceptanceConcerns: string[];
  /** Two or three sentences explaining the verdict. */
  summary: string;
}

function normalizePlanReview(review: PlanReview): PlanReview {
  const hasBlockingConcerns =
    review.issues.some((issue) => issue.severity === "high") ||
    review.missing.length > 0 ||
    review.scopeConcerns.length > 0 ||
    review.acceptanceConcerns.length > 0;
  return hasBlockingConcerns && review.verdict === "approve"
    ? { ...review, verdict: "revise" }
    : review;
}

interface PlanReport {
  /** Two or three sentences answering what the user asked for. */
  conclusion: string;
  /** Workspace-relative path of the written plan. */
  planPath: string;
  /** The plan that was written. */
  plan: PlanDraft;
  /** The final independent review. */
  review: PlanReview;
  /** Changed files before any work, excluding the plan file. */
  baseline: string;
  /** Changed files after writing the plan, excluding the plan file. */
  finalStatus: string;
  /** True when the plan stage left sources unchanged and baseline was clean; null when unverifiable. */
  sourceUnchanged: boolean | null;
  /** Candidate acceptance command strings detected from repository configuration or user input. */
  detectedAcceptance: string[];
  /** Recon shards that failed, with the reason. */
  reconFailures: string[];
  /** True only when the on-disk plan exactly matches the generated content. */
  planWritten: boolean;
}

const requirement = String(args.requirement ?? "").trim();
const scopeArg = String(args.scope ?? "").trim();
const planPath = (String(args.planPath ?? "plan.md").trim() || "plan.md")
  .replace(/\\/g, "/")
  .replace(/^\.\//, "");
const acceptanceArg = String(args.acceptance ?? "").trim();
const extraConstraints = String(args.constraints ?? "").trim();
const language = String(args.language ?? "中文").trim();

if (!requirement) throw new Error("task-plan: args.requirement is required");
if (
  /^[A-Za-z]:[\\/]/.test(planPath) ||
  planPath.startsWith("/") ||
  planPath.startsWith("\\\\") ||
  planPath.split("/").some((part) => part === ".." || part.toLowerCase() === ".git") ||
  planPath === "." ||
  planPath.endsWith("/") ||
  !validRepoPath(planPath)
) {
  throw new Error("task-plan: args.planPath must be workspace-relative");
}

function splitScope(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitCommands(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? "null" : encoded;
  }
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = keys.slice().sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validRepoPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return Boolean(
    normalized &&
      !normalized.startsWith("/") &&
      !/^[A-Za-z]:/.test(normalized) &&
      !normalized.split("/").some((part) => part === ".." || part.toLowerCase() === ".git") &&
      !normalized.split("").some((character) => {
        const code = character.charCodeAt(0);
        return code === 0 || code === 10 || code === 13 || "*?[]{}".includes(character);
      }),
  );
}

function hasControlChars(value: string): boolean {
  return value.split("").some((character) => {
    const code = character.charCodeAt(0);
    return code === 0 || code === 10 || code === 13;
  });
}

function pathIsWithin(path: string, scope: string): boolean {
  const candidate = path.replace(/\\/g, "/").replace(/^\.\//, "");
  const normalizedScope = scope.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  return normalizedScope === "." || candidate === normalizedScope || candidate.startsWith(`${normalizedScope}/`);
}

function validAcceptanceCommand(value: unknown): value is AcceptanceCommand {
  if (!isRecord(value) || !exactKeys(value, ["program", "args"])) return false;
  if (typeof value.program !== "string" || !isStringArray(value.args)) return false;
  if (value.args.some((item) => hasControlChars(item))) return false;
  const commandArgs = value.args;
  switch (value.program) {
    case "npm":
    case "pnpm":
    case "yarn":
      return (commandArgs.length === 1 && commandArgs[0] === "test") ||
        (commandArgs.length === 2 && commandArgs[0] === "run" && typeof commandArgs[1] === "string" && /^(test|build|lint|typecheck|check)(:[a-zA-Z0-9._-]+)?$/.test(commandArgs[1]));
    case "go":
      return commandArgs.length >= 2 && ["test", "build"].includes(commandArgs[0]) && commandArgs.slice(1).every(
        (item) => ["-race", "-cover", "-v", "-count=1", "./..."].includes(item) ||
          (/^[A-Za-z0-9_./*]+$/.test(item) && !item.split("/").includes("..") && !item.startsWith("-")),
      );
    case "cargo":
      return commandArgs.length >= 1 && ["test", "build", "clippy"].includes(commandArgs[0]) && commandArgs.slice(1).every(
        (item) => ["--workspace", "--all-targets", "--all-features", "--locked"].includes(item),
      );
    case "pytest":
      return commandArgs.every((item) => ["-q", "-v", "--quiet", "--strict-markers"].includes(item) || /^[A-Za-z0-9_./:-]+$/.test(item));
    case "mvn":
      return commandArgs.length === 1 && ["test", "verify", "package"].includes(commandArgs[0]);
    case "gradle":
    case "gradlew":
    case "gradlew.bat":
      return commandArgs.length === 1 && ["test", "check", "build"].includes(commandArgs[0]);
    case "make":
      return commandArgs.length === 1 && ["test", "check", "build", "lint"].includes(commandArgs[0]);
    case "dotnet":
      return commandArgs.length >= 1 && ["test", "build"].includes(commandArgs[0]) && commandArgs.slice(1).every((item) => /^[A-Za-z0-9_./:=*-]+$/.test(item));
    default:
      return false;
  }
}

function validatePlanDraft(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["PlanDraft 根字段不符合 schema"];
  if (!exactKeys(value, ["title", "summary", "requirements", "architecture", "technicalDecisions", "tasks", "notDoing", "openQuestions", "assumptions"])) {
    errors.push("PlanDraft 根字段不符合 schema");
  }
  if (typeof value.title !== "string" || !value.title.trim()) errors.push("title 缺失");
  if (typeof value.summary !== "string" || !value.summary.trim()) errors.push("summary 缺失");
  if (!isStringArray(value.notDoing)) errors.push("notDoing 必须是字符串数组");
  if (!isStringArray(value.assumptions)) errors.push("assumptions 必须是字符串数组");

  const requirementIds = new Set<string>();
  if (!Array.isArray(value.requirements) || value.requirements.length === 0) {
    errors.push("requirements 不能为空");
  } else {
    value.requirements.forEach((item, index) => {
      if (!isRecord(item) || !exactKeys(item, ["id", "statement", "acceptanceCriteria"])) {
        errors.push(`requirements[${index}] 字段不合法`);
        return;
      }
      if (typeof item.id !== "string" || !item.id.trim() || requirementIds.has(item.id)) errors.push(`requirements[${index}].id 缺失或重复`);
      else requirementIds.add(item.id);
      if (typeof item.statement !== "string" || !item.statement.trim()) errors.push(`requirements[${index}].statement 缺失`);
      if (!isStringArray(item.acceptanceCriteria) || !item.acceptanceCriteria.length || item.acceptanceCriteria.some((entry) => !entry.trim())) errors.push(`requirements[${index}].acceptanceCriteria 缺失`);
    });
  }

  if (!isRecord(value.architecture) || !exactKeys(value.architecture, ["overview", "boundaries", "securityPrivacy", "dataMigration"])) {
    errors.push("architecture 字段不合法");
  } else {
    if (typeof value.architecture.overview !== "string" || !value.architecture.overview.trim()) errors.push("architecture.overview 缺失");
    for (const key of ["boundaries", "securityPrivacy", "dataMigration"]) {
      const items = value.architecture[key];
      if (!isStringArray(items) || !items.length || items.some((entry) => !entry.trim())) errors.push(`architecture.${key} 必须说明方案或不适用原因`);
    }
  }

  if (!Array.isArray(value.technicalDecisions) || !value.technicalDecisions.length) {
    errors.push("technicalDecisions 不能为空");
  } else {
    value.technicalDecisions.forEach((item, index) => {
      if (!isRecord(item) || !exactKeys(item, ["area", "recommendation", "evidence", "rationale", "alternatives", "tradeoffs", "risks"])) {
        errors.push(`technicalDecisions[${index}] 字段不合法`);
        return;
      }
      for (const key of ["area", "recommendation", "rationale", "tradeoffs"]) {
        if (typeof item[key] !== "string" || !item[key].trim()) errors.push(`technicalDecisions[${index}].${key} 缺失`);
      }
      for (const key of ["evidence", "alternatives", "risks"]) {
        if (!isStringArray(item[key]) || !item[key].length || item[key].some((entry) => !entry.trim())) errors.push(`technicalDecisions[${index}].${key} 缺失`);
      }
    });
  }

  const taskIds = new Set<string>();
  const tasks = Array.isArray(value.tasks) ? value.tasks : [];
  if (!tasks.length) errors.push("tasks 不能为空");
  tasks.forEach((item, index) => {
    if (!isRecord(item) || !exactKeys(item, ["id", "title", "requirementIds", "files", "steps", "behaviorAcceptance", "acceptanceCommand", "dependsOn", "risk", "riskMitigation", "status", "rationale"])) {
      errors.push(`tasks[${index}] 字段不合法`);
      return;
    }
    if (typeof item.id !== "string" || !item.id.trim() || taskIds.has(item.id)) errors.push(`tasks[${index}].id 缺失或重复`);
    else taskIds.add(item.id);
    if (typeof item.title !== "string" || !item.title.trim()) errors.push(`tasks[${index}].title 缺失`);
    if (!isStringArray(item.requirementIds) || item.requirementIds.some((id) => !requirementIds.has(id))) errors.push(`tasks[${index}].requirementIds 缺失或引用未知需求`);
    if (!isStringArray(item.files) || item.files.some((path) => !validRepoPath(path) || pathIsWithin(path, planPath) || pathIsWithin(planPath, path))) errors.push(`tasks[${index}].files 包含无效路径或覆盖计划文件`);

    if (!isStringArray(item.steps) || item.steps.some((step) => !step.trim())) errors.push(`tasks[${index}].steps 字段不合法`);
    if (!isStringArray(item.behaviorAcceptance) || item.behaviorAcceptance.some((criterion) => !criterion.trim())) errors.push(`tasks[${index}].behaviorAcceptance 字段不合法`);
    if (!isStringArray(item.dependsOn)) errors.push(`tasks[${index}].dependsOn 必须是字符串数组`);
    if (typeof item.risk !== "string" || !item.risk.trim()) errors.push(`tasks[${index}].risk 缺失`);
    if (!isStringArray(item.riskMitigation)) errors.push(`tasks[${index}].riskMitigation 必须是字符串数组`);
    if (typeof item.rationale !== "string" || !item.rationale.trim()) errors.push(`tasks[${index}].rationale 缺失`);
    if (!["ready", "needs-info", "do-not-fix"].includes(String(item.status))) errors.push(`tasks[${index}].status 未知`);
    if (item.status === "ready") {
      if (!isStringArray(item.requirementIds) || !item.requirementIds.length) errors.push(`${String(item.id)}: ready 任务缺少需求关联`);
      if (!isStringArray(item.files) || !item.files.length || item.files.some((path) => !validRepoPath(path))) errors.push(`${String(item.id)}: ready 任务缺少有效文件范围`);
      if (!isStringArray(item.steps) || !item.steps.length || item.steps.some((step) => !step.trim())) errors.push(`${String(item.id)}: ready 任务缺少实施步骤`);
      if (!isStringArray(item.behaviorAcceptance) || !item.behaviorAcceptance.length || item.behaviorAcceptance.some((criterion) => !criterion.trim())) errors.push(`${String(item.id)}: ready 任务缺少行为验收`);
      if (!isStringArray(item.riskMitigation) || !item.riskMitigation.length || item.riskMitigation.some((mitigation) => !mitigation.trim())) errors.push(`${String(item.id)}: ready 任务缺少风险缓解措施`);
      if (!validAcceptanceCommand(item.acceptanceCommand)) errors.push(`${String(item.id)}: ready 任务验收命令不受支持`);
      if (isStringArray(item.files) && item.files.some((path) => path.replace(/\\/g, "/").replace(/^\.\//, "") === planPath)) errors.push(`${String(item.id)}: 文件范围不能包含计划文件`);
    } else if (item.acceptanceCommand !== null && !validAcceptanceCommand(item.acceptanceCommand)) {
      errors.push(`${String(item.id)}: 非 ready 任务验收命令必须为 null 或合法命令`);
    }
  });

  const taskById = new Map<string, Record<string, unknown>>();
  for (const task of tasks) {
    if (isRecord(task) && typeof task.id === "string") taskById.set(task.id, task);
  }
  for (const task of tasks) {
    if (!isRecord(task) || typeof task.id !== "string" || !isStringArray(task.dependsOn)) continue;
    for (const dependency of task.dependsOn) {
      if (!taskIds.has(dependency)) errors.push(`${task.id}: 依赖 ${dependency} 不存在`);
      if (task.status === "ready") {
        const dependencyTask = taskById.get(dependency);
        if (dependencyTask && dependencyTask.status !== "ready") errors.push(`${task.id}: 依赖 ${dependency} 不是 ready`);
      }
    }
  }

  for (const requirementId of requirementIds) {
    const isCovered = tasks.some((task) => isRecord(task) && isStringArray(task.requirementIds) && task.requirementIds.includes(requirementId));
    if (!isCovered) errors.push(`需求 ${requirementId} 没有被任务覆盖`);
  }

  const orderedTaskIds = new Set<string>();
  while (orderedTaskIds.size < tasks.length) {
    const next = tasks.find((task) =>
      isRecord(task) &&
      typeof task.id === "string" &&
      !orderedTaskIds.has(task.id) &&
      isStringArray(task.dependsOn) &&
      task.dependsOn.every((dependency) => orderedTaskIds.has(dependency)),
    );
    if (!isRecord(next) || typeof next.id !== "string") {
      errors.push("任务依赖存在环或引用无效，无法生成拓扑顺序");
      break;
    }
    orderedTaskIds.add(next.id);
  }

  if (!Array.isArray(value.openQuestions)) {
    errors.push("openQuestions 必须是数组");
  } else {
    const questionIds = new Set<string>();
    value.openQuestions.forEach((item, index) => {
      if (!isRecord(item) || !exactKeys(item, ["id", "question", "blocking", "relatedTaskIds"])) {
        errors.push(`openQuestions[${index}] 字段不合法`);
        return;
      }
      if (typeof item.id !== "string" || !item.id.trim() || questionIds.has(item.id)) errors.push(`openQuestions[${index}].id 缺失或重复`);
      else questionIds.add(item.id);
      if (typeof item.question !== "string" || !item.question.trim()) errors.push(`openQuestions[${index}].question 缺失`);
      if (typeof item.blocking !== "boolean") errors.push(`openQuestions[${index}].blocking 必须为 boolean`);
      if (!isStringArray(item.relatedTaskIds)) {
        errors.push(`openQuestions[${index}].relatedTaskIds 必须是字符串数组`);
      } else {
        for (const taskId of item.relatedTaskIds) {
          if (!taskIds.has(taskId)) errors.push(`${String(item.id)}: 关联了未知任务 ${taskId}`);
        }
        if (item.blocking === true) {
          const affectedTasks = item.relatedTaskIds.length
            ? item.relatedTaskIds.map((taskId) => taskById.get(taskId)).filter((task): task is Record<string, unknown> => task !== undefined)
            : tasks.filter((task) => isRecord(task));
          for (const affectedTask of affectedTasks) {
            if (affectedTask.status === "ready") errors.push(`${String(item.id)}: 阻塞问题仍关联 ready 任务 ${String(affectedTask.id)}`);
          }
        }
      }
    });
  }
  if (isStringArray(value.notDoing) === false || isStringArray(value.assumptions) === false) return errors;
  return errors;
}

function isPlanPath(path: string): boolean {
  return path.replace(/\\/g, "/").replace(/^\.\//, "") === planPath;
}

function statusPathsExcludingPlan(status: GitStatus | null): string[] | null {
  if (!status) return null;
  return unique([...status.staged, ...status.unstaged, ...status.untracked].filter((path) => !isPlanPath(path)));
}

async function sourceSnapshot(status: GitStatus | null): Promise<Record<string, string> | null> {
  const paths = statusPathsExcludingPlan(status);
  if (paths === null) return null;
  const snapshot: Record<string, string> = {};
  try {
    for (const path of paths) {
      const hash = await world.run("git", ["hash-object", "--", path]);
      const diff = await git.diff("HEAD", path);
      if (hash.exitCode === 0) {
        snapshot[path] = `${diff}\nworktree:${hash.stdout.trim()}`;
      } else if (diff) {
        snapshot[path] = `deleted:${diff}`;
      } else {
        return null;
      }
    }
  } catch {
    return null;
  }
  return snapshot;
}

async function changedFilesExcludingPlan(): Promise<string[] | null> {
  try {
    const paths = await git.changedFiles();
    return paths.filter((path) => !isPlanPath(path)).sort();
  } catch {
    return null;
  }
}

function planToMarkdown(plan: PlanDraft, review: PlanReview, reconFailures: string[]): string {
  const contract: ExecutionContract = {
    contractVersion: 1,
    approved: false,
    review: { verdict: review.verdict, summary: review.summary },
    reviewedPlanSnapshot: stableJson(plan),
    resolutions: [],
    plan,
  };
  const lines: string[] = [];
  lines.push(`# 实施方案：${plan.title}`, "");
  lines.push(`> 独立评审：${review.verdict}。${review.summary}`);
  lines.push(
    `> 执行状态：${review.verdict === "approve" ? "未批准。请审阅方案后将合同中的 approved 改为 true；先解决所有阻塞问题。" : "不可执行：独立评审未通过。修改方案后重新运行 task-plan。"}`,
    "",
  );
  lines.push(plan.summary, "");

  lines.push("## 需求拆解", "");
  if (plan.requirements.length) {
    for (const item of plan.requirements) {
      lines.push(`### ${item.id} ${item.statement}`);
      item.acceptanceCriteria.forEach((criterion) => lines.push(`- 验收：${criterion}`));
      lines.push("");
    }
  } else {
    lines.push("- 未拆分需求条目；该计划不可执行，需补充需求覆盖。", "");
  }

  lines.push("## 目标架构与边界", "", plan.architecture.overview, "");
  lines.push("### 组件与集成边界", "");
  plan.architecture.boundaries.forEach((item) => lines.push(`- ${item}`));
  lines.push("", "### 安全与隐私", "");
  plan.architecture.securityPrivacy.forEach((item) => lines.push(`- ${item}`));
  lines.push("", "### 数据与迁移", "");
  plan.architecture.dataMigration.forEach((item) => lines.push(`- ${item}`));

  lines.push("", "## 技术与设计决策", "");
  for (const decision of plan.technicalDecisions) {
    lines.push(`### ${decision.area}`, `- 选择：${decision.recommendation}`);
    lines.push(`- 仓库证据：${decision.evidence.join("；") || "未提供"}`);
    lines.push(`- 理由：${decision.rationale}`);
    lines.push(`- 替代方案：${decision.alternatives.join("；") || "未说明"}`);
    lines.push(`- 取舍：${decision.tradeoffs}`);
    lines.push(`- 风险：${decision.risks.join("；") || "未说明"}`, "");
  }

  for (const task of plan.tasks) {
    lines.push(`## 任务 ${task.id}：${task.title}`);
    lines.push(`- 状态：${task.status}`);
    lines.push(`- 覆盖需求：${task.requirementIds.join("、") || "（未指定）"}`);
    lines.push(`- 文件：${task.files.length ? task.files.map((file) => `\`${file}\``).join("、") : "（未指定）"}`);
    lines.push(`- 依赖：${task.dependsOn.length ? task.dependsOn.join("、") : "无"}`);
    lines.push("- 做法：");
    if (task.steps.length) task.steps.forEach((step, index) => lines.push(`  ${index + 1}. ${step}`));
    else lines.push("  1. （未指定）");
    lines.push("- 行为验收：");
    task.behaviorAcceptance.forEach((criterion) => lines.push(`  - ${criterion}`));
    lines.push(`- 自动化验收：${task.acceptanceCommand ? `\`${task.acceptanceCommand.program} ${task.acceptanceCommand.args.join(" ")}\`` : "（未指定，任务不可执行）"}`);
    lines.push(`- 风险：${task.risk || "未说明"}`);
    lines.push(`- 风险缓解：${task.riskMitigation.join("；") || "未说明"}`);
    lines.push(`- 依据：${task.rationale || "未说明"}`);
    lines.push("");
  }

  lines.push("## 勘察缺口", "");
  if (reconFailures.length) reconFailures.forEach((item) => lines.push(`- ${item}`));
  else lines.push("- 无");
  lines.push("");

  lines.push("## 不修清单", "");
  if (plan.notDoing.length) plan.notDoing.forEach((item) => lines.push(`- ${item}`));
  else lines.push("- 无");

  lines.push("", "## 待确认", "");
  if (plan.openQuestions.length) {
    plan.openQuestions.forEach((item) =>
      lines.push(`- [${item.blocking ? "阻塞" : "非阻塞"}] ${item.id}: ${item.question}（任务：${item.relatedTaskIds.join("、") || "全局"}）`),
    );
  } else lines.push("- 无");

  lines.push("", "## 假设", "");
  if (plan.assumptions.length) plan.assumptions.forEach((item) => lines.push(`- ${item}`));
  else lines.push("- 无");

  lines.push(
    "",
    "## 执行合同",
    "",
    "仅修改合同 JSON 中的 `approved` 和 `resolutions` 来记录人工批准及待确认问题的答案。回答问题后，如需将相关任务改为 ready，必须重新运行 task-plan 生成新计划并独立评审。不要直接改 `plan`；内容变更会使独立评审快照失效。",
    "",
    "<!-- TASK_RUN_CONTRACT_START -->",
    JSON.stringify(contract, null, 2),
    "<!-- TASK_RUN_CONTRACT_END -->",
    "",
  );
  return lines.join("\n");
}

async function detectAcceptance(): Promise<string[]> {
  const found: string[] = [];
  let root: string[] = [];
  try {
    root = await files.glob("*");
  } catch {
    root = [];
  }
  const names = new Set(root.map((path) => path.replace(/^\.\//, "")));
  const has = (name: string) => names.has(name);

  if (has("package.json")) {
    const packageManager = has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : "npm";
    try {
      const pkg = JSON.parse(await files.read("package.json")) as { scripts?: Record<string, string> };
      const scripts = pkg.scripts ?? {};
      for (const script of ["test", "build", "lint", "typecheck", "check"]) {
        const command = scripts[script];
        if (!command) continue;
        found.push(
          packageManager === "npm"
            ? script === "test"
              ? "npm test"
              : `npm run ${script}`
            : `${packageManager} run ${script}`,
        );
      }
    } catch {
      // A malformed package.json should not stop planning.
    }
  }

  if (has("go.mod")) found.push("go test ./...", "go build ./...");
  if (has("pom.xml")) found.push("mvn test");
  if (has("build.gradle") || has("build.gradle.kts")) {
    found.push(has("gradlew.bat") ? "gradlew.bat test" : has("gradlew") ? "gradlew test" : "gradle test");
  }
  if (has("pyproject.toml") || has("pytest.ini") || has("tox.ini")) found.push("pytest");
  if (has("Cargo.toml")) found.push("cargo test");
  if (has("Makefile")) found.push("make test");

  return unique(found);
}

phase("确认验收基线");
const baselineFiles = await changedFilesExcludingPlan();
const baselineGitStatus = await git.status().catch(() => null);
const baselineSourceSnapshot = await sourceSnapshot(baselineGitStatus);

const baselineSourcePaths = statusPathsExcludingPlan(baselineGitStatus);
const baseline = baselineFiles === null ? "（不是 git 仓库）" : baselineFiles.length ? baselineFiles.join("\n") : "（干净）";
const baselineIsClean = baselineSourcePaths !== null && baselineSourcePaths.length === 0;
let platform = "unknown";

try {
  const platformRun = await world.run("node", ["-p", "process.platform"]);
  if (platformRun.exitCode === 0) platform = platformRun.stdout.trim() || "unknown";
} catch {
  platform = "unknown";
}
const detected = acceptanceArg ? unique(splitCommands(acceptanceArg)) : await detectAcceptance();

let inputPath = "";
if (!requirement.includes("\n")) {
  try {
    const matches = await files.glob(requirement);
    if (matches.includes(requirement)) inputPath = requirement;
  } catch {
    // The requirement is plain text, not a path.
  }
}
const requirementBlock = inputPath
  ? `需求来源文件：${inputPath}\n请先读取该文件。`
  : `需求原文：\n${requirement}`;

let shards: ReconShard[];
const scopeLines = splitScope(scopeArg);
if (scopeLines.length > 0) {
  shards = scopeLines.map((path, index) => ({
    name: `范围${index + 1}`,
    paths: [path],
    focus: `勘察 ${path} 的现状、入口、约束和改动点`,
  }));
} else {
  phase("规划勘察分片");
  const scout = agent("范围勘察员", {
    system: "你是只读代码勘察员。先看仓库结构，再提出 3-6 个互不重叠的勘察分片。不要修改任何文件。",
  });
  const proposed = await scout.ask<ShardProposal>(
    `需求：\n${requirementBlock}\n\n` +
      `请用文件工具查看仓库结构，然后提出 3-6 个互不重叠的勘察分片。每个分片给出 name、paths（workspace 相对路径/目录）、focus。` +
      `分片要覆盖需求涉及的主要区域，不要全仓库平均分。只读，不要修改任何文件。输出语言：${language}。`,
  );
  shards = proposed.shards.slice(0, 6).map((shard, index) => ({
    name: `${shard.name || "分片"}·${index + 1}`,
    paths: shard.paths.length ? shard.paths : ["."],
    focus: shard.focus || "勘察与需求相关的现状",
  }));
  if (shards.length === 0) {
    shards = [{ name: "全仓库·1", paths: ["."], focus: "勘察与需求相关的现状" }];
  }
}

phase("分片勘察现状");
log(`开始勘察 ${shards.length} 个分片`);
const reconSettled = await Promise.allSettled(
  shards.map((shard) =>
    agent(`勘察员·${shard.name}`, {
      system: "你是只读代码勘察员。只读，不修改任何文件，不运行构建/测试/启动。",
    }).ask<Recon>(
      `需求：\n${requirementBlock}\n\n` +
        `范围：${shard.paths.join("、")}\n关注：${shard.focus}\n` +
        (extraConstraints ? `\n用户约束：\n${extraConstraints}\n` : "") +
        `\n请阅读相关代码，输出 Recon：shard、summary、entryPoints（path:line）、constraints、risks、technologyEvidence。technologyEvidence 必须引用仓库中的真实路径/API/依赖/约定及其用途。` +
        `不要修改文件；不要运行构建/测试/启动。输出语言：${language}。`,
    ),
  ),
);

const recon: Recon[] = [];
const reconFailures: string[] = [];
reconSettled.forEach((outcome, index) => {
  if (outcome.status === "fulfilled") {
    recon.push(outcome.value);
  } else {
    reconFailures.push(`${shards[index].name}: ${String(outcome.reason)}`);
  }
});
if (reconFailures.length > 0) {
  log(`有 ${reconFailures.length} 个勘察分片失败，计划将基于其余分片`);
}

phase("拆分修复批次并写出计划草稿");
const planner = agent("实施方案编排员", {
  system: "你是资深产品工程方案设计师。先理解业务目标与仓库现状，再给出有证据的目标架构、技术取舍、风险和可执行任务。只读，不修改源码；不得把未知业务规则当事实。",
});
const reconText = JSON.stringify(recon);
const planPrompt =
  `需求：\n${requirementBlock}\n\n` +
  `平台：${platform}\n` +
  `git 基线：\n${baseline || "（干净）"}\n\n` +
  `自动探测到的验收命令：\n${detected.length ? detected.join("\n") : "（未探测到，请根据仓库配置提出）"}\n\n` +
  `勘察结果：\n${reconText}\n\n` +
  `勘察失败的分片：\n${reconFailures.length ? reconFailures.join("\n") : "无"}\n\n` +
  (extraConstraints ? `用户约束：\n${extraConstraints}\n\n` : "") +
  `请输出完整 PlanDraft（严格按接口字段）。目标是给真实功能做方案设计，不是只列文件任务。规则：\n` +
  `1. 把原需求拆成原子 requirements，每条有稳定 id、可观察验收标准；任务必须通过 requirementIds 覆盖需求，未覆盖项明确指出。\n` +
  `2. architecture 写目标组件、数据流、集成/API/权限边界；securityPrivacy、dataMigration 对相关领域给出控制或明确说明不适用。\n` +
  `3. technicalDecisions 按关键领域列选择、仓库路径证据、为什么适合、可信替代方案、取舍和风险；不得无证据地引入新框架/依赖。证据不足时列阻塞问题，不伪造依据。\n` +
  `4. 每个 ready 任务必须有 requirementIds、files（workspace 相对路径/目录）、具体有序 steps、behaviorAcceptance、acceptanceCommand（program + args 数组）、risk 和 riskMitigation。行为验收写用户可观察结果，命令只作为自动化验证。\n` +
  `5. acceptanceCommand 只从以下可执行程序中选：npm、pnpm、yarn、go、cargo、pytest、mvn、gradle、gradlew、make、dotnet。args 必须是参数数组，不要拼 shell 命令、管道、重定向或命令分隔符；包管理器仅允许执行仓库 scripts 中 test/build/lint/typecheck/check 类脚本。\n` +
  `6. 任务要小：一个逻辑改动，尽量不超过 5 个文件；共享文件的任务用 dependsOn 串行。新文件要在 files 中明确写出。\n` +
  `7. 需要业务决定/运行时人工验证或证据不足的部分标 needs-info，并将问题写成 openQuestions 对象（id/question/blocking/relatedTaskIds）；明确不修的写进 notDoing。\n` +
  `8. 工作树可能已有未提交改动；不要回滚或格式化无关改动。\n` +
  `9. 勘察失败覆盖需求关键区域时，相关任务标 needs-info；不得假装已勘察。\n` +
  `10. 输出语言：${language}。`;
const draft = await planner.ask<PlanDraft>(planPrompt);
let validatedDraft = draft;
let schemaErrors = validatePlanDraft(validatedDraft);
if (schemaErrors.length) {
  const invalidDraft = JSON.stringify(validatedDraft);
  validatedDraft = await planner.ask<PlanDraft>(
    `输出的 PlanDraft 未通过确定性校验。只修复列出的 schema 问题，保持方案含义和任务 id；仍需遵守原始需求和约束。\n错误：\n${schemaErrors.map((item) => `- ${item}`).join("\n")}\n\n当前 PlanDraft：\n${invalidDraft}`,
  );
  schemaErrors = validatePlanDraft(validatedDraft);
  if (schemaErrors.length) throw new Error(`task-plan: PlanDraft schema 校验失败：${schemaErrors.join("；")}`);
}

phase("独立评审计划");
const reviewSystem = "你是独立计划评审员。你没有参与编排，必须自己打开计划涉及的文件核对。只读，不修改任何文件。";
const reviewPrompt = (plan: PlanDraft) =>
  `需求：\n${requirementBlock}\n\n` +
  `平台：${platform}\n` +
  `验收基线：\n${baseline || "（干净）"}\n` +
  `自动探测到的命令：\n${detected.length ? detected.join("\n") : "（无）"}\n\n` +
  `计划：\n${JSON.stringify(plan)}\n\n` +
  `勘察：\n${reconText}\n\n` +
  `勘察失败的分片：\n${reconFailures.length ? reconFailures.join("\n") : "无"}\n\n` +
  `请打开计划涉及的文件，逐项严厉检查：\n` +
  `1. 是否逐条拆分并覆盖 requirements，用户可观察的验收结果是否与需求一致；\n` +
  `2. architecture 是否适配仓库已有模式；technicalDecisions 是否有可核实的路径/代码证据、选择理由、真实替代方案和明确取舍；是否引入不必要依赖；\n` +
  `3. 是否处理安全/隐私、数据一致性/迁移、权限、错误处理、可访问性等相关领域；不适用项是否明确说明；\n` +
  `4. 每个 ready 任务是否有真实范围、非空步骤、requirementIds、行为验收、结构化可执行 acceptanceCommand 和具体风险缓解；命令程序及参数是否安全且在仓库存在；\n` +
  `5. dependsOn 是否正确、无循环；任务范围是否有冲突、漏项或范围蔓延；needs-info / do-not-fix 是否分对；\n` +
  `6. 行为验收不能被构建/测试命令替代，需覆盖功能情境、边界/错误情形和权限规则（适用时）；\n` +
  `7. 勘察失败的分片是否被正确处理，有没有假装覆盖；\n` +
  `8. 是否有阻塞性 openQuestions；有则相关任务必须不是 ready。\n` +
  `只读，不要修改文件。输出 PlanReview。approve 仅在所有关键项均有证据且无 high issue 时给出；否则 revise 或 reject。输出语言：${language}。`;
const reviewer = agent("计划评审员", { system: reviewSystem });
let finalDraft = validatedDraft;
let finalReview = normalizePlanReview(await reviewer.ask<PlanReview>(reviewPrompt(validatedDraft)));

if (finalReview.verdict !== "approve") {
  phase("按评审意见修订计划");
  const revisionErrors = schemaErrors.slice();
  finalDraft = await planner.ask<PlanDraft>(
    `根据独立评审意见修订计划。只改需要改的部分，保持任务 id 稳定。\n\n` +
      `原计划：\n${JSON.stringify(finalDraft)}\n\n` +
      `评审：\n${JSON.stringify(finalReview)}\n\n` +
      `初稿 schema 校验错误：${revisionErrors.length ? revisionErrors.join("；") : "无"}\n` +
      `输出修订后的 PlanDraft，必须满足新版完整字段和详细方案规则：requirements 覆盖、仓库证据支持的 architecture/technicalDecisions、行为验收、structured acceptanceCommand、风险缓解、问题关联。不要发明文件。输出语言：${language}。`,
  );
  schemaErrors = validatePlanDraft(finalDraft);
  if (schemaErrors.length) throw new Error(`task-plan: 修订后 PlanDraft schema 校验失败：${schemaErrors.join("；")}`);

  phase("请没看过前稿的评审员复核");
  const finalReviewer = agent("终审评审员", { system: reviewSystem });
  finalReview = normalizePlanReview(await finalReviewer.ask<PlanReview>(reviewPrompt(finalDraft)));
}

phase("写出 plan.md");
const planMarkdown = planToMarkdown(finalDraft, finalReview, reconFailures);
const writer = agent("计划落盘员", {
  system: "你只负责把给定的 Markdown 原样写入指定文件。不要修改源码，不要改写内容。",
});
await writer.ask(
  `把下面的 Markdown 原样写入 workspace 相对路径 ${planPath}（使用文件写入工具，必要时创建目录）。不要修改任何源码。写完后回复 "written"。\n\n---\n${planMarkdown}\n---`,
);

let written = "";
try {
  written = await files.read(planPath);
} catch {
  written = "";
}
if (written !== planMarkdown) {
  await writer.ask(
    `文件 ${planPath} 缺失或与目标内容不同。请把下面的 Markdown 原样重写进去，不要改源码。\n\n---BEGIN PLAN---\n${planMarkdown}\n---END PLAN---`,
  );
  try {
    written = await files.read(planPath);
  } catch {
    written = "";
  }
}
const planWritten = written === planMarkdown;

phase("确认计划阶段未改源码");
const finalFiles = await changedFilesExcludingPlan();
const finalGitStatus = await git.status().catch(() => null);
const finalSourceSnapshot = await sourceSnapshot(finalGitStatus);
const finalStatus = finalFiles === null
  ? "（无法读取 git status）"
  : finalFiles.length
    ? finalFiles.join("\n")
    : "（无源码改动）";

const sourceUnchanged =
  finalFiles !== null &&
  baselineIsClean &&
  baselineSourceSnapshot !== null &&
  finalSourceSnapshot !== null
    ? stableJson(baselineSourceSnapshot) === stableJson(finalSourceSnapshot)
    : null;

try {
  await artifact.markdown("plan", planMarkdown, {
    title: "计划书",
    description: `${finalDraft.tasks.length} 个任务；独立评审 ${finalReview.verdict}。`,
    primary: true,
  });
} catch {
  // The plan file is still on disk; the report carries the path.
}

const conclusion = planWritten
  ? `计划已写入 ${planPath}：${finalDraft.tasks.length} 个任务，独立评审 ${finalReview.verdict}${reconFailures.length ? `，${reconFailures.length} 个勘察分片失败` : ""}。`
  : `计划已生成，但写入 ${planPath} 失败；请从产物复制或让计划落盘员重写。`;

const result: PlanReport = {
  conclusion,
  planPath,
  plan: finalDraft,
  review: finalReview,
  baseline,
  finalStatus,
  sourceUnchanged,
  detectedAcceptance: detected,
  reconFailures,
  planWritten,
};
return result;
