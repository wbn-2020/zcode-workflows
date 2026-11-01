const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const p = JSON.parse(process.argv[1]);
const cwd = fs.realpathSync(process.cwd());
let program = p.program;
let argv = p.args;
const outputLimit = 16384;
const commandLimit = 30000;
const tail = value => Buffer.from(value || '').subarray(-outputLimit).toString('utf8');
try {
  if (typeof program !== 'string' || !Array.isArray(argv) || !argv.every(x => typeof x === 'string')) throw Error('invalid check argv');
  if (p.shell !== null) {
    if (!p.allowShell) throw Error('shell not authorized');
    if (process.platform === 'win32') { program = process.env.ComSpec || 'cmd.exe'; argv = ['/d','/s','/c',p.shell]; }
    else { program = '/bin/sh'; argv = ['-c',p.shell]; }
  } else if (process.platform === 'win32' && ['npm','pnpm','yarn'].includes(program.toLowerCase())) {
    const names = program.toLowerCase() === 'npm' ? ['node_modules/npm/bin/npm-cli.js'] : program.toLowerCase() === 'pnpm' ? ['node_modules/pnpm/bin/pnpm.cjs','node_modules/corepack/dist/pnpm.js'] : ['node_modules/yarn/bin/yarn.js','node_modules/corepack/dist/yarn.js'];
    const directories = [path.dirname(process.execPath),...String(process.env.PATH || '').split(path.delimiter)];
    const script = directories.flatMap(dir => names.map(name => path.join(dir,name))).find(name => fs.existsSync(name) && fs.statSync(name).isFile());
    if (!script) throw Object.assign(Error('non-shell package-manager CLI not found; install the tool or explicitly authorize shell'),{ code:'ENOENT' });
    argv = [script,...argv]; program = process.execPath;
  } else if (process.platform === 'win32' && /\.(?:bat|cmd)$/i.test(program)) throw Object.assign(Error('Windows batch check requires explicit shell authorization'),{ code:'EACCES' });
  if ([program,...argv].reduce((n,x) => n + x.length * 2 + 4,0) > commandLimit) throw Error('check command exceeds Windows argv budget');
  const result = cp.spawnSync(program,argv,{ cwd,encoding:'utf8',shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:p.timeoutMs,maxBuffer:16 * 1024 * 1024 });
  let exitCode = typeof result.status === 'number' ? result.status : 1;
  let errorKind = '';
  if (result.error) {
    if (result.error.code === 'ETIMEDOUT' || result.signal === 'SIGTERM') { exitCode=124;errorKind='timeout'; }
    else if (result.error.code === 'ENOENT') { exitCode=127;errorKind='missing-tool'; }
    else if (result.error.code === 'EACCES') { exitCode=126;errorKind='spawn'; }
    else if (result.error.code === 'ENOBUFS') { exitCode=125;errorKind='output-cap'; }
    else { exitCode=126;errorKind='spawn'; }
  } else if (result.signal) { exitCode=124;errorKind='signal'; }
  process.stdout.write(JSON.stringify({exitCode,stdout:tail(result.stdout),stderr:tail(result.stderr) + (result.error ? '\n' + String(result.error.message) : ''),errorKind}));
} catch (error) { process.stdout.write(JSON.stringify({exitCode:error.code === 'ENOENT' ? 127 : 126,stdout:'',stderr:String(error.message || error),errorKind:error.code === 'ENOENT' ? 'missing-tool' : 'spawn'})); }
