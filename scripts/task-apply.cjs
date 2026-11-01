const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const [encoded] = process.argv.slice(1);
const p = JSON.parse(encoded);
const cwd = fs.realpathSync.native(process.cwd());
const digest = data => 'sha256:' + crypto.createHash('sha256').update(data).digest('hex');
const inside = (file, scopes) => scopes.some(scope => file.toLowerCase() === scope.toLowerCase() || file.toLowerCase().startsWith(scope.toLowerCase() + '/'));
const safe = raw => {
  if (typeof raw !== 'string' || !raw || raw !== raw.trim() || /[\x00-\x1f\x7f:*?\[\]{}<>"|]/.test(raw)) throw Error('unsafe path');
  const parts = raw.replace(/\\/g, '/').split('/');
  if (parts.some(s => !s || s === '.' || s === '..' || s.toLowerCase() === '.git' || /[. ]$/.test(s) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s))) throw Error('unsafe path component');
  const abs = path.resolve(cwd, ...parts);
  const bounded = x => x.toLowerCase() === cwd.toLowerCase() || x.toLowerCase().startsWith((cwd + path.sep).toLowerCase());
  if (!bounded(abs)) throw Error('path escapes workspace');
  let current = cwd;
  for (const part of parts) {
    current = path.join(current, part);
    let st;
    try { st = fs.lstatSync(current); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    if (st.isSymbolicLink() || !bounded(fs.realpathSync.native(current))) throw Error('symlink/reparse path refused');
  }
  return abs;
};
const hash = abs => {
  try {
    const st = fs.lstatSync(abs);
    if (!st.isFile() || st.isSymbolicLink()) throw Error('not a regular file');
    const h = crypto.createHash('sha256');
    const fd = fs.openSync(abs,'r');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    try { let length; while ((length = fs.readSync(fd,buffer,0,buffer.length,null)) > 0) h.update(buffer.subarray(0,length)); }
    finally { fs.closeSync(fd); }
    const after = fs.statSync(abs);
    if (st.ino !== after.ino || st.size !== after.size || st.mtimeMs !== after.mtimeMs || st.mode !== after.mode) throw Error('file changed during hash');
    return 'sha256:' + h.digest('hex');
  } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
};
const mkdir = (abs, made) => {
  if (fs.existsSync(abs)) { if (!fs.statSync(abs).isDirectory()) throw Error('parent not directory'); return; }
  mkdir(path.dirname(abs), made); fs.mkdirSync(abs); made.push(abs);
};
const validHash = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const prepared = [];
const applied = [];
const createdDirs = [];
const temporaryFiles = new Set();
let transactionRoot = null;
const writeTemporary = (abs, content, expected, message) => {
  const fd = fs.openSync(abs, 'wx', 0o600);
  temporaryFiles.add(abs);
  try { fs.writeFileSync(fd, content); } finally { fs.closeSync(fd); }
  if (hash(abs) !== expected) throw Error(message);
};
try {
  if (!/^\.zcode\/task-runs\/[a-f0-9]{64}$/.test(p.ioRoot) || !/^\.zcode\/task-runs\/[a-f0-9]{64}\/.+/.test(p.stageRoot) || !inside(p.stageRoot, [p.ioRoot])) throw Error('stage root not owned by current run');
  if (inside(p.stageRoot, [p.ioRoot + '/controller'])) throw Error('controller root overlaps worker staging');
  const manifestAbs = safe(p.stageRoot + '/manifest.json');
  const scopeAbs = safe(p.taskPath);
  if (hash(manifestAbs) !== p.manifestHash || hash(scopeAbs) !== p.taskHash) throw Error('manifest/task changed after validation');
  const taskText = fs.readFileSync(scopeAbs, 'utf8');
  const manifestText = fs.readFileSync(manifestAbs, 'utf8');
  if (digest(taskText) !== p.taskHash || digest(manifestText) !== p.manifestHash) throw Error('manifest/task buffers changed during read');
  const task = JSON.parse(taskText);
  const manifest = JSON.parse(manifestText);
  if (!task || !Array.isArray(task.files) || !manifest || Object.keys(manifest).some(k => k !== 'changes') || !Array.isArray(manifest.changes)) throw Error('invalid task/manifest');
  const seen = new Set();
  for (const change of manifest.changes) {
    if (!change || Object.keys(change).some(k => !['action','path','baseHash','outputHash','mode'].includes(k)) || !inside(change.path, task.files) || inside(change.path, ['.zcode/task-plans','.zcode/task-runs']) || (p.protectedPaths || []).some(x => inside(x, [change.path]) || inside(change.path, [x]))) throw Error('target outside approved scope or protected');
    if (seen.has(change.path.toLowerCase())) throw Error('duplicate manifest target');
    seen.add(change.path.toLowerCase());
    const target = safe(change.path);
    const currentHash = hash(target);
    if (currentHash !== change.baseHash) throw Error('target CAS mismatch: ' + change.path);
    if (change.action !== 'put' && change.action !== 'delete') throw Error('invalid manifest action');
    if (change.action === 'delete' && (currentHash === null || change.outputHash !== null || !task.files.includes(change.path))) throw Error('delete requires exact approved existing target');
    if (change.action === 'put' && !validHash(change.outputHash)) throw Error('missing output hash');
    if (change.mode !== undefined && (!Number.isInteger(change.mode) || change.mode < 0 || change.mode > 511 || change.action !== 'put')) throw Error('invalid mode');
    const stageAbs = change.action === 'put' ? safe(p.stageRoot + '/files/' + change.path) : null;
    if (stageAbs && (fs.statSync(stageAbs).size > 32 * 1024 * 1024 || hash(stageAbs) !== change.outputHash)) throw Error('staged content hash mismatch or exceeds 32 MiB');
    if (currentHash !== null && fs.statSync(target).size > 32 * 1024 * 1024) throw Error('transaction target exceeds 32 MiB rollback cap');
    const oldMode = currentHash === null ? 0o644 : fs.statSync(target).mode & 0o7777;
    const oldContent = currentHash === null ? null : fs.readFileSync(target);
    const content = stageAbs ? fs.readFileSync(stageAbs) : null;
    if (oldContent !== null && (oldContent.length > 32 * 1024 * 1024 || digest(oldContent) !== change.baseHash)) throw Error('original buffer changed during preparation or exceeds 32 MiB');
    if (content !== null && (content.length > 32 * 1024 * 1024 || digest(content) !== change.outputHash)) throw Error('staged buffer changed during preparation or exceeds 32 MiB');
    prepared.push({ change, target, oldMode, oldContent, content, temp: null, backup: null, appliedMode: null });
  }
  if (prepared.length) {
    const controllerRoot = safe(p.ioRoot + '/controller');
    if (!fs.existsSync(controllerRoot)) fs.mkdirSync(controllerRoot, { mode: 0o700 });
    if (!fs.lstatSync(controllerRoot).isDirectory()) throw Error('controller root not directory');
    safe(p.ioRoot + '/controller');
    transactionRoot = fs.mkdtempSync(path.join(controllerRoot, 'transaction-'));
    safe(path.relative(cwd, transactionRoot).split(path.sep).join('/'));
    fs.chmodSync(transactionRoot, 0o700);
    for (const item of prepared) {
      const suffix = digest(item.change.path).slice(7);
      if (item.oldContent !== null) {
        item.backup = path.join(transactionRoot, 'rollback-' + suffix);
        writeTemporary(item.backup, item.oldContent, item.change.baseHash, 'temporary rollback does not match original buffer');
        fs.chmodSync(item.backup, item.oldMode);
      }
      if (item.content !== null) {
        item.temp = path.join(transactionRoot, 'apply-' + suffix);
        writeTemporary(item.temp, item.content, item.change.outputHash, 'temporary output does not match staged buffer');
      }
    }
  }
  if (hash(manifestAbs) !== p.manifestHash || hash(scopeAbs) !== p.taskHash) throw Error('staging input changed during preparation');
  const workspaceContent = () => {
    const stamps = [];
    const walk = (abs, relative) => {
      if (relative && inside(relative, [p.ioRoot])) return;
      const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) throw Error('symlink appeared during apply');
      if (st.isDirectory()) for (const name of fs.readdirSync(abs).sort()) { if (name.toLowerCase() !== '.git') walk(path.join(abs,name),relative ? relative + '/' + name : name); }
      else if (st.isFile()) stamps.push({ path: relative, hash: hash(abs), mode: st.mode & 0o7777 });
      else throw Error('special file appeared during apply');
    };
    walk(cwd,'');
    return stamps.sort((a,b) => a.path.localeCompare(b.path));
  };
  const before = JSON.parse(fs.readFileSync(safe(p.beforePath), 'utf8'));
  if (JSON.stringify(workspaceContent()) !== JSON.stringify(before.files)) throw Error('workspace changed before transaction');
  for (const item of prepared) {
    const { change, target } = item;
    safe(change.path);
    if (hash(target) !== change.baseHash || (change.baseHash !== null && (fs.statSync(target).mode & 0o7777) !== item.oldMode)) throw Error('target content or mode changed immediately before apply');
    if (change.action === 'put') {
      const temp = item.temp;
      if (hash(temp) !== change.outputHash) throw Error('temporary output changed before apply');
      mkdir(path.dirname(target), createdDirs);
      if (change.baseHash === null) {
        fs.linkSync(temp,target);
        applied.push(item);
        item.appliedMode = fs.statSync(target).mode & 0o7777;
        fs.unlinkSync(temp);
        temporaryFiles.delete(temp);
      } else {
        fs.renameSync(temp,target);
        temporaryFiles.delete(temp);
        applied.push(item);
        item.appliedMode = fs.statSync(target).mode & 0o7777;
      }
      fs.chmodSync(target,change.mode === undefined ? item.oldMode : change.mode);
      item.appliedMode = fs.statSync(target).mode & 0o7777;
      if (hash(target) !== change.outputHash) throw Error('applied output mismatch');
    } else { fs.unlinkSync(target); applied.push(item); }
    if (p.failAfter === applied.length) throw Error('injected fixture transaction failure');
  }
  process.stdout.write(JSON.stringify({ ok: true, paths: prepared.map(item => item.change.path) }));
} catch (e) {
  const rollbackErrors = [];
  for (const item of applied.reverse()) {
    let writableMode = null;
    try {
      safe(item.change.path);
      const expected = item.change.action === 'put' ? item.change.outputHash : null;
      if (hash(item.target) !== expected || (expected !== null && item.appliedMode !== null && (fs.statSync(item.target).mode & 0o7777) !== item.appliedMode)) throw Error('externally changed output or mode; not rolling back');
      if (item.oldContent !== null && hash(item.backup) !== item.change.baseHash) throw Error('prepared rollback backup changed');
      if (expected !== null && process.platform === 'win32' && (item.appliedMode & 0o222) === 0) {
        fs.chmodSync(item.target,item.appliedMode | 0o200);
        writableMode = fs.statSync(item.target).mode & 0o7777;
      }
      if (item.oldContent === null) fs.unlinkSync(item.target);
      else {
        const tmp = item.backup;
        if (expected === null) {
          fs.linkSync(tmp,item.target);
          fs.unlinkSync(tmp);
        } else fs.renameSync(tmp,item.target);
        temporaryFiles.delete(tmp);
        fs.chmodSync(item.target,item.oldMode);
      }
    } catch (rollback) {
      try {
        safe(item.change.path);
        if (writableMode !== null && item.change.action === 'put' && item.appliedMode !== null && hash(item.target) === item.change.outputHash && (fs.statSync(item.target).mode & 0o7777) === writableMode) fs.chmodSync(item.target,item.appliedMode);
      } catch {}
      rollbackErrors.push(item.change.path + ': ' + String(rollback.message || rollback));
    }
  }
  for (const dir of createdDirs.reverse()) {
    try { safe(path.relative(cwd,dir).split(path.sep).join('/')); fs.rmdirSync(dir); } catch {}
  }
  process.stdout.write(JSON.stringify({ ok:false,error:String(e.message || e),rollbackErrors }));
  process.exitCode=1;
} finally {
  for (const temp of temporaryFiles) {
    try { safe(path.relative(cwd,temp).split(path.sep).join('/')); fs.unlinkSync(temp); } catch {}
  }
  if (transactionRoot !== null) {
    try { safe(path.relative(cwd,transactionRoot).split(path.sep).join('/')); fs.rmdirSync(transactionRoot); } catch {}
  }
}
