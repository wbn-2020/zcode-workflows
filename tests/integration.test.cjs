const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { root, hash, loadCore, fixture, plan, task, check, review, contract, runWorkflow } = require('./helpers.cjs');

async function fixturePackage(f, planOverrides = {}, contractOverrides = {}) {
  const c = await loadCore(f.world);
  const planRoot = '.zcode/task-plans/' + '8'.repeat(64);
  c.authorizeIoRoot3(planRoot);
  const value = plan(planOverrides);
  const baseline = await c.snapshot3(['.'], [planRoot, 'plan.md']);
  const x = await contract(c, value, { baseline, ...contractOverrides });
  x.reviewedReviewHash = c.hash3(c.stableJson3(x.review));
  const contractPath = `${planRoot}/v-${'9'.repeat(64)}/contract.json`;
  const text = JSON.stringify(x, null, 2) + '\n';
  f.put(contractPath, text);
  const pointer = { contractVersion: 3, contractPath, contractHash: hash(text) };
  f.put('plan.md', c.renderPlan3(x, pointer, {}));
  return { c, contract: x, pointer, runRoot: `.zcode/task-runs/${pointer.contractHash.slice(7)}` };
}

function worker(f, hooks = {}) {
  return name => ({ ask: async prompt => {
    if (name.startsWith('任务实现')) {
      const stage = prompt.match(/只可写唯一目录 ([^，\n]+)/)?.[1];
      const id = name.split('·')[1];
      const target = id === 'T2' ? 'src/b.js' : 'src/a.js';
      const output = 'module.exports = 2;\n';
      assert(stage);
      f.put(`${stage}/files/${target}`, output);
      f.put(`${stage}/manifest.json`, JSON.stringify({ changes: [{ action: 'put', path: target, baseHash: hash(f.read(target)), outputHash: hash(output) }] }));
      if (hooks.implemented) hooks.implemented(name, stage);
      return { summary: '变更已暂存', blocked: false, blockReason: '', notes: '未运行验收' };
    }
    if (name.startsWith('实现独立复核')) return { approved: true, issues: [], repairable: false, summary: '核对源文件、变更副本与任务条件' };
    throw Error('unexpected actor ' + name);
  } });
}

function planningActors(options = {}) {
  let repairs = 0;
  return {
    get repairs() { return repairs; },
    factory: name => ({ ask: async prompt => {
      if (name === '需求与范围分析') return { scenario: 'diagnostic', title: '排查方案', goal: '实际排查', summary: '调查当前代码', shards: [{ kind: 'repository', paths: ['src'], focus: '调用链' }, ...(options.failedShard ? [{ kind: 'repository', paths: ['src'], focus: '另一个风险主题' }] : [])] };
      if (name.startsWith('实际调查')) {
        if (options.failedShard && name.endsWith('A2')) throw Error('ContextLimit: fixture shard incomplete');
        return { summary: '调用链调查已完成', evidence: plan().evidence, findings: [], technologies: [], coverage: ['实际读取调用链与资源生命周期'], gaps: [] };
      }
      if (name === '方案设计与修订') {
        if (prompt.includes('Patch3')) {
          repairs += 1;
          return { taskChanges: [], planChanges: { summary: `修订说明 ${repairs}` }, resolutions: [], summary: '保持任务与检查，仅补说明' };
        }
        return { title: '排查实施方案', goal: '实际排查', summary: '未发现已确认的修复项', requirements: plan().requirements, architecture: null, technologies: [], stages: [], checks: [], decisions: options.decisions || [], assumptions: [], notDoing: [], rollout: ['用户按需补真实环境验证'], taskSeeds: [] };
      }
      if (name.startsWith('方案连续复核') || name.startsWith('方案独立终审')) {
        if (options.neverApprove) return review({ verdict: 'revise', issues: [{ id: 'I1', taskIds: [], severity: 'medium', blocking: true, category: 'automatic', problem: 'fixture 语义缺口', fixSuggestion: '补证据与说明，不能清空此问题', evidence: 'fixture 复核' }] });
        if (options.decisions) return review({ verdict: 'revise', issues: [{ id: 'I1', taskIds: [], severity: 'medium', blocking: true, category: 'decision', problem: '需要用户业务决定', fixSuggestion: '在方案里统一确认', evidence: '原始需求没有该业务规则' }] });
        return review();
      }
      throw Error('unexpected planning actor ' + name);
    } }),
  };
}

test('diagnostic no-op delivers rollout without workers, project checks or service execution', async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'module.exports = 1;\n');
    const actors = planningActors();
    const result = await runWorkflow('task-plan', { args: { requirement: '排查当前调用链' }, world: f.world, agent: actors.factory });
    assert.equal(result.status, 'ready', result.errors.join('\n'));
    assert.equal(result.taskCount, 0);
    assert.equal(result.planWritten, true);
    assert.equal(actors.repairs, 0);
    let workers = 0;
    let projectChecks = 0;
    const executed = await runWorkflow('task-run', { args: { planPath: result.planPath }, world: { run: async (program, argv, opts) => {
      let payload = null;
      try { payload = JSON.parse(argv?.[argv.length - 1]); } catch {}
      if (payload?.program) { projectChecks += 1; throw Error('no-op must not run a project check or service'); }
      assert.equal(program, 'node', 'only controller bookkeeping may run');
      return f.world.run(program, argv, opts);
    } }, agent: () => { workers += 1; throw Error('no-op must not create implementation or review actors'); } });
    assert.equal(executed.status, 'completed', executed.validationErrors.join('\n'));
    assert.equal(workers, 0);
    assert.equal(projectChecks, 0);
    assert.deepEqual(executed.tasks, []);
    assert.deepEqual(executed.checks, []);
    assert.deepEqual(executed.verified, []);
    assert.deepEqual(executed.filesChanged, []);
    assert.match(executed.conclusion, /无需施工/);
    assert.match(executed.conclusion, /未运行项目验收/);
    assert.doesNotMatch(executed.conclusion, /通过独立代码复核|通过.*最终检查/);
    const text = f.read(executed.executionPath);
    assert.match(text, /快照核对未发现文件变更/);
    assert.match(text, /上线测试计划（未自动执行，需用户另行安排\/授权）：用户按需补真实环境验证/);
    assert.match(text, /本清单不授予启动服务、联网、发布或部署权限/);
  } finally { f.remove(); }
});

test('partial investigation failure salvages completed evidence and never publishes ready', async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'a');
    const events = [];
    const actors = planningActors({ failedShard: true });
    const result = await runWorkflow('task-plan', { args: { requirement: '排查全部相关链路' }, world: f.world, agent: actors.factory, report: x => events.push(x) });
    assert.equal(result.status, 'incomplete');
    assert.equal(result.planWritten, false);
    assert(events.some(x => x.kind === 'analysis'));
    assert(result.notCovered.some(x => x.includes('另一个风险主题')));
  } finally { f.remove(); }
});

test('semantic repairs stop at three and carry the remaining critique into salvage', async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'a');
    const actors = planningActors({ neverApprove: true });
    const result = await runWorkflow('task-plan', { args: { requirement: '排查当前链路' }, world: f.world, agent: actors.factory });
    assert.equal(result.status, 'incomplete');
    assert.equal(result.repairRounds, 3);
    assert.equal(actors.repairs, 3);
    assert.equal(result.planWritten, false);
    assert(result.errors.some(x => x.includes('fixture 语义缺口')));
  } finally { f.remove(); }
});

test('real user decisions are delivered together without automatic repair questions', async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'a');
    const actors = planningActors({ decisions: [{ id: 'D1', question: '保留旧收费规则吗？', recommendation: '保留', alternatives: ['新规则'], risks: ['兼容性变化'], affectsImplementation: true }] });
    const result = await runWorkflow('task-plan', { args: { requirement: '排查收费链路' }, world: f.world, agent: actors.factory });
    assert.equal(result.status, 'awaiting-decisions', result.errors.join('\n'));
    assert.equal(result.planWritten, true);
    assert.equal(result.repairRounds, 0);
  } finally { f.remove(); }
});

test('transaction rollback restores only its own partial writes after failure', async () => {
  const f = fixture();
  try {
    const runRoot = '.zcode/task-runs/' + '6'.repeat(64);
    const stageRoot = `${runRoot}/staging/w1-a1/T1`;
    f.put('src/a.js', 'original');
    const c = await loadCore(f.world);
    c.authorizeIoRoot3(runRoot);
    const before = await c.snapshot3(['.'], [runRoot]);
    const taskPath = `${stageRoot}/task.json`;
    const beforePath = `${stageRoot}/before.json`;
    const manifestPath = `${stageRoot}/manifest.json`;
    f.put(taskPath, JSON.stringify(task({ files: ['src/a.js', 'src/new.js'] })));
    f.put(beforePath, JSON.stringify(before));
    f.put(`${stageRoot}/files/src/a.js`, 'changed');
    f.put(`${stageRoot}/files/src/new.js`, 'new');
    f.put(manifestPath, JSON.stringify({ changes: [{ action: 'put', path: 'src/a.js', baseHash: hash('original'), outputHash: hash('changed') }, { action: 'put', path: 'src/new.js', baseHash: null, outputHash: hash('new') }] }));
    const code = fs.readFileSync(path.join(root, 'scripts/task-apply.cjs'), 'utf8');
    const out = await f.world.run('node', ['-e', code, JSON.stringify({ ioRoot: runRoot, stageRoot, taskPath, taskHash: hash(f.read(taskPath)), beforePath, manifestHash: hash(f.read(manifestPath)), failAfter: 1 })]);
    assert.equal(out.exitCode, 1);
    assert.deepEqual(JSON.parse(out.stdout).rollbackErrors, []);
    assert.equal(f.read('src/a.js'), 'original');
    assert(!fs.existsSync(path.join(f.dir, 'src/new.js')));
  } finally { f.remove(); }
});

test('post-check snapshot failure records the check and never invokes a repair worker', async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'module.exports = 1;\n');
    f.put('checks.cjs', 'process.exit(0);\n');
    await fixturePackage(f);
    let checks = 0;
    let workers = 0;
    const world = { run: async (cmd, argv, opts) => {
      const last = argv?.[argv.length - 1];
      let payload = null;
      try { payload = JSON.parse(last); } catch {}
      if (payload?.program === 'node') checks += 1;
      if (checks && argv?.[2] === 'snapshot' && payload?.scopes?.[0] === '.') throw Error('fixture unreadable snapshot');
      return f.world.run(cmd, argv, opts);
    } };
    const base = worker(f, { implemented: () => { workers += 1; } });
    const result = await runWorkflow('task-run', { args: { planPath: 'plan.md' }, world, agent: base });
    assert.equal(result.status, 'incomplete');
    assert.equal(workers, 1);
    assert.equal(checks, 1);
    assert.equal(result.checks.length, 1);
    assert.equal(result.checks[0].exitCode, 0);
    assert.equal(result.checks[0].integrityPassed, false);
    assert(!result.verified.some(item => item.includes(result.checks[0].id)));
    assert(result.validationErrors.some(x => x.includes('unreadable snapshot')));
    assert.equal(f.read('src/a.js'), 'module.exports = 2;\n');
    assert.deepEqual(result.filesChanged, [], 'no final snapshot means the list is unknown, not proof of no changes');
    assert(result.notCovered.some(item => item.includes('未取得最终快照') && item.includes('空列表不表示零变更')));
    const text = f.read(result.executionPath);
    assert.match(text, /实际文件变更范围未知；空列表不表示零变更/);
    assert.doesNotMatch(text, /快照核对未发现文件变更/);
    assert.match(text, /fresh preflight/);
    assert.match(text, /失败记录与修复预算不会清零/);
    const recovered = await runWorkflow('task-run', { args: {}, recoveryCheckpointPath: result.checkpointPath, world: f.world, agent: () => { workers += 1; throw Error('integrity failure must not re-enter construction'); } });
    assert.equal(recovered.status, 'blocked');
    assert.equal(workers, 1);
    assert(recovered.validationErrors.some(item => item.includes('完整性未通过')));
  } finally { f.remove(); }
});

test('safe staged tasks prepare concurrently and protected state edits fail before apply', async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'module.exports = 1;\n');
    f.put('src/b.js', 'module.exports = 1;\n');
    f.put('checks.cjs', 'process.exit(0);\n');
    const pkg = await fixturePackage(f, { tasks: [task(), task({ id: 'T2', files: ['src/b.js'], readFiles: ['src/b.js'], outputs: ['src/b.js'] })] });
    let active = 0;
    let maxActive = 0;
    const base = worker(f);
    const result = await runWorkflow('task-run', { args: { planPath: 'plan.md' }, world: f.world, agent: name => ({ ask: async prompt => {
      if (name.startsWith('任务实现')) {
        active += 1;
        maxActive = Math.max(active, maxActive);
        await new Promise(resolve => setTimeout(resolve, 20));
        f.put(`${pkg.runRoot}/checkpoint.json`, 'outside-worker-state-change');
        const response = await base(name).ask(prompt);
        active -= 1;
        return response;
      }
      return base(name).ask(prompt);
    } }) });
    assert.equal(maxActive, 2);
    assert.equal(result.status, 'incomplete');
    assert.equal(f.read('src/a.js'), 'module.exports = 1;\n');
    assert.equal(f.read('src/b.js'), 'module.exports = 1;\n');
    assert(result.validationErrors.some(x => x.includes('执行目录归属')));
  } finally { f.remove(); }
});

test('a fresh invocation refuses a nonterminal execution checkpoint instead of redoing code', async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'module.exports = 1;\n');
    f.put('checks.cjs', 'process.exit(0);\n');
    await fixturePackage(f);
    const blocked = await runWorkflow('task-run', { args: { planPath: 'plan.md' }, world: f.world, agent: name => ({ ask: async () => name.startsWith('任务实现') ? { summary: '缺少实施证据', blocked: true, blockReason: 'fixture required evidence', notes: '' } : { approved: true, issues: [], repairable: false, summary: 'x' } }) });
    assert.equal(blocked.status, 'incomplete');
    let workers = 0;
    const repeat = await runWorkflow('task-run', { args: { planPath: 'plan.md' }, world: f.world, agent: () => { workers += 1; throw Error('must not execute'); } });
    assert.equal(repeat.status, 'blocked');
    assert.equal(workers, 0);
    assert(repeat.validationErrors.some(x => x.includes('非完成执行记录')));
  } finally { f.remove(); }
});

module.exports = { fixturePackage, worker, planningActors };
