'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');

// Non-public compiler bindings are supported only for this reviewed bundle.
const SUPPORTED_BUNDLE_HASH = '395307aba9b59ba6a099f4941b073ec7a8b53fe4154e4e75af65b3703d2e6d36';
const bundlePath = path.resolve(process.env.ZCODE_HOST_BUNDLE || 'C:/AI/ZCode/resources/glm/zcode.cjs');
const parserPath = process.env.ZCODE_TYPESCRIPT || 'typescript';
const root = path.resolve(__dirname, '..');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const failure = error => ({ name: String(error?.name || 'Error'), message: String(error?.message || error) });

function extractCompiler(source, ts) {
  const filename = 'official-host-bundle.cjs';
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (file.parseDiagnostics.length) throw Error(`bundle AST parse failed: ${file.parseDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('; ')}`);
  // The external TypeScript is used only to resolve AST bindings, never to check workflows.
  const host = {
    getSourceFile: name => name === filename ? file : undefined,
    getDefaultLibFileName: () => '',
    getCurrentDirectory: () => '',
    getCanonicalFileName: name => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: name => name === filename,
    readFile: name => name === filename ? source : undefined,
    writeFile() { throw Error('AST extraction may not emit files'); }
  };
  const checker = ts.createProgram([filename], { allowJs: true, noLib: true, noResolve: true, noEmit: true }, host).getTypeChecker();
  const declarations = new Map();
  const symbols = new Map();
  for (const statement of file.statements) {
    const nodes = ts.isVariableStatement(statement) ? statement.declarationList.declarations : [statement];
    for (const node of nodes) {
      if (!(ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) || !node.name || !ts.isIdentifier(node.name)) continue;
      const name = node.name.text;
      if (declarations.has(name)) throw Error(`duplicate top-level declaration: ${name}`);
      const entry = { name, node };
      declarations.set(name, entry);
      const symbol = checker.getSymbolAtLocation(node.name);
      if (!symbol) throw Error(`unbound top-level declaration: ${name}`);
      symbols.set(symbol, entry);
    }
  }
  const resolve = node => ts.isShorthandPropertyAssignment(node.parent)
    ? checker.getShorthandAssignmentValueSymbol(node.parent)
    : checker.getSymbolAtLocation(node);
  const isReference = node => {
    const parent = node.parent;
    if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
    if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent) || ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent) || ts.isPropertySignature(parent) || ts.isMethodSignature(parent)) && parent.name === node) return false;
    if (ts.isBindingElement(parent) && parent.propertyName === node) return false;
    if (ts.isLabeledStatement(parent) && parent.label === node) return false;
    return !ts.isBreakStatement(parent) && !ts.isContinueStatement(parent);
  };
  const assignments = new Map();
  for (const entry of declarations.values()) {
    const walk = node => {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) {
        const target = symbols.get(resolve(node.left));
        if (target && target !== entry) {
          const values = assignments.get(target.name) || [];
          values.push(node.right);
          assignments.set(target.name, values);
        }
      }
      ts.forEachChild(node, walk);
    };
    walk(entry.node);
  }
  const selected = new Map();
  const select = name => {
    if (selected.has(name)) return;
    if (['o0', 'Qet', 'UPc'].includes(name)) throw Error(`unsafe aggregate/startup dependency: ${name}`);
    const entry = declarations.get(name);
    if (!entry) throw Error(`missing compiler declaration: ${name}`);
    let expression = ts.isVariableDeclaration(entry.node) ? entry.node.initializer : entry.node;
    const hoisted = !expression;
    if (hoisted) {
      const values = assignments.get(name) || [];
      if (values.length !== 1) throw Error(`cannot safely initialize ${name}: ${values.length} assignment definitions`);
      expression = values[0];
    }
    selected.set(name, { ...entry, expression });
    if (name === 'hhi') {
      if (!ts.isCallExpression(expression) || !ts.isIdentifier(expression.expression) || expression.expression.text !== 'require' || expression.arguments.length !== 1 || !ts.isStringLiteral(expression.arguments[0]) || expression.arguments[0].text !== 'node:crypto') throw Error('unrecognized compiler crypto dependency');
      return;
    }
    const walk = node => {
      if (ts.isIdentifier(node) && isReference(node)) {
        const symbol = resolve(node);
        const dependency = symbols.get(symbol);
        if (dependency && dependency !== entry) select(dependency.name);
        else if (hoisted && symbol?.declarations?.some(d => d.getStart(file) < expression.getStart(file) || d.end > expression.end)) throw Error(`initializer for ${name} captures an outer binding: ${node.text}`);
      }
      ts.forEachChild(node, walk);
    };
    walk(expression);
  };
  for (const name of ['v8e', 'nS', 'tL', 'Xw', 'v2n', 'U5e']) select(name);
  const entries = [...selected.values()].filter(e => e.name !== 'hhi').sort((a, b) => a.expression.getStart(file) - b.expression.getStart(file));
  const functions = entries.filter(e => ts.isFunctionDeclaration(e.node));
  const variables = entries.filter(e => ts.isVariableDeclaration(e.node));
  return {
    count: selected.size,
    needsCrypto: selected.has('hhi'),
    code: functions.map(e => e.node.getText(file)).join('\n') + '\nvar ' + variables.map(e => e.name).join(',') + ';\n' + variables.map(e => `${e.name}=(${e.expression.getText(file)});`).join('\n')
  };
}

function loadCompiler(extracted) {
  const sandbox = Object.create(null);
  if (extracted.needsCrypto) {
    const digest = text => {
      if (typeof text !== 'string') throw Error('compiler digest requires text');
      return sha256(text);
    };
    Object.setPrototypeOf(digest, null);
    sandbox.__sha256 = Object.freeze(digest);
  }
  const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  if (extracted.needsCrypto) vm.runInContext(`
    var hhi = Object.freeze({ createHash(algorithm) {
      if (algorithm !== 'sha256') throw Error('only SHA-256 is available');
      let text = '';
      return Object.freeze({
        update(value, encoding) {
          if (typeof value !== 'string' || encoding !== 'utf8') throw Error('only UTF-8 text is accepted');
          text += value;
          return this;
        },
        digest(encoding) {
          if (encoding !== 'hex') throw Error('only hex digests are available');
          return __sha256(text);
        }
      });
    } });
  `, context, { timeout: 5000 });
  new vm.Script(extracted.code, { filename: 'official-host-compile-extract.cjs' }).runInContext(context, { timeout: 120000 });
  const audit = JSON.parse(vm.runInContext('JSON.stringify({ typescriptVersion: Bp().version, systemHostUnavailable: Bp().sys === undefined, process: typeof process, require: typeof require, module: typeof module })', context, { timeout: 5000 }));
  if (audit.typescriptVersion !== '5.9.3' || !audit.systemHostUnavailable || ['process', 'require', 'module'].some(key => audit[key] !== 'undefined')) throw Error(`unsafe or incompatible compiler VM: ${JSON.stringify(audit)}`);
  return { context, audit };
}

const compileOnly = new vm.Script(`(() => {
  const result = { ok: false, stage: 'analyzer', diagnostics: [], schemaCount: null };
  __compilerStage = 'analyzer';
  try {
    const analysis = v8e(__workflowBody);
    result.diagnostics = analysis.diagnostics.map(d => ({ ...d, stage: 'analyzer' }));
    if (!analysis.ok) return JSON.stringify(result);
    const program = nS(__workflowBody);
    result.stage = 'typescript';
    __compilerStage = 'typescript';
    const diagnostics = tL(program.program);
    if (diagnostics.length) {
      result.diagnostics.push(...diagnostics.map(d => ({ ...d, stage: 'typescript' })));
      return JSON.stringify(result);
    }
    const sites = Xw(program);
    result.askCount = sites.asks.length;
    result.reportCount = sites.reports.length;
    result.stage = 'schema';
    __compilerStage = 'schema';
    const schema = v2n(program, sites);
    result.schemaCount = Object.keys(schema.schemas).length;
    result.diagnostics.push(...schema.diagnostics.map(d => ({ ...d, stage: 'schema' })));
    if (schema.diagnostics.length) return JSON.stringify(result);
    result.stage = 'compile';
    __compilerStage = 'compile';
    const compiled = U5e(__workflowBody, program, sites);
    if (typeof compiled.lowered !== 'string' || !compiled.lowered.trim()) throw Error('compiler returned no lowered artifact');
    if (compiled.askSpecs.size !== sites.asks.length) throw Error('compiled ask count differs from collected sites');
    result.typedAskCount = [...compiled.askSpecs.values()].filter(spec => spec.typed).length;
    if (result.typedAskCount !== result.schemaCount) throw Error('compiled schema count differs from synthesized schemas');
    result.compiledScriptHash = compiled.scriptHash;
    result.holeCount = compiled.holes.length;
    result.phaseNames = compiled.phases.phaseNames;
    result.lowered = compiled.lowered;
    result.holeBodies = compiled.holeBodies;
    result.ok = true;
    result.stage = 'compiled';
    return JSON.stringify(result);
  } catch (error) {
    result.error = { name: String(error?.name || 'Error'), message: String(error?.message || error) };
    return JSON.stringify(result);
  }
})()`, { filename: 'compile-only-driver.cjs' });

function checkBody(context, body) {
  const bodyHash = sha256(body);
  context.__workflowBody = body;
  let result;
  try {
    result = JSON.parse(compileOnly.runInContext(context, { timeout: 120000 }));
    if (result.ok) {
      result.stage = 'artifact-syntax';
      if (result.compiledScriptHash !== bodyHash) throw Error('compiled script hash differs from the checked body');
      // Constructors parse the emitted artifacts; these Script objects are never executed.
      new vm.Script(`async function __compileOnlyArtifact__() {\n${result.lowered}\n}`, { filename: 'lowered-workflow.syntax-only.cjs' });
      for (const [id, code] of Object.entries(result.holeBodies)) {
        if (typeof code !== 'string') throw Error(`invalid compiled hole body: ${id}`);
        new vm.Script(`(${code})`, { filename: 'lowered-hole.syntax-only.cjs' });
      }
      result.loweredBytes = Buffer.byteLength(result.lowered, 'utf8');
      result.stage = 'compiled';
    }
  } catch (error) {
    result = { ...result, ok: false, stage: result?.stage || context.__compilerStage || 'vm', diagnostics: result?.diagnostics || [], schemaCount: result?.schemaCount ?? null, error: failure(error) };
  } finally {
    delete context.__workflowBody;
    delete context.__compilerStage;
  }
  delete result.lowered;
  delete result.holeBodies;
  return { ...result, bodyHash, exitCode: result.ok ? 0 : result.error ? 2 : 1 };
}

function checkFile(context, file) {
  const result = { file, ok: false, stage: 'read', sourceHash: null, schemaCount: null, diagnostics: [] };
  try {
    const bytes = fs.readFileSync(file);
    result.sourceHash = sha256(bytes);
    const source = bytes.toString('utf8');
    if (!Buffer.from(source, 'utf8').equals(bytes)) throw Error('workflow source is not intact UTF-8');
    const prefix = source.match(/^(?:\uFEFF)?\/\* zcode-workflow[\s\S]*?\*\//)?.[0] || (source.startsWith('\uFEFF') ? '\uFEFF' : '');
    const prefixLines = prefix.split(/\r\n|\r|\n/);
    const checked = checkBody(context, source.slice(prefix.length));
    Object.assign(result, checked);
    result.diagnostics = checked.diagnostics.map(d => ({ ...d, sourceLine: d.line + prefixLines.length - 1, sourceColumn: d.column + (d.line === 1 ? prefixLines[prefixLines.length - 1].length : 0) }));
    result.currentSourceHash = sha256(fs.readFileSync(file));
    result.sourceChangedDuringCheck = result.currentSourceHash !== result.sourceHash;
    if (result.sourceChangedDuringCheck) { result.ok = false; result.exitCode = 1; }
  } catch (error) {
    result.ok = false;
    result.error = failure(error);
    result.exitCode = 2;
  }
  return result;
}

const report = {
  mode: 'compile-only',
  apiLimitation: '非公开编译 API，仅支持已复核 bundle SHA-256 和内置 TypeScript 5.9.3；升级后需重新复核。',
  bundle: { file: bundlePath, supportedHash: SUPPORTED_BUNDLE_HASH },
  selfTests: [],
  files: [],
  exitCode: 2
};
try {
  const bundle = fs.readFileSync(bundlePath);
  report.bundle.hash = sha256(bundle);
  if (report.bundle.hash !== SUPPORTED_BUNDLE_HASH) throw Error('unsupported official bundle hash; no bundle code was evaluated');
  report.astParser = { file: require.resolve(parserPath) };
  const ts = require(report.astParser.file);
  report.astParser.version = ts.version;
  const extracted = extractCompiler(bundle.toString('utf8'), ts);
  report.bundle.declarationCount = extracted.count;
  const { context, audit } = loadCompiler(extracted);
  report.vm = audit;
  const validBody = 'interface CheckResult { ok: boolean }\nphase("编译自检");\nconst result = await agent("只编译自检").ask<CheckResult>("Compile only; never run this workflow.");\nreturn result;';
  const invalidBody = validBody.replace('{ ok: boolean }', '{ callback: () => string }');
  const valid = checkBody(context, validBody);
  const invalid = checkBody(context, invalidBody);
  report.selfTests.push({ name: 'legal-workflow', passed: valid.ok && valid.schemaCount === 1, ...valid });
  report.selfTests.push({ name: 'schema-illegal-workflow', passed: !invalid.ok && invalid.stage === 'schema' && invalid.schemaCount === 0 && invalid.diagnostics.length === 1 && invalid.diagnostics[0].code === 9002 && invalid.diagnostics[0].message.includes('$.callback'), ...invalid });
  if (report.selfTests.some(test => !test.passed)) throw Error('compile-only loader self-test failed; repository workflows were not compiled');
  for (const name of ['task-plan', 'task-run']) report.files.push(checkFile(context, path.join(root, '.zcode', 'workflows', `${name}.dwf.ts`)));
  report.exitCode = Math.max(0, ...report.files.map(file => file.exitCode));
} catch (error) {
  report.failure = failure(error);
}
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
process.exitCode = report.exitCode;
