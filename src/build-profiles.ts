import type { Entry } from './types.ts';
import { parseCode, stringValue, type Ast } from './syntax.ts';

export type BuildProfile = { script: string; mode: string; output?: string; issue?: string };
const unknown = Symbol('unknown');
type Value = string | boolean | number | null | typeof unknown;
// Deliberately finite: resolve configuration data, never call project functions/plugins.
export function viteProfile(text: string, mode: string): string | undefined {
  const ast = parseCode(text); if (!ast) return undefined;
  if (ast.body.some((n: Ast) => n.type === 'ExpressionStatement' && n.expression.type !== 'Literal')) return undefined;
  const constants = new Map<string, Ast>();
  for (const n of ast.body) if (n.type === 'VariableDeclaration' && n.kind === 'const')
    for (const d of n.declarations) if (d.id.type === 'Identifier') constants.set(d.id.name, d.init);
  const env = new Map<string, Value>();
  const objects = new Set<string>();
  function unwrap(n: Ast, seen = new Set<string>()): Ast {
    while (n?.type === 'Identifier' && constants.has(n.name)) {
      if (seen.has(n.name) || seen.size > 32) return null;
      seen.add(n.name); n = constants.get(n.name);
    }
    return n;
  }
  function value(n: Ast, depth = 0): Value {
    if (!n || depth > 32) return unknown;
    if (n.type === 'Identifier' && env.has(n.name)) return env.get(n.name)!;
    n = unwrap(n); if (!n) return unknown;
    if (n.type === 'Literal') return n.value;
    if (n.type === 'MemberExpression' && objects.has(n.object?.name)) {
      const key = n.computed ? stringValue(n.property) : n.property.name;
      return key === 'mode' ? mode : key === 'command' ? 'build' : unknown;
    }
    if (n.type === 'ConditionalExpression') {
      const c = value(n.test, depth + 1);
      return c === unknown ? unknown : value(c ? n.consequent : n.alternate, depth + 1);
    }
    if (n.type === 'BinaryExpression') {
      const a = value(n.left, depth + 1), b = value(n.right, depth + 1);
      if (a === unknown || b === unknown) return unknown;
      if (n.operator === '===') return a === b;
      if (n.operator === '!==') return a !== b;
      if (n.operator === '+' && typeof a === 'string' && typeof b === 'string') return a + b;
    }
    return unknown;
  }
  function property(n: Ast, name: string): Ast | undefined {
    n = unwrap(n);
    if (n?.type !== 'ObjectExpression' || n.properties.some((p: Ast) => p.type !== 'Property' || p.computed)) throw Error('opaque object');
    const props = n.properties.filter((p: Ast) => (p.key.name ?? p.key.value) === name);
    if (props.length > 1 || props[0]?.method || props[0]?.kind === 'get') throw Error('ambiguous property');
    return props[0]?.value;
  }
  try {
    let n = unwrap(ast.body.find((n: Ast) => n.type === 'ExportDefaultDeclaration')?.declaration);
    if (n?.type === 'CallExpression' && n.callee?.name === 'defineConfig' && n.arguments.length === 1) n = unwrap(n.arguments[0]);
    if (['ArrowFunctionExpression', 'FunctionExpression'].includes(n?.type)) {
      if (n.async || n.params.length > 1) return undefined;
      const p = n.params[0];
      if (p?.type === 'Identifier') objects.add(p.name);
      else if (p?.type === 'ObjectPattern') for (const item of p.properties) {
        if (item.type !== 'Property' || item.computed || item.value.type !== 'Identifier') return undefined;
        env.set(item.value.name, item.key.name === 'mode' ? mode : item.key.name === 'command' ? 'build' : unknown);
      }
      n = n.body;
      if (n.type === 'BlockStatement') {
        if (n.body.some((s: Ast) => !['VariableDeclaration', 'ReturnStatement'].includes(s.type))) return undefined;
        for (const s of n.body) if (s.type === 'VariableDeclaration') {
          if (s.kind !== 'const') return undefined;
          for (const d of s.declarations) if (d.id.type === 'Identifier') constants.set(d.id.name, d.init); else return undefined;
        }
        const returns = n.body.filter((s: Ast) => s.type === 'ReturnStatement');
        if (returns.length !== 1) return undefined;
        n = returns[0].argument;
      }
    }
    if (property(n, 'root')) return undefined;
    const build = property(n, 'build');
    if (!build) return 'dist';
    const out = property(build, 'outDir');
    if (!out) return 'dist';
    const result = value(out);
    return typeof result === 'string' ? result : undefined;
  } catch { return undefined; }
}

export function buildProfiles(entries: Entry[]): BuildProfile[] {
  const configs = entries.filter(e => /^vite\.config\.[cm]?[jt]s$/.test(e.path));
  if (configs.length > 1) return [{script:'build',mode:'?',issue:'複数のVite設定があります'}];
  const config = configs[0];
  if (!config && !entries.some(e => e.path === 'package.json' && /"vite"|vite build/.test(e.text ?? ''))) return [];
  const configText = config ? config.text : 'export default {}';
  let scripts: Record<string, unknown>;
  try { scripts = JSON.parse(entries.find(e => e.path === 'package.json')?.text ?? '{}').scripts ?? {}; }
  catch { return [{ script: 'build', mode: '?', issue: 'package.jsonが未確認です' }]; }
  const profiles: BuildProfile[] = [];
  function command(text: string, script: string, seen = new Set<string>()) {
    if (seen.size > 16 || seen.has(script)) { profiles.push({script,mode:'?',issue:'スクリプト参照が循環しています'}); return; }
    seen = new Set([...seen, script]);
    if (/\bcd\s/.test(text)) { profiles.push({script,mode:'?',issue:'作業ディレクトリを変更するコマンドは未対応です'}); return; }
    for (const segment of text.split(/&&|;/)) {
      const tokens = segment.trim().match(/"[^"]*"|'[^']*'|\S+/g)?.map(t => t.replace(/^['"]|['"]$/g, '')) ?? [];
      if (/^(?:npx|pnpm|npm|yarn)$/.test(tokens[0] ?? '')) {
        tokens.shift(); if (['exec', 'run'].includes(tokens[0])) tokens.shift();
        if (typeof scripts[tokens[0]] === 'string') {
          if (tokens.length === 1) command(scripts[tokens[0]] as string, tokens[0], seen);
          else profiles.push({script,mode:'?',issue:'スクリプトへの引数転送は未対応です'});
          continue;
        }
      }
      if (tokens[0] !== 'vite' || tokens[1] !== 'build') {
        if (/\bvite\s+build\b/.test(segment)) profiles.push({script,mode:'?',issue:'コマンドのラッパーまたは条件に未対応です'});
        continue;
      }
      let mode = 'production', override: string | undefined, invalid = false;
      for (let i = 2; i < tokens.length; i++) {
        const [flag, inline] = tokens[i].split('=');
        if (['--mode', '-m', '--outDir'].includes(flag)) {
          const v = inline ?? tokens[++i];
          if (!v || /[$`]|^--/.test(v)) { invalid = true; break; }
          if (flag === '--outDir') override = v; else mode = v;
        } else { invalid = true; break; }
      }
      const configured = configText === undefined ? undefined : viteProfile(configText, mode);
      const output = !invalid && configured !== undefined ? override ?? configured : undefined;
      profiles.push({script,mode,output:output || undefined,issue:output ? undefined : '設定・コマンドに未対応または動的な指定があります'});
    }
  }
  for (const [name, cmd] of Object.entries(scripts)) if (typeof cmd === 'string') command(cmd, name);
  if (!profiles.length && typeof scripts.build === 'string') profiles.push({script:'build',mode:'?',issue:'ビルドコマンドの実行経路を確認できません'});
  if (!profiles.length) profiles.push({script:'vite build（既定）',mode:'production',output:configText === undefined ? undefined : viteProfile(configText,'production')});
  return [...new Map(profiles.map(p => [p.script + ':' + p.mode + ':' + p.output, p])).values()];
}
