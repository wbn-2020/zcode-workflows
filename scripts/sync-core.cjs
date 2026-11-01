const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const workflowDir = path.join(root, '.zcode', 'workflows');
let core = fs.readFileSync(path.join(workflowDir, '_task-core.ts'), 'utf8').trim();
for (const [token, name] of [['IO','io'],['APPLY','apply'],['CHECK','check']]) {
  const program = fs.readFileSync(path.join(__dirname, `task-${name}.cjs`), 'utf8');
  const placeholder = JSON.stringify(`__TASK_${token}_PROGRAM__`);
  if (!core.includes(placeholder)) throw new Error(`missing ${token} program placeholder`);
  core = core.replace(placeholder, JSON.stringify(program));
}
for (const name of ['task-plan', 'task-run']) {
  const file = path.join(workflowDir, `${name}.dwf.ts`);
  const source = fs.readFileSync(file, 'utf8');
  const start = '// TASK_CORE_START';
  const end = '// TASK_CORE_END';
  const from = source.indexOf(start), to = source.indexOf(end);
  if (from < 0 || to <= from || source.indexOf(start, from + start.length) >= 0 || source.indexOf(end, to + end.length) >= 0) throw new Error(`${name}: invalid core markers`);
  const next = source.slice(0, from + start.length) + '\n' + core + '\n' + source.slice(to);
  if (next !== source) fs.writeFileSync(file, next);
  console.log(`${name}: shared core embedded`);
  const scripts = path.join(root, '.agents', 'skills', name, 'scripts');
  fs.mkdirSync(scripts, { recursive: true });
  for (const [target, origin] of [['preflight.cjs', path.join(__dirname, 'preflight.cjs')], ['task-io.cjs', path.join(__dirname, 'task-io.cjs')], ['core.ts', path.join(workflowDir, '_task-core.ts')]]) {
    const content = fs.readFileSync(origin, 'utf8');
    const output = path.join(scripts, target);
    if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== content) fs.writeFileSync(output, content);
  }
  console.log(`${name}: read-only recovery helpers bundled`);
}
