/** Exclude tooling from deployment-runtime inference, not from file counts. */
export function runtimeSource(path: string, productionEntries: Set<string>): boolean {
  if (productionEntries.has(path)) return true;
  if (/(^|\/)(tests?|__tests__|__mocks__|__fixtures__|fixtures|e2e|cypress|playwright|dist|build|out|\.next|public)\//i.test(path)) return false;
  if (/\.(test|spec|stories|browser)\.[cm]?[jt]sx?$/i.test(path)) return false;
  if (/^(scripts|tools|docs|examples)\//i.test(path)) return false;
  if (/(^|\/)(vite|vitest|playwright|cypress|webpack|rollup)\.config\./i.test(path)) return false;
  return true;
}
export function startEntries(scripts: unknown): Set<string> {
  const entries = new Set<string>();
  if (!scripts || typeof scripts !== 'object') return entries;
  const start = (scripts as Record<string, unknown>).start;
  if (typeof start !== 'string') return entries;
  for (const match of start.matchAll(/(?:^|\s)["']?((?:\.\/)?[\w./-]+\.[cm]?[jt]s)["']?(?=\s|$)/g)) entries.add(match[1].replace(/^\.\//, ''));
  return entries;
}
