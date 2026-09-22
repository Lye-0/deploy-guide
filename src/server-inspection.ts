import type { Entry, Evidence } from './types.ts';
import { parseCode, references, walk, member, qualified, stringValue, resolveReference, type Ast } from './syntax.ts';
export type ServerInspection = { kind: 'static-files' | 'server' | 'unknown' | 'none'; evidence: Evidence[]; issues: string[]; files: Set<string> };
const safeModules = /^(?:node:)?(?:http|https|fs(?:\/promises)?|path|url|os|util|stream|events)$/;

/** Follow a launch entry and inspect HTTP response provenance, independent of names/host. */
export function inspectServer(entry: string, files: Map<string, Entry>): ServerInspection {
  const result: ServerInspection = { kind: 'none', evidence: [], issues: [], files: new Set() };
  let http = false, fileResponse = false, dynamicResponse = false, uncertain = false;
  const paths = new Set(files.keys());
  function inspect(path: string) {
    if (result.files.has(path)) return; result.files.add(path);
    const code = files.get(path)?.text;
    if (code === undefined) { uncertain = true; result.issues.push(`${path}の内容が未読です。`); return; }
    const ast = parseCode(code);
    if (!ast) { uncertain = true; result.issues.push(`${path}の構文に未対応です。`); return; }
    const refs = references(ast);
    if (refs.dynamic) uncertain = true;
    for (const spec of refs.imports) {
      if (spec.startsWith('.')) { const target = resolveReference(spec, path, paths); if (target) inspect(target); else uncertain = true; }
      else if (!safeModules.test(spec)) uncertain = true;
    }
    const defs = new Map<string, Ast>(), functions = new Map<string, Ast>(), calls: Ast[] = [], responseNames = new Set<string>();
    const duplicate = new Set<string>(), mutated = new Set<string>();
    walk(ast, (node) => {
      if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') { if (defs.has(node.id.name)) duplicate.add(node.id.name); defs.set(node.id.name, node.init); if (/FunctionExpression$/.test(node.init?.type)) functions.set(node.id.name, node.init); }
      if (node.type === 'FunctionDeclaration' && node.id) functions.set(node.id.name, node);
      if (node.type === 'CallExpression') calls.push(node);
      if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') { const target = member(node.left ?? node.argument).split('.')[0]; if (target) mutated.add(target); }
    });
    for (const call of calls) {
      const name = qualified(call.callee, refs.bindings);
      if (/^(http|https)\.createServer$/.test(name)) {
        http = true;
        let fn = call.arguments.at(-1); if (fn?.type === 'Identifier') fn = functions.get(fn.name);
        if (fn?.params?.[1]?.type === 'Identifier') responseNames.add(fn.params[1].name); else uncertain = true;
      }
      if (/^(fetch|eval|Function)$|^(http|https)\.(get|request)$|^child_process\.|^fs(?:\/promises)?\.(write|append|unlink|rm|mkdir|rename)|\.upgrade$/.test(name)) uncertain = true;
      if (/\.(json|send|render)$/.test(name)) { dynamicResponse = true; http = true; }
    }
    function fileValue(node: Ast, seen = new Set<string>()): boolean {
      if (!node) return false;
      if (node.type === 'AwaitExpression') return fileValue(node.argument, seen);
      if (node.type === 'Identifier') {
        if (seen.has(node.name) || duplicate.has(node.name) || mutated.has(node.name)) return false;
        seen.add(node.name); return fileValue(defs.get(node.name), seen);
      }
      if (node.type === 'CallExpression') return /^fs(?:\/promises)?\.(readFile|readFileSync|createReadStream)$/.test(qualified(node.callee, refs.bindings));
      if (node.type === 'ConditionalExpression') return [node.consequent, node.alternate].every(n => empty(n) || fileValue(n, new Set(seen)));
      return false;
    }
    for (const call of calls) {
      const callee = member(call.callee);
      if (!responseNames.has(callee.split('.')[0]) && call.arguments.some((arg: Ast) => fileValue(arg))) uncertain = true;
    }
    walk(ast, node => {
      if (/Function/.test(node.type)) for (const param of node.params ?? []) if (param.type === 'Identifier' && refs.bindings.has(param.name)) uncertain = true;
    });
    function empty(node: Ast): boolean { return !node || node.type === 'Identifier' && node.name === 'undefined' || node.type === 'Literal' && node.value === null; }
    function errorStatus(node: Ast, depth = 0): boolean {
      if (depth > 20) return false;
      return node?.type === 'Literal' && typeof node.value === 'number' && node.value >= 300 || node?.type === 'ConditionalExpression' && errorStatus(node.consequent, depth + 1) && errorStatus(node.alternate, depth + 1) || node?.type === 'Identifier' && errorStatus(defs.get(node.name), depth + 1);
    }
    function errorBlock(parents: Ast[]): boolean {
      const block = [...parents].reverse().find(n => n.type === 'BlockStatement');
      return !!block?.body?.some((s: Ast) => s.type === 'ExpressionStatement' && s.expression.type === 'CallExpression' && /\.writeHead$/.test(member(s.expression.callee)) && errorStatus(s.expression.arguments[0]));
    }
    function helperError(node: Ast, parents: Ast[]): boolean {
      const fn = [...parents].reverse().find(n => /Function/.test(n.type));
      if (!fn) return false;
      const name = [...functions].find(([, v]) => v === fn)?.[0];
      if (!name) return false;
      const sites = calls.filter(c => member(c.callee) === name);
      return sites.length > 0 && sites.every(c => errorStatus(c.arguments[0]));
    }
    walk(ast, (node, parents) => {
      if (node.type === 'MemberExpression' && /\.(headers|cookies|body|session)$/.test(member(node))) uncertain = true;
      if (node.type !== 'CallExpression') return;
      const callee = node.callee;
      if (callee.type === 'MemberExpression' && member(callee.property) === 'pipe' && responseNames.has(member(node.arguments[0]))) {
        if (fileValue(callee.object)) fileResponse = true; else uncertain = true;
      }
      if (callee.type !== 'MemberExpression' || !responseNames.has(member(callee.object))) return;
      const method = callee.computed ? stringValue(callee.property) : callee.property.name;
      if (!['end', 'write', 'json', 'send', 'render'].includes(method)) return;
      if (['json', 'send', 'render'].includes(method)) { dynamicResponse = true; return; }
      const body = node.arguments[0];
      if (empty(body)) return;
      if (fileValue(body)) { fileResponse = true; return; }
      if (errorBlock(parents) || helperError(body, parents)) return;
      dynamicResponse = true;
    });
    if (responseNames.size) result.evidence.push({ label: `HTTP応答のデータ元を構文解析`, path });
  }
  inspect(entry);
  result.kind = dynamicResponse ? 'server' : uncertain ? 'unknown' : http && fileResponse ? 'static-files' : http ? 'unknown' : 'none';
  result.evidence.push({ label: result.kind === 'static-files' ? 'HTTPの成功応答は既存ファイルの配信と確認' : result.kind === 'server' ? 'ファイル配信以外のHTTP応答を検出' : '起動処理の役割は要確認', path: entry });
  return result;
}
