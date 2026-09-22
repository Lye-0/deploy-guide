import { Parser } from 'acorn';
import tsPlugin from 'acorn-typescript';
// Parser nodes differ slightly for JS, JSX and TypeScript; keep that boundary here.
export type Ast = any;
const TSParser = Parser.extend(tsPlugin() as unknown as Parameters<typeof Parser.extend>[0]);
export function parseCode(code: string): Ast | null {
  for (const parser of [Parser, TSParser]) {
    for (const sourceType of ['module', 'script'] as const) {
      try { return parser.parse(code, { ecmaVersion: 'latest', sourceType, locations: true, allowReturnOutsideFunction: true }); } catch { /* Try the next grammar, never execute. */ }
    }
  }
  return null;
}
export function walk(node: Ast, visit: (node: Ast, parents: Ast[]) => void, parents: Ast[] = []): void {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visit(node, parents);
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'start', 'end'].includes(key)) continue;
    if (Array.isArray(value)) { for (const child of value) if (child?.type) walk(child, visit, [...parents, node]); }
    else if (value && typeof value === 'object' && 'type' in value) walk(value, visit, [...parents, node]);
  }
}
export function stringValue(node: Ast): string | null {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && !node.expressions.length) return node.quasis[0]?.value.cooked ?? null;
  return null;
}
export function member(node: Ast): string {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MetaProperty') return node.meta.name + '.' + node.property.name;
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') return member(node.object) + '.' + (node.computed ? stringValue(node.property) ?? '?' : node.property.name);
  return '';
}
export function resolveReference(spec: string, from: string, paths: Set<string>, bundled = false): string | null {
  let raw = spec;
  if (bundled && /^[@~]\//.test(raw)) raw = '/src/' + raw.slice(2);
  if (!raw.startsWith('.') && !raw.startsWith('/')) return null;
  const parts = raw.startsWith('/') ? [] : from.split('/').slice(0, -1);
  for (const p of raw.split(/[?#]/)[0].split('/')) { if (p === '..') { if (!parts.length) return null; parts.pop(); } else if (p && p !== '.') parts.push(p); }
  const name = parts.join('/');
  for (const candidate of [name, ...['.js', '.mjs', '.ts', '.tsx', '.jsx', '/index.js', '/index.ts', '/index.tsx'].map(s => name + s)]) if (paths.has(candidate)) return candidate;
  return null;
}
export function references(ast: Ast): { imports: string[]; dynamic: boolean; bindings: Map<string, string> } {
  const imports: string[] = [], bindings = new Map<string, string>(); let dynamic = false;
  walk(ast, node => {
    if (node.type === 'ImportDeclaration') {
      if (node.importKind === 'type') return;
      const source = stringValue(node.source); if (!source) return;
      imports.push(source);
      for (const s of node.specifiers) bindings.set(s.local.name, source.replace(/^node:/, '') + (s.type === 'ImportSpecifier' ? '.' + (s.imported.name ?? s.imported.value) : ''));
    }
    if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source && node.exportKind !== 'type') { const s = stringValue(node.source); if (s) imports.push(s); }
    if (node.type === 'ImportExpression') { const s = stringValue(node.source); if (s) imports.push(s); else dynamic = true; }
    if (node.type === 'CallExpression' && member(node.callee) === 'require') { const s = stringValue(node.arguments[0]); if (s) imports.push(s); else dynamic = true; }
    if (node.type === 'VariableDeclarator' && node.init?.type === 'CallExpression' && member(node.init.callee) === 'require') {
      const s = stringValue(node.init.arguments[0]); if (!s) return;
      if (node.id.type === 'Identifier') bindings.set(node.id.name, s.replace(/^node:/, ''));
      if (node.id.type === 'ObjectPattern') for (const p of node.id.properties) if (p.value?.name) bindings.set(p.value.name, s.replace(/^node:/, '') + '.' + p.key.name);
    }
  });
  return { imports, dynamic, bindings };
}
export function qualified(node: Ast, bindings: Map<string, string>): string {
  const name = member(node), [first, ...rest] = name.split('.'); return [bindings.get(first) ?? first, ...rest].join('.');
}
