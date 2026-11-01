/* zcode-workflow
description: 执行批准的 v3 任务包或兼容 v2 合同：逐波施工、独立评审、实际验收和完整性校验；严格模式 fail-fast，shell 与外部操作需要显式授权。
whenToUse: 已有 task-plan 生成的 plan.md 并准备执行时使用；v3 校验不可变任务包和基线，v2 保持原合同执行门槛。
args:
  planPath:
    type: string
    description: task-plan 生成的 plan.md workspace 相对路径，必须是规范化 .md。
    required: true
  approvalEvidence:
    type: string
    description: 可选：外层只可传入用户显式批准当前 v3 包的原文；不替代决策确认或评审。
  grants:
    type: json
    description: 可选：用户明确授权的当前 v3 包检查 ID 数组，例如 ["check:C-service"]；不从 permission 声明推断。
    default: []
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
// TASK_CORE_START
// Shared v3 contract and helpers. Embedded verbatim; no workflow orchestration lives here.
type TaskMode3 = "standard" | "strict";
type Scenario3 = "feature" | "diagnostic" | "greenfield";
type Handoff3 = "ready" | "awaiting-decisions" | "incomplete";
interface Input3 { requirement: string; references: string[]; scope: string[]; constraints: string; language: string; mode: TaskMode3; allowShell: boolean; planPath: string; changes: string; approvalEvidence: string; }
interface Evidence3 { id: string; kind: "repository" | "public" | "provided"; location: string; symbol: string; observation: string; version: string; license: string; accessed: string; }
interface Finding3 { id: string; title: string; severity: "high" | "medium" | "low"; status: "static-confirmed" | "unconfirmed"; location: string; symbol: string; trigger: string; impact: string; evidenceIds: string[]; fixSuggestion: string; verification: string; confirmation: string; }
interface Requirement3 { id: string; statement: string; criteria: string[]; }
interface Architecture3 { overview: string; boundaries: string[]; interfaces: string[]; data: string[]; security: string[]; }
interface Technology3 { area: string; recommendation: string; evidenceIds: string[]; rationale: string; alternatives: string[]; tradeoffs: string; risks: string[]; }
interface Decision3 { id: string; question: string; recommendation: string; alternatives: string[]; risks: string[]; affectsImplementation: boolean; }
interface Resolution3 { questionId: string; decision: string; evidence: string; }
interface Check3 { id: string; title: string; kind: "task" | "stage" | "final"; program: string; args: string[]; shell: string | null; permission: "local-check" | "local-service" | "remote" | "deploy"; timeoutMs: number; writeFiles: string[]; }
interface Stage3 { id: string; title: string; goal: string; dependsOn: string[]; checkIds: string[]; }
interface Task3 { id: string; stageId: string; title: string; requirementIds: string[]; findingIds: string[]; readFiles: string[]; files: string[]; steps: string[]; behaviorAcceptance: string[]; checkIds: string[]; dependsOn: string[]; outputs: string[]; risk: string; riskMitigation: string[]; rationale: string; execution: "staged" | "serial"; }
interface Plan3 { scenario: Scenario3; title: string; goal: string; summary: string; requirements: Requirement3[]; architecture: Architecture3 | null; technologies: Technology3[]; stages: Stage3[]; tasks: Task3[]; checks: Check3[]; decisions: Decision3[]; evidence: Evidence3[]; findings: Finding3[]; coverage: string[]; gaps: string[]; assumptions: string[]; notDoing: string[]; rollout: string[]; }
interface ReviewIssue3 { id: string; taskIds: string[]; severity: "high" | "medium" | "low"; blocking: boolean; category: "automatic" | "evidence" | "decision"; problem: string; fixSuggestion: string; evidence: string; }
interface Review3 { verdict: "approve" | "revise" | "reject"; issues: ReviewIssue3[]; summary: string; }
interface FileStamp3 { path: string; hash: string; mode: number; }
interface Baseline3 { kind: "git" | "filesystem"; head: string | null; branch: string | null; stash: string | null; files: FileStamp3[]; scopes: string[]; }
interface Support3 { path: string; hash: string; }
interface Contract3 { contractVersion: 3; mode: TaskMode3; allowShell: boolean; status: Handoff3; approved: boolean; approvalEvidence: string; review: Review3; reviewedPlanSnapshot: string; reviewedReviewHash: string; resolutions: Resolution3[]; plan: Plan3; baseline: Baseline3; supports: Support3[]; }
interface Pointer3 { contractVersion: 3; contractPath: string; contractHash: string; }
interface Patch3 { taskChanges: { id: string; fields: Partial<Task3> | null }[]; planChanges: Partial<Omit<Plan3, "tasks">>; resolutions: Resolution3[]; summary: string; }
interface PatchPolicy3 { mode: TaskMode3; allowShell: boolean; repairInvalidChecks: boolean; deferConfirmation: boolean; }
interface RecoveryEvidence3 { taskId: string; taskPath: string; reviewPath: string; beforePath: string; stageRoot: string; }

const PLAN_KEYS3 = ["scenario", "title", "goal", "summary", "requirements", "architecture", "technologies", "stages", "tasks", "checks", "decisions", "evidence", "findings", "coverage", "gaps", "assumptions", "notDoing", "rollout"];
const TASK_KEYS3 = ["id", "stageId", "title", "requirementIds", "findingIds", "readFiles", "files", "steps", "behaviorAcceptance", "checkIds", "dependsOn", "outputs", "risk", "riskMitigation", "rationale", "execution"];
const CHECK_KEYS3 = ["id", "title", "kind", "program", "args", "shell", "permission", "timeoutMs", "writeFiles"];
const OWNED_ROOTS3 = [".zcode/task-plans", ".zcode/task-runs", ".zcode/task-io"];
const MAX_TEXT_BYTES3 = 32 * 1024 * 1024;
const IO_CHUNK_CHARS3 = 1536;
const authorizedPlanPaths3 = new Set<string>();

function record3(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function keys3(value: Record<string, unknown>, keys: string[], partial = false): boolean {
  const actual = Object.keys(value);
  return actual.every((key) => keys.includes(key)) && (partial || actual.length === keys.length);
}
function strings3(value: unknown, minimum = 0): value is string[] {
  return Array.isArray(value) && value.length >= minimum && value.every((item) => typeof item === "string" && item.trim().length > 0);
}
function text3(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function id3(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(value) && !["__proto__", "constructor", "prototype"].includes(value);
}
function hashLabel3(value: unknown): value is string { return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value); }
function unique3(values: string[]): string[] { return [...new Set(values)]; }
function control3(value: string): boolean { return /[\x00-\x1f\x7f]/.test(value); }

// Validate JSON before visiting schemas, including cycles, sparse arrays and non-JSON values.
function jsonErrors3(value: unknown): string[] {
  let count = 0;
  const active = new Set<object>();
  const visit = (item: unknown, depth: number): boolean => {
    count += 1;
    if (depth > 64 || count > 100000) return false;
    if (item === null || typeof item === "string" || typeof item === "boolean") return true;
    if (typeof item === "number") return Number.isFinite(item);
    if (typeof item !== "object" || active.has(item)) return false;
    active.add(item);
    let valid = true;
    if (Array.isArray(item)) {
      if (Object.keys(item).length !== item.length) valid = false;
      for (let index = 0; valid && index < item.length; index += 1) valid = Object.prototype.hasOwnProperty.call(item, index) && visit(item[index], depth + 1);
    } else if (record3(item)) {
      for (const key of Object.keys(item)) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !("value" in descriptor) || !visit(descriptor.value, depth + 1)) { valid = false; break; }
      }
    } else valid = false;
    active.delete(item);
    return valid;
  };
  try { return visit(value, 0) ? [] : ["value must be bounded plain JSON (no cycles, getters, sparse arrays or non-finite values)"]; }
  catch { return ["value cannot be inspected as plain JSON"]; }
}

function stableJson3(value: unknown): string {
  const encode = (item: unknown, active: Set<object>): string => {
    if (item === null || typeof item !== "object") {
      const encoded = JSON.stringify(item);
      return encoded === undefined ? "null" : encoded;
    }
    if (active.has(item)) throw new Error("stableJson3: circular value");
    active.add(item);
    const result = Array.isArray(item)
      ? `[${item.map((entry) => encode(entry, active)).join(",")}]`
      : `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${encode((item as Record<string, unknown>)[key], active)}`).join(",")}}`;
    active.delete(item);
    return result;
  };
  return encode(value, new Set<object>());
}
function sameText3(a: string, b: string): boolean {
  const normalize = (value: string) => value.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  return normalize(a) === normalize(b);
}
function utf8Bytes3(input: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < input.length; index += 1) {
    let code = input.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = input.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { code = 0x10000 + ((code - 0xd800) << 10) + next - 0xdc00; index += 1; }
      else code = 0xfffd;
    } else if (code >= 0xdc00 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return bytes;
}
function rotate3(value: number, shift: number): number { return ((value >>> shift) | (value << (32 - shift))) >>> 0; }
function hash3(value: string): string {
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
  const bytes = utf8Bytes3(value);
  const bits = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bits / 4294967296), low = bits % 4294967296;
  bytes.push((high >>> 24) & 255, (high >>> 16) & 255, (high >>> 8) & 255, high & 255, (low >>> 24) & 255, (low >>> 16) & 255, (low >>> 8) & 255, low & 255);
  const state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const schedule = new Array<number>(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) { const base = offset + index * 4; schedule[index] = ((bytes[base] << 24) | (bytes[base + 1] << 16) | (bytes[base + 2] << 8) | bytes[base + 3]) >>> 0; }
    for (let index = 16; index < 64; index += 1) {
      const x = schedule[index - 15], y = schedule[index - 2];
      const s0 = rotate3(x, 7) ^ rotate3(x, 18) ^ (x >>> 3), s1 = rotate3(y, 17) ^ rotate3(y, 19) ^ (y >>> 10);
      schedule[index] = (schedule[index - 16] + s0 + schedule[index - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotate3(e, 6) ^ rotate3(e, 11) ^ rotate3(e, 25), ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + constants[index] + schedule[index]) >>> 0;
      const s0 = rotate3(a, 2) ^ rotate3(a, 13) ^ rotate3(a, 22), maj = (a & b) ^ (a & c) ^ (b & c);
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + s0 + maj) >>> 0;
    }
    [a, b, c, d, e, f, g, h].forEach((item, index) => { state[index] = (state[index] + item) >>> 0; });
  }
  return `sha256:${state.map((item) => item.toString(16).padStart(8, "0")).join("")}`;
}

function path3(raw: string): string | null {
  if (typeof raw !== "string" || !raw || raw !== raw.trim() || raw.length > 4096 || control3(raw)) return null;
  let value = raw.replace(/\\/g, "/");
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value) || /^[!:]/.test(value) || /[*?\[\]{}<>"|:]/.test(value)) return null;
  while (value.startsWith("./")) value = value.slice(2);
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.length > 255 || part.toLowerCase() === ".git" || /[. ]$/.test(part) || /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) return null;
  return value;
}
function scope3(raw: string): string | null { return raw === "." ? "." : path3(raw); }
function within3(file: string, scopes: string[]): boolean {
  if (file === ".") return Array.isArray(scopes) && scopes.includes(".");
  const normalized = path3(file);
  if (normalized === null || !Array.isArray(scopes)) return false;
  const candidate = normalized.toLowerCase();
  return scopes.some((scope) => { const value = scope3(scope); return value !== null && (value === "." || candidate === value.toLowerCase() || candidate.startsWith(`${value.toLowerCase()}/`)); });
}
function overlap3(a: string[], b: string[]): boolean {
  return a.some((left) => { const x = scope3(left); return x !== null && b.some((right) => { const y = scope3(right); return y !== null && (x === "." || y === "." || within3(x, [y]) || within3(y, [x])); }); });
}
function owned3(path: string): boolean { return within3(path, OWNED_ROOTS3); }
function pathArrayErrors3(value: unknown, name: string, minimum = 0, scopes = false): string[] {
  if (!strings3(value, minimum)) return [`${name} must be an array of nonempty paths`];
  const seen = new Set<string>(), errors: string[] = [];
  for (const raw of value) {
    const path = scopes ? scope3(raw) : path3(raw);
    if (path === null) errors.push(`${name}: unsafe path ${raw}`);
    else if (seen.has(path.toLowerCase())) errors.push(`${name}: duplicate path ${raw}`);
    else seen.add(path.toLowerCase());
  }
  return errors;
}
function referenceErrors3(value: unknown, name: string, known: Set<string>, minimum = 0): string[] {
  if (!strings3(value, minimum)) return [`${name} must be an array of reference IDs`];
  const errors: string[] = [], seen = new Set<string>();
  for (const id of value) {
    if (!known.has(id)) errors.push(`${name}: unknown ID ${id}`);
    if (seen.has(id)) errors.push(`${name}: duplicate ID ${id}`);
    seen.add(id);
  }
  return errors;
}
function graph3(items: { id: string; dependsOn: string[] }[], name: string): { errors: string[]; ancestors: Map<string, Set<string>> } {
  const byId = new Map(items.map((item) => [item.id, item])), done = new Set<string>();
  const ancestors = new Map<string, Set<string>>(), errors: string[] = [];
  for (const item of items) for (const id of item.dependsOn) if (!byId.has(id) || id === item.id) errors.push(`${name} ${item.id}: invalid dependency ${id}`);
  for (let round = 0; round < items.length; round += 1) {
    const next = items.find((item) => !done.has(item.id) && item.dependsOn.every((id) => done.has(id)));
    if (!next) break;
    const all = new Set(next.dependsOn);
    for (const id of next.dependsOn) for (const ancestor of ancestors.get(id) ?? []) all.add(ancestor);
    ancestors.set(next.id, all); done.add(next.id);
  }
  if (done.size !== byId.size) errors.push(`${name}: dependency cycle or unresolved reference`);
  return { errors, ancestors };
}

function programBase3(program: string): string { return (program.replace(/\\/g, "/").split("/").pop() ?? "").toLowerCase().replace(/\.(exe|cmd|bat|com)$/i, ""); }
function dangerousShell3(command: string): string {
  const patterns: { name: string; pattern: RegExp }[] = [
    { name: "destructive file command", pattern: /(^|[;&|]\s*)(?:sudo\s+|doas\s+)?(?:rm|rmdir|rd|del|erase)\b/i },
    { name: "git write", pattern: /\bgit\s+(?:[^;&|\s]+\s+)*(?:add|commit|reset|clean|checkout|restore|switch|stash|push|pull|fetch|merge|rebase|am|apply|rm|mv|tag|branch|init|config|update-ref|gc|reflog)\b/i },
    { name: "format/dd/power command", pattern: /(^|[;&|]\s*)(?:sudo\s+|doas\s+)?(?:mkfs(?:\.\w+)?|format|dd|shutdown|reboot|halt|poweroff)\b/i },
    { name: "fork bomb", pattern: /:\(\)\s*\{\s*:\|:&\s*\};:/ },
  ];
  return patterns.find((item) => item.pattern.test(command))?.name ?? "";
}
function dangerousArgv3(program: string, argv: string[]): string {
  const base = programBase3(program);
  const blocked = ["rm", "rmdir", "rd", "del", "erase", "format", "mkfs", "dd", "shutdown", "reboot", "halt", "poweroff", "sudo", "doas"];
  if (blocked.includes(base) || base.startsWith("mkfs.")) return `destructive program ${base}`;
  if (["bash", "sh", "zsh", "fish", "cmd", "powershell", "pwsh"].includes(base)) return "argv may not launch a shell interpreter; shell needs double authorization";
  if (base === "git") {
    if (/\b(?:add|commit|reset|clean|checkout|restore|switch|stash|push|pull|fetch|merge|rebase|am|apply|rm|mv|tag|branch|init|config|update-ref|gc|reflog|worktree|remote|clone)\b/i.test(argv.join(" "))) return "git writes are not acceptance checks";
    if (argv.some((arg) => arg === "-w" || arg === "--write" || arg === "--delete" || arg === "--exec-path" || arg.startsWith("--exec-path="))) return "git write/launcher option";
    if (argv.includes("symbolic-ref") && argv.filter((arg) => !arg.startsWith("-")).length > 2) return "git symbolic-ref write";
  }
  const danger = dangerousShell3([program, ...argv].join(" "));
  if (danger) return danger;
  for (const arg of argv) if (/(^|[\s;&|"'`=(])(?:rm|rmdir|rd|del|erase|format|mkfs(?:\.\w+)?|dd|shutdown|reboot|halt|poweroff)\b/i.test(arg)) return "argument contains a destructive command";
  return "";
}
function safeCheckArgument3(arg: string): boolean {
  return !control3(arg) && !/(^|[=\s])(?:[A-Za-z]:[\\/]|\/)/.test(arg) && !arg.replace(/\\/g, "/").split(/[\s=]/).some((part) => part.split("/").includes(".."));
}
function strictArgv3(program: string, argv: string[]): boolean {
  if (dangerousArgv3(program, argv) || argv.some((arg) => !safeCheckArgument3(arg))) return false;
  switch (program) {
    case "npm": case "pnpm": case "yarn":
      return (argv.length === 1 && argv[0] === "test") || (argv.length === 2 && argv[0] === "run" && /^(test|build|lint|typecheck|check)(:[A-Za-z0-9._-]+)?$/.test(argv[1]));
    case "go": {
      let offset = 0;
      if (argv[0] === "-C") { if (argv.length < 4 || (argv[1] !== "." && path3(argv[1]) === null)) return false; offset = 2; }
      else if (argv[0]?.startsWith("-C=")) { if (path3(argv[0].slice(3)) === null && argv[0] !== "-C=.") return false; offset = 1; }
      if (!["test", "build", "vet"].includes(argv[offset]) || argv.length <= offset + 1) return false;
      for (let index = offset + 1; index < argv.length; index += 1) {
        const item = argv[index];
        if (["-race", "-cover", "-v", "-count=1", "./...", "."].includes(item)) continue;
        if (item === "-run") { index += 1; if (index >= argv.length || !/^[A-Za-z0-9_./^$|*+?()\[\]{}:,=-]+$/.test(argv[index])) return false; continue; }
        if (item.startsWith("-run=")) { if (!/^[A-Za-z0-9_./^$|*+?()\[\]{}:,=-]+$/.test(item.slice(5))) return false; continue; }
        if (item.startsWith("-") || !/^[A-Za-z0-9_./]+$/.test(item)) return false;
      }
      return true;
    }
    case "cargo": return argv.length >= 1 && ["test", "build", "clippy"].includes(argv[0]) && argv.slice(1).every((arg) => ["--workspace", "--all-targets", "--all-features", "--locked", "--offline"].includes(arg));
    case "pytest": return argv.every((arg) => ["-q", "-v", "--quiet", "--strict-markers"].includes(arg) || (!arg.startsWith("-") && /^[A-Za-z0-9_./:-]+$/.test(arg)));
    case "mvn": return argv.length === 1 && ["test", "verify", "package"].includes(argv[0]);
    case "gradle": case "gradlew": case "gradlew.bat": return argv.length === 1 && ["test", "check", "build"].includes(argv[0]);
    case "make": return argv.length === 1 && ["test", "check", "build", "lint"].includes(argv[0]);
    case "dotnet": return argv.length >= 1 && ["test", "build"].includes(argv[0]) && argv.slice(1).every((arg) => /^[A-Za-z0-9_./:=*-]+$/.test(arg) && !/(?:target|logger|test-adapter-path|bl|binarylogger|response|@)/i.test(arg));
    default: return false;
  }
}
function inferredPermission3(program: string, argv: string[], shell: string | null): string {
  const base = programBase3(program), line = shell ?? [base, ...argv].join(" ");
  if (/\b(?:deploy|publish|release)\b/i.test(line)) return "deploy";
  if (["curl", "wget", "ssh", "scp", "sftp", "rsync", "ftp", "nc", "ncat", "gh", "kubectl"].includes(base) || /(?:https?:\/\/|\b(?:curl|wget|ssh|scp|sftp|rsync)\b)/i.test(line)) return "remote";
  if (["npm", "pnpm", "yarn", "pip", "pip3"].includes(base) && /\b(?:install|ci|add|update|upgrade)\b/.test(argv.join(" "))) return "remote";
  if ((base === "go" && ["get", "install"].includes(argv[0])) || (base === "dotnet" && argv[0] === "restore")) return "remote";
  if (/\b(?:serve|server|start|dev|preview)\b/i.test(line) || ["docker", "podman"].includes(base)) return "local-service";
  return "local-check";
}
function checkErrors3(value: unknown, mode: TaskMode3, allowShell: boolean): string[] {
  if (!record3(value) || !keys3(value, CHECK_KEYS3)) return ["check fields do not match Check3"];
  const errors: string[] = [];
  if (!id3(value.id)) errors.push("check.id must be a safe nonempty ID");
  if (!text3(value.title)) errors.push("check.title missing");
  if (!["task", "stage", "final"].includes(String(value.kind))) errors.push("check.kind invalid");
  if (!["local-check", "local-service", "remote", "deploy"].includes(String(value.permission))) errors.push("check.permission invalid");
  if (typeof value.timeoutMs !== "number" || !Number.isInteger(value.timeoutMs) || value.timeoutMs < 1 || value.timeoutMs > 3600000) errors.push("check.timeoutMs must be 1..3600000");
  errors.push(...pathArrayErrors3(value.writeFiles, "check.writeFiles"));
  if (strings3(value.writeFiles) && value.writeFiles.some(owned3)) errors.push("checks may not write workflow package/state paths");
  if (typeof value.program !== "string" || !Array.isArray(value.args) || !value.args.every((arg) => typeof arg === "string" && !control3(arg))) return [...errors, "check program/args invalid"];
  const argv = value.args as string[];
  if (value.shell === null) {
    if (!value.program || value.program !== value.program.trim() || control3(value.program) || /[;&|`<>"\s]/.test(value.program) || path3(value.program) === null) errors.push("check.program must be a safe program name or relative path");
    const danger = dangerousArgv3(value.program, argv);
    if (danger) errors.push(`check argv rejected: ${danger}`);
    if (mode === "strict" && !strictArgv3(value.program, argv)) errors.push("strict check is outside the controlled program/argv list");
  } else {
    if (!text3(value.shell) || control3(value.shell) || dangerousShell3(value.shell)) errors.push("check.shell empty, contains controls or is destructive");
    if (value.program !== "" || argv.length !== 0) errors.push("shell checks must have empty program and args");
    if (mode === "strict" || !allowShell) errors.push("shell check requires standard mode and allowShell=true");
  }
  if (typeof value.shell === "string" || value.shell === null) {
    const inferred = inferredPermission3(value.program, argv, value.shell);
    if (inferred !== "local-check" && value.permission !== inferred) errors.push(`check permission must explicitly declare ${inferred}`);
  }
  return errors;
}

function validatePlan3(plan: unknown, mode: TaskMode3, allowShell: boolean): string[] {
  try { return validatePlanInner3(plan, mode, allowShell); }
  catch { return ["plan contains malformed or uninspectable data"]; }
}
function validatePlanInner3(value: unknown, mode: TaskMode3, allowShell: boolean, pendingConfirmationIds: string[] = []): string[] {
  const json = jsonErrors3(value);
  if (json.length) return json;
  if (!record3(value) || !keys3(value, PLAN_KEYS3)) return ["plan fields do not match Plan3"];
  const errors: string[] = [];
  if (mode !== "standard" && mode !== "strict") errors.push("mode invalid");
  if (typeof allowShell !== "boolean" || (mode === "strict" && allowShell)) errors.push("strict forbids allowShell; allowShell must be boolean");
  if (!["feature", "diagnostic", "greenfield"].includes(String(value.scenario))) errors.push("plan.scenario invalid");
  for (const key of ["title", "goal", "summary"]) if (!text3(value[key])) errors.push(`plan.${key} missing`);
  for (const key of ["coverage", "gaps", "assumptions", "notDoing", "rollout"]) if (!strings3(value[key], key === "coverage" ? 1 : 0)) errors.push(`plan.${key} must be a nonempty-string array${key === "coverage" ? " with investigated coverage" : ""}`);
  const readList = (key: string, fields: string[]): Record<string, unknown>[] => {
    if (!Array.isArray(value[key])) { errors.push(`plan.${key} must be an array`); return []; }
    const result: Record<string, unknown>[] = [];
    for (const [index, item] of value[key].entries()) {
      if (!record3(item) || !keys3(item, fields)) errors.push(`${key}[${index}]: fields invalid`);
      else result.push(item);
    }
    return result;
  };
  const ids = (items: Record<string, unknown>[], name: string): Set<string> => {
    const seen = new Set<string>();
    for (const item of items) { if (!id3(item.id)) errors.push(`${name}: invalid ID`); else if (seen.has(item.id)) errors.push(`${name}: duplicate ID ${item.id}`); else seen.add(item.id); }
    return seen;
  };
  const requirements = readList("requirements", ["id", "statement", "criteria"]), requirementIds = ids(requirements, "requirements");
  if (requirements.length === 0) errors.push("plan.requirements missing");
  for (const item of requirements) if (!text3(item.statement) || !strings3(item.criteria, 1)) errors.push(`requirement ${String(item.id)}: statement/criteria missing`);
  if (value.architecture === null) { if (mode === "strict") errors.push("strict requires architecture"); }
  else if (!record3(value.architecture) || !keys3(value.architecture, ["overview", "boundaries", "interfaces", "data", "security"])) errors.push("architecture fields invalid");
  else {
    if (!text3(value.architecture.overview)) errors.push("architecture.overview missing");
    for (const key of ["boundaries", "interfaces", "data", "security"]) if (!strings3(value.architecture[key], mode === "strict" ? 1 : 0)) errors.push(`architecture.${key} must explain the section or explicit non-applicability`);
  }
  const evidence = readList("evidence", ["id", "kind", "location", "symbol", "observation", "version", "license", "accessed"]), evidenceIds = ids(evidence, "evidence");
  for (const item of evidence) {
    if (!["repository", "public", "provided"].includes(String(item.kind))) errors.push(`evidence ${String(item.id)}: kind invalid`);
    if (!text3(item.location) || !text3(item.observation)) errors.push(`evidence ${String(item.id)}: location/observation missing`);
    for (const key of ["symbol", "version", "license", "accessed"]) if (typeof item[key] !== "string") errors.push(`evidence ${String(item.id)}: ${key} must be a string`);
    if (item.kind === "repository" && typeof item.location === "string" && path3(item.location.replace(/:\d+(?::\d+)?(?:-\d+)?$/, "")) === null) errors.push(`evidence ${String(item.id)}: repository location unsafe`);
    if (item.kind === "public") {
      if (typeof item.location !== "string" || !/^https?:\/\/[^\s/]+(?:\/[^\s]*)?$/.test(item.location)) errors.push(`evidence ${String(item.id)}: public URL missing`);
      for (const key of ["version", "license", "accessed"]) if (!text3(item[key])) errors.push(`public evidence ${String(item.id)}: ${key} provenance missing`);
    }
  }
  const technologies = readList("technologies", ["area", "recommendation", "evidenceIds", "rationale", "alternatives", "tradeoffs", "risks"]);
  if (mode === "strict" && technologies.length === 0) errors.push("strict requires technology decisions");
  for (const item of technologies) {
    for (const key of ["area", "recommendation", "rationale", "tradeoffs"]) if (!text3(item[key])) errors.push(`technology.${key} missing`);
    for (const key of ["alternatives", "risks"]) if (!strings3(item[key], mode === "strict" ? 1 : 0)) errors.push(`technology.${key} missing`);
    errors.push(...referenceErrors3(item.evidenceIds, "technology.evidenceIds", evidenceIds, 1));
  }
  const findings = readList("findings", ["id", "title", "severity", "status", "location", "symbol", "trigger", "impact", "evidenceIds", "fixSuggestion", "verification", "confirmation"]), findingIds = ids(findings, "findings");
  for (const item of findings) {
    if (!["high", "medium", "low"].includes(String(item.severity)) || !["static-confirmed", "unconfirmed"].includes(String(item.status))) errors.push(`finding ${String(item.id)}: severity/status invalid`);
    for (const key of ["title", "location", "trigger", "impact", "verification"]) if (!text3(item[key])) errors.push(`finding ${String(item.id)}: ${key} missing`);
    for (const key of ["symbol", "fixSuggestion", "confirmation"]) if (typeof item[key] !== "string") errors.push(`finding ${String(item.id)}: ${key} must be a string`);
    if (item.status === "static-confirmed" && !text3(item.confirmation)) errors.push(`finding ${String(item.id)}: independent static confirmation missing`);
    errors.push(...referenceErrors3(item.evidenceIds, `finding ${String(item.id)}.evidenceIds`, evidenceIds, 1));
  }
  const decisions = readList("decisions", ["id", "question", "recommendation", "alternatives", "risks", "affectsImplementation"]);
  ids(decisions, "decisions");
  for (const item of decisions) {
    if (!text3(item.question) || typeof item.recommendation !== "string" || !strings3(item.alternatives) || !strings3(item.risks) || typeof item.affectsImplementation !== "boolean") errors.push(`decision ${String(item.id)}: fields missing/invalid`);
  }
  const checks = readList("checks", CHECK_KEYS3), checkIds = ids(checks, "checks");
  for (const item of checks) errors.push(...checkErrors3(item, mode, allowShell).map((error) => `${String(item.id)}: ${error}`));
  const stages = readList("stages", ["id", "title", "goal", "dependsOn", "checkIds"]), stageIds = ids(stages, "stages");
  for (const item of stages) {
    if (!text3(item.title) || !text3(item.goal)) errors.push(`stage ${String(item.id)}: title/goal missing`);
    errors.push(...referenceErrors3(item.dependsOn, `stage ${String(item.id)}.dependsOn`, stageIds));
    errors.push(...referenceErrors3(item.checkIds, `stage ${String(item.id)}.checkIds`, checkIds, mode === "strict" ? 1 : 0));
    if (strings3(item.checkIds)) for (const id of item.checkIds) if (checks.find((check) => check.id === id)?.kind !== "stage") errors.push(`stage ${String(item.id)}: ${id} must be a stage check`);
  }
  const tasks = readList("tasks", TASK_KEYS3), taskIds = ids(tasks, "tasks");
  if (value.scenario !== "diagnostic" && tasks.length === 0) errors.push("implementation plan needs tasks");
  if (tasks.length === 0 && (stages.length || checks.length)) errors.push("no-op diagnostic must have empty stages/tasks/checks");
  for (const item of tasks) {
    const label = `task ${String(item.id)}`;
    if (!stageIds.has(String(item.stageId))) errors.push(`${label}: unknown stageId`);
    for (const key of ["title", "risk", "rationale"]) if (!text3(item[key])) errors.push(`${label}: ${key} missing`);
    for (const key of ["steps", "behaviorAcceptance", "outputs", "riskMitigation"]) if (!strings3(item[key], key === "steps" || key === "behaviorAcceptance" || (mode === "strict" && key === "riskMitigation") ? 1 : 0)) errors.push(`${label}: ${key} missing/invalid`);
    errors.push(...referenceErrors3(item.requirementIds, `${label}.requirementIds`, requirementIds, mode === "strict" ? 1 : 0));
    errors.push(...referenceErrors3(item.findingIds, `${label}.findingIds`, findingIds));
    if (strings3(item.requirementIds) && strings3(item.findingIds) && item.requirementIds.length + item.findingIds.length === 0) errors.push(`${label}: no requirement or confirmed finding linkage`);
    if (strings3(item.findingIds)) for (const id of item.findingIds) if (findings.find((finding) => finding.id === id)?.status !== "static-confirmed" && !pendingConfirmationIds.includes(id)) errors.push(`${label}: unconfirmed finding ${id} may not gain repair tasks`);
    errors.push(...pathArrayErrors3(item.readFiles, `${label}.readFiles`), ...pathArrayErrors3(item.files, `${label}.files`, 1));
    if (strings3(item.files) && item.files.some(owned3)) errors.push(`${label}: may not modify workflow package/state paths`);
    errors.push(...referenceErrors3(item.checkIds, `${label}.checkIds`, checkIds, 1), ...referenceErrors3(item.dependsOn, `${label}.dependsOn`, taskIds));
    if (strings3(item.checkIds)) for (const id of item.checkIds) {
      const check = checks.find((candidate) => candidate.id === id);
      if (check?.kind !== "task") errors.push(`${label}: ${id} must be a task check`);
      if (check && strings3(check.writeFiles) && strings3(item.files) && check.writeFiles.some((path) => !within3(path, item.files as string[]))) errors.push(`${label}: check ${id} writes outside approved task files`);
    }
    if (item.execution !== "staged" && item.execution !== "serial") errors.push(`${label}: execution invalid`);
  }
  for (const item of stages) if (!tasks.some((task) => task.stageId === item.id)) errors.push(`stage ${String(item.id)}: has no tasks`);
  for (const item of requirements) if (tasks.length > 0 && !tasks.some((task) => strings3(task.requirementIds) && task.requirementIds.includes(String(item.id)))) errors.push(`requirement ${String(item.id)}: missing task coverage`);
  for (const item of findings) if (item.status === "static-confirmed" && text3(item.fixSuggestion) && !tasks.some((task) => strings3(task.findingIds) && task.findingIds.includes(String(item.id)))) errors.push(`confirmed actionable finding ${String(item.id)}: missing fix-suggestion task linkage`);
  for (const check of checks) if (check.kind !== "final" && ![...stages, ...tasks].some((item) => strings3(item.checkIds) && item.checkIds.includes(String(check.id)))) errors.push(`check ${String(check.id)}: unused check`);
  if (tasks.length > 0 && !checks.some((check) => check.kind === "final")) errors.push("implementation plans require a final check");
  const validGraph = (items: Record<string, unknown>[]) => items.filter((item) => id3(item.id) && strings3(item.dependsOn)).map((item) => ({ id: String(item.id), dependsOn: item.dependsOn as string[] }));
  const stageGraph = graph3(validGraph(stages), "stages"), taskGraph = graph3(validGraph(tasks), "tasks");
  errors.push(...stageGraph.errors, ...taskGraph.errors);
  const beforeStage = (a: Record<string, unknown>, b: Record<string, unknown>) => stageGraph.ancestors.get(String(b.stageId))?.has(String(a.stageId)) === true;
  for (const task of tasks) if (strings3(task.dependsOn)) for (const id of task.dependsOn) {
    const dependency = tasks.find((candidate) => candidate.id === id);
    if (dependency && dependency.stageId !== task.stageId && !beforeStage(dependency, task)) errors.push(`task ${String(task.id)}: cross-stage dependency ${id} is inconsistent with stage DAG`);
  }
  for (let left = 0; left < tasks.length; left += 1) for (let right = left + 1; right < tasks.length; right += 1) {
    const a = tasks[left], b = tasks[right];
    if (strings3(a.files) && strings3(b.files) && overlap3(a.files, b.files) && !taskGraph.ancestors.get(String(a.id))?.has(String(b.id)) && !taskGraph.ancestors.get(String(b.id))?.has(String(a.id)) && !beforeStage(a, b) && !beforeStage(b, a)) errors.push(`shared files: ${String(a.id)} and ${String(b.id)} require an explicit dependency before review`);
  }
  return unique3(errors);
}

function validateReview3(value: unknown, taskIds: string[]): string[] {
  try {
    const json = jsonErrors3(value); if (json.length) return json;
    if (!strings3(taskIds) || !record3(value) || !keys3(value, ["verdict", "issues", "summary"])) return ["review fields/taskIds invalid"];
    const errors: string[] = [], ids = new Set<string>();
    if (!["approve", "revise", "reject"].includes(String(value.verdict))) errors.push("review.verdict invalid");
    if (!text3(value.summary)) errors.push("review.summary missing");
    if (!Array.isArray(value.issues)) return [...errors, "review.issues must be an array"];
    for (const item of value.issues) {
      if (!record3(item) || !keys3(item, ["id", "taskIds", "severity", "blocking", "category", "problem", "fixSuggestion", "evidence"])) { errors.push("review issue fields invalid"); continue; }
      if (!id3(item.id) || ids.has(item.id)) errors.push("review issue ID invalid/duplicate"); else ids.add(item.id);
      errors.push(...referenceErrors3(item.taskIds, `review issue ${String(item.id)}.taskIds`, new Set(taskIds)));
      if (!["high", "medium", "low"].includes(String(item.severity)) || !["automatic", "evidence", "decision"].includes(String(item.category)) || typeof item.blocking !== "boolean") errors.push("review issue severity/category/blocking invalid");
      for (const key of ["problem", "fixSuggestion", "evidence"]) if (!text3(item[key])) errors.push(`review issue ${String(item.id)}: ${key} missing`);
      if (value.verdict === "approve" && item.blocking === true) errors.push("review approve cannot retain blocking issues");
    }
    return unique3(errors);
  } catch { return ["review contains malformed or uninspectable data"]; }
}
function resolutionErrors3(value: unknown, questionIds: Set<string>): string[] {
  if (!Array.isArray(value)) return ["resolutions must be an array"];
  const errors: string[] = [], seen = new Set<string>();
  for (const item of value) {
    if (!record3(item) || !keys3(item, ["questionId", "decision", "evidence"])) { errors.push("resolution fields invalid"); continue; }
    if (!id3(item.questionId) || !questionIds.has(item.questionId) || seen.has(item.questionId)) errors.push(`resolution question ID invalid/unknown/duplicate: ${String(item.questionId)}`);
    else seen.add(item.questionId);
    if (!text3(item.decision) || !text3(item.evidence)) errors.push(`resolution ${String(item.questionId)}: decision/verbatim evidence missing`);
  }
  return errors;
}
function baselineErrors3(value: unknown): string[] {
  if (!record3(value) || !keys3(value, ["kind", "head", "branch", "stash", "files", "scopes"])) return ["baseline fields invalid"];
  const errors: string[] = [];
  if (value.kind !== "git" && value.kind !== "filesystem") errors.push("baseline.kind invalid");
  for (const key of ["head", "branch", "stash"]) if (value[key] !== null && (typeof value[key] !== "string" || control3(value[key]))) errors.push(`baseline.${key} invalid`);
  if (value.kind === "filesystem" && [value.head, value.branch, value.stash].some((item) => item !== null)) errors.push("filesystem baseline must have null Git metadata");
  if (value.kind === "git") {
    if (value.head === null) { if (!text3(value.branch)) errors.push("unborn Git baseline requires an explicit branch"); }
    else if (typeof value.head !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value.head)) errors.push("Git baseline HEAD invalid");
    if (value.branch !== null && !text3(value.branch)) errors.push("Git baseline branch invalid");
    if (value.stash !== null && (typeof value.stash !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value.stash))) errors.push("Git baseline stash invalid");
  }
  errors.push(...pathArrayErrors3(value.scopes, "baseline.scopes", 1, true));
  if (!Array.isArray(value.files)) return [...errors, "baseline.files must be an array"];
  const paths = new Set<string>();
  for (const item of value.files) {
    if (!record3(item) || !keys3(item, ["path", "hash", "mode"])) { errors.push("baseline file fields invalid"); continue; }
    if (typeof item.path !== "string" || path3(item.path) !== item.path || paths.has(item.path.toLowerCase())) errors.push("baseline file path invalid/noncanonical/duplicate");
    else { paths.add(item.path.toLowerCase()); if (strings3(value.scopes) && !within3(item.path, value.scopes)) errors.push(`baseline file outside captured scopes: ${item.path}`); }
    if (!hashLabel3(item.hash)) errors.push(`baseline file hash invalid: ${String(item.path)}`);
    if (typeof item.mode !== "number" || !Number.isInteger(item.mode) || item.mode < 0 || item.mode > 0o7777) errors.push(`baseline file mode invalid: ${String(item.path)}`);
  }
  return errors;
}
function handoff3(plan: Plan3, review: Review3, resolutions: Resolution3[], errors: string[]): Handoff3 {
  try {
    if (errors.length || !strings3(plan.coverage, 1) || plan.gaps.length || review.verdict === "reject" || validateReview3(review, plan.tasks.map((task) => task.id)).length || resolutionErrors3(resolutions, new Set(plan.decisions.map((decision) => decision.id))).length) return "incomplete";
    if (review.issues.some((issue) => issue.blocking && issue.category !== "decision")) return "incomplete";
    const resolved = new Set(resolutions.map((resolution) => resolution.questionId));
    if (plan.decisions.some((decision) => decision.affectsImplementation && !resolved.has(decision.id))) return "awaiting-decisions";
    return review.verdict === "approve" && !review.issues.some((issue) => issue.blocking) ? "ready" : "incomplete";
  } catch { return "incomplete"; }
}
function validateContract3(value: unknown): string[] {
  try {
    const json = jsonErrors3(value); if (json.length) return json;
    if (!record3(value) || !keys3(value, ["contractVersion", "mode", "allowShell", "status", "approved", "approvalEvidence", "review", "reviewedPlanSnapshot", "reviewedReviewHash", "resolutions", "plan", "baseline", "supports"])) return ["contract fields do not match Contract3"];
    const errors: string[] = [];
    if (value.contractVersion !== 3) errors.push("unsupported contractVersion; expected 3");
    if (value.mode !== "standard" && value.mode !== "strict") errors.push("contract.mode invalid");
    if (typeof value.allowShell !== "boolean" || (value.mode === "strict" && value.allowShell)) errors.push("contract.allowShell invalid; strict forbids shell");
    if (!["ready", "awaiting-decisions", "incomplete"].includes(String(value.status))) errors.push("contract.status invalid");
    if (typeof value.approved !== "boolean" || typeof value.approvalEvidence !== "string") errors.push("contract approval fields invalid");
    if (value.approved === true && (!text3(value.approvalEvidence) || value.status !== "ready")) errors.push("approved contract requires ready status and explicit approvalEvidence");
    const mode: TaskMode3 = value.mode === "strict" ? "strict" : "standard";
    const planErrors = validatePlan3(value.plan, mode, value.allowShell === true);
    const tasks = record3(value.plan) && Array.isArray(value.plan.tasks) ? value.plan.tasks.filter(record3).filter((task) => typeof task.id === "string").map((task) => String(task.id)) : [];
    const reviewErrors = validateReview3(value.review, tasks);
    const decisions = record3(value.plan) && Array.isArray(value.plan.decisions) ? value.plan.decisions.filter(record3).filter((decision) => typeof decision.id === "string").map((decision) => String(decision.id)) : [];
    const resolutions = resolutionErrors3(value.resolutions, new Set(decisions));
    errors.push(...planErrors, ...reviewErrors, ...resolutions, ...baselineErrors3(value.baseline));
    if (typeof value.reviewedPlanSnapshot !== "string" || value.reviewedPlanSnapshot !== stableJson3(value.plan)) errors.push("reviewedPlanSnapshot mismatch: plan changed; re-review required");
    if (!hashLabel3(value.reviewedReviewHash) || value.reviewedReviewHash !== hash3(stableJson3(value.review))) errors.push("reviewedReviewHash mismatch: review changed; hard rejection");
    if (!Array.isArray(value.supports)) errors.push("contract.supports must be an array");
    else {
      const seen = new Set<string>();
      for (const support of value.supports) {
        if (!record3(support) || !keys3(support, ["path", "hash"]) || typeof support.path !== "string" || path3(support.path) !== support.path || !/^\.zcode\/task-plans\/[a-f0-9]{64}\//.test(support.path) || /(?:^|\/)(?:checkpoint\.json|contract\.json|io)(?:\/|$)/.test(support.path) || !hashLabel3(support.hash)) errors.push("support path/raw-file hash invalid or outside immutable plan materials");
        else if (seen.has(support.path.toLowerCase())) errors.push("support path duplicated"); else seen.add(support.path.toLowerCase());
      }
    }
    if (!planErrors.length && !reviewErrors.length && !resolutions.length) {
      const expected = handoff3(value.plan as unknown as Plan3, value.review as unknown as Review3, value.resolutions as Resolution3[], []);
      if (value.status !== expected) errors.push(`contract.status mismatch: expected ${expected}`);
    }
    return unique3(errors);
  } catch { return ["contract contains malformed or uninspectable data"]; }
}

function findingContent3(finding: Finding3): string {
  const { status, confirmation, ...content } = finding;
  return stableJson3(content);
}
function correctsInvalidCheck3(before: Check3, after: Check3, policy: PatchPolicy3): boolean {
  if (!policy.repairInvalidChecks || !checkErrors3(before, policy.mode, policy.allowShell).length || checkErrors3(after, policy.mode, policy.allowShell).length) return false;
  if (after.permission !== "local-check" || after.shell !== null || after.writeFiles.some(path => !strings3(before.writeFiles) || !within3(path, before.writeFiles))) return false;
  for (const key of ["kind", "program", "args", "shell", "permission", "timeoutMs", "writeFiles"] as const) {
    if (stableJson3(before[key]) !== stableJson3(after[key]) && !checkErrors3({ ...after, [key]: before[key] }, policy.mode, policy.allowShell).length) return false;
  }
  return true;
}
function changedTaskIds3(before: Plan3, after: Plan3): string[] {
  const changedChecks = new Set(unique3([...before.checks.map(check => check.id), ...after.checks.map(check => check.id)]).filter(id => stableJson3(before.checks.find(check => check.id === id)) !== stableJson3(after.checks.find(check => check.id === id))));
  return unique3([...before.tasks.map(task => task.id), ...after.tasks.map(task => task.id)]).filter(id => {
    const left = before.tasks.find(task => task.id === id), right = after.tasks.find(task => task.id === id);
    return stableJson3(left) !== stableJson3(right) || [...(left?.checkIds ?? []), ...(right?.checkIds ?? [])].some(check => changedChecks.has(check));
  }).sort();
}
function planDiff3(before: Plan3, after: Plan3, beforeResolutions: Resolution3[] = [], afterResolutions: Resolution3[] = []): string[] {
  const lines: string[] = [];
  const items = (label: string, left: { id: string }[], right: { id: string }[]): void => {
    const a = new Map(left.map(item => [item.id, item])), b = new Map(right.map(item => [item.id, item]));
    const added = [...b.keys()].filter(id => !a.has(id)).sort();
    const removed = [...a.keys()].filter(id => !b.has(id)).sort();
    const modified = [...a.keys()].filter(id => b.has(id) && stableJson3(a.get(id)) !== stableJson3(b.get(id))).sort();
    const parts = [added.length ? `新增 ${added.join("、")}` : "", modified.length ? `修改 ${modified.join("、")}` : "", removed.length ? `删除 ${removed.join("、")}` : ""].filter(Boolean);
    if (stableJson3(left.filter(item => b.has(item.id)).map(item => item.id)) !== stableJson3(right.filter(item => a.has(item.id)).map(item => item.id))) parts.push("顺序变化");
    if (parts.length) lines.push(`${label}：${parts.join("；")}。`);
  };
  items("实施任务", before.tasks, after.tasks);
  const checkOnly = changedTaskIds3(before, after).filter(id => stableJson3(before.tasks.find(task => task.id === id)) === stableJson3(after.tasks.find(task => task.id === id)));
  if (checkOnly.length) lines.push(`仅检查定义变化影响的任务：${checkOnly.join("、")}。`);
  for (const kind of ["task", "stage", "final"] as const) items({ task: "任务检查", stage: "阶段检查", final: "最终检查" }[kind], before.checks.filter(check => check.kind === kind), after.checks.filter(check => check.kind === kind));
  if (stableJson3(before.checks.filter(check => after.checks.some(item => item.id === check.id)).map(check => check.id)) !== stableJson3(after.checks.filter(check => before.checks.some(item => item.id === check.id)).map(check => check.id))) lines.push("检查顺序：已更新。");
  items("需求", before.requirements, after.requirements);
  items("决定", before.decisions, after.decisions);
  items("决议", beforeResolutions.map(item => ({ id: item.questionId, ...item })), afterResolutions.map(item => ({ id: item.questionId, ...item })));
  const ranges = (value: Plan3) => [
    ...value.tasks.flatMap(task => [{ id: `任务 ${task.id} 只读范围`, paths: task.readFiles }, { id: `任务 ${task.id} 写入范围`, paths: task.files }]),
    ...value.checks.map(check => ({ id: `检查 ${check.id} 写入范围`, paths: check.writeFiles })),
  ];
  const leftRanges = new Map(ranges(before).map(item => [item.id, item.paths])), rightRanges = new Map(ranges(after).map(item => [item.id, item.paths]));
  for (const id of unique3([...leftRanges.keys(), ...rightRanges.keys()]).sort()) {
    const left = leftRanges.get(id) ?? [], right = rightRanges.get(id) ?? [];
    if (stableJson3(left) === stableJson3(right)) continue;
    const added = right.filter(path => !left.includes(path)).sort(), removed = left.filter(path => !right.includes(path)).sort();
    const parts = [added.length ? `新增 ${added.join("、")}` : "", removed.length ? `移除 ${removed.join("、")}` : ""].filter(Boolean);
    lines.push(`${id}：${parts.join("；") || "顺序变化"}。`);
  }
  items("阶段", before.stages, after.stages);
  items("证据", before.evidence, after.evidence);
  items("发现", before.findings, after.findings);
  const labels = { scenario: "场景", title: "标题", goal: "目标", summary: "方案结论", architecture: "架构设计", technologies: "技术选择", coverage: "调查覆盖", gaps: "证据缺口", assumptions: "假设", notDoing: "不做范围", rollout: "上线安排" };
  for (const key of Object.keys(labels) as (keyof typeof labels)[]) if (stableJson3(before[key]) !== stableJson3(after[key])) lines.push(`${labels[key]}：已更新。`);
  return lines.length ? lines : ["方案与决议无变化；无实施变化。"];
}
function applyPatch3(plan: Plan3, patch: Patch3, existing: Resolution3[], userText: string, automatic: boolean, policy: PatchPolicy3 = { mode: "standard", allowShell: true, repairInvalidChecks: false, deferConfirmation: false }): { plan: Plan3; resolutions: Resolution3[]; errors: string[]; changedTaskIds: string[]; pendingFindingIds: string[] } {
  const failure = (errors: string[]) => ({ plan, resolutions: existing, errors: unique3(errors), changedTaskIds: [] as string[], pendingFindingIds: [] as string[] });
  try {
    const json = [...jsonErrors3(plan), ...jsonErrors3(patch), ...jsonErrors3(existing)]; if (json.length) return failure(json);
    if (!record3(patch) || !keys3(patch, ["taskChanges", "planChanges", "resolutions", "summary"]) || !Array.isArray(patch.taskChanges) || !record3(patch.planChanges) || !keys3(patch.planChanges, PLAN_KEYS3.filter((key) => key !== "tasks"), true) || !Array.isArray(patch.resolutions) || !text3(patch.summary) || typeof userText !== "string" || typeof automatic !== "boolean") return failure(["patch fields invalid/protected; mode/allowShell/approval cannot be patched"]);
    const errors: string[] = [], tasks = plan.tasks.slice(), changed = new Set<string>();
    const preserves = (before: unknown, after: unknown, label: string) => {
      if (!Array.isArray(after) || (Array.isArray(before) && before.some((entry) => !after.some((candidate) => stableJson3(entry) === stableJson3(candidate))))) errors.push(`automatic patch cannot reduce ${label}`);
    };
    for (const change of patch.taskChanges) {
      if (!record3(change) || !keys3(change, ["id", "fields"]) || !id3(change.id) || changed.has(change.id)) { errors.push("taskChanges contains invalid/duplicate ID or fields"); continue; }
      changed.add(change.id);
      const index = tasks.findIndex((task) => task.id === change.id), old = index >= 0 ? tasks[index] : undefined;
      if (change.fields === null) { if (automatic) errors.push("automatic patch cannot delete tasks"); else if (!old) errors.push(`cannot delete unknown task ${change.id}`); else tasks.splice(index, 1); continue; }
      if (!record3(change.fields) || !keys3(change.fields, TASK_KEYS3, true) || (change.fields.id !== undefined && change.fields.id !== change.id)) { errors.push(`task ${change.id}: undeclared/protected fields or ID mutation`); continue; }
      if (!old && !keys3(change.fields, TASK_KEYS3)) { errors.push(`new task ${change.id}: all declared fields required; no invented defaults`); continue; }
      const next = { ...(old ?? {}), ...change.fields } as Task3;
      if (automatic && old) {
        for (const key of ["requirementIds", "findingIds", "readFiles", "files", "behaviorAcceptance", "checkIds", "dependsOn", "outputs", "riskMitigation"] as const) if (Object.prototype.hasOwnProperty.call(change.fields, key)) preserves(old[key], next[key], `${change.id}.${key}`);
        if (Object.prototype.hasOwnProperty.call(change.fields, "steps") && (!strings3(next.steps, 1) || (Array.isArray(old.steps) && next.steps.length < old.steps.length))) errors.push(`automatic patch cannot reduce ${change.id}.steps`);
        if (old.execution === "serial" && next.execution !== "serial") errors.push("automatic patch cannot weaken serial execution");
      }
      if (old) tasks[index] = next; else tasks.push(next);
    }
    const next = { ...plan, ...patch.planChanges, tasks } as Plan3;
    if (automatic) {
      if (next.scenario !== plan.scenario || next.goal !== plan.goal) errors.push("automatic patch cannot change scenario/goal");
      if (!Array.isArray(next.requirements)) errors.push("requirements invalid");
      else for (const old of plan.requirements) {
        const item = next.requirements.find((candidate) => record3(candidate) && candidate.id === old.id);
        if (!item || item.statement !== old.statement) errors.push("automatic patch cannot delete/rewrite requirements"); else preserves(old.criteria, item.criteria, `requirement ${old.id}.criteria`);
      }
      if (!Array.isArray(next.findings)) errors.push("findings invalid");
      else for (const old of plan.findings) {
        const item = next.findings.find((candidate) => record3(candidate) && candidate.id === old.id);
        if (!item) errors.push("automatic patch cannot drop findings");
        else {
          preserves(old.evidenceIds, item.evidenceIds, `finding ${old.id}.evidenceIds`);
          if ((old.status === "static-confirmed" && item.status !== old.status) || ({ high: 3, medium: 2, low: 1 }[item.severity] < { high: 3, medium: 2, low: 1 }[old.severity])) errors.push("automatic patch cannot downgrade confirmed findings");
        }
      }
      if (!Array.isArray(next.decisions) || plan.decisions.some(old => !next.decisions.some(item => stableJson3(item) === stableJson3(old)))) errors.push("automatic patch cannot delete/rewrite user decisions");
      preserves(plan.gaps, next.gaps, "unresolved evidence gaps");
      preserves(plan.coverage, next.coverage, "investigation coverage");
      if (Array.isArray(next.notDoing) && next.notDoing.some((item) => !plan.notDoing.includes(item))) errors.push("automatic patch cannot exclude additional scope");
      if (!Array.isArray(next.evidence)) errors.push("evidence invalid"); else for (const item of plan.evidence) if (!next.evidence.some((candidate) => stableJson3(candidate) === stableJson3(item))) errors.push("automatic patch cannot drop/rewrite source evidence");
      if (!Array.isArray(next.checks)) errors.push("checks invalid");
      else {
        for (const old of plan.checks) {
          const check = next.checks.find((candidate) => record3(candidate) && candidate.id === old.id);
          if (!check) errors.push("automatic patch cannot delete checks");
          else if (!correctsInvalidCheck3(old, check as unknown as Check3, policy)) for (const key of ["kind", "program", "args", "shell", "permission", "timeoutMs", "writeFiles"] as const) if (stableJson3(old[key]) !== stableJson3(check[key])) errors.push(`automatic patch cannot change check authorization/acceptance ${old.id}.${key}`);
        }
        for (const check of next.checks) if (!plan.checks.some((old) => old.id === check.id) && (check.permission !== "local-check" || check.shell !== null)) errors.push("automatic patch cannot introduce service/remote/deploy/shell permissions");
      }
    }
    const resolutions = existing.filter(item => {
      const before = plan.decisions.find(decision => decision.id === item.questionId);
      const after = next.decisions.find(decision => decision.id === item.questionId);
      return before !== undefined && after !== undefined && stableJson3(before) === stableJson3(after);
    });
    for (const item of patch.resolutions) {
      if (!record3(item) || !keys3(item, ["questionId", "decision", "evidence"])) { errors.push("patch resolution fields invalid"); continue; }
      const index = resolutions.findIndex((old) => old.questionId === item.questionId);
      if (index >= 0 && stableJson3(resolutions[index]) === stableJson3(item)) continue;
      if (automatic) { errors.push("automatic patch cannot decide on behalf of the user"); continue; }
      if (!text3(item.evidence) || !userText.includes(item.evidence)) { errors.push(`resolution ${String(item.questionId)}: evidence must be verbatim in userText`); continue; }
      if (index < 0) resolutions.push(item as unknown as Resolution3); else resolutions[index] = item as unknown as Resolution3;
    }
    const pendingFindingIds: string[] = [];
    if (Array.isArray(next.findings)) next.findings = next.findings.map(finding => {
      if (!record3(finding)) return finding;
      const before = plan.findings.find(item => item.id === finding.id);
      const sameEvidence = before && before.evidenceIds.every(id => stableJson3(plan.evidence.find(item => item.id === id)) === stableJson3(next.evidence.find(item => item.id === id)));
      if (before && sameEvidence && findingContent3(before) === findingContent3(finding)) return { ...finding, status: before.status, confirmation: before.confirmation };
      pendingFindingIds.push(finding.id);
      return { ...finding, status: "unconfirmed", confirmation: "尚未独立核对" };
    });
    if (policy.deferConfirmation) for (const finding of next.findings) if (finding.status === "unconfirmed" && next.tasks.some(task => task.findingIds.includes(finding.id)) && !pendingFindingIds.includes(finding.id)) pendingFindingIds.push(finding.id);
    errors.push(...validatePlanInner3(next, policy.mode, policy.allowShell, policy.deferConfirmation ? pendingFindingIds : []), ...resolutionErrors3(resolutions, new Set(next.decisions.map((decision) => decision.id))));
    if (errors.length) return failure(errors);
    return { plan: next, resolutions, errors: [], changedTaskIds: changedTaskIds3(plan, next), pendingFindingIds };
  } catch { return failure(["patch contains malformed or uninspectable data"]); }
}

function taskDependencies3(tasks: Task3[], stages: Stage3[]): Map<string, Set<string>> {
  const stageGraph = graph3(stages, "stages"), taskGraph = graph3(tasks, "tasks");
  if (stageGraph.errors.length || taskGraph.errors.length || new Set(tasks.map((task) => task.id)).size !== tasks.length || new Set(stages.map((stage) => stage.id)).size !== stages.length) throw new Error([...stageGraph.errors, ...taskGraph.errors, "waves require unique valid DAGs"].join("; "));
  const stageIds = new Set(stages.map((stage) => stage.id));
  const dependencies = new Map<string, Set<string>>();
  for (const task of tasks) {
    if (!stageIds.has(task.stageId)) throw new Error(`unknown stage ${task.stageId}`);
    const required = new Set(task.dependsOn), earlier = stageGraph.ancestors.get(task.stageId) ?? new Set<string>();
    for (const candidate of tasks) if (earlier.has(candidate.stageId)) required.add(candidate.id);
    dependencies.set(task.id, required);
  }
  return dependencies;
}
function waves3(tasks: Task3[], stages: Stage3[]): Task3[][] {
  const dependencies = taskDependencies3(tasks, stages);
  const result: Task3[][] = [], done = new Set<string>();
  for (let round = 0; done.size < tasks.length && round < tasks.length; round += 1) {
    const ready = tasks.filter((task) => !done.has(task.id) && [...(dependencies.get(task.id) ?? [])].every((id) => done.has(id)));
    if (!ready.length) throw new Error("task/stage DAGs have a combined cycle");
    const first = ready[0], wave: Task3[] = [first];
    if (first.execution !== "serial") for (const task of ready.slice(1)) {
      if (task.execution !== "staged") continue;
      if (wave.every((selected) => !overlap3(task.files, [...selected.files, ...selected.readFiles]) && !overlap3(selected.files, task.readFiles))) wave.push(task);
    }
    result.push(wave); for (const task of wave) done.add(task.id);
  }
  return result;
}
function serialRecoveryEvidence3(plan: Plan3, checkpoint: { wave: number; attempt: number; status: string; appliedTaskIds: string[]; artifacts: Support3[] }, result: { tasks: { id: string; status: string; attempts: number; artifactPath: string }[] }, runRoot: string): RecoveryEvidence3[] {
  const stamps = new Map(checkpoint.artifacts.map(item => [item.path, item.hash]));
  if (stamps.size !== checkpoint.artifacts.length) throw new Error("串行恢复证据路径重复");
  const bound = (path: string): void => { if (!hashLabel3(stamps.get(path))) throw new Error(`串行恢复证据缺少哈希绑定：${path}`); };
  const evidence: RecoveryEvidence3[] = [];
  const waves = waves3(plan.tasks, plan.stages);
  for (let index = 0; index < waves.length; index += 1) for (const task of waves[index].filter(item => item.execution === "serial")) {
    const wave = index + 1;
    const completed = result.tasks.find(item => item.id === task.id && item.status === "completed");
    const current = checkpoint.wave === wave && checkpoint.attempt > 0;
    if (checkpoint.appliedTaskIds.includes(task.id) && !current && !completed) throw new Error(`串行已应用任务不属于恢复波次：${task.id}`);
    if (checkpoint.status === "completed" && !completed) throw new Error(`串行完成记录缺少任务结果：${task.id}`);
    if (!completed && !current) continue;
    const attempt = current ? checkpoint.attempt : completed!.attempts;
    if (!Number.isInteger(attempt) || attempt < 1 || attempt > 2 || (completed && completed.attempts !== attempt)) throw new Error(`串行恢复尝试归属不一致：${task.id}`);
    if (completed) {
      const prefix = completed.artifactPath.slice(`${runRoot}/waves/`.length, -"-result.json".length);
      if (completed.artifactPath !== `${runRoot}/waves/${prefix}-result.json` || !/^(?:r-[a-f0-9]{12}-)?w[1-9][0-9]*-a[12]$/.test(prefix) || !prefix.endsWith(`w${wave}-a${attempt}`)) throw new Error(`串行完成结果波次归属无效：${task.id}`);
      bound(completed.artifactPath);
    }
    const prefixes = new Set<string>();
    for (const path of stamps.keys()) {
      const folder = path.startsWith(`${runRoot}/tasks/`) ? `${runRoot}/tasks/` : path.startsWith(`${runRoot}/reviews/`) ? `${runRoot}/reviews/` : "";
      if (!folder) continue;
      const match = /^((?:r-[a-f0-9]{12}-)?w([1-9][0-9]*)-a([12]))-(.+)\.json$/.exec(path.slice(folder.length));
      if (!match || match[4] !== task.id) continue;
      if (Number(match[2]) !== wave || Number(match[3]) > attempt) throw new Error(`串行实施证据波次/尝试归属无效：${task.id}`);
      if (Number(match[3]) === attempt) prefixes.add(match[1]);
    }
    if (!prefixes.size) throw new Error(`串行施工中断或完成记录缺少实施/复核证据：${task.id}`);
    for (const prefix of prefixes) {
      const item = { taskId: task.id, taskPath: `${runRoot}/tasks/${prefix}-${task.id}.json`, reviewPath: `${runRoot}/reviews/${prefix}-${task.id}.json`, beforePath: `${runRoot}/waves/${prefix}-before.json`, stageRoot: `${runRoot}/staging/${prefix}/${task.id}` };
      for (const path of [item.taskPath, item.reviewPath, item.beforePath, item.beforePath.replace(/-before\.json$/, "-prepared.json")]) bound(path);
      evidence.push(item);
    }
    if (current && !completed && !checkpoint.appliedTaskIds.includes(task.id)) throw new Error(`串行实施尝试没有完整接受记录，不能重新施工：${task.id}`);
  }
  return evidence;
}
function serialRecoveryEvidenceErrors3(evidence: RecoveryEvidence3, task: Task3, implementation: unknown, review: unknown, before: unknown, prepared: unknown): string[] {
  const fail = (reason: string): string[] => [`串行恢复 ${evidence.taskId}：${reason}`];
  if (task.id !== evidence.taskId || task.execution !== "serial" || !record3(implementation) || !keys3(implementation, ["runId", "taskId", "outcome", "stageRoot", "beforePath"]) || !text3(implementation.runId) || implementation.taskId !== evidence.taskId || implementation.stageRoot !== evidence.stageRoot || implementation.beforePath !== evidence.beforePath) return fail("实施结果或原始快照归属不完整");
  const outcome = implementation.outcome;
  if (!record3(outcome) || !keys3(outcome, ["summary", "blocked", "blockReason", "notes"]) || !text3(outcome.summary) || outcome.blocked !== false || typeof outcome.blockReason !== "string" || typeof outcome.notes !== "string" || stableJson3(outcome).length > 32768) return fail("实施被阻塞或结果不完整");
  if (!record3(review) || !keys3(review, ["approved", "issues", "repairable", "summary"]) || review.approved !== true || !Array.isArray(review.issues) || review.issues.length !== 0 || typeof review.repairable !== "boolean" || !text3(review.summary) || stableJson3(review).length > 32768) return fail("没有完整的独立复核通过证据");
  if (baselineErrors3(before).length || baselineErrors3(prepared).length) return fail("实施前后完整性快照不完整");
  return compareBaseline3(before as Baseline3, prepared as Baseline3, task.files).map(error => `串行恢复 ${evidence.taskId}：${error}`);
}
function changes3(before: Baseline3, after: Baseline3): string[] {
  const errors = [...jsonErrors3(before), ...jsonErrors3(after), ...baselineErrors3(before), ...baselineErrors3(after)];
  if (errors.length) throw new Error(`invalid baseline: ${errors.join("; ")}`);
  const left = new Map(before.files.map((file) => [file.path.toLowerCase(), file])), right = new Map(after.files.map((file) => [file.path.toLowerCase(), file]));
  return unique3([...left.keys(), ...right.keys()]).filter((key) => {
    const a = left.get(key), b = right.get(key); return !a || !b || a.hash !== b.hash || a.mode !== b.mode || a.path !== b.path;
  }).map((key) => right.get(key)?.path ?? left.get(key)?.path ?? key).sort();
}
function compareBaseline3(expected: Baseline3, actual: Baseline3, allowed: string[]): string[] {
  try {
    const errors = [...jsonErrors3(expected), ...jsonErrors3(actual), ...baselineErrors3(expected), ...baselineErrors3(actual), ...pathArrayErrors3(allowed, "allowed", 0, true)];
    if (errors.length) return errors;
    for (const key of ["kind", "head", "branch", "stash"] as const) if (expected[key] !== actual[key]) errors.push(`baseline ${key} changed (${String(expected[key])} -> ${String(actual[key])})`);
    if (stableJson3(expected.scopes.map((scope) => (scope3(scope) ?? scope).toLowerCase()).sort()) !== stableJson3(actual.scopes.map((scope) => (scope3(scope) ?? scope).toLowerCase()).sort())) errors.push("baseline captured scopes changed");
    for (const path of changes3(expected, actual)) if (!within3(path, allowed)) errors.push(`file content/mode/add/delete changed outside allowed scopes: ${path}`);
    return errors;
  } catch { return ["baseline comparison failed; unknown information is not a match"]; }
}

function markdown3(value: string): string { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, " ").replace(/([\\`*_[\]|])/g, "\\$1"); }
function link3(path: string): string { return path.split("/").map((part) => encodeURIComponent(part)).join("/"); }
function renderTask3(task: Task3, plan: Plan3): string {
  const lines = [`# ${markdown3(task.id)} — ${markdown3(task.title)}`, "", `阶段：${markdown3(task.stageId)}；执行方式：${task.execution}`, "", "## 关联需求"];
  for (const id of task.requirementIds) { const requirement = plan.requirements.find((item) => item.id === id); if (requirement) lines.push(`- ${markdown3(id)}：${markdown3(requirement.statement)}`, ...requirement.criteria.map((item) => `  - ${markdown3(item)}`)); }
  lines.push("", "## 关联发现");
  for (const id of task.findingIds) { const finding = plan.findings.find((item) => item.id === id); if (finding) lines.push(`- ${markdown3(id)} (${finding.status})：${markdown3(finding.title)}；修复建议：${markdown3(finding.fixSuggestion)}`); }
  lines.push("", "## 文件边界", ...task.readFiles.map((file) => `- 只读：${markdown3(file)}`), ...task.files.map((file) => `- 允许修改：${markdown3(file)}`), "", "## 实施步骤", ...task.steps.map((step, index) => `${index + 1}. ${markdown3(step)}`), "", "## 行为验收", ...task.behaviorAcceptance.map((item) => `- ${markdown3(item)}`), "", "## 自动检查（尚未执行）");
  for (const id of task.checkIds) { const check = plan.checks.find((item) => item.id === id); if (check) lines.push(`- ${markdown3(id)}：${markdown3(check.title)}；${markdown3(check.shell ?? JSON.stringify([check.program, ...check.args]))}；权限 ${check.permission}；超时 ${check.timeoutMs}ms`); }
  lines.push("", `依赖：${task.dependsOn.map(markdown3).join(", ") || "无"}`, `产出：${task.outputs.map(markdown3).join("；") || "见任务文件"}`, "", "## 风险与理由", markdown3(task.risk), ...task.riskMitigation.map((item) => `- ${markdown3(item)}`), markdown3(task.rationale), "");
  return lines.join("\n");
}
function renderPlan3(contract: Contract3, pointer: Pointer3, taskPaths: Record<string, string>, revisionLines: string[] = []): string {
  const plan = contract.plan;
  const status = { ready: "可交接", "awaiting-decisions": "待确认", incomplete: "未完成" }[contract.status];
  const scenario = { feature: "产品需求", diagnostic: "问题排查", greenfield: "从零设计" }[plan.scenario];
  const lines = [`# 实施方案：${markdown3(plan.title)}`, "", `> 场景：${scenario}；模式：${contract.mode}；交接：${status}；评审：${contract.review.verdict}`, ""];
  if (contract.status === "awaiting-decisions") lines.push("> 影响实施的决定尚未确认，整份方案暂不施工。", "");
  if (contract.status === "incomplete") lines.push("> 当前分析或方案尚未满足交接条件，不能交给 task-run 执行。", "");
  if (contract.mode === "strict") lines.push(`> strict：${contract.approved ? "已记录用户对当前版本的明确批准" : "执行前还需用户明确批准当前版本"}。`, "");
  if (revisionLines.length) {
    lines.push("## 本轮修订摘要", "", ...revisionLines.slice(0, 8).map(item => `- ${markdown3(item.length > 240 ? `${item.slice(0, 240)}…` : item)}`));
    lines.push("", "完整确定性差异见支持材料中的 revision-summary.json；比较旧方案与最终方案，不采用作者自报摘要。", "");
  }
  lines.push("## 目标与结论", "", markdown3(plan.goal), "", markdown3(plan.summary), "", "## 需求与调查覆盖", "");
  for (const item of plan.requirements) lines.push(`- ${markdown3(item.id)}：${markdown3(item.statement)}`, ...item.criteria.map(criterion => `  - 验收：${markdown3(criterion)}`));
  lines.push(...plan.coverage.map(item => `- 已调查：${markdown3(item)}`), ...plan.gaps.map(item => `- 缺口：${markdown3(item)}`));
  lines.push("", "### 需求 → 任务 → 任务检查", "", "| 需求 | 实施任务 | 任务检查（尚未运行） |", "| --- | --- | --- |");
  for (const requirement of plan.requirements.slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const tasks = plan.tasks.filter(task => task.requirementIds.includes(requirement.id)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (!tasks.length) lines.push(`| ${markdown3(requirement.id)} | ${plan.scenario === "diagnostic" && !plan.tasks.length ? "调查结论，无实施任务" : "未关联实施任务"} | 无 |`);
    for (const task of tasks) {
      const checks = task.checkIds.filter(id => plan.checks.some(check => check.id === id && check.kind === "task")).slice().sort();
      lines.push(`| ${markdown3(requirement.id)} | ${markdown3(task.id)} | ${checks.map(markdown3).join("、") || "无任务检查"} |`);
    }
  }
  lines.push("", "此表仅按需求和任务的 ID 引用确定性生成，不自动证明每项业务标准已被覆盖或满足。业务验收须由评审逐项核对，并明确机器检查与人工验收各自负责什么；阶段和最终检查不替代逐项业务验收。");
  if (plan.architecture) {
    const architecture = plan.architecture;
    lines.push("", "## 设计", "", markdown3(architecture.overview));
    const labels = { boundaries: "模块边界", interfaces: "共享接口", data: "数据与迁移", security: "安全与隐私" };
    for (const key of ["boundaries", "interfaces", "data", "security"] as const) lines.push("", `### ${labels[key]}`, "", ...architecture[key].map(item => `- ${markdown3(item)}`));
  }
  if (plan.technologies.length) {
    lines.push("", "## 技术选择", "");
    for (const item of plan.technologies) lines.push(`### ${markdown3(item.area)}`, `- 推荐：${markdown3(item.recommendation)}`, `- 理由：${markdown3(item.rationale)}`, `- 替代方案：${item.alternatives.map(markdown3).join("；") || "无额外候选"}`, `- 取舍：${markdown3(item.tradeoffs)}`, `- 风险：${item.risks.map(markdown3).join("；") || "见总体风险"}`, `- 证据：${item.evidenceIds.map(markdown3).join("、")}`, "");
  }
  lines.push("", "## 阶段与任务", "", "| ID | 阶段 / 任务 | 依赖 | 检查 ID |", "| --- | --- | --- | --- |");
  for (const stage of plan.stages) {
    lines.push(`| ${markdown3(stage.id)} | ${markdown3(stage.title)} | ${stage.dependsOn.map(markdown3).join("、")} | ${stage.checkIds.map(markdown3).join("、")} |`);
    for (const task of plan.tasks.filter(item => item.stageId === stage.id)) {
      const path = taskPaths[task.id];
      lines.push(`| ${markdown3(task.id)} | ${path ? `[${markdown3(task.title)}](${link3(path)})` : markdown3(task.title)} | ${task.dependsOn.map(markdown3).join("、")} | ${task.checkIds.map(markdown3).join("、")} |`);
    }
  }
  if (!plan.tasks.length) lines.push("", "调查已完成，没有经静态确认且可执行的修复项；此方案不修改源文件。");
  for (const stage of plan.stages) {
    lines.push("", `### ${markdown3(stage.id)} ${markdown3(stage.title)}`, "", markdown3(stage.goal));
    for (const task of plan.tasks.filter(item => item.stageId === stage.id)) {
      lines.push("", `#### ${markdown3(task.id)} ${markdown3(task.title)}`, `- 依据：${markdown3(task.rationale)}`, `- 允许修改：${task.files.map(markdown3).join("、")}`, `- 依赖：${task.dependsOn.map(markdown3).join("、") || "无"}；${task.execution === "staged" ? "独立变更准备，校验后落盘" : "串行实施"}`, "- 做法：", ...task.steps.map((step, index) => `  ${index + 1}. ${markdown3(step)}`), "- 行为验收：", ...task.behaviorAcceptance.map(item => `  - ${markdown3(item)}`), `- 产物：${task.outputs.map(markdown3).join("；") || "任务文件"}`, `- 风险：${markdown3(task.risk)}`, `- 缓解：${task.riskMitigation.map(markdown3).join("；") || "见总体边界"}`);
    }
  }
  lines.push("", "## 验收安排（尚未运行）", "");
  for (const check of plan.checks) lines.push(`- ${markdown3(check.id)} [${check.kind}] ${markdown3(check.title)}：${markdown3(check.shell ?? JSON.stringify([check.program, ...check.args]))}；权限 ${check.permission}；超时 ${check.timeoutMs}ms${check.writeFiles.length ? `；允许检查写入 ${check.writeFiles.map(markdown3).join("、")}` : ""}`);
  lines.push("", "## 待确认决定", "");
  if (!plan.decisions.length) lines.push("- 无影响实施的未决事项。");
  for (const decision of plan.decisions) {
    const resolution = contract.resolutions.find(item => item.questionId === decision.id);
    lines.push(`### ${markdown3(decision.id)} ${markdown3(decision.question)}`, `- 推荐：${markdown3(decision.recommendation)}`, `- 替代方案：${decision.alternatives.map(markdown3).join("；") || "请按业务约束确定"}`, `- 风险：${decision.risks.map(markdown3).join("；") || "见实施风险"}`, `- 状态：${resolution ? `用户决定：${markdown3(resolution.decision)}（原话：${markdown3(resolution.evidence)}）` : `待决定${decision.affectsImplementation ? "，阻塞整份执行" : "，不影响当前实施"}`}`, "");
  }
  lines.push("", "## 评审结论", "", markdown3(contract.review.summary), ...contract.review.issues.map(issue => `- ${markdown3(issue.id)} [${issue.severity}/${issue.category}${issue.blocking ? "，阻塞" : ""}]：${markdown3(issue.problem)}；修复建议：${markdown3(issue.fixSuggestion)}；依据：${markdown3(issue.evidence)}`));
  if (plan.findings.length) lines.push("", "## 排查发现", "", ...plan.findings.map(finding => `- ${markdown3(finding.id)} [${finding.status === "static-confirmed" ? "静态已确认" : "未确认"}/${finding.severity}] ${markdown3(finding.location)} ${markdown3(finding.symbol)}：${markdown3(finding.title)}；触发：${markdown3(finding.trigger)}；影响：${markdown3(finding.impact)}；修复建议：${markdown3(finding.fixSuggestion)}；验证方式：${markdown3(finding.verification)}；确认依据：${markdown3(finding.confirmation)}；证据 ${finding.evidenceIds.map(markdown3).join("、")}`));
  lines.push("", "## 证据来源", "", ...plan.evidence.map(item => `- ${markdown3(item.id)} [${item.kind}] ${markdown3(item.location)}：${markdown3(item.observation)}；版本 ${markdown3(item.version)}；许可 ${markdown3(item.license)}；访问 ${markdown3(item.accessed)}`), "", "## 假设、范围与上线测试", "", ...plan.assumptions.map(item => `- 假设：${markdown3(item)}`), ...plan.notDoing.map(item => `- 不包含：${markdown3(item)}`), ...plan.rollout.map(item => `- ${markdown3(item)}`), "", "## 支持材料", "", ...contract.supports.map(item => `- [${markdown3(item.path)}](${link3(item.path)})`), "", "本轮只读分析，不运行项目检查。静态确认不等于运行时复现或性能测量；服务、远端检查和部署需要另外明确授权。", "", "修改方案请用自然语言交给 task-plan 重新复核；合同和支持材料通过内容摘要绑定，不是签名。", "", "<!-- TASK_RUN_CONTRACT_START -->", stableJson3(pointer), "<!-- TASK_RUN_CONTRACT_END -->", "");
  return lines.join("\n");
}
function parsePointer3(text: string): Pointer3 | null {
  const startMarker = "<!-- TASK_RUN_CONTRACT_START -->", endMarker = "<!-- TASK_RUN_CONTRACT_END -->";
  if (typeof text !== "string") throw new Error("contract marker input must be text");
  const start = text.indexOf(startMarker), end = text.indexOf(endMarker);
  if (start < 0 || end <= start || text.indexOf(startMarker, start + startMarker.length) >= 0 || text.indexOf(endMarker, end + endMarker.length) >= 0) throw new Error("expected one complete TASK_RUN_CONTRACT marker pair");
  let value: unknown;
  try { value = JSON.parse(text.slice(start + startMarker.length, end).trim()); } catch { throw new Error("contract marker contains malformed JSON"); }
  if (!record3(value)) throw new Error("contract marker must contain an object");
  if (value.contractVersion === 2) {
    if (!keys3(value, ["contractVersion", "mode", "allowShell", "approvalRequired", "approved", "review", "reviewedPlanSnapshot", "reviewedReviewHash", "resolutions", "plan"]) || !["standard", "strict"].includes(String(value.mode)) || typeof value.allowShell !== "boolean" || typeof value.approvalRequired !== "boolean" || typeof value.approved !== "boolean" || !record3(value.plan) || !record3(value.review) || !Array.isArray(value.resolutions) || typeof value.reviewedPlanSnapshot !== "string" || !hashLabel3(value.reviewedReviewHash) || value.reviewedPlanSnapshot !== stableJson3(value.plan) || value.reviewedReviewHash !== hash3(stableJson3(value.review))) throw new Error("malformed v2 contract; legacy dispatch refused");
    return null;
  }
  if (value.contractVersion !== 3) throw new Error(`unsupported contract marker version ${String(value.contractVersion)}`);
  if (!keys3(value, ["contractVersion", "contractPath", "contractHash"]) || typeof value.contractPath !== "string" || path3(value.contractPath) !== value.contractPath || !hashLabel3(value.contractHash)) throw new Error("malformed v3 pointer path/hash; legacy reinterpretation refused");
  return value as unknown as Pointer3;
}
function token3(contract: Contract3, reasons: string[]): string { return `ct3-${hash3(stableJson3({ contract, reasons })).slice(7)}`; }

// Fixed programs are embedded by scripts/sync-core.cjs.
const IO_PROGRAM3 = "const fs = require('node:fs');\nconst path = require('node:path');\nconst crypto = require('node:crypto');\nconst cp = require('node:child_process');\nconst [op, encoded] = process.argv.slice(1);\nconst p = JSON.parse(encoded);\nconst cwd = fs.realpathSync.native(process.cwd());\nconst digest = data => 'sha256:' + crypto.createHash('sha256').update(data).digest('hex');\nconst lower = s => process.platform === 'win32' ? s.toLowerCase() : s;\nconst bounded = abs => lower(abs) === lower(cwd) || lower(abs).startsWith(lower(cwd + path.sep));\nconst safe = raw => {\n  if (typeof raw !== 'string' || !raw || raw !== raw.trim() || /[\\x00-\\x1f\\x7f:*?\\[\\]{}<>\"|]/.test(raw)) throw Error('unsafe relative path');\n  const parts = raw.replace(/\\\\/g, '/').split('/');\n  if (parts.some(s => !s || s === '.' || s === '..' || s.toLowerCase() === '.git' || /[. ]$/.test(s) || /^(con|prn|aux|nul|conin\\$|conout\\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\\.|$)/i.test(s))) throw Error('unsafe path component');\n  const abs = path.resolve(cwd, ...parts);\n  if (!bounded(abs)) throw Error('path escapes workspace');\n  let current = cwd;\n  for (const part of parts) {\n    current = path.join(current, part);\n    if (!fs.existsSync(current)) { try { fs.lstatSync(current); } catch (e) { if (e.code === 'ENOENT') continue; throw e; } }\n    const st = fs.lstatSync(current);\n    if (st.isSymbolicLink() || !bounded(fs.realpathSync.native(current))) throw Error('symlink/reparse path refused: ' + raw);\n  }\n  return abs;\n};\nconst rel = abs => path.relative(cwd, abs).split(path.sep).join('/');\nconst inside = (file, scopes) => scopes.some(scope => scope === '.' || file.toLowerCase() === scope.toLowerCase() || file.toLowerCase().startsWith(scope.toLowerCase() + '/'));\nconst root = () => {\n  if (typeof p.ioRoot !== 'string' || !/^\\.zcode\\/task-(?:plans|runs)\\/[0-9a-f]{64}$/.test(p.ioRoot)) throw Error('missing exact workflow IO root');\n  return safe(p.ioRoot);\n};\nconst writable = raw => {\n  const abs = safe(raw);\n  if (!inside(raw, [p.ioRoot]) && !(Array.isArray(p.planPaths) && p.planPaths.includes(raw))) throw Error('write is outside this workflow owned root/approved plan path');\n  root();\n  return abs;\n};\nconst hashFile = abs => {\n  let st;\n  try { st = fs.lstatSync(abs); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }\n  if (!st.isFile() || st.isSymbolicLink()) throw Error('not a regular file: ' + rel(abs));\n  const h = crypto.createHash('sha256');\n  const fd = fs.openSync(abs, 'r');\n  const buf = Buffer.allocUnsafe(1024 * 1024);\n  try { let n; while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n)); } finally { fs.closeSync(fd); }\n  const after = fs.statSync(abs);\n  if (st.size !== after.size || st.mtimeMs !== after.mtimeMs || st.ino !== after.ino || st.mode !== after.mode) throw Error('file changed during hash: ' + rel(abs));\n  return 'sha256:' + h.digest('hex');\n};\nconst mkdir = abs => { if (fs.existsSync(abs)) { if (!fs.statSync(abs).isDirectory()) throw Error('parent is not directory'); return; } mkdir(path.dirname(abs)); fs.mkdirSync(abs); };\nconst gitRead = argv => cp.spawnSync('git', argv, { cwd, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });\nconst metadata = () => {\n  const top = gitRead(['rev-parse', '--show-toplevel']);\n  if (top.error && fs.existsSync(path.join(cwd, '.git'))) throw top.error;\n  if (top.status !== 0) {\n    if (fs.existsSync(path.join(cwd, '.git'))) throw Error('Git metadata is present but unreadable');\n    return { kind: 'filesystem', head: null, branch: null, stash: null };\n  }\n  if (lower(fs.realpathSync.native(top.stdout.trim())) !== lower(cwd)) throw Error('workflow cwd must be the repository root');\n  const h = gitRead(['rev-parse', '--verify', 'HEAD']);\n  const branch = gitRead(['symbolic-ref', '--quiet', '--short', 'HEAD']);\n  if (![0, 1].includes(branch.status)) throw Error('Git branch unreadable');\n  if (h.status !== 0) {\n    const refs = gitRead(['show-ref']);\n    if (h.error || refs.error || refs.status !== 1 || refs.stdout.trim() || branch.status !== 0 || !branch.stdout.trim()) throw Error('Git HEAD unreadable, not a verified unborn repository');\n    return { kind: 'git', head: null, branch: branch.stdout.trim(), stash: null };\n  }\n  const stash = gitRead(['stash', 'list', '--format=%H']);\n  if (stash.error || stash.status !== 0) throw Error('Git stash unreadable');\n  return { kind: 'git', head: h.stdout.trim(), branch: branch.status === 0 ? branch.stdout.trim() : null, stash: stash.stdout.trim() ? digest(stash.stdout).slice(7) : null };\n};\nconst snapshot = () => {\n  root();\n  const scopes = p.scopes;\n  const exclude = p.exclude;\n  if (!Array.isArray(scopes) || !scopes.length || !Array.isArray(exclude) || !(p.inspectOwned === true ? scopes.length === 1 && scopes[0] === p.ioRoot && exclude.includes(p.ioRoot + '/io') : exclude.includes(p.ioRoot))) throw Error('snapshot requires explicit scopes and exact IO exclusion');\n  for (const scope of scopes) if (scope !== '.') safe(scope);\n  for (const item of exclude) safe(item);\n  const before = metadata();\n  const files = [];\n  const walk = abs => {\n    const relative = rel(abs);\n    if (relative && inside(relative, exclude)) return;\n    const st = fs.lstatSync(abs);\n    if (st.isSymbolicLink()) throw Error('snapshot refuses symlinks/reparse points: ' + relative);\n    if (!bounded(fs.realpathSync.native(abs))) throw Error('snapshot path escapes workspace');\n    if (st.isDirectory()) {\n      for (const name of fs.readdirSync(abs).sort()) {\n        if (name.toLowerCase() === '.git') continue;\n        const candidate = relative ? relative + '/' + name : name;\n        if (inside(candidate, scopes) || scopes.some(scope => scope !== '.' && scope.toLowerCase().startsWith(candidate.toLowerCase() + '/'))) walk(path.join(abs, name));\n      }\n    } else if (st.isFile() && inside(relative, scopes)) {\n      safe(relative);\n      if (files.length >= 120000) throw Error('snapshot exceeds 120000 files; no partial baseline accepted');\n      files.push({ path: relative, hash: hashFile(abs), mode: st.mode & 0o7777 });\n    } else if (!st.isFile()) throw Error('snapshot contains unsupported special file');\n  };\n  walk(cwd);\n  const after = metadata();\n  if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('Git changed during snapshot');\n  const text = JSON.stringify({ ...before, files: files.sort((a,b) => a.path.localeCompare(b.path)), scopes }) + '\\n';\n  if (Buffer.byteLength(text) > 32 * 1024 * 1024) throw Error('snapshot exceeds 32 MiB; no partial baseline accepted');\n  if (p.readOnlySnapshot === true) return { snapshot: { ...before, files: files.sort((a,b) => a.path.localeCompare(b.path)), scopes } };\n  const hash = digest(text);\n  const targetPath = p.ioRoot + '/io/snapshot-' + hash.slice(7) + '.json';\n  const target = writable(targetPath);\n  mkdir(path.dirname(target));\n  const existing = hashFile(target);\n  if (existing !== null && existing !== hash) throw Error('immutable snapshot target already differs');\n  if (existing === null) fs.writeFileSync(target, text, { flag: 'wx' });\n  return { path: targetPath, hash, bytes: Buffer.byteLength(text) };\n};\nlet result;\ntry {\n  if (op === 'hash') result = { hash: hashFile(safe(p.path)) };\n  else if (op === 'hashes') {\n    if (!Array.isArray(p.paths) || p.paths.length > 64) throw Error('hash batch must contain at most 64 paths');\n    result = Object.fromEntries(p.paths.map(raw => [raw, hashFile(safe(raw))]));\n  }\n  else if (op === 'text') {\n    const abs = safe(p.path);\n    const st = fs.statSync(abs);\n    if (!st.isFile() || st.size > 32 * 1024 * 1024) throw Error('text must be a regular file no larger than 32 MiB');\n    if (st.size > 1024 * 1024) result = { chunked: true, bytes: st.size, hash: hashFile(abs) };\n    else {\n      const content = fs.readFileSync(abs);\n      const hash = digest(content);\n      if (hashFile(abs) !== hash) throw Error('text changed during read');\n      const text = content.toString('utf8');\n      if (digest(Buffer.from(text)) !== hash) throw Error('text is not valid UTF-8');\n      result = { chunked: false, text, hash };\n    }\n  }\n  else if (op === 'meta') {\n    const abs = safe(p.path);\n    const st = fs.statSync(abs);\n    if (!st.isFile() || st.size > 32 * 1024 * 1024) throw Error('text must be a regular file no larger than 32 MiB');\n    result = { bytes: st.size, hash: hashFile(abs) };\n  } else if (op === 'read') {\n    const abs = safe(p.path);\n    if (hashFile(abs) !== p.expectedHash) throw Error('text changed during chunked read');\n    const buffer = Buffer.alloc(p.length);\n    const fd = fs.openSync(abs, 'r');\n    let n;\n    try { n = fs.readSync(fd, buffer, 0, p.length, p.offset); } finally { fs.closeSync(fd); }\n    result = { data: buffer.subarray(0, n).toString('base64') };\n  } else if (op === 'begin') {\n    const target = writable(p.path), temp = writable(p.temp);\n    if (hashFile(target) !== p.expectedHash) throw Error('target changed before atomic write');\n    mkdir(path.dirname(temp));\n    const content = Buffer.alloc(0);\n    if (hashFile(temp) === null) fs.writeFileSync(temp, content, { flag: 'wx' });\n    else if (fs.statSync(temp).size > p.bytes) throw Error('stale oversized temporary write; restore from checkpoint');\n    result = { ok: true };\n  } else if (op === 'chunk') {\n    const abs = writable(p.temp);\n    const data = Buffer.from(p.data, 'base64');\n    const size = fs.statSync(abs).size;\n    if (size > p.offset && size >= p.offset + data.length) {\n      const previous = Buffer.alloc(data.length);\n      const fd = fs.openSync(abs,'r');\n      try { fs.readSync(fd,previous,0,previous.length,p.offset); } finally { fs.closeSync(fd); }\n      if (!previous.equals(data)) throw Error('existing write chunk differs');\n    } else {\n      if (size !== p.offset) throw Error('write chunk offset mismatch');\n      fs.appendFileSync(abs, data);\n    }\n    result = { ok: true };\n  } else if (op === 'commit') {\n    const target = writable(p.path), temp = writable(p.temp);\n    if (hashFile(temp) !== p.outputHash || hashFile(target) !== p.expectedHash) throw Error('atomic write content or target CAS mismatch');\n    mkdir(path.dirname(target));\n    if (p.expectedHash === null) { fs.linkSync(temp, target); fs.unlinkSync(temp); }\n    else { const mode = fs.statSync(target).mode & 0o777; fs.chmodSync(temp, mode); fs.renameSync(temp, target); }\n    if (hashFile(target) !== p.outputHash) throw Error('atomic write verification failed');\n    result = { ok: true };\n  } else if (op === 'snapshot') result = snapshot();\n  else if (op === 'index') {\n    const meta = metadata();\n    if (meta.kind !== 'git') result = { hash: null };\n    else {\n      const index = gitRead(['rev-parse', '--git-path', 'index']);\n      if (index.status !== 0) throw Error('Git index path unavailable');\n      const abs = path.resolve(cwd, index.stdout.trim());\n      if (!bounded(abs)) throw Error('Git index must remain inside repository');\n      const indexHash = hashFile(abs);\n      result = { hash: indexHash ?? digest('verified absent Git index') };\n    }\n  } else if (op === 'dirty') {\n    const meta = metadata();\n    if (meta.kind !== 'git') result = { paths: [] };\n    else {\n      const status = gitRead(['status', '--porcelain=v1', '-z', '--untracked-files=all']);\n      if (status.error || status.status !== 0) throw Error('Git status unreadable');\n      const entries = status.stdout.split('\\0');\n      const paths = [];\n      for (let index = 0; index < entries.length; index += 1) {\n        const entry = entries[index];\n        if (!entry) continue;\n        paths.push(entry.slice(3).replace(/\\\\/g,'/'));\n        if (/R|C/.test(entry.slice(0,2))) { index += 1; if (entries[index]) paths.push(entries[index].replace(/\\\\/g,'/')); }\n      }\n      result = { paths: [...new Set(paths)].sort() };\n    }\n  }\n  else if (op === 'decode') result = { text: Buffer.from(p.data, 'base64').toString('utf8') };\n  else throw Error('unknown IO operation');\n  process.stdout.write(JSON.stringify({ ok: true, result }));\n} catch (e) { process.stdout.write(JSON.stringify({ ok: false, error: String(e && e.message || e) })); process.exitCode = 1; }\n";
const APPLY_PROGRAM3 = "const fs = require('node:fs');\nconst path = require('node:path');\nconst crypto = require('node:crypto');\nconst [encoded] = process.argv.slice(1);\nconst p = JSON.parse(encoded);\nconst cwd = fs.realpathSync.native(process.cwd());\nconst digest = data => 'sha256:' + crypto.createHash('sha256').update(data).digest('hex');\nconst inside = (file, scopes) => scopes.some(scope => file.toLowerCase() === scope.toLowerCase() || file.toLowerCase().startsWith(scope.toLowerCase() + '/'));\nconst safe = raw => {\n  if (typeof raw !== 'string' || !raw || raw !== raw.trim() || /[\\x00-\\x1f\\x7f:*?\\[\\]{}<>\"|]/.test(raw)) throw Error('unsafe path');\n  const parts = raw.replace(/\\\\/g, '/').split('/');\n  if (parts.some(s => !s || s === '.' || s === '..' || s.toLowerCase() === '.git' || /[. ]$/.test(s) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\\.|$)/i.test(s))) throw Error('unsafe path component');\n  const abs = path.resolve(cwd, ...parts);\n  const bounded = x => x.toLowerCase() === cwd.toLowerCase() || x.toLowerCase().startsWith((cwd + path.sep).toLowerCase());\n  if (!bounded(abs)) throw Error('path escapes workspace');\n  let current = cwd;\n  for (const part of parts) {\n    current = path.join(current, part);\n    let st;\n    try { st = fs.lstatSync(current); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }\n    if (st.isSymbolicLink() || !bounded(fs.realpathSync.native(current))) throw Error('symlink/reparse path refused');\n  }\n  return abs;\n};\nconst hash = abs => {\n  try {\n    const st = fs.lstatSync(abs);\n    if (!st.isFile() || st.isSymbolicLink()) throw Error('not a regular file');\n    const h = crypto.createHash('sha256');\n    const fd = fs.openSync(abs,'r');\n    const buffer = Buffer.allocUnsafe(1024 * 1024);\n    try { let length; while ((length = fs.readSync(fd,buffer,0,buffer.length,null)) > 0) h.update(buffer.subarray(0,length)); }\n    finally { fs.closeSync(fd); }\n    const after = fs.statSync(abs);\n    if (st.ino !== after.ino || st.size !== after.size || st.mtimeMs !== after.mtimeMs || st.mode !== after.mode) throw Error('file changed during hash');\n    return 'sha256:' + h.digest('hex');\n  } catch (e) { if (e.code === 'ENOENT') return null; throw e; }\n};\nconst mkdir = (abs, made) => {\n  if (fs.existsSync(abs)) { if (!fs.statSync(abs).isDirectory()) throw Error('parent not directory'); return; }\n  mkdir(path.dirname(abs), made); fs.mkdirSync(abs); made.push(abs);\n};\nconst validHash = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);\nconst prepared = [];\nconst applied = [];\nconst createdDirs = [];\nconst temporaryFiles = new Set();\nlet transactionRoot = null;\nconst writeTemporary = (abs, content, expected, message) => {\n  const fd = fs.openSync(abs, 'wx', 0o600);\n  temporaryFiles.add(abs);\n  try { fs.writeFileSync(fd, content); } finally { fs.closeSync(fd); }\n  if (hash(abs) !== expected) throw Error(message);\n};\ntry {\n  if (!/^\\.zcode\\/task-runs\\/[a-f0-9]{64}$/.test(p.ioRoot) || !/^\\.zcode\\/task-runs\\/[a-f0-9]{64}\\/.+/.test(p.stageRoot) || !inside(p.stageRoot, [p.ioRoot])) throw Error('stage root not owned by current run');\n  if (inside(p.stageRoot, [p.ioRoot + '/controller'])) throw Error('controller root overlaps worker staging');\n  const manifestAbs = safe(p.stageRoot + '/manifest.json');\n  const scopeAbs = safe(p.taskPath);\n  if (hash(manifestAbs) !== p.manifestHash || hash(scopeAbs) !== p.taskHash) throw Error('manifest/task changed after validation');\n  const taskText = fs.readFileSync(scopeAbs, 'utf8');\n  const manifestText = fs.readFileSync(manifestAbs, 'utf8');\n  if (digest(taskText) !== p.taskHash || digest(manifestText) !== p.manifestHash) throw Error('manifest/task buffers changed during read');\n  const task = JSON.parse(taskText);\n  const manifest = JSON.parse(manifestText);\n  if (!task || !Array.isArray(task.files) || !manifest || Object.keys(manifest).some(k => k !== 'changes') || !Array.isArray(manifest.changes)) throw Error('invalid task/manifest');\n  const seen = new Set();\n  for (const change of manifest.changes) {\n    if (!change || Object.keys(change).some(k => !['action','path','baseHash','outputHash','mode'].includes(k)) || !inside(change.path, task.files) || inside(change.path, ['.zcode/task-plans','.zcode/task-runs']) || (p.protectedPaths || []).some(x => inside(x, [change.path]) || inside(change.path, [x]))) throw Error('target outside approved scope or protected');\n    if (seen.has(change.path.toLowerCase())) throw Error('duplicate manifest target');\n    seen.add(change.path.toLowerCase());\n    const target = safe(change.path);\n    const currentHash = hash(target);\n    if (currentHash !== change.baseHash) throw Error('target CAS mismatch: ' + change.path);\n    if (change.action !== 'put' && change.action !== 'delete') throw Error('invalid manifest action');\n    if (change.action === 'delete' && (currentHash === null || change.outputHash !== null || !task.files.includes(change.path))) throw Error('delete requires exact approved existing target');\n    if (change.action === 'put' && !validHash(change.outputHash)) throw Error('missing output hash');\n    if (change.mode !== undefined && (!Number.isInteger(change.mode) || change.mode < 0 || change.mode > 511 || change.action !== 'put')) throw Error('invalid mode');\n    const stageAbs = change.action === 'put' ? safe(p.stageRoot + '/files/' + change.path) : null;\n    if (stageAbs && (fs.statSync(stageAbs).size > 32 * 1024 * 1024 || hash(stageAbs) !== change.outputHash)) throw Error('staged content hash mismatch or exceeds 32 MiB');\n    if (currentHash !== null && fs.statSync(target).size > 32 * 1024 * 1024) throw Error('transaction target exceeds 32 MiB rollback cap');\n    const oldMode = currentHash === null ? 0o644 : fs.statSync(target).mode & 0o7777;\n    const oldContent = currentHash === null ? null : fs.readFileSync(target);\n    const content = stageAbs ? fs.readFileSync(stageAbs) : null;\n    if (oldContent !== null && (oldContent.length > 32 * 1024 * 1024 || digest(oldContent) !== change.baseHash)) throw Error('original buffer changed during preparation or exceeds 32 MiB');\n    if (content !== null && (content.length > 32 * 1024 * 1024 || digest(content) !== change.outputHash)) throw Error('staged buffer changed during preparation or exceeds 32 MiB');\n    prepared.push({ change, target, oldMode, oldContent, content, temp: null, backup: null, appliedMode: null });\n  }\n  if (prepared.length) {\n    const controllerRoot = safe(p.ioRoot + '/controller');\n    if (!fs.existsSync(controllerRoot)) fs.mkdirSync(controllerRoot, { mode: 0o700 });\n    if (!fs.lstatSync(controllerRoot).isDirectory()) throw Error('controller root not directory');\n    safe(p.ioRoot + '/controller');\n    transactionRoot = fs.mkdtempSync(path.join(controllerRoot, 'transaction-'));\n    safe(path.relative(cwd, transactionRoot).split(path.sep).join('/'));\n    fs.chmodSync(transactionRoot, 0o700);\n    for (const item of prepared) {\n      const suffix = digest(item.change.path).slice(7);\n      if (item.oldContent !== null) {\n        item.backup = path.join(transactionRoot, 'rollback-' + suffix);\n        writeTemporary(item.backup, item.oldContent, item.change.baseHash, 'temporary rollback does not match original buffer');\n        fs.chmodSync(item.backup, item.oldMode);\n      }\n      if (item.content !== null) {\n        item.temp = path.join(transactionRoot, 'apply-' + suffix);\n        writeTemporary(item.temp, item.content, item.change.outputHash, 'temporary output does not match staged buffer');\n      }\n    }\n  }\n  if (hash(manifestAbs) !== p.manifestHash || hash(scopeAbs) !== p.taskHash) throw Error('staging input changed during preparation');\n  const workspaceContent = () => {\n    const stamps = [];\n    const walk = (abs, relative) => {\n      if (relative && inside(relative, [p.ioRoot])) return;\n      const st = fs.lstatSync(abs);\n      if (st.isSymbolicLink()) throw Error('symlink appeared during apply');\n      if (st.isDirectory()) for (const name of fs.readdirSync(abs).sort()) { if (name.toLowerCase() !== '.git') walk(path.join(abs,name),relative ? relative + '/' + name : name); }\n      else if (st.isFile()) stamps.push({ path: relative, hash: hash(abs), mode: st.mode & 0o7777 });\n      else throw Error('special file appeared during apply');\n    };\n    walk(cwd,'');\n    return stamps.sort((a,b) => a.path.localeCompare(b.path));\n  };\n  const before = JSON.parse(fs.readFileSync(safe(p.beforePath), 'utf8'));\n  if (JSON.stringify(workspaceContent()) !== JSON.stringify(before.files)) throw Error('workspace changed before transaction');\n  for (const item of prepared) {\n    const { change, target } = item;\n    safe(change.path);\n    if (hash(target) !== change.baseHash || (change.baseHash !== null && (fs.statSync(target).mode & 0o7777) !== item.oldMode)) throw Error('target content or mode changed immediately before apply');\n    if (change.action === 'put') {\n      const temp = item.temp;\n      if (hash(temp) !== change.outputHash) throw Error('temporary output changed before apply');\n      mkdir(path.dirname(target), createdDirs);\n      if (change.baseHash === null) {\n        fs.linkSync(temp,target);\n        applied.push(item);\n        item.appliedMode = fs.statSync(target).mode & 0o7777;\n        fs.unlinkSync(temp);\n        temporaryFiles.delete(temp);\n      } else {\n        fs.renameSync(temp,target);\n        temporaryFiles.delete(temp);\n        applied.push(item);\n        item.appliedMode = fs.statSync(target).mode & 0o7777;\n      }\n      fs.chmodSync(target,change.mode === undefined ? item.oldMode : change.mode);\n      item.appliedMode = fs.statSync(target).mode & 0o7777;\n      if (hash(target) !== change.outputHash) throw Error('applied output mismatch');\n    } else { fs.unlinkSync(target); applied.push(item); }\n    if (p.failAfter === applied.length) throw Error('injected fixture transaction failure');\n  }\n  process.stdout.write(JSON.stringify({ ok: true, paths: prepared.map(item => item.change.path) }));\n} catch (e) {\n  const rollbackErrors = [];\n  for (const item of applied.reverse()) {\n    let writableMode = null;\n    try {\n      safe(item.change.path);\n      const expected = item.change.action === 'put' ? item.change.outputHash : null;\n      if (hash(item.target) !== expected || (expected !== null && item.appliedMode !== null && (fs.statSync(item.target).mode & 0o7777) !== item.appliedMode)) throw Error('externally changed output or mode; not rolling back');\n      if (item.oldContent !== null && hash(item.backup) !== item.change.baseHash) throw Error('prepared rollback backup changed');\n      if (expected !== null && process.platform === 'win32' && (item.appliedMode & 0o222) === 0) {\n        fs.chmodSync(item.target,item.appliedMode | 0o200);\n        writableMode = fs.statSync(item.target).mode & 0o7777;\n      }\n      if (item.oldContent === null) fs.unlinkSync(item.target);\n      else {\n        const tmp = item.backup;\n        if (expected === null) {\n          fs.linkSync(tmp,item.target);\n          fs.unlinkSync(tmp);\n        } else fs.renameSync(tmp,item.target);\n        temporaryFiles.delete(tmp);\n        fs.chmodSync(item.target,item.oldMode);\n      }\n    } catch (rollback) {\n      try {\n        safe(item.change.path);\n        if (writableMode !== null && item.change.action === 'put' && item.appliedMode !== null && hash(item.target) === item.change.outputHash && (fs.statSync(item.target).mode & 0o7777) === writableMode) fs.chmodSync(item.target,item.appliedMode);\n      } catch {}\n      rollbackErrors.push(item.change.path + ': ' + String(rollback.message || rollback));\n    }\n  }\n  for (const dir of createdDirs.reverse()) {\n    try { safe(path.relative(cwd,dir).split(path.sep).join('/')); fs.rmdirSync(dir); } catch {}\n  }\n  process.stdout.write(JSON.stringify({ ok:false,error:String(e.message || e),rollbackErrors }));\n  process.exitCode=1;\n} finally {\n  for (const temp of temporaryFiles) {\n    try { safe(path.relative(cwd,temp).split(path.sep).join('/')); fs.unlinkSync(temp); } catch {}\n  }\n  if (transactionRoot !== null) {\n    try { safe(path.relative(cwd,transactionRoot).split(path.sep).join('/')); fs.rmdirSync(transactionRoot); } catch {}\n  }\n}\n";
const CHECK_PROGRAM3 = "const cp = require('node:child_process');\nconst fs = require('node:fs');\nconst path = require('node:path');\nconst p = JSON.parse(process.argv[1]);\nconst cwd = fs.realpathSync(process.cwd());\nlet program = p.program;\nlet argv = p.args;\nconst outputLimit = 16384;\nconst commandLimit = 30000;\nconst tail = value => Buffer.from(value || '').subarray(-outputLimit).toString('utf8');\ntry {\n  if (typeof program !== 'string' || !Array.isArray(argv) || !argv.every(x => typeof x === 'string')) throw Error('invalid check argv');\n  if (p.shell !== null) {\n    if (!p.allowShell) throw Error('shell not authorized');\n    if (process.platform === 'win32') { program = process.env.ComSpec || 'cmd.exe'; argv = ['/d','/s','/c',p.shell]; }\n    else { program = '/bin/sh'; argv = ['-c',p.shell]; }\n  } else if (process.platform === 'win32' && ['npm','pnpm','yarn'].includes(program.toLowerCase())) {\n    const names = program.toLowerCase() === 'npm' ? ['node_modules/npm/bin/npm-cli.js'] : program.toLowerCase() === 'pnpm' ? ['node_modules/pnpm/bin/pnpm.cjs','node_modules/corepack/dist/pnpm.js'] : ['node_modules/yarn/bin/yarn.js','node_modules/corepack/dist/yarn.js'];\n    const directories = [path.dirname(process.execPath),...String(process.env.PATH || '').split(path.delimiter)];\n    const script = directories.flatMap(dir => names.map(name => path.join(dir,name))).find(name => fs.existsSync(name) && fs.statSync(name).isFile());\n    if (!script) throw Object.assign(Error('non-shell package-manager CLI not found; install the tool or explicitly authorize shell'),{ code:'ENOENT' });\n    argv = [script,...argv]; program = process.execPath;\n  } else if (process.platform === 'win32' && /\\.(?:bat|cmd)$/i.test(program)) throw Object.assign(Error('Windows batch check requires explicit shell authorization'),{ code:'EACCES' });\n  if ([program,...argv].reduce((n,x) => n + x.length * 2 + 4,0) > commandLimit) throw Error('check command exceeds Windows argv budget');\n  const result = cp.spawnSync(program,argv,{ cwd,encoding:'utf8',shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:p.timeoutMs,maxBuffer:16 * 1024 * 1024 });\n  let exitCode = typeof result.status === 'number' ? result.status : 1;\n  let errorKind = '';\n  if (result.error) {\n    if (result.error.code === 'ETIMEDOUT' || result.signal === 'SIGTERM') { exitCode=124;errorKind='timeout'; }\n    else if (result.error.code === 'ENOENT') { exitCode=127;errorKind='missing-tool'; }\n    else if (result.error.code === 'EACCES') { exitCode=126;errorKind='spawn'; }\n    else if (result.error.code === 'ENOBUFS') { exitCode=125;errorKind='output-cap'; }\n    else { exitCode=126;errorKind='spawn'; }\n  } else if (result.signal) { exitCode=124;errorKind='signal'; }\n  process.stdout.write(JSON.stringify({exitCode,stdout:tail(result.stdout),stderr:tail(result.stderr) + (result.error ? '\\n' + String(result.error.message) : ''),errorKind}));\n} catch (error) { process.stdout.write(JSON.stringify({exitCode:error.code === 'ENOENT' ? 127 : 126,stdout:'',stderr:String(error.message || error),errorKind:error.code === 'ENOENT' ? 'missing-tool' : 'spawn'})); }\n";
let ioRoot3 = "";
const protectedApplyPaths3 = new Set<string>();

function authorizeIoRoot3(path: string): void {
  if (!/^\.zcode\/task-(?:plans|runs)\/[0-9a-f]{64}$/.test(path) || path3(path) !== path) throw new Error("invalid exact workflow IO root");
  if (ioRoot3 && ioRoot3 !== path) throw new Error("workflow IO root cannot change during a run");
  ioRoot3 = path;
}

function authorizePlanPath3(path: string): void {
  const canonical = path3(path);
  if (canonical !== path || !path.toLowerCase().endsWith(".md") || owned3(path)) throw new Error("invalid approved plan path");
  authorizedPlanPaths3.add(path);
}

function protectApplyPaths3(paths: string[]): void {
  for (const path of paths) {
    if (path3(path) !== path) throw new Error("invalid protected path");
    if (within3(path, [...protectedApplyPaths3])) continue;
    for (const previous of protectedApplyPaths3) if (within3(previous, [path])) protectedApplyPaths3.delete(previous);
    protectedApplyPaths3.add(path);
  }
}

function base64Bytes3(bytes: number[]): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    result += alphabet[(n >>> 18) & 63] + alphabet[(n >>> 12) & 63] + (i + 1 < bytes.length ? alphabet[(n >>> 6) & 63] : "=") + (i + 2 < bytes.length ? alphabet[n & 63] : "=");
  }
  return result;
}

function unbase64Bytes3(value: string): number[] {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const result: number[] = [];
  for (let i = 0; i < value.length; i += 4) {
    const n = (alphabet.indexOf(value[i]) << 18) | (alphabet.indexOf(value[i + 1]) << 12) | ((value[i + 2] === "=" ? 0 : alphabet.indexOf(value[i + 2])) << 6) | (value[i + 3] === "=" ? 0 : alphabet.indexOf(value[i + 3]));
    result.push((n >>> 16) & 255);
    if (value[i + 2] !== "=") result.push((n >>> 8) & 255);
    if (value[i + 3] !== "=") result.push(n & 255);
  }
  return result;
}

function decodeUtf83(bytes: number[]): string {
  let result = "";
  for (let i = 0; i < bytes.length;) {
    const a = bytes[i++];
    if (a < 128) { result += String.fromCharCode(a); continue; }
    const count = a >= 240 && a <= 244 ? 3 : a >= 224 && a <= 239 ? 2 : a >= 194 && a <= 223 ? 1 : 0;
    if (!count || i + count > bytes.length) { result += "\ufffd"; continue; }
    let n = a & (count === 3 ? 7 : count === 2 ? 15 : 31);
    let valid = true;
    for (let k = 0; k < count; k += 1) { const b = bytes[i + k]; if ((b & 192) !== 128) valid = false; n = (n << 6) | (b & 63); }
    const minimum = count === 3 ? 65536 : count === 2 ? 2048 : 128;
    if (!valid || n < minimum || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) { result += "\ufffd"; continue; }
    i += count;
    result += String.fromCodePoint(n);
  }
  return result;
}

function compactProgram3(value: string): string {
  return value.split("\n").map(line => line.trim()).filter(Boolean).join("\n");
}

async function io3(operation: string, payload: unknown): Promise<any> {
  if (!record3(payload)) throw new Error("IO payload must be an object");
  const text = JSON.stringify({ ...payload, ioRoot: ioRoot3, planPaths: [...authorizedPlanPaths3] });
  const code = compactProgram3(IO_PROGRAM3);
  if (code.length + text.length * 2 + 128 > 30000) throw new Error("IO request exceeds Windows argv budget; split input");
  const outcome = await world.run("node", ["-e", code, operation, text], { timeoutMs: operation === "snapshot" ? 1800000 : 120000, output: "full" });
  let result: unknown;
  try { result = JSON.parse(outcome.stdout); } catch { throw new Error(`IO returned malformed output: ${outcome.stderr.slice(-1024)}`); }
  if (outcome.exitCode !== 0 || !record3(result) || result.ok !== true) throw new Error(record3(result) ? String(result.error ?? "IO failed") : "IO failed");
  return result.result;
}

async function fileHash3(path: string): Promise<string | null> {
  if (path3(path) !== path) throw new Error("unsafe file-hash path");
  const value = await io3("hash", { path });
  if (!record3(value) || (value.hash !== null && !hashLabel3(value.hash))) throw new Error("invalid file hash response");
  return value.hash as string | null;
}

async function fileHashes3(paths: string[]): Promise<Record<string, string | null>> {
  const output: Record<string, string | null> = {};
  const pending = unique3(paths);
  for (const path of pending) if (path3(path) !== path) throw new Error("unsafe file-hash path");
  for (let offset = 0; offset < pending.length; offset += 24) {
    const batch = pending.slice(offset, offset + 24);
    const value = await io3("hashes", { paths: batch });
    if (!record3(value) || Object.keys(value).length !== batch.length) throw new Error("invalid hash batch response");
    for (const path of batch) {
      if (value[path] !== null && !hashLabel3(value[path])) throw new Error(`invalid file hash response: ${path}`);
      output[path] = value[path] as string | null;
    }
  }
  return output;
}

async function readText3(path: string): Promise<string> {
  if (path3(path) !== path) throw new Error("unsafe text path");
  const quick = await io3("text", { path });
  if (!record3(quick) || !hashLabel3(quick.hash)) throw new Error("invalid text response");
  if (quick.chunked === false) {
    if (typeof quick.text !== "string" || hash3(quick.text) !== quick.hash) throw new Error("text content hash mismatch");
    return quick.text;
  }
  const meta = quick;
  if (typeof meta.bytes !== "number" || meta.bytes < 0 || meta.bytes > MAX_TEXT_BYTES3) throw new Error("invalid/oversized text metadata");
  const data: number[] = [];
  for (let offset = 0; offset < meta.bytes; offset += 65536) {
    const block = await io3("read", { path, offset, length: Math.min(65536, meta.bytes - offset), expectedHash: meta.hash });
    if (!record3(block) || typeof block.data !== "string") throw new Error("invalid text chunk");
    const bytes = unbase64Bytes3(block.data);
    for (const byte of bytes) data.push(byte);
  }
  if (await fileHash3(path) !== meta.hash) throw new Error("text changed during read");
  return decodeUtf83(data);
}

async function writeText3(path: string, text: string, expectedHash?: string | null): Promise<void> {
  if (!ioRoot3 || path3(path) !== path || (!within3(path, [ioRoot3]) && !authorizedPlanPaths3.has(path))) throw new Error("write outside exact owned root or approved plan path");
  const bytes = utf8Bytes3(text);
  if (bytes.length > MAX_TEXT_BYTES3) throw new Error("text exceeds 32 MiB write cap");
  const before = expectedHash === undefined ? await fileHash3(path) : expectedHash;
  const outputHash = hash3(text);
  if (before === outputHash) {
    if (await fileHash3(path) !== outputHash) throw new Error("target changed before no-op write");
    return;
  }
  const temp = `${ioRoot3}/io/write-${hash3(stableJson3({ path, before, outputHash })).slice(7)}.tmp`;
  await io3("begin", { path, temp, expectedHash: before, bytes: bytes.length });
  for (let offset = 0; offset < bytes.length; offset += 3072) await io3("chunk", { temp, offset, data: base64Bytes3(bytes.slice(offset, offset + 3072)) });
  await io3("commit", { path, temp, expectedHash: before, outputHash });
}

async function snapshot3(scopes: string[], exclude: string[]): Promise<Baseline3> {
  if (!ioRoot3) throw new Error("snapshot requires an authorized exact IO root");
  const stored = await io3("snapshot", { scopes, exclude: unique3([...exclude, ioRoot3]) });
  if (!record3(stored) || typeof stored.path !== "string" || !within3(stored.path, [ioRoot3])) throw new Error("snapshot path invalid");
  const text = await readText3(stored.path);
  if (hash3(text) !== stored.hash) throw new Error("snapshot content hash mismatch");
  const value: unknown = JSON.parse(text);
  const errors = baselineErrors3(value);
  if (errors.length) throw new Error(`snapshot invalid: ${errors.join("; ")}`);
  return value as Baseline3;
}

async function snapshotOwned3(): Promise<Baseline3> {
  const stored = await io3("snapshot", { scopes: [ioRoot3], exclude: [`${ioRoot3}/io`], inspectOwned: true });
  if (!record3(stored) || typeof stored.path !== "string" || !within3(stored.path, [ioRoot3])) throw new Error("owned snapshot path invalid");
  const text = await readText3(stored.path);
  if (hash3(text) !== stored.hash) throw new Error("snapshot content hash mismatch");
  const value: unknown = JSON.parse(text);
  const errors = baselineErrors3(value);
  if (errors.length) throw new Error(`owned snapshot invalid: ${errors.join("; ")}`);
  return value as Baseline3;
}

async function gitIndexHash3(): Promise<string | null> {
  const value = await io3("index", {});
  if (!record3(value) || (value.hash !== null && !hashLabel3(value.hash))) throw new Error("Git index response invalid");
  return value.hash as string | null;
}

async function gitDirtyPaths3(): Promise<string[]> {
  const value = await io3("dirty", {});
  if (!record3(value) || !Array.isArray(value.paths) || !value.paths.every(item => typeof item === "string" && path3(item) !== null)) throw new Error("Git dirty-path response invalid");
  return value.paths as string[];
}

async function runCheck3(check: Check3, mode: TaskMode3, allowShell: boolean, grants: string[]): Promise<{ exitCode: number; stdout: string; stderr: string; errorKind: string }> {
  const errors = checkErrors3(check, mode, allowShell);
  if (errors.length) return { exitCode: 126, stdout: "", stderr: errors.join("; "), errorKind: "validation" };
  if (check.permission !== "local-check" && !grants.includes(`check:${check.id}`)) return { exitCode: 126, stdout: "", stderr: `explicit user authorization missing: check:${check.id}`, errorKind: "permission" };
  const payload = JSON.stringify({ program: check.program, args: check.args, shell: check.shell, allowShell, timeoutMs: check.timeoutMs });
  const code = compactProgram3(CHECK_PROGRAM3);
  if (code.length + payload.length * 2 + 128 > 30000) return { exitCode: 126, stdout: "", stderr: "check exceeds Windows argv budget", errorKind: "argv-cap" };
  try {
    const output = await world.run("node", ["-e", code, payload], { timeoutMs: check.timeoutMs + 15000, output: "full" });
    const value: unknown = JSON.parse(output.stdout);
    if (output.exitCode !== 0 || !record3(value) || typeof value.exitCode !== "number" || typeof value.stdout !== "string" || typeof value.stderr !== "string" || typeof value.errorKind !== "string") throw new Error("invalid check output");
    return value as { exitCode: number; stdout: string; stderr: string; errorKind: string };
  } catch (error) { return { exitCode: 126, stdout: "", stderr: String(error), errorKind: "controller" }; }
}

async function applyStaged3(task: Task3, stageRoot: string, before: Baseline3): Promise<string[]> {
  if (!ioRoot3 || !within3(stageRoot, [ioRoot3]) || path3(stageRoot) !== stageRoot || baselineErrors3(before).length) throw new Error("invalid staging root/baseline");
  const taskText = `${JSON.stringify(task)}\n`;
  const beforeText = `${JSON.stringify(before)}\n`;
  const taskPath = `${stageRoot}/controller-task-${hash3(taskText).slice(7)}.json`;
  const beforePath = `${stageRoot}/controller-before-${hash3(beforeText).slice(7)}.json`;
  for (const [path, text] of [[taskPath, taskText], [beforePath, beforeText]]) {
    const existing = await fileHash3(path);
    if (existing !== null && existing !== hash3(text)) throw new Error("immutable apply input changed");
    if (existing === null) await writeText3(path, text, null);
  }
  const manifestPath = `${stageRoot}/manifest.json`;
  const manifestHash = await fileHash3(manifestPath);
  const taskHash = await fileHash3(taskPath);
  const payload = JSON.stringify({ ioRoot: ioRoot3, stageRoot, taskPath, taskHash, manifestHash, beforePath, protectedPaths: [...protectedApplyPaths3] });
  const code = compactProgram3(APPLY_PROGRAM3);
  if (code.length + payload.length * 2 + 128 > 30000) throw new Error("staged apply exceeds Windows argv budget");
  const outcome = await world.run("node", ["-e", code, payload], { timeoutMs: 1800000, output: "full" });
  let result: unknown;
  try { result = JSON.parse(outcome.stdout); } catch { throw new Error("staged apply returned malformed result"); }
  if (outcome.exitCode !== 0 || !record3(result) || result.ok !== true || !strings3(result.paths)) throw new Error(record3(result) ? `${String(result.error)}; rollback: ${JSON.stringify(result.rollbackErrors ?? [])}` : "apply failed");
  return result.paths;
}
// TASK_CORE_END

let executionBoardReady = false;
try {
  artifact.board("batches", {
    title: "任务执行进度",
    key: "taskId",
    status: "status",
    columns: ["pending", "running", "completed", "failed", "blocked", "skipped"],
    cardTitle: "title",
    detail: [
      { field: "acceptanceCommand", label: "自动化验收" },
      { field: "exitCode", label: "退出码" },
      { field: "attempts", label: "尝试次数" },
      { field: "artifactPath", label: "执行记录" },
    ],
  });
  executionBoardReady = true;
} catch {
  executionBoardReady = false;
}

function publishExecutionEvent(item: unknown): void {
  if (executionBoardReady) report(item, "batches");
  else report(item);
}

async function runLegacy2(planContent: string) {
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

function programBaseName(program: string): string {
  const normalized = program.replace(/\\/g, "/");
  const base = normalized.split("/").pop() ?? "";
  return base.toLowerCase().replace(/\.(exe|cmd|bat|com)$/i, "");
}

function dangerousProgramName(program: string): string {
  const base = programBaseName(program);
  if (
    [
      "rm",
      "rmdir",
      "rd",
      "del",
      "erase",
      "format",
      "mkfs",
      "dd",
      "shutdown",
      "reboot",
      "halt",
      "poweroff",
      "sudo",
      "doas",
    ].includes(base)
  ) {
    return base;
  }
  return "";
}

function dangerousArgv(program: string, args: string[]): string {
  const direct = dangerousProgramName(program);
  if (direct) return `危险程序：${direct}`;
  const base = programBaseName(program);
  if (["bash", "sh", "zsh", "cmd", "powershell", "pwsh"].includes(base)) {
    return "argv 不允许直接启动 shell 解释器；请使用 shell 验收并显式 allowShell";
  }
  if (base === "git" && /\b(?:add|commit|reset|clean|checkout|restore|switch|stash|push|pull|fetch|merge|rebase|am|apply|rm|mv|tag|branch)\b/i.test(args.join(" "))) {
    return "git 写操作不允许作为验收命令";
  }
  const line = [program, ...args].join(" ");
  const pattern = dangerousCommand(line);
  if (pattern) return pattern;
  for (const arg of args) {
    const text = arg.trim();
    if (!text) continue;
    const first = text.split(/\s+/)[0] ?? "";
    const nestedProgram = dangerousProgramName(first);
    if (nestedProgram) return `参数包含危险程序：${nestedProgram}`;
    const nested = dangerousCommand(text);
    if (nested) return nested;
    if (/(^|[\s;&|"'`=(])(rm|rmdir|rd|del|erase|format|mkfs(?:\.\w+)?|dd|shutdown|reboot|halt|poweroff)\b/i.test(text)) {
      return "参数包含危险命令";
    }
  }
  return "";
}

function validAcceptanceCommand(value: unknown, mode: PlanMode): value is AcceptanceCommand {
  if (!isRecord(value) || !exactKeys(value, ["program", "args"])) return false;
  if (typeof value.program !== "string" || !value.program.trim() || !isStringArray(value.args)) return false;
  if (hasControlChars(value.program) || value.args.some((item) => hasControlChars(item))) return false;
  if (mode === "standard") return dangerousArgv(value.program, value.args) === "";
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
      if (!validAcceptanceCommand(item.acceptanceCommand, mode)) {
        const program = isRecord(item.acceptanceCommand) && typeof item.acceptanceCommand.program === "string"
          ? item.acceptanceCommand.program
          : "无效命令";
        const detail = isRecord(item.acceptanceCommand) &&
          typeof item.acceptanceCommand.program === "string" &&
          isStringArray(item.acceptanceCommand.args)
          ? (mode === "strict" ? "strict 只允许内置白名单" : dangerousArgv(item.acceptanceCommand.program, item.acceptanceCommand.args) || "命令格式不合法")
          : "命令格式不合法";
        errors.push(`${id}: argv 任务验收命令不受支持：${program}（${detail}）`);
      }
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
  const resolutionsByQuestion = new Set(
    (Array.isArray(resolutions) ? resolutions : [])
      .filter((item) => isRecord(item) && typeof item.questionId === "string")
      .map((item) => item.questionId),
  );
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

async function runAcceptance(command: AcceptanceCommand, mode: PlanMode): Promise<CommandOutcome> {
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
        if (mode === "standard") return await runArbitraryAcceptance(command);
        return { exitCode: 126, stdout: "", stderr: `strict 未允许的验收程序：${command.program}` };
    }
  } catch (error) {
    return { exitCode: 124, stdout: "", stderr: `验收命令启动失败或超时：${String(error)}` };
  }
}

async function runArbitraryAcceptance(command: AcceptanceCommand): Promise<CommandOutcome> {
  const timeoutMs = 1_800_000;
  const code = `
const { spawnSync } = require('child_process');
const [cmd, ...args] = process.argv.slice(1);
if (!cmd) {
  process.stderr.write('missing acceptance program');
  process.exit(126);
}
const r = spawnSync(cmd, args, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  timeout: ${timeoutMs},
  maxBuffer: 10 * 1024 * 1024,
  windowsHide: true,
});
if (r.stdout) process.stdout.write(String(r.stdout).slice(0, 200000));
if (r.stderr) process.stderr.write(String(r.stderr).slice(0, 200000));
if (r.error) {
  if (r.error.code === 'ETIMEDOUT' || r.signal === 'SIGTERM') process.exit(124);
  if (r.error.code === 'ENOENT') process.exit(127);
  if (r.error.code === 'EACCES') process.exit(126);
  process.stderr.write(String(r.error));
  process.exit(1);
}
if (r.signal) process.exit(124);
process.exit(typeof r.status === 'number' ? r.status : 1);
`;
  try {
    return await world.run("node", ["-e", code, command.program, ...command.args], { timeoutMs: timeoutMs + 10000 });
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
    const root = `.zcode/task-runs/${hash3(planContent).slice(7)}`;
    authorizeIoRoot3(root);
    const text = reportMarkdown(report, planPath);
    const path = `${root}/legacy-report-${hash3(text).slice(7)}.md`;
    const previous = await fileHash3(path);
    if (previous !== null && previous !== hash3(text)) throw new Error("旧版报告不可变路径已变化");
    await writeText3(path, text, previous);
    await artifact.file("run-report", path, { title: title.slice(0, 120), primary: true });
  } catch (error) {
    report.validationErrors.push(`执行报告发布未完成：${String(error)}`);
    report.conclusion += " 执行报告发布未完成。";
  }
}

phase("核对执行合同");
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

const publishBatch = (item: unknown): void => {
  publishExecutionEvent(item);
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
  const beforeIntegrity = await integrityErrors(planContent, headBaseline, stashBaseline);
  const beforeSnapshot = beforeIntegrity.length ? null : await captureSnapshot(snapshotScopes);
  if (!beforeSnapshot || beforeIntegrity.length) {
    const failed = await failureFromIntegrity(
      task,
      [],
      beforeIntegrity.length ? beforeIntegrity.join("；") : "Git 快照读取失败；未调用修复员或验收命令",
      0,
    );
    results.push(failed);
    outcomeById.set(task.id, "failed");
    publishBatch({ ...failed });
    deviations.push(`${task.id}: ${failed.notes}`);
    break;
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
    break;
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
    if (strict || stopOnFailureArg || outsideFix.length || integrity.length) break;
    continue;
  }

  let acceptance: CommandOutcome;
  if (task.acceptanceKind === "argv" && task.acceptanceCommand) {
    acceptance = await runAcceptance(task.acceptanceCommand, contract.mode);
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
      afterAcceptanceSnapshot !== null &&
      acceptance.exitCode !== 0 &&
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
      const retryIntegrity = await integrityErrors(planContent, headBaseline, stashBaseline);
      const retryBefore = retryIntegrity.length ? null : await captureSnapshot(snapshotScopes);
      if (!retryBefore || retryIntegrity.length) {
        finalIntegrity = retryIntegrity.length ? retryIntegrity : ["重试前无法读取 Git 快照"];
        finalAfterAcceptance = null;
        succeeded = false;
        scopeVerified = false;
      } else {
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
            finalAcceptance = await runAcceptance(task.acceptanceCommand, contract.mode);
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
    if (strict || stopOnFailureArg || !finalAfterAcceptance || finalOutside.length || finalIntegrity.length) break;
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
  finalSnapshot ? "" : "最终 Git/ignored 文件快照读取失败，完整性未验证",
  planIntact ? "" : "计划文件在执行期间被修改或删除",
  headChangedAtEnd ? `Git HEAD 在运行期间发生变化（${headBaseline} -> ${finalHead ?? "不可读"}）` : "",
  stashChangedAtEnd ? "Git stash 在运行期间发生变化" : "",
].filter(Boolean);
const finalStatus = integrityNotes.length ? `${finalStatusBase}\n（${integrityNotes.join("；")}）` : finalStatusBase;
if (!finalSnapshot) {
  notCovered.push("最终 Git/ignored 文件快照读取失败，无法完整汇总改动");
  deviations.push("最终 Git/ignored 文件快照读取失败；结果不可视为完全成功");
}
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
await publishEarlyReport(result, "执行报告");
return result;
}

interface ExecutionOutcome3 {
  /** What was implemented within the approved task, without claiming checks ran. */
  summary: string;
  /** True when a decision, missing evidence, permission, or scope expansion prevents this task. */
  blocked: boolean;
  /** Concrete reason and required recovery when blocked. */
  blockReason: string;
  /** Remaining limitations; do not claim runtime verification. */
  notes: string;
}

interface ImplementationReview3 {
  /** True only after reading the actual implementation and finding no blocking defect. */
  approved: boolean;
  /** Blocking defects with file/line or staged-file evidence; empty on approval. */
  issues: string[];
  /** True only for a local code repair within these same approved task scopes. */
  repairable: boolean;
  /** What was read and what would break; never manufacture approval. */
  summary: string;
}

interface ExecutionTaskResult3 {
  id: string;
  title: string;
  status: "completed" | "failed" | "blocked" | "skipped";
  attempts: number;
  artifactPath: string;
  reason: string;
}

interface ExecutionCheckResult3 {
  id: string;
  title: string;
  kind: "task" | "stage" | "final";
  exitCode: number;
  errorKind: string;
  integrityPassed: boolean;
  artifactPath: string;
}

interface ExecutionReport3 {
  contractVersion: 3;
  status: "completed" | "incomplete" | "blocked";
  conclusion: string;
  mode: TaskMode3;
  packageHash: string;
  planPath: string;
  executionPath: string;
  checkpointPath: string;
  approvalSource: "contract" | "user" | "not-required";
  alreadyApplied: boolean;
  tasks: ExecutionTaskResult3[];
  checks: ExecutionCheckResult3[];
  filesChanged: string[];
  /** Commands represented by execution records, not newly rerun on native resume. */
  verified: string[];
  /** Behavior that still needs a separately authorized runtime or human check. */
  manualVerification: string[];
  requiresConfirmation: boolean;
  confirmationToken: string;
  confirmationReasons: string[];
  notCovered: string[];
  validationErrors: string[];
  recovery: string[];
  artifactFiles: string[];
}

interface ExecutionCheckpoint3 {
  version: 1;
  runId: string;
  contractHash: string;
  planPath: string;
  planHash: string;
  supports: Support3[];
  approvalSource: "contract" | "user" | "not-required";
  approvalEvidence: string;
  grants: string[];
  allowShell: boolean;
  confirmedToken: string;
  stopOnFailure: boolean;
  language: string;
  appliedTaskIds: string[];
  preparedTasks: { id: string; stageRoot: string; beforePath: string; reviewPath: string; artifacts: Support3[] }[];
  status: "running" | "completed" | "incomplete" | "blocked";
  step: string;
  wave: number;
  attempt: number;
  baselinePath: string;
  beforePath: string;
  afterPath: string;
  finalSnapshotPath: string;
  indexHash: string | null;
  resultPath: string;
  resultHash: string;
  artifacts: Support3[];
  /** Native resume must be preceded by the outer skill's fresh deterministic preflight. */
  resumeRequiresFreshPreflight: true;
}

interface StagedChange3 {
  action: "put" | "delete";
  path: string;
  baseHash: string | null;
  outputHash: string | null;
  mode?: number;
}

interface PreparedTask3 {
  task: Task3;
  stageRoot: string;
  manifestPath: string;
  changes: StagedChange3[];
  artifacts: Support3[];
}

interface WaveAttempt3 {
  passed: boolean;
  repairable: boolean;
  reason: string;
  artifactPath: string;
}

function executionRecord3(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function executionHash3(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function executionRecovery3(planPath: string, checkpointPath: string): string[] {
  return [
    "补授权/决定：若缺少批准、检查权限或业务决定，先请用户明确；新决定须交 task-plan 写入并重新复核，不能修改不可变合同或把计划当授权。",
    `恢复已有执行：仅对可恢复中断，先围绕 ${checkpointPath || "已有检查点（如已生成）"} 做 fresh preflight，核对方案、支持材料、源码、dirty 状态和执行证据；通过后再按原运行状态选择 Resume/Amend。既有检查不代表本次重跑，失败记录与修复预算不会清零；用户停止的仅按用户请求恢复，本报告不自动恢复。`,
    `返回 task-plan：若需调整范围、接口、技术选择、验收或源码基线，基于 ${planPath || "当前方案"} 重新评审。源码基线或 dirty 保护不通过时先核对并保留现场，不能靠补授权或重试绕过。`,
  ];
}

function executionFailure3(planPath: string, errors: string[]): ExecutionReport3 {
  return {
    contractVersion: 3,
    status: "blocked",
    conclusion: "执行被阻塞，未将未验证的结果标记为成功。",
    mode: "standard",
    packageHash: "",
    planPath,
    executionPath: "",
    checkpointPath: "",
    approvalSource: "not-required",
    alreadyApplied: false,
    tasks: [],
    checks: [],
    filesChanged: [],
    verified: [],
    manualVerification: [],
    requiresConfirmation: false,
    confirmationToken: "",
    confirmationReasons: [],
    notCovered: ["未通过执行门槛，未调用实施员"],
    validationErrors: errors,
    recovery: executionRecovery3(planPath, ""),
    artifactFiles: [],
  };
}

function executionMarkdown3(result: ExecutionReport3): string {
  const runRoot = `.zcode/task-runs/${result.packageHash.slice(7)}`;
  const snapshotsCompared = (result.status === "completed" || result.validationErrors.length === 0) && result.artifactFiles.includes(`${runRoot}/baseline.json`) && result.artifactFiles.includes(`${runRoot}/final-snapshot.json`);
  return [
    `# 任务执行报告`,
    "",
    result.conclusion,
    "",
    `- 状态：${result.status}${result.alreadyApplied ? "（已执行包，未再次施工）" : ""}`,
    `- 模式：${result.mode}`,
    `- 计划：${result.planPath}`,
    `- 包哈希：${result.packageHash || "未验证"}`,
    `- 批准来源：${result.approvalSource}`,
    `- 恢复点：${result.checkpointPath || "尚未建立"}`,
    "",
    "## 实际文件变更",
    "",
    snapshotsCompared
      ? `基于执行基线 ${runRoot}/baseline.json 与最终快照 ${runRoot}/final-snapshot.json 核对，不采用实施员自报。${result.alreadyApplied ? "以下为既有执行记录的变更，不是本次重新施工。" : ""}`
      : "未取得可核对的执行基线与最终快照，实际文件变更范围未知；空列表不表示零变更。",
    ...(result.filesChanged.length ? result.filesChanged.map(path => `- ${path}`) : snapshotsCompared ? ["- 快照核对未发现文件变更。"] : []),
    "",
    "## 任务与检查",
    "",
    ...result.tasks.map((task) => `- ${task.id} ${task.title}：${task.status}，${task.attempts} 次尝试；记录 ${task.artifactPath || "无"}${task.reason ? `；${task.reason}` : ""}`),
    ...result.checks.map((check) => `- ${check.kind} ${check.id} ${check.title}：退出码 ${check.exitCode}${check.errorKind ? `（${check.errorKind}）` : ""}${check.integrityPassed ? "；完整性核对通过" : "；完整性未通过，不作为验收通过"}；记录 ${check.artifactPath}`),
    "",
    "## 自动验证记录",
    "",
    ...result.verified.map((item) => `- ${item}`),
    "- 命令结果属于本执行记录。原生恢复会重放已完成步骤；外层技能必须重新读取并比较当前包、完整性和恢复点，不能把缓存检查说成重新运行。",
    "",
    "## 人工交付与待验证清单",
    "",
    ...(result.manualVerification.length ? result.manualVerification : ["没有额外声明的运行行为。"]).map((item) => `- ${item}`),
    "- 上线测试计划未自动执行；本清单不授予启动服务、联网、发布或部署权限，仍需另行明确授权。",
    "",
    "## 未覆盖与阻塞",
    "",
    ...result.notCovered.map((item) => `- ${item}`),
    ...result.validationErrors.map((item) => `- 阻塞：${item}`),
    ...(result.recovery.length ? ["", "## 下一步", "", ...result.recovery.map((item) => `- ${item}`)] : []),
    "",
    "## 执行产物",
    "",
    ...result.artifactFiles.map((path) => `- ${path}`),
  ].join("\n");
}

async function publishExecutionReport3(result: ExecutionReport3): Promise<void> {
  publishExecutionEvent({
    runId: run.id,
    taskId: "execution",
    title: result.conclusion,
    status: result.status === "incomplete" ? "failed" : result.status,
    artifactPath: result.checkpointPath,
    packageHash: result.packageHash,
  });
  try {
    const text = executionMarkdown3(result);
    if (result.alreadyApplied || !result.executionPath || !result.artifactFiles.includes(result.executionPath)) {
      if (!executionHash3(result.packageHash)) throw new Error("没有可写入报告的有效方案包摘要");
      const root = `.zcode/task-runs/${result.packageHash.slice(7)}`;
      authorizeIoRoot3(root);
      const path = `${root}/delivery/report-${hash3(text).slice(7)}.md`;
      const previous = await fileHash3(path);
      if (previous !== null && previous !== hash3(text)) throw new Error("不可变交付报告已变化");
      await writeText3(path, text, previous);
      result.executionPath = path;
      if (!result.artifactFiles.includes(path)) result.artifactFiles.push(path);
    }
    await artifact.file("run-report", result.executionPath, {
      title: "任务执行报告",
      description: result.conclusion.slice(0, 500),
      primary: true,
    });
    if (result.checkpointPath && result.artifactFiles.includes(result.checkpointPath)) {
      await artifact.file("execution-checkpoint", result.checkpointPath, { title: "执行恢复点" });
    }
  } catch (error) {
    if (result.status === "completed") result.status = "incomplete";
    const message = `报告产物发布失败：${String(error)}`;
    result.validationErrors.push(message);
    result.conclusion = `${result.conclusion} 报告交付未完成。`;
    result.recovery.push(`从 ${result.executionPath || result.planPath} 中读取已记录的执行结果和产物；修复产物存储能力后再交付，不要重做已应用的改动。`);
    report({ runId: run.id, taskId: "delivery", title: message, status: "failed", artifactPath: result.executionPath });
    try {
      await artifact.markdown("run-summary", `# 执行交接\n\n${result.conclusion.slice(0, 2000)}\n\n实际报告：${result.executionPath || "尚未写入"}\n\n检查点：${result.checkpointPath || "尚未建立"}`, { title: "执行状态与报告路径" });
    } catch (fallbackError) { result.validationErrors.push(`精简交接发布失败：${String(fallbackError)}`); }
  }
}

function executionCheckpointErrors3(value: unknown, pointer: Pointer3, planPath: string, runRoot: string): string[] {
  if (!executionRecord3(value)) return ["执行恢复点不是对象"];
  const errors: string[] = [];
  if (value.version !== 1 || typeof value.runId !== "string" || !value.runId) errors.push("执行恢复点版本或所属运行无效");
  if (value.contractHash !== pointer.contractHash || value.planPath !== planPath || !executionHash3(value.planHash)) errors.push("执行恢复点不属于当前计划/包");
  if (!["running", "completed", "incomplete", "blocked"].includes(String(value.status))) errors.push("执行恢复点状态无效");
  if (!Array.isArray(value.supports) || !Array.isArray(value.artifacts)) errors.push("执行恢复点缺少不可变支持/产物哈希");
  else {
    for (const entry of [...value.supports, ...value.artifacts]) {
      if (!executionRecord3(entry) || typeof entry.path !== "string" || path3(entry.path) !== entry.path || !executionHash3(entry.hash)) {
        errors.push("执行恢复点包含无效文件哈希");
      }
    }
    for (const entry of value.artifacts) {
      if (executionRecord3(entry) && typeof entry.path === "string" && !within3(entry.path, [runRoot])) errors.push("恢复点产物逃逸执行目录");
    }
  }
  for (const key of ["baselinePath", "beforePath", "afterPath", "finalSnapshotPath", "resultPath"]) {
    const path = value[key];
    if (typeof path !== "string" || (path && (path3(path) !== path || !within3(path, [runRoot])))) errors.push(`恢复点 ${key} 无效`);
  }
  if (value.indexHash !== null && !executionHash3(value.indexHash)) errors.push("恢复点 Git index 哈希无效");
  if (value.status === "completed" && (!value.finalSnapshotPath || !value.resultPath || !executionHash3(value.resultHash))) errors.push("完成恢复点缺少最终快照/报告哈希");
  if (value.resumeRequiresFreshPreflight !== true) errors.push("恢复点缺少原生恢复的新鲜度门槛");
  if (typeof value.allowShell !== "boolean" || typeof value.confirmedToken !== "string" || (value.confirmedToken && !/^ct3-[a-f0-9]{64}$/.test(value.confirmedToken)) || !Array.isArray(value.grants) || !value.grants.every(item => typeof item === "string" && /^check:[A-Za-z0-9][A-Za-z0-9._-]*$/.test(item)) || typeof value.approvalEvidence !== "string" || !["contract", "user", "not-required"].includes(String(value.approvalSource))) errors.push("恢复点授权字段不合法");
  if (typeof value.stopOnFailure !== "boolean" || typeof value.language !== "string" || !value.language.trim()) errors.push("恢复点缺少原始停止策略或输出语言");
  if (typeof value.wave !== "number" || !Number.isInteger(value.wave) || value.wave < 0 || typeof value.attempt !== "number" || !Number.isInteger(value.attempt) || value.attempt < 0 || value.attempt > 2 || typeof value.step !== "string") errors.push("恢复点步骤/次数不合法");
  if (!Array.isArray(value.appliedTaskIds) || !value.appliedTaskIds.every(item => typeof item === "string") || new Set(value.appliedTaskIds).size !== value.appliedTaskIds.length) errors.push("恢复点已应用任务不合法");
  if (!Array.isArray(value.preparedTasks)) errors.push("恢复点缺少暂存归属");
  else for (const item of value.preparedTasks) {
    if (!executionRecord3(item) || typeof item.id !== "string" || typeof item.stageRoot !== "string" || !within3(item.stageRoot, [`${runRoot}/staging`]) || typeof item.beforePath !== "string" || !within3(item.beforePath, [runRoot]) || typeof item.reviewPath !== "string" || !within3(item.reviewPath, [runRoot]) || !Array.isArray(item.artifacts)) { errors.push("恢复暂存归属字段不合法"); continue; }
    for (const stamp of item.artifacts) if (!executionRecord3(stamp) || typeof stamp.path !== "string" || !within3(stamp.path, [item.stageRoot]) || !executionHash3(stamp.hash)) errors.push("恢复暂存文件摘要不合法");
  }
  return errors;
}

function stagedManifest3(value: unknown, task: Task3, before: Baseline3, protectedPaths: string[]): StagedChange3[] {
  if (!executionRecord3(value) || Object.keys(value).some((key) => key !== "changes") || !Array.isArray(value.changes)) {
    throw new Error(`${task.id}: 暂存 manifest 必须是 {changes:[...]} 对象`);
  }
  const changes: StagedChange3[] = [];
  const seen = new Set<string>();
  for (const raw of value.changes) {
    if (!executionRecord3(raw) || Object.keys(raw).some((key) => !["action", "path", "baseHash", "outputHash", "mode"].includes(key))) {
      throw new Error(`${task.id}: manifest 变更字段不合法`);
    }
    const path = typeof raw.path === "string" ? path3(raw.path) : null;
    if (!path || path !== raw.path || !within3(path, task.files) || overlap3([path], protectedPaths)) {
      throw new Error(`${task.id}: manifest 目标越界或覆盖不可变执行输入：${String(raw.path)}`);
    }
    if (seen.has(path.toLowerCase())) throw new Error(`${task.id}: manifest 目标重复：${path}`);
    seen.add(path.toLowerCase());
    const original = before.files.find((stamp) => stamp.path.toLowerCase() === path.toLowerCase());
    if (raw.baseHash !== (original?.hash ?? null)) throw new Error(`${task.id}: 目标原始哈希不一致：${path}`);
    if (raw.action !== "put" && raw.action !== "delete") throw new Error(`${task.id}: 无效 manifest action`);
    if (raw.action === "put" && !executionHash3(raw.outputHash)) throw new Error(`${task.id}: put 缺少输出哈希：${path}`);
    if (raw.action === "delete" && (raw.outputHash !== null || !original || !task.files.some((entry) => entry.toLowerCase() === path.toLowerCase()))) {
      throw new Error(`${task.id}: delete 必须显式批准现存文件，且 outputHash=null：${path}`);
    }
    if (raw.mode !== undefined && (typeof raw.mode !== "number" || !Number.isInteger(raw.mode) || raw.mode < 0 || raw.mode > 511 || raw.action !== "put")) {
      throw new Error(`${task.id}: manifest mode 必须是 put 的有效权限位`);
    }
    changes.push({
      action: raw.action,
      path,
      baseHash: original?.hash ?? null,
      outputHash: raw.action === "put" ? raw.outputHash as string : null,
      ...(raw.mode === undefined ? {} : { mode: raw.mode as number }),
    });
  }
  return changes;
}

function executionPrompt3(task: Task3, contract: Contract3, planPath: string, contractPath: string, stageRoot: string, beforePath: string, feedbackPath: string, language: string): string {
  const staged = task.execution === "staged";
  return [
    `输出语言：${language}。先读取计划 ${planPath}、精确合同 ${contractPath}、相关不可变支持文件及当前任务的源文件。`,
    `当前任务：${renderTask3(task, contract.plan)}`,
    `原始完整快照：${beforePath}。已确认决策仅以合同 resolutions 为准；不得发明审批或解决新的业务决定。`,
    feedbackPath ? `这是标准模式唯一一次有限修复。先读取失败记录 ${feedbackPath}，仅修复当前已批准任务；不要重做已完成依赖。` : "仅实施当前任务，不重规划，不做无关重构。",
    staged
      ? `源文件只读。只可写唯一目录 ${stageRoot}，目标副本位于 ${stageRoot}/files/<原规范相对路径>；不要修改源工作树、其他任务目录、恢复点或日志。`
      : `串行施工，只允许修改 ${task.files.join("、")}。源工作树改动由控制器整波快照检查；不得修改其他文件或执行目录。`,
    staged
      ? `写 ${stageRoot}/manifest.json，严格格式 {"changes":[{"action":"put"|"delete","path":"规范目标路径","baseHash":"sha256:..."|null,"outputHash":"sha256:..."|null,"mode":可选权限位}]}。put 文件 hash 必须匹配实际副本；baseHash 必须匹配本次原始快照，新增为 null；delete 无副本、outputHash=null，且目标须显式列在 task.files。不得放入未声明文件，不得复制整个源码目录。默认保留原文件 mode。`
      : "不要写 manifest 或执行日志；控制器记录实际改动与验收。",
    "支持包、plan.md、合同、读入脚本和技能在整个执行期间不可变，即使任务目录范围看起来包含它们也不得写入。",
    "不要运行任何验收命令、测试、构建、服务、安装、部署、网络、git 写操作或嵌套 workflow。控制器只执行合同内获得授权的检查。不要提交、stash、初始化 Git、切换 HEAD 或改暂存区。",
    "如必须扩大文件范围、改变技术选择/行为标准/检查、缺少证据或需要权限，停止并输出 blocked 和具体恢复请求；不允许通过弱化验收伪造通过。",
    "返回小型 ExecutionOutcome3：summary、blocked、blockReason、notes；不要将静态实现说成运行验证。",
  ].join("\n\n");
}

let recoveryInput3: ExecutionCheckpoint3 | null = null;
const RECOVERY_CHECKPOINT_PATH3 = "";

function executionOutcomeErrors3(value: unknown): string[] {
  if (!executionRecord3(value) || Object.keys(value).sort().join(",") !== "blockReason,blocked,notes,summary") return ["实施员结果字段不完整"];
  if (typeof value.summary !== "string" || !value.summary.trim() || typeof value.blocked !== "boolean" || typeof value.blockReason !== "string" || typeof value.notes !== "string") return ["实施员结果类型不完整"];
  if (value.blocked && !value.blockReason.trim()) return ["实施员阻塞但没有说明原因"];
  return stableJson3(value).length > 32768 ? ["实施员结果过大"] : [];
}

function implementationReviewErrors3(value: unknown): string[] {
  if (!executionRecord3(value) || Object.keys(value).sort().join(",") !== "approved,issues,repairable,summary") return ["实现复核字段不完整"];
  if (typeof value.approved !== "boolean" || typeof value.repairable !== "boolean" || typeof value.summary !== "string" || !value.summary.trim() || !Array.isArray(value.issues) || !value.issues.every(item => typeof item === "string" && item.trim())) return ["实现复核结果类型不完整"];
  if (value.approved && value.issues.length) return ["通过复核不能保留阻塞缺陷"];
  return stableJson3(value).length > 32768 ? ["实现复核结果过大"] : [];
}

function checkpointResultErrors3(value: unknown): string[] {
  if (!executionRecord3(value) || value.contractVersion !== 3 || !["completed", "incomplete", "blocked"].includes(String(value.status)) || (value.mode !== "standard" && value.mode !== "strict") || !executionHash3(value.packageHash) || typeof value.planPath !== "string" || path3(value.planPath) !== value.planPath || typeof value.conclusion !== "string") return ["记录的执行报告字段不完整"];
  const errors: string[] = [];
  for (const key of ["filesChanged", "verified", "manualVerification", "confirmationReasons", "notCovered", "validationErrors", "recovery", "artifactFiles"]) if (!Array.isArray(value[key]) || !value[key].every(item => typeof item === "string")) errors.push(`记录的执行报告 ${key} 不合法`);
  if (!Array.isArray(value.tasks)) errors.push("记录的任务不是数组");
  else {
    const ids = new Set<string>();
    for (const item of value.tasks) {
      if (!executionRecord3(item) || typeof item.id !== "string" || ids.has(item.id) || !["completed", "failed", "blocked", "skipped"].includes(String(item.status)) || typeof item.title !== "string" || typeof item.reason !== "string" || typeof item.artifactPath !== "string" || typeof item.attempts !== "number" || !Number.isInteger(item.attempts) || item.attempts < 0 || item.attempts > 2) errors.push("记录的任务字段无效或重复");
      else ids.add(item.id);
    }
  }
  if (!Array.isArray(value.checks)) errors.push("记录的检查不是数组");
  else for (const item of value.checks) if (!executionRecord3(item) || typeof item.id !== "string" || typeof item.title !== "string" || !["task", "stage", "final"].includes(String(item.kind)) || typeof item.exitCode !== "number" || !Number.isInteger(item.exitCode) || typeof item.errorKind !== "string" || typeof item.integrityPassed !== "boolean" || typeof item.artifactPath !== "string") errors.push("记录的检查字段无效，缺少实际退出码或完整性证据");
  return errors;
}

async function runExecution3(planPath: string, planContent: string, pointer: Pointer3): Promise<ExecutionReport3> {
  phase("核对方案包、授权与源码基线");
  await world.run("node", ["-p", "process.platform"], { output: { tail: 512 } });
  const result = executionFailure3(planPath, []);
  const runRoot = `.zcode/task-runs/${pointer.contractHash.slice(7)}`;
  const checkpointPath = `${runRoot}/checkpoint.json`;
  result.packageHash = pointer.contractHash;
  result.executionPath = `${runRoot}/report.md`;
  result.checkpointPath = checkpointPath;
  result.notCovered = [];
  result.recovery = executionRecovery3(planPath, checkpointPath);
  authorizeIoRoot3(runRoot);
  const language = recoveryInput3 ? recoveryInput3.language : String(args.language ?? "中文").trim() || "中文";
  const allowShell = recoveryInput3 ? recoveryInput3.allowShell : args.allowShell === true || String(args.allowShell ?? "").toLowerCase() === "true";
  const approvalEvidence = recoveryInput3 ? recoveryInput3.approvalEvidence : String(args.approvalEvidence ?? "").trim();
  const confirmedToken = recoveryInput3 ? recoveryInput3.confirmedToken : String(args.confirmationToken ?? "").trim();
  const grantsArg = recoveryInput3 ? recoveryInput3.grants : args.grants ?? [];
  const grants = Array.isArray(grantsArg) && grantsArg.every(item => typeof item === "string") ? grantsArg as string[] : [];
  const stopOnFailure = recoveryInput3 ? recoveryInput3.stopOnFailure : !(args.stopOnFailure === false || String(args.stopOnFailure ?? "").toLowerCase() === "false");
  let contract: Contract3 | null = null;
  let planHash = hash3(planContent);
  let baseline: Baseline3 | null = null;
  let acceptedSnapshot: Baseline3 | null = null;
  let indexHash: string | null = null;
  let checkpoint: ExecutionCheckpoint3 | null = null;
  let baselinePath = "";
  let beforePath = "";
  let afterPath = "";
  let finalSnapshotPath = "";
  let waveNumber = 0;
  let attemptNumber = 0;
  let constructionStarted = false;
  let deliveryStarted = false;
  let lastStep = "";
  let resumePrefix = "";
  let appliedTaskIds: string[] = [];
  let preparedTasks: ExecutionCheckpoint3["preparedTasks"] = [];
  let resumePrepared = false;
  let resumeRecord: ExecutionCheckpoint3 | null = null;
  const ownedArtifacts = new Map<string, string>();
  const successById = new Set<string>();
  const stageChecksDone = new Set<string>();
  const actors = new Map<string, Agent>();
  const reviewers = new Map<string, Agent>();
  const save = async (path: string, value: unknown): Promise<string> => {
    const text = typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
    const previous = await fileHash3(path);
    const hash = hash3(text);
    if (previous !== hash) {
      if (previous !== null) throw new Error(`不可覆盖不同执行记录：${path}`);
      await writeText3(path, text, null);
    }
    ownedArtifacts.set(path, hash);
    if (!result.artifactFiles.includes(path)) result.artifactFiles.push(path);
    return path;
  };
  const verifySerialRecovery = async (record: ExecutionCheckpoint3, previous: ExecutionReport3): Promise<void> => {
    if (!contract) throw new Error("串行恢复缺少合同");
    for (const evidence of serialRecoveryEvidence3(contract.plan, record, previous, runRoot)) {
      const [implementation, review, before, prepared] = await Promise.all([evidence.taskPath, evidence.reviewPath, evidence.beforePath, evidence.beforePath.replace(/-before\.json$/, "-prepared.json")].map(async path => JSON.parse(await readText3(path)) as unknown));
      const errors = serialRecoveryEvidenceErrors3(evidence, contract.plan.tasks.find(task => task.id === evidence.taskId)!, implementation, review, before, prepared);
      if (errors.length) throw new Error(errors.join("；"));
    }
  };
  const integrity = async (expected: Baseline3, allowed: string[]): Promise<Baseline3> => {
    if (!contract) throw new Error("执行缺少合同");
    const inputs = [{ path: planPath, hash: planHash }, { path: pointer.contractPath, hash: pointer.contractHash }, ...contract.supports, ...[...ownedArtifacts.entries()].map(([path, hash]) => ({ path, hash }))];
    const hashes = await fileHashes3(inputs.map(item => item.path));
    for (const item of inputs) if (hashes[item.path] !== item.hash) throw new Error(`方案、支持材料或已有执行记录变化：${item.path}`);
    const current = await snapshot3(["."], [runRoot]);
    const errors = compareBaseline3(expected, current, allowed);
    if (current.kind === "git" && await gitIndexHash3() !== indexHash) errors.push("Git index 在执行期间变化");
    if (errors.length) throw new Error(`执行完整性失败：${errors.join("；")}`);
    return current;
  };
  const persist = async (step: string, state: ExecutionCheckpoint3["status"]): Promise<void> => {
    if (!contract || !baseline) return;
    const recordResultPath = `${runRoot}/records/result-${hash3(stableJson3(result)).slice(7)}.json`;
    await save(recordResultPath, result);
    lastStep = step;
    checkpoint = {
      version: 1, runId: run.id, contractHash: pointer.contractHash, planPath, planHash, supports: contract.supports, approvalSource: result.approvalSource, approvalEvidence: result.approvalSource === "contract" ? contract.approvalEvidence : approvalEvidence,
      grants, allowShell, confirmedToken, stopOnFailure, language, appliedTaskIds, preparedTasks, status: state, step, wave: waveNumber, attempt: attemptNumber, baselinePath, beforePath, afterPath, finalSnapshotPath, indexHash,
      resultPath: recordResultPath, resultHash: ownedArtifacts.get(recordResultPath) ?? "", artifacts: [...ownedArtifacts.entries()].map(([path, hash]) => ({ path, hash })), resumeRequiresFreshPreflight: true,
    };
    await writeText3(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
    if (!result.artifactFiles.includes(checkpointPath)) result.artifactFiles.push(checkpointPath);
    report({ runId: run.id, kind: "execution-checkpoint", step, status: state, wave: waveNumber, attempt: attemptNumber, checkpointPath, beforePath, afterPath });
  };
  const check = async (item: Check3, prefix: string): Promise<WaveAttempt3> => {
    if (!contract || !acceptedSnapshot) throw new Error("检查前缺少已接受快照");
    const before = await integrity(acceptedSnapshot, []);
    const path = `${runRoot}/checks/${prefix}-${item.id}.json`;
    const checkBeforePath = await save(`${runRoot}/checks/${prefix}-${item.id}-before.json`, before);
    beforePath = checkBeforePath;
    await persist(`检查前：${item.id}`, "running");
    const ownedBeforeCheck = await snapshotOwned3();
    let outcome: { exitCode: number; stdout: string; stderr: string; errorKind: string };
    try { outcome = await runCheck3(item, contract.mode, contract.allowShell && allowShell, grants); }
    catch (error) { outcome = { exitCode: 126, stdout: "", stderr: String(error), errorKind: "controller" }; }
    let ownedCheckError = "";
    try {
      const ownedAfterCheck = await snapshotOwned3();
      const ownedCheckErrors = compareBaseline3(ownedBeforeCheck, ownedAfterCheck, []);
      if (ownedCheckErrors.length) ownedCheckError = `检查修改了受保护的执行记录：${ownedCheckErrors.join("；")}`;
    } catch (error) { ownedCheckError = String(error); }
    let snapshotError = ownedCheckError;
    let after: Baseline3 | null = null;
    try { after = await integrity(before, item.writeFiles); }
    catch (error) { snapshotError = [snapshotError, String(error)].filter(Boolean).join("；"); }
    afterPath = after ? await save(`${runRoot}/checks/${prefix}-${item.id}-after.json`, after) : "";
    if (after) acceptedSnapshot = after;
    await save(path, { runId: run.id, id: item.id, program: item.program, args: item.args, shell: item.shell, permission: item.permission, outcome, beforePath: checkBeforePath, afterPath, snapshotError, note: "此记录的命令在生成记录时执行；原样 Resume 可能重放，不代表重新运行。" });
    const integrityPassed = snapshotError === "" && after !== null;
    result.checks.push({ id: item.id, title: item.title, kind: item.kind, exitCode: outcome.exitCode, errorKind: outcome.errorKind, integrityPassed, artifactPath: path });
    if (outcome.exitCode === 0 && !outcome.errorKind && integrityPassed) result.verified.push(`${item.id}：[${item.program || "shell"}, ${JSON.stringify(item.args)}] 退出 0，完整性核对通过；记录 ${path}`);
    publishExecutionEvent({ runId: run.id, taskId: `check-${item.id}`, title: item.title, status: outcome.exitCode === 0 && !outcome.errorKind && integrityPassed ? "completed" : "failed", exitCode: outcome.exitCode, artifactPath: path });
    if (snapshotError) {
      await persist(`检查后完整性失败：${item.id}`, "incomplete");
      throw new Error(snapshotError);
    }
    await persist(`检查后：${item.id}`, "running");
    return { passed: outcome.exitCode === 0 && !outcome.errorKind, repairable: outcome.exitCode !== 0 && outcome.errorKind === "" && outcome.exitCode !== 124 && outcome.exitCode !== 126 && outcome.exitCode !== 127, reason: outcome.stderr || outcome.stdout || `退出 ${outcome.exitCode}`, artifactPath: path };
  };
  const reviewImplementation = async (task: Task3, stageRoot: string, taskBeforePath: string, prefix: string): Promise<ImplementationReview3> => {
    if (!contract) throw new Error("复核缺少合同");
    let reader = reviewers.get(task.id);
    if (!reader) {
      reader = agent(`实现独立复核·${task.id}`, { system: "你没有参与实现。只读实际源文件/暂存副本、任务、证据和接口，找出会破坏需求或验收的缺陷；不写任何文件、不运行测试/构建/服务/网络、不替用户作决定。" });
      reviewers.set(task.id, reader);
    }
    let value = await reader.ask<ImplementationReview3>(`方案 ${planPath}；精确合同 ${pointer.contractPath}；任务 ${task.id}。原始快照 ${taskBeforePath}。${task.execution === "staged" ? `只读暂存 ${stageRoot}/manifest.json 和 files 中每个目标副本，再对比原始源文件` : "读取施工后的源文件以及当前任务记录"}。逐项核对实际行为、共享接口、资源/锁/错误路径、范围和任务行为标准。不把实现员摘要当证明，不声称检查跑过。阻塞缺陷记录 path:line/副本证据。仅原范围内普通代码错误 repairable=true，缺权限/新决定/扩大接口范围为 false。无阻塞才 approved=true；输出 ${language}。`);
    let errors = implementationReviewErrors3(value);
    if (errors.length) { value = await reader.ask<ImplementationReview3>(`只修当前复核字段，不改变缺陷结论、不清空问题：${errors.join("；")}。`); errors = implementationReviewErrors3(value); }
    if (errors.length) throw new Error(errors.join("；"));
    await save(`${runRoot}/reviews/${prefix}-${task.id}.json`, value);
    return value;
  };
  try {
    if (!executionHash3(pointer.contractHash) || !/^\.zcode\/task-plans\/[a-f0-9]{64}\/v-[a-f0-9]{64}\/contract\.json$/.test(pointer.contractPath)) throw new Error("合同指针不在规范不可变方案目录");
    if (await fileHash3(planPath) !== planHash) throw new Error("读入方案与实际入口不一致");
    const contractText = await readText3(pointer.contractPath);
    if (hash3(contractText) !== pointer.contractHash) throw new Error("合同原始 UTF-8 摘要不匹配");
    const raw: unknown = JSON.parse(contractText);
    const errors = validateContract3(raw);
    if (errors.length) throw new Error(errors.join("；"));
    contract = raw as Contract3;
    result.mode = contract.mode;
    const manualVerification = [
      ...contract.plan.tasks.flatMap(task => task.behaviorAcceptance.map(item => `${task.id}：${item}（独立代码复核不代替真实运行/人工验收；自动检查证据见检查记录）`)),
      ...contract.plan.rollout.map(item => `上线测试计划（未自动执行，需用户另行安排/授权）：${item}`),
    ];
    result.manualVerification = manualVerification;
    const planRoot = pointer.contractPath.split("/v-")[0];
    const protectedPaths = [planPath, pointer.contractPath, ...contract.supports.map(item => item.path), runRoot];
    protectApplyPaths3(protectedPaths);
    if (contract.status !== "ready" || contract.review.verdict !== "approve" || contract.plan.gaps.length) throw new Error(`整份方案未满足施工条件：${contract.status}/${contract.review.verdict}`);
    const resolved = new Set(contract.resolutions.map(item => item.questionId));
    if (contract.plan.decisions.some(item => item.affectsImplementation && !resolved.has(item.id))) throw new Error("还有影响实施的未决事项，整份零施工");
    for (const item of contract.supports) if (await fileHash3(item.path) !== item.hash) throw new Error(`支持文件缺失或原始摘要变化：${item.path}`);
    if (contract.plan.tasks.some(item => overlap3(item.files, protectedPaths)) || contract.plan.checks.some(item => overlap3(item.writeFiles, protectedPaths))) throw new Error("任务/检查的写范围覆盖了不可变输入或运行状态");
    if (!Array.isArray(grantsArg) || !grantsArg.every(item => typeof item === "string" && /^check:[A-Za-z0-9][A-Za-z0-9._-]*$/.test(item) && contract?.plan.checks.some(check => `check:${check.id}` === item))) throw new Error("grants 必须是当前检查 ID 的明确授权数组");
    const shellChecks = contract.plan.checks.filter(item => item.shell !== null);
    if (shellChecks.length && (!contract.allowShell || !allowShell)) throw new Error("shell 检查需要方案和本次执行双端 allowShell=true");
    const missingGrants = contract.plan.checks.filter(item => item.permission !== "local-check" && !grants.includes(`check:${item.id}`));
    if (missingGrants.length) throw new Error(`整份检查缺少用户授权：${missingGrants.map(item => `check:${item.id} (${item.permission})`).join("；")}`);
    if (contract.mode === "strict") {
      if (contract.approved && contract.approvalEvidence.trim()) result.approvalSource = "contract";
      else if (approvalEvidence) result.approvalSource = "user";
      else throw new Error("strict 需要用户对当前方案包的明确批准原话，普通执行/修改请求不能代替");
    }
    if (contract.mode === "standard" && shellChecks.length) {
      const reasons = shellChecks.map(item => `${item.id}：显式 shell 验收（高风险）`);
      const expectedToken = token3(contract, reasons);
      if (confirmedToken !== expectedToken) {
        result.requiresConfirmation = true;
        result.confirmationToken = expectedToken;
        result.confirmationReasons = reasons;
        result.conclusion = "当前方案包含高风险 shell 检查，零施工；确认所列原因后使用绑定当前方案的确认 token。";
        await publishExecutionReport3(result);
        return result;
      }
    }
    const checkpointHash = await fileHash3(checkpointPath);
    if (checkpointHash !== null) {
      const value: unknown = JSON.parse(await readText3(checkpointPath));
      const checkpointErrors = executionCheckpointErrors3(value, pointer, planPath, runRoot);
      if (checkpointErrors.length) throw new Error(checkpointErrors.join("；"));
      resumeRecord = value as ExecutionCheckpoint3;
      if (resumeRecord.planHash !== planHash || stableJson3(resumeRecord.supports) !== stableJson3(contract.supports)) throw new Error("执行恢复点与当前入口/支持材料不一致");
      if (resumeRecord.status === "completed") {
        for (const item of resumeRecord.artifacts) if (await fileHash3(item.path) !== item.hash) throw new Error(`完成记录的产物变化：${item.path}`);
        if (await fileHash3(resumeRecord.resultPath) !== resumeRecord.resultHash) throw new Error("完成记录的报告摘要变化");
        const final: unknown = JSON.parse(await readText3(resumeRecord.finalSnapshotPath));
        if (baselineErrors3(final).length) throw new Error("完成记录的最终快照不合法");
        indexHash = resumeRecord.indexHash;
        const current = await snapshot3(["."], [runRoot]);
        const drift = compareBaseline3(final as Baseline3, current, []);
        if (current.kind === "git" && await gitIndexHash3() !== indexHash) drift.push("Git index 与完成记录不一致");
        if (drift.length) throw new Error(`已执行包的现场发生变化，不再次施工：${drift.join("；")}`);
        const recorded: unknown = JSON.parse(await readText3(resumeRecord.resultPath));
        if (checkpointResultErrors3(recorded).length) throw new Error("完成报告不合法");
        const previous = recorded as ExecutionReport3;
        await verifySerialRecovery(resumeRecord, previous);
        previous.alreadyApplied = true;
        previous.manualVerification = manualVerification;
        previous.conclusion = "当前方案包已执行且现场与完成快照一致，本次未重复施工或重跑验收。";
        previous.verified = previous.verified.map(item => `既有执行记录（非本次重跑）：${item}`);
        await publishExecutionReport3(previous);
        return previous;
      }
      if (!recoveryInput3) throw new Error(`当前包已有非完成执行记录，拒绝重新施工。使用原运行的 Resume/Amend 并先完成现场核对：${checkpointPath}；步骤 ${resumeRecord.step}`);
      for (const stamp of resumeRecord.artifacts) {
        if (await fileHash3(stamp.path) !== stamp.hash) throw new Error(`恢复的执行证据变化：${stamp.path}`);
        ownedArtifacts.set(stamp.path, stamp.hash);
      }
      if (await fileHash3(resumeRecord.resultPath) !== resumeRecord.resultHash) throw new Error("恢复报告摘要变化");
      const recorded: unknown = JSON.parse(await readText3(resumeRecord.resultPath));
      if (checkpointResultErrors3(recorded).length) throw new Error("恢复报告不完整");
      const previous = recorded as ExecutionReport3;
      await verifySerialRecovery(resumeRecord, previous);
      const failedChecks = previous.checks.some((check, index) => (check.exitCode !== 0 || check.errorKind !== "") && !previous.checks.slice(index + 1).some(later => later.id === check.id));
      if (previous.tasks.some(task => task.status !== "completed") || previous.checks.some(check => check.integrityPassed !== true) || failedChecks || resumeRecord.step.startsWith("检查后完整性失败") || resumeRecord.step === "波次失败，保留修复记录") throw new Error("记录已耗尽修复或包含阻塞/未通过检查或完整性未通过项，不能恢复时重置预算或忽略失败；先处理具体卡点");
      Object.assign(result, previous, { status: "incomplete", alreadyApplied: false, manualVerification, recovery: executionRecovery3(planPath, checkpointPath) });
      baselinePath = resumeRecord.baselinePath;
      baseline = JSON.parse(await readText3(baselinePath)) as Baseline3;
      const expectedPath = resumeRecord.step === "波次实施前" || resumeRecord.step.startsWith("检查前：") ? resumeRecord.beforePath : resumeRecord.afterPath || resumeRecord.beforePath || baselinePath;
      const expected: unknown = JSON.parse(await readText3(expectedPath));
      if (baselineErrors3(baseline).length || baselineErrors3(expected).length) throw new Error("恢复快照不完整，不能施工");
      indexHash = resumeRecord.indexHash;
      acceptedSnapshot = await snapshot3(["."], [runRoot]);
      const recoveryDrift = compareBaseline3(expected as Baseline3, acceptedSnapshot, []);
      if (await gitIndexHash3() !== indexHash) recoveryDrift.push("恢复 Git index/仓库状态变化");
      if (recoveryDrift.length) throw new Error(`恢复现场与最后可验证步骤不一致：${recoveryDrift.join("；")}`);
      for (const task of result.tasks) successById.add(task.id);
      for (const stage of contract.plan.stages) if (stage.checkIds.every(id => result.checks.some(check => check.id === id && check.exitCode === 0 && check.errorKind === "" && check.integrityPassed === true))) stageChecksDone.add(stage.id);
      if (!Array.isArray(resumeRecord.appliedTaskIds) || !resumeRecord.appliedTaskIds.every(id => typeof id === "string" && contract?.plan.tasks.some(task => task.id === id))) throw new Error("恢复应用归属不完整");
      appliedTaskIds = resumeRecord.appliedTaskIds.slice();
      if (!Array.isArray(resumeRecord.preparedTasks)) throw new Error("恢复缺少暂存归属记录");
      preparedTasks = resumeRecord.preparedTasks;
      resumePrepared = preparedTasks.length > 0 || appliedTaskIds.length > 0;
      resumePrefix = `r-${resumeRecord.resultHash.slice(7, 19)}`;
      for (const path of previous.artifactFiles) if (!result.artifactFiles.includes(path)) result.artifactFiles.push(path);
      report({ runId: run.id, kind: "recovery", checkpointPath, step: resumeRecord.step, note: "已现场核对并继承已完成任务/验收记录，不将既有检查说成重新运行。" });
    }
    if (!baseline) {
      const related = await snapshot3(contract.baseline.scopes, [planRoot, planPath, runRoot]);
    const drift = compareBaseline3(contract.baseline, related, []);
    if (drift.length) throw new Error(`评审后的相关源码基线已变化：${drift.join("；")}`);
    baseline = await snapshot3(["."], [runRoot]);
    if (baseline.kind === "git") {
      const approvedMaterials = contract.supports.map(item => item.path);
      const unrelatedDirty = (await gitDirtyPaths3()).filter(path => path !== planPath && !within3(path, [planRoot, runRoot]) && !approvedMaterials.includes(path));
      const blockedDirty = contract.mode === "strict" ? unrelatedDirty : unrelatedDirty.filter(path => within3(path, contract!.plan.tasks.flatMap(task => task.files)));
      if (blockedDirty.length) throw new Error(`执行前${contract.mode === "strict" ? "工作树" : "任务文件"}已有未提交改动：${blockedDirty.join("、")}`);
    }
    indexHash = baseline.kind === "git" ? await gitIndexHash3() : null;
    if (baseline.kind === "git" && indexHash === null) throw new Error("Git index 无法绑定，零施工");
    acceptedSnapshot = baseline;
    baselinePath = await save(`${runRoot}/baseline.json`, baseline);
    result.status = "incomplete";
    result.notCovered.push("未自动提交、推送、上线或连接生产；没有授权的运行行为不声称已验证");
    await persist("施工前检查通过", "running");
    }
    const waves = waves3(contract.plan.tasks, contract.plan.stages);
    const effectiveDependencies = taskDependencies3(contract.plan.tasks, contract.plan.stages);
    for (const task of contract.plan.tasks) publishExecutionEvent({ runId: run.id, taskId: task.id, title: task.title, status: "pending", artifactPath: "" });
    for (let waveIndex = 0; waveIndex < waves.length; waveIndex += 1) {
      phase("分波实现并独立复核");
      waveNumber = waveIndex + 1;
      const plannedWave = waves[waveIndex];
      if (plannedWave.every(task => successById.has(task.id))) continue;
      if (plannedWave.some(task => successById.has(task.id))) throw new Error("恢复点只完成半波任务，需核对归属后继续，不能重复施工");
      const recoveringThisWave = recoveryInput3 !== null && resumeRecord !== null && waveNumber === resumeRecord.wave;
      const wave: Task3[] = [];
      for (const task of plannedWave) {
        const dependencies = [...(effectiveDependencies.get(task.id) ?? [])].filter(id => !successById.has(id));
        if (dependencies.length) result.tasks.push({ id: task.id, title: task.title, status: "skipped", attempts: 0, artifactPath: "", reason: `依赖未成功：${dependencies.join("、")}` });
        else wave.push(task);
      }
      if (!wave.length) continue;
      if (!acceptedSnapshot) throw new Error("每波前缺少完整源码快照");
      acceptedSnapshot = await integrity(acceptedSnapshot, []);
      let wavePassed = false;
      let feedbackPath = "";
      const maxAttempts = contract.mode === "standard" ? 2 : 1;
      const firstAttempt = recoveringThisWave && resumeRecord ? Math.max(1, resumeRecord.attempt) : 1;
      for (let attempt = firstAttempt; attempt <= maxAttempts; attempt += 1) {
        attemptNumber = attempt;
        const usePrepared = recoveringThisWave && attempt === firstAttempt && resumePrepared;
        if (!usePrepared) { appliedTaskIds = []; preparedTasks = []; }
        const prefix = `${resumePrefix ? `${resumePrefix}-` : ""}w${waveNumber}-a${attempt}`;
        const waveBefore = await integrity(acceptedSnapshot, []);
        beforePath = await save(`${runRoot}/waves/${prefix}-before.json`, waveBefore);
        await persist("波次实施前", "running");
        const ownedBeforeWorkers = await snapshotOwned3();
        constructionStarted = true;
        const serial = wave.some(task => task.execution === "serial");
        if (serial && wave.length !== 1) throw new Error("串行任务不能与其他任务同波施工");
        const attemptReasons: string[] = [];
        let repairable = true;
        const staged: PreparedTask3[] = [];
        if (usePrepared && resumeRecord) {
          if (serial && !appliedTaskIds.includes(wave[0].id)) throw new Error("串行施工中断点没有已应用证明，需核对现场，不能自动重做");
          for (const task of wave.filter(item => !appliedTaskIds.includes(item.id))) {
            const prepared = preparedTasks.find(item => item.id === task.id);
            if (!prepared || !within3(prepared.stageRoot, [`${runRoot}/staging`]) || !within3(prepared.beforePath, [runRoot]) || !within3(prepared.reviewPath, [runRoot])) throw new Error(`恢复任务 ${task.id} 暂存归属不完整`);
            const originalWave: unknown = JSON.parse(await readText3(prepared.beforePath));
            if (baselineErrors3(originalWave).length) throw new Error("恢复缺少波次原始快照");
            for (const stamp of prepared.artifacts) if (await fileHash3(stamp.path) !== stamp.hash) throw new Error(`恢复暂存材料变化：${stamp.path}`);
            const stageRoot = prepared.stageRoot;
            const verdictPath = prepared.reviewPath;
            const verdict: unknown = JSON.parse(await readText3(verdictPath));
            if (implementationReviewErrors3(verdict).length || (verdict as ImplementationReview3).approved !== true) throw new Error(`恢复任务 ${task.id} 没有独立复核通过记录`);
            const manifestPath = `${stageRoot}/manifest.json`;
            const manifestText = await readText3(manifestPath);
            const changes = stagedManifest3(JSON.parse(manifestText), task, originalWave as Baseline3, protectedPaths);
            const artifacts: Support3[] = [{ path: manifestPath, hash: hash3(manifestText) }];
            for (const change of changes) if (change.action === "put") {
              const outputPath = `${stageRoot}/files/${change.path}`;
              if (await fileHash3(outputPath) !== change.outputHash) throw new Error(`恢复暂存输出不一致：${change.path}`);
              artifacts.push({ path: outputPath, hash: change.outputHash as string });
            }
            staged.push({ task, stageRoot, manifestPath, changes, artifacts });
          }
          report({ runId: run.id, kind: "recovery-wave", wave: waveNumber, appliedTaskIds, note: "已应用任务不再调用实施员；尚未应用的仅使用已复核暂存内容。" });
        } else {
        // 所有暂存内容需先验证，才能串行应用；每项实现完成即开始独立复核。
        const outcomes = await Promise.allSettled(wave.map(async task => {
          publishExecutionEvent({ runId: run.id, taskId: task.id, title: task.title, status: "running", attempts: attempt, artifactPath: beforePath });
          const stageRoot = `${runRoot}/staging/${prefix}/${task.id}`;
          let worker = actors.get(task.id);
          if (!worker) { worker = agent(`任务实现·${task.id}`, { system: "仅实现当前已批准任务，保留用户已有变更，缺权限/证据/决策时停止；不能扩大范围或弱化验收以完成任务。" }); actors.set(task.id, worker); }
          let outcome = await worker.ask<ExecutionOutcome3>(executionPrompt3(task, contract as Contract3, planPath, pointer.contractPath, stageRoot, beforePath, feedbackPath, language));
          let outputErrors = executionOutcomeErrors3(outcome);
          if (outputErrors.length) { outcome = await worker.ask<ExecutionOutcome3>(`只补本次实施摘要字段，不继续修改文件、不运行命令：${outputErrors.join("；")}。`); outputErrors = executionOutcomeErrors3(outcome); }
          if (outputErrors.length) throw new Error(`${task.id}：${outputErrors.join("；")}`);
          const taskRecordPath = await save(`${runRoot}/tasks/${prefix}-${task.id}.json`, { runId: run.id, taskId: task.id, outcome, stageRoot, beforePath });
          if (outcome.blocked) return { task, passed: false, repairable: false, reason: outcome.blockReason, path: taskRecordPath, prepared: null as PreparedTask3 | null };
          let prepared: PreparedTask3 | null = null;
          if (task.execution === "staged") {
            const manifestPath = `${stageRoot}/manifest.json`;
            const manifestText = await readText3(manifestPath);
            const changes = stagedManifest3(JSON.parse(manifestText), task, waveBefore, [planPath, pointer.contractPath, ...contract!.supports.map(item => item.path), runRoot]);
            const artifacts: Support3[] = [{ path: manifestPath, hash: hash3(manifestText) }];
            for (const change of changes) if (change.action === "put") {
              const outputPath = `${stageRoot}/files/${change.path}`;
              if (await fileHash3(outputPath) !== change.outputHash) throw new Error(`${task.id}：暂存文件输出摘要不符：${change.path}`);
              artifacts.push({ path: outputPath, hash: change.outputHash as string });
            }
            prepared = { task, stageRoot, manifestPath, changes, artifacts };
          }
          publishExecutionEvent({ runId: run.id, taskId: task.id, title: task.title, status: "reviewing", attempts: attempt, artifactPath: taskRecordPath });
          const verdict = await reviewImplementation(task, stageRoot, beforePath, prefix);
          return { task, passed: verdict.approved, repairable: verdict.repairable, reason: verdict.approved ? "" : verdict.issues.join("；") || verdict.summary, path: taskRecordPath, prepared };
        }));
        const ownedAfterWorkers = await snapshotOwned3();
        const workerOutputs = wave.flatMap(task => [
          `${runRoot}/tasks/${prefix}-${task.id}.json`,
          `${runRoot}/reviews/${prefix}-${task.id}.json`,
          ...(task.execution === "staged" ? [`${runRoot}/staging/${prefix}/${task.id}`] : []),
        ]);
        const ownedWorkerErrors = compareBaseline3(ownedBeforeWorkers, ownedAfterWorkers, workerOutputs);
        if (ownedWorkerErrors.length) throw new Error(`实施或复核越过执行目录归属：${ownedWorkerErrors.join("；")}`);
        if (serial) acceptedSnapshot = await integrity(waveBefore, wave[0].files);
        else acceptedSnapshot = await integrity(waveBefore, []);
        for (const outcome of outcomes) {
          if (outcome.status === "rejected") { attemptReasons.push(String(outcome.reason)); repairable = false; continue; }
          if (!outcome.value.passed) { attemptReasons.push(`${outcome.value.task.id}：${outcome.value.reason}`); repairable = repairable && outcome.value.repairable; }
          if (outcome.value.prepared) staged.push(outcome.value.prepared);
        }
        afterPath = await save(`${runRoot}/waves/${prefix}-prepared.json`, acceptedSnapshot);
        if (serial && attemptReasons.length === 0) appliedTaskIds = [wave[0].id];
        preparedTasks = staged.map(item => ({ id: item.task.id, stageRoot: item.stageRoot, beforePath, reviewPath: `${runRoot}/reviews/${prefix}-${item.task.id}.json`, artifacts: item.artifacts }));
        for (const item of staged) for (const stamp of item.artifacts) ownedArtifacts.set(stamp.path, stamp.hash);
        }
        if (attemptReasons.length === 0) await persist("波次准备已完成", "running");
        if (attemptReasons.length === 0 && !serial) {
          const targets = staged.flatMap(item => item.changes.map(change => change.path));
          if (new Set(targets.map(item => item.toLowerCase())).size !== targets.length) throw new Error("并行暂存 manifest 重复占有同一目标");
          for (const item of staged) for (const stamp of item.artifacts) if (await fileHash3(stamp.path) !== stamp.hash) throw new Error("暂存材料在审核后变化，未应用任何新内容");
          for (const item of staged) {
            acceptedSnapshot = await integrity(acceptedSnapshot, []);
            await persist(`应用前：${item.task.id}`, "running");
            const changed = await applyStaged3(item.task, item.stageRoot, acceptedSnapshot);
            acceptedSnapshot = await integrity(acceptedSnapshot, changed);
            appliedTaskIds.push(item.task.id);
            afterPath = await save(`${runRoot}/waves/${prefix}-applied-${item.task.id}.json`, acceptedSnapshot);
            await persist(`应用后：${item.task.id}`, "running");
          }
        }
        if (attemptReasons.length === 0) {
          phase("执行任务与阶段检查");
          const checkIds = [...new Set(wave.flatMap(task => task.checkIds))];
          for (const id of checkIds) {
            const item = contract.plan.checks.find(candidate => candidate.id === id);
            if (!item) throw new Error(`找不到任务检查：${id}`);
            if (usePrepared && result.checks.some(check => check.id === id && check.exitCode === 0 && check.errorKind === "" && check.integrityPassed === true)) continue;
            const checked = await check(item, prefix);
            if (!checked.passed) { attemptReasons.push(`${id}：${checked.reason}`); repairable = repairable && checked.repairable; if (contract.mode === "strict") break; }
          }
          const completedProvisional = new Set([...successById, ...wave.map(task => task.id)]);
          for (const stage of contract.plan.stages) if (attemptReasons.length === 0 && !stageChecksDone.has(stage.id) && contract.plan.tasks.filter(task => task.stageId === stage.id).every(task => completedProvisional.has(task.id))) {
            for (const id of stage.checkIds) {
              const item = contract.plan.checks.find(candidate => candidate.id === id);
              if (!item) throw new Error(`找不到阶段检查：${id}`);
              if (usePrepared && result.checks.some(check => check.id === id && check.exitCode === 0 && check.errorKind === "" && check.integrityPassed === true)) continue;
              const checked = await check(item, prefix);
              if (!checked.passed) { attemptReasons.push(`${id}：${checked.reason}`); repairable = repairable && checked.repairable; if (contract.mode === "strict") break; }
            }
            if (attemptReasons.length === 0) stageChecksDone.add(stage.id);
          }
        }
        feedbackPath = await save(`${runRoot}/waves/${prefix}-result.json`, { passed: attemptReasons.length === 0, repairable, reasons: attemptReasons, taskIds: wave.map(task => task.id), beforePath, afterPath });
        if (attemptReasons.length === 0) {
          wavePassed = true;
          for (const task of wave) {
            successById.add(task.id);
            result.tasks.push({ id: task.id, title: task.title, status: "completed", attempts: attempt, artifactPath: feedbackPath, reason: "已按当前任务独立复核和执行指定自动检查；真实行为仍以验证记录/用户验收为准" });
            publishExecutionEvent({ runId: run.id, taskId: task.id, title: task.title, status: "completed", attempts: attempt, artifactPath: feedbackPath });
          }
          await persist("波次实施与验收已记录", "running");
          break;
        }
        if (!repairable || attempt >= maxAttempts) {
          for (const task of wave) {
            result.tasks.push({ id: task.id, title: task.title, status: repairable ? "failed" : "blocked", attempts: attempt, artifactPath: feedbackPath, reason: attemptReasons.join("；") });
            publishExecutionEvent({ runId: run.id, taskId: task.id, title: task.title, status: repairable ? "failed" : "blocked", attempts: attempt, artifactPath: feedbackPath });
          }
          await persist("波次实施与验收已记录", "incomplete");
          break;
        }
        await persist("波次失败，保留修复记录", "running");
        phase("分波实现并独立复核");
        if (!acceptedSnapshot) throw new Error("失败后无有效快照，不调用修复员");
        acceptedSnapshot = await integrity(acceptedSnapshot, []);
        log(`波次 ${waveNumber} 的普通缺陷将在原范围内修复一次`);
      }
      if (!wavePassed && (contract.mode === "strict" || stopOnFailure)) break;
    }
    phase("整体终验并交付实现记录");
    if (!acceptedSnapshot) throw new Error("最终验收缺少有效快照");
    acceptedSnapshot = await integrity(acceptedSnapshot, []);
    const allTasksPassed = result.tasks.length === contract.plan.tasks.length && result.tasks.every(task => task.status === "completed");
    let finalPassed = allTasksPassed;
    if (allTasksPassed) {
      for (const item of contract.plan.checks.filter(candidate => candidate.kind === "final")) {
        if (recoveryInput3 && result.checks.some(check => check.id === item.id && check.exitCode === 0 && check.errorKind === "" && check.integrityPassed === true)) continue;
        const checked = await check(item, `${resumePrefix ? `${resumePrefix}-` : ""}final`);
        finalPassed = finalPassed && checked.passed;
        if (!checked.passed && contract.mode === "strict") break;
      }
    } else result.notCovered.push("依赖或任务失败，未宣称最终整体检查完成");
    acceptedSnapshot = await integrity(acceptedSnapshot, []);
    finalSnapshotPath = await save(`${runRoot}/final-snapshot.json`, acceptedSnapshot);
    result.filesChanged = changes3(baseline, acceptedSnapshot);
    for (const task of contract.plan.tasks) if (!result.tasks.some(item => item.id === task.id)) result.tasks.push({ id: task.id, title: task.title, status: "skipped", attempts: 0, artifactPath: "", reason: "此前波次失败，停止后续任务" });
    const finalChecksExist = contract.plan.tasks.length === 0 || contract.plan.checks.some(item => item.kind === "final");
    if (!finalChecksExist) { finalPassed = false; result.notCovered.push("有实施任务但合同没有最终检查，不能把任务检查代替整体终验；请 task-plan 补齐并复核"); }
    result.status = finalPassed ? "completed" : "incomplete";
    const passedCheckKinds = unique3(result.checks.filter(item => item.exitCode === 0 && !item.errorKind && item.integrityPassed).map(item => item.kind === "task" ? "任务" : item.kind === "stage" ? "阶段" : "最终"));
    result.conclusion = !finalPassed
      ? `仅完成 ${successById.size}/${contract.plan.tasks.length} 个任务，实施或验收未完成，未标记整体成功。`
      : contract.plan.tasks.length === 0
        ? "诊断方案没有实施任务，无需施工；未调用实施员或实施独立复核，未运行项目验收。仅核对方案包、授权与源码完整性；运行行为仍待另行验证。"
        : `已实现 ${successById.size} 个任务并通过独立代码复核；本执行记录中已通过的检查范围：${passedCheckKinds.join("/")}检查。${contract.plan.stages.every(stage => stage.checkIds.length === 0) ? "合同未配置阶段检查，未运行该类检查。" : ""}真实环境和上线行为仍由用户测试；既有记录不代表本次重跑。`;
    if (finalPassed) result.recovery = [];
    await persist("最终完整性与验收已记录", result.status === "completed" ? "completed" : "incomplete");
    deliveryStarted = true;
    await save(result.executionPath, executionMarkdown3(result));
    await persist("执行报告已写入", result.status === "completed" ? "completed" : "incomplete");
  } catch (error) {
    result.status = constructionStarted ? "incomplete" : "blocked";
    result.validationErrors.push(String(error));
    result.conclusion = `${constructionStarted ? "执行中止，已有变更保留" : "执行前校验未通过，零施工"}：${String(error)}。没有把未知完整性标记为成功。`;
    if (!finalSnapshotPath) result.notCovered.push("未取得最终快照，尚未完成基线/最终快照文件核对；实际文件变更范围未知，空列表不表示零变更。");
    result.recovery = executionRecovery3(planPath, checkpointPath);
    report({ runId: run.id, kind: "execution-blocked", conclusion: result.conclusion, checkpointPath, beforePath, afterPath });
    if (baseline) {
      try { await persist(lastStep || "执行停止，保留证据", result.status === "blocked" ? "blocked" : "incomplete"); }
      catch (saveError) { result.validationErrors.push(`停止记录写入失败：${String(saveError)}`); }
    }
  }
  if (!deliveryStarted && !resumeRecord) {
    try { await save(`${runRoot}/blocked-${hash3(stableJson3(result)).slice(7)}.md`, executionMarkdown3(result)); }
    catch (error) { result.validationErrors.push(`交付文件未写入：${String(error)}`); }
  }
  await publishExecutionReport3(result);
  return result;
}

phase("读取实施方案入口");
await world.run("node", ["-p", "process.platform"], { output: { tail: 512 } });
let entryPath3 = String(args.planPath ?? "").trim();
if (!entryPath3 && RECOVERY_CHECKPOINT_PATH3) {
  const checkpointPath = path3(RECOVERY_CHECKPOINT_PATH3);
  if (!checkpointPath || !/^\.zcode\/task-runs\/[a-f0-9]{64}\/checkpoint\.json$/.test(checkpointPath)) throw new Error("恢复点必须为安全的本轮执行记录");
  const record: unknown = JSON.parse(await readText3(checkpointPath));
  if (!executionRecord3(record) || typeof record.planPath !== "string" || typeof record.contractHash !== "string" || record.contractHash.slice(7) !== checkpointPath.split("/")[2] || typeof record.planHash !== "string" || typeof record.allowShell !== "boolean" || !Array.isArray(record.grants) || typeof record.approvalEvidence !== "string") throw new Error("恢复点缺少方案/授权输入");
  recoveryInput3 = record as unknown as ExecutionCheckpoint3;
  entryPath3 = record.planPath;
}
const safeEntryPath3 = path3(entryPath3);
if (!safeEntryPath3 || !safeEntryPath3.toLowerCase().endsWith(".md")) {
  const failure = executionFailure3(entryPath3, ["需要安全的 workspace 相对 .md planPath"]);
  await publishExecutionReport3(failure);
  return failure;
}
try {
  const entryText3 = await readText3(safeEntryPath3);
  const entryPointer3 = parsePointer3(entryText3);
  if (entryPointer3) return await runExecution3(safeEntryPath3, entryText3, entryPointer3);
  return await runLegacy2(entryText3);
} catch (error) {
  const failure = executionFailure3(safeEntryPath3, [String(error)]);
  await publishExecutionReport3(failure);
  return failure;
}
