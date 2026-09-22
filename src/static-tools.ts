import type { Entry } from './types.ts';
import { startEntries } from './runtime-scope.ts';

function onlyNodeImports(code: string, allowed: string[]): boolean {
  const imports = [...code.matchAll(/\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]/g)].map(m => m[1] ?? m[2]);
  return imports.length > 0 && imports.every(name => allowed.includes(name)) && !/\b(?:require|import)\s*\(/.test(code);
}
export function optionalPreview(entries: Entry[], command: unknown): boolean {
  if (typeof command !== 'string' || !/^node\s+\S+\.[cm]?js\s*$/.test(command.trim())) return false;
  const path = [...startEntries({ start: command })][0];
  const code = entries.find(e => e.path === path)?.text;
  return Boolean(code && onlyNodeImports(code, ['node:fs/promises', 'node:path', 'node:url'])
    && /\breadFile\s*\(/.test(code) && /['"]index\.html['"]/.test(code)
    && /\bwriteFile\s*\(/.test(code) && /\.replace\s*\(/.test(code)
    && /\.html['"`]/.test(code) && !/\b(?:exec|spawn|fetch|eval|transform|compile)\s*\(/.test(code));
}
/** Recognize only a narrow, local readFile -> response static preview pattern. */
export function localStaticServers(entries: Entry[], scripts: unknown): Set<string> {
  const result = new Set<string>();
  if (!scripts || typeof scripts !== 'object') return result;
  const s = scripts as Record<string, unknown>;
  if (typeof s.start !== 'string' || s.start !== s.dev) return result;
  for (const path of startEntries(scripts)) {
    const code = entries.find(e => e.path === path)?.text;
    if (!code || !onlyNodeImports(code, ['node:http', 'node:fs/promises', 'node:path', 'node:url'])) continue;
    if (!/\bcreateServer\s*\(/.test(code) || !/\.listen\s*\([^;]*['"](?:127\.0\.0\.1|localhost|::1)['"]/.test(code)) continue;
    if (/\b(?:fetch|eval|exec|spawn)\s*\(|\b(?:req|request)\.(?:method|headers|on|body)|\.write\s*\(|JSON\.stringify/.test(code)) continue;
    const read = code.match(/\bconst\s+(\w+)\s*=\s*await\s+readFile\s*\([^;]+\)\s*;/);
    if (!read || !code.includes('index.html')) continue;
    const responses = [...code.matchAll(/\b(?:res|response)\.end\s*\(([^)]*)\)/g)].map(m => m[1].trim());
    if (!responses.includes(read[1]) || responses.some(v => v !== read[1] && v !== '' && !/^(['"])(?:Forbidden|Not found|Not Found)\1$/.test(v))) continue;
    result.add(path);
  }
  return result;
}
