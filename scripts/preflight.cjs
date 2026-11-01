const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { stripTypeScriptTypes } = require('node:module');
const corePath = fs.existsSync(path.join(__dirname, 'core.ts')) ? path.join(__dirname, 'core.ts') : path.join(__dirname, '..', '.zcode', 'workflows', '_task-core.ts');
const source = fs.readFileSync(corePath, 'utf8');
const core = new Function('world', stripTypeScriptTypes(`function load(){\n${source}\nreturn { hash3, stableJson3, path3, within3, compareBaseline3, validateContract3, parsePointer3, baselineErrors3, token3, serialRecoveryEvidence3, serialRecoveryEvidenceErrors3 };\n}`, { mode: 'transform' }) + '\nreturn load();')({ run: () => { throw Error('preflight does not use replayable workflow calls'); } });
const program = fs.readFileSync(path.join(__dirname, 'task-io.cjs'), 'utf8');
const checkpointPath = String(process.argv[2] || '').replace(/\\/g, '/');
let ioRoot = '';
function io(op, payload) {
  const output = spawnSync(process.execPath, ['-e', program, op, JSON.stringify({ ...payload, ioRoot, planPaths: [] })], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true, timeout: 1800000, maxBuffer: 40 * 1024 * 1024 });
  if (output.error) throw output.error;
  const value = JSON.parse(output.stdout || '{}');
  if (output.status !== 0 || !value.ok) throw Error(value.error || output.stderr || 'preflight IO failed');
  return value.result;
}
const read = name => {
  const meta = io('text', { path: name });
  if (!meta.chunked) {
    if (core.hash3(meta.text) !== meta.hash) throw Error('preflight input hash mismatch');
    return meta.text;
  }
  const chunks = [];
  for (let offset = 0; offset < meta.bytes; offset += 65536) chunks.push(Buffer.from(io('read', { path: name, offset, length: Math.min(65536, meta.bytes - offset), expectedHash: meta.hash }).data, 'base64'));
  if (io('hash', { path: name }).hash !== meta.hash) throw Error('preflight input changed during read');
  const content = Buffer.concat(chunks);
  const text = content.toString('utf8');
  if (core.hash3(text) !== meta.hash) throw Error('preflight input is not intact UTF-8');
  return text;
};
const parse = name => JSON.parse(read(name));
const exactHash = (name, expected) => { if (io('hash', { path: name }).hash !== expected) throw Error(`preflight hash mismatch: ${name}`); };
const stamp = (item, scopes) => {
  if (!item || core.path3(item.path) !== item.path || !core.within3(item.path, scopes) || typeof item.hash !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(item.hash)) throw Error('preflight artifact path/hash invalid');
  exactHash(item.path, item.hash);
};
const snapshot = (scopes, exclude) => io('snapshot', { scopes, exclude, readOnlySnapshot: true }).snapshot;
try {
  if (core.path3(checkpointPath) !== checkpointPath || !/^\.zcode\/task-(?:plans|runs)\/[a-f0-9]{64}\/checkpoint\.json$/.test(checkpointPath)) throw Error('use the exact workflow checkpointPath relative to the project root');
  ioRoot = checkpointPath.slice(0, -'/checkpoint.json'.length);
  const checkpointHash = io('hash', { path: checkpointPath }).hash;
  const record = parse(checkpointPath);
  const errors = [];
  if (ioRoot.includes('/task-plans/')) {
    if (record.inputPath !== `${ioRoot}/input.json` || core.path3(record.planPath) !== record.planPath || core.baselineErrors3(record.baseline).length) throw Error('planning checkpoint fields/baseline invalid');
    const inputRecord = parse(record.inputPath);
    if (inputRecord.root !== ioRoot || `.zcode/task-plans/${core.hash3(core.stableJson3({ input: inputRecord.input, originalPlanHash: inputRecord.originalPlanHash, acceptanceHint: inputRecord.acceptanceHint })).slice(7)}` !== ioRoot) throw Error('planning input fingerprint mismatch');
    const expectedPlan = record.completed ? record.publishedPlanHash : record.originalPlanHash;
    exactHash(record.planPath, expectedPlan);
    const current = snapshot(record.baseline.scopes, [ioRoot, record.planPath]);
    errors.push(...core.compareBaseline3(record.baseline, current, []));
    if (record.baseline.kind === 'git' && io('index', {}).hash !== record.indexHash) errors.push('Git index changed after planning checkpoint');
    if (record.draftPath) {
      const draft = parse(record.draftPath);
      if (record.draftPath !== `${ioRoot}/drafts/d-${core.hash3(core.stableJson3(draft)).slice(7)}.json`) errors.push('planning draft hash/path mismatch');
    }
    if (record.reviewPath) {
      const review = parse(record.reviewPath);
      if (record.reviewPath.includes('/reviews/r-') && record.reviewPath !== `${ioRoot}/reviews/r-${core.hash3(core.stableJson3(review)).slice(7)}.json`) errors.push('planning review hash/path mismatch');
    }
    if (!Array.isArray(record.supports) || !Array.isArray(record.supportHashes) || record.originalPlanHash !== inputRecord.originalPlanHash || !Number.isInteger(record.repairRounds) || record.repairRounds < 0 || record.repairRounds > 3 || typeof record.completed !== 'boolean') throw Error('planning recovery identity/budget invalid');
    const names = new Set();
    for (const item of record.supportHashes) {
      stamp(item, ['.zcode/task-plans']);
      if (!/^\.zcode\/task-plans\/[a-f0-9]{64}\//.test(item.path) || /(?:^|\/)(?:checkpoint\.json|contract\.json|io)(?:\/|$)/.test(item.path) || names.has(item.path) || !record.supports.includes(item.path)) throw Error('planning material binding invalid');
      names.add(item.path);
    }
    if (names.size !== record.supports.length || !names.has(record.inputPath) || (record.draftPath && !names.has(record.draftPath)) || (record.reviewPath && !names.has(record.reviewPath))) throw Error('planning material hashes incomplete');
    if (record.completed) {
      const pointer = core.parsePointer3(read(record.planPath));
      if (!pointer || !core.within3(pointer.contractPath, [ioRoot])) throw Error('completed plan package invalid');
      exactHash(pointer.contractPath, pointer.contractHash);
      const contract = parse(pointer.contractPath);
      const invalid = core.validateContract3(contract);
      if (invalid.length) throw Error(invalid.join('; '));
      for (const item of contract.supports) stamp(item, ['.zcode/task-plans']);
    }
  } else {
    if (record.contractHash?.slice(7) !== ioRoot.split('/')[2] || core.path3(record.planPath) !== record.planPath || record.resumeRequiresFreshPreflight !== true) throw Error('execution checkpoint package/fields invalid');
    exactHash(record.planPath, record.planHash);
    const pointer = core.parsePointer3(read(record.planPath));
    if (!pointer || pointer.contractHash !== record.contractHash) throw Error('execution plan no longer names this package');
    exactHash(pointer.contractPath, pointer.contractHash);
    const contract = parse(pointer.contractPath);
    const invalid = core.validateContract3(contract);
    if (invalid.length) throw Error(invalid.join('; '));
    if (core.stableJson3(record.supports) !== core.stableJson3(contract.supports)) throw Error('checkpoint support binding mismatch');
    if (!Array.isArray(record.artifacts) || !Array.isArray(record.preparedTasks) || !Array.isArray(record.appliedTaskIds) || !Number.isInteger(record.wave) || record.wave < 0 || !Number.isInteger(record.attempt) || record.attempt < 0 || record.attempt > (contract.mode === 'strict' ? 1 : 2) || typeof record.step !== 'string' || typeof record.allowShell !== 'boolean' || typeof record.confirmedToken !== 'string' || !Array.isArray(record.grants) || !record.grants.every(grant => contract.plan.checks.some(check => grant === `check:${check.id}`))) throw Error('execution recovery state/authorization invalid');
    if (typeof record.stopOnFailure !== 'boolean' || typeof record.language !== 'string' || !record.language.trim()) throw Error('execution original stop policy/language missing');
    if (record.step.startsWith('检查后完整性失败') || record.step === '波次失败，保留修复记录') throw Error('failed/integrity-failed attempts need review before construction recovery');
    const reasons = contract.plan.checks.filter(check => check.shell !== null).map(check => `${check.id}：显式 shell 验收（高风险）`);
    if (reasons.length && (!contract.allowShell || !record.allowShell || record.confirmedToken !== core.token3(contract, reasons))) throw Error('execution shell confirmation binding missing');
    if (contract.plan.checks.some(check => check.permission !== 'local-check' && !record.grants.includes(`check:${check.id}`))) throw Error('execution exact-check authorization missing');
    if (contract.mode === 'strict' && !(contract.approved && contract.approvalEvidence.trim()) && !(record.approvalSource === 'user' && typeof record.approvalEvidence === 'string' && record.approvalEvidence.trim())) throw Error('strict recovery approval missing');
    for (const item of contract.supports) stamp(item, ['.zcode/task-plans']);
    for (const item of record.artifacts) stamp(item, [ioRoot]);
    for (const task of record.preparedTasks) {
      if (!task || core.path3(task.stageRoot) !== task.stageRoot || !core.within3(task.stageRoot, [`${ioRoot}/staging`]) || !Array.isArray(task.artifacts) || !contract.plan.tasks.some(item => item.id === task.id)) throw Error('prepared task ownership invalid');
      for (const item of task.artifacts) stamp(item, [task.stageRoot]);
      for (const name of [task.beforePath, task.reviewPath]) if (!record.artifacts.some(item => item.path === name)) throw Error('prepared task baseline/review binding missing');
    }
    if (!record.artifacts.some(item => item.path === record.resultPath && item.hash === record.resultHash)) throw Error('execution result hash binding missing');
    exactHash(record.resultPath, record.resultHash);
    const result = parse(record.resultPath);
    if (!result || result.contractVersion !== 3 || result.packageHash !== record.contractHash || result.planPath !== record.planPath || !Array.isArray(result.tasks) || !Array.isArray(result.checks) || result.tasks.some(task => !task || task.status !== 'completed') || result.checks.some(check => !check || check.integrityPassed !== true || !Number.isInteger(check.exitCode) || typeof check.errorKind !== 'string')) throw Error('recorded execution is incomplete or contains an unaccepted integrity check');
    const latestChecks = new Map(result.checks.map(check => [check.id, check]));
    if ([...latestChecks.values()].some(check => check.exitCode !== 0 || check.errorKind !== '')) throw Error('recorded execution has unresolved failed checks');
    if (new Set(record.appliedTaskIds).size !== record.appliedTaskIds.length || record.appliedTaskIds.some(id => !contract.plan.tasks.some(task => task.id === id))) throw Error('recorded applied ownership invalid');
    for (const evidence of core.serialRecoveryEvidence3(contract.plan, record, result, ioRoot)) {
      const invalid = core.serialRecoveryEvidenceErrors3(evidence, contract.plan.tasks.find(task => task.id === evidence.taskId), parse(evidence.taskPath), parse(evidence.reviewPath), parse(evidence.beforePath), parse(evidence.beforePath.replace(/-before\.json$/, '-prepared.json')));
      if (invalid.length) throw Error(invalid.join('; '));
    }
    const expectedPath = record.status === 'completed' ? record.finalSnapshotPath : record.step === '波次实施前' || String(record.step).startsWith('检查前：') ? record.beforePath : record.afterPath || record.beforePath || record.baselinePath;
    if (core.path3(expectedPath) !== expectedPath || !core.within3(expectedPath, [ioRoot]) || !record.artifacts.some(item => item.path === expectedPath)) throw Error('execution expected snapshot path/binding invalid');
    const expected = parse(expectedPath);
    if (core.baselineErrors3(expected).length) throw Error('execution expected baseline invalid');
    const current = snapshot(expected.scopes, [ioRoot]);
    errors.push(...core.compareBaseline3(expected, current, []));
    if (expected.kind === 'git' && io('index', {}).hash !== record.indexHash) errors.push('Git index changed after execution checkpoint');
  }
  exactHash(checkpointPath, checkpointHash);
  if (errors.length) throw Error(errors.join('\n'));
  process.stdout.write(JSON.stringify({ ok: true, checkpointPath, status: record.status || record.phase, verification: 'fresh deterministic read-only preflight; recorded workflow checks were not rerun' }, null, 2) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({ ok: false, checkpointPath, error: String(error.message || error), action: 'do not resume construction until the actual mismatch is reviewed' }, null, 2) + '\n');
  process.exitCode = 1;
}
