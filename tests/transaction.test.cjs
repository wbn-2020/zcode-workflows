const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { root, hash, loadCore, fixture, task } = require('./helpers.cjs');

async function transaction(f, changes) {
  const ioRoot = '.zcode/task-runs/' + '6'.repeat(64);
  const stageRoot = `${ioRoot}/staging/w1-a1/T1`;
  const c = await loadCore(f.world);
  c.authorizeIoRoot3(ioRoot);
  const before = await c.snapshot3(['.'], [ioRoot]);
  const taskPath = `${stageRoot}/task.json`;
  const beforePath = `${stageRoot}/before.json`;
  const manifestPath = `${stageRoot}/manifest.json`;
  f.put(taskPath, JSON.stringify(task({ files: changes.map(change => change.path) })));
  f.put(beforePath, JSON.stringify(before));
  f.put(manifestPath, JSON.stringify({ changes: changes.map(({ content, ...change }) => change) }));
  for (const change of changes) if (change.action === 'put') f.put(`${stageRoot}/files/${change.path}`, change.content);
  return { ioRoot, stageRoot, taskPath, taskHash: hash(f.read(taskPath)), beforePath, manifestHash: hash(f.read(manifestPath)) };
}

async function apply(f, payload, injected = '') {
  const code = fs.readFileSync(path.join(root, 'scripts/task-apply.cjs'), 'utf8');
  const result = await f.world.run('node', ['-e', injected + code, JSON.stringify(payload)]);
  return { exitCode: result.exitCode, ...JSON.parse(result.stdout) };
}

const put = (name, before, content, mode) => ({ action: 'put', path: name, baseHash: before === null ? null : hash(before), outputHash: hash(content), content, ...(mode === undefined ? {} : { mode }) });

test('staging temporary preoccupation does not block a safe delete and put', async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'original');
    const payload = await transaction(f, [
      { action: 'delete', path: 'src/a.js', baseHash: hash('original'), outputHash: null },
      put('src/b.js', null, 'replacement')
    ]);
    const occupiedApply = `${payload.stageRoot}/apply-${hash('src/b.js').slice(7)}`;
    const occupiedRollback = `${payload.stageRoot}/rollback-${hash('src/a.js').slice(7)}`;
    f.put(occupiedApply, 'worker-owned apply');
    f.put(occupiedRollback, 'worker-owned rollback');
    const result = await apply(f, payload);
    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.equal(result.ok, true);
    assert.deepEqual(result.paths, ['src/a.js', 'src/b.js']);
    assert(!fs.existsSync(path.join(f.dir, 'src/a.js')));
    assert.equal(f.read('src/b.js'), 'replacement');
    assert.equal(f.read(occupiedApply), 'worker-owned apply');
    assert.equal(f.read(occupiedRollback), 'worker-owned rollback');
    assert.deepEqual(fs.readdirSync(path.join(f.dir, payload.ioRoot, 'controller')), []);
  } finally { f.remove(); }
});

test('backup preparation failure leaves every target unchanged', async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'original');
    f.put('src/b.js', 'old replacement');
    const originalMode = fs.statSync(path.join(f.dir, 'src/a.js')).mode & 0o7777;
    const replacementMode = fs.statSync(path.join(f.dir, 'src/b.js')).mode & 0o7777;
    const payload = await transaction(f, [
      { action: 'delete', path: 'src/a.js', baseHash: hash('original'), outputHash: null },
      put('src/b.js', 'old replacement', 'replacement')
    ]);
    const backupName = `rollback-${hash('src/b.js').slice(7)}`;
    const result = await apply(f, { ...payload, failAfter: 1 }, `const fixtureFs = require('node:fs'); const fixtureOpen = fixtureFs.openSync; fixtureFs.openSync = function(name,...rest) { if (String(name).endsWith(${JSON.stringify(backupName)})) { if (fixtureFs.readFileSync('src/a.js','utf8') !== 'original' || fixtureFs.readFileSync('src/b.js','utf8') !== 'old replacement') throw Error('fixture target changed before backup preparation'); throw Error('fixture backup preparation failure'); } return fixtureOpen.call(this,name,...rest); };\n`);
    assert.equal(result.exitCode, 1);
    assert.match(result.error, /fixture backup preparation failure/);
    assert.deepEqual(result.rollbackErrors, []);
    assert.equal(f.read('src/a.js'), 'original');
    assert.equal(fs.statSync(path.join(f.dir, 'src/a.js')).mode & 0o7777, originalMode);
    assert.equal(f.read('src/b.js'), 'old replacement');
    assert.equal(fs.statSync(path.join(f.dir, 'src/b.js')).mode & 0o7777, replacementMode);
  } finally { f.remove(); }
});

test('put preparation failure leaves targets and their parent directories unchanged', async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'original');
    const payload = await transaction(f, [
      { action: 'delete', path: 'src/a.js', baseHash: hash('original'), outputHash: null },
      put('src/new/b.js', null, 'replacement')
    ]);
    const result = await apply(f, payload, `const fixtureFs = require('node:fs'); const fixtureOpen = fixtureFs.openSync; fixtureFs.openSync = function(name,...rest) { if (/apply-[a-f0-9]{64}$/.test(String(name))) { if (fixtureFs.readFileSync('src/a.js','utf8') !== 'original' || fixtureFs.existsSync('src/new')) throw Error('fixture target changed before put preparation'); throw Error('fixture put preparation failure'); } return fixtureOpen.call(this,name,...rest); };\n`);
    assert.equal(result.exitCode, 1);
    assert.match(result.error, /fixture put preparation failure/);
    assert.deepEqual(result.rollbackErrors, []);
    assert.equal(f.read('src/a.js'), 'original');
    assert(!fs.existsSync(path.join(f.dir, 'src/new')));
  } finally { f.remove(); }
});

for (const kind of ['apply', 'rollback']) test(`${kind} temporary hash failure leaves every target unchanged`, async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'original');
    const payload = await transaction(f, [
      { action: 'delete', path: 'src/a.js', baseHash: hash('original'), outputHash: null },
      put('src/b.js', null, 'replacement')
    ]);
    const result = await apply(f, payload, `const fixtureFs = require('node:fs'); const fixtureOpen = fixtureFs.openSync; const fixtureWrite = fixtureFs.writeFileSync; let fixtureCorrupt = false; fixtureFs.openSync = function(name,...rest) { const fd = fixtureOpen.call(this,name,...rest); if (rest[0] === 'wx') fixtureCorrupt = /${kind}-[a-f0-9]{64}$/.test(String(name)); return fd; }; fixtureFs.writeFileSync = function(name,content,...rest) { return fixtureWrite.call(this,name,typeof name === 'number' && fixtureCorrupt ? Buffer.from('corrupt fixture temporary') : content,...rest); };\n`);
    assert.equal(result.exitCode, 1);
    assert.match(result.error, kind === 'apply' ? /temporary output does not match staged buffer/ : /temporary rollback does not match original buffer/);
    assert.deepEqual(result.rollbackErrors, []);
    assert.equal(f.read('src/a.js'), 'original');
    assert(!fs.existsSync(path.join(f.dir, 'src/b.js')));
  } finally { f.remove(); }
});

test('transaction cleanup preserves temporary files it did not create', async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'original');
    const payload = await transaction(f, [{ action: 'delete', path: 'src/a.js', baseHash: hash('original'), outputHash: null }]);
    const backupName = `rollback-${hash('src/a.js').slice(7)}`;
    const result = await apply(f, payload, `const fixtureFs = require('node:fs'); const fixturePath = require('node:path'); const fixtureMkdtemp = fixtureFs.mkdtempSync; fixtureFs.mkdtempSync = function(...args) { const dir = fixtureMkdtemp.apply(this,args); fixtureFs.writeFileSync(fixturePath.join(dir,${JSON.stringify(backupName)}),'unowned temporary',{ flag:'wx' }); return dir; };\n`);
    assert.equal(result.exitCode, 1);
    assert.match(result.error, /EEXIST/);
    assert.deepEqual(result.rollbackErrors, []);
    assert.equal(f.read('src/a.js'), 'original');
    const controllerRoot = `${payload.ioRoot}/controller`;
    const roots = fs.readdirSync(path.join(f.dir, controllerRoot));
    assert.equal(roots.length, 1);
    assert.match(roots[0], /^transaction-/);
    assert.equal(f.read(`${controllerRoot}/${roots[0]}/${backupName}`), 'unowned temporary');
  } finally { f.remove(); }
});

test('rollback consumes prepared backups without writing new temporary content', async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'original');
    const payload = await transaction(f, [
      { action: 'delete', path: 'src/a.js', baseHash: hash('original'), outputHash: null },
      put('src/b.js', null, 'replacement')
    ]);
    const result = await apply(f, { ...payload, failAfter: 2 }, `const fixtureFs = require('node:fs'); const fixtureUnlink = fixtureFs.unlinkSync; const fixtureWrite = fixtureFs.writeFileSync; let fixtureChanged = false; fixtureFs.unlinkSync = function(name,...rest) { const value = fixtureUnlink.call(this,name,...rest); if (String(name).replace(/\\\\/g,'/').endsWith('/src/a.js')) fixtureChanged = true; return value; }; fixtureFs.writeFileSync = function(...args) { if (fixtureChanged) throw Error('rollback must only consume prepared backups'); return fixtureWrite.apply(this,args); };\n`);
    assert.equal(result.exitCode, 1);
    assert.match(result.error, /injected fixture transaction failure/);
    assert.deepEqual(result.rollbackErrors, []);
    assert.equal(f.read('src/a.js'), 'original');
    assert(!fs.existsSync(path.join(f.dir, 'src/b.js')));
  } finally { f.remove(); }
});

test('controller transaction root refuses symlinks before any target change', async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'original');
    const payload = await transaction(f, [{ action: 'delete', path: 'src/a.js', baseHash: hash('original'), outputHash: null }]);
    const outside = `${payload.ioRoot}/worker-owned`;
    f.put(`${outside}/keep`, 'worker-owned');
    fs.symlinkSync(path.join(f.dir, outside), path.join(f.dir, payload.ioRoot, 'controller'), process.platform === 'win32' ? 'junction' : 'dir');
    const result = await apply(f, payload);
    assert.equal(result.exitCode, 1);
    assert.match(result.error, /symlink\/reparse path refused/);
    assert.deepEqual(result.rollbackErrors, []);
    assert.equal(f.read('src/a.js'), 'original');
    assert.equal(f.read(`${outside}/keep`), 'worker-owned');
    assert.deepEqual(fs.readdirSync(path.join(f.dir, outside)), ['keep']);
  } finally { f.remove(); }
});

test('rollback preserves original read-only permissions when final chmod fails', async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'original');
    fs.chmodSync(path.join(f.dir, 'src/a.js'), 0o444);
    const payload = await transaction(f, [{ action: 'delete', path: 'src/a.js', baseHash: hash('original'), outputHash: null }]);
    const result = await apply(f, { ...payload, failAfter: 1 }, `const fixtureFs = require('node:fs'); const fixtureChmod = fixtureFs.chmodSync; const fixtureUnlink = fixtureFs.unlinkSync; fixtureFs.unlinkSync = function(name,...rest) { if (process.platform === 'win32' && String(name).replace(/\\\\/g,'/').endsWith('/src/a.js')) fixtureChmod.call(this,name,0o644); return fixtureUnlink.call(this,name,...rest); }; fixtureFs.chmodSync = function(name,mode) { if (String(name).replace(/\\\\/g,'/').endsWith('/src/a.js') && !String(name).replace(/\\\\/g,'/').includes('/files/') && fixtureFs.readFileSync(name,'utf8') === 'original') throw Error('fixture restore chmod failure'); return fixtureChmod.call(this,name,mode); };\n`);
    assert.equal(result.exitCode, 1);
    assert.match(result.error, /injected fixture transaction failure/);
    assert.deepEqual(result.rollbackErrors, ['src/a.js: fixture restore chmod failure']);
    assert.equal(f.read('src/a.js'), 'original');
    assert.equal(fs.statSync(path.join(f.dir, 'src/a.js')).mode & 0o222, 0);
    assert.deepEqual(fs.readdirSync(path.join(f.dir, payload.ioRoot, 'controller')), []);
  } finally {
    fs.chmodSync(path.join(f.dir, 'src/a.js'), 0o644);
    f.remove();
  }
});

test('new-file link is tracked before temporary cleanup can fail', async () => {
  const f = fixture();
  try {
    const payload = await transaction(f, [put('src/new.js', null, 'new')]);
    const result = await apply(f, payload, `const fixtureFs = require('node:fs'); const fixtureUnlink = fixtureFs.unlinkSync; let fixtureFailed = false; fixtureFs.unlinkSync = function(name) { if (!fixtureFailed && /apply-[a-f0-9]{64}$/.test(String(name))) { fixtureFailed = true; throw Error('fixture cleanup failure'); } return fixtureUnlink.call(this,name); };\n`);
    assert.equal(result.exitCode, 1);
    assert.match(result.error, /fixture cleanup failure/);
    assert.deepEqual(result.rollbackErrors, []);
    assert(!fs.existsSync(path.join(f.dir, 'src/new.js')));
  } finally { f.remove(); }
});

test('staged buffers are checked after read rather than trusting an earlier hash', async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'original');
    const payload = await transaction(f, [put('src/a.js', 'original', 'changed')]);
    const result = await apply(f, payload, `const fixtureFs = require('node:fs'); const fixtureRead = fixtureFs.readFileSync; fixtureFs.readFileSync = function(name,...rest) { if (String(name).replace(/\\\\/g,'/').endsWith('/files/src/a.js')) return Buffer.from('different buffer'); return fixtureRead.call(this,name,...rest); };\n`);
    assert.equal(result.exitCode, 1);
    assert.match(result.error, /staged buffer changed/);
    assert.equal(f.read('src/a.js'), 'original');
  } finally { f.remove(); }
});

test('rollback refuses externally changed output content', async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'original');
    const payload = await transaction(f, [put('src/a.js', 'original', 'changed')]);
    const result = await apply(f, payload, `const fixtureFs = require('node:fs'); const fixtureStat = fixtureFs.statSync; const fixtureWrite = fixtureFs.writeFileSync; let fixtureStamps = 0; fixtureFs.statSync = function(name,...rest) { const value = fixtureStat.call(this,name,...rest); if (String(name).replace(/\\\\/g,'/').endsWith('/src/a.js') && !String(name).replace(/\\\\/g,'/').includes('/files/') && fixtureFs.readFileSync(name,'utf8') === 'changed') { fixtureStamps += 1; if (fixtureStamps === 3) { fixtureWrite.call(this,name,'external content'); throw Error('fixture external content interruption'); } } return value; };\n`);
    assert.equal(result.exitCode, 1);
    assert.match(result.error, /fixture external content/);
    assert(result.rollbackErrors.some(error => error.includes('externally changed output or mode')), JSON.stringify(result));
    assert.equal(f.read('src/a.js'), 'external content');
  } finally { f.remove(); }
});

test('rollback never restores permissions that another writer changed', async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'original');
    const payload = await transaction(f, [put('src/a.js', 'original', 'changed')]);
    const result = await apply(f, payload, `const fixtureFs = require('node:fs'); const fixtureStat = fixtureFs.statSync; const fixtureChmod = fixtureFs.chmodSync; let fixtureStamps = 0; let fixtureExternalMode = null; fixtureFs.statSync = function(name,...rest) { const value = fixtureStat.call(this,name,...rest); if (String(name).replace(/\\\\/g,'/').endsWith('/src/a.js') && !String(name).replace(/\\\\/g,'/').includes('/files/') && fixtureFs.readFileSync(name,'utf8') === 'changed') { fixtureStamps += 1; if (fixtureStamps === 3) { fixtureExternalMode = (value.mode & 0o222) === 0 ? 0o644 : 0o444; fixtureChmod.call(this,name,fixtureExternalMode); throw Error('fixture external mode interruption'); } } return value; }; fixtureFs.chmodSync = function(name,mode) { if (fixtureExternalMode !== null && String(name).replace(/\\\\/g,'/').endsWith('/src/a.js')) throw Error('rollback must not change external mode'); return fixtureChmod.call(this,name,mode); };\n`);
    assert.equal(result.exitCode, 1);
    assert.match(result.error, /fixture external mode/);
    assert(result.rollbackErrors.some(error => error.includes('externally changed output or mode')), JSON.stringify(result));
    assert.equal(f.read('src/a.js'), 'changed');
    assert.equal(fs.statSync(path.join(f.dir, 'src/a.js')).mode & 0o222, 0);
    fs.chmodSync(path.join(f.dir, 'src/a.js'), 0o644);
  } finally { f.remove(); }
});

test('Windows read-only staged output can roll back its own partial transaction', { skip: process.platform !== 'win32' }, async () => {
  const f = fixture();
  try {
    f.put('src/a.js', 'original');
    const payload = await transaction(f, [put('src/a.js', 'original', 'changed', 0o444)]);
    const result = await apply(f, { ...payload, failAfter: 1 });
    assert.equal(result.exitCode, 1);
    assert.match(result.error, /injected fixture transaction failure/);
    assert.deepEqual(result.rollbackErrors, []);
    assert.equal(f.read('src/a.js'), 'original');
    assert(fs.statSync(path.join(f.dir, 'src/a.js')).mode & 0o222);
    assert.deepEqual(fs.readdirSync(path.join(f.dir, payload.ioRoot, 'controller')), []);
  } finally { f.remove(); }
});

test('unborn Git preserves branch, absent-index binding and dirty paths', async () => {
  const f = fixture();
  try {
    const git = args => {
      const result = cp.spawnSync('git', args, { cwd: f.dir, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, windowsHide: true });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    git(['init', '--quiet', '--initial-branch=fixture-main']);
    const c = await loadCore(f.world);
    const own = '.zcode/task-plans/' + '7'.repeat(64);
    c.authorizeIoRoot3(own);
    const empty = await c.snapshot3(['.'], [own]);
    assert.equal(empty.kind, 'git');
    assert.equal(empty.head, null);
    assert.equal(empty.branch, 'fixture-main');
    const absent = await c.gitIndexHash3();
    assert.match(absent, /^sha256:[a-f0-9]{64}$/);
    f.put('src/a.js', 'uncommitted');
    assert((await c.gitDirtyPaths3()).includes('src/a.js'));
    git(['add', '--', 'src/a.js']);
    assert.notEqual(await c.gitIndexHash3(), absent);
    const indexed = await c.snapshot3(['.'], [own]);
    assert.equal(indexed.kind, 'git');
    assert.equal(indexed.head, null);
    assert((await c.gitDirtyPaths3()).includes('src/a.js'));
    git(['symbolic-ref', 'HEAD', 'refs/heads/fixture-other']);
    const moved = await c.snapshot3(['.'], [own]);
    assert(c.compareBaseline3(indexed, moved, []).some(error => error.includes('branch')));
  } finally { f.remove(); }
});
