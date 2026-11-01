const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { root, hash, loadCore, loadRunPure, fixture, plan, task, check, review, contract, runWorkflow } = require('./helpers.cjs');

function preflight3(f, checkpointPath) {
  const before = JSON.parse(f.read(checkpointPath));
  const out = cp.spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(root, 'scripts/preflight.cjs'), checkpointPath], { cwd: f.dir, encoding: 'utf8', windowsHide: true, timeout: 120000 });
  assert.ifError(out.error);
  assert.deepEqual(JSON.parse(f.read(checkpointPath)), before, 'preflight must not write the checkpoint');
  return { exitCode: out.status, ...JSON.parse(out.status === 0 ? out.stdout : out.stderr) };
}

async function package3(f, planOverrides = {}, contractOverrides = {}) {
  const c = await loadCore(f.world);
  const root = '.zcode/task-plans/' + '8'.repeat(64);
  c.authorizeIoRoot3(root);
  const baseline = await c.snapshot3(['.'], [root, 'plan.md']);
  const x = await contract(c, plan(planOverrides), { baseline, ...contractOverrides });
  const contractPath = `${root}/v-${'9'.repeat(64)}/contract.json`;
  const text = JSON.stringify(x, null, 2) + '\n';
  f.put(contractPath, text);
  const pointer = { contractVersion: 3, contractPath, contractHash: hash(text) };
  f.put('plan.md', c.renderPlan3(x, pointer, {}));
  return { c, pointer };
}

function actor3(f, counters) {
  return name => ({ ask: async prompt => {
    if (name.startsWith('任务实现')) {
      counters.workers += 1;
      const stage = prompt.match(/只可写唯一目录 ([^，\n]+)/)?.[1];
      assert(stage);
      const content = 'module.exports = 2;\n';
      f.put(`${stage}/files/src/a.js`, content);
      f.put(`${stage}/manifest.json`, JSON.stringify({ changes: [{ action: 'put', path: 'src/a.js', baseHash: hash(f.read('src/a.js')), outputHash: hash(content) }] }));
      return { summary: '已暂存修复', blocked: false, blockReason: '', notes: '未运行检查' };
    }
    if (name.startsWith('实现独立复核')) return { approved: true, issues: [], repairable: false, summary: '读取原始与暂存实现，符合任务' };
    throw Error('unexpected actor ' + name);
  } });
}

for (const interruptedStep of ['波次准备已完成', '检查后：CT', '波次实施与验收已记录']) test(`serial recovery never repeats construction at ${interruptedStep}`, async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'module.exports = 1;\n');
    f.put('checks.cjs', 'process.exit(0);\n');
    const { pointer } = await package3(f, { tasks: [task({ execution: 'serial' })] });
    let interrupted = false;
    let workers = 0;
    let commands = 0;
    const world = { run: async (program, argv, opts) => {
      if (interrupted) throw Error('fixture abrupt serial interruption');
      let payload = null;
      try { payload = JSON.parse(argv?.[argv.length - 1]); } catch {}
      if (payload?.program === 'node' && payload.args?.[0] === 'checks.cjs') commands += 1;
      return f.world.run(program, argv, opts);
    } };
    const stopped = await runWorkflow('task-run', {
      args: { planPath: 'plan.md' }, world,
      agent: name => ({ ask: async () => {
        if (name.startsWith('任务实现')) { workers += 1; f.put('src/a.js', 'module.exports = 2;\n'); return { summary: '串行实现', blocked: false, blockReason: '', notes: '未运行检查' }; }
        if (name.startsWith('实现独立复核')) return { approved: true, issues: [], repairable: false, summary: '符合任务' };
        throw Error(name);
      } }),
      report: event => { if (event.kind === 'execution-checkpoint' && event.step === interruptedStep) interrupted = true; },
    });
    const checkpointPath = `.zcode/task-runs/${pointer.contractHash.slice(7)}/checkpoint.json`;
    const record = JSON.parse(f.read(checkpointPath));
    assert.equal(record.step, interruptedStep);
    assert.deepEqual(record.appliedTaskIds, ['T1']);
    assert.deepEqual(record.preparedTasks, []);
    assert.equal(record.attempt, 1);
    const recorded = JSON.parse(f.read(record.resultPath));
    assert.equal(recorded.tasks.length, interruptedStep === '波次实施与验收已记录' ? 1 : 0);
    assert.equal(preflight3(f, checkpointPath).ok, true);
    interrupted = false;
    const recovered = await runWorkflow('task-run', { args: {}, recoveryCheckpointPath: checkpointPath, world, agent: () => { throw Error('serial task must not construct again'); } });
    assert.equal(recovered.status, 'completed', recovered.validationErrors.join('\n'));
    assert.equal(workers, 1);
    assert.equal(commands, 3);
    assert.equal(recovered.tasks[0].attempts, 1);
    assert.equal(f.read('src/a.js'), 'module.exports = 2;\n');
    assert.equal(preflight3(f, checkpointPath).ok, true);
    const repeated = await runWorkflow('task-run', { args: { planPath: 'plan.md' }, world, agent: () => { throw Error('completed serial task must not construct again'); } });
    assert.equal(repeated.status, 'completed', repeated.validationErrors.join('\n'));
    assert.equal(repeated.alreadyApplied, true);
    assert.equal(commands, 3);
  } finally { f.remove(); }
});

for (const failure of ['blocked','rejected-review']) test(`serial ${failure} cannot become successful through interrupted result recovery`,async()=>{
  const f=fixture();try{
    f.put('src/a.js','original');f.put('checks.cjs','process.exit(0)');await package3(f,{tasks:[task({execution:'serial'})]});
    let interrupted=false;let workers=0;
    const stopped=await runWorkflow('task-run',{args:{planPath:'plan.md'},world:{run:async(program,argv,opts)=>{
      let payload=null;try{payload=JSON.parse(argv?.[argv.length-1]);}catch{}
      if(!interrupted&&payload?.path?.endsWith('/waves/w1-a1-result.json')){interrupted=true;throw Error('fixture interrupted wave result');}
      return f.world.run(program,argv,opts);
    }},agent:name=>({ask:async()=>{
      if(name.startsWith('任务实现')){workers++;return {summary:'本轮没有完成',blocked:failure==='blocked',blockReason:failure==='blocked'?'缺少资料':'',notes:'未修改源文件'};}
      if(name.startsWith('实现独立复核'))return {approved:false,issues:['fixture实现缺失'],repairable:false,summary:'未达到任务标准'};
      throw Error(name);
    }})});
    assert(interrupted);assert.equal(stopped.status,'incomplete');
    const checkpoint=JSON.parse(f.read(stopped.checkpointPath));
    assert.deepEqual(checkpoint.appliedTaskIds,[]);
    assert.deepEqual(JSON.parse(f.read(checkpoint.resultPath)).tasks,[]);
    for(const appliedTaskIds of [[],['T1']]){
      f.put(stopped.checkpointPath,JSON.stringify({...checkpoint,appliedTaskIds}));
      assert.equal(preflight3(f,stopped.checkpointPath).ok,false);
      const recovered=await runWorkflow('task-run',{args:{},recoveryCheckpointPath:stopped.checkpointPath,world:f.world,agent:()=>{workers++;throw Error('unsafe recovery must not construct');}});
      assert.equal(recovered.status,'blocked');assert.equal(workers,1);assert.equal(f.read('src/a.js'),'original');
    }
  }finally{f.remove();}
});

test('serial completed and alreadyApplied records require owned successful implementation evidence', async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'original');
    f.put('checks.cjs', 'process.exit(0)');
    await package3(f, { tasks: [task({ execution: 'serial' })] });
    let workers = 0;
    const completed = await runWorkflow('task-run', { args: { planPath: 'plan.md' }, world: f.world, agent: name => ({ ask: async () => {
      if (name.startsWith('任务实现')) { workers += 1; f.put('src/a.js', 'implemented'); return { summary: 'implemented', blocked: false, blockReason: '', notes: '' }; }
      if (name.startsWith('实现独立复核')) return { approved: true, issues: [], repairable: false, summary: 'matches task' };
      throw Error(name);
    } }) });
    assert.equal(completed.status, 'completed', completed.validationErrors.join('\n'));
    const checkpointText = f.read(completed.checkpointPath);
    const base = JSON.parse(checkpointText);
    const taskPath = base.artifacts.find(item => item.path.endsWith('/tasks/w1-a1-T1.json')).path;
    const reviewPath = base.artifacts.find(item => item.path.endsWith('/reviews/w1-a1-T1.json')).path;
    const implementationText = f.read(taskPath), reviewText = f.read(reviewPath);
    const cases = [
      { label: 'blocked outcome', path: taskPath, edit: value => { value.outcome.blocked = true; value.outcome.blockReason = 'missing input'; } },
      { label: 'rejected review', path: reviewPath, edit: value => { value.approved = false; value.issues = ['missing implementation']; } },
      { label: 'incomplete outcome', path: taskPath, edit: value => { delete value.outcome.notes; } },
      { label: 'incomplete review', path: reviewPath, edit: value => { delete value.summary; } },
      { label: 'wrong task owner', path: taskPath, edit: value => { value.taskId = 'T2'; } },
      { label: 'wrong before owner', path: taskPath, edit: value => { value.beforePath = base.baselinePath; } },
      { label: 'wrong attempt owner', path: taskPath, edit: value => { value.stageRoot = value.stageRoot.replace('w1-a1', 'w1-a2'); } },
      { label: 'missing implementation binding', missing: taskPath },
      { label: 'missing review binding', missing: reviewPath },
      { label: 'missing before binding', missing: JSON.parse(implementationText).beforePath },
      { label: 'missing integrity binding', missing: JSON.parse(implementationText).beforePath.replace('-before.json', '-prepared.json') },
    ];
    for (const change of cases) {
      const record = JSON.parse(checkpointText);
      f.put(taskPath, implementationText); f.put(reviewPath, reviewText);
      if (change.path) {
        const value = JSON.parse(f.read(change.path)); change.edit(value);
        const text = JSON.stringify(value); f.put(change.path, text);
        record.artifacts.find(item => item.path === change.path).hash = hash(text);
      }
      if (change.missing) record.artifacts = record.artifacts.filter(item => item.path !== change.missing);
      f.put(completed.checkpointPath, JSON.stringify(record));
      assert.equal(preflight3(f, completed.checkpointPath).ok, false, change.label);
      for (const recover of [false, true]) {
        const rejected = await runWorkflow('task-run', { args: recover ? {} : { planPath: 'plan.md' }, recoveryCheckpointPath: recover ? completed.checkpointPath : '', world: f.world, agent: () => { workers += 1; throw Error('must not reconstruct serial task'); } });
        assert.equal(rejected.status, 'blocked', change.label);
        assert.equal(rejected.alreadyApplied, false, change.label);
      }
      assert.equal(workers, 1, change.label);
    }
    f.put(taskPath, implementationText); f.put(reviewPath, reviewText); f.put(completed.checkpointPath, checkpointText);
    assert.equal(preflight3(f, completed.checkpointPath).ok, true);
  } finally { f.remove(); }
});

for (const failure of ['missing-outcome', 'missing-review']) test(`serial ${failure} interruption cannot restart construction`, async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'original'); f.put('checks.cjs', 'process.exit(0)');
    await package3(f, { tasks: [task({ execution: 'serial' })] });
    let workers = 0, interrupted = false;
    const stopped = await runWorkflow('task-run', { args: { planPath: 'plan.md' }, world: { run: async (program, argv, opts) => {
      let payload = null; try { payload = JSON.parse(argv?.[argv.length - 1]); } catch {}
      if (!interrupted && payload?.path?.endsWith('/waves/w1-a1-result.json')) { interrupted = true; throw Error('fixture interrupted result save'); }
      return f.world.run(program, argv, opts);
    } }, agent: name => ({ ask: async () => {
      if (name.startsWith('任务实现')) {
        workers += 1;
        if (failure === 'missing-outcome') throw Error('fixture lost implementation result');
        return { summary: 'unchanged', blocked: false, blockReason: '', notes: '' };
      }
      throw Error('fixture lost review result');
    } }) });
    assert(interrupted);
    const checkpoint = JSON.parse(f.read(stopped.checkpointPath));
    assert.deepEqual(checkpoint.appliedTaskIds, []);
    assert.equal(preflight3(f, stopped.checkpointPath).ok, false);
    const recovered = await runWorkflow('task-run', { args: {}, recoveryCheckpointPath: stopped.checkpointPath, world: f.world, agent: () => { workers += 1; throw Error('must not restart implementation'); } });
    assert.equal(recovered.status, 'blocked'); assert.equal(workers, 1); assert.equal(f.read('src/a.js'), 'original');
  } finally { f.remove(); }
});

test('missing-argument recovery keeps the original stop policy and language', async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'a');
    f.put('src/b.js', 'b');
    f.put('src/c.js', 'c');
    const tasks = ['a', 'b', 'c'].map((name, index) => task({ id: `T${index + 1}`, files: [`src/${name}.js`], readFiles: [`src/${name}.js`], outputs: [`src/${name}.js`], execution: 'serial', checkIds: [`C${index + 1}`] }));
    const checks = tasks.map((item, index) => check({ id: `C${index + 1}`, args: [`check-${index + 1}.cjs`] }));
    checks.push(check({ id: 'CF', kind: 'final', args: ['final.cjs'] }));
    const { pointer } = await package3(f, { tasks, checks, stages: [{ ...plan().stages[0], checkIds: [] }] });
    let interrupted = false;
    const asked = [];
    const world = { run: async (program, argv, opts) => {
      if (interrupted) throw Error('fixture stop after first serial wave');
      let payload = null;
      try { payload = JSON.parse(argv?.[argv.length - 1]); } catch {}
      if (payload?.program === 'node' && payload.args?.[0]?.startsWith('check-')) return { exitCode: 0, stdout: JSON.stringify({ exitCode: 0, stdout: 'fixture check', stderr: '', errorKind: '' }), stderr: '' };
      return f.world.run(program, argv, opts);
    } };
    const agent = name => ({ ask: async prompt => {
      asked.push({ name, prompt });
      if (name.startsWith('任务实现')) {
        assert(prompt.startsWith('输出语言：English。'));
        if (name.endsWith('T2')) return { summary: 'missing external input', blocked: true, blockReason: 'fixture task cannot proceed', notes: '' };
        f.put(name.endsWith('T1') ? 'src/a.js' : 'src/c.js', 'implemented');
        return { summary: 'implemented', blocked: false, blockReason: '', notes: 'no checks run by worker' };
      }
      if (name.startsWith('实现独立复核')) { assert(prompt.includes('输出 English')); return { approved: true, issues: [], repairable: false, summary: 'matches task' }; }
      throw Error(name);
    } });
    await runWorkflow('task-run', { args: { planPath: 'plan.md', stopOnFailure: false, language: 'English' }, world, agent, report: event => { if (event.kind === 'execution-checkpoint' && event.step === '波次实施与验收已记录') interrupted = true; } });
    const checkpointPath = `.zcode/task-runs/${pointer.contractHash.slice(7)}/checkpoint.json`;
    const record = JSON.parse(f.read(checkpointPath));
    assert.equal(record.stopOnFailure, false);
    assert.equal(record.language, 'English');
    assert.equal(preflight3(f, checkpointPath).ok, true);
    const original = f.read(checkpointPath);
    const missing = { ...record };
    delete missing.language;
    f.put(checkpointPath, JSON.stringify(missing));
    assert.equal(preflight3(f, checkpointPath).ok, false);
    const pure = await loadRunPure();
    assert(pure.executionCheckpointErrors3(missing, pointer, 'plan.md', checkpointPath.slice(0, -'/checkpoint.json'.length)).some(error => error.includes('输出语言')));
    f.put(checkpointPath, original);
    interrupted = false;
    const recovered = await runWorkflow('task-run', { args: {}, recoveryCheckpointPath: checkpointPath, world, agent });
    assert.equal(recovered.status, 'incomplete');
    assert.deepEqual(asked.filter(item => item.name.startsWith('任务实现')).map(item => item.name), ['任务实现·T1', '任务实现·T2', '任务实现·T3']);
    assert.equal(recovered.tasks.find(item => item.id === 'T2').status, 'blocked');
    assert.equal(recovered.tasks.find(item => item.id === 'T3').status, 'completed');
    const final = JSON.parse(f.read(checkpointPath));
    assert.equal(final.stopOnFailure, false);
    assert.equal(final.language, 'English');
  } finally { f.remove(); }
});

test('a checkpoint after an unresolved failed serial check cannot reset the repair budget', async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'a');
    const { pointer } = await package3(f, { tasks: [task({ execution: 'serial' })] });
    let interrupted = false;
    let workers = 0;
    const world = { run: async (program, argv, opts) => {
      if (interrupted) throw Error('fixture interruption after failed check');
      let payload = null;
      try { payload = JSON.parse(argv?.[argv.length - 1]); } catch {}
      if (payload?.program === 'node' && payload.args?.[0] === 'checks.cjs') return { exitCode: 0, stdout: JSON.stringify({ exitCode: 1, stdout: '', stderr: 'fixture failed test', errorKind: '' }), stderr: '' };
      return f.world.run(program, argv, opts);
    } };
    await runWorkflow('task-run', { args: { planPath: 'plan.md' }, world, agent: name => ({ ask: async () => {
      if (name.startsWith('任务实现')) { workers += 1; f.put('src/a.js', 'first implementation'); return { summary: 'implemented', blocked: false, blockReason: '', notes: '' }; }
      if (name.startsWith('实现独立复核')) return { approved: true, issues: [], repairable: false, summary: 'matches task' };
      throw Error(name);
    } }), report: event => { if (event.kind === 'execution-checkpoint' && event.step === '检查后：CT') interrupted = true; } });
    const checkpointPath = `.zcode/task-runs/${pointer.contractHash.slice(7)}/checkpoint.json`;
    assert.equal(JSON.parse(f.read(checkpointPath)).attempt, 1);
    assert.equal(preflight3(f, checkpointPath).ok, false);
    interrupted = false;
    const recovered = await runWorkflow('task-run', { args: {}, recoveryCheckpointPath: checkpointPath, world, agent: () => { workers += 1; throw Error('must not reset failed attempt'); } });
    assert.equal(recovered.status, 'blocked');
    assert.equal(workers, 1);
    assert(recovered.validationErrors.some(error => error.includes('未通过检查')));
  } finally { f.remove(); }
});

test('a successful bounded retry can recover while retaining the failed earlier check', async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'a');
    const { pointer } = await package3(f, { tasks: [task({ execution: 'serial' })] });
    let interrupted = false;
    let workers = 0;
    let commands = 0;
    const world = { run: async (program, argv, opts) => {
      if (interrupted) throw Error('fixture interruption after successful retry');
      let payload = null;
      try { payload = JSON.parse(argv?.[argv.length - 1]); } catch {}
      if (payload?.program === 'node' && payload.args?.[0] === 'checks.cjs') {
        commands += 1;
        return { exitCode: 0, stdout: JSON.stringify({ exitCode: commands === 1 ? 1 : 0, stdout: 'fixture check', stderr: commands === 1 ? 'first attempt failed' : '', errorKind: '' }), stderr: '' };
      }
      return f.world.run(program, argv, opts);
    } };
    await runWorkflow('task-run', { args: { planPath: 'plan.md' }, world, agent: name => ({ ask: async () => {
      if (name.startsWith('任务实现')) { workers += 1; f.put('src/a.js', `implementation ${workers}`); return { summary: 'implemented', blocked: false, blockReason: '', notes: '' }; }
      if (name.startsWith('实现独立复核')) return { approved: true, issues: [], repairable: false, summary: 'matches task' };
      throw Error(name);
    } }), report: event => { if (event.kind === 'execution-checkpoint' && event.step === '波次实施与验收已记录') interrupted = true; } });
    const checkpointPath = `.zcode/task-runs/${pointer.contractHash.slice(7)}/checkpoint.json`;
    const record = JSON.parse(f.read(checkpointPath));
    assert.equal(record.attempt, 2);
    assert.equal(preflight3(f, checkpointPath).ok, true);
    interrupted = false;
    const recovered = await runWorkflow('task-run', { args: {}, recoveryCheckpointPath: checkpointPath, world, agent: () => { throw Error('successful retry must not construct again'); } });
    assert.equal(recovered.status, 'completed', recovered.validationErrors.join('\n'));
    assert.equal(workers, 2);
    assert.equal(commands, 4);
    assert.equal(recovered.tasks[0].attempts, 2);
    assert.equal(recovered.checks[0].exitCode, 1);
    assert.equal(recovered.checks[1].exitCode, 0);
  } finally { f.remove(); }
});

test('checkpoint recovery with missing args never repeats an already applied staged task', async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'module.exports = 1;\n');
    f.put('checks.cjs', 'process.exit(require("./src/a.js") === 2 ? 0 : 1);\n');
    await package3(f);
    let interrupted = false;
    const counters = { workers: 0 };
    const stopped = await runWorkflow('task-run', {
      args: { planPath: 'plan.md' },
      world: { run: (...args) => {
        if (interrupted) throw Error('fixture abrupt interruption after apply');
        return f.world.run(...args);
      } },
      agent: actor3(f, counters),
      report: event => { if (event.kind === 'execution-checkpoint' && event.step === '应用后：T1') interrupted = true; },
    });
    assert.equal(stopped.status, 'incomplete');
    assert.equal(f.read('src/a.js'), 'module.exports = 2;\n');
    const checkpoint = JSON.parse(f.read(stopped.checkpointPath));
    assert.equal(checkpoint.step, '应用后：T1');
    assert.deepEqual(checkpoint.appliedTaskIds, ['T1']);
    assert.equal(preflight3(f, stopped.checkpointPath).ok, true);
    const recovered = await runWorkflow('task-run', {
      args: {},
      recoveryCheckpointPath: stopped.checkpointPath,
      world: f.world,
      run: { id: 'mock-recovery' },
      agent: () => { counters.workers += 1; throw Error('applied task must not be repeated'); },
    });
    assert.equal(recovered.status, 'completed', recovered.validationErrors.join('\n'));
    assert.equal(counters.workers, 1);
    assert.equal(recovered.checks.length, 3);
    assert.equal(f.read('src/a.js'), 'module.exports = 2;\n');
  } finally { f.remove(); }
});

test('recovery rejects source drift after an applied checkpoint without resetting the baseline', async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'module.exports = 1;\n');
    f.put('checks.cjs', 'process.exit(0);\n');
    await package3(f);
    let interrupted = false;
    const stopped = await runWorkflow('task-run', {
      args: { planPath: 'plan.md' }, world: { run: (...args) => interrupted ? Promise.reject(Error('fixture abrupt interruption')) : f.world.run(...args) },
      agent: actor3(f, { workers: 0 }), report: event => { if (event.kind === 'execution-checkpoint' && event.step === '应用后：T1') interrupted = true; },
    });
    f.put('src/a.js', 'external user change');
    assert.equal(preflight3(f, stopped.checkpointPath).ok, false);
    let workers = 0;
    const recovered = await runWorkflow('task-run', { args: {}, recoveryCheckpointPath: stopped.checkpointPath, world: f.world, agent: () => { workers += 1; throw Error('must not run'); } });
    assert.equal(recovered.status, 'blocked');
    assert.equal(workers, 0);
    assert(recovered.validationErrors.some(error => error.includes('最后可验证步骤')));
    assert.equal(f.read('src/a.js'), 'external user change');
  } finally { f.remove(); }
});

test('planner checkpoint restores the existing draft and semantic repair budget', async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'module.exports = 1;\n');
    let interrupted = false;
    let repairs = 0;
    const createAgent = name => ({ ask: async prompt => {
      if (name === '需求与范围分析') return { scenario: 'diagnostic', title: '排查', goal: '实际排查', summary: '当前链路', shards: [{ kind: 'repository', paths: ['src'], focus: '调用链' }] };
      if (name.startsWith('实际调查')) return { summary: '实际读取调用链', evidence: plan().evidence, findings: [], technologies: [], coverage: ['源文件调用链'], gaps: [] };
      if (name === '方案设计与修订') {
        if (prompt.includes('Patch3')) { repairs += 1; return { taskChanges: [], planChanges: { summary: '补齐结论依据' }, resolutions: [], summary: '补说明，不改变范围或验收' }; }
        return { title: '排查', goal: '实际排查', summary: '已完成', requirements: plan().requirements, architecture: null, technologies: [], stages: [], checks: [], decisions: [], assumptions: [], notDoing: [], rollout: [], taskSeeds: [] };
      }
      if (name.startsWith('方案连续复核')) return review({ verdict: 'revise', issues: [{ id: 'I1', taskIds: [], severity: 'medium', blocking: true, category: 'automatic', problem: '结论依据未说明', fixSuggestion: '补说明', evidence: 'fixture' }] });
      if (name.startsWith('方案独立终审')) return review();
      throw Error(name);
    } });
    const stopped = await runWorkflow('task-plan', {
      args: { requirement: '实际排查当前调用链' },
      world: { run: (...args) => interrupted ? Promise.reject(Error('fixture interruption')) : f.world.run(...args) },
      agent: createAgent,
      report: event => { if (event.kind === 'checkpoint' && event.phase === '自动修订后') interrupted = true; },
    });
    assert.equal(stopped.status, 'incomplete');
    assert.equal(repairs, 1);
    const checkpoint = JSON.parse(f.read(stopped.checkpointPath));
    assert.equal(checkpoint.repairRounds, 1);
    assert.equal(preflight3(f, stopped.checkpointPath).ok, true);
    const material = checkpoint.supports.find(name => name.endsWith('/analysis-index.json'));
    assert(material);
    const originalMaterial = f.read(material);
    f.put(material, originalMaterial + ' ');
    assert.equal(preflight3(f, stopped.checkpointPath).ok, false);
    f.put(material, originalMaterial);
    const recovered = await runWorkflow('task-plan', {
      args: {}, recoveryInputPath: stopped.inputPath, world: f.world,
      agent: name => ({ ask: async prompt => {
        if (name === '方案设计与修订' && prompt.startsWith('本次从已保存草稿')) return '已读取已有草稿，保留修订预算';
        if (name.startsWith('方案连续复核') || name.startsWith('方案独立终审')) return review();
        throw Error('must not regenerate or repeat repair: ' + name);
      } }),
    });
    assert.equal(recovered.status, 'ready', recovered.errors.join('\n'));
    assert.equal(recovered.planWritten, true);
    assert.equal(recovered.repairRounds, 1);
  } finally { f.remove(); }
});

for (const interruptedStep of ['应用后：T1', '检查后：CT']) test(`shell confirmation survives missing-argument recovery at ${interruptedStep}`, async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'module.exports = 1;\n');
    f.put('checks.cjs', 'process.exit(0);\n');
    const shellChecks = plan().checks.map(item => ({ ...item, program: '', args: [], shell: 'node checks.cjs' }));
    await package3(f, { checks: shellChecks }, { allowShell: true });
    const first = await runWorkflow('task-run', { args: { planPath: 'plan.md', allowShell: true }, world: f.world, agent: () => { throw Error('unconfirmed shell must not construct'); } });
    assert.equal(first.requiresConfirmation, true);
    let interrupted = false;
    let commands = 0;
    const counters = { workers: 0 };
    const liveWorld = { run: async (program, argv, opts) => {
      if (interrupted) throw Error('fixture interruption');
      let payload = null;
      try { payload = JSON.parse(argv?.[argv.length - 1]); } catch {}
      if (payload?.shell === 'node checks.cjs') { commands += 1; return { exitCode: 0, stdout: JSON.stringify({ exitCode: 0, stdout: 'mock authorized shell check', stderr: '', errorKind: '' }), stderr: '' }; }
      return f.world.run(program, argv, opts);
    } };
    const stopped = await runWorkflow('task-run', { args: { planPath: 'plan.md', allowShell: true, confirmationToken: first.confirmationToken }, world: liveWorld, agent: actor3(f, counters), report: event => { if (event.kind === 'execution-checkpoint' && event.step === interruptedStep) interrupted = true; } });
    assert.equal(stopped.status, 'incomplete');
    const record = JSON.parse(f.read(stopped.checkpointPath));
    assert.equal(record.confirmedToken, first.confirmationToken);
    assert.equal(preflight3(f, stopped.checkpointPath).ok, true);
    interrupted = false;
    const recovered = await runWorkflow('task-run', { args: {}, recoveryCheckpointPath: stopped.checkpointPath, world: liveWorld, agent: () => { counters.workers += 1; throw Error('must not repeat applied shell task'); } });
    assert.equal(recovered.status, 'completed', recovered.validationErrors.join('\n'));
    assert.equal(counters.workers, 1);
    assert.equal(recovered.requiresConfirmation, false);
    assert.equal(commands, 3);
    assert(recovered.checks.every(item => item.integrityPassed));
  } finally { f.remove(); }
});
