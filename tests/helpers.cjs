const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const { stripTypeScriptTypes } = require('node:module');
const root = path.resolve(__dirname, '..');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const hash = value => 'sha256:' + crypto.createHash('sha256').update(value).digest('hex');
function coreSource() {
  let text = fs.readFileSync(path.join(root,'.zcode','workflows','_task-core.ts'),'utf8');
  for (const [token,name] of [['IO','io'],['APPLY','apply'],['CHECK','check']]) text = text.replace(JSON.stringify(`__TASK_${token}_PROGRAM__`),JSON.stringify(fs.readFileSync(path.join(root,'scripts',`task-${name}.cjs`),'utf8')));
  return text;
}
const coreNames = ['stableJson3','hash3','path3','within3','overlap3','validatePlan3','validateReview3','validateContract3','applyPatch3','changedTaskIds3','planDiff3','handoff3','waves3','parsePointer3','token3','renderPlan3','renderTask3','changes3','compareBaseline3','checkErrors3','strictArgv3','authorizeIoRoot3','authorizePlanPath3','readText3','writeText3','fileHash3','snapshot3','snapshotOwned3','gitIndexHash3','gitDirtyPaths3','fileHashes3','runCheck3','applyStaged3'];
async function loadCore(world = {run:async () => { throw Error('unexpected world call'); }}) {
  const text = `async function load(){\n${coreSource()}\nreturn {${coreNames.join(',')}};\n}`;
  return new Function('world',`${stripTypeScriptTypes(text,{mode:'transform'})}\nreturn load();`)(world);
}
function workflowSource(name) {
  const disk = fs.readFileSync(path.join(root,'.zcode','workflows',`${name}.dwf.ts`),'utf8');
  const body = disk.replace(/^\/\* zcode-workflow[\s\S]*?\*\//,'');
  return body.replace(/\/\/ TASK_CORE_START[\s\S]*?\/\/ TASK_CORE_END/,`// TASK_CORE_START\n${coreSource()}\n// TASK_CORE_END`);
}
async function runWorkflow(name, env) {
  const body = workflowSource(name).replace('const RECOVERY_INPUT_PATH = "";',`const RECOVERY_INPUT_PATH = ${JSON.stringify(env.recoveryInputPath || '')};`).replace('const RECOVERY_CHECKPOINT_PATH3 = "";',`const RECOVERY_CHECKPOINT_PATH3 = ${JSON.stringify(env.recoveryCheckpointPath || '')};`);
  const text = stripTypeScriptTypes(`async function task(){\n${body}\n}`,{mode:'transform'});
  const values = {args:{},run:{id:'mock-run'},log:()=>{},report:()=>{},phase:()=>{},artifact:{file:async()=>({id:'x',version:1}),markdown:async()=>({id:'x',version:1}),board:()=>{}},files:{read:async()=>{throw Error('not mocked');}},git:{},world:{},agent:()=>{throw Error('agent not mocked');},...env};
  return new Function(...Object.keys(values),`${text}\nreturn task();`)(...Object.values(values));
}
async function loadPlanPure() {
  const source = workflowSource('task-plan').replace(/return await planMain3\(\);\s*$/,'');
  const names = ['intakeErrorsPlan3','analysisErrorsPlan3','namespaceAnalysisPlan3','mergeChecksPlan3','wireConflictsPlan3','addedReconPlan3','repairablePlan3','inputErrorsPlan3','legacyPlan3'];
  return new Function(`${stripTypeScriptTypes(`function load(){\n${source}\nreturn {${names.join(',')}};\n}`,{mode:'transform'})}\nreturn load();`)();
}
async function loadRunPure() {
  const source = workflowSource('task-run').split('phase("读取实施方案入口");')[0];
  const names = ['stagedManifest3','executionCheckpointErrors3','executionOutcomeErrors3','implementationReviewErrors3','checkpointResultErrors3'];
  return new Function('artifact',`${stripTypeScriptTypes(`function load(){\n${source}\nreturn {${names.join(',')}};\n}`,{mode:'transform'})}\nreturn load();`)({board:()=>{}});
}
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'task-v3-fixture-'));
  const world = {run:async (cmd,argv=[],opts={}) => {
    const out = cp.spawnSync(cmd,argv,{cwd:dir,encoding:'utf8',timeout:Math.min(opts.timeoutMs || 120000,120000),maxBuffer:40 * 1024 * 1024,windowsHide:true});
    if (out.error) throw out.error;
    return {exitCode:out.status ?? 1,stdout:out.stdout || '',stderr:out.stderr || ''};
  }};
  const put = (name,text) => {const file=path.join(dir,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);};
  return {dir,world,put,read:name=>fs.readFileSync(path.join(dir,name),'utf8'),remove:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
function plan(overrides={}) {
  return {scenario:'feature',title:'订单实施方案',goal:'修正订单规则',summary:'按现有规则修正错误',requirements:[{id:'R1',statement:'订单规则正确',criteria:['成功与失败边界有回归测试']}],architecture:null,technologies:[],stages:[{id:'S1',title:'实现与验收',goal:'修正错误并回归',dependsOn:[],checkIds:['CS']}],tasks:[task()],checks:[check(),check({id:'CS',kind:'stage'}),check({id:'CF',kind:'final'})],decisions:[],evidence:[{id:'E1',kind:'repository',location:'src/a.js:1',symbol:'a',observation:'现有代码中存在订单处理逻辑',version:'当前文件',license:'项目许可证',accessed:'2026-10-31'}],findings:[],coverage:['src/a.js 的相关入口与错误路径'],gaps:[],assumptions:[],notDoing:[],rollout:['用户上线测试'],...overrides};
}
function task(overrides={}) {return {id:'T1',stageId:'S1',title:'修正订单',requirementIds:['R1'],findingIds:[],readFiles:['src/a.js'],files:['src/a.js'],steps:['修正边界并增加回归测试'],behaviorAcceptance:['订单失败时不丢状态'],checkIds:['CT'],dependsOn:[],outputs:['src/a.js'],risk:'影响订单状态',riskMitigation:['保持旧接口'],rationale:'现有入口要求一致',execution:'staged',...overrides};}
function check(overrides={}) {return {id:'CT',title:'测试订单',kind:'task',program:'node',args:['checks.cjs'],shell:null,permission:'local-check',timeoutMs:10000,writeFiles:[],...overrides};}
function review(overrides={}) {return {verdict:'approve',issues:[],summary:'核对需求、源文件和边界，未发现阻塞',...overrides};}
function baseline(files=[]) {return {kind:'filesystem',head:null,branch:null,stash:null,files,scopes:['.']};}
async function contract(core, value=plan(), overrides={}) {return {contractVersion:3,mode:'standard',allowShell:false,status:'ready',approved:false,approvalEvidence:'',review:review(),reviewedPlanSnapshot:core.stableJson3(value),reviewedReviewHash:core.hash3(core.stableJson3(review())),resolutions:[],plan:value,baseline:baseline(),supports:[],...overrides};}
function scenarioAgent(scenario,events){
  return (name)=>({ask:async(prompt)=>{
    events.push({name,prompt});
    if(name==='需求与范围分析') return {scenario,title:'实施方案',goal:scenario==='diagnostic'?'排查订单错误':'实现订单规则',summary:'按证据完成分析',shards:[{kind:scenario==='greenfield'?'research':'repository',paths:scenario==='greenfield'?[]:['src'],focus:'相关订单设计/问题'}]};
    if(name.startsWith('实际调查·')) return {summary:'实际阅读相关入口与证据',evidence:scenario==='greenfield'?[{id:'E1',kind:'public',location:'https://example.com/docs',symbol:'API',observation:'官方接口说明',version:'2026版本',license:'文档许可已记录',accessed:'2026-10-31'}]:plan().evidence,findings:scenario==='diagnostic'?[{id:'F1',title:'失败路径丢状态',severity:'medium',status:'unconfirmed',location:'src/a.js:1',symbol:'a',trigger:'失败分支',impact:'丢状态',evidenceIds:['E1'],fixSuggestion:'修复失败分支',verification:'回归测试',confirmation:'待确认'}]:[],technologies:[],coverage:['已调查相关源码/资料'],gaps:[]};
    if(name.startsWith('问题独立核对')) return {confirmed:true,explanation:'独立读取失败分支确认状态丢失；未运行测试'};
    if(name==='方案设计与修订'){
      if(prompt.includes('只返回 Patch3')) throw Error('fixture unexpected patch');
      return {title:'实施方案',goal:'实现或修复订单规则',summary:'基于实际调查',requirements:plan().requirements,architecture:null,technologies:[],stages:plan().stages,checks:plan().checks,decisions:[],assumptions:[],notDoing:[],rollout:['用户上线测试'],taskSeeds:[{id:'T1',stageId:'S1',title:'修正订单',goal:'修正边界',requirementIds:['R1'],findingIds:scenario==='diagnostic'?['A1-F1']:[],files:['src/a.js'],dependsOn:[]}]};
    }
    if(name.startsWith('任务书作者')) return {task:task({findingIds:scenario==='diagnostic'?['A1-F1']:[]}),checks:[]};
    if(name.startsWith('方案连续复核')||name.startsWith('方案独立终审')) return review();
    throw Error('unknown actor '+name);
  }});
}
module.exports={root,hash,coreSource,loadCore,workflowSource,runWorkflow,loadPlanPure,loadRunPure,fixture,plan,task,check,review,baseline,contract,scenarioAgent};
