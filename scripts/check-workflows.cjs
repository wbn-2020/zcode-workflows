const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { stripTypeScriptTypes } = require('node:module');
const root = path.resolve(__dirname, '..');
const skillPath = process.env.ZCODE_WORKFLOW_SKILL || 'C:/AI/ZCode/resources/glm/packages/bundled-skills/skills/dynamic-workflows/SKILL.md';
const ts = process.env.ZCODE_TYPESCRIPT ? require(process.env.ZCODE_TYPESCRIPT) : require('typescript');
const skill = fs.readFileSync(skillPath, 'utf8');
const region = skill.split('<!-- facade-dts:start -->')[1]?.split('<!-- facade-dts:end -->')[0];
const facade = region?.match(/```ts\s*([\s\S]*?)```/)?.[1];
if (!facade) throw new Error('official workflow facade not found');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'task-workflow-types-'));
let errors = 0;
try {
  const ambientPath = path.join(temp, 'facade.d.ts');
  fs.writeFileSync(ambientPath, facade);
  const wrapped = [];
  for (const name of ['task-plan', 'task-run']) {
    const file = path.join(root, '.zcode', 'workflows', `${name}.dwf.ts`);
    const source = fs.readFileSync(file, 'utf8');
    const body = source.replace(/^\/\* zcode-workflow[\s\S]*?\*\//, '');
    const text = `async function main_${name.replace('-','_')}(){\n${body}\n}\n`;
    const stripped = stripTypeScriptTypes(text, { mode: 'transform' });
    new Function(stripped);
    const target = path.join(temp, `${name}.ts`);
    fs.writeFileSync(target, text);
    wrapped.push(target);
    console.log(`${name}: syntax passed`);
  }
  const program = ts.createProgram([ambientPath,...wrapped], { target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.CommonJS, strict:true, noUncheckedIndexedAccess:false, noEmit:true, skipLibCheck:false, types:[], lib:['lib.es2022.d.ts'] });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  for (const item of diagnostics) {
    const message = ts.flattenDiagnosticMessageText(item.messageText, '\n');
    const location = item.file && item.start !== undefined ? item.file.getLineAndCharacterOfPosition(item.start) : null;
    console.error(`${item.file ? path.basename(item.file.fileName) : ''}${location ? `:${location.line}:${location.character + 1}` : ''} TS${item.code} ${message}`);
  }
  errors += diagnostics.length;
  if (!errors) console.log('Official facade: strict TypeScript passed. Host analyzer/schema validation is separate.');
} finally { fs.rmSync(temp, { recursive:true,force:true }); }
process.exitCode = errors ? 1 : 0;
