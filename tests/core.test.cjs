const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {loadCore,fixture,plan,task,check,review,baseline,contract,hash}=require('./helpers.cjs');

test('SHA-256 matches raw UTF-8 including unpaired surrogate',async()=>{
  const c=await loadCore();
  for(const text of ['', 'abc','中文😀','\ud800','\udc00','x'.repeat(4097)]) assert.equal(c.hash3(text),hash(text));
  assert.equal(c.stableJson3({b:1,a:[{z:2,a:3}]}),'{"a":[{"a":3,"z":2}],"b":1}');
});
test('safe paths, reserved names and ancestor conflicts',async()=>{
  const c=await loadCore();
  for(const p of ['../a','C:/a','a/.git/config','a/NUL.txt','a:*','a/','a/..','a\u0000']) assert.equal(c.path3(p),null,p);
  assert.equal(c.path3('./src\\a.js'),'src/a.js');
  assert(c.overlap3(['src'],['src/a.js']));assert(!c.overlap3(['src/a'],['src/ab']));
});
test('total malformed plan/review/contracts never dereference null',async()=>{
  const c=await loadCore();
  for(const value of [null,{},[],{tasks:[null]},{resolutions:[null]},true]) {
    assert(c.validatePlan3(value,'standard',false).length);
    assert(c.validateReview3(value,[]).length);
    assert(c.validateContract3(value).length);
  }
  const p=plan();assert.deepEqual(c.validatePlan3(p,'standard',false),[]);
  const x=await contract(c,p);assert.deepEqual(c.validateContract3(x),[]);
  x.resolutions=[null];assert(c.validateContract3(x).length);
});
test('no-op diagnostic remains valid; unconfirmed repairs rejected',async()=>{
  const c=await loadCore();
  const p=plan({scenario:'diagnostic',tasks:[],stages:[],checks:[]});assert.deepEqual(c.validatePlan3(p,'standard',false),[]);
  p.findings=[{id:'F1',title:'疑似状态错误',severity:'medium',status:'unconfirmed',location:'src/a.js:1',symbol:'a',trigger:'失败分支',impact:'可能丢状态',evidenceIds:['E1'],fixSuggestion:'调查后再决定',verification:'补真实复现',confirmation:'没有证据'}];
  p.tasks=[task({findingIds:['F1']})];p.stages=plan().stages;p.checks=plan().checks;
  assert(c.validatePlan3(p,'standard',false).some(x=>x.includes('unconfirmed')));
});
test('partial patch preserves old checks, body and verbatim old resolutions',async()=>{
  const c=await loadCore();
  const p=plan({decisions:[{id:'D1',question:'保持原接口？',recommendation:'保持',alternatives:[],risks:[],affectsImplementation:true}]});
  const old=[{questionId:'D1',decision:'保持',evidence:'用户此前要求保持'}];
  const patch={taskChanges:[{id:'T1',fields:{title:'修正订单错误'}}],planChanges:{},resolutions:[],summary:'只改任务标题'};
  const merged=c.applyPatch3(p,patch,old,'改一下标题',false);
  assert.deepEqual(merged.errors,[]);assert.deepEqual(merged.resolutions,old);assert.deepEqual(merged.plan.tasks[0].checkIds,p.tasks[0].checkIds);assert.deepEqual(merged.plan.tasks[0].steps,p.tasks[0].steps);
  patch.resolutions=[{questionId:'D1',decision:'改变',evidence:'伪造用户决定'}];assert(c.applyPatch3(p,patch,old,'改标题',false).errors.length);
});
test('automatic patch cannot drop work, weaken checks or decide for user',async()=>{
  const c=await loadCore();const p=plan();
  const base={taskChanges:[],planChanges:{},resolutions:[],summary:'自动修复'};
  for(const patch of [{...base,taskChanges:[{id:'T1',fields:null}]},{...base,taskChanges:[{id:'T1',fields:{steps:[]}}]},{...base,planChanges:{checks:p.checks.map(x=>x.id==='CT'?{...x,args:['weaker.cjs']}:x)}},{...base,resolutions:[{questionId:'D1',decision:'好',evidence:'好'}]}]) assert(c.applyPatch3(p,patch,[],'好',true).errors.length);
});
test('implementation decisions block whole package and tokens bind package changes',async()=>{
  const c=await loadCore();const p=plan({decisions:[{id:'D1',question:'收费规则？',recommendation:'保守',alternatives:[],risks:[],affectsImplementation:true}]});
  assert.equal(c.handoff3(p,review(),[],[]),'awaiting-decisions');
  const x=await contract(c,p,{status:'awaiting-decisions'});assert.deepEqual(c.validateContract3(x),[]);
  const token=c.token3(x,['shell']);x.allowShell=true;assert.notEqual(c.token3(x,['shell']),token);
  x.review.summary='篡改';assert(c.validateContract3(x).some(s=>s.includes('reviewedReviewHash')));
});
test('waves combine independent tasks and serialize conflicts and stage dependencies',async()=>{
  const c=await loadCore();
  const tasks=[task(),task({id:'T2',files:['src/b.js'],readFiles:['src/b.js']}),task({id:'T3',files:['src/a.js'],dependsOn:['T1']})];
  assert.deepEqual(c.waves3(tasks,plan().stages).map(w=>w.map(t=>t.id)),[['T1','T2'],['T3']]);
  tasks[1].execution='serial';assert.deepEqual(c.waves3(tasks,plan().stages).map(w=>w.map(t=>t.id)),[['T1'],['T2'],['T3']]);
  assert.throws(()=>c.waves3([task({dependsOn:['T1']})],plan().stages));
});
test('argv policy retains blacklist standard and controlled strict Go',async()=>{
  const c=await loadCore();
  assert.deepEqual(c.checkErrors3(check(),'standard',false),[]);
  assert(c.checkErrors3(check({program:'bash',args:['-c','go test ./...']}),'standard',false).length);
  assert(c.checkErrors3(check({program:'git',args:['reset','--hard']}),'standard',false).length);
  for(const argv of [['test','./...'],['vet','./...'],['-C','server','test','-run','TestLogin','./...']]) assert(c.strictArgv3('go',argv));
  assert(!c.strictArgv3('node',['-e','process.exit(0)']));
  assert(c.checkErrors3(check({program:'curl',args:['https://example.com']}),'standard',false).length);
});
test('atomic chunked write CAS and raw UTF-8 hash match',async()=>{
  const f=fixture();try{const c=await loadCore(f.world);c.authorizeIoRoot3('.zcode/task-plans/'+ '1'.repeat(64));c.authorizePlanPath3('plan.md');
    const text='中文😀\n'.repeat(3000);await c.writeText3('plan.md',text,null);assert.equal(f.read('plan.md'),text);assert.equal(await c.readText3('plan.md'),text);assert.equal(await c.fileHash3('plan.md'),hash(text));
    f.put('plan.md','user change');await assert.rejects(c.writeText3('plan.md','replacement',hash(text)),/changed|CAS/);assert.equal(f.read('plan.md'),'user change');
  }finally{f.remove();}
});
test('filesystem snapshots include ignored files and reject symlink escape',async()=>{
  const f=fixture();try{f.put('src/a.js','a');f.put('ignored/private.txt','private');const c=await loadCore(f.world);const own='.zcode/task-plans/'+ '2'.repeat(64);c.authorizeIoRoot3(own);
    const before=await c.snapshot3(['.'],[own,'plan.md']);assert(before.files.some(x=>x.path==='ignored/private.txt'));f.put('ignored/private.txt','changed');const after=await c.snapshot3(['.'],[own,'plan.md']);assert(c.compareBaseline3(before,after,[]).some(x=>x.includes('ignored/private.txt')));
    try{fs.symlinkSync(f.dir,path.join(f.dir,'escape'),'junction');await assert.rejects(c.snapshot3(['.'],[own,'plan.md']),/symlink|reparse/);}catch(e){if(e.code!=='EPERM')throw e;}
  }finally{f.remove();}
});
test('check permission denies before world execution',async()=>{
  let calls=0;const c=await loadCore({run:async()=>{calls++;throw Error('no');}});
  const result=await c.runCheck3(check({program:'curl',args:['https://example.com'],permission:'remote'}),'standard',false,[]);
  assert.equal(result.errorKind,'permission');assert.equal(calls,0);
});

test('patch cannot grant its own finding confirmation',async()=>{
  const c=await loadCore();
  const finding={id:'F1',title:'待确认问题',severity:'medium',status:'unconfirmed',location:'src/a.js:1',symbol:'a',trigger:'错误分支',impact:'可能丢状态',evidenceIds:['E1'],fixSuggestion:'修复错误分支',verification:'回归检查',confirmation:'证据尚不足'};
  const p=plan({findings:[finding]});
  const patch={taskChanges:[{id:'T1',fields:{findingIds:['F1']}}],planChanges:{findings:[{...finding,status:'static-confirmed',confirmation:'作者自报已确认'}]},resolutions:[],summary:'补任务关联'};
  assert(c.applyPatch3(p,patch,[],'完善问题说明',false).errors.some(error=>error.includes('unconfirmed')));
});

test('finding confirmation survives only unchanged findings and evidence',async()=>{
  const c=await loadCore();
  const finding={id:'F1',title:'状态问题',severity:'medium',status:'static-confirmed',location:'src/a.js:1',symbol:'a',trigger:'错误分支',impact:'丢状态',evidenceIds:['E1'],fixSuggestion:'修复错误分支',verification:'回归检查',confirmation:'独立核对原证据'};
  const p=plan({findings:[finding],tasks:[task({findingIds:['F1']})]});
  const policy={mode:'standard',allowShell:false,repairInvalidChecks:false,deferConfirmation:true};
  const patch={taskChanges:[],planChanges:{findings:[{...finding,confirmation:'作者改写确认文字'}]},resolutions:[],summary:'修订说明'};
  const unchanged=c.applyPatch3(p,patch,[],'修订说明',false,policy);
  assert.deepEqual(unchanged.errors,[]);assert.deepEqual(unchanged.pendingFindingIds,[]);assert.deepEqual(unchanged.plan.findings,[finding]);
  patch.planChanges.evidence=p.evidence.map(item=>({...item,observation:'新的证据内容'}));
  const changed=c.applyPatch3(p,patch,[],'更新证据',false,policy);
  assert.deepEqual(changed.errors,[]);assert.deepEqual(changed.pendingFindingIds,['F1']);assert.equal(changed.plan.findings[0].status,'unconfirmed');
  assert(c.validatePlan3(changed.plan,'standard',false).some(error=>error.includes('unconfirmed')));
  assert.deepEqual(p.findings,[finding]);
});

test('coverage table deterministically links requirements to tasks and only task checks',async()=>{
  const c=await loadCore();
  const p=plan({requirements:[{id:'R2',statement:'第二项',criteria:['人工确认展示']},...plan().requirements],tasks:[task({id:'T2',requirementIds:['R2','R1'],files:['src/b.js'],checkIds:['CT2','CT']}),task()],checks:[...plan().checks,check({id:'CT2'})]});
  const x=await contract(c,p);const pointer={contractVersion:3,contractPath:'.zcode/task-plans/'+ '1'.repeat(64)+'/contract.json',contractHash:hash('contract')};
  const text=c.renderPlan3(x,pointer,{});
  const coverage=text.split('### 需求 → 任务 → 任务检查')[1].split('## 阶段与任务')[0];
  assert(coverage.includes('| R1 | T1 | CT |'));assert(coverage.includes('| R1 | T2 | CT、CT2 |'));assert(coverage.includes('| R2 | T2 | CT、CT2 |'));
  assert(coverage.indexOf('| R1 | T1')<coverage.indexOf('| R1 | T2'));assert(coverage.indexOf('| R1 | T2')<coverage.indexOf('| R2 | T2'));
  assert(!coverage.includes('CS'));assert(!coverage.includes('CF'));assert(coverage.includes('不自动证明每项业务标准'));assert(coverage.includes('人工验收'));
  assert.deepEqual(c.parsePointer3(text),pointer);
});
test('diagnostic no-op coverage shows investigation conclusion without invented implementation',async()=>{
  const c=await loadCore();const p=plan({scenario:'diagnostic',tasks:[],checks:[],stages:[]});
  const text=c.renderPlan3(await contract(c,p),{contractVersion:3,contractPath:'unused',contractHash:hash('x')},{});
  assert(text.includes('| R1 | 调查结论，无实施任务 | 无 |'));assert(!text.includes('| R1 | T1'));
  assert(text.includes('不自动证明每项业务标准'));
});
test('shared changed task IDs include referenced check definitions but not stage or final checks',async()=>{
  const c=await loadCore();const p=plan({tasks:[task({id:'T2',files:['src/b.js']}),task()]});const original=c.stableJson3(p);
  const next=structuredClone(p);next.checks[0].args=['orders.cjs'];
  assert.deepEqual(c.changedTaskIds3(p,next),['T1','T2']);
  const patch={taskChanges:[],planChanges:{checks:next.checks},resolutions:[],summary:'没有变化'};
  assert.deepEqual(c.applyPatch3(p,patch,[],'改检查',false).changedTaskIds,c.changedTaskIds3(p,next));
  for(const kind of ['stage','final']) { const only=structuredClone(p);only.checks.find(item=>item.kind===kind).timeoutMs+=1;assert.deepEqual(c.changedTaskIds3(p,only),[]); }
  next.tasks=[task({id:'T3'})];assert.deepEqual(c.changedTaskIds3(p,next),['T1','T2','T3']);assert.equal(c.stableJson3(p),original);
});
test('plan differences cover task edits, check layers, decisions, resolutions and per-owner file scopes',async()=>{
  const c=await loadCore();const decision={id:'D1',question:'保留接口？',recommendation:'保留',alternatives:[],risks:[],affectsImplementation:true};
  const before=plan({tasks:[task(),task({id:'T2',files:['src/b.js'],readFiles:['src/shared.js']})],decisions:[decision]});
  const after=structuredClone(before);after.tasks=[task({title:'修正边界',readFiles:['src/shared.js']}),task({id:'T3',files:['src/b.js']})];
  after.requirements[0].criteria.push('人工复核兼容性');after.decisions[0].recommendation='迁移';
  after.checks.forEach(item=>item.timeoutMs+=1);after.checks[0].writeFiles=['src/a.js'];after.stages[0].goal='实施和业务确认';
  const oldResolutions=[{questionId:'D1',decision:'保留',evidence:'请保留'}],newResolutions=[{questionId:'D1',decision:'迁移',evidence:'请迁移'}];
  const unchanged=c.stableJson3({before,after,oldResolutions,newResolutions});
  const lines=c.planDiff3(before,after,oldResolutions,newResolutions),text=lines.join('\n');
  assert(text.includes('实施任务：新增 T3；修改 T1；删除 T2。'));
  for(const label of ['任务检查：修改 CT','阶段检查：修改 CS','最终检查：修改 CF','需求：修改 R1','决定：修改 D1','决议：修改 D1','阶段：修改 S1','任务 T1 只读范围：新增 src/shared.js；移除 src/a.js','任务 T2 写入范围：移除 src/b.js','任务 T3 写入范围：新增 src/b.js','检查 CT 写入范围：新增 src/a.js']) assert(text.includes(label),label);
  assert.deepEqual(c.planDiff3(before,after,oldResolutions,newResolutions),lines);assert.equal(c.stableJson3({before,after,oldResolutions,newResolutions}),unchanged);
  assert.deepEqual(c.planDiff3(before,before,oldResolutions,oldResolutions),['方案与决议无变化；无实施变化。']);
});
test('plan differences cover remaining plan fields and collection ordering without full object dumps',async()=>{
  const c=await loadCore();const before=plan();
  const changes={scenario:'diagnostic',title:'新标题',goal:'新目标',summary:'新结论',architecture:{overview:'保持模块',boundaries:[],interfaces:[],data:[],security:[]},technologies:[{area:'运行时',recommendation:'沿用',evidenceIds:['E1'],rationale:'已有',alternatives:[],tradeoffs:'稳定',risks:[]}],evidence:[{...before.evidence[0],observation:'新证据'}],findings:[{id:'F1',title:'候选问题'}],coverage:['新范围'],gaps:['缺证据'],assumptions:['可逆默认'],notDoing:['延期项'],rollout:['人工上线确认']};
  for(const [key,value] of Object.entries(changes)) { const lines=c.planDiff3(before,{...before,[key]:value});assert.equal(lines.length,1,key);assert(!lines[0].includes('无实施变化'),key);assert(!lines[0].includes('{'),key); }
  const checkOnly=structuredClone(before);checkOnly.checks[0].title='更明确的检查';assert(c.planDiff3(before,checkOnly).includes('仅检查定义变化影响的任务：T1。'));
  const reordered=structuredClone(before);reordered.checks.reverse();assert(c.planDiff3(before,reordered).includes('检查顺序：已更新。'));
  const x=await contract(c,before);const lines=Array.from({length:12},(_,i)=>`${i} <unsafe> ${'长'.repeat(300)}`);
  const rendered=c.renderPlan3(x,{contractVersion:3,contractPath:'unused',contractHash:hash('x')},{},lines).split('## 本轮修订摘要')[1].split('## 目标与结论')[0];
  assert.equal(rendered.split('\n').filter(line=>line.startsWith('- ')).length,8);assert(!rendered.includes('<unsafe>'));assert(rendered.includes('revision-summary.json'));assert(rendered.length<2200);
});

test('only invalid initial check fields may be corrected automatically',async()=>{
  const c=await loadCore();const p=plan();p.checks[0].timeoutMs=0;
  const context={mode:'standard',allowShell:false,repairInvalidChecks:true,deferConfirmation:false};
  const patch={taskChanges:[],planChanges:{checks:p.checks.map(item=>item.id==='CT'?{...item,timeoutMs:10000}:item)},resolutions:[],summary:'纠正草稿超时'};
  assert.deepEqual(c.applyPatch3(p,patch,[],'',true,context).errors,[]);
  assert(c.applyPatch3(p,patch,[],'',true).errors.length);
  patch.planChanges.checks[0].args=['weaker.cjs'];
  assert(c.applyPatch3(p,patch,[],'',true,context).errors.length);
  patch.planChanges.checks[0]={...check(),program:'curl',args:['https://example.com'],permission:'remote'};
  assert(c.applyPatch3(p,patch,[],'',true,context).errors.length);
});
