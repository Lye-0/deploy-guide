import type { Entry } from './types.ts';
import type { BuildProfile } from './build-profiles.ts';

export type PagesBinding = { path: string; workflow: string; script: string };
// Read only literal Actions steps. Expressions and shell command blocks stay unknown.
export function pagesBindings(entries: Entry[], profiles: BuildProfile[]): PagesBinding[] {
  const bindings: PagesBinding[] = [];
  for (const file of entries.filter(e => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(e.path))) {
    if (!file.text) continue;
    const jobs = file.text.split(/(?=^  [\w-]+:\s*$)/m);
    for (const job of jobs) {
      const lines = job.split(/\r?\n/);
      const uploads: string[] = [];
      const scripts = new Set<string>();
      for (let i = 0; i < lines.length; i++) {
        const run = lines[i].match(/^\s*-\s*run:\s*(.*?)\s*$/);
        if (run) {
          const command = run[1].replace(/^['"]|['"]$/g, '');
          const match = command.match(/^(?:npm\s+run|pnpm\s+(?:run\s+)?|yarn\s+(?:run\s+)?)([\w:-]+)$/);
          if (match) scripts.add(match[1]);
        }
        if (!/^\s*-\s*uses:\s*actions\/upload-pages-artifact@v\d+\s*$/.test(lines[i])) continue;
        const indent = lines[i].match(/^\s*/)?.[0].length ?? 0;
        let candidate: string | undefined;
        for (let j = i + 1; j < lines.length; j++) {
          const line = lines[j], level = line.match(/^\s*/)?.[0].length ?? 0;
          if (line.trim() && level <= indent) break;
          const m = line.match(/^\s+path:\s*['"]?([\w./-]+)['"]?\s*$/);
          if (m) candidate = m[1];
        }
        if (candidate) uploads.push(candidate);
      }
      if (uploads.length !== 1) continue;
      const matching = profiles.filter(p => scripts.has(p.script) && p.output &&
        p.output.replace(/^\.\//, '').replace(/\/$/, '') === uploads[0].replace(/^\.\//, '').replace(/\/$/, ''));
      if (matching.length === 1) bindings.push({ path: uploads[0], workflow: file.path, script: matching[0].script });
    }
  }
  return bindings;
}
