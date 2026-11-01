const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadCore, loadPlanPure, fixture, runWorkflow, hash } = require('./helpers.cjs');

const sourceBefore = 'module.exports = 1;\n';
const sourceAfter = 'module.exports = 2;\n';

async function legacyContract(mode = 'standard') {
  const core = await loadCore();
  const plan = {
    mode, title: 'v2 fixture 方案', summary: '保持旧合同的执行约定', goal: '修正 fixture 返回值',
    requirements: [{ id: 'R1', statement: '返回正确值', acceptanceCriteria: ['返回值为 2'] }],
    architecture: mode === 'strict' ? {
      overview: '只修改现有导出', boundaries: ['src/a.js'], securityPrivacy: ['不涉及敏感数据'], dataMigration: ['不涉及数据迁移'],
    } : null,
    technicalDecisions: mode === 'strict' ? [{
      area: '现有模块', recommendation: '保持 CommonJS 接口', evidence: ['src/a.js:1'], rationale: '无需新依赖',
      alternatives: ['保留现有实现'], tradeoffs: '只修正返回值', risks: ['调用方依赖返回值'],
    }] : [],
    tasks: [{
      id: 'T1', title: '修正返回值', requirementIds: ['R1'], files: ['src/a.js'], steps: ['将返回值修正为 2'],
      behaviorAcceptance: ['现有导出接口不变'], acceptanceKind: 'argv', acceptance: null,
      acceptanceCommand: mode === 'strict'
        ? { program: 'npm', args: ['run', 'check:fixture'] }
        : { program: 'fixture-check', args: ['--fixture-only', 'two words', 'literal;argument'] },
      dependsOn: [], risk: '返回值变化', riskMitigation: ['保持接口'], status: 'ready', rationale: '修正已知错误',
    }],
    notDoing: ['不改其他模块'], openQuestions: [], assumptions: [],
  };
  const review = { verdict: 'approve', issues: [], missing: [], scopeConcerns: [], acceptanceConcerns: [], summary: '已核对 fixture 方案' };
  return {
    contractVersion: 2, mode, allowShell: false, approvalRequired: mode === 'strict', approved: mode === 'strict',
    review, reviewedPlanSnapshot: core.stableJson3(plan), reviewedReviewHash: hash(core.stableJson3(review)), resolutions: [], plan,
  };
}

function contractText(value) {
  return '# v2 fixture\n\n<!-- TASK_RUN_CONTRACT_START -->\n' + JSON.stringify(value, null, 2) + '\n<!-- TASK_RUN_CONTRACT_END -->\n';
}

function legacyFixture(contract, options = {}) {
  const f = fixture();
  f.put('src/a.js', sourceBefore);
  f.put('plan.md', contractText(contract));
  const calls = { workers: 0, asks: 0, snapshots: 0, snapshotFailures: 0, acceptance: [], diffs: [], unexpected: [], markdown: [] };
  const outcome = (stdout = '', exitCode = 0, stderr = '') => ({ exitCode, stdout, stderr });
  const unexpected = message => { calls.unexpected.push(message); throw Error(message); };
  const changedPaths = () => ['plan.md', ...(f.read('src/a.js') === sourceBefore ? [] : ['src/a.js'])];
  const snapshotFails = via => {
    if (options.snapshotFailure?.at !== calls.snapshots || options.snapshotFailure?.via !== via) return false;
    calls.snapshotFailures += 1;
    return true;
  };
  const acceptance = (program, argv, runner, code, opts) => {
    const index = calls.acceptance.length;
    calls.acceptance.push({ program, args: argv.slice(), runner, code, timeoutMs: opts.timeoutMs });
    const exitCode = options.acceptanceExitCodes?.[index] ?? 0;
    return outcome(exitCode ? 'fixture assertion failed\n' : 'fixture assertion passed\n', exitCode);
  };
  const git = {
    status: async () => ({ staged: [], unstaged: changedPaths().filter(p => p !== 'plan.md'), untracked: ['plan.md'] }),
    changedFiles: async () => {
      calls.snapshots += 1;
      if (snapshotFails('changedFiles')) throw Error('fixture changedFiles unreadable');
      return changedPaths();
    },
    diff: async (revision, file) => { calls.diffs.push({ revision, file }); return ''; },
  };
  // Source Git and acceptance processes are mocked; fixed report IO only touches this fixture.
  const world = { run: async (program, argv = [], opts = {}) => {
    if (program === 'node' && argv.length === 2 && argv[0] === '-p' && argv[1] === 'process.platform') return outcome(process.platform + '\n');
    if (program === 'node' && argv.length === 4 && argv[0] === '-e' && argv[2] === 'text') {
      const payload = JSON.parse(argv[3]);
      if (payload.path !== 'plan.md') return unexpected('unexpected IO path: ' + payload.path);
      const text = f.read(payload.path);
      return outcome(JSON.stringify({ ok: true, result: { chunked: false, text, hash: hash(text) } }));
    }
    if (program === 'node' && argv.length === 4 && argv[0] === '-e' && ['hash', 'begin', 'chunk', 'commit'].includes(argv[2])) {
      const payload = JSON.parse(argv[3]);
      if (!payload.path?.startsWith('.zcode/task-runs/') && !payload.temp?.startsWith('.zcode/task-runs/')) return unexpected('report IO outside owned fixture root');
      return f.world.run(program, argv, opts);
    }
    if (program === 'git') {
      if (argv.length === 2 && argv[0] === 'rev-parse' && argv[1] === '--show-toplevel') return outcome(f.dir + '\n');
      if (argv.length === 2 && argv[0] === 'rev-parse' && argv[1] === 'HEAD') return outcome('1'.repeat(40) + '\n');
      if (JSON.stringify(argv) === JSON.stringify(['stash', 'list', '--format=%H'])) return outcome();
      if (JSON.stringify(argv) === JSON.stringify(['status', '--porcelain', '-uall'])) return outcome(changedPaths().map(p => (p === 'plan.md' ? '?? ' : ' M ') + p).join('\n') + '\n');
      if (JSON.stringify(argv) === JSON.stringify(['ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', 'src/a.js'])) {
        return snapshotFails('ignored') ? outcome('', 1, 'fixture ignored paths unreadable') : outcome();
      }
      if (argv.length === 3 && argv[0] === 'hash-object' && argv[1] === '--' && argv[2] === 'src/a.js') {
        return snapshotFails('hash') ? outcome('', 1, 'fixture hash unreadable') : outcome(hash(f.read(argv[2])).slice(7) + '\n');
      }
      return unexpected('unexpected Git call: ' + JSON.stringify(argv));
    }
    if (program === 'node' && argv[0] === '-e' && argv[2] === 'fixture-check') return acceptance(argv[2], argv.slice(3), program, argv[1], opts);
    if (program === 'npm') return acceptance(program, argv, program, '', opts);
    return unexpected('unexpected world call: ' + program + ' ' + JSON.stringify(argv));
  } };
  const env = {
    args: { planPath: 'plan.md' }, world, git,
    files: { read: async file => file === 'plan.md' ? f.read(file) : unexpected('unexpected files.read: ' + file) },
    agent: name => {
      calls.workers += 1;
      if (name !== '修复员·T1') return unexpected('unexpected agent: ' + name);
      return { ask: async () => {
        calls.asks += 1;
        f.put('src/a.js', sourceAfter);
        return { summary: 'fixture 返回值已修正', filesChanged: ['src/a.js'], notes: '未运行验收', blocked: false, blockReason: '' };
      } };
    },
    artifact: {
      board: () => {},
      markdown: async (name, text) => { calls.markdown.push({ name, text }); return { id: 'fixture', version: 1 }; },
      file: async (name, file) => { const text = fs.readFileSync(path.join(f.dir, file), 'utf8'); calls.markdown.push({ name, text, path: file }); return { id: name, version: 1 }; },
    },
  };
  return { ...f, calls, env };
}

for (const [mode, exitCodes] of [['standard', [0]], ['strict', [0]], ['standard', [1, 0]]]) {
  test(`v2 ${mode} argv executes${exitCodes.length === 2 ? ' with one readable-snapshot retry' : ''}`, async () => {
    const contract = await legacyContract(mode);
    const f = legacyFixture(contract, { acceptanceExitCodes: exitCodes });
    try {
      const originalPlan = f.read('plan.md');
      const result = await runWorkflow('task-run', f.env);
      assert.deepEqual(f.calls.unexpected, []);
      assert.deepEqual(result.validationErrors, []);
      assert.equal(result.mode, mode);
      assert.equal(result.allowShell, false);
      assert.equal(result.requiresConfirmation, false);
      assert.deepEqual(result.shellTaskIds, []);
      assert.equal(result.completed, 1);
      assert.equal(result.failed, 0);
      assert.equal(result.skipped, 0);
      assert.equal(f.calls.workers, 1);
      assert.equal(f.calls.asks, exitCodes.length);
      assert.equal(f.calls.acceptance.length, exitCodes.length);
      for (const call of f.calls.acceptance) {
        assert.equal(call.program, contract.plan.tasks[0].acceptanceCommand.program);
        assert.deepEqual(call.args, contract.plan.tasks[0].acceptanceCommand.args);
        assert.equal(call.timeoutMs, mode === 'standard' ? 1810000 : 1800000);
        if (mode === 'standard') {
          assert.equal(call.runner, 'node');
          assert.match(call.code, /spawnSync/);
          assert.doesNotMatch(call.code, /execSync|shell\s*:\s*true/);
        } else assert.equal(call.runner, 'npm');
      }
      assert.equal(result.batches.length, 1);
      assert.equal(result.batches[0].status, 'completed');
      assert.equal(result.batches[0].scopeVerified, true);
      assert.equal(result.batches[0].attempts, exitCodes.length);
      assert.deepEqual(result.filesChanged, ['src/a.js']);
      assert.equal(f.read('src/a.js'), sourceAfter);
      assert.equal(f.read('plan.md'), originalPlan);
    } finally { f.remove(); }
  });
}

const rejected = [
  { label: 'resolutions=null', change: c => { c.resolutions = null; }, error: /v2|resolutions/, legacy: false },
  { label: 'resolutions=[null]', change: c => { c.resolutions = [null]; }, error: /resolutions\[0\]/, legacy: true },
  { label: 'tampered plan', change: c => { c.plan.goal += ' 篡改'; }, error: /v2|reviewedPlanSnapshot/, legacy: false },
  { label: 'tampered review', change: c => { c.review.summary += ' 篡改'; }, error: /v2|reviewedReviewHash/, legacy: false },
  { label: 'v1 contract', change: c => { c.contractVersion = 1; }, error: /version 1|合同版本.*1|v1/, legacy: false },
];
for (const item of rejected) test(`${item.label}: rejected before any construction or acceptance`, async () => {
  const contract = await legacyContract();
  item.change(contract);
  const f = legacyFixture(contract);
  try {
    const originalPlan = f.read('plan.md');
    const result = await runWorkflow('task-run', f.env);
    assert.deepEqual(f.calls.unexpected, []);
    assert.equal(f.calls.workers, 0);
    assert.equal(f.calls.asks, 0);
    assert.equal(f.calls.acceptance.length, 0);
    assert.equal(f.calls.snapshots, 0);
    assert(result.validationErrors.length > 0);
    assert.match(result.validationErrors.join('\n'), item.error);
    if (item.legacy) {
      assert.deepEqual(result.batches, []);
      assert.equal(result.completed, 0);
      assert.equal(result.failed, 0);
    } else {
      assert.equal(result.status, 'blocked');
      assert.deepEqual(result.tasks, []);
      assert.deepEqual(result.checks, []);
    }
    assert.deepEqual(result.filesChanged, []);
    assert.equal(f.read('src/a.js'), sourceBefore);
    assert.equal(f.read('plan.md'), originalPlan);
  } finally { f.remove(); }
});

const unreadableSnapshots = [
  { label: 'baseline ignored list', at: 1, via: 'ignored', asks: 0, checks: 0, finalSnapshots: 1, error: /快照.*拒绝执行/ },
  { label: 'before fixer changed paths', at: 2, via: 'changedFiles', asks: 0, checks: 0, finalSnapshots: 3, error: /快照读取失败/ },
  { label: 'after fixer hash with no deletion diff', at: 3, via: 'hash', asks: 1, checks: 0, finalSnapshots: 4, error: /修复后.*快照/ },
  { label: 'after passing argv', at: 4, via: 'ignored', asks: 1, checks: 1, finalSnapshots: 5, exitCodes: [0], error: /验收后.*快照/ },
  { label: 'after failing argv', at: 4, via: 'ignored', asks: 1, checks: 1, finalSnapshots: 5, exitCodes: [1], error: /验收后.*快照/ },
  { label: 'before retry fixer', at: 5, via: 'changedFiles', asks: 1, checks: 1, finalSnapshots: 6, exitCodes: [1], error: /重试前.*快照/ },
];
for (const item of unreadableSnapshots) test(`v2 standard ${item.label}: unreadable snapshot never starts or retries construction`, async () => {
  const f = legacyFixture(await legacyContract(), { snapshotFailure: item, acceptanceExitCodes: item.exitCodes });
  try {
    const originalPlan = f.read('plan.md');
    const result = await runWorkflow('task-run', f.env);
    assert.deepEqual(f.calls.unexpected, []);
    assert.equal(f.calls.snapshotFailures, 1);
    assert.equal(f.calls.snapshots, item.finalSnapshots);
    assert.equal(f.calls.workers, item.asks ? 1 : 0);
    assert.equal(f.calls.asks, item.asks);
    assert.equal(f.calls.acceptance.length, item.checks);
    assert.equal(result.completed, 0);
    if (item.at === 1) {
      assert.deepEqual(result.batches, []);
      assert.match(result.validationErrors.join('\n'), item.error);
    } else {
      assert.equal(result.failed, 1);
      assert.deepEqual(result.validationErrors, []);
      assert.equal(result.batches.length, 1);
      assert.equal(result.batches[0].status, 'failed');
      assert.equal(result.batches[0].scopeVerified, false);
      assert.match(result.batches[0].notes, item.error);
      if (item.at <= 4) assert.equal(result.batches[0].attempts, item.asks);
    }
    if (item.via === 'hash') assert.deepEqual(f.calls.diffs, [{ revision: 'HEAD', file: 'src/a.js' }]);
    assert.equal(f.read('src/a.js'), item.asks ? sourceAfter : sourceBefore);
    assert.equal(f.read('plan.md'), originalPlan);
  } finally { f.remove(); }
});

test('v2 final snapshot failure cannot report complete success after a passing batch', async () => {
  const f = legacyFixture(await legacyContract(), { snapshotFailure: { at: 5, via: 'ignored' } });
  try {
    const result = await runWorkflow('task-run', f.env);
    assert.deepEqual(f.calls.unexpected, []);
    assert.equal(f.calls.snapshotFailures, 1);
    assert.equal(f.calls.snapshots, 5);
    assert.equal(f.calls.asks, 1);
    assert.equal(f.calls.acceptance.length, 1);
    assert.equal(result.batches[0].status, 'completed');
    assert.equal(result.batches[0].scopeVerified, true);
    assert.deepEqual(result.batches[0].filesChanged, ['src/a.js']);
    assert.match(result.finalStatus, /无法读取.*快照|快照读取失败/);
    assert.match(result.conclusion, /结果不可视为完全成功/);
    assert(result.deviations.some(item => /最终.*快照读取失败/.test(item)));
    assert(result.notCovered.some(item => /最终.*快照读取失败/.test(item)));
    assert(f.calls.markdown.some(item => /结果不可视为完全成功/.test(item.text)));
    assert.equal(f.read('src/a.js'), sourceAfter);
  } finally { f.remove(); }
});

for (const mode of ['standard', 'strict']) test(`v2 ${mode} migration is pure and preserves argv, decisions and approval`, async () => {
  const core = await loadCore();
  const adapter = await loadPlanPure();
  const contract = await legacyContract(mode);
  contract.plan.openQuestions = [{ id: 'Q1', question: '沿用现有规则？', blocking: true, relatedTaskIds: ['T1'] }];
  contract.resolutions = [{ questionId: 'Q1', decision: '沿用现有规则', evidence: 'fixture 用户明确决定' }];
  contract.plan.tasks.push({ ...contract.plan.tasks[0], id: 'T2', status: 'do-not-fix', acceptanceKind: 'none', acceptanceCommand: null });
  contract.reviewedPlanSnapshot = core.stableJson3(contract.plan);
  const original = structuredClone(contract);
  const result = adapter.legacyPlan3(contractText(contract));
  assert.equal(result.mode, mode);
  assert.equal(result.allowShell, false);
  assert.equal(result.approved, mode === 'strict');
  assert.deepEqual(result.plan.tasks.map(item => item.id), ['T1']);
  assert.equal(result.plan.tasks[0].execution, 'serial');
  assert.deepEqual(result.plan.tasks[0].checkIds, ['C-T1']);
  assert.deepEqual(result.plan.tasks[0].readFiles, contract.plan.tasks[0].files);
  assert.deepEqual(result.plan.checks.map(item => ({ id: item.id, program: item.program, args: item.args, shell: item.shell })), [
    { id: 'C-T1', ...contract.plan.tasks[0].acceptanceCommand, shell: null },
  ]);
  assert.deepEqual(result.plan.requirements[0].criteria, contract.plan.requirements[0].acceptanceCriteria);
  assert.equal(result.plan.decisions[0].id, 'Q1');
  assert.equal(result.plan.decisions[0].affectsImplementation, true);
  assert.deepEqual(result.resolutions, contract.resolutions);
  assert(result.plan.gaps.some(item => item.includes('v2')));
  assert.deepEqual(contract, original);
});

test('v2 migration refuses v1, tampering and resolutions without user evidence', async () => {
  const adapter = await loadPlanPure();
  const contract = await legacyContract();
  for (const item of rejected) {
    const invalid = structuredClone(contract);
    item.change(invalid);
    assert.throws(() => adapter.legacyPlan3(contractText(invalid)), /v2|v1|摘要|决议/, item.label);
  }
  contract.resolutions = [{ questionId: 'Q1', decision: '自行推断' }];
  assert.throws(() => adapter.legacyPlan3(contractText(contract)), /缺少用户证据/);
});
