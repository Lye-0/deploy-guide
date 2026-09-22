import type { Entry } from './types.ts';
export const MAX_FILES = 50_000;
export const MAX_TEXT = 4 * 1024 * 1024;
export const MAX_TOTAL_TEXT = 32 * 1024 * 1024;
const ignored = /^(node_modules|\.git|\.svn|\.hg|\.idea|\.vscode|\.kilo|\.agents|\.codex|coverage|\.cache|\.turbo)$/i;
export function safePath(path: string): boolean {
  return !path.split('/').some(p => ignored.test(p) || /^(?:\.env|\.dev\.vars)(?:\.|$)/i.test(p) || /\.(pem|key|p12|pfx|crt|keystore)$/i.test(p) || /^(id_rsa|id_ed25519|credentials(?:\.json)?|\.npmrc|\.netrc)$/i.test(p));
}
export function wantsText(path: string): boolean {
  return safePath(path) && !/(?:^|\/)(?:package-lock|npm-shrinkwrap)\.json$/.test(path) && /\.(?:[cm]?[jt]sx?|html|css|jsonc?|toml|ya?ml)$/.test(path);
}
export function readPriority(path: string): number {
  if (/(^|\/)(package\.json|index\.html|(?:vite|next|astro|svelte)\.config\.[cm]?[jt]s|vercel\.json|wrangler\.(toml|jsonc?))$/.test(path)) return 0;
  if (/^(tests?|__tests__|docs|reports)\//.test(path) || /\.(test|spec)\./.test(path)) return 4;
  if (/\.(js|mjs|ts|tsx|jsx|css|html)$/.test(path)) return 1;
  return 3;
}
export function projectRoots(entries: Entry[]): string[] {
  return [...new Set(['', ...entries.filter(e => safePath(e.path) && /(^|\/)package\.json$/.test(e.path) && !/(^|\/)(dist|build|out|\.next)\//.test(e.path)).map(e => e.path.slice(0, -12))])].sort();
}
