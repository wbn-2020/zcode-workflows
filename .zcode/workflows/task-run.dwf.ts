/* zcode-workflow
description: 按已审阅并由用户批准的版本化 plan 合同分批执行：确定性校验、非 shell 验收、逐任务 Git 快照范围检查和依赖门槛。
whenToUse: 当用户已审阅、解决阻塞问题并显式批准 plan.md 中的执行合同后运行。合同不合格、未批准、Git 不可核验或工作树存在计划外改动时拒绝施工。
args:
  planPath:
    type: string
    description: 经审阅并批准的 plan.md workspace 相对路径。
    required: true
  stopOnFailure:
    type: boolean
    description: 失败后是否停止所有后续任务；false 也不会运行依赖失败任务。
    default: true
  language:
    type: string
    description: 输出语言，默认中文。
    default: 中文
*/
interface AcceptanceCommand {
  program: string;
  args: string[];
}

interface RunTask {
  id: string;
  title: string;
  requirementIds: string[];
  files: string[];
  steps: string[];
  behaviorAcceptance: string[];
  acceptanceCommand: AcceptanceCommand | null;
  dependsOn: string[];
  risk: string;
  riskMitigation: string[];
  status: "ready" | "needs-info" | "do-not-fix";
  rationale: string;
}

interface RequirementItem {
  id: string;
  statement: string;
  acceptanceCriteria: string[];
}

interface TechnicalDecision {
  area: string;
  recommendation: string;
  evidence: string[];
  rationale: string;
  alternatives: string[];
  tradeoffs: string;
  risks: string[];
}

interface OpenQuestion {
  id: string;
  question: string;
  blocking: boolean;
  relatedTaskIds: string[];
}

interface RunPlan {
  title: string;
  summary: string;
  requirements: RequirementItem[];
  architecture: {
    overview: string;
    boundaries: string[];
    securityPrivacy: string[];
    dataMigration: string[];
  };
  technicalDecisions: TechnicalDecision[];
  tasks: RunTask[];
  notDoing: string[];
  openQuestions: OpenQuestion[];
  assumptions: string[];
}

interface ExecutionContract {
  contractVersion: number;
  approved: boolean;
  review: { verdict: "approve" | "revise" | "reject"; summary: string };
  /** Canonical plan JSON used to detect unsynchronized edits; it is not a tamper-proof signature. */
  reviewedPlanSnapshot: string;
  resolutions: { questionId: string; decision: string }[];
  plan: RunPlan;
}

interface FixOutcome {
  summary: string;
  filesChanged: string[];
  notes: string;
  blocked: boolean;
  blockReason: string;
}

interface BatchResult {
  taskId: string;
  title: string;
  status: "completed" | "failed" | "skipped";
  filesChanged: string[];
  behaviorAcceptance: string[];
  acceptanceCommand: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  scopeVerified: boolean;
  notes: string;
}

interface RunReport {
  conclusion: string;
  planPath: string;
  batches: BatchResult[];
  completed: number;
  failed: number;
  skipped: number;
  filesChanged: string[];
  baseline: string;
  finalStatus: string;
  deviations: string[];
  notCovered: string[];
  validationErrors: string[];
}

interface FileSnapshot {
  paths: string[];
  content: Record<string, string>;
}

interface CommandOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const planPath = String(args.planPath ?? "")
  .trim()
  .replace(/\\/g, "/")
  .replace(/^\.\//, "");
const stopOnFailure = args.stopOnFailure !== false;
const language = String(args.language ?? "中文").trim();
const startMarker = "<!-- TASK_RUN_CONTRACT_START -->";
const endMarker = "<!-- TASK_RUN_CONTRACT_END -->";
if (
  !planPath ||
  planPath.startsWith("/") ||
  planPath.startsWith("\\") ||
  /^[A-Za-z]:\//.test(planPath) ||
  planPath.split("/").some((part) => part === ".." || part.toLowerCase() === ".git") ||
  planPath === "." ||
  planPath.endsWith("/") ||
  !validRepoPath(planPath)
) {
  throw new Error("task-run: args.planPath must be workspace-relative and cannot contain '..' or '.git'");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = keys.slice().sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
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

function isControlText(value: string): boolean {
  return value.split("").some((character) => {
    const code = character.charCodeAt(0);
    return code === 0 || code === 10 || code === 13;
  });
}

function validRepoPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return Boolean(
    normalized &&
      !normalized.startsWith("/") &&
      !/^[A-Za-z]:/.test(normalized) &&
      !normalized.split("/").some((part) => part === ".." || part.toLowerCase() === ".git") &&
      !normalized.split("").some((character) => "*?[]{}".includes(character) || isControlText(character)),
  );
}

function withinScope(file: string, scopes: string[]): boolean {
  const candidate = file.replace(/\\/g, "/").replace(/^\.\//, "");
  return scopes.some((entry) => {
    const normalized = entry.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
    if (normalized === ".") return true;
    return candidate === normalized || candidate.startsWith(`${normalized}/`);
  });
}

function safeScriptName(value: string): boolean {
  return /^(test|build|lint|typecheck|check)(:[a-zA-Z0-9._-]+)?$/.test(value);
}

function validAcceptanceCommand(value: unknown): value is AcceptanceCommand {
  if (!isRecord(value) || !exactKeys(value, ["program", "args"])) return false;
  if (typeof value.program !== "string" || !isStringArray(value.args)) return false;
  if (value.args.some((item) => isControlText(item))) return false;
  const commandArgs = value.args;
  switch (value.program) {
    case "npm":
    case "pnpm":
    case "yarn":
      return (
        (commandArgs.length === 1 && commandArgs[0] === "test") ||
        (commandArgs.length === 2 && commandArgs[0] === "run" && safeScriptName(commandArgs[1]))
      );
    case "go":
      return (
        commandArgs.length >= 2 &&
        ["test", "build"].includes(commandArgs[0]) &&
        commandArgs.slice(1).every(
          (item) => ["-race", "-cover", "-v", "-count=1", "./..."].includes(item) ||
            (/^[A-Za-z0-9_./*]+$/.test(item) && !item.split("/").includes("..") && !item.startsWith("-")),
        )
      );
    case "cargo":
      return (
        commandArgs.length >= 1 &&
        ["test", "build", "clippy"].includes(commandArgs[0]) &&
        commandArgs.slice(1).every((item) => ["--workspace", "--all-targets", "--all-features", "--locked"].includes(item))
      );
    case "pytest":
      return commandArgs.every(
        (item) => ["-q", "-v", "--quiet", "--strict-markers"].includes(item) || /^[A-Za-z0-9_./:-]+$/.test(item),
      );
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

function validatePlanShape(value: unknown, errors: string[]): value is RunPlan {
  const initialErrorCount = errors.length;
  if (!isRecord(value) || !exactKeys(value, ["title", "summary", "requirements", "architecture", "technicalDecisions", "tasks", "notDoing", "openQuestions", "assumptions"])) {
    errors.push("plan 字段不符合合同 schema");
    return false;
  }
  if (typeof value.title !== "string" || !value.title.trim()) errors.push("plan.title 缺失");
  if (typeof value.summary !== "string" || !value.summary.trim()) errors.push("plan.summary 缺失");
  if (!isStringArray(value.notDoing)) errors.push("plan.notDoing 必须是字符串数组");
  if (!isStringArray(value.assumptions)) errors.push("plan.assumptions 必须是字符串数组");

  const requirementIds = new Set<string>();
  if (!Array.isArray(value.requirements) || value.requirements.length === 0) {
    errors.push("plan.requirements 不能为空");
  } else {
    value.requirements.forEach((item, index) => {
      if (!isRecord(item) || !exactKeys(item, ["id", "statement", "acceptanceCriteria"])) {
        errors.push(`requirements[${index}] 字段不合法`);
        return;
      }
      if (typeof item.id !== "string" || !item.id.trim()) errors.push(`requirements[${index}].id 缺失`);
      else if (requirementIds.has(item.id)) errors.push(`需求 id 重复：${item.id}`);
      else requirementIds.add(item.id);
      if (typeof item.statement !== "string" || !item.statement.trim()) errors.push(`requirements[${index}].statement 缺失`);
      if (!isStringArray(item.acceptanceCriteria) || item.acceptanceCriteria.length === 0 || item.acceptanceCriteria.some((criterion) => !criterion.trim())) {
        errors.push(`requirements[${index}].acceptanceCriteria 必须是非空字符串数组`);
      }
    });
  }

  const architecture = value.architecture;
  if (!isRecord(architecture) || !exactKeys(architecture, ["overview", "boundaries", "securityPrivacy", "dataMigration"])) {
    errors.push("plan.architecture 字段不合法");
  } else {
    if (typeof architecture.overview !== "string" || !architecture.overview.trim()) errors.push("architecture.overview 缺失");
    for (const key of ["boundaries", "securityPrivacy", "dataMigration"]) {
      if (!isStringArray(architecture[key]) || architecture[key].length === 0 || architecture[key].some((entry) => !entry.trim())) {
        errors.push(`architecture.${key} 必须说明决策或明确标注不适用`);
      }
    }
  }

  if (!Array.isArray(value.technicalDecisions) || value.technicalDecisions.length === 0) {
    errors.push("plan.technicalDecisions 不能为空；至少说明复用现有技术的决策及依据");
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
        if (!isStringArray(item[key]) || item[key].length === 0 || item[key].some((entry) => !entry.trim())) errors.push(`technicalDecisions[${index}].${key} 必须说明内容或明确标注不适用`);
      }
    });
  }

  const taskIds = new Set<string>();
  if (!Array.isArray(value.tasks) || value.tasks.length === 0) {
    errors.push("计划里没有任务");
  } else {
    value.tasks.forEach((item, index) => {
      if (!isRecord(item) || !exactKeys(item, ["id", "title", "requirementIds", "files", "steps", "behaviorAcceptance", "acceptanceCommand", "dependsOn", "risk", "riskMitigation", "status", "rationale"])) {
        errors.push(`tasks[${index}] 字段不合法`);
        return;
      }
      if (typeof item.id !== "string" || !item.id.trim()) errors.push(`tasks[${index}] 缺少 id`);
      else if (taskIds.has(item.id)) errors.push(`任务 id 重复：${item.id}`);
      else taskIds.add(item.id);
      if (typeof item.title !== "string" || !item.title.trim()) errors.push(`tasks[${index}].title 缺失`);
      if (!isStringArray(item.requirementIds) || item.requirementIds.some((id) => !requirementIds.has(id))) errors.push(`${String(item.id)}.requirementIds 缺失或引用未知需求`);
      if (!isStringArray(item.files) || item.files.some((path) => !validRepoPath(path) || withinScope(planPath, [path]) || withinScope(path, [planPath]))) errors.push(`${String(item.id)}.files 包含无效路径或覆盖执行计划`);
      if (!isStringArray(item.steps) || item.steps.some((step) => !step.trim())) errors.push(`${String(item.id)}.steps 包含空步骤`);
      if (!isStringArray(item.behaviorAcceptance) || item.behaviorAcceptance.some((criterion) => !criterion.trim())) errors.push(`${String(item.id)}.behaviorAcceptance 包含空标准`);
      if (item.status === "ready" && !validAcceptanceCommand(item.acceptanceCommand)) errors.push(`${String(item.id)}: ready 任务缺少安全的结构化验收命令`);
      if (item.status !== "ready" && item.acceptanceCommand !== null && !validAcceptanceCommand(item.acceptanceCommand)) errors.push(`${String(item.id)}: 非 ready 任务的验收命令必须为 null 或合法命令`);
      if (!isStringArray(item.dependsOn)) errors.push(`${String(item.id)}.dependsOn 必须是字符串数组`);
      if (typeof item.risk !== "string" || !item.risk.trim()) errors.push(`${String(item.id)}.risk 缺失`);
      if (!isStringArray(item.riskMitigation) || item.riskMitigation.some((mitigation) => !mitigation.trim())) errors.push(`${String(item.id)}.riskMitigation 必须是非空字符串数组`);
      if (typeof item.rationale !== "string" || !item.rationale.trim()) errors.push(`${String(item.id)}.rationale 缺失`);
      if (!["ready", "needs-info", "do-not-fix"].includes(String(item.status))) errors.push(`${String(item.id)}.status 未知`);
      if (item.status === "ready") {
        if (!isStringArray(item.requirementIds) || item.requirementIds.length === 0) errors.push(`${String(item.id)}: ready 任务缺少 requirementIds`);
        if (!isStringArray(item.files) || item.files.length === 0 || item.files.some((path) => !validRepoPath(path))) errors.push(`${String(item.id)}: ready 任务的 files 为空或路径不安全`);
        if (!isStringArray(item.steps) || item.steps.length === 0 || item.steps.some((step) => !step.trim())) errors.push(`${String(item.id)}: ready 任务必须有具体步骤`);
        if (!isStringArray(item.behaviorAcceptance) || item.behaviorAcceptance.length === 0 || item.behaviorAcceptance.some((criterion) => !criterion.trim())) errors.push(`${String(item.id)}: ready 任务缺少行为验收标准`);
        if (!isStringArray(item.riskMitigation) || item.riskMitigation.length === 0 || item.riskMitigation.some((mitigation) => !mitigation.trim())) errors.push(`${String(item.id)}: ready 任务缺少风险缓解措施`);
      }
    });
  }

  const taskById = new Map<string, Record<string, unknown>>();
  for (const task of Array.isArray(value.tasks) ? value.tasks : []) {
    if (isRecord(task) && typeof task.id === "string") taskById.set(task.id, task);
  }
  for (const task of Array.isArray(value.tasks) ? value.tasks : []) {
    if (!isRecord(task) || typeof task.id !== "string" || !isStringArray(task.dependsOn)) continue;
    for (const dependencyId of task.dependsOn) {
      const dependency = taskById.get(dependencyId);
      if (!dependency) errors.push(`${task.id}: 依赖 ${dependencyId} 不存在`);
      else if (task.status === "ready" && dependency.status !== "ready") errors.push(`${task.id}: 依赖 ${dependencyId} 不是 ready`);
    }
  }
  const orderedTaskIds = new Set<string>();
  const allTasks = Array.isArray(value.tasks) ? value.tasks : [];
  while (orderedTaskIds.size < allTasks.length) {
    const next = allTasks.find((task) =>
      isRecord(task) &&
      typeof task.id === "string" &&
      !orderedTaskIds.has(task.id) &&
      isStringArray(task.dependsOn) &&
      task.dependsOn.every((dependencyId) => orderedTaskIds.has(dependencyId)),
    );
    if (!isRecord(next) || typeof next.id !== "string") {
      errors.push("任务依赖存在环或引用无效，无法生成拓扑顺序");
      break;
    }
    orderedTaskIds.add(next.id);
  }

  if (!Array.isArray(value.openQuestions)) {
    errors.push("plan.openQuestions 必须是数组");
  } else {
    const questionIds = new Set<string>();
    value.openQuestions.forEach((item, index) => {
      if (!isRecord(item) || !exactKeys(item, ["id", "question", "blocking", "relatedTaskIds"])) {
        errors.push(`openQuestions[${index}] 字段不合法`);
        return;
      }
      if (typeof item.id !== "string" || !item.id.trim()) errors.push(`openQuestions[${index}].id 缺失`);
      else if (questionIds.has(item.id)) errors.push(`问题 id 重复：${item.id}`);
      else questionIds.add(item.id);
      if (typeof item.question !== "string" || !item.question.trim()) errors.push(`openQuestions[${index}].question 缺失`);
      if (typeof item.blocking !== "boolean") errors.push(`openQuestions[${index}].blocking 必须为 boolean`);
      if (!isStringArray(item.relatedTaskIds)) errors.push(`openQuestions[${index}].relatedTaskIds 必须是字符串数组`);
    });
  }
  return errors.length === initialErrorCount;
}

function parseContract(content: string): { contract: ExecutionContract | null; errors: string[] } {
  const errors: string[] = [];
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker);
  if (start < 0 || end < 0 || end <= start || content.indexOf(startMarker, start + startMarker.length) >= 0 || content.indexOf(endMarker, end + endMarker.length) >= 0) {
    return { contract: null, errors: ["未找到唯一且完整的执行合同标记"] };
  }
  const json = content.slice(start + startMarker.length, end).trim();
  let raw: unknown;
  try {
    raw = JSON.parse(json) as unknown;
  } catch (error) {
    return { contract: null, errors: [`执行合同 JSON 无法解析：${String(error)}`] };
  }
  if (!isRecord(raw) || !exactKeys(raw, ["contractVersion", "approved", "review", "reviewedPlanSnapshot", "resolutions", "plan"])) {
    return { contract: null, errors: ["执行合同根字段不符合 schema"] };
  }
  if (raw.contractVersion !== 1) errors.push(`不支持的执行合同版本：${String(raw.contractVersion)}`);
  if (raw.approved !== true) errors.push("计划尚未由用户显式批准：请在合同中将 approved 设为 true");
  if (!isRecord(raw.review) || !exactKeys(raw.review, ["verdict", "summary"])) {
    errors.push("合同缺少独立评审结果");
  } else {
    if (raw.review.verdict !== "approve") errors.push(`独立评审不是 approve：${String(raw.review.verdict)}`);
    if (typeof raw.review.summary !== "string" || !raw.review.summary.trim()) errors.push("独立评审摘要缺失");
  }
  if (typeof raw.reviewedPlanSnapshot !== "string") errors.push("reviewedPlanSnapshot 缺失");
  if (!Array.isArray(raw.resolutions)) {
    errors.push("合同 resolutions 必须是数组");
  } else {
    raw.resolutions.forEach((item, index) => {
      if (!isRecord(item) || !exactKeys(item, ["questionId", "decision"]) || typeof item.questionId !== "string" || !item.questionId.trim() || typeof item.decision !== "string" || !item.decision.trim()) {
        errors.push(`resolutions[${index}] 必须包含 questionId 和非空 decision`);
      }
    });
  }

  const planIsValid = validatePlanShape(raw.plan, errors);
  if (planIsValid && typeof raw.reviewedPlanSnapshot === "string" && stableJson(raw.plan) !== raw.reviewedPlanSnapshot) {
    errors.push("计划内容与独立评审时的快照不同；请重新运行 task-plan 生成并评审合同");
  }
  if (planIsValid && Array.isArray(raw.resolutions) && isRecord(raw.plan)) {
    const plan = raw.plan as unknown as RunPlan;
    const knownQuestions = new Set(plan.openQuestions.map((question) => question.id));
    const resolutions = raw.resolutions as { questionId: string; decision: string }[];
    const resolved = new Set<string>();
    for (const resolution of resolutions) {
      if (!isRecord(resolution)) continue;
      if (!knownQuestions.has(String(resolution.questionId))) errors.push(`resolution 指向未知问题：${String(resolution.questionId)}`);
      if (resolved.has(String(resolution.questionId))) errors.push(`问题重复回答：${String(resolution.questionId)}`);
      resolved.add(String(resolution.questionId));
    }
    const unresolved = plan.openQuestions.filter((question) => question.blocking && !resolved.has(question.id));
    if (unresolved.length) errors.push(`存在未解决的阻塞问题：${unresolved.map((question) => question.id).join("、")}`);
    for (const question of plan.openQuestions) {
      if (!question.blocking || resolved.has(question.id)) continue;
      if (question.relatedTaskIds.length) {
        for (const taskId of question.relatedTaskIds) {
          const task = plan.tasks.find((candidate) => candidate.id === taskId);
          if (task?.status === "ready") errors.push(`${question.id}: 未解决的阻塞问题仍关联 ready 任务 ${taskId}`);
        }
      } else {
        const readyTask = plan.tasks.find((task) => task.status === "ready");
        if (readyTask) errors.push(`${question.id}: 全局阻塞问题仍关联 ready 任务 ${readyTask.id}`);
      }
    }

    const tasksById = new Map(plan.tasks.map((task) => [task.id, task]));
    const referencedRequirementIds = new Set<string>();
    for (const task of plan.tasks) {
      for (const requirementId of task.requirementIds) {
        if (!plan.requirements.some((requirement) => requirement.id === requirementId)) errors.push(`${task.id}: 关联了未知需求 ${requirementId}`);
        else referencedRequirementIds.add(requirementId);
      }
      for (const questionId of task.dependsOn) {
        if (!tasksById.has(questionId)) errors.push(`${task.id}: 依赖 ${questionId} 不存在`);
      }
      if (task.status === "ready" && withinScope(planPath, task.files)) errors.push(`${task.id}: files 范围覆盖 plan.md，禁止任务修改执行合同`);
    }
    for (const requirement of plan.requirements) {
      if (!referencedRequirementIds.has(requirement.id)) errors.push(`需求 ${requirement.id} 没有关联任何任务，必须说明为 needs-info 或 do-not-fix`);
    }
    for (const question of plan.openQuestions) {
      for (const taskId of question.relatedTaskIds) {
        if (!tasksById.has(taskId)) errors.push(`${question.id}: 关联任务 ${taskId} 不存在`);
      }
    }

    const done = new Set<string>();
    while (done.size < plan.tasks.length) {
      const next = plan.tasks.find((task) => !done.has(task.id) && task.dependsOn.every((dependency) => done.has(dependency)));
      if (!next) {
        errors.push(`任务依赖存在环：${plan.tasks.filter((task) => !done.has(task.id)).map((task) => task.id).join("、")}`);
        break;
      }
      done.add(next.id);
    }
  }

  return { contract: errors.length ? null : (raw as unknown as ExecutionContract), errors };
}

async function captureSnapshot(scopes: string[]): Promise<FileSnapshot | null> {
  try {
    const changedPaths = await git.changedFiles();
    const ignored = await world.run("git", ["ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--", ...scopes]);
    if (ignored.exitCode !== 0) return null;
    const ignoredPaths = ignored.stdout.split("\0").filter(Boolean);
    const paths = [...new Set([...changedPaths, ...ignoredPaths])].sort();
    const content: Record<string, string> = {};
    for (const path of paths) {
      const hash = await world.run("git", ["hash-object", "--", path]);
      if (hash.exitCode === 0) {
        content[path] = hash.stdout.trim();
      } else {
        const diff = await git.diff("HEAD", path);
        if (!diff) return null;
        content[path] = `deleted:${diff}`;
      }
    }
    return { paths, content };
  } catch {
    return null;
  }
}

function changedBetween(before: FileSnapshot, after: FileSnapshot): string[] {
  const paths = new Set([...before.paths, ...after.paths]);
  return [...paths].filter((path) => before.content[path] !== after.content[path]).sort();
}

function cleanExceptPlan(status: GitStatus, path: string): string[] {
  const changed = new Set([...status.staged, ...status.unstaged, ...status.untracked]);
  return [...changed].filter((item) => item !== path).sort();
}

function commandLabel(command: AcceptanceCommand | null): string {
  return command ? [command.program, ...command.args].join(" ") : "（无）";
}

async function runAcceptance(command: AcceptanceCommand | null): Promise<CommandOutcome> {
  if (!command) return { exitCode: 126, stdout: "", stderr: "ready 任务缺少验收命令" };
  try {
    switch (command.program) {
      case "npm":
        return await world.run("npm", command.args, { timeoutMs: 1_800_000 });
      case "pnpm":
        return await world.run("pnpm", command.args, { timeoutMs: 1_800_000 });
      case "yarn":
        return await world.run("yarn", command.args, { timeoutMs: 1_800_000 });
      case "go":
        return await world.run("go", command.args, { timeoutMs: 1_800_000 });
      case "cargo":
        return await world.run("cargo", command.args, { timeoutMs: 1_800_000 });
      case "pytest":
        return await world.run("pytest", command.args, { timeoutMs: 1_800_000 });
      case "mvn":
        return await world.run("mvn", command.args, { timeoutMs: 1_800_000 });
      case "gradlew":
        return await world.run("./gradlew", command.args, { timeoutMs: 1_800_000 });
      case "gradlew.bat":
        return await world.run("gradlew.bat", command.args, { timeoutMs: 1_800_000 });
      case "gradle":
        return await world.run("gradle", command.args, { timeoutMs: 1_800_000 });
      case "make":
        return await world.run("make", command.args, { timeoutMs: 1_800_000 });
      case "dotnet":
        return await world.run("dotnet", command.args, { timeoutMs: 1_800_000 });
      default:
        return { exitCode: 126, stdout: "", stderr: `未允许的验收程序：${command.program}` };
    }
  } catch (error) {
    return { exitCode: 124, stdout: "", stderr: `验收命令启动失败或超时：${String(error)}` };
  }
}

function emptyReport(conclusion: string, validationErrors: string[], baseline: string, notCovered: string[] = []): RunReport {
  return {
    conclusion,
    planPath,
    batches: [],
    completed: 0,
    failed: 0,
    skipped: 0,
    filesChanged: [],
    baseline,
    finalStatus: baseline,
    deviations: [],
    notCovered: ["整个计划未执行", ...notCovered],
    validationErrors,
  };
}

function reportMarkdown(report: RunReport, planTitle: string): string {
  const lines: string[] = [
    `# 执行报告：${planTitle || report.planPath}`,
    "",
    report.conclusion,
    "",
    "> 验收程序通过非 shell argv 调用；Git 变更全仓库检查，ignored 文件检查覆盖合同内所有任务范围；项目自身的测试脚本/build 脚本仍以当前用户权限执行，这不是操作系统沙箱。行为验收标准仍需结合结果人工确认。",
    "",
    "## 批次结果",
    "",
  ];
  if (report.batches.length === 0) lines.push("- 无", "");
  for (const batch of report.batches) {
    lines.push(`### ${batch.taskId} ${batch.title}`);
    lines.push(`- 状态：${batch.status}`);
    lines.push(`- 行为验收：${batch.behaviorAcceptance.join("；") || "无"}`);
    lines.push(`- 自动化验收：\`${batch.acceptanceCommand || "（无）"}\``);
    lines.push(`- 退出码：${batch.exitCode}`);
    lines.push(`- 范围检查：${batch.scopeVerified ? "通过" : "未通过或未能验证"}`);
    if (batch.filesChanged.length) lines.push(`- 改动文件：${batch.filesChanged.join("、")}`);
    if (batch.notes) lines.push(`- 说明：${batch.notes}`);
    if (batch.status === "failed" && batch.stdout) {
      lines.push("- stdout：", "~~~text", batch.stdout.slice(0, 2000), "~~~");
    }
    if (batch.status === "failed" && batch.stderr) {
      lines.push("- stderr：", "~~~text", batch.stderr.slice(0, 2000), "~~~");
    }
    lines.push("");
  }
  if (report.deviations.length) lines.push("## 偏离计划", "", ...report.deviations.map((item) => `- ${item}`), "");
  if (report.notCovered.length) lines.push("## 未覆盖", "", ...report.notCovered.map((item) => `- ${item}`), "");
  if (report.validationErrors.length) lines.push("## 计划校验错误", "", ...report.validationErrors.map((item) => `- ${item}`), "");
  return lines.join("\n");
}

async function publishEarlyReport(report: RunReport): Promise<void> {
  try {
    await artifact.markdown("run-report", reportMarkdown(report, planPath), {
      title: "计划校验失败",
      primary: true,
    });
  } catch {
    // The return carries the validation result when publishing is unavailable.
  }
}

phase("核对执行合同和 Git 基线");
let planContent = "";
try {
  planContent = await files.read(planPath);
} catch {
  planContent = "";
}
const parsed = planContent.trim() ? parseContract(planContent) : { contract: null, errors: [`${planPath} 不存在、不可读或为空`] };
const gitProbe = await world.run("git", ["rev-parse", "--show-toplevel"]);
const gitStatus = await git.status().catch(() => null);
const validationErrors = parsed.errors.slice();
if (gitProbe.exitCode !== 0 || !gitStatus) validationErrors.push("Git 不可用：为避免误报范围检查成功，拒绝执行");
if (gitStatus?.staged.length) validationErrors.push(`暂存区必须为空，避免将已有暂存改动与任务改动混淆：${gitStatus.staged.join("、")}`);
const unexpectedBaseline = gitStatus ? cleanExceptPlan(gitStatus, planPath) : [];
if (unexpectedBaseline.length) validationErrors.push(`执行前工作树必须干净（plan.md 除外）；发现其他改动：${unexpectedBaseline.join("、")}`);
const snapshotScopes = parsed.contract ? [...new Set(parsed.contract.plan.tasks.flatMap((task) => task.files))] : [];
const baselineSnapshot = parsed.contract && gitStatus ? await captureSnapshot(snapshotScopes) : null;
if (parsed.contract && gitStatus && !baselineSnapshot) validationErrors.push("无法读取 Git 变更文件内容快照，拒绝执行");

if (validationErrors.length || !parsed.contract || !baselineSnapshot) {
  const baselineText = unexpectedBaseline.length ? unexpectedBaseline.join("\n") : gitStatus ? "（除计划文件外干净）" : "（Git 不可用）";
  const report = emptyReport(`plan.md 未通过执行前校验，未调用任何修复员：${validationErrors.join("；")}`, validationErrors, baselineText);
  await publishEarlyReport(report);
  return report;
}

const contract = parsed.contract;
const plan = contract.plan;
const planTitle = plan.title;
const readyTasks = plan.tasks.filter((task) => task.status === "ready");
const pendingTasks = plan.tasks.filter((task) => task.status !== "ready");
const orderedTasks: RunTask[] = [];
const completedIds = new Set<string>();
while (orderedTasks.length < readyTasks.length) {
  const next = readyTasks.find((task) => !completedIds.has(task.id) && task.dependsOn.every((dependency) => completedIds.has(dependency)));
  if (!next) break;
  orderedTasks.push(next);
  completedIds.add(next.id);
}

artifact.board("batches", {
  title: "修复批次进度",
  key: "taskId",
  status: "status",
  columns: ["pending", "running", "completed", "failed", "skipped"],
  cardTitle: "title",
  detail: [
    { field: "acceptanceCommand", label: "自动化验收" },
    { field: "exitCode", label: "退出码" },
  ],
});

phase("按批准方案分批施工并验收");
for (const task of plan.tasks) {
  if (task.status !== "ready") continue;
  report({ taskId: task.id, title: task.title, status: "pending", acceptanceCommand: commandLabel(task.acceptanceCommand), exitCode: 0 }, "batches");
}

const results: BatchResult[] = [];
const deviations: string[] = [];
const notCovered: string[] = [];
const outcomeById = new Map<string, "completed" | "failed" | "skipped">();
for (const task of pendingTasks) {
  outcomeById.set(task.id, "skipped");
  notCovered.push(`${task.id}: ${task.status}（${task.title}）`);
}

for (const task of orderedTasks) {
  const failedDependencies = task.dependsOn.filter((dependency) => outcomeById.get(dependency) !== "completed");
  if (failedDependencies.length) {
    const skipped: BatchResult = {
      taskId: task.id,
      title: task.title,
      status: "skipped",
      filesChanged: [],
      behaviorAcceptance: task.behaviorAcceptance,
      acceptanceCommand: commandLabel(task.acceptanceCommand),
      exitCode: 0,
      stdout: "",
      stderr: "",
      scopeVerified: false,
      notes: `依赖未成功：${failedDependencies.join("、")}`,
    };
    results.push(skipped);
    outcomeById.set(task.id, "skipped");
    report({ ...skipped }, "batches");
    notCovered.push(`${task.id}: 依赖未成功，已跳过`);
    continue;
  }

  report({ taskId: task.id, title: task.title, status: "running", acceptanceCommand: commandLabel(task.acceptanceCommand), exitCode: 0 }, "batches");
  const beforeSnapshot = await captureSnapshot(snapshotScopes);
  if (!beforeSnapshot) {
    const failed: BatchResult = {
      taskId: task.id,
      title: task.title,
      status: "failed",
      filesChanged: [],
      behaviorAcceptance: task.behaviorAcceptance,
      acceptanceCommand: commandLabel(task.acceptanceCommand),
      exitCode: 1,
      stdout: "",
      stderr: "Git 快照读取失败；未调用修复员或验收命令",
      scopeVerified: false,
      notes: "范围检查无法验证，任务失败关闭",
    };
    results.push(failed);
    outcomeById.set(task.id, "failed");
    report({ ...failed }, "batches");
    deviations.push(`${task.id}: ${failed.notes}`);
    if (stopOnFailure) break;
    continue;
  }

  const fixer = agent(`修复员·${task.id}`, {
    system: "你是按批准实施方案执行的工程师。只做当前任务，不重规划、不做无关重构；若步骤无法按原文完成或需要扩大范围，停止并报告 blocked，不得猜测或绕过。",
  });
  const relatedDecisions = plan.technicalDecisions.filter((decision) =>
    task.steps.some((step) => step.toLowerCase().includes(decision.area.toLowerCase())) || task.rationale.toLowerCase().includes(decision.area.toLowerCase()),
  );
  const fixPrompt =
    `计划文件：${planPath}\n任务：${task.id} ${task.title}\n` +
    `关联需求：${task.requirementIds.join("、")}\n` +
    `需求和行为验收：\n${task.behaviorAcceptance.map((item) => `- ${item}`).join("\n")}\n` +
    `允许修改的文件/目录：${task.files.join("、")}\n` +
    `做法：\n${task.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}\n` +
    `技术决策：\n${relatedDecisions.length ? JSON.stringify(relatedDecisions) : "按计划架构和仓库现有约定实现，不引入未批准的方案"}\n` +
    `风险：${task.risk}\n风险缓解：${task.riskMitigation.join("；")}\n依据：${task.rationale}\n\n` +
    `硬规则：\n` +
    `- 严格按步骤和批准的技术决策施工；不得自行缩小验收、改计划、发明需求或引入未批准依赖。\n` +
    `- 只修改列出的文件/目录；需要改其他文件时，停下来报告 blocked，不要擅自修改。\n` +
    `- 不要运行验收命令；不要提交 git；不要启动服务。\n` +
    `- 完成后输出 FixOutcome：summary、filesChanged、notes、blocked、blockReason。\n` +
    `- 输出语言：${language}。`;

  let fix: FixOutcome;
  try {
    fix = await fixer.ask<FixOutcome>(fixPrompt);
  } catch (error) {
    fix = { summary: "", filesChanged: [], notes: `修复员执行失败：${String(error)}`, blocked: true, blockReason: String(error) };
  }

  const afterFixSnapshot = await captureSnapshot(snapshotScopes);
  if (!afterFixSnapshot) {
    const failed: BatchResult = {
      taskId: task.id,
      title: task.title,
      status: "failed",
      filesChanged: [],
      behaviorAcceptance: task.behaviorAcceptance,
      acceptanceCommand: commandLabel(task.acceptanceCommand),
      exitCode: 1,
      stdout: "",
      stderr: "修复后无法读取 Git 快照；验收未运行",
      scopeVerified: false,
      notes: "范围检查无法验证，任务失败关闭；不会自动回滚",
    };
    results.push(failed);
    outcomeById.set(task.id, "failed");
    report({ ...failed }, "batches");
    deviations.push(`${task.id}: ${failed.notes}`);
    if (stopOnFailure) break;
    continue;
  }

  const updatedPaths = changedBetween(beforeSnapshot, afterFixSnapshot);
  const outsideFix = updatedPaths.filter((path) => !withinScope(path, task.files));
  if (fix.blocked || outsideFix.length) {
    const notes = [fix.summary, fix.notes, fix.blocked ? `阻塞：${fix.blockReason}` : "", outsideFix.length ? `修复员范围外改动：${outsideFix.join("、")}` : ""]
      .filter(Boolean)
      .join("；");
    const failed: BatchResult = {
      taskId: task.id,
      title: task.title,
      status: "failed",
      filesChanged: updatedPaths,
      behaviorAcceptance: task.behaviorAcceptance,
      acceptanceCommand: commandLabel(task.acceptanceCommand),
      exitCode: 1,
      stdout: "",
      stderr: notes || "修复被阻塞",
      scopeVerified: outsideFix.length === 0,
      notes: `${notes || "修复员报告阻塞"}；验收命令未运行`,
    };
    results.push(failed);
    outcomeById.set(task.id, "failed");
    report({ ...failed }, "batches");
    deviations.push(`${task.id}: ${failed.notes}`);
    if (stopOnFailure) break;
    continue;
  }

  const acceptance = await runAcceptance(task.acceptanceCommand);
  const afterAcceptanceSnapshot = await captureSnapshot(snapshotScopes);
  const acceptanceChanges = afterAcceptanceSnapshot ? changedBetween(afterFixSnapshot, afterAcceptanceSnapshot) : [];
  const outsideAcceptance = acceptanceChanges.filter((path) => !withinScope(path, task.files));
  const scopeVerified = afterAcceptanceSnapshot !== null && outsideAcceptance.length === 0;
  const succeeded = acceptance.exitCode === 0 && scopeVerified;
  const notes = [
    fix.summary,
    fix.notes,
    !afterAcceptanceSnapshot ? "验收后 Git 快照读取失败" : "",
    outsideAcceptance.length ? `验收命令造成范围外改动：${outsideAcceptance.join("、")}` : "",
  ]
    .filter(Boolean)
    .join("；");
  const changedFiles = afterAcceptanceSnapshot ? changedBetween(beforeSnapshot, afterAcceptanceSnapshot) : changedBetween(beforeSnapshot, afterFixSnapshot);
  const result: BatchResult = {
    taskId: task.id,
    title: task.title,
    status: succeeded ? "completed" : "failed",
    filesChanged: changedFiles,
    behaviorAcceptance: task.behaviorAcceptance,
    acceptanceCommand: commandLabel(task.acceptanceCommand),
    exitCode: acceptance.exitCode,
    stdout: acceptance.stdout.slice(0, 2000),
    stderr: acceptance.stderr.slice(0, 2000),
    scopeVerified,
    notes,
  };
  results.push(result);
  outcomeById.set(task.id, result.status);
  report({ ...result }, "batches");

  if (!succeeded) {
    deviations.push(`${task.id}: ${notes || `验收命令退出码 ${acceptance.exitCode}`}`);
    if (stopOnFailure) break;
  }
}

const attemptedIds = new Set(results.map((result) => result.taskId));
for (const task of orderedTasks) {
  if (attemptedIds.has(task.id)) continue;
  const skipped: BatchResult = {
    taskId: task.id,
    title: task.title,
    status: "skipped",
    filesChanged: [],
    behaviorAcceptance: task.behaviorAcceptance,
    acceptanceCommand: commandLabel(task.acceptanceCommand),
    exitCode: 0,
    stdout: "",
    stderr: "",
    scopeVerified: false,
    notes: "前序任务失败后停止",
  };
  results.push(skipped);
  outcomeById.set(task.id, "skipped");
  report({ ...skipped }, "batches");
  notCovered.push(`${task.id}: 前序任务失败后未执行`);
}

phase("汇总执行结果并记录最终状态");
const finalSnapshot = await captureSnapshot(snapshotScopes);
const completed = results.filter((result) => result.status === "completed").length;
const failed = results.filter((result) => result.status === "failed").length;
const skipped = results.filter((result) => result.status === "skipped").length;
const allChanged = finalSnapshot && baselineSnapshot ? changedBetween(baselineSnapshot, finalSnapshot) : [];
const finalStatus = !finalSnapshot
  ? "（无法读取 Git/ignored 文件快照）"
  : allChanged.length
    ? allChanged.join("\n")
    : "（无改动）";
if (!finalSnapshot) notCovered.push("最终 Git/ignored 文件快照读取失败，无法完整汇总改动");
const conclusion =
  completed + failed + skipped === 0
    ? "没有可执行的 ready 任务；未调用修复员。"
    : `处理 ${completed + failed + skipped} 个任务：${completed} 个自动验收及范围检查通过，${failed} 个失败，${skipped} 个未执行；行为验收标准需结合实际结果确认。`;

const result: RunReport = {
  conclusion,
  planPath,
  batches: results,
  completed,
  failed,
  skipped,
  filesChanged: allChanged,
  baseline: "（除批准的计划文件外，执行前工作树干净）",
  finalStatus,
  deviations,
  notCovered,
  validationErrors: [],
};
try {
  await artifact.markdown("run-report", reportMarkdown(result, planTitle), {
    title: "执行报告",
    description: conclusion,
    primary: true,
  });
} catch {
  // The return carries the report when publishing is unavailable.
}
return result;
