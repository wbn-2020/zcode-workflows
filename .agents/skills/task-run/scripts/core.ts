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
const IO_PROGRAM3 = "__TASK_IO_PROGRAM__";
const APPLY_PROGRAM3 = "__TASK_APPLY_PROGRAM__";
const CHECK_PROGRAM3 = "__TASK_CHECK_PROGRAM__";
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

