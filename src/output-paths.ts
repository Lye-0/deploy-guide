import type { Entry } from './types.ts';
export function normalizeOutputPath(value: string): string | null {
  const path = value.trim().replace(/\\/g, '/');
  if (!path || path.startsWith('/') || /[:\x00-\x1f]/.test(path) || path.split('/').includes('..')) return null;
  const parts = path.split('/').filter(p => p && p !== '.');
  return parts.length ? parts.join('/') + '/' : '';
}
export function outputFolders(entries: Entry[]): string[] {
  const folders = new Set<string>();
  for (const entry of entries) {
    const parts = entry.path.split('/');
    for (let i = 1; i < parts.length; i++) if (!parts.slice(0, i).some(p => p.startsWith('.'))) folders.add(parts.slice(0, i).join('/') + '/');
  }
  return [...folders].sort();
}
