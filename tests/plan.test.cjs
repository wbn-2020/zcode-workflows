const test=require('node:test');
const assert=require('node:assert/strict');
const {loadPlanPure,loadCore,fixture,runWorkflow,plan,task,check,review,scenarioAgent}=require('./helpers.cjs');

test('bounded intake and malformed analysis return concrete errors',async()=>{
  const p=await loadPlanPure();
  for(const v of [null,{},true,{shards:[null]}]) assert(p.intakeErrorsPlan3(v).length);
  for(const v of [null,{}, {evidence:[null],findings:[null],technologies:[null]}]) assert(p.analysisErrorsPlan3(v).length);
  assert(p.inputErrorsPlan3({planPath:'../x.md'}).length);
});
test('analysis IDs become globally unique and candidate confirmations cannot be self-approved',async()=>{
  const p=await loadPlanPure();
  const block={summary:'已读',evidence:plan().evidence,findings:[{id:'F1',title:'错误',severity:'medium',status:'static-confirmed',location:'src/a.js:1',symbol:'a',trigger:'失败',impact:'丢状态',evidenceIds:['E1'],fixSuggestion:'修正',verification:'回归',confirmation:'自证'}],technologies:[],coverage:['a'],gaps:[]};
  const namespaced=p.namespaceAnalysisPlan3(block,'A1');
  assert.equal(namespaced.findings[0].status,'unconfirmed');assert.deepEqual(namespaced.findings[0].evidenceIds,['A1-E1']);
  assert.throws(()=>p.namespaceAnalysisPlan3({...block,findings:[{...block.findings[0],evidenceIds:['missing']}]},'A2'));
});
test('shared file wiring is deterministic, new modules trigger supplemental recon',async()=>{
  const p=await loadPlanPure();
  const before=plan({tasks:[task(),task({id:'T2'})]});
  assert.deepEqual(p.wireConflictsPlan3(before).tasks[1].dependsOn,['T1']);
  const after=plan({tasks:[task({files:['src/a.js','gateway/new.js']})]});assert(p.addedReconPlan3(plan(),after).length);
  assert.throws(()=>p.mergeChecksPlan3([[check()],[check({args:['weaker.cjs']})]]));
});
for(const scenario of ['feature','diagnostic','greenfield']) test(`${scenario}: analysis completes before executable task package publication`,async()=>{
  const f=fixture();try{
    f.put('src/a.js','function a() {}');const events=[];const reports=[];
    const result=await runWorkflow('task-plan',{args:{requirement:'按实际证据分析并给出实施方案'},world:f.world,agent:scenarioAgent(scenario,events),report:x=>reports.push(x)});
    assert.equal(result.status,'ready',result.errors.join('\n'));assert.equal(result.planWritten,true);assert.equal(result.scenario,scenario);assert.equal(result.sourceUnchanged,true);
    assert(events.findIndex(x=>x.name.startsWith('实际调查'))<events.findIndex(x=>x.name.startsWith('任务书作者')));
    const c=await loadCore(f.world);const pointer=c.parsePointer3(f.read('plan.md'));const contract=JSON.parse(f.read(pointer.contractPath));
    assert.equal(pointer.contractHash,await c.fileHash3(pointer.contractPath));assert.deepEqual(c.validateContract3(contract),[]);
    assert(!f.read('plan.md').includes('reviewedPlanSnapshot'));assert(reports.some(x=>x.kind==='checkpoint'));
    assert(f.read('plan.md').includes('| R1 | T1 | CT |'));assert(f.read('plan.md').includes('不自动证明每项业务标准'));
    const authorPrompt=events.find(x=>x.name==='方案设计与修订').prompt;
    for(const phrase of ['原始需求全文逐项查漏','机器检查或人工验收','关键不确定不得藏进 assumptions']) assert(authorPrompt.includes(phrase),phrase);
    const taskPrompt=events.find(x=>x.name.startsWith('任务书作者')).prompt;
    for(const phrase of ['读取原始需求','behaviorAcceptance','人工验收方法']) assert(taskPrompt.includes(phrase),phrase);
    for(const event of events.filter(x=>x.name.startsWith('方案连续复核')||x.name.startsWith('方案独立终审'))) for(const phrase of ['原始需求及引用文档','未进入 requirements 的遗漏','机器检查能证明什么','人工验收','不能藏进 assumptions']) assert(event.prompt.includes(phrase),phrase);
    if(scenario==='diagnostic')assert.equal(contract.plan.findings[0].status,'static-confirmed');
  }finally{f.remove();}
});
test('artifact cap/publication failure preserves actual plan and falls back to path',async()=>{
  const f=fixture();try{f.put('src/a.js','a');const result=await runWorkflow('task-plan',{args:{requirement:'需求'},world:f.world,agent:scenarioAgent('feature',[]),artifact:{file:async()=>{throw Error('20MiB cap');},markdown:async()=>({id:'plan-summary',version:1}),board:()=>{}}});
    assert.equal(result.planWritten,true);assert.equal(result.artifactPublished,false);assert(result.publishErrors.length);assert(f.read('plan.md').includes('TASK_RUN_CONTRACT_START'));
  }finally{f.remove();}
});
