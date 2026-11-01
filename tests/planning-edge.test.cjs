const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { root, hash, loadCore, fixture, runWorkflow, plan, task, check, review, scenarioAgent } = require('./helpers.cjs');

const noOp = () => ({ title: '排查实施方案', goal: '实际排查', summary: '未发现已确认修复项', requirements: plan().requirements, architecture: null, technologies: [], stages: [], checks: [], decisions: [], assumptions: [], notDoing: [], rollout: [], taskSeeds: [] });
const analysis = focus => ({ summary: `已调查${focus}`, evidence: plan().evidence, findings: [], technologies: [], coverage: [focus], gaps: [] });
const preflight = (f, name) => cp.spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(root, 'scripts/preflight.cjs'), name], { cwd: f.dir, encoding: 'utf8', windowsHide: true, timeout: 120000 });

test('ContextLimit investigation is narrowed once rather than replaying the same oversized ask', async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'a');
    let originalAsks = 0;
    let splits = 0;
    const result = await runWorkflow('task-plan', { args: { requirement: '排查相关链路' }, world: f.world, agent: name => ({ ask: async () => {
      if (name === '需求与范围分析') return { scenario: 'diagnostic', title: '排查', goal: '实际调查', summary: '两条相关路径', shards: [{ kind: 'repository', paths: ['src'], focus: '入口和资源生命周期' }] };
      if (name === '实际调查·A1') { originalAsks += 1; throw Error('ContextLimit: fixture oversized module'); }
      if (name.startsWith('调查拆分·')) { splits += 1; return { shards: [{ kind: 'repository', paths: ['src'], focus: '入口错误路径' }, { kind: 'repository', paths: ['src'], focus: '资源释放路径' }] }; }
      if (name.startsWith('实际调查·A1-P')) return analysis(name.endsWith('1') ? '入口错误路径' : '资源释放路径');
      if (name === '方案设计与修订') return noOp();
      if (name.startsWith('方案连续复核') || name.startsWith('方案独立终审')) return review();
      throw Error('unexpected actor ' + name);
    } }) });
    assert.equal(result.status, 'ready', result.errors.join('\n'));
    assert.equal(originalAsks, 1);
    assert.equal(splits, 1);
    const c = await loadCore();
    const pointer = c.parsePointer3(f.read('plan.md'));
    const contract = JSON.parse(f.read(pointer.contractPath));
    assert.equal(new Set(contract.plan.evidence.map(item => item.id)).size, 2);
    assert.deepEqual(contract.plan.coverage.sort(), ['入口错误路径', '资源释放路径'].sort());
  } finally { f.remove(); }
});

test('two split layers keep unique identities and cannot split past the bounded depth', async () => {
  for (const exhausted of [false, true]) {
    const f = fixture();
    try {
      f.put('src/a.js', 'a');
      const asked = [];
      let splits = 0;
      const base = scenarioAgent('diagnostic', []);
      const result = await runWorkflow('task-plan', { args: { requirement: '排查较大的资源链路' }, world: f.world, agent: name => ({ ask: async prompt => {
        if (name === '需求与范围分析') return { scenario: 'diagnostic', title: '排查', goal: '实际调查', summary: '拆分相关链路', shards: [{ kind: 'repository', paths: ['src'], focus: '入口和资源链路' }] };
        if (name.startsWith('调查拆分·')) {
          splits += 1;
          return { shards: [{ kind: 'repository', paths: ['src'], focus: `${name}入口` }, { kind: 'repository', paths: ['src'], focus: `${name}资源` }] };
        }
        if (name.startsWith('实际调查·')) {
          asked.push(name);
          if (name === '实际调查·A1' || /-P[12]$/.test(name) || (exhausted && name.endsWith('-P5'))) throw Error('ContextLimit: fixture requires smaller blocks');
          const value = await base(name).ask(prompt);
          value.findings[0].status = 'static-confirmed';
          value.findings[0].confirmation = '作者自报已确认';
          return value;
        }
        if (name.startsWith('问题独立核对·')) {
          const candidatePath = prompt.match(/材料：([^；]+)/)[1];
          const candidate = JSON.parse(f.read(candidatePath));
          assert.equal(candidate.findings[0].status, 'unconfirmed');
          assert.equal(candidate.findings[0].confirmation, '尚未独立核对');
          return { confirmed: false, explanation: '缺少独立确认的触发条件' };
        }
        if (name === '方案设计与修订') return prompt.includes('只返回 Patch3') ? { taskChanges: [], planChanges: {}, resolutions: [], summary: '保留真实证据缺口' } : noOp();
        if (name.startsWith('方案连续复核') || name.startsWith('方案独立终审')) return review();
        throw Error('unexpected actor ' + name);
      } }) });
      assert.equal(result.status, exhausted ? 'incomplete' : 'ready', result.errors.join('\n'));
      assert.equal(result.planWritten, !exhausted);
      assert.equal(splits, 3);
      assert.equal(new Set(asked).size, 7);
      assert.equal(asked.length, 7);
      const c = await loadCore();
      const checkpoint = JSON.parse(f.read(result.checkpointPath));
      const contract = exhausted ? null : JSON.parse(f.read(c.parsePointer3(f.read('plan.md')).contractPath));
      const observedPlan = contract ? contract.plan : JSON.parse(f.read(checkpoint.draftPath));
      const supportPaths = contract ? contract.supports.map(item => item.path) : checkpoint.supports;
      const count = exhausted ? 3 : 4;
      assert.equal(observedPlan.findings.length, count);
      assert.equal(new Set(observedPlan.findings.map(item => item.id)).size, count);
      assert.equal(new Set(observedPlan.evidence.map(item => item.id)).size, count);
      assert(observedPlan.findings.every(item => item.status === 'unconfirmed'));
      assert.equal(observedPlan.tasks.length, 0);
      const rawCandidates = supportPaths.filter(item => /\/analysis\/A1-P\d+-[a-f0-9]+\.json$/.test(item));
      assert.equal(rawCandidates.length, count);
      assert(rawCandidates.every(item => JSON.parse(f.read(item)).findings[0].status === 'unconfirmed'));
      if (exhausted) assert(observedPlan.gaps.some(item => item.includes('调查已拆到两层仍超限')));
    } finally { f.remove(); }
  }
});

test('split investigations cannot silently drop a parent path',async()=>{
  const f=fixture();try{
    f.put('src/auth.js','auth');f.put('src/pay.js','pay');
    const result=await runWorkflow('task-plan',{args:{requirement:'排查认证和支付',scope:'src/auth.js,src/pay.js'},world:f.world,agent:name=>({ask:async()=>{
      if(name==='需求与范围分析')return {scenario:'diagnostic',title:'排查',goal:'调查两条链路',summary:'认证和支付',shards:[{kind:'repository',paths:['src/auth.js','src/pay.js'],focus:'认证支付'}]};
      if(name==='实际调查·A1')throw Error('ContextLimit: fixture');
      if(name.startsWith('调查拆分'))return {shards:[{kind:'repository',paths:['src/auth.js'],focus:'只有认证'}]};
      if(name.startsWith('实际调查'))return analysis('只有认证');
      if(name==='方案设计与修订')return noOp();
      if(name.startsWith('方案连续复核')||name.startsWith('方案独立终审'))return review();
      throw Error(name);
    }})});
    assert.equal(result.status,'incomplete');assert.equal(result.planWritten,false);assert(result.notCovered.some(item=>item.includes('丢范围')));
  }finally{f.remove();}
});

test('revised findings are independently confirmed instead of trusting patch status',async()=>{
  const f=fixture();try{
    f.put('src/a.js','a');const base=scenarioAgent('feature',[]);
    const first=await runWorkflow('task-plan',{args:{requirement:'核对订单并完善实现'},world:f.world,agent:name=>({ask:async prompt=>{
      if(name.startsWith('实际调查'))return {...await base(name).ask(prompt),findings:[{id:'F1',title:'待确认状态问题',severity:'medium',status:'unconfirmed',location:'src/a.js:1',symbol:'a',trigger:'失败分支',impact:'可能丢状态',evidenceIds:['E1'],fixSuggestion:'修复状态',verification:'回归检查',confirmation:'没有独立确认'}]};
      if(name.startsWith('问题独立核对'))return {confirmed:false,explanation:'缺少触发证据'};
      return base(name).ask(prompt);
    }})});
    assert.equal(first.status,'ready');const c=await loadCore();const originalEntry=f.read('plan.md');const old=JSON.parse(f.read(c.parsePointer3(originalEntry).contractPath));let confirmations=0;
    const revision=await runWorkflow('task-plan',{args:{changes:'根据现有材料完善问题和修复任务'},world:f.world,agent:name=>({ask:async()=>{
      if(name==='方案设计与修订')return {taskChanges:[{id:'T1',fields:{findingIds:['A1-F1']}}],planChanges:{findings:[{...old.plan.findings[0],trigger:'补充的失败分支触发条件',status:'static-confirmed',confirmation:'作者声称已确认'}]},resolutions:[],summary:'补问题和关联'};
      if(name.startsWith('问题独立核对')){confirmations++;return {confirmed:false,explanation:'仍不能证明修复依据'};}
      if(name.startsWith('方案连续复核')||name.startsWith('方案独立终审'))return review();
      throw Error(name);
    }})});
    assert.equal(confirmations,1);assert.equal(revision.status,'incomplete');assert.equal(revision.planWritten,false);assert.equal(f.read('plan.md'),originalEntry);
    const accepted=await runWorkflow('task-plan',{args:{changes:'补充已核对的修复依据'},world:f.world,agent:name=>({ask:async()=>{
      if(name==='方案设计与修订')return {taskChanges:[{id:'T1',fields:{findingIds:['A1-F1']}}],planChanges:{findings:[{...old.plan.findings[0],trigger:'已核对的失败分支',status:'static-confirmed',confirmation:'作者自报'}]},resolutions:[],summary:'补充修复依据'};
      if(name.startsWith('问题独立核对')){confirmations++;return {confirmed:true,explanation:'独立核对补充证据后确认触发路径'};}
      if(name.startsWith('方案连续复核')||name.startsWith('方案独立终审'))return review();
      throw Error(name);
    }})});
    assert.equal(accepted.status,'ready',accepted.errors.join('\n'));assert.equal(confirmations,2);
    const updated=JSON.parse(f.read(c.parsePointer3(f.read('plan.md')).contractPath));
    assert.equal(updated.plan.findings[0].confirmation,'独立核对补充证据后确认触发路径');assert.equal(updated.plan.findings[0].status,'static-confirmed');
  }finally{f.remove();}
});

test('initial invalid check timeout is corrected without weakening valid commands',async()=>{
  const f=fixture();try{
    f.put('src/a.js','a');const base=scenarioAgent('feature',[]);let patches=0;
    const result=await runWorkflow('task-plan',{args:{requirement:'完善订单实现'},world:f.world,agent:name=>({ask:async prompt=>{
      if(name==='方案设计与修订'&&prompt.includes('Patch3')){patches++;return {taskChanges:[],planChanges:{checks:plan().checks},resolutions:[],summary:'仅纠正非法超时'};}
      const value=await base(name).ask(prompt);if(name==='方案设计与修订')value.checks[0].timeoutMs=0;return value;
    }})});
    assert.equal(result.status,'ready',result.errors.join('\n'));assert.equal(patches,1);
    const c=await loadCore();const actual=JSON.parse(f.read(c.parsePointer3(f.read('plan.md')).contractPath));assert.deepEqual(actual.plan.checks,plan().checks);
  }finally{f.remove();}
});

test('all failed investigations retain the input and never invent a usable plan', async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'a');
    let skeletons = 0;
    const result = await runWorkflow('task-plan', { args: { requirement: '实际排查' }, world: f.world, agent: name => ({ ask: async () => {
      if (name === '需求与范围分析') return { scenario: 'diagnostic', title: '排查', goal: '实际调查', summary: '相关模块', shards: [{ kind: 'repository', paths: ['src'], focus: '入口' }, { kind: 'repository', paths: ['src'], focus: '资源' }] };
      if (name.startsWith('实际调查')) throw Error('fixture evidence unavailable');
      if (name === '方案设计与修订') skeletons += 1;
      throw Error('unexpected actor ' + name);
    } }) });
    assert.equal(result.status, 'incomplete');
    assert.equal(result.planWritten, false);
    assert.equal(skeletons, 0);
    assert(!fs.existsSync(path.join(f.dir, 'plan.md')));
    assert(result.errors.some(item => item.includes('全部调查块失败')));
    assert(result.notCovered.some(item => item.includes('入口')));
    assert(result.notCovered.some(item => item.includes('资源')));
    assert(JSON.parse(f.read(result.inputPath)).input.requirement);
  } finally { f.remove(); }
});

test('one failed task bundle preserves successful siblings before returning incomplete', async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'a');
    f.put('src/b.js', 'b');
    const base = scenarioAgent('feature', []);
    const result = await runWorkflow('task-plan', { args: { requirement: '实现两个独立模块' }, world: f.world, agent: name => ({ ask: async prompt => {
      if (name === '方案设计与修订') {
        const value = await base(name).ask(prompt);
        value.taskSeeds.push({ ...value.taskSeeds[0], id: 'T2', files: ['src/b.js'] });
        return value;
      }
      if (name === '任务书作者·1') { await new Promise(resolve => setTimeout(resolve, 30)); return { task: task(), checks: [] }; }
      if (name === '任务书作者·2') throw Error('fixture task block unavailable');
      return base(name).ask(prompt);
    } }) });
    assert.equal(result.status, 'incomplete');
    assert.equal(result.planWritten, false);
    const checkpoint = JSON.parse(f.read(result.checkpointPath));
    const saved = checkpoint.supports.find(item => /\/task-drafts\/T1-/.test(item));
    assert(saved);
    assert.equal(JSON.parse(f.read(saved)).task.id, 'T1');
    assert(result.errors.some(item => item.includes('T2')));
  } finally { f.remove(); }
});

test('natural-language expansion and decision revision preserve unaffected fields and re-investigate added files', async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'a');
    f.put('src/b.js', 'b');
    const first = await runWorkflow('task-plan', { args: { requirement: '分析并实现现有订单规则' }, world: f.world, agent: scenarioAgent('feature', []) });
    assert.equal(first.status, 'ready');
    const c = await loadCore();
    const before = JSON.parse(f.read(c.parsePointer3(f.read('plan.md')).contractPath));
    let supplemental = 0;
    const decision = { id: 'D1', question: '保留现有认证接口？', recommendation: '保留', alternatives: ['新接口'], risks: ['调用方兼容性'], affectsImplementation: true };
    const expanded = await runWorkflow('task-plan', { args: { changes: '增加 src/b.js 模块，并保留现有认证接口' }, world: f.world, agent: name => ({ ask: async prompt => {
      if (name === '方案设计与修订') return { taskChanges: [{ id: 'T2', fields: task({ id: 'T2', files: ['src/b.js'], readFiles: ['src/b.js'], outputs: ['src/b.js'] }) }], planChanges: { decisions: [decision] }, resolutions: [{ questionId: 'D1', decision: '保留', evidence: '保留现有认证接口' }], summary: '新增模块并记录用户决定' };
      if (name.startsWith('实际调查')) { supplemental += 1; assert(prompt.includes('src/b.js')); return { ...analysis('新增模块及接口'), evidence: [{ ...plan().evidence[0], location: 'src/b.js:1' }] }; }
      if (name.startsWith('方案连续复核') || name.startsWith('方案独立终审')) return review();
      throw Error(name);
    } }) });
    assert.equal(expanded.status, 'ready', expanded.errors.join('\n'));
    assert.equal(supplemental, 1);
    let after = JSON.parse(f.read(c.parsePointer3(f.read('plan.md')).contractPath));
    assert.deepEqual(after.plan.tasks[0], before.plan.tasks[0]);
    assert.deepEqual(after.plan.checks, before.plan.checks);
    assert.equal(after.resolutions[0].evidence, '保留现有认证接口');
    const changed = await runWorkflow('task-plan', { args: { changes: '认证决定改为采用新接口' }, world: f.world, agent: name => ({ ask: async () => {
      if (name === '方案设计与修订') return { taskChanges: [], planChanges: { decisions: [{ ...decision, recommendation: '新接口' }] }, resolutions: [{ questionId: 'D1', decision: '新接口', evidence: '采用新接口' }], summary: '仅更新用户决定' };
      if (name.startsWith('方案连续复核') || name.startsWith('方案独立终审')) return review();
      throw Error(name);
    } }) });
    assert.equal(changed.status, 'ready', changed.errors.join('\n'));
    after = JSON.parse(f.read(c.parsePointer3(f.read('plan.md')).contractPath));
    assert.equal(after.resolutions[0].decision, '新接口');
    assert.deepEqual(after.plan.tasks[0], before.plan.tasks[0]);
    assert.deepEqual(changed.changedTaskIds, []);
    const summary = after.supports.find(item => item.path.endsWith('/revision-summary.json'));
    assert(summary);assert.equal(summary.hash, hash(f.read(summary.path)));
    const lines = JSON.parse(f.read(summary.path)).lines;
    assert(lines.includes('决定：修改 D1。'));assert(lines.includes('决议：修改 D1。'));
    assert(!lines.some(item => item.startsWith('实施任务：')));
  } finally { f.remove(); }
});

test('revision summary binds old-to-final differences and reports check-only tasks without replanning', async () => {
  const f=fixture();try {
    f.put('src/a.js','a');
    const first=await runWorkflow('task-plan',{args:{requirement:'订单成功和失败的业务标准'},world:f.world,agent:scenarioAgent('feature',[])});
    assert.equal(first.status,'ready',first.errors.join('\n'));
    const c=await loadCore();const before=JSON.parse(f.read(c.parsePointer3(f.read('plan.md')).contractPath));
    const events=[];let patches=0;let reviews=0;
    const checks=before.plan.checks.map(item=>({...item,timeoutMs:item.timeoutMs+1}));
    const revised=await runWorkflow('task-plan',{args:{changes:'延长三个检查超时，并完善修订结论'},world:f.world,agent:name=>({ask:async prompt=>{
      events.push({name,prompt});
      if(name==='方案设计与修订') { patches++;return {taskChanges:[],planChanges:patches===1?{checks}:{summary:'最终方案结论已完善'},resolutions:[],summary:'作者自报没有任何变化'}; }
      if(name==='方案连续复核'&&reviews++===0)return review({verdict:'revise',issues:[{id:'I1',taskIds:[],severity:'low',blocking:true,category:'automatic',problem:'修订结论尚未更新',fixSuggestion:'仅补结论',evidence:'最终检查定义已修订'}]});
      if(name.startsWith('方案连续复核')||name.startsWith('方案独立终审'))return review();
      throw Error('unexpected replanning '+name);
    }})});
    assert.equal(revised.status,'ready',revised.errors.join('\n'));assert.equal(patches,2);assert.deepEqual(revised.changedTaskIds,['T1']);
    const after=JSON.parse(f.read(c.parsePointer3(f.read('plan.md')).contractPath));
    assert.deepEqual(after.plan.tasks,before.plan.tasks);
    const support=after.supports.find(item=>item.path.endsWith('/revision-summary.json'));assert(support);
    const raw=f.read(support.path),summary=JSON.parse(raw);assert.equal(support.hash,hash(raw));
    assert.equal(summary.beforePlanHash,c.hash3(c.stableJson3(before.plan)));assert.equal(summary.afterPlanHash,c.hash3(c.stableJson3(after.plan)));
    assert.equal(summary.beforeResolutionsHash,c.hash3(c.stableJson3(before.resolutions)));assert.equal(summary.afterResolutionsHash,c.hash3(c.stableJson3(after.resolutions)));
    assert.deepEqual(summary.lines,c.planDiff3(before.plan,after.plan,before.resolutions,after.resolutions));
    for(const text of ['仅检查定义变化影响的任务：T1','任务检查：修改 CT','阶段检查：修改 CS','最终检查：修改 CF','方案结论：已更新']) assert(raw.includes(text),text);
    assert(!raw.includes('作者自报没有任何变化'));assert(!f.read('plan.md').includes('作者自报没有任何变化'));assert(f.read('plan.md').includes('## 本轮修订摘要'));
    for(const event of events.filter(item=>item.name==='方案设计与修订'||item.name.startsWith('方案连续复核')||item.name.startsWith('方案独立终审'))) { assert(event.prompt.includes('原始需求'));assert(event.prompt.includes('input.json'));assert(event.prompt.includes('人工验收'));assert(event.prompt.includes('assumptions')); }
    assert.deepEqual(c.validateContract3(after),[]);
    f.put(support.path,raw+' ');
    const blocked=await runWorkflow('task-plan',{args:{changes:'只更新方案标题'},world:f.world,agent:name=>({ask:async()=>{throw Error('tampered summary must block before '+name);}})});
    assert.equal(blocked.planWritten,false);assert(blocked.errors.some(item=>item.includes('已有支持文件缺失或变更')));
  }finally{f.remove();}
});

test('strict approval-only packages retain the reviewed plan and nested support links', async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'a');
    f.put('package.json', '{"scripts":{"test":"fixture-only"}}');
    const base = scenarioAgent('feature', []);
    const strictChecks = plan().checks.map(item => check({ ...item, program: 'npm', args: ['test'] }));
    const first = await runWorkflow('task-plan', { args: { requirement: 'strict 订单方案', strict: true, planPath: 'docs/方案.md' }, world: f.world, agent: name => ({ ask: async prompt => {
      const value = await base(name).ask(prompt);
      if (name === '方案设计与修订') {
        value.architecture = { overview: '保持现有模块', boundaries: ['src'], interfaces: ['现有导出'], data: ['不迁移'], security: ['不新增权限'] };
        value.technologies = [{ area: '运行时', recommendation: '沿用', evidenceIds: ['A1-E1'], rationale: '当前接口', alternatives: ['重写'], tradeoffs: '保持兼容', risks: ['现有风险'] }];
        value.checks = strictChecks;
      }
      return value;
    } }) });
    assert.equal(first.status, 'ready', first.errors.join('\n'));
    const c = await loadCore();
    const firstContract = JSON.parse(f.read(c.parsePointer3(f.read('docs/方案.md')).contractPath));
    assert.equal(firstContract.approved, false);
    assert(first.conclusion.includes('仍需当前方案的明确批准'));
    assert(f.read('docs/方案.md').includes('](../.zcode/task-plans/'));
    const approved = await runWorkflow('task-plan', { args: { planPath: 'docs/方案.md', approvalEvidence: '我明确批准当前 strict 方案' }, world: f.world, agent: name => ({ ask: async () => { throw Error('approval-only must not regenerate: ' + name); } }) });
    assert.equal(approved.status, 'ready', approved.errors.join('\n'));
    const approvedContract = JSON.parse(f.read(c.parsePointer3(f.read('docs/方案.md')).contractPath));
    assert.equal(approvedContract.approved, true);
    assert(approved.conclusion.includes('已记录用户对当前 strict 方案的明确批准'));
    assert(!approved.conclusion.includes('仍需当前方案的明确批准'));
    assert.deepEqual(approvedContract.plan, firstContract.plan);
    assert.deepEqual(approvedContract.review, firstContract.review);
    assert.deepEqual(approved.changedTaskIds, []);
    for (const support of firstContract.supports) assert(approvedContract.supports.some(item => item.path === support.path && item.hash === support.hash));
    const summarySupport = approvedContract.supports.find(item => item.path.endsWith('/revision-summary.json'));
    assert(summarySupport);assert.equal(summarySupport.hash, hash(f.read(summarySupport.path)));
    const summary = JSON.parse(f.read(summarySupport.path));
    assert.deepEqual(summary.lines, ['本轮仅记录用户批准。', '方案与决议无变化；无实施变化。']);
    assert.equal(summary.beforePlanHash, summary.afterPlanHash);
    assert(f.read('docs/方案.md').includes('无实施变化'));
    assert(f.read('docs/方案.md').includes(`](../${summarySupport.path})`));
    const checked = preflight(f, approved.checkpointPath);
    assert.equal(checked.status, 0, checked.stderr);
    const execution = await runWorkflow('task-run', { args: { planPath: 'docs/方案.md' }, world: { run: async (program, argv, opts) => {
      let payload = null;
      try { payload = JSON.parse(argv?.[argv.length - 1]); } catch {}
      if (payload?.program === 'npm') return { exitCode: 0, stdout: JSON.stringify({ exitCode: 0, stdout: 'fixture strict check', stderr: '', errorKind: '' }), stderr: '' };
      return f.world.run(program, argv, opts);
    } }, agent: name => ({ ask: async prompt => {
      if (name.startsWith('任务实现')) {
        const stage = prompt.match(/只可写唯一目录 ([^，\n]+)/)?.[1];
        const content = 'approved output';
        f.put(`${stage}/files/src/a.js`, content);
        f.put(`${stage}/manifest.json`, JSON.stringify({ changes: [{ action: 'put', path: 'src/a.js', baseHash: hash('a'), outputHash: hash(content) }] }));
        return { summary: '实现已暂存', blocked: false, blockReason: '', notes: '未运行检查' };
      }
      if (name.startsWith('实现独立复核')) return { approved: true, issues: [], repairable: false, summary: '符合已批准任务' };
      throw Error(name);
    } }) });
    assert.equal(execution.status, 'completed', execution.validationErrors.join('\n'));
    assert.equal(execution.approvalSource, 'contract');
    assert.equal(execution.checks.length, 3);
  } finally { f.remove(); }
});
