/* zcode-workflow
description: 把需求/报告转成日常轻量或 strict 的 v2 执行计划；支持自然语言修订、独立评审、reviewedPlanSnapshot 与 reviewedReviewHash。
whenToUse: 当用户想先把需求拆成可审阅计划再执行时使用。默认 standard（argv 验收），strict 才要求完整方案与显式批准。修订模式用 changes 定向修改现有 v2 计划。
args:
  requirement:
    type: string
    description: 需求原文，或 findings/报告文件的 workspace 相对路径。创建模式必填；修订模式可省略。
  scope:
    type: string
    description: 可选：只读勘察范围，换行或逗号分隔，最多 12 项；空则让勘察员提出分片。
  planPath:
    type: string
    description: 可选：计划输出路径，默认 plan.md；必须是规范化 workspace 相对 .md。
    default: plan.md
  acceptance:
    type: string
    description: 可选：验收命令提示，换行分隔；只是候选，不是执行源。
  constraints:
    type: string
    description: 可选：共享文件、最大批次、禁止改动、必须保留的 API 等。
  language:
    type: string
    description: 输出语言，默认中文。
    default: 中文
  strict:
    type: boolean
    description: 可选：创建 strict 计划；仅创建模式生效。修订模式从现有计划推断。
    default: false
  allowShell:
    type: boolean
    description: 可选：允许计划使用 shell 验收（高风险）；仅创建模式生效，strict 下必须 false。
    default: false
  changes:
    type: string
    description: 可选：对现有 plan.md 的自然语言修改；提供时进入修订模式，不重跑勘察。
*/
type PlanMode = "standard" | "strict";
type AcceptanceKind = "argv" | "shell" | "none";

interface ReconShard {
  name: string;
  paths: string[];
  focus: string;
}

interface Recon {
  shard: string;
  summary: string;
  entryPoints: string[];
  constraints: string[];
  risks: string[];
  technologyEvidence: string[];
}

interface ShardProposal {
  shards: ReconShard[];
  summary: string;
}

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

interface PlanEditResult {
  plan: PlanDraft;
  changedTaskIds: string[];
  changeSummary: string;
  addsNewFiles: boolean;
  addsNewModules: boolean;
  addsNewDependencies: boolean;
  reconReasons: string[];
  resolutions: Resolution[];
}

interface FieldDiff {
  field: string;
  before: string;
  after: string;
}

interface TaskDiff {
  id: string;
  change: "added" | "removed" | "modified";
  fields: FieldDiff[];
}

interface PlanReport {
  conclusion: string;
  action: "create" | "revise";
  planPath: string;
  mode: PlanMode;
  allowShell: boolean;
  shellTaskIds: string[];
  plan: PlanDraft;
  review: PlanReview;
  requiresApproval: boolean;
  reviewedReviewHash: string;
  changedTaskIds: string[];
  changeSummary: string;
  diffMarkdown: string;
  reconRequired: boolean;
  reconReasons: string[];
  baseline: string;
  finalStatus: string;
  sourceUnchanged: boolean | null;
  detectedAcceptance: string[];
  reconFailures: string[];
  constraints: string;
  scope: string;
  planWriteError: string;
  planWritten: boolean;
}

const requirementArg = String(args.requirement ?? "").trim();
const scopeArg = String(args.scope ?? "").trim();
const planPathCandidate = canonicalPath(String(args.planPath ?? "plan.md").trim() || "plan.md");
const acceptanceArg = String(args.acceptance ?? "").trim();
const extraConstraints = String(args.constraints ?? "").trim();
const language = String(args.language ?? "中文").trim();
const strictRequested = args.strict === true || String(args.strict ?? "").toLowerCase() === "true";
const allowShellRequested = args.allowShell === true || String(args.allowShell ?? "").toLowerCase() === "true";
const changesArg = String(args.changes ?? "").trim();
const isRevision = changesArg.length > 0;

if (!isRevision && !requirementArg) throw new Error("task-plan: args.requirement is required in create mode");
if (!planPathCandidate || !planPathCandidate.toLowerCase().endsWith(".md")) {
  throw new Error("task-plan: args.planPath must be a workspace-relative .md file");
}
const planPath = planPathCandidate;
const startMarker = "<!-- TASK_RUN_CONTRACT_START -->";
const endMarker = "<!-- TASK_RUN_CONTRACT_END -->";
let existingPlanContent = "";
let planFileExists = false;

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

function validRepoPath(path: string): boolean {
  return canonicalPath(path) !== null;
}

function validReconPath(path: string): boolean {
  return path === "." || validRepoPath(path);
}

function pathIsPlanFile(path: string): boolean {
  const candidate = canonicalPath(path);
  return candidate !== null && candidate === planPath;
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
    if (typeof item.decision !== "string" || !item.decision.trim()) {
      errors.push(`resolutions[${index}].decision 缺失`);
    }
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
      if (typeof item.taskId !== "string" || (!taskIds.has(item.taskId) && item.taskId !== "global")) {
        errors.push(`review.issues[${index}].taskId 未知`);
      }
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

function normalizePlanReview(review: PlanReview): PlanReview {
  const summary = review.summary.trim() ? review.summary : "独立评审未提供摘要。";
  if (review.verdict === "approve" && reviewHasBlockingConcerns(review)) {
    return {
      ...review,
      verdict: "revise",
      summary: `${summary} 确定性校验发现阻塞性评审项，verdict 已降级为 revise。`,
    };
  }
  return summary === review.summary ? review : { ...review, summary };
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
        if (!validRepoPath(file) || pathIsPlanFile(file)) errors.push(`${id}: files 包含无效路径或覆盖计划文件：${file}`);
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
      else if (task.status === "ready" && dependencyTask.status !== "ready") {
        errors.push(`${id}: 依赖 ${dependency} 不是 ready`);
      }
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

function planToMarkdown(
  plan: PlanDraft,
  review: PlanReview,
  resolutions: Resolution[],
  allowShell: boolean,
  reconFailures: string[],
  constraints: string,
  scope: string,
): string {
  const approvalRequired = plan.mode === "strict" && review.verdict === "approve";
  const contract: ExecutionContractV2 = {
    contractVersion: 2,
    mode: plan.mode,
    allowShell,
    approvalRequired,
    approved: false,
    review,
    reviewedPlanSnapshot: stableJson(plan),
    reviewedReviewHash: hashLabel(stableJson(review)),
    resolutions,
    plan,
  };
  const lines: string[] = [];
  lines.push(`# 实施方案：${plan.title}`, "");
  lines.push(`> 模式：${plan.mode}${allowShell ? "（允许 shell 验收，高风险）" : ""}`);
  lines.push(`> 独立评审：${review.verdict}。${review.summary}`);
  const standardBlocked = plan.mode === "standard" && review.verdict === "reject";
  const standardNeedsConfirm = plan.mode === "standard" && review.verdict === "revise" && reviewHasBlockingConcerns(review);
  lines.push(
    `> 执行状态：${
      plan.mode === "standard"
        ? standardBlocked
          ? "不可执行：终审 reject。请用 changes 修订，或重新生成计划。"
          : standardNeedsConfirm
            ? "standard 默认模式；评审存在需确认项，task-run 执行前会返回 confirmationToken。"
            : "standard 默认模式：无需单独批准，运行确认窗口即视为批准。"
        : approvalRequired
          ? "未批准。请审阅方案后将合同中的 approved 改为 true；先解决所有阻塞问题。"
          : "不可执行：终审未通过。请用 changes 修订，或重新生成计划。"
    }`,
    "",
  );
  lines.push(plan.summary, "");
  lines.push("## 目标", "", plan.goal, "");
  lines.push("## 规划约束与范围", "");
  lines.push(`- 用户约束：${constraints || "（无）"}`);
  lines.push(`- 用户 scope：${scope || "（由勘察员按需求划分）"}`, "");
  lines.push("## 独立评审详情", "");
  lines.push(`- verdict：${review.verdict}`);
  lines.push(`- 摘要：${review.summary}`);
  if (review.issues.length) {
    review.issues.forEach((issue) =>
      lines.push(`- [${issue.severity}] ${issue.taskId}：${issue.problem}（修复：${issue.fix}）`),
    );
  }
  if (review.missing.length) review.missing.forEach((item) => lines.push(`- 缺失：${item}`));
  if (review.scopeConcerns.length) review.scopeConcerns.forEach((item) => lines.push(`- 范围疑虑：${item}`));
  if (review.acceptanceConcerns.length) review.acceptanceConcerns.forEach((item) => lines.push(`- 验收疑虑：${item}`));
  lines.push("");

  if (plan.requirements.length) {
    lines.push("## 需求拆解", "");
    for (const item of plan.requirements) {
      lines.push(`### ${item.id} ${item.statement}`);
      item.acceptanceCriteria.forEach((criterion) => lines.push(`- 验收：${criterion}`));
      lines.push("");
    }
  }

  if (plan.architecture) {
    lines.push("## 目标架构与边界", "", plan.architecture.overview, "");
    lines.push("### 组件与集成边界", "");
    plan.architecture.boundaries.forEach((item) => lines.push(`- ${item}`));
    lines.push("", "### 安全与隐私", "");
    plan.architecture.securityPrivacy.forEach((item) => lines.push(`- ${item}`));
    lines.push("", "### 数据与迁移", "");
    plan.architecture.dataMigration.forEach((item) => lines.push(`- ${item}`));
    lines.push("");
  } else {
    lines.push("## 目标架构与边界", "", "standard 模式未提供架构说明（planner 判断不必要）。", "");
  }

  if (plan.technicalDecisions.length) {
    lines.push("## 技术与设计决策", "");
    for (const decision of plan.technicalDecisions) {
      lines.push(`### ${decision.area}`, `- 选择：${decision.recommendation}`);
      lines.push(`- 仓库证据：${decision.evidence.join("；") || "未提供"}`);
      lines.push(`- 理由：${decision.rationale}`);
      lines.push(`- 替代方案：${decision.alternatives.join("；") || "未说明"}`);
      lines.push(`- 取舍：${decision.tradeoffs}`);
      lines.push(`- 风险：${decision.risks.join("；") || "未说明"}`, "");
    }
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
    if (task.behaviorAcceptance.length) task.behaviorAcceptance.forEach((criterion) => lines.push(`  - ${criterion}`));
    else lines.push("  - （未指定）");
    if (task.acceptanceKind === "argv" && task.acceptanceCommand) {
      lines.push(`- 自动化验收（argv）：\`${[task.acceptanceCommand.program, ...task.acceptanceCommand.args].join(" ")}\``);
    } else if (task.acceptanceKind === "shell" && task.acceptance) {
      lines.push(`- 自动化验收（shell，高风险）：\`${task.acceptance}\``);
    } else {
      lines.push("- 自动化验收：（不可执行）");
    }
    lines.push(`- 风险：${task.risk || "未说明"}`);
    lines.push(`- 风险缓解：${task.riskMitigation.join("；") || "未说明"}`);
    lines.push(`- 依据：${task.rationale || "未说明"}`, "");
  }

  lines.push("## 勘察缺口", "");
  if (reconFailures.length) reconFailures.forEach((item) => lines.push(`- ${item}`));
  else lines.push("- 无");
  lines.push("", "## 不修清单", "");
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
    plan.mode === "standard"
      ? "standard 计划无需单独批准；修改方案请使用 task-plan changes，不要直接改合同里的 plan。"
      : "仅修改合同 JSON 中的 approved 和 resolutions。回答阻塞问题后，如需将相关任务改为 ready，必须重新运行 task-plan changes 并复核。不要直接改 plan；内容变更会使 reviewedPlanSnapshot 失效。",
    "",
    startMarker,
    JSON.stringify(contract, null, 2),
    endMarker,
    "",
  );
  return lines.join("\n");
}

async function detectAcceptance(platform: string): Promise<string[]> {
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
        if (!scripts[script]) continue;
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
    found.push(
      platform === "win32"
        ? has("gradlew.bat")
          ? "gradlew.bat test"
          : has("gradlew")
            ? "gradlew test"
            : "gradle test"
        : has("gradlew")
          ? "gradlew test"
          : "gradle test",
    );
  }
  if (has("pyproject.toml") || has("pytest.ini") || has("tox.ini")) found.push("pytest");
  if (has("Cargo.toml")) found.push("cargo test");
  if (has("Makefile")) found.push("make test");
  return unique(found);
}

function statusPathsExcludingPlan(status: GitStatus | null): string[] | null {
  if (!status) return null;
  return unique(
    [...status.staged, ...status.unstaged, ...status.untracked].filter(
      (path) => canonicalPath(path) !== planPath,
    ),
  );
}

async function sourceSnapshot(status: GitStatus | null): Promise<Record<string, string> | null> {
  const paths = statusPathsExcludingPlan(status);
  if (paths === null) return null;
  const snapshot: Record<string, string> = {};
  try {
    for (const path of paths) {
      const hash = await world.run("git", ["hash-object", "--", path]);
      const diff = await git.diff("HEAD", path);
      if (hash.exitCode === 0) snapshot[path] = `${diff}\nworktree:${hash.stdout.trim()}`;
      else if (diff) snapshot[path] = `deleted:${diff}`;
      else return null;
    }
  } catch {
    return null;
  }
  return snapshot;
}

async function changedFilesExcludingPlan(): Promise<string[] | null> {
  try {
    const paths = await git.changedFiles();
    return paths.filter((path) => canonicalPath(path) !== planPath).sort();
  } catch {
    return null;
  }
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

function parseContract(content: string): ExecutionContractV2 {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker);
  if (
    start < 0 ||
    end < 0 ||
    end <= start ||
    content.indexOf(startMarker, start + startMarker.length) >= 0 ||
    content.indexOf(endMarker, end + endMarker.length) >= 0
  ) {
    throw new Error("未找到唯一且完整的执行合同标记");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(content.slice(start + startMarker.length, end).trim()) as unknown;
  } catch (error) {
    throw new Error(`执行合同 JSON 无法解析：${String(error)}`);
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
    throw new Error("执行合同根字段不符合 schema");
  }
  if (raw.contractVersion !== 2) throw new Error(`不支持的执行合同版本：${String(raw.contractVersion)}；请重新运行 task-plan`);
  if (raw.mode !== "standard" && raw.mode !== "strict") throw new Error("合同 mode 不合法");
  if (typeof raw.allowShell !== "boolean") throw new Error("合同 allowShell 必须是 boolean");
  if (raw.mode === "strict" && raw.allowShell) throw new Error("strict 合同不允许 allowShell=true");
  if (typeof raw.approved !== "boolean") throw new Error("合同 approved 必须是 boolean");
  if (typeof raw.reviewedPlanSnapshot !== "string" || typeof raw.reviewedReviewHash !== "string") {
    throw new Error("合同缺少 reviewedPlanSnapshot 或 reviewedReviewHash");
  }
  if (!Array.isArray(raw.resolutions)) throw new Error("合同 resolutions 必须是数组");
  const plan = raw.plan as PlanDraft;
  const review = raw.review as PlanReview;
  const resolutions = raw.resolutions as Resolution[];
  const planErrors = validatePlan(plan, raw.mode, raw.allowShell, Array.isArray(resolutions) ? resolutions : [], planPath);
  if (planErrors.length) throw new Error(`现有计划校验失败：${planErrors.join("；")}`);
  const taskIds = new Set<string>();
  if (isRecord(plan) && Array.isArray(plan.tasks)) {
    for (const task of plan.tasks) {
      if (isRecord(task) && typeof task.id === "string") taskIds.add(task.id);
    }
  }
  const reviewErrors = validateReview(review, taskIds);
  if (reviewErrors.length) throw new Error(`现有评审校验失败：${reviewErrors.join("；")}`);
  if (stableJson(plan) !== raw.reviewedPlanSnapshot) {
    throw new Error("现有计划与 reviewedPlanSnapshot 不一致；请重新生成计划");
  }
  if (hashLabel(stableJson(review)) !== raw.reviewedReviewHash) {
    throw new Error("现有评审与 reviewedReviewHash 不一致；请重新生成计划");
  }
  const expectedApprovalRequired = raw.mode === "strict" && isRecord(review) && review.verdict === "approve";
  if (raw.approvalRequired !== expectedApprovalRequired) throw new Error("合同 approvalRequired 与 mode/review 不一致");
  if (!raw.approvalRequired && raw.approved) throw new Error("不可执行的计划不应标记 approved=true");
  return raw as unknown as ExecutionContractV2;
}

function validateEvidence(resolution: Resolution, changes: string, requirement: string): string {
  const normalizedEvidence = resolution.evidence ? resolution.evidence.replace(/\s+/g, " ").trim() : "";
  if (!normalizedEvidence) return `问题 ${resolution.questionId} 的 resolution 缺少 evidence`;
  const haystack = `${changes}\n${requirement}`.replace(/\s+/g, " ").trim();
  if (!haystack.includes(normalizedEvidence)) {
    return `问题 ${resolution.questionId} 的 evidence 不是用户 changes/requirement 中的逐字内容`;
  }
  return "";
}

function taskFiles(plan: PlanDraft): string[] {
  const files: string[] = [];
  for (const task of plan.tasks) {
    for (const file of task.files) {
      const normalized = canonicalPath(file);
      if (normalized) files.push(normalized);
    }
  }
  return unique(files);
}

function diffPlans(oldPlan: PlanDraft, newPlan: PlanDraft): TaskDiff[] {
  const oldTasks = new Map(oldPlan.tasks.map((task) => [task.id, task]));
  const newTasks = new Map(newPlan.tasks.map((task) => [task.id, task]));
  const ids = unique([...oldTasks.keys(), ...newTasks.keys()]).sort();
  const diffs: TaskDiff[] = [];
  const fields: (keyof PlanTask)[] = [
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
  ];
  for (const id of ids) {
    const before = oldTasks.get(id);
    const after = newTasks.get(id);
    if (!before && after) {
      diffs.push({ id, change: "added", fields: [] });
      continue;
    }
    if (before && !after) {
      diffs.push({ id, change: "removed", fields: [] });
      continue;
    }
    if (!before || !after) continue;
    const changed: FieldDiff[] = [];
    for (const field of fields) {
      const beforeValue = stableJson(before[field]);
      const afterValue = stableJson(after[field]);
      if (beforeValue !== afterValue) {
        changed.push({ field: String(field), before: beforeValue, after: afterValue });
      }
    }
    if (changed.length) diffs.push({ id, change: "modified", fields: changed });
  }
  return diffs;
}

function diffMarkdown(diffs: TaskDiff[], changedGlobal: string[]): string {
  const lines = ["# 计划修订 diff", ""];
  if (!diffs.length && !changedGlobal.length) {
    lines.push("- 未检测到结构化变化。");
    return lines.join("\n");
  }
  if (diffs.length) {
    lines.push("## 任务变化", "");
    for (const diff of diffs) {
      if (diff.change === "added") {
        lines.push(`- 新增任务 ${diff.id}`);
      } else if (diff.change === "removed") {
        lines.push(`- 删除任务 ${diff.id}`);
      } else {
        lines.push(`- 修改任务 ${diff.id}`);
        for (const field of diff.fields) {
          lines.push(`  - ${field.field}：${field.before} → ${field.after}`);
        }
      }
    }
    lines.push("");
  }
  if (changedGlobal.length) {
    lines.push("## 全局变化", "");
    changedGlobal.forEach((item) => lines.push(`- ${item}`));
    lines.push("");
  }
  return lines.join("\n");
}

function changedGlobalFields(oldPlan: PlanDraft, newPlan: PlanDraft): string[] {
  const changed: string[] = [];
  const pairs: { name: string; before: unknown; after: unknown }[] = [
    { name: "title", before: oldPlan.title, after: newPlan.title },
    { name: "summary", before: oldPlan.summary, after: newPlan.summary },
    { name: "goal", before: oldPlan.goal, after: newPlan.goal },
    { name: "requirements", before: oldPlan.requirements, after: newPlan.requirements },
    { name: "architecture", before: oldPlan.architecture, after: newPlan.architecture },
    { name: "technicalDecisions", before: oldPlan.technicalDecisions, after: newPlan.technicalDecisions },
    { name: "notDoing", before: oldPlan.notDoing, after: newPlan.notDoing },
    { name: "openQuestions", before: oldPlan.openQuestions, after: newPlan.openQuestions },
    { name: "assumptions", before: oldPlan.assumptions, after: newPlan.assumptions },
  ];
  for (const pair of pairs) {
    if (stableJson(pair.before) !== stableJson(pair.after)) changed.push(pair.name);
  }
  return changed;
}

function addedTaskFiles(oldPlan: PlanDraft, newPlan: PlanDraft): string[] {
  const oldFiles = new Set(taskFiles(oldPlan));
  return taskFiles(newPlan).filter((file) => !oldFiles.has(file));
}

function applyReconGate(
  oldPlan: PlanDraft,
  edit: PlanEditResult,
): {
  plan: PlanDraft;
  reconRequired: boolean;
  reconReasons: string[];
  changedTaskIds: string[];
  requiresRegeneration: boolean;
} {
  const added = addedTaskFiles(oldPlan, edit.plan);
  const affected = new Set<string>();
  for (const task of edit.plan.tasks) {
    for (const file of task.files) {
      const normalized = canonicalPath(file);
      if (normalized && added.includes(normalized)) affected.add(task.id);
    }
  }
  const requiresRegeneration =
    edit.addsNewModules ||
    edit.addsNewDependencies ||
    (edit.addsNewFiles && added.length === 0);
  const reconReasons = [...edit.reconReasons];
  if (added.length) reconReasons.push(`新增未勘察文件：${added.join("、")}`);
  if (edit.addsNewModules) reconReasons.push("修订新增模块，需要重新勘察");
  if (edit.addsNewDependencies) reconReasons.push("修订新增依赖，需要重新勘察");
  if (requiresRegeneration) {
    return {
      plan: edit.plan,
      reconRequired: true,
      reconReasons,
      changedTaskIds: unique([...edit.changedTaskIds, ...affected]),
      requiresRegeneration: true,
    };
  }
  let plan = edit.plan;
  const changedTaskIds = unique([...edit.changedTaskIds, ...affected]);
  const readyAffected = new Set(
    plan.tasks.filter((task) => affected.has(task.id) && task.status === "ready").map((task) => task.id),
  );
  if (readyAffected.size > 0) {
    const questionIdBase = "Q_recon";
    const existingIds = new Set(plan.openQuestions.map((question) => question.id));
    let questionId = questionIdBase;
    let suffix = 1;
    while (existingIds.has(questionId)) {
      suffix += 1;
      questionId = `${questionIdBase}${suffix}`;
    }
    plan = {
      ...plan,
      tasks: plan.tasks.map((task) =>
        readyAffected.has(task.id) ? { ...task, status: "needs-info" } : task,
      ),
      openQuestions: [
        ...plan.openQuestions,
        {
          id: questionId,
          question: `修订新增了未勘察的文件：${added.join("、")}；请确认是否需要重新勘察或补充计划。`,
          blocking: true,
          relatedTaskIds: [...readyAffected],
        },
      ],
    };
  }
  return {
    plan,
    reconRequired: added.length > 0,
    reconReasons,
    changedTaskIds,
    requiresRegeneration: false,
  };
}

phase("确认计划基线与已有计划");
let baselineFiles: string[] | null = null;
let baselineGitStatus: GitStatus | null = null;
let baselineSourceSnapshot: Record<string, string> | null = null;
let baselineHead: string | null = null;
let baselineStash: string | null = null;
let existingContract: ExecutionContractV2 | null = null;
try {
  const matches = await files.glob(planPath);
  planFileExists = matches.some((match) => canonicalPath(match) === planPath);
} catch {
  planFileExists = false;
}
if (planFileExists) {
  try {
    existingPlanContent = await files.read(planPath);
  } catch {
    throw new Error("task-plan: planPath exists but cannot be read safely; choose another path");
  }
  if (existingPlanContent.trim()) {
    const looksLikePlan =
      existingPlanContent.includes(startMarker) &&
      existingPlanContent.includes(endMarker) &&
      existingPlanContent.includes("# 实施方案：");
    if (!looksLikePlan) {
      throw new Error("task-plan: planPath already contains a non-plan file; choose a new .md path");
    }
    if (isRevision) {
      existingContract = parseContract(existingPlanContent);
    } else if (/"approved"\s*:\s*true/.test(existingPlanContent)) {
      throw new Error("task-plan: refusing to overwrite an approved plan; use changes to revise it or choose a new path");
    }
  }
}
if (isRevision && !existingPlanContent.trim()) {
  throw new Error("task-plan: changes mode requires an existing v2 plan.md");
}
const mode: PlanMode = isRevision && existingContract ? existingContract.mode : strictRequested ? "strict" : "standard";
const allowShell = isRevision && existingContract ? existingContract.allowShell : allowShellRequested;
if (mode === "strict" && allowShell) throw new Error("task-plan: strict mode does not allow shell acceptance");

const baselineStatusRun = await world.run("git", ["status", "--porcelain", "-uall"]);
baselineGitStatus = baselineStatusRun.exitCode === 0 ? await git.status().catch(() => null) : null;
baselineFiles = await changedFilesExcludingPlan();
baselineSourceSnapshot = await sourceSnapshot(baselineGitStatus);
baselineHead = await readHead();
baselineStash = await readStashRef();
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
const detected = acceptanceArg ? unique(splitCommands(acceptanceArg)) : await detectAcceptance(platform);

let inputPath = "";
if (requirementArg && !requirementArg.includes("\n")) {
  try {
    const matches = await files.glob(requirementArg);
    if (matches.includes(requirementArg)) inputPath = requirementArg;
  } catch {
    // The requirement is plain text, not a path.
  }
}
let requirementEvidenceText = requirementArg;
if (inputPath) {
  try {
    requirementEvidenceText = await files.read(inputPath);
  } catch {
    requirementEvidenceText = requirementArg;
  }
}
const requirementBlock = inputPath
  ? `需求来源文件：${inputPath}\n请先读取该文件。`
  : requirementArg
    ? `需求原文：\n${requirementArg}`
    : "（修订模式未提供额外需求文本，请以现有计划和 changes 为准）";

let finalDraft: PlanDraft;
let finalReview: PlanReview;
let finalResolutions: Resolution[] = existingContract?.resolutions ?? [];
let reconFailures: string[] = [];
let action: "create" | "revise" = isRevision ? "revise" : "create";
let changedTaskIds: string[] = [];
let changeSummary = "";
let diffText = "";
let reconRequired = false;
let reconReasons: string[] = [];

if (isRevision && existingContract) {
  phase("按你的修改调整计划");
  const oldPlan = existingContract.plan;
  const oldReview = existingContract.review;
  const editor = agent("计划修订员", {
    system: "你是计划修订员。只按用户 changes 做最小修改，保持未受影响任务 id 和字段不变；允许读文件，不允许修改任何文件；不得自行编造用户决定。",
  });
  let edit = await editor.ask<PlanEditResult>(
    `现有模式：${oldPlan.mode}\n` +
      `现有计划：\n${JSON.stringify(oldPlan)}\n\n` +
      `用户 changes：\n${changesArg}\n\n` +
      `可选需求上下文：\n${requirementBlock}\n\n` +
      `现有 resolutions：\n${JSON.stringify(existingContract.resolutions)}\n\n` +
      `请输出 PlanEditResult。规则：\n` +
      `1. 只改用户明确要求的部分，保持未受影响任务 id 和字段不变。\n` +
      `2. 不得新增模块/依赖而不标记 addsNewModules/addsNewDependencies；不得把新增文件藏起来。\n` +
      `3. resolutions 只能来自用户 changes/需求中明确表达的决策，每项必须有逐字 evidence；不得自行编造。\n` +
      `4. 需要用户决定但 changes 未回答的，保留 blocking openQuestion，相关任务维持 needs-info。\n` +
      `5. 输出语言：${language}。`,
  );
  let planErrors = validatePlan(edit.plan, oldPlan.mode, existingContract.allowShell, edit.resolutions, planPath);
  if (planErrors.length) {
    edit = await editor.ask<PlanEditResult>(
      `PlanEditResult 未通过确定性校验。只修复列出的 schema/依赖/验收问题，保持用户要求的含义。\n错误：\n${planErrors.map((item) => `- ${item}`).join("\n")}\n\n当前结果：\n${JSON.stringify(edit)}`,
    );
    planErrors = validatePlan(edit.plan, oldPlan.mode, existingContract.allowShell, edit.resolutions, planPath);
    if (planErrors.length) throw new Error(`task-plan: 修订计划 schema 校验失败：${planErrors.join("；")}`);
  }
  const evidenceErrors = edit.resolutions
    .map((resolution) => validateEvidence(resolution, changesArg, requirementEvidenceText))
    .filter(Boolean);
  if (evidenceErrors.length) {
    edit = await editor.ask<PlanEditResult>(
      `resolutions 的 evidence 未通过校验。只修正 resolutions：每项 evidence 必须是用户 changes/需求中的逐字内容，不得编造决定。\n错误：\n${evidenceErrors.map((item) => `- ${item}`).join("\n")}\n\n当前结果：\n${JSON.stringify(edit)}`,
    );
    const retryErrors = edit.resolutions
      .map((resolution) => validateEvidence(resolution, changesArg, requirementEvidenceText))
      .filter(Boolean);
    if (retryErrors.length) throw new Error(`task-plan: resolutions evidence 校验失败：${retryErrors.join("；")}`);
  }
  const gate = applyReconGate(oldPlan, edit);
  const gateErrors = validatePlan(gate.plan, oldPlan.mode, existingContract.allowShell, edit.resolutions, planPath);
  if (gateErrors.length) throw new Error(`task-plan: 修订闸门后的计划校验失败：${gateErrors.join("；")}`);
  if (gate.requiresRegeneration) {
    finalDraft = gate.plan;
    finalReview = oldReview;
    finalResolutions = edit.resolutions;
    reconRequired = true;
    reconReasons = gate.reconReasons;
    changedTaskIds = gate.changedTaskIds;
    changeSummary = edit.changeSummary;
    diffText = diffMarkdown(diffPlans(oldPlan, finalDraft), changedGlobalFields(oldPlan, finalDraft));
    const report: PlanReport = {
      conclusion: `修订涉及新增模块或依赖，未重新勘察，不能直接执行：${gate.reconReasons.join("；")}。请重新运行 task-plan 创建模式做勘察。`,
      action: "revise",
      planPath,
      mode: finalDraft.mode,
      allowShell: existingContract.allowShell,
      shellTaskIds: finalDraft.tasks.filter((task) => task.acceptanceKind === "shell").map((task) => task.id),
      plan: finalDraft,
      review: finalReview,
      requiresApproval: false,
      reviewedReviewHash: hashLabel(stableJson(finalReview)),
      changedTaskIds,
      changeSummary,
      diffMarkdown: diffText,
      reconRequired,
      reconReasons,
      baseline,
      finalStatus: "（修订被勘察闸门阻止，未写盘）",
      sourceUnchanged: null,
      detectedAcceptance: detected,
      reconFailures: [],
      constraints: extraConstraints,
      scope: scopeArg,
      planWriteError: "新增模块或依赖需要重新勘察",
      planWritten: false,
    };
    try {
      await artifact.markdown("plan-diff", diffText, { title: "计划修订 diff", primary: true });
    } catch {
      // The return still carries the diff.
    }
    return report;
  }
  finalDraft = gate.plan;
  finalResolutions = edit.resolutions;
  reconRequired = gate.reconRequired;
  reconReasons = gate.reconReasons;
  changedTaskIds = gate.changedTaskIds;
  changeSummary = edit.changeSummary;
  diffText = diffMarkdown(diffPlans(oldPlan, finalDraft), changedGlobalFields(oldPlan, finalDraft));

  phase("增量评审修订稿");
  const reviewSystem = "你是增量计划评审员。只复核本次修订受影响的任务和全局变化，但必须自己打开相关文件核对。只读，不修改任何文件。";
  const reviewPrompt = (plan: PlanDraft) =>
    `现有模式：${plan.mode}\n\n` +
    `用户 changes：\n${changesArg}\n\n` +
    `旧计划：\n${JSON.stringify(oldPlan)}\n\n` +
    `新计划：\n${JSON.stringify(plan)}\n\n` +
    `结构化 diff：\n${diffText}\n\n` +
    `新增文件/模块/依赖标记：files=${edit.addsNewFiles} modules=${edit.addsNewModules} dependencies=${edit.addsNewDependencies}\n` +
    `勘察闸门：${reconRequired ? reconReasons.join("；") : "未触发"}\n\n` +
    `请重点检查：\n` +
    `1. 修订是否只做了用户要求的事，是否误改未受影响任务；\n` +
    `2. resolutions 是否逐字来自用户 changes，是否自行编造决定；\n` +
    `3. 新增文件/模块/依赖是否被正确标为 needs-info 或要求重新勘察；\n` +
    `4. ready 任务的文件、验收、依赖、行为验收是否仍成立；\n` +
    `5. 是否有新的 blocking question 关联 ready 任务。\n` +
    `只读，不修改文件。输出 PlanReview。输出语言：${language}。`;
  let reviewer = agent("增量评审员", { system: reviewSystem });
  finalReview = normalizePlanReview(await reviewer.ask<PlanReview>(reviewPrompt(finalDraft)));
  let reviewErrors = validateReview(finalReview, new Set(finalDraft.tasks.map((task) => task.id)));
  if (reviewErrors.length) {
    finalReview = normalizePlanReview(
      await reviewer.ask<PlanReview>(`评审对象未通过运行时校验。只修复字段/语义，不要改变判断。\n错误：\n${reviewErrors.join("\n")}\n\n当前评审：\n${JSON.stringify(finalReview)}`),
    );
    reviewErrors = validateReview(finalReview, new Set(finalDraft.tasks.map((task) => task.id)));
    if (reviewErrors.length) throw new Error(`task-plan: 增量评审校验失败：${reviewErrors.join("；")}`);
  }
  if (finalReview.verdict !== "approve") {
    phase("按增量评审意见修订计划");
    const revision = await editor.ask<PlanEditResult>(
      `根据增量评审修订计划。只改需要改的部分，保持用户 changes 的含义和未受影响任务不变。\n\n当前计划：\n${JSON.stringify(finalDraft)}\n\n评审：\n${JSON.stringify(finalReview)}\n\n仍需遵守 resolutions evidence 和新增文件/模块/依赖闸门。输出 PlanEditResult。输出语言：${language}。`,
    );
    const revisionErrors = validatePlan(revision.plan, finalDraft.mode, existingContract.allowShell, revision.resolutions, planPath);
    if (revisionErrors.length) throw new Error(`task-plan: 增量修订 schema 校验失败：${revisionErrors.join("；")}`);
    const revisionEvidenceErrors = revision.resolutions
      .map((resolution) => validateEvidence(resolution, changesArg, requirementEvidenceText))
      .filter(Boolean);
    if (revisionEvidenceErrors.length) throw new Error(`task-plan: 增量修订 resolutions evidence 校验失败：${revisionEvidenceErrors.join("；")}`);
    const revisedGate = applyReconGate(oldPlan, revision);
    const revisedGateErrors = validatePlan(revisedGate.plan, oldPlan.mode, existingContract.allowShell, revision.resolutions, planPath);
    if (revisedGateErrors.length) throw new Error(`task-plan: 修订终稿闸门校验失败：${revisedGateErrors.join("；")}`);
    if (revisedGate.requiresRegeneration) {
      const blockedDiff = diffMarkdown(diffPlans(oldPlan, revisedGate.plan), changedGlobalFields(oldPlan, revisedGate.plan));
      const blockedReport: PlanReport = {
        conclusion: `修订终稿新增模块/依赖或无法定位新增文件，未重新勘察，不能直接执行：${revisedGate.reconReasons.join("；")}。请重新运行 task-plan 创建模式做勘察。`,
        action: "revise",
        planPath,
        mode: revisedGate.plan.mode,
        allowShell: existingContract.allowShell,
        shellTaskIds: revisedGate.plan.tasks.filter((task) => task.acceptanceKind === "shell").map((task) => task.id),
        plan: revisedGate.plan,
        review: finalReview,
        requiresApproval: false,
        reviewedReviewHash: hashLabel(stableJson(finalReview)),
        changedTaskIds: revisedGate.changedTaskIds,
        changeSummary: revision.changeSummary,
        diffMarkdown: blockedDiff,
        reconRequired: true,
        reconReasons: revisedGate.reconReasons,
        baseline,
        finalStatus: "（修订被勘察闸门阻止，未写盘）",
        sourceUnchanged: null,
        detectedAcceptance: detected,
        reconFailures: [],
        constraints: extraConstraints,
        scope: scopeArg,
        planWriteError: "新增模块或依赖需要重新勘察",
        planWritten: false,
      };
      try {
        await artifact.markdown("plan-diff", blockedDiff, { title: "计划修订 diff", primary: true });
      } catch {
        // The return still carries the diff.
      }
      return blockedReport;
    }
    finalDraft = revisedGate.plan;
    finalResolutions = revision.resolutions;
    reconRequired = revisedGate.reconRequired;
    reconReasons = revisedGate.reconReasons;
    changedTaskIds = revisedGate.changedTaskIds;
    changeSummary = revision.changeSummary;
    diffText = diffMarkdown(diffPlans(oldPlan, finalDraft), changedGlobalFields(oldPlan, finalDraft));
    phase("请没看过前稿的评审员复核");
    reviewer = agent("修订终审员", { system: reviewSystem });
    finalReview = normalizePlanReview(await reviewer.ask<PlanReview>(reviewPrompt(finalDraft)));
    reviewErrors = validateReview(finalReview, new Set(finalDraft.tasks.map((task) => task.id)));
    if (reviewErrors.length) throw new Error(`task-plan: 修订终审校验失败：${reviewErrors.join("；")}`);
  }
} else {
  let shards: ReconShard[];
  const scopeLines = splitScope(scopeArg);
  if (scopeLines.length > 12) throw new Error("task-plan: args.scope must contain at most 12 entries");
  const invalidScope = scopeLines.find((path) => !validReconPath(path));
  if (invalidScope) throw new Error(`task-plan: unsafe scope path: ${invalidScope}`);
  if (scopeLines.length > 0) {
    shards = scopeLines.map((path, index) => ({
      name: `范围${index + 1}`,
      paths: [path === "." ? "." : canonicalPath(path) ?? path],
      focus: `勘察 ${path} 的现状、入口、约束和改动点`,
    }));
  } else {
    phase("勘察需求相关区域");
    const scout = agent("范围勘察员", {
      system: "你是只读代码勘察员。先看仓库结构，再提出 3-6 个互不重叠的勘察分片。不要修改任何文件。",
    });
    const proposed = await scout.ask<ShardProposal>(
      `需求：\n${requirementBlock}\n\n` +
        `请用文件工具查看仓库结构，然后提出 3-6 个勘察分片。每个分片给出 name、paths（workspace 相对路径/目录）、focus。` +
        `分片要覆盖需求涉及的主要区域，不要全仓库平均分。只读，不要修改任何文件。输出语言：${language}。`,
    );
    const selectedShards = proposed.shards.slice(0, 6);
    const invalidShardPath = selectedShards.flatMap((shard) => shard.paths).find((path) => !validReconPath(path));
    if (invalidShardPath) throw new Error(`task-plan: scout proposed an unsafe path: ${invalidShardPath}`);
    shards = selectedShards.map((shard, index) => ({
      name: `${shard.name || "分片"}·${index + 1}`,
      paths: shard.paths.length
        ? shard.paths.map((path) => (path === "." ? "." : canonicalPath(path) ?? path))
        : ["."],
      focus: shard.focus || "勘察与需求相关的现状",
    }));
    if (shards.length === 0) shards = [{ name: "全仓库·1", paths: ["."], focus: "勘察与需求相关的现状" }];
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
  reconSettled.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") recon.push(outcome.value);
    else reconFailures.push(`${shards[index].name}: ${String(outcome.reason)}`);
  });
  if (reconFailures.length > 0) log(`有 ${reconFailures.length} 个勘察分片失败，计划将基于其余分片`);
  if (recon.length === 0) throw new Error("task-plan: 所有勘察分片失败，拒绝生成缺乏证据的可执行计划");

  phase("生成计划草稿");
  const planner = agent("实施方案编排员", {
    system: "你是资深产品工程方案设计师。先理解业务目标与仓库现状，再给出有证据的目标架构、技术取舍、风险和可执行任务。只读，不修改源码；不得把未知业务规则当事实。",
  });
  const reconText = JSON.stringify(recon);
  const planPrompt =
    `需求：\n${requirementBlock}\n\n` +
    `平台：${platform}\n` +
    `模式：${mode}${allowShell ? "（允许 shell 验收，高风险）" : ""}\n` +
    `git 基线：\n${baseline || "（干净）"}\n\n` +
    `自动探测到的验收命令：\n${detected.length ? detected.join("\n") : "（未探测到，请根据仓库配置提出）"}\n\n` +
    `勘察结果：\n${reconText}\n\n` +
    `勘察失败的分片：\n${reconFailures.length ? reconFailures.join("\n") : "无"}\n\n` +
    (extraConstraints ? `用户约束：\n${extraConstraints}\n\n` : "") +
    `用户 scope：${scopeArg || "（由勘察员按需求划分）"}\n\n` +
    `请输出完整 PlanDraft（严格按接口字段）。规则：\n` +
    `1. plan.mode 必须是 ${mode}。两种模式都必须有 goal、summary、tasks；每个 ready 任务必须有 files、steps、behaviorAcceptance、risk。\n` +
    `2. standard 默认 acceptanceKind=argv，只允许白名单程序和参数；${allowShell ? "allowShell=true，可用 shell，但必须标高风险并避免危险命令。" : "allowShell=false，禁止 shell；不支持的命令标 needs-info 并写 openQuestion。"}\n` +
    `3. standard 的 requirements/architecture/technicalDecisions 可按复杂度省略；architecture=null 时在 assumptions 说明理由。strict 必须完整 requirements/architecture/technicalDecisions/riskMitigation/rationale，并覆盖所有需求。\n` +
    `4. argv 任务：acceptance=null，acceptanceCommand={program,args}；shell 任务：acceptanceCommand=null，acceptance 为 shell 字符串；非 ready 任务 acceptanceKind=none 且两个字段都为 null。\n` +
    `5. 任务要小：一个逻辑改动，尽量不超过 5 个文件；共享文件用 dependsOn 串行。新文件在 files 中明确写出。\n` +
    `6. 需要业务决定/运行时人工验证或证据不足的部分标 needs-info，并写 blocking openQuestion；明确不修的写 notDoing。\n` +
    `7. 不得无证据引入新框架/依赖；证据不足时写 openQuestion，不伪造。\n` +
    `8. 工作树可能已有未提交改动；不要回滚或格式化无关改动。\n` +
    `9. 输出语言：${language}。`;
  let draft = await planner.ask<PlanDraft>(planPrompt);
  let schemaErrors = validatePlan(draft, mode, allowShell, [], planPath);
  if (schemaErrors.length) {
    draft = await planner.ask<PlanDraft>(
      `输出的 PlanDraft 未通过确定性校验。只修复列出的 schema/依赖/验收问题，保持方案含义和任务 id。\n错误：\n${schemaErrors.map((item) => `- ${item}`).join("\n")}\n\n当前 PlanDraft：\n${JSON.stringify(draft)}`,
    );
    schemaErrors = validatePlan(draft, mode, allowShell, [], planPath);
    if (schemaErrors.length) throw new Error(`task-plan: PlanDraft schema 校验失败：${schemaErrors.join("；")}`);
  }

  phase("独立评审计划");
  const reviewSystem = "你是独立计划评审员。你没有参与编排，必须自己打开计划涉及的文件核对。只读，不修改任何文件。";
  const reviewPrompt = (plan: PlanDraft) =>
    `需求：\n${requirementBlock}\n\n` +
    `平台：${platform}\n` +
    `模式：${plan.mode}${allowShell ? "（允许 shell 验收，高风险）" : ""}\n` +
    `验收基线：\n${baseline || "（干净）"}\n` +
    `自动探测到的命令：\n${detected.length ? detected.join("\n") : "（无）"}\n\n` +
    `用户约束：\n${extraConstraints || "（无）"}\n\n` +
    `用户 scope：${scopeArg || "（由勘察员按需求划分）"}\n\n` +
    `计划：\n${JSON.stringify(plan)}\n\n` +
    `勘察：\n${reconText}\n\n` +
    `勘察失败的分片：\n${reconFailures.length ? reconFailures.join("\n") : "无"}\n\n` +
    `请打开计划涉及的文件，逐项严厉检查：\n` +
    `1. 是否覆盖需求；standard 的 goal/summary 是否足够支撑轻量计划；strict 的 requirements 是否逐条覆盖。\n` +
    `2. architecture=null 是否真的不需要架构说明；technicalDecisions 证据是否可核实；是否引入不必要依赖。\n` +
    `3. ready 任务是否有真实文件范围、非空步骤、行为验收、合法验收命令和风险；shell 是否确实需要且命令安全。\n` +
    `4. dependsOn 是否正确、无循环；任务范围是否冲突；needs-info / do-not-fix 是否分对。\n` +
    `5. blocking openQuestion 是否仍关联 ready 任务；有则必须报 high。\n` +
    `6. 验收权威字段是否唯一：argv 只有 acceptanceCommand，shell 只有 acceptance，非 ready 两者都为 null。\n` +
    `只读，不要修改文件。输出 PlanReview。approve 仅在所有关键项均有证据且无 high issue 时给出；否则 revise 或 reject。输出语言：${language}。`;
  const reviewer = agent("计划评审员", { system: reviewSystem });
  finalDraft = draft;
  finalReview = normalizePlanReview(await reviewer.ask<PlanReview>(reviewPrompt(draft)));
  let reviewErrors = validateReview(finalReview, new Set(finalDraft.tasks.map((task) => task.id)));
  if (reviewErrors.length) {
    finalReview = normalizePlanReview(
      await reviewer.ask<PlanReview>(`评审对象未通过运行时校验。只修复字段/语义，不要改变判断。\n错误：\n${reviewErrors.join("\n")}\n\n当前评审：\n${JSON.stringify(finalReview)}`),
    );
    reviewErrors = validateReview(finalReview, new Set(finalDraft.tasks.map((task) => task.id)));
    if (reviewErrors.length) throw new Error(`task-plan: 评审校验失败：${reviewErrors.join("；")}`);
  }
  if (finalReview.verdict !== "approve") {
    phase("按评审意见修订计划");
    finalDraft = await planner.ask<PlanDraft>(
      `根据独立评审意见修订计划。只改需要改的部分，保持任务 id 稳定。\n\n原计划：\n${JSON.stringify(draft)}\n\n评审：\n${JSON.stringify(finalReview)}\n\n输出修订后的 PlanDraft。规则同前：ready 任务必须有 files、steps、behaviorAcceptance、risk 和唯一验收字段；不要发明文件。输出语言：${language}。`,
    );
    schemaErrors = validatePlan(finalDraft, mode, allowShell, [], planPath);
    if (schemaErrors.length) throw new Error(`task-plan: 修订后 PlanDraft schema 校验失败：${schemaErrors.join("；")}`);
    phase("请没看过前稿的评审员复核");
    const finalReviewer = agent("终审评审员", { system: reviewSystem });
    finalReview = normalizePlanReview(await finalReviewer.ask<PlanReview>(reviewPrompt(finalDraft)));
    reviewErrors = validateReview(finalReview, new Set(finalDraft.tasks.map((task) => task.id)));
    if (reviewErrors.length) throw new Error(`task-plan: 终审校验失败：${reviewErrors.join("；")}`);
  }
  finalResolutions = [];
  action = "create";
  changedTaskIds = [];
  changeSummary = "";
  diffText = "";
  reconRequired = false;
  reconReasons = [];
}

phase("写出 plan.md");
const markerSource = {
  plan: finalDraft,
  review: finalReview,
  resolutions: finalResolutions,
  constraints: extraConstraints,
  scope: scopeArg,
  reconFailures,
};
const containsReservedMarker = (value: unknown): boolean => {
  if (typeof value === "string") {
    return value.includes("TASK_RUN_CONTRACT_START") || value.includes("TASK_RUN_CONTRACT_END");
  }
  if (Array.isArray(value)) return value.some(containsReservedMarker);
  if (isRecord(value)) return Object.values(value).some(containsReservedMarker);
  return false;
};
if (containsReservedMarker(markerSource)) {
  throw new Error("task-plan: 计划数据包含保留的 TASK_RUN_CONTRACT 标记，无法生成可执行合同");
}
const planMarkdown = planToMarkdown(
  finalDraft,
  finalReview,
  finalResolutions,
  allowShell,
  reconFailures,
  extraConstraints,
  scopeArg,
);
const writer = agent("计划落盘员", {
  system: "你只负责把给定的 Markdown 原样写入指定文件。不要修改源码，不要改写内容。",
});
let written = "";
let planWriteError = "";
let restoredOldPlan = false;
try {
  await writer.ask(
    `把下面的 Markdown 原样写入 workspace 相对路径 ${planPath}（使用文件写入工具，必要时创建目录）。不要修改任何源码。写完后回复 "written"。\n\n---\n${planMarkdown}\n---`,
  );
  try {
    written = await files.read(planPath);
  } catch {
    written = "";
  }
  if (!samePlanText(written, planMarkdown)) {
    await writer.ask(
      `文件 ${planPath} 缺失或与目标内容不同。请把下面的 Markdown 原样重写进去，不要改源码。\n\n---BEGIN PLAN---\n${planMarkdown}\n---END PLAN---`,
    );
    try {
      written = await files.read(planPath);
    } catch {
      written = "";
    }
  }
} catch (error) {
  planWriteError = `计划落盘员执行失败：${String(error)}`;
}
let planWritten = samePlanText(written, planMarkdown);
if (!planWritten && existingPlanContent) {
  try {
    await writer.ask(
      `计划写入失败。请把下面的旧计划原样恢复写入 ${planPath}，不要留下部分新内容。写完后回复 "restored"。\n\n---BEGIN OLD PLAN---\n${existingPlanContent}\n---END OLD PLAN---`,
    );
    const restored = await files.read(planPath);
    restoredOldPlan = samePlanText(restored, existingPlanContent);
    if (!restoredOldPlan) planWriteError = `${planWriteError}${planWriteError ? "；" : ""}旧计划恢复后内容仍不一致`;
  } catch (error) {
    planWriteError = `${planWriteError}${planWriteError ? "；" : ""}旧计划恢复失败：${String(error)}`;
  }
}
if (!planWritten && !planWriteError) planWriteError = "写入内容与生成内容不一致";
if (restoredOldPlan) planWriteError = `${planWriteError}（旧计划已恢复）`;

phase("确认计划阶段未改源码");
const finalFiles = await changedFilesExcludingPlan();
const finalGitStatus = await git.status().catch(() => null);
const finalSourceSnapshot = await sourceSnapshot(finalGitStatus);
const finalHead = await readHead();
const finalStash = await readStashRef();
const headComparable = baselineHead !== null && finalHead !== null;
const stashComparable = baselineStash !== null && finalStash !== null;
const headChanged = headComparable && baselineHead !== finalHead;
const stashChanged = stashComparable && baselineStash !== finalStash;
const finalStatusBase = finalFiles === null
  ? "（无法读取 git status）"
  : finalFiles.length
    ? finalFiles.join("\n")
    : "（无源码改动）";
const integrityNotes = [
  headChanged ? "Git HEAD 在计划阶段发生变化" : "",
  stashChanged ? "Git stash 在计划阶段发生变化" : "",
  !headComparable ? "无法读取 Git HEAD" : "",
  !stashComparable ? "无法读取 Git stash" : "",
].filter(Boolean);
const finalStatus = integrityNotes.length ? `${finalStatusBase}\n（${integrityNotes.join("；")}）` : finalStatusBase;
const sourceUnchanged =
  finalFiles !== null &&
  baselineIsClean &&
  baselineSourceSnapshot !== null &&
  finalSourceSnapshot !== null &&
  headComparable &&
  stashComparable &&
  baselineHead === finalHead &&
  baselineStash === finalStash
    ? stableJson(baselineSourceSnapshot) === stableJson(finalSourceSnapshot)
    : headChanged || stashChanged
      ? false
      : null;
const shellTaskIds = finalDraft.tasks.filter((task) => task.acceptanceKind === "shell").map((task) => task.id);
const requiresApproval = finalDraft.mode === "strict" && finalReview.verdict === "approve";
const conclusion = planWritten
  ? `${action === "revise" ? "修订后的计划" : "计划"}已写入 ${planPath}：${finalDraft.mode} 模式，${finalDraft.tasks.length} 个任务，独立评审 ${finalReview.verdict}${requiresApproval ? "，等待批准" : finalDraft.mode === "strict" ? "，当前不可执行" : ""}${reconRequired ? "，存在勘察缺口" : ""}。`
  : `计划已生成，但写入 ${planPath} 失败${planWriteError ? `：${planWriteError}` : ""}；请从产物复制或让计划落盘员重写。`;
const result: PlanReport = {
  conclusion,
  action,
  planPath,
  mode: finalDraft.mode,
  allowShell,
  shellTaskIds,
  plan: finalDraft,
  review: finalReview,
  requiresApproval,
  reviewedReviewHash: hashLabel(stableJson(finalReview)),
  changedTaskIds,
  changeSummary,
  diffMarkdown: diffText,
  reconRequired,
  reconReasons,
  baseline,
  finalStatus,
  sourceUnchanged,
  detectedAcceptance: detected,
  reconFailures,
  constraints: extraConstraints,
  scope: scopeArg,
  planWriteError,
  planWritten,
};
try {
  await artifact.markdown("plan", planMarkdown, {
    title: action === "revise" ? "修订后的计划书" : "计划书",
    description: `${finalDraft.tasks.length} 个任务；独立评审 ${finalReview.verdict}。`,
    primary: true,
  });
  if (action === "revise" && diffText) {
    await artifact.markdown("plan-diff", diffText, { title: "计划修订 diff" });
  }
} catch {
  // The plan file is still on disk; the report carries the path.
}
return result;
