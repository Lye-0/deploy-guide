import type { Entry } from './types.ts';
import { resolveReference, parseCode, walk, stringValue, member, type Ast } from './syntax.ts';
export const BUILD_ASSET = '@@VITE_ASSET@@';
export function declaredPackage(spec: string, entries: Entry[]): boolean {
  const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
  try {
    const pkg = JSON.parse(entries.find(e => e.path === 'package.json')?.text ?? '{}');
    return Object.hasOwn(pkg.dependencies ?? {}, name) || Object.hasOwn(pkg.devDependencies ?? {}, name);
  } catch { return false; }
}
// Vite's explicit ?url import exports an asset URL, not a server endpoint.
// Package contents are outside the scan; their installation remains a build prerequisite.
export function buildAssetUrl(spec: string, from: string, entries: Entry[], bundled: boolean): string | null {
  if (!bundled || !/\.(?:wasm|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|mp[34]|webm|ogg|wav|pdf)\?url$/.test(spec)) return null;
  const paths = new Set(entries.map(e => e.path));
  const target = resolveReference(spec, from, paths, true);
  if (target) return BUILD_ASSET + target;
  if (!/^(?:[./]|[@~]\/|[a-z]+:)/i.test(spec) && declaredPackage(spec, entries)) return BUILD_ASSET + spec;
  return null;
}

// Resolve only immutable, unshadowed module bindings. This bounded path does not
// depend on interpreting every function in a large application.
export function traceBuildAssetFetches(entries: Entry[], reachable: Set<string>, bundled: boolean): Map<string, string> {
  const result = new Map<string, string>();
  if (!bundled) return result;
  const paths = new Set(entries.map(e => e.path));
  const modules = new Map<string, { ast: Ast; bindings: Map<string, Ast>; exports: Map<string, string>; counts: Map<string, number> }>();
  function names(n: Ast, add: (name: string) => void) {
    if (!n) return;
    if (n.type === 'Identifier') add(n.name);
    else if (n.type === 'ObjectPattern') n.properties.forEach((p: Ast) => names(p.value ?? p.argument, add));
    else if (n.type === 'ArrayPattern') n.elements.forEach((p: Ast) => names(p, add));
    else if (n.type === 'AssignmentPattern') names(n.left, add);
    else if (n.type === 'RestElement') names(n.argument, add);
  }
  for (const e of entries) {
    if (!reachable.has(e.path) || !e.text || !/\.[cm]?[jt]sx?$/.test(e.path)) continue;
    const ast = parseCode(e.text); if (!ast) continue;
    const bindings = new Map<string, Ast>(), exports = new Map<string, string>(), counts = new Map<string, number>();
    const count = (name: string) => counts.set(name, (counts.get(name) ?? 0) + 1);
    walk(ast, n => {
      if (n.type === 'VariableDeclarator') names(n.id, count);
      if (/Function/.test(n.type) || n.type === 'ArrowFunctionExpression') { names(n.id, count); n.params?.forEach((p: Ast) => names(p, count)); }
      if (n.type === 'CatchClause') names(n.param, count);
      if (n.type === 'ClassDeclaration') names(n.id, count);
      if (/^Import.*Specifier$/.test(n.type)) names(n.local, count);
      if (n.type === 'AssignmentExpression') names(n.left, count);
      if (n.type === 'UpdateExpression') names(n.argument, count);
    });
    for (const n of ast.body) {
      if (n.type === 'ImportDeclaration' && n.importKind !== 'type') for (const spec of n.specifiers) {
        if (spec.importKind !== 'type') bindings.set(spec.local.name, { ...spec, source: stringValue(n.source) });
      }
      const d = n.type === 'ExportNamedDeclaration' ? n.declaration : n;
      if (d?.type === 'VariableDeclaration' && d.kind === 'const') for (const v of d.declarations) {
        if (v.id.type !== 'Identifier') continue;
        bindings.set(v.id.name, v.init);
        if (n.type === 'ExportNamedDeclaration') exports.set(v.id.name, v.id.name);
      }
      if (n.type === 'ExportNamedDeclaration' && !n.source && n.exportKind !== 'type') for (const spec of n.specifiers) exports.set(spec.exported.name, spec.local.name);
    }
    modules.set(e.path, { ast, bindings, exports, counts });
  }
  function resolve(path: string, name: string, seen = new Set<string>()): string | null {
    const key = path + ':' + name, m = modules.get(path);
    if (seen.has(key) || seen.size >= 64 || !m || m.counts.get(name) !== 1) return null;
    seen.add(key);
    let n = m.bindings.get(name);
    while (n && ['TSNonNullExpression', 'TSAsExpression', 'TSSatisfiesExpression'].includes(n.type)) n = n.expression;
    if (n?.type === 'Identifier') return resolve(path, n.name, seen);
    if (n?.type === 'ImportDefaultSpecifier' && n.source) return buildAssetUrl(n.source, path, entries, true);
    if (n?.type === 'ImportSpecifier' && n.source) {
      const target = resolveReference(n.source, path, paths, true);
      const local = target && modules.get(target)?.exports.get(n.imported.name ?? n.imported.value);
      if (target && local) return resolve(target, local, seen);
    }
    return null;
  }
  for (const [path, m] of modules) walk(m.ast, n => {
    if (n.type !== 'CallExpression' || member(n.callee) !== 'fetch' || m.counts.has('fetch') || n.arguments[0]?.type !== 'Identifier') return;
    const asset = resolve(path, n.arguments[0].name);
    if (asset) result.set(path + ':' + n.start, asset);
  });
  return result;
}
