const test=require('node:test');
const assert=require('node:assert/strict');
const {loadCore,loadRunPure,fixture,runWorkflow,plan,task,check,review,contract,hash,baseline}=require('./helpers.cjs');
async function publishFixture(f,overrides={},planOverrides={}) {
  const c=await loadCore(f.world);const value=plan(planOverrides);
  c.authorizeIoRoot3('.zcode/task-plans/'+ '8'.repeat(64));
  const before=await c.snapshot3(['.'],['.zcode/task-plans/'+ '8'.repeat(64),'plan.md']);
  const x=await contract(c,value,{baseline:before,...overrides});
  const path='.zcode/task-plans/'+ '8'.repeat(64)+'/v-'+ '9'.repeat(64)+'/contract.json';
  const text=JSON.stringify(x,null,2)+'\n';f.put(path,text);const pointer={contractVersion:3,contractPath:path,contractHash:hash(text)};
  f.put('plan.md',c.renderPlan3(x,pointer,{}));return {c,x,pointer};
}
function stagedAgent(f,failReview=false){return name=>({ask:async prompt=>{
  if(name.startsWith('任务实现')){
    const stage=prompt.match(/只可写唯一目录 ([^，\n]+)/)?.[1];assert(stage,'staging path missing');
    const baseHash=hash(f.read('src/a.js'));const output='module.exports = 2;\n';
    f.put(stage+'/files/src/a.js',output);f.put(stage+'/manifest.json',JSON.stringify({changes:[{action:'put',path:'src/a.js',baseHash,outputHash:hash(output)}]}));
    return {summary:'修复已暂存',blocked:false,blockReason:'',notes:'未运行检查'};
  }
  if(name.startsWith('实现独立复核'))return {approved:!failReview,issues:failReview?['src/a.js：fixture阻塞']:[],repairable:false,summary:'独立读取源文件与副本'};
  throw Error('unexpected actor '+name);
}});}
test('manifest ownership, raw hash and explicit delete validation',async()=>{
  const r=await loadRunPure();const b=baseline([{path:'src/a.js',hash:hash('a'),mode:420}]);
  const good={changes:[{action:'put',path:'src/a.js',baseHash:hash('a'),outputHash:hash('b')}]};
  assert.equal(r.stagedManifest3(good,task(),b,['plan.md']).length,1);
  for(const bad of [{changes:[null]},{changes:[{...good.changes[0],path:'../x'}]},{changes:[{...good.changes[0],baseHash:null}]},{changes:[{...good.changes[0],path:'plan.md'}]}]) assert.throws(()=>r.stagedManifest3(bad,task(),b,['plan.md']));
  assert(r.implementationReviewErrors3({approved:true,issues:['bug'],repairable:true,summary:'x'}).length);
  for(const invalid of [null,{}, {contractVersion:3,tasks:[null],checks:[null]}, {contractVersion:3,tasks:[],checks:[{exitCode:0}]}]) assert(r.checkpointResultErrors3(invalid).length);
});
test('v3 fixture runs staged review plus task/stage/final checks and repeat invocation avoids replay',async()=>{
  const f=fixture();try{
    f.put('src/a.js','module.exports = 1;\n');f.put('checks.cjs','process.exit(require("./src/a.js") === 2 ? 0 : 1);\n');
    const rollout=['启动服务后人工验证订单失败路径','用户确认后部署并观察监控'];
    await publishFixture(f,{}, {rollout});let workers=0;let checks=0;const factory=stagedAgent(f);
    const env={args:{planPath:'plan.md'},world:{run:async(program,argv,opts)=>{
      let payload=null;try{payload=JSON.parse(argv?.[argv.length-1]);}catch{}
      if(payload?.program){checks++;assert.equal(payload.program,'node');assert.deepEqual(payload.args,['checks.cjs']);}
      return f.world.run(program,argv,opts);
    }},agent:name=>{if(name.startsWith('任务实现'))workers++;return factory(name);}};
    const result=await runWorkflow('task-run',env);
    assert.equal(result.status,'completed',result.validationErrors.join('\n'));assert.equal(workers,1);assert.equal(result.checks.length,3);assert.equal(checks,3);assert.equal(f.read('src/a.js'),'module.exports = 2;\n');
    assert.deepEqual(result.filesChanged,['src/a.js']);
    assert.match(result.conclusion,/已通过的检查范围：任务\/阶段\/最终检查/);
    const text=f.read(result.executionPath);const changed=text.split('## 实际文件变更')[1].split('## 任务与检查')[0];
    assert.match(changed,/执行基线 .*baseline\.json 与最终快照 .*final-snapshot\.json 核对/);
    assert.match(changed,/^- src\/a\.js$/m);assert.doesNotMatch(changed,/未知|未发现文件变更/);
    for(const item of rollout){assert(result.manualVerification.some(line=>line.endsWith(item)&&line.includes('未自动执行')));assert(text.includes(item));}
    assert.match(text,/本清单不授予启动服务、联网、发布或部署权限/);
    const repeat=await runWorkflow('task-run',{...env,agent:()=>{throw Error('must not repeat');}});assert.equal(repeat.status,'completed',repeat.validationErrors.join('\n'));assert.equal(repeat.alreadyApplied,true);
    assert.equal(checks,3);assert(repeat.verified.every(line=>line.startsWith('既有执行记录（非本次重跑）')));
    const repeatedText=f.read(repeat.executionPath);assert.match(repeatedText,/本次未重复施工或重跑验收/);assert.match(repeatedText,/既有执行记录的变更，不是本次重新施工/);
    assert.equal(f.read(result.executionPath),text,'the original immutable report must not be overwritten');
    f.put('src/a.js','user drift');const drift=await runWorkflow('task-run',{...env,agent:()=>{throw Error('must not run');}});assert.equal(drift.status,'blocked');assert(drift.validationErrors.some(x=>x.includes('现场')));
  }finally{f.remove();}
});
test('completed report names only recorded check kinds when no stage check is configured',async()=>{
  const f=fixture();try{
    f.put('src/a.js','module.exports = 1;\n');f.put('checks.cjs','process.exit(require("./src/a.js") === 2 ? 0 : 1);\n');
    await publishFixture(f,{}, {stages:[{...plan().stages[0],checkIds:[]}],checks:[check(),check({id:'CF',kind:'final'})]});
    const result=await runWorkflow('task-run',{args:{planPath:'plan.md'},world:f.world,agent:stagedAgent(f)});
    assert.equal(result.status,'completed',result.validationErrors.join('\n'));
    assert.deepEqual(result.checks.map(item=>item.kind),['task','final']);
    assert.match(result.conclusion,/已通过的检查范围：任务\/最终检查/);
    assert.match(result.conclusion,/合同未配置阶段检查，未运行该类检查/);
    assert.doesNotMatch(result.conclusion,/任务\/阶段\/最终检查/);
    assert(f.read(result.executionPath).includes(result.conclusion));
  }finally{f.remove();}
});
for(const label of ['decisions','reject','hash','baseline','permission','strict']) test(`${label}: preflight blocks before any worker`,async()=>{
  const f=fixture();try{
    f.put('src/a.js','a');f.put('checks.cjs','process.exit(0)');
    const p=plan();const options={};
    if(label==='decisions'){p.decisions=[{id:'D1',question:'规则？',recommendation:'保守',alternatives:[],risks:[],affectsImplementation:true}];options.status='awaiting-decisions';}
    if(label==='reject'){options.review=review({verdict:'reject'});options.status='incomplete';}
    if(label==='strict')options.mode='strict';
    if(label==='permission')p.checks[0]={...p.checks[0],program:'curl',args:['https://example.com'],permission:'remote'};
    const {x,pointer,c}=await publishFixture(f,options,p);
    if(label==='reject'){x.reviewedReviewHash=c.hash3(c.stableJson3(x.review));const text=JSON.stringify(x,null,2)+'\n';f.put(pointer.contractPath,text);pointer.contractHash=hash(text);f.put('plan.md',c.renderPlan3(x,pointer,{}));}
    if(label==='hash')f.put(pointer.contractPath,f.read(pointer.contractPath)+' ');
    if(label==='baseline')f.put('src/a.js','drift');
    let workers=0;const result=await runWorkflow('task-run',{args:{planPath:'plan.md'},world:f.world,agent:()=>{workers++;throw Error('unexpected worker');}});
    assert.equal(result.status,'blocked');assert.equal(workers,0);assert(result.validationErrors.length);
    const text=f.read(result.executionPath);
    assert.match(text,/实际文件变更范围未知；空列表不表示零变更/);
    assert.match(text,/## 下一步/);assert.match(text,/补授权\/决定/);assert.match(text,/fresh preflight/);assert.match(text,/返回 task-plan/);
    assert(text.includes(result.checkpointPath));assert(text.includes('基于 plan.md 重新评审'));
    assert.match(text,/源码基线或 dirty 保护不通过时先核对并保留现场，不能靠补授权或重试绕过/);
    assert.match(text,/本报告不自动恢复/);
  }finally{f.remove();}
});
for (const failedKind of ['task', 'stage', 'final']) test(`strict ${failedKind} failure stops the next check immediately`, async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'module.exports = 1;\n');
    const checks = [check({ id: 'CT', program: 'npm', args: ['test'] }), check({ id: 'CT2', program: 'npm', args: ['test'] }), check({ id: 'CS', kind: 'stage', program: 'npm', args: ['test'] }), check({ id: 'CS2', kind: 'stage', program: 'npm', args: ['test'] }), check({ id: 'CF', kind: 'final', program: 'npm', args: ['test'] }), check({ id: 'CF2', kind: 'final', program: 'npm', args: ['test'] })];
    await publishFixture(f, { mode: 'strict', approved: true, approvalEvidence: '用户明确批准本 fixture 方案' }, { architecture: { overview: '现有模块', boundaries: ['src'], interfaces: ['模块导出'], data: ['不迁移'], security: ['不新增权限'] }, technologies: [{ area: '运行时', recommendation: '沿用', evidenceIds: ['E1'], rationale: '当前接口', alternatives: ['重写'], tradeoffs: '保持兼容', risks: ['现有风险'] }], tasks: [task({ checkIds: ['CT', 'CT2'] })], stages: [{ ...plan().stages[0], checkIds: ['CS', 'CS2'] }], checks });
    const failAt = failedKind === 'task' ? 1 : failedKind === 'stage' ? 3 : 5;
    let commands = 0;
    let workers = 0;
    const factory = stagedAgent(f);
    const result = await runWorkflow('task-run', { args: { planPath: 'plan.md' }, world: { run: async (program, argv, opts) => {
      let payload = null;
      try { payload = JSON.parse(argv?.[argv.length - 1]); } catch {}
      if (payload?.program === 'npm') {
        commands += 1;
        return { exitCode: 0, stdout: JSON.stringify({ exitCode: commands === failAt ? 1 : 0, stdout: 'fixture deterministic check', stderr: commands === failAt ? 'fixture failure' : '', errorKind: '' }), stderr: '' };
      }
      return f.world.run(program, argv, opts);
    } }, agent: name => { if (name.startsWith('任务实现')) workers += 1; return factory(name); } });
    assert.equal(result.status, 'incomplete');
    assert.equal(commands, failAt);
    assert.equal(result.checks.length, failAt);
    assert.equal(result.checks[failAt - 1].exitCode, 1);
    assert.equal(workers, 1);
    assert(result.tasks.every(item => item.attempts <= 1));
  } finally { f.remove(); }
});

test('failed stage ancestors never start dependent construction',async()=>{
  const f=fixture();try{
    f.put('src/a.js','a');f.put('src/b.js','b');f.put('checks.cjs','process.exit(0)');
    const tasks=[task({stageId:'S1',checkIds:['CT1']}),task({id:'T2',stageId:'S2',files:['src/b.js'],readFiles:['src/b.js'],outputs:['src/b.js'],checkIds:['CT2']})];
    const stages=[{id:'S1',title:'前置',goal:'前置实现',dependsOn:[],checkIds:['CS1']},{id:'S2',title:'后继',goal:'依赖前置',dependsOn:['S1'],checkIds:['CS2']}];
    await publishFixture(f,{}, {tasks,stages,checks:[check({id:'CT1'}),check({id:'CT2'}),check({id:'CS1',kind:'stage'}),check({id:'CS2',kind:'stage'}),check({id:'CF',kind:'final'})]});
    const workers=[];const result=await runWorkflow('task-run',{args:{planPath:'plan.md',stopOnFailure:false},world:f.world,agent:name=>({ask:async()=>{
      if(name.startsWith('任务实现')){workers.push(name);return {summary:'缺少输入',blocked:true,blockReason:'fixture前置未完成',notes:'未修改源文件'};}
      throw Error(name);
    }})});
    assert.equal(result.status,'incomplete');assert.deepEqual(workers,['任务实现·T1']);assert.equal(result.tasks.find(item=>item.id==='T2').status,'skipped');assert.equal(f.read('src/b.js'),'b');
  }finally{f.remove();}
});

test('failed task dependencies skip only affected members of a safe wave',async()=>{
  const f=fixture();try{
    for(const file of ['a','b','c'])f.put(`src/${file}.js`,file);f.put('checks.cjs','process.exit(0)');
    const tasks=[task({execution:'serial',checkIds:['CT1']}),task({id:'T2',files:['src/b.js'],readFiles:['src/b.js'],outputs:['src/b.js'],dependsOn:['T1'],checkIds:['CT2']}),task({id:'T3',files:['src/c.js'],readFiles:['src/c.js'],outputs:['src/c.js'],checkIds:['CT3']})];
    await publishFixture(f,{}, {tasks,checks:[check({id:'CT1'}),check({id:'CT2'}),check({id:'CT3'}),check({id:'CS',kind:'stage'}),check({id:'CF',kind:'final'})]});
    const workers=[];const result=await runWorkflow('task-run',{args:{planPath:'plan.md',stopOnFailure:false},world:f.world,agent:name=>({ask:async prompt=>{
      if(name.startsWith('任务实现')){
        workers.push(name);if(name.endsWith('T1'))return {summary:'前置阻塞',blocked:true,blockReason:'fixture输入不足',notes:''};
        assert(name.endsWith('T3'));const stage=prompt.match(/只可写唯一目录 ([^，\n]+)/)?.[1];assert(stage);
        f.put(`${stage}/files/src/c.js`,'implemented');f.put(`${stage}/manifest.json`,JSON.stringify({changes:[{action:'put',path:'src/c.js',baseHash:hash('c'),outputHash:hash('implemented')}]}));
        return {summary:'独立任务实现',blocked:false,blockReason:'',notes:'未运行检查'};
      }
      if(name.startsWith('实现独立复核'))return {approved:true,issues:[],repairable:false,summary:'符合任务'};
      throw Error(name);
    }})});
    assert.equal(result.status,'incomplete');assert.deepEqual(workers,['任务实现·T1','任务实现·T3']);assert.equal(result.tasks.find(item=>item.id==='T2').status,'skipped');assert.equal(result.tasks.find(item=>item.id==='T3').status,'completed');assert.equal(f.read('src/c.js'),'implemented');
  }finally{f.remove();}
});

test('review blocks staged code and snapshot failure never starts a repair attempt',async()=>{
  const f=fixture();try{
    f.put('src/a.js','module.exports = 1;\n');f.put('checks.cjs','process.exit(0)');await publishFixture(f);let asks=0;
    const result=await runWorkflow('task-run',{args:{planPath:'plan.md'},world:f.world,agent:name=>{const a=stagedAgent(f,true)(name);return {ask:async p=>{if(name.startsWith('任务实现'))asks++;return a.ask(p);}};}});
    assert.equal(result.status,'incomplete');assert.equal(asks,1);assert.equal(f.read('src/a.js'),'module.exports = 1;\n');
    assert.deepEqual(result.filesChanged,[]);assert.equal(result.validationErrors.length,0);
    const text=f.read(result.executionPath);assert.match(text,/快照核对未发现文件变更/);assert.doesNotMatch(text,/实际文件变更范围未知/);
    assert.match(text,/补授权\/决定/);assert.match(text,/fresh preflight/);assert.match(text,/返回 task-plan/);
  }finally{f.remove();}
});
