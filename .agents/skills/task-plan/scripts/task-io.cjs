const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const [op, encoded] = process.argv.slice(1);
const p = JSON.parse(encoded);
const cwd = fs.realpathSync.native(process.cwd());
const digest = data => 'sha256:' + crypto.createHash('sha256').update(data).digest('hex');
const lower = s => process.platform === 'win32' ? s.toLowerCase() : s;
const bounded = abs => lower(abs) === lower(cwd) || lower(abs).startsWith(lower(cwd + path.sep));
const safe = raw => {
  if (typeof raw !== 'string' || !raw || raw !== raw.trim() || /[\x00-\x1f\x7f:*?\[\]{}<>"|]/.test(raw)) throw Error('unsafe relative path');
  const parts = raw.replace(/\\/g, '/').split('/');
  if (parts.some(s => !s || s === '.' || s === '..' || s.toLowerCase() === '.git' || /[. ]$/.test(s) || /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(s))) throw Error('unsafe path component');
  const abs = path.resolve(cwd, ...parts);
  if (!bounded(abs)) throw Error('path escapes workspace');
  let current = cwd;
  for (const part of parts) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) { try { fs.lstatSync(current); } catch (e) { if (e.code === 'ENOENT') continue; throw e; } }
    const st = fs.lstatSync(current);
    if (st.isSymbolicLink() || !bounded(fs.realpathSync.native(current))) throw Error('symlink/reparse path refused: ' + raw);
  }
  return abs;
};
const rel = abs => path.relative(cwd, abs).split(path.sep).join('/');
const inside = (file, scopes) => scopes.some(scope => scope === '.' || file.toLowerCase() === scope.toLowerCase() || file.toLowerCase().startsWith(scope.toLowerCase() + '/'));
const root = () => {
  if (typeof p.ioRoot !== 'string' || !/^\.zcode\/task-(?:plans|runs)\/[0-9a-f]{64}$/.test(p.ioRoot)) throw Error('missing exact workflow IO root');
  return safe(p.ioRoot);
};
const writable = raw => {
  const abs = safe(raw);
  if (!inside(raw, [p.ioRoot]) && !(Array.isArray(p.planPaths) && p.planPaths.includes(raw))) throw Error('write is outside this workflow owned root/approved plan path');
  root();
  return abs;
};
const hashFile = abs => {
  let st;
  try { st = fs.lstatSync(abs); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  if (!st.isFile() || st.isSymbolicLink()) throw Error('not a regular file: ' + rel(abs));
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(abs, 'r');
  const buf = Buffer.allocUnsafe(1024 * 1024);
  try { let n; while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n)); } finally { fs.closeSync(fd); }
  const after = fs.statSync(abs);
  if (st.size !== after.size || st.mtimeMs !== after.mtimeMs || st.ino !== after.ino || st.mode !== after.mode) throw Error('file changed during hash: ' + rel(abs));
  return 'sha256:' + h.digest('hex');
};
const mkdir = abs => { if (fs.existsSync(abs)) { if (!fs.statSync(abs).isDirectory()) throw Error('parent is not directory'); return; } mkdir(path.dirname(abs)); fs.mkdirSync(abs); };
const gitRead = argv => cp.spawnSync('git', argv, { cwd, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
const metadata = () => {
  const top = gitRead(['rev-parse', '--show-toplevel']);
  if (top.error && fs.existsSync(path.join(cwd, '.git'))) throw top.error;
  if (top.status !== 0) {
    if (fs.existsSync(path.join(cwd, '.git'))) throw Error('Git metadata is present but unreadable');
    return { kind: 'filesystem', head: null, branch: null, stash: null };
  }
  if (lower(fs.realpathSync.native(top.stdout.trim())) !== lower(cwd)) throw Error('workflow cwd must be the repository root');
  const h = gitRead(['rev-parse', '--verify', 'HEAD']);
  const branch = gitRead(['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (![0, 1].includes(branch.status)) throw Error('Git branch unreadable');
  if (h.status !== 0) {
    const refs = gitRead(['show-ref']);
    if (h.error || refs.error || refs.status !== 1 || refs.stdout.trim() || branch.status !== 0 || !branch.stdout.trim()) throw Error('Git HEAD unreadable, not a verified unborn repository');
    return { kind: 'git', head: null, branch: branch.stdout.trim(), stash: null };
  }
  const stash = gitRead(['stash', 'list', '--format=%H']);
  if (stash.error || stash.status !== 0) throw Error('Git stash unreadable');
  return { kind: 'git', head: h.stdout.trim(), branch: branch.status === 0 ? branch.stdout.trim() : null, stash: stash.stdout.trim() ? digest(stash.stdout).slice(7) : null };
};
const snapshot = () => {
  root();
  const scopes = p.scopes;
  const exclude = p.exclude;
  if (!Array.isArray(scopes) || !scopes.length || !Array.isArray(exclude) || !(p.inspectOwned === true ? scopes.length === 1 && scopes[0] === p.ioRoot && exclude.includes(p.ioRoot + '/io') : exclude.includes(p.ioRoot))) throw Error('snapshot requires explicit scopes and exact IO exclusion');
  for (const scope of scopes) if (scope !== '.') safe(scope);
  for (const item of exclude) safe(item);
  const before = metadata();
  const files = [];
  const walk = abs => {
    const relative = rel(abs);
    if (relative && inside(relative, exclude)) return;
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink()) throw Error('snapshot refuses symlinks/reparse points: ' + relative);
    if (!bounded(fs.realpathSync.native(abs))) throw Error('snapshot path escapes workspace');
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(abs).sort()) {
        if (name.toLowerCase() === '.git') continue;
        const candidate = relative ? relative + '/' + name : name;
        if (inside(candidate, scopes) || scopes.some(scope => scope !== '.' && scope.toLowerCase().startsWith(candidate.toLowerCase() + '/'))) walk(path.join(abs, name));
      }
    } else if (st.isFile() && inside(relative, scopes)) {
      safe(relative);
      if (files.length >= 120000) throw Error('snapshot exceeds 120000 files; no partial baseline accepted');
      files.push({ path: relative, hash: hashFile(abs), mode: st.mode & 0o7777 });
    } else if (!st.isFile()) throw Error('snapshot contains unsupported special file');
  };
  walk(cwd);
  const after = metadata();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('Git changed during snapshot');
  const text = JSON.stringify({ ...before, files: files.sort((a,b) => a.path.localeCompare(b.path)), scopes }) + '\n';
  if (Buffer.byteLength(text) > 32 * 1024 * 1024) throw Error('snapshot exceeds 32 MiB; no partial baseline accepted');
  if (p.readOnlySnapshot === true) return { snapshot: { ...before, files: files.sort((a,b) => a.path.localeCompare(b.path)), scopes } };
  const hash = digest(text);
  const targetPath = p.ioRoot + '/io/snapshot-' + hash.slice(7) + '.json';
  const target = writable(targetPath);
  mkdir(path.dirname(target));
  const existing = hashFile(target);
  if (existing !== null && existing !== hash) throw Error('immutable snapshot target already differs');
  if (existing === null) fs.writeFileSync(target, text, { flag: 'wx' });
  return { path: targetPath, hash, bytes: Buffer.byteLength(text) };
};
let result;
try {
  if (op === 'hash') result = { hash: hashFile(safe(p.path)) };
  else if (op === 'hashes') {
    if (!Array.isArray(p.paths) || p.paths.length > 64) throw Error('hash batch must contain at most 64 paths');
    result = Object.fromEntries(p.paths.map(raw => [raw, hashFile(safe(raw))]));
  }
  else if (op === 'text') {
    const abs = safe(p.path);
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > 32 * 1024 * 1024) throw Error('text must be a regular file no larger than 32 MiB');
    if (st.size > 1024 * 1024) result = { chunked: true, bytes: st.size, hash: hashFile(abs) };
    else {
      const content = fs.readFileSync(abs);
      const hash = digest(content);
      if (hashFile(abs) !== hash) throw Error('text changed during read');
      const text = content.toString('utf8');
      if (digest(Buffer.from(text)) !== hash) throw Error('text is not valid UTF-8');
      result = { chunked: false, text, hash };
    }
  }
  else if (op === 'meta') {
    const abs = safe(p.path);
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > 32 * 1024 * 1024) throw Error('text must be a regular file no larger than 32 MiB');
    result = { bytes: st.size, hash: hashFile(abs) };
  } else if (op === 'read') {
    const abs = safe(p.path);
    if (hashFile(abs) !== p.expectedHash) throw Error('text changed during chunked read');
    const buffer = Buffer.alloc(p.length);
    const fd = fs.openSync(abs, 'r');
    let n;
    try { n = fs.readSync(fd, buffer, 0, p.length, p.offset); } finally { fs.closeSync(fd); }
    result = { data: buffer.subarray(0, n).toString('base64') };
  } else if (op === 'begin') {
    const target = writable(p.path), temp = writable(p.temp);
    if (hashFile(target) !== p.expectedHash) throw Error('target changed before atomic write');
    mkdir(path.dirname(temp));
    const content = Buffer.alloc(0);
    if (hashFile(temp) === null) fs.writeFileSync(temp, content, { flag: 'wx' });
    else if (fs.statSync(temp).size > p.bytes) throw Error('stale oversized temporary write; restore from checkpoint');
    result = { ok: true };
  } else if (op === 'chunk') {
    const abs = writable(p.temp);
    const data = Buffer.from(p.data, 'base64');
    const size = fs.statSync(abs).size;
    if (size > p.offset && size >= p.offset + data.length) {
      const previous = Buffer.alloc(data.length);
      const fd = fs.openSync(abs,'r');
      try { fs.readSync(fd,previous,0,previous.length,p.offset); } finally { fs.closeSync(fd); }
      if (!previous.equals(data)) throw Error('existing write chunk differs');
    } else {
      if (size !== p.offset) throw Error('write chunk offset mismatch');
      fs.appendFileSync(abs, data);
    }
    result = { ok: true };
  } else if (op === 'commit') {
    const target = writable(p.path), temp = writable(p.temp);
    if (hashFile(temp) !== p.outputHash || hashFile(target) !== p.expectedHash) throw Error('atomic write content or target CAS mismatch');
    mkdir(path.dirname(target));
    if (p.expectedHash === null) { fs.linkSync(temp, target); fs.unlinkSync(temp); }
    else { const mode = fs.statSync(target).mode & 0o777; fs.chmodSync(temp, mode); fs.renameSync(temp, target); }
    if (hashFile(target) !== p.outputHash) throw Error('atomic write verification failed');
    result = { ok: true };
  } else if (op === 'snapshot') result = snapshot();
  else if (op === 'index') {
    const meta = metadata();
    if (meta.kind !== 'git') result = { hash: null };
    else {
      const index = gitRead(['rev-parse', '--git-path', 'index']);
      if (index.status !== 0) throw Error('Git index path unavailable');
      const abs = path.resolve(cwd, index.stdout.trim());
      if (!bounded(abs)) throw Error('Git index must remain inside repository');
      const indexHash = hashFile(abs);
      result = { hash: indexHash ?? digest('verified absent Git index') };
    }
  } else if (op === 'dirty') {
    const meta = metadata();
    if (meta.kind !== 'git') result = { paths: [] };
    else {
      const status = gitRead(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
      if (status.error || status.status !== 0) throw Error('Git status unreadable');
      const entries = status.stdout.split('\0');
      const paths = [];
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        if (!entry) continue;
        paths.push(entry.slice(3).replace(/\\/g,'/'));
        if (/R|C/.test(entry.slice(0,2))) { index += 1; if (entries[index]) paths.push(entries[index].replace(/\\/g,'/')); }
      }
      result = { paths: [...new Set(paths)].sort() };
    }
  }
  else if (op === 'decode') result = { text: Buffer.from(p.data, 'base64').toString('utf8') };
  else throw Error('unknown IO operation');
  process.stdout.write(JSON.stringify({ ok: true, result }));
} catch (e) { process.stdout.write(JSON.stringify({ ok: false, error: String(e && e.message || e) })); process.exitCode = 1; }
