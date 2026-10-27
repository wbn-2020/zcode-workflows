/* zcode-workflow
description: 执行 v2 计划合同：标准/严格模式由合同决定，默认 argv 验收，shell 需 allowShell=true，confirmationToken 绑定计划/评审/决议/风险开关。
whenToUse: 当用户已有 task-plan 生成的 v2 plan.md 并准备执行时使用。默认 standard；strict 合同自动按严格流程执行；不重新规划。
args:
  planPath:
    type: string
    description: task-plan 生成的 v2 plan.md workspace 相对路径，必须是规范化 .md。
    required: true
  allowShell:
    type: boolean
    description: 可选：显式允许计划中的 shell 验收（高风险）；计划含 shell 任务时必须为 true。
    default: false
  confirmationToken:
    type: string
    description: 可选：首次运行返回的确认 token；计划/评审/决议/allowShell/reasons 变化后失效。
  stopOnFailure:
    type: boolean
    description: 可选：standard 失败后是否停止；false 只继续无依赖关系的任务。strict 合同始终 fail-fast。
    default: true
  language:
    type: string
    description: 输出语言，默认中文。
    default: 中文
*/
type PlanMode = "standard" | "strict";
type AcceptanceKind = "argv" | "shell" | "none";

interface AcceptanceCommand {
  program: string;
  args: string[];
}

interface RequirementItem {
  id: string;
  statement: string;
  acceptanceCriteria: string[];
}

interface Architecture {
  overview: string;
  boundaries: string[];
  securityPrivacy: string[];
  dataMigration: string[];
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

interface Resolution {
  questionId: string;
  decision: string;
  evidence?: string;
}

interface PlanTask {
  id: string;
  title: string;
  requirementIds: string[];
  files: string[];
  steps: string[];
  behaviorAcceptance: string[];
  acceptanceKind: AcceptanceKind;
  acceptance: string | null;
  acceptanceCommand: AcceptanceCommand | null;
  dependsOn: string[];
  risk: string;
  riskMitigation: string[];
  status: "ready" | "needs-info" | "do-not-fix";
  rationale: string;
}

interface PlanDraft {
  mode: PlanMode;
  title: string;
  summary: string;
  goal: string;
  requirements: RequirementItem[];
  architecture: Architecture | null;
  technicalDecisions: TechnicalDecision[];
  tasks: PlanTask[];
  notDoing: string[];
  openQuestions: OpenQuestion[];
  assumptions: string[];
}

interface PlanIssue {
  taskId: string;
  problem: string;
  fix: string;
  severity: "high" | "medium" | "low";
}

interface PlanReview {
  verdict: "approve" | "revise" | "reject";
  issues: PlanIssue[];
  missing: string[];
  scopeConcerns: string[];
  acceptanceConcerns: string[];
  summary: string;
}

interface ExecutionContractV2 {
  contractVersion: 2;
  mode: PlanMode;
  allowShell: boolean;
  approvalRequired: boolean;
  approved: boolean;
  review: PlanReview;
  reviewedPlanSnapshot: string;
  reviewedReviewHash: string;
  resolutions: Resolution[];
  plan: PlanDraft;
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
  acceptanceKind: AcceptanceKind;
  acceptanceCommand: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  scopeVerified: boolean;
  attempts: number;
  notes: string;
}

interface RunReport {
  conclusion: string;
  mode: PlanMode;
  allowShell: boolean;
  shellTaskIds: string[];
  requiresConfirmation: boolean;
  confirmationReasons: string[];
  confirmationToken?: string;
  overrides: string[];
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

const planPathCandidate = canonicalPath(String(args.planPath ?? "").trim());
const allowShellArg = args.allowShell === true || String(args.allowShell ?? "").toLowerCase() === "true";
const confirmationTokenArg = String(args.confirmationToken ?? "").trim();
const stopOnFailureArg = args.stopOnFailure !== false;
const language = String(args.language ?? "中文").trim();
const startMarker = "<!-- TASK_RUN_CONTRACT_START -->";
const endMarker = "<!-- TASK_RUN_CONTRACT_END -->";

if (!planPathCandidate || !planPathCandidate.toLowerCase().endsWith(".md")) {
  throw new Error("task-run: args.planPath must be a workspace-relative .md file");
}
const planPath = planPathCandidate;

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

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
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

function samePlanText(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  return normalize(left) === normalize(right);
}

function utf8Bytes(input: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < input.length) {
      const next = input.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        const point = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        bytes.push(
          0xf0 | (point >> 18),
          0x80 | ((point >> 12) & 63),
          0x80 | ((point >> 6) & 63),
          0x80 | (point & 63),
        );
        index += 1;
      } else {
        bytes.push(0xef, 0xbf, 0xbd);
      }
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    }
  }
  return bytes;
}

function rotr(value: number, shift: number): number {
  return ((value >>> shift) | (value << (32 - shift))) >>> 0;
}

function sha256Hex(input: string): string {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bytes = utf8Bytes(input);
  const bitLength = bytes.length * 8;
  const padded = bytes.slice();
  padded.push(0x80);
  while (padded.length % 64 !== 56) padded.push(0);
  const high = Math.floor(bitLength / 4294967296);
  const low = bitLength % 4294967296;
  padded.push((high >>> 24) & 255, (high >>> 16) & 255, (high >>> 8) & 255, high & 255);
  padded.push((low >>> 24) & 255, (low >>> 16) & 255, (low >>> 8) & 255, low & 255);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const schedule = new Array<number>(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const base = offset + index * 4;
      schedule[index] =
        ((padded[base] << 24) | (padded[base + 1] << 16) | (padded[base + 2] << 8) | padded[base + 3]) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = (rotr(schedule[index - 15], 7) ^ rotr(schedule[index - 15], 18) ^ (schedule[index - 15] >>> 3)) >>> 0;
      const s1 = (rotr(schedule[index - 2], 17) ^ rotr(schedule[index - 2], 19) ^ (schedule[index - 2] >>> 10)) >>> 0;
      schedule[index] = (schedule[index - 16] + s0 + schedule[index - 7] + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let index = 0; index < 64; index += 1) {
      const s1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + s1 + ch + constants[index] + schedule[index]) >>> 0;
      const s0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((value) => value.toString(16).padStart(8, "0"))
    .join("");
}

function hashLabel(value: string): string {
  return `sha256:${sha256Hex(value)}`;
}

function canonicalPath(value: string): string | null {
  const normalized = value.replace(/\\/g, "/");
  if (!normalized || normalized !== normalized.trim()) return null;
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) return null;
  let path = normalized;
  while (path.startsWith("./")) path = path.slice(2);
  if (!path || path === "." || path.endsWith("/")) return null;
  if (path.startsWith("!") || path.startsWith(":")) return null;
  const parts = path.split("/");
  if (
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.toLowerCase() === ".git" ||
        part.includes(":") ||
        /[. ]$/.test(part),
    )
  ) {
    return null;
  }
  if (
    path.split("").some((character) => {
      const code = character.charCodeAt(0);
      return code === 0 || code === 10 || code === 13 || "*?[]{}".includes(character);
    })
  ) {
    return null;
  }
  return path;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function validRepoPath(path: string): boolean {
  return canonicalPath(path) !== null;
}

function hasControlChars(value: string): boolean {
  return value.split("").some((character) => {
    const code = character.charCodeAt(0);
    return code === 0 || code === 10 || code === 13;
  });
}

function safeRelativeArgument(value: string): boolean {
  const normalized = value.replace(/\\/g, "/");
  return (
    !normalized.startsWith("/") &&
    !/^[A-Za-z]:/.test(normalized) &&
    !normalized.split("/").some((part) => part === ".." || part.split("=").some((item) => item === ".."))
  );
}

function withinScope(file: string, scopes: string[]): boolean {
  const candidate = canonicalPath(normalizePath(file));
  if (candidate === null) return false;
  return scopes.some((entry) => {
    const normalized = canonicalPath(normalizePath(entry));
    return normalized !== null && (candidate === normalized || candidate.startsWith(`${normalized}/`));
  });
}

function dangerousCommand(command: string): string {
  const patterns: { label: string; pattern: RegExp }[] = [
    { label: "rm -r/-f", pattern: /(^|[;&|]+\s*)(?:sudo\s+|doas\s+)?rm\s+(-[^\s]+\s+)*-[^\s]*[rRfF]/i },
    { label: "git reset --hard", pattern: /(^|[;&|]+\s*)(?:sudo\s+|doas\s+)?git\s+reset\s+--hard\b/i },
    { label: "git clean -f", pattern: /(^|[;&|]+\s*)(?:sudo\s+|doas\s+)?git\s+clean\s+(-[^\s]+\s+)*-[^\s]*f/i },
    {
      label: "git push --force",
      pattern: /(^|[;&|]+\s*)(?:sudo\s+|doas\s+)?git\s+push\b[^;&|]*(\s--force\b|\s-[^\s]*f\b)/i,
    },
    {
      label: "mkfs/format",
      pattern: /(^|[;&|]+\s*)(?:sudo\s+|doas\s+)?(mkfs(\.\w+)?|format)\s+/i,
    },
    { label: "dd if=", pattern: /(^|[;&|]+\s*)(?:sudo\s+|doas\s+)?dd\s+[^;&|]*\bif=/i },
    {
      label: "shutdown/reboot",
      pattern: /(^|[;&|]+\s*)(?:sudo\s+|doas\s+)?(shutdown|reboot|halt|poweroff)\b/i,
    },
    {
      label: "del /s",
      pattern: /(^|[;&|]+\s*)(?:sudo\s+|doas\s+)?(del|erase)\s+\/s\b/i,
    },
    {
      label: "rd /s",
      pattern: /(^|[;&|]+\s*)(?:sudo\s+|doas\s+)?(rd|rmdir)\s+\/s\b/i,
    },
    { label: "fork bomb", pattern: /:\(\)\s*\{\s*:\|:&\s*\};:/ },
  ];
  for (const item of patterns) {
    if (item.pattern.test(command)) return item.label;
  }
  return "";
}

function validShellCommand(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !hasControlChars(value) &&
    dangerousCommand(value) === ""
  );
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
          (safeRelativeArgument(item) && /^[A-Za-z0-9_./*]+$/.test(item) && !item.split("/").includes("..") && !item.startsWith("-")),
      );
    case "cargo":
      return commandArgs.length >= 1 && ["test", "build", "clippy"].includes(commandArgs[0]) && commandArgs.slice(1).every(
        (item) => ["--workspace", "--all-targets", "--all-features", "--locked"].includes(item),
      );
    case "pytest":
      return commandArgs.every((item) => ["-q", "-v", "--quiet", "--strict-markers"].includes(item) || (safeRelativeArgument(item) && /^[A-Za-z0-9_./:-]+$/.test(item)));
    case "mvn":
      return commandArgs.length === 1 && ["test", "verify", "package"].includes(commandArgs[0]);
    case "gradle":
    case "gradlew":
    case "gradlew.bat":
      return commandArgs.length === 1 && ["test", "check", "build"].includes(commandArgs[0]);
    case "make":
      return commandArgs.length === 1 && ["test", "check", "build", "lint"].includes(commandArgs[0]);
    case "dotnet":
      return commandArgs.length >= 1 && ["test", "build"].includes(commandArgs[0]) && commandArgs.slice(1).every((item) => safeRelativeArgument(item) && /^[A-Za-z0-9_./:=*-]+$/.test(item));
    default:
      return false;
  }
}

function validateResolutions(value: unknown, questionIds: Set<string>): string[] {
  const errors: string[] = [];
  if (!Array.isArray(value)) return ["resolutions 必须是数组"];
  const seen = new Set<string>();
  value.forEach((item, index) => {
    if (!isRecord(item) || !hasOnlyKeys(item, ["questionId", "decision", "evidence"])) {
      errors.push(`resolutions[${index}] 字段不合法`);
      return;
    }
    if (typeof item.questionId !== "string" || !item.questionId.trim()) {
      errors.push(`resolutions[${index}].questionId 缺失`);
    } else if (!questionIds.has(item.questionId)) {
      errors.push(`resolutions[${index}] 指向未知问题：${item.questionId}`);
    } else if (seen.has(item.questionId)) {
      errors.push(`问题重复回答：${item.questionId}`);
    } else {
      seen.add(item.questionId);
    }
    if (typeof item.decision !== "string" || !item.decision.trim()) errors.push(`resolutions[${index}].decision 缺失`);
    if (item.evidence !== undefined && (typeof item.evidence !== "string" || !item.evidence.trim())) {
      errors.push(`resolutions[${index}].evidence 必须是非空字符串`);
    }
  });
  return errors;
}

function validateReview(value: unknown, taskIds: Set<string>): string[] {
  const errors: string[] = [];
  if (!isRecord(value) || !exactKeys(value, ["verdict", "issues", "missing", "scopeConcerns", "acceptanceConcerns", "summary"])) {
    return ["review 字段不符合 schema"];
  }
  if (!["approve", "revise", "reject"].includes(String(value.verdict))) errors.push("review.verdict 不合法");
  if (typeof value.summary !== "string" || !value.summary.trim()) errors.push("review.summary 缺失");
  if (!Array.isArray(value.issues)) {
    errors.push("review.issues 必须是数组");
  } else {
    value.issues.forEach((item, index) => {
      if (!isRecord(item) || !exactKeys(item, ["taskId", "problem", "fix", "severity"])) {
        errors.push(`review.issues[${index}] 字段不合法`);
        return;
      }
      if (typeof item.taskId !== "string" || (!taskIds.has(item.taskId) && item.taskId !== "global")) errors.push(`review.issues[${index}].taskId 未知`);
      if (typeof item.problem !== "string" || !item.problem.trim()) errors.push(`review.issues[${index}].problem 缺失`);
      if (typeof item.fix !== "string" || !item.fix.trim()) errors.push(`review.issues[${index}].fix 缺失`);
      if (!["high", "medium", "low"].includes(String(item.severity))) errors.push(`review.issues[${index}].severity 不合法`);
    });
  }
  for (const key of ["missing", "scopeConcerns", "acceptanceConcerns"]) {
    const items = value[key];
    if (!isStringArray(items) || items.some((item) => !item.trim())) errors.push(`review.${key} 必须是非空字符串数组`);
  }
  return errors;
}

function reviewHasBlockingConcerns(review: PlanReview): boolean {
  return (
    review.issues.some((issue) => issue.severity === "high") ||
    review.missing.length > 0 ||
    review.scopeConcerns.length > 0 ||
    review.acceptanceConcerns.length > 0
  );
}

function validatePlan(
  value: unknown,
  mode: PlanMode,
  allowShell: boolean,
  resolutions: Resolution[],
  planFilePath: string,
): string[] {
  const errors: string[] = [];
  if (!isRecord(value) || !exactKeys(value, [
    "mode",
    "title",
    "summary",
    "goal",
    "requirements",
    "architecture",
    "technicalDecisions",
    "tasks",
    "notDoing",
    "openQuestions",
    "assumptions",
  ])) {
    return ["plan 字段不符合 schema"];
  }
  if (value.mode !== mode) errors.push(`plan.mode 必须为 ${mode}`);
  if (typeof value.title !== "string" || !value.title.trim()) errors.push("plan.title 缺失");
  if (typeof value.summary !== "string" || !value.summary.trim()) errors.push("plan.summary 缺失");
  if (typeof value.goal !== "string" || !value.goal.trim()) errors.push("plan.goal 缺失");
  if (!isStringArray(value.notDoing)) errors.push("plan.notDoing 必须是字符串数组");
  if (!isStringArray(value.assumptions)) errors.push("plan.assumptions 必须是字符串数组");

  const requirementIds = new Set<string>();
  if (!Array.isArray(value.requirements)) {
    errors.push("plan.requirements 必须是数组");
  } else {
    if (mode === "strict" && value.requirements.length === 0) errors.push("strict plan.requirements 不能为空");
    value.requirements.forEach((item, index) => {
      if (!isRecord(item) || !exactKeys(item, ["id", "statement", "acceptanceCriteria"])) {
        errors.push(`requirements[${index}] 字段不合法`);
        return;
      }
      if (typeof item.id !== "string" || !item.id.trim()) errors.push(`requirements[${index}].id 缺失`);
      else if (requirementIds.has(item.id)) errors.push(`需求 id 重复：${item.id}`);
      else requirementIds.add(item.id);
      if (typeof item.statement !== "string" || !item.statement.trim()) errors.push(`requirements[${index}].statement 缺失`);
      if (!isStringArray(item.acceptanceCriteria) || item.acceptanceCriteria.length === 0 || item.acceptanceCriteria.some((entry) => !entry.trim())) {
        errors.push(`requirements[${index}].acceptanceCriteria 必须是非空字符串数组`);
      }
    });
  }

  if (value.architecture === null) {
    if (mode === "strict") errors.push("strict plan.architecture 不能为空");
  } else if (!isRecord(value.architecture) || !exactKeys(value.architecture, ["overview", "boundaries", "securityPrivacy", "dataMigration"])) {
    errors.push("plan.architecture 字段不合法");
  } else {
    if (typeof value.architecture.overview !== "string" || !value.architecture.overview.trim()) errors.push("architecture.overview 缺失");
    for (const key of ["boundaries", "securityPrivacy", "dataMigration"]) {
      const items = value.architecture[key];
      if (!isStringArray(items) || items.length === 0 || items.some((entry) => !entry.trim())) {
        errors.push(`architecture.${key} 必须说明决策或明确标注不适用`);
      }
    }
  }

  if (!Array.isArray(value.technicalDecisions)) {
    errors.push("plan.technicalDecisions 必须是数组");
  } else {
    if (mode === "strict" && value.technicalDecisions.length === 0) errors.push("strict plan.technicalDecisions 不能为空");
    value.technicalDecisions.forEach((item, index) => {
      if (!isRecord(item) || !exactKeys(item, ["area", "recommendation", "evidence", "rationale", "alternatives", "tradeoffs", "risks"])) {
        errors.push(`technicalDecisions[${index}] 字段不合法`);
        return;
      }
      for (const key of ["area", "recommendation", "rationale", "tradeoffs"]) {
        if (typeof item[key] !== "string" || !item[key].trim()) errors.push(`technicalDecisions[${index}].${key} 缺失`);
      }
      for (const key of ["evidence", "alternatives", "risks"]) {
        if (!isStringArray(item[key]) || item[key].length === 0 || item[key].some((entry) => !entry.trim())) {
          errors.push(`technicalDecisions[${index}].${key} 必须说明内容或明确标注不适用`);
        }
      }
    });
  }

  const tasks = Array.isArray(value.tasks) ? value.tasks : [];
  if (tasks.length === 0) errors.push("plan.tasks 不能为空");
  const taskIds = new Set<string>();
  const taskRecords = new Map<string, Record<string, unknown>>();
  tasks.forEach((item, index) => {
    if (!isRecord(item) || !exactKeys(item, [
      "id",
      "title",
      "requirementIds",
      "files",
      "steps",
      "behaviorAcceptance",
      "acceptanceKind",
      "acceptance",
      "acceptanceCommand",
      "dependsOn",
      "risk",
      "riskMitigation",
      "status",
      "rationale",
    ])) {
      errors.push(`tasks[${index}] 字段不合法`);
      return;
    }
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id) errors.push(`tasks[${index}].id 缺失`);
    else if (taskIds.has(id)) errors.push(`任务 id 重复：${id}`);
    else {
      taskIds.add(id);
      taskRecords.set(id, item);
    }
    if (typeof item.title !== "string" || !item.title.trim()) errors.push(`tasks[${index}].title 缺失`);
    if (!isStringArray(item.requirementIds)) {
      errors.push(`tasks[${index}].requirementIds 必须是字符串数组`);
    } else {
      for (const requirementId of item.requirementIds) {
        if (!requirementIds.has(requirementId)) errors.push(`${id || `tasks[${index}]`}: 关联未知需求 ${requirementId}`);
      }
      if (item.status === "ready" && mode === "strict" && item.requirementIds.length === 0) errors.push(`${id}: strict ready 任务缺少 requirementIds`);
    }
    if (!isStringArray(item.files)) {
      errors.push(`tasks[${index}].files 必须是字符串数组`);
    } else {
      for (const file of item.files) {
        if (!validRepoPath(file) || canonicalPath(file) === planFilePath) errors.push(`${id}: files 包含无效路径或覆盖计划文件：${file}`);
      }
      if (item.status === "ready" && item.files.length === 0) errors.push(`${id}: ready 任务缺少 files`);
    }
    if (!isStringArray(item.steps) || item.steps.some((step) => !step.trim())) {
      errors.push(`tasks[${index}].steps 包含空步骤`);
    } else if (item.status === "ready" && item.steps.length === 0) {
      errors.push(`${id}: ready 任务缺少 steps`);
    }
    if (!isStringArray(item.behaviorAcceptance) || item.behaviorAcceptance.some((criterion) => !criterion.trim())) {
      errors.push(`tasks[${index}].behaviorAcceptance 包含空标准`);
    } else if (item.status === "ready" && item.behaviorAcceptance.length === 0) {
      errors.push(`${id}: ready 任务缺少 behaviorAcceptance`);
    }
    if (!isStringArray(item.dependsOn)) errors.push(`tasks[${index}].dependsOn 必须是字符串数组`);
    if (typeof item.risk !== "string") errors.push(`tasks[${index}].risk 必须是字符串`);
    else if (item.status === "ready" && !item.risk.trim()) errors.push(`${id}: ready 任务缺少 risk`);
    if (!isStringArray(item.riskMitigation) || item.riskMitigation.some((entry) => !entry.trim())) {
      errors.push(`tasks[${index}].riskMitigation 必须是字符串数组`);
    } else if (mode === "strict" && item.status === "ready" && item.riskMitigation.length === 0) {
      errors.push(`${id}: strict ready 任务缺少 riskMitigation`);
    }
    if (typeof item.rationale !== "string") errors.push(`tasks[${index}].rationale 必须是字符串`);
    else if (mode === "strict" && !item.rationale.trim()) errors.push(`${id}: strict 任务缺少 rationale`);
    if (!["ready", "needs-info", "do-not-fix"].includes(String(item.status))) errors.push(`${id}: status 未知`);

    const kind = String(item.acceptanceKind);
    const ready = item.status === "ready";
    if (!["argv", "shell", "none"].includes(kind)) {
      errors.push(`${id}: acceptanceKind 未知`);
    } else if (ready && kind === "none") {
      errors.push(`${id}: ready 任务必须有验收`);
    } else if (!ready && kind !== "none") {
      errors.push(`${id}: 非 ready 任务必须使用 acceptanceKind=none`);
    }
    if (kind === "argv") {
      if (item.acceptance !== null) errors.push(`${id}: argv 任务的 acceptance 必须为 null`);
      if (!validAcceptanceCommand(item.acceptanceCommand)) errors.push(`${id}: argv 任务验收命令不受支持`);
    } else if (kind === "shell") {
      if (mode === "strict") errors.push(`${id}: strict 任务不允许 shell 验收`);
      if (!allowShell) errors.push(`${id}: shell 验收需要 allowShell=true`);
      if (!validShellCommand(item.acceptance)) errors.push(`${id}: shell 命令为空、含控制字符或命中危险黑名单`);
      if (item.acceptanceCommand !== null) errors.push(`${id}: shell 任务的 acceptanceCommand 必须为 null`);
    } else if (kind === "none") {
      if (item.acceptance !== null || item.acceptanceCommand !== null) {
        errors.push(`${id}: none 任务不能设置验收字段`);
      }
    }
  });

  for (const [id, task] of taskRecords) {
    if (!isStringArray(task.dependsOn)) continue;
    for (const dependency of task.dependsOn) {
      const dependencyTask = taskRecords.get(dependency);
      if (!dependencyTask) errors.push(`${id}: 依赖 ${dependency} 不存在`);
      else if (task.status === "ready" && dependencyTask.status !== "ready") errors.push(`${id}: 依赖 ${dependency} 不是 ready`);
    }
  }

  for (const requirementId of requirementIds) {
    const covered = tasks.some(
      (task) => isRecord(task) && isStringArray(task.requirementIds) && task.requirementIds.includes(requirementId),
    );
    if (!covered) errors.push(`需求 ${requirementId} 没有关联任何任务`);
  }

  const ordered = new Set<string>();
  while (ordered.size < tasks.length) {
    const next = tasks.find((task) =>
      isRecord(task) &&
      typeof task.id === "string" &&
      !ordered.has(task.id) &&
      isStringArray(task.dependsOn) &&
      task.dependsOn.every((dependency) => ordered.has(dependency)),
    );
    if (!isRecord(next) || typeof next.id !== "string") {
      errors.push("任务依赖存在环或引用无效，无法生成拓扑顺序");
      break;
    }
    ordered.add(next.id);
  }

  const questionIds = new Set<string>();
  const resolutionsByQuestion = new Set(resolutions.map((item) => item.questionId));
  if (!Array.isArray(value.openQuestions)) {
    errors.push("plan.openQuestions 必须是数组");
  } else {
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
      if (!isStringArray(item.relatedTaskIds)) {
        errors.push(`openQuestions[${index}].relatedTaskIds 必须是字符串数组`);
      } else {
        for (const taskId of item.relatedTaskIds) {
          if (!taskIds.has(taskId)) errors.push(`${item.id}: 关联了未知任务 ${taskId}`);
        }
        if (item.blocking === true && !resolutionsByQuestion.has(String(item.id))) {
          const affected = item.relatedTaskIds.length
            ? item.relatedTaskIds.map((taskId) => taskRecords.get(taskId)).filter((task): task is Record<string, unknown> => task !== undefined)
            : [...taskRecords.values()];
          for (const affectedTask of affected) {
            if (affectedTask.status === "ready") {
              errors.push(`${item.id}: 未解决的阻塞问题仍关联 ready 任务 ${String(affectedTask.id)}`);
            }
          }
        }
      }
    });
  }
  errors.push(...validateResolutions(resolutions, questionIds));
  return errors;
}

function confirmationReasons(review: PlanReview): string[] {
  if (review.verdict !== "revise") return [];
  const reasons: string[] = [];
  for (const issue of review.issues) {
    if (issue.severity === "high") reasons.push(`high ${issue.taskId}: ${issue.problem}`);
  }
  for (const item of review.missing) reasons.push(`missing: ${item}`);
  for (const item of review.scopeConcerns) reasons.push(`scope: ${item}`);
  for (const item of review.acceptanceConcerns) reasons.push(`acceptance: ${item}`);
  return reasons.sort();
}

function makeConfirmationToken(
  plan: PlanDraft,
  review: PlanReview,
  resolutions: Resolution[],
  allowShell: boolean,
  reasons: string[],
): string {
  const payload = stableJson({
    v: 2,
    planHash: hashLabel(stableJson(plan)),
    reviewHash: hashLabel(stableJson(review)),
    resolutions,
    allowShell,
    reasons,
  });
  return `ct2-${sha256Hex(payload)}`;
}

function taskRequirementContext(plan: PlanDraft, task: PlanTask): string {
  const matched = plan.requirements.filter((requirement) => task.requirementIds.includes(requirement.id));
  if (matched.length) {
    return matched
      .map((requirement) => `${requirement.id}: ${requirement.statement}（验收：${requirement.acceptanceCriteria.join("；")}）`)
      .join("\n");
  }
  if (plan.requirements.length) return "当前任务未关联原子需求；以 plan.goal、plan.summary 和任务上下文为准。";
  return "未提供原子需求（standard 轻量计划）；以 plan.goal、plan.summary 和任务上下文为准。";
}

function architectureContext(plan: PlanDraft): string {
  if (!plan.architecture) {
    return "未提供架构说明（standard 轻量计划）。按 plan.goal、plan.summary、任务步骤和仓库现有模式实现；不要引入未批准的新方案。";
  }
  return [
    `架构总览：${plan.architecture.overview}`,
    `组件边界：${plan.architecture.boundaries.join("；")}`,
    `安全隐私：${plan.architecture.securityPrivacy.join("；")}`,
    `数据迁移：${plan.architecture.dataMigration.join("；")}`,
  ].join("\n");
}

function technicalDecisionContext(plan: PlanDraft): string {
  if (!plan.technicalDecisions.length) return "未提供额外技术决策；按仓库现有约定实现，不引入未批准方案。";
  return plan.technicalDecisions
    .map((decision) => `${decision.area}: ${decision.recommendation}（证据：${decision.evidence.join("；")}；取舍：${decision.tradeoffs}）`)
    .join("\n");
}

function buildFixerPrompt(
  plan: PlanDraft,
  task: PlanTask,
  resolutions: Resolution[],
  planContent: string,
): string {
  const resolutionContext = resolutions.length
    ? resolutions.map((resolution) => `${resolution.questionId}: ${resolution.decision}`).join("\n")
    : "无";
  return (
    `计划文件：${planPath}\n` +
    `模式：${plan.mode}\n` +
    `计划目标：${plan.goal}\n` +
    `计划摘要：${plan.summary}\n` +
    `任务：${task.id} ${task.title}\n` +
    `关联需求：${task.requirementIds.join("、") || "无"}\n` +
    `需求上下文：\n${taskRequirementContext(plan, task)}\n` +
    `行为验收：\n${task.behaviorAcceptance.map((item) => `- ${item}`).join("\n") || "- 无"}\n` +
    `允许修改的文件/目录：${task.files.join("、")}\n` +
    `做法：\n${task.steps.map((step, index) => `${index + 1}. ${step}`).join("\n") || "（计划未写步骤）"}\n` +
    `架构上下文：\n${architectureContext(plan)}\n` +
    `技术决策：\n${technicalDecisionContext(plan)}\n` +
    `已批准/已确认决策：\n${resolutionContext}\n` +
    `不修清单：${plan.notDoing.join("；") || "无"}\n` +
    `风险：${task.risk || "未说明"}\n` +
    `风险缓解：${task.riskMitigation.join("；") || "未说明"}\n` +
    `依据：${task.rationale || "未说明"}\n\n` +
    `硬规则：\n` +
    `- 先读取计划文件 ${planPath}，确认当前任务与合同一致；不得修改计划文件。\n` +
    `- 严格按步骤和可用上下文施工；不得自行缩小验收、改计划、发明需求或引入未批准依赖。\n` +
    `- 只修改列出的文件/目录；需要改其他文件时，停下来报告 blocked，不要擅自修改。\n` +
    `- 不要运行验收命令；不要提交 git；不要重置/切换 HEAD；不要启动服务。\n` +
    `- 完成后输出 FixOutcome：summary、filesChanged、notes、blocked、blockReason。\n` +
    `- 输出语言：${language}。`
  );
}

async function captureSnapshot(scopes: string[]): Promise<FileSnapshot | null> {
  try {
    const changedPaths = (await git.changedFiles())
      .filter((path) => canonicalPath(normalizePath(path)) !== planPath)
      .map(normalizePath);
    let ignoredPaths: string[] = [];
    if (scopes.length) {
      const ignored = await world.run("git", ["ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--", ...scopes]);
      if (ignored.exitCode !== 0) return null;
      ignoredPaths = ignored.stdout.split("\0").filter(Boolean).map(normalizePath);
    }
    const paths = [...new Set([...changedPaths, ...ignoredPaths])]
      .filter((path) => canonicalPath(path) !== planPath)
      .sort();
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

function cleanExceptPlan(status: GitStatus): string[] {
  const changed = new Set([...status.staged, ...status.unstaged, ...status.untracked]);
  return [...changed]
    .map(normalizePath)
    .filter((path) => canonicalPath(path) !== planPath)
    .sort();
}

function stagedExceptPlan(status: GitStatus): string[] {
  return status.staged.map(normalizePath).filter((path) => canonicalPath(path) !== planPath).sort();
}

function taskScopeDirty(status: GitStatus, tasks: PlanTask[]): string[] {
  const paths = [...status.staged, ...status.unstaged, ...status.untracked].map(normalizePath);
  const issues: string[] = [];
  for (const task of tasks) {
    if (task.status !== "ready") continue;
    for (const path of paths) {
      if (withinScope(path, task.files)) issues.push(`${task.id}: ${path}`);
    }
  }
  return [...new Set(issues)].sort();
}

async function readHead(): Promise<string | null> {
  try {
    const result = await world.run("git", ["rev-parse", "HEAD"]);
    return result.exitCode === 0 ? result.stdout.trim() || null : null;
  } catch {
    return null;
  }
}

async function readStashRef(): Promise<string | null> {
  try {
    const result = await world.run("git", ["stash", "list", "--format=%H"]);
    return result.exitCode === 0 ? result.stdout.trim() : null;
  } catch {
    return null;
  }
}

async function planFileUnchanged(original: string): Promise<boolean> {
  try {
    return samePlanText(await files.read(planPath), original);
  } catch {
    return false;
  }
}

async function integrityErrors(
  originalPlan: string,
  headBaseline: string,
  stashBaseline: string,
): Promise<string[]> {
  const errors: string[] = [];
  if (!(await planFileUnchanged(originalPlan))) errors.push("计划文件在运行期间被修改或删除");
  const head = await readHead();
  if (head !== headBaseline) errors.push(`Git HEAD 在运行期间发生变化（${headBaseline} -> ${head ?? "不可读"}）`);
  const stash = await readStashRef();
  if (stash !== stashBaseline) errors.push("Git stash 在运行期间发生变化");
  return errors;
}

function commandLabel(task: PlanTask): string {
  if (task.acceptanceKind === "argv" && task.acceptanceCommand) {
    return [task.acceptanceCommand.program, ...task.acceptanceCommand.args].join(" ");
  }
  if (task.acceptanceKind === "shell" && task.acceptance) return task.acceptance;
  return "（无）";
}

async function runAcceptance(command: AcceptanceCommand): Promise<CommandOutcome> {
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

async function runShell(command: string): Promise<CommandOutcome> {
  const danger = dangerousCommand(command);
  if (danger) return { exitCode: 126, stdout: "", stderr: `验收命令命中危险黑名单（${danger}）` };
  const timeoutMs = 1_800_000;
  const code = `
const { execSync } = require('child_process');
const cmd = process.argv[1];
try {
  const out = execSync(cmd, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: ${timeoutMs},
    maxBuffer: 10 * 1024 * 1024,
  });
  process.stdout.write(String(out).slice(0, 200000));
  process.exit(0);
} catch (e) {
  const out = e && e.stdout ? String(e.stdout) : '';
  const err = e && e.stderr ? String(e.stderr) : '';
  if (out) process.stdout.write(out.slice(0, 200000));
  if (err) process.stderr.write(err.slice(0, 200000));
  if (e && (e.code === 'ETIMEDOUT' || e.signal === 'SIGTERM')) process.exit(124);
  process.exit(e && typeof e.status === 'number' ? e.status : 1);
}
`;
  try {
    return await world.run("node", ["-e", code, command], { timeoutMs: timeoutMs + 10000 });
  } catch {
    try {
      return await world.run("bash", ["-lc", command], { timeoutMs });
    } catch {
      try {
        return await world.run("cmd", ["/c", command], { timeoutMs });
      } catch (error) {
        return { exitCode: 127, stdout: "", stderr: `找不到可用的 shell：${String(error)}` };
      }
    }
  }
}

function parseContract(content: string): { contract: ExecutionContractV2 | null; errors: string[] } {
  const errors: string[] = [];
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker);
  if (
    start < 0 ||
    end < 0 ||
    end <= start ||
    content.indexOf(startMarker, start + startMarker.length) >= 0 ||
    content.indexOf(endMarker, end + endMarker.length) >= 0
  ) {
    return { contract: null, errors: ["未找到唯一且完整的执行合同标记"] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(content.slice(start + startMarker.length, end).trim()) as unknown;
  } catch (error) {
    return { contract: null, errors: [`执行合同 JSON 无法解析：${String(error)}`] };
  }
  if (!isRecord(raw) || !exactKeys(raw, [
    "contractVersion",
    "mode",
    "allowShell",
    "approvalRequired",
    "approved",
    "review",
    "reviewedPlanSnapshot",
    "reviewedReviewHash",
    "resolutions",
    "plan",
  ])) {
    return { contract: null, errors: ["执行合同根字段不符合 schema"] };
  }
  if (raw.contractVersion !== 2) errors.push(`不支持的执行合同版本：${String(raw.contractVersion)}；请重新运行 task-plan`);
  const mode = raw.mode;
  if (mode !== "standard" && mode !== "strict") errors.push("合同 mode 不合法");
  if (typeof raw.allowShell !== "boolean") errors.push("合同 allowShell 必须是 boolean");
  if (mode === "strict" && raw.allowShell === true) errors.push("strict 合同不允许 allowShell=true");
  if (typeof raw.approved !== "boolean") errors.push("合同 approved 必须是 boolean");
  if (typeof raw.reviewedPlanSnapshot !== "string") errors.push("合同缺少 reviewedPlanSnapshot");
  if (typeof raw.reviewedReviewHash !== "string") errors.push("合同缺少 reviewedReviewHash");
  if (!Array.isArray(raw.resolutions)) errors.push("合同 resolutions 必须是数组");
  const resolutions = Array.isArray(raw.resolutions) ? (raw.resolutions as Resolution[]) : [];
  const plan = raw.plan as PlanDraft;
  const review = raw.review as PlanReview;
  if (mode === "standard" || mode === "strict") {
    errors.push(...validatePlan(plan, mode, raw.allowShell === true, resolutions, planPath));
  }
  const taskIds = new Set<string>();
  if (isRecord(plan) && Array.isArray(plan.tasks)) {
    for (const task of plan.tasks) {
      if (isRecord(task) && typeof task.id === "string") taskIds.add(task.id);
    }
  }
  const reviewErrors = validateReview(review, taskIds);
  errors.push(...reviewErrors);
  if (reviewErrors.length === 0 && isRecord(review)) {
    if (review.verdict === "reject") errors.push("独立评审为 reject，不能执行；请修订或重新生成计划");
    if (review.verdict === "approve" && reviewHasBlockingConcerns(review as PlanReview)) {
      errors.push("评审 verdict=approve 但仍有 high/missing/scope/acceptance 问题，合同不一致");
    }
  }
  if (isRecord(plan) && stableJson(plan) !== raw.reviewedPlanSnapshot) {
    errors.push("计划内容与 reviewedPlanSnapshot 不一致；计划被修改，请重新运行 task-plan");
  }
  if (isRecord(review) && hashLabel(stableJson(review)) !== raw.reviewedReviewHash) {
    errors.push("评审内容与 reviewedReviewHash 不一致；review 被修改，硬拒绝");
  }
  const expectedApprovalRequired = mode === "strict" && isRecord(review) && review.verdict === "approve";
  if (raw.approvalRequired !== expectedApprovalRequired) errors.push("approvalRequired 与 mode/review 不一致");
  if (raw.approved === true && raw.approvalRequired !== true) errors.push("不可执行的计划不应标记 approved=true");
  if (mode === "strict" && raw.approvalRequired === true && raw.approved !== true) {
    errors.push("strict 计划尚未由用户显式批准：请将合同 approved 改为 true");
  }
  if (mode === "strict" && raw.approvalRequired !== true) {
    errors.push("strict 计划终审未通过，不能执行；请修订或重新生成");
  }
  const contract = errors.length
    ? null
    : (raw as unknown as ExecutionContractV2);
  return { contract, errors };
}

function emptyReport(
  conclusion: string,
  validationErrors: string[],
  baseline: string,
  mode: PlanMode,
  allowShell: boolean,
  shellTaskIds: string[],
  notCovered: string[] = [],
): RunReport {
  return {
    conclusion,
    mode,
    allowShell,
    shellTaskIds,
    requiresConfirmation: false,
    confirmationReasons: [],
    confirmationToken: "",
    overrides: [],
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
  const lines = [
    `# 执行报告：${planTitle || planPath}`,
    "",
    report.conclusion,
    "",
    "> 默认验收使用非 shell argv；shell 验收需要 allowShell=true，且不是操作系统沙箱。Git 只检查当前 workspace 工作树；行为验收仍需人工确认。",
    "",
    "## 基线与最终状态",
    "",
    `- 模式：${report.mode}`,
    `- allowShell：${report.allowShell}`,
    `- shell 任务：${report.shellTaskIds.join("、") || "无"}`,
    `- 基线：${report.baseline}`,
    "- 最终状态：",
    "~~~text",
    report.finalStatus,
    "~~~",
    `- 汇总改动：${report.filesChanged.join("、") || "无"}`,
    "",
    "## 批次结果",
    "",
  ];
  if (report.batches.length === 0) lines.push("- 无", "");
  for (const batch of report.batches) {
    lines.push(`### ${batch.taskId} ${batch.title}`);
    lines.push(`- 状态：${batch.status}`);
    lines.push(`- 验收方式：${batch.acceptanceKind}`);
    lines.push(`- 自动化验收：\`${batch.acceptanceCommand || "（无）"}\``);
    lines.push(`- 退出码：${batch.exitCode}`);
    lines.push(`- 尝试次数：${batch.attempts}`);
    lines.push(`- 范围检查：${batch.scopeVerified ? "通过" : "未通过或未能验证"}`);
    lines.push(`- 行为验收：${batch.behaviorAcceptance.join("；") || "无"}`);
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
  if (report.overrides.length) {
    lines.push("## 已确认覆盖", "", ...report.overrides.map((item) => `- ${item}`), "");
  }
  if (report.deviations.length) lines.push("## 偏离计划", "", ...report.deviations.map((item) => `- ${item}`), "");
  if (report.notCovered.length) lines.push("## 未覆盖", "", ...report.notCovered.map((item) => `- ${item}`), "");
  if (report.validationErrors.length) lines.push("## 计划校验错误", "", ...report.validationErrors.map((item) => `- ${item}`), "");
  return lines.join("\n");
}

async function publishEarlyReport(report: RunReport, title: string): Promise<void> {
  try {
    await artifact.markdown("run-report", reportMarkdown(report, planPath), {
      title,
      primary: true,
    });
  } catch {
    // The return carries the validation result when publishing is unavailable.
  }
}

phase("核对执行合同");
let planContent = "";
try {
  planContent = await files.read(planPath);
} catch {
  planContent = "";
}
const parsed = planContent.trim()
  ? parseContract(planContent)
  : { contract: null, errors: [`${planPath} 不存在、不可读或为空`] };
const gitProbe = await world.run("git", ["rev-parse", "--show-toplevel"]).catch(() => null);
const gitStatus = await git.status().catch(() => null);
const initialHead = await readHead();
const initialStash = await readStashRef();
const validationErrors = parsed.errors.slice();
const modeForReport: PlanMode = parsed.contract ? parsed.contract.mode : "standard";
const allowShellForReport = parsed.contract ? parsed.contract.allowShell : allowShellArg;
const shellTaskIdsForReport = parsed.contract
  ? parsed.contract.plan.tasks.filter((task) => task.acceptanceKind === "shell").map((task) => task.id)
  : [];
if (parsed.contract && parsed.contract.mode === "strict" && allowShellArg) {
  validationErrors.push("strict 合同不允许 allowShell=true");
}
if (parsed.contract && shellTaskIdsForReport.length && !allowShellArg) {
  validationErrors.push("计划包含 shell 验收；必须显式 allowShell=true 才能执行（高风险）");
}
if (!gitProbe || gitProbe.exitCode !== 0 || !gitStatus) {
  validationErrors.push("Git 不可用：为避免误报范围检查成功，拒绝执行");
}
if (!initialHead) validationErrors.push("无法读取 Git HEAD：拒绝执行");
if (initialStash === null) validationErrors.push("无法读取 Git stash 状态：拒绝执行");

phase("检查工作树与运行基线");
const baselineStatusProbe = await world.run("git", ["status", "--porcelain", "-uall"]).catch(() => null);
if (!baselineStatusProbe || baselineStatusProbe.exitCode !== 0) {
  validationErrors.push("无法读取 Git 工作树状态，拒绝执行");
}
let baselineSnapshot: FileSnapshot | null = null;
let snapshotScopes: string[] = [];
if (parsed.contract) {
  snapshotScopes = [...new Set(parsed.contract.plan.tasks.flatMap((task) =>
    task.files.map((file) => canonicalPath(normalizePath(file))).filter((file): file is string => file !== null),
  ))];
  if (gitStatus && parsed.contract) baselineSnapshot = await captureSnapshot(snapshotScopes);
  if (!baselineSnapshot) validationErrors.push("无法读取 Git/ignored 文件内容快照，拒绝执行");
}
if (parsed.contract && gitStatus) {
  if (parsed.contract.mode === "strict") {
    const staged = stagedExceptPlan(gitStatus);
    if (staged.length) validationErrors.push(`暂存区必须为空（plan.md 除外）：${staged.join("、")}`);
    const dirty = cleanExceptPlan(gitStatus);
    if (dirty.length) validationErrors.push(`执行前工作树必须干净（plan.md 除外）：${dirty.join("、")}`);
  } else {
    const dirtyTaskFiles = taskScopeDirty(gitStatus, parsed.contract.plan.tasks);
    if (dirtyTaskFiles.length) {
      validationErrors.push(`任务文件已有未提交改动；请先 commit/stash 或调整计划：${dirtyTaskFiles.join("；")}`);
    }
  }
}

if (validationErrors.length || !parsed.contract || !baselineSnapshot || !gitStatus || !initialHead || initialStash === null) {
  const baselineText = gitStatus
    ? (parsed.contract?.mode === "strict"
        ? (cleanExceptPlan(gitStatus).length ? cleanExceptPlan(gitStatus).join("\n") : "（除计划文件外干净）")
        : "（plan.md 除外允许任务外脏；任务文件已单独校验）")
    : "（Git 不可用）";
  const report = emptyReport(
    `plan.md 未通过执行前校验，未调用任何修复员：${validationErrors.join("；")}`,
    validationErrors,
    baselineText,
    modeForReport,
    allowShellForReport,
    shellTaskIdsForReport,
  );
  await publishEarlyReport(report, "计划校验失败");
  return report;
}

const contract = parsed.contract as ExecutionContractV2;
const plan = contract.plan;
const planTitle = plan.title;
const strict = contract.mode === "strict";
const headBaseline = initialHead as string;
const stashBaseline = initialStash as string;
const baselineSnapshotValue = baselineSnapshot as FileSnapshot;
const baselineText = strict
  ? "（除计划文件外干净）"
  : "（plan.md 除外允许任务外脏；任务文件已校验干净）";

const reasons = confirmationReasons(contract.review);
let overrides: string[] = [];
if (reasons.length) {
  const token = makeConfirmationToken(plan, contract.review, contract.resolutions, contract.allowShell, reasons);
  if (!confirmationTokenArg || confirmationTokenArg !== token) {
    const report = emptyReport(
      `计划存在需要二次确认的评审问题，未执行。请确认后带 confirmationToken 重跑：${reasons.join("；")}`,
      [],
      baselineText,
      contract.mode,
      contract.allowShell,
      shellTaskIdsForReport,
      ["整个计划未执行：等待 confirmationToken"],
    );
    report.requiresConfirmation = true;
    report.confirmationReasons = reasons;
    report.confirmationToken = token;
    await publishEarlyReport(report, "需要二次确认");
    return report;
  }
  overrides = reasons;
}

phase("按计划分批施工");
const batchProbe = await world.run("git", ["status", "--porcelain", "-uall"]).catch(() => null);
if (!batchProbe || batchProbe.exitCode !== 0) {
  const report = emptyReport(
    "施工前无法读取 Git 状态，未修改源码。",
    ["无法读取 Git 状态"],
    baselineText,
    contract.mode,
    contract.allowShell,
    shellTaskIdsForReport,
    ["整个计划未执行：Git 状态不可读"],
  );
  await publishEarlyReport(report, "计划校验失败");
  return report;
}
const readyTasks = plan.tasks.filter((task) => task.status === "ready");
const pendingTasks = plan.tasks.filter((task) => task.status !== "ready");
const orderedTasks: PlanTask[] = [];
const completedIds = new Set<string>();
while (orderedTasks.length < readyTasks.length) {
  const next = readyTasks.find((task) => !completedIds.has(task.id) && task.dependsOn.every((dependency) => completedIds.has(dependency)));
  if (!next) break;
  orderedTasks.push(next);
  completedIds.add(next.id);
}

let batchBoardReady = false;
try {
  artifact.board("batches", {
    title: "修复批次进度",
    key: "taskId",
    status: "status",
    columns: ["pending", "running", "completed", "failed", "skipped"],
    cardTitle: "title",
    detail: [
      { field: "acceptanceCommand", label: "自动化验收" },
      { field: "exitCode", label: "退出码" },
      { field: "attempts", label: "尝试次数" },
    ],
  });
  batchBoardReady = true;
} catch {
  // The final report artifact still carries the batch results.
}
const publishBatch = (item: unknown): void => {
  if (batchBoardReady) report(item, "batches");
};

for (const task of plan.tasks) {
  if (task.status !== "ready") continue;
  publishBatch({
    taskId: task.id,
    title: task.title,
    status: "pending",
    acceptanceCommand: commandLabel(task),
    exitCode: 0,
    attempts: 0,
  });
}

const results: BatchResult[] = [];
const deviations: string[] = [];
const notCovered: string[] = [];
const outcomeById = new Map<string, "completed" | "failed" | "skipped">();
for (const task of pendingTasks) {
  outcomeById.set(task.id, "skipped");
  notCovered.push(`${task.id}: ${task.status}（${task.title}）`);
}
if (plan.architecture === null) notCovered.push("standard 计划未提供架构说明；执行按 goal/summary/任务上下文和仓库约定进行");
if (plan.technicalDecisions.length === 0) notCovered.push("计划未提供技术决策；执行按仓库现有约定进行");
if (shellTaskIdsForReport.length) notCovered.push(`计划包含 shell 验收（高风险）：${shellTaskIdsForReport.join("、")}`);

const failureFromIntegrity = async (
  task: PlanTask,
  filesChanged: string[],
  notes: string,
  attempts: number,
): Promise<BatchResult> => ({
  taskId: task.id,
  title: task.title,
  status: "failed",
  filesChanged,
  behaviorAcceptance: task.behaviorAcceptance,
  acceptanceKind: task.acceptanceKind,
  acceptanceCommand: commandLabel(task),
  exitCode: 1,
  stdout: "",
  stderr: notes,
  scopeVerified: false,
  attempts,
  notes,
});

for (const task of orderedTasks) {
  const failedDependencies = task.dependsOn.filter((dependency) => outcomeById.get(dependency) !== "completed");
  if (failedDependencies.length) {
    const skipped: BatchResult = {
      taskId: task.id,
      title: task.title,
      status: "skipped",
      filesChanged: [],
      behaviorAcceptance: task.behaviorAcceptance,
      acceptanceKind: task.acceptanceKind,
      acceptanceCommand: commandLabel(task),
      exitCode: 0,
      stdout: "",
      stderr: "",
      scopeVerified: false,
      attempts: 0,
      notes: `依赖未成功：${failedDependencies.join("、")}`,
    };
    results.push(skipped);
    outcomeById.set(task.id, "skipped");
    publishBatch({ ...skipped });
    notCovered.push(`${task.id}: 依赖未成功，已跳过`);
    continue;
  }

  publishBatch({
    taskId: task.id,
    title: task.title,
    status: "running",
    acceptanceCommand: commandLabel(task),
    exitCode: 0,
    attempts: 1,
  });
  const beforeSnapshot = await captureSnapshot(snapshotScopes);
  if (!beforeSnapshot) {
    const failed = await failureFromIntegrity(task, [], "Git 快照读取失败；未调用修复员或验收命令", 1);
    results.push(failed);
    outcomeById.set(task.id, "failed");
    publishBatch({ ...failed });
    deviations.push(`${task.id}: ${failed.notes}`);
    if (strict || stopOnFailureArg) break;
    continue;
  }

  const fixer = agent(`修复员·${task.id}`, {
    system: "你是按批准实施方案执行的工程师。只做当前任务，不重规划、不做无关重构；若步骤无法按原文完成或需要扩大范围，停止并报告 blocked，不得猜测或绕过。",
  });

  let fix: FixOutcome;
  try {
    fix = await fixer.ask<FixOutcome>(buildFixerPrompt(plan, task, contract.resolutions, planContent));
  } catch (error) {
    fix = {
      summary: "",
      filesChanged: [],
      notes: `修复员执行失败：${String(error)}`,
      blocked: true,
      blockReason: String(error),
    };
  }

  let afterFixSnapshot = await captureSnapshot(snapshotScopes);
  if (!afterFixSnapshot) {
    const failed = await failureFromIntegrity(task, [], "修复后无法读取 Git 快照；验收未运行", 1);
    results.push(failed);
    outcomeById.set(task.id, "failed");
    publishBatch({ ...failed });
    deviations.push(`${task.id}: ${failed.notes}`);
    if (strict || stopOnFailureArg) break;
    continue;
  }
  let updatedPaths = changedBetween(beforeSnapshot, afterFixSnapshot);
  let outsideFix = updatedPaths.filter((path) => !withinScope(path, task.files));
  let integrity = await integrityErrors(planContent, headBaseline, stashBaseline);
  if (fix.blocked || outsideFix.length || integrity.length) {
    const notes = [
      fix.summary,
      fix.notes,
      fix.blocked ? `阻塞：${fix.blockReason}` : "",
      outsideFix.length ? `修复员范围外改动：${outsideFix.join("、")}` : "",
      ...integrity,
    ].filter(Boolean).join("；");
    const failed = await failureFromIntegrity(task, updatedPaths, notes || "修复被阻塞", 1);
    failed.scopeVerified = outsideFix.length === 0 && integrity.length === 0;
    results.push(failed);
    outcomeById.set(task.id, "failed");
    publishBatch({ ...failed });
    deviations.push(`${task.id}: ${failed.notes}`);
    if (strict || stopOnFailureArg) break;
    continue;
  }

  let acceptance: CommandOutcome;
  if (task.acceptanceKind === "argv" && task.acceptanceCommand) {
    acceptance = await runAcceptance(task.acceptanceCommand);
  } else if (task.acceptanceKind === "shell" && task.acceptance) {
    acceptance = await runShell(task.acceptance);
  } else {
    acceptance = { exitCode: 126, stdout: "", stderr: "ready 任务缺少有效验收命令" };
  }

  let afterAcceptanceSnapshot = await captureSnapshot(snapshotScopes);
  let acceptanceChanges = afterAcceptanceSnapshot ? changedBetween(afterFixSnapshot, afterAcceptanceSnapshot) : [];
  let outsideAcceptance = acceptanceChanges.filter((path) => !withinScope(path, task.files));
  let acceptanceIntegrity = await integrityErrors(planContent, headBaseline, stashBaseline);
  let scopeVerified =
    afterAcceptanceSnapshot !== null &&
    outsideAcceptance.length === 0 &&
    acceptanceIntegrity.length === 0;
  let succeeded = acceptance.exitCode === 0 && scopeVerified;
  let attempts = 1;
  let finalAcceptance = acceptance;
  let finalOutside = outsideAcceptance;
  let finalIntegrity = acceptanceIntegrity;
  let finalAfterAcceptance = afterAcceptanceSnapshot;

  if (!succeeded && !strict) {
    const retryable =
      acceptance.exitCode !== 124 &&
      acceptance.exitCode !== 126 &&
      acceptance.exitCode !== 127 &&
      outsideAcceptance.length === 0 &&
      acceptanceIntegrity.length === 0;
    if (retryable) {
      attempts = 2;
      publishBatch({
        taskId: task.id,
        title: task.title,
        status: "running",
        acceptanceCommand: commandLabel(task),
        exitCode: acceptance.exitCode,
        attempts,
      });
      try {
        fix = await fixer.ask<FixOutcome>(
          `验收命令失败，请根据输出修复当前任务，仍然只改允许的文件/目录。\n` +
            `命令：${commandLabel(task)}\n退出码：${acceptance.exitCode}\nstdout：\n${acceptance.stdout.slice(0, 4000)}\nstderr：\n${acceptance.stderr.slice(0, 4000)}\n` +
            `完成后输出 FixOutcome，不要运行验收命令。输出语言：${language}。`,
        );
      } catch (error) {
        fix = {
          summary: "",
          filesChanged: [],
          notes: `修复员重试失败：${String(error)}`,
          blocked: true,
          blockReason: String(error),
        };
      }
      const retryAfterFix = await captureSnapshot(snapshotScopes);
      if (!retryAfterFix) {
        finalIntegrity = ["修复重试后无法读取 Git 快照；第二轮验收未运行"];
        finalAfterAcceptance = null;
      } else {
        updatedPaths = changedBetween(beforeSnapshot, retryAfterFix);
        outsideFix = updatedPaths.filter((path) => !withinScope(path, task.files));
        finalIntegrity = await integrityErrors(planContent, headBaseline, stashBaseline);
        if (!fix.blocked && outsideFix.length === 0 && finalIntegrity.length === 0) {
          if (task.acceptanceKind === "argv" && task.acceptanceCommand) {
            finalAcceptance = await runAcceptance(task.acceptanceCommand);
          } else if (task.acceptanceKind === "shell" && task.acceptance) {
            finalAcceptance = await runShell(task.acceptance);
          } else {
            finalAcceptance = { exitCode: 126, stdout: "", stderr: "ready 任务缺少有效验收命令" };
          }
          finalAfterAcceptance = await captureSnapshot(snapshotScopes);
          acceptanceChanges = finalAfterAcceptance ? changedBetween(retryAfterFix, finalAfterAcceptance) : [];
          finalOutside = acceptanceChanges.filter((path) => !withinScope(path, task.files));
          finalIntegrity = await integrityErrors(planContent, headBaseline, stashBaseline);
          scopeVerified = finalAfterAcceptance !== null && finalOutside.length === 0 && finalIntegrity.length === 0;
          succeeded = finalAcceptance.exitCode === 0 && scopeVerified;
        } else {
          succeeded = false;
          scopeVerified = false;
          finalOutside = outsideFix;
        }
      }
    }
  }

  const notes = [
    fix.summary,
    fix.notes,
    !finalAfterAcceptance ? "验收后 Git 快照读取失败" : "",
    finalOutside.length ? `范围外改动：${finalOutside.join("、")}` : "",
    ...finalIntegrity,
    attempts === 2 ? "首轮验收失败后自动重试一轮" : "",
    overrides.length ? `已确认覆盖：${overrides.join("；")}` : "",
  ].filter(Boolean).join("；");
  const changedFiles = finalAfterAcceptance
    ? changedBetween(beforeSnapshot, finalAfterAcceptance)
    : changedBetween(beforeSnapshot, afterFixSnapshot);
  const result: BatchResult = {
    taskId: task.id,
    title: task.title,
    status: succeeded ? "completed" : "failed",
    filesChanged: changedFiles,
    behaviorAcceptance: task.behaviorAcceptance,
    acceptanceKind: task.acceptanceKind,
    acceptanceCommand: commandLabel(task),
    exitCode: finalAcceptance.exitCode,
    stdout: finalAcceptance.stdout.slice(0, 2000),
    stderr: finalAcceptance.stderr.slice(0, 2000),
    scopeVerified,
    attempts,
    notes,
  };
  results.push(result);
  outcomeById.set(task.id, result.status);
  publishBatch({ ...result });

  if (!succeeded) {
    deviations.push(`${task.id}: ${notes || `验收命令退出码 ${finalAcceptance.exitCode}`}`);
    if (strict || stopOnFailureArg) break;
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
    acceptanceKind: task.acceptanceKind,
    acceptanceCommand: commandLabel(task),
    exitCode: 0,
    stdout: "",
    stderr: "",
    scopeVerified: false,
    attempts: 0,
    notes: "前序任务失败后停止",
  };
  results.push(skipped);
  outcomeById.set(task.id, "skipped");
  publishBatch({ ...skipped });
  notCovered.push(`${task.id}: 前序任务失败后未执行`);
}

phase("汇总执行结果");
const finalSnapshot = await captureSnapshot(snapshotScopes);
const completed = results.filter((result) => result.status === "completed").length;
const failed = results.filter((result) => result.status === "failed").length;
const skipped = results.filter((result) => result.status === "skipped").length;
const allChanged = finalSnapshot ? changedBetween(baselineSnapshotValue, finalSnapshot) : [];
const planIntact = await planFileUnchanged(planContent);
const finalHead = await readHead();
const finalStash = await readStashRef();
const headChangedAtEnd = finalHead !== headBaseline;
const stashChangedAtEnd = finalStash !== stashBaseline;
const finalStatusBase = !finalSnapshot
  ? "（无法读取 Git/ignored 文件快照）"
  : allChanged.length
    ? allChanged.join("\n")
    : "（无改动）";
const integrityNotes = [
  planIntact ? "" : "计划文件在执行期间被修改或删除",
  headChangedAtEnd ? `Git HEAD 在运行期间发生变化（${headBaseline} -> ${finalHead ?? "不可读"}）` : "",
  stashChangedAtEnd ? "Git stash 在运行期间发生变化" : "",
].filter(Boolean);
const finalStatus = integrityNotes.length ? `${finalStatusBase}\n（${integrityNotes.join("；")}）` : finalStatusBase;
if (!finalSnapshot) notCovered.push("最终 Git/ignored 文件快照读取失败，无法完整汇总改动");
if (!planIntact) {
  deviations.push("计划文件在执行期间被修改或删除；本次执行仍使用启动时读取的合同，但计划文件完整性未通过");
  notCovered.push("计划文件完整性校验失败");
}
if (headChangedAtEnd) {
  deviations.push(`Git HEAD 在运行期间发生变化：${headBaseline} -> ${finalHead ?? "不可读"}`);
  notCovered.push("Git HEAD 稳定性校验失败");
}
if (stashChangedAtEnd) {
  deviations.push("Git stash 在运行期间发生变化");
  notCovered.push("Git stash 稳定性校验失败");
}
const baseConclusion =
  completed + failed + skipped === 0
    ? "没有可执行的 ready 任务；未调用修复员。"
    : `处理 ${completed + failed + skipped} 个任务：${completed} 个自动验收及范围检查通过，${failed} 个失败，${skipped} 个未执行；行为验收标准需结合实际结果确认。`;
const conclusion = integrityNotes.length
  ? `${baseConclusion} 计划文件、Git HEAD 或 stash 完整性校验失败，结果不可视为完全成功。`
  : baseConclusion;
const result: RunReport = {
  conclusion,
  mode: contract.mode,
  allowShell: contract.allowShell,
  shellTaskIds: shellTaskIdsForReport,
  requiresConfirmation: false,
  confirmationReasons: reasons,
  confirmationToken: "",
  overrides,
  batches: results,
  completed,
  failed,
  skipped,
  filesChanged: allChanged,
  baseline: baselineText,
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
  // The return carries the report.
}
return result;
