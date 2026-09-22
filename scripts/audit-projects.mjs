import fs from 'node:fs';
import path from 'node:path';
import { analyze } from '../src/analyze.ts';
import { safePath, wantsText, readPriority, MAX_TEXT, MAX_TOTAL_TEXT, MAX_FILES } from '../src/inventory.ts';
import { recommend } from '../src/rules.ts';
// Optional read-only audit. Paths are supplied by the caller, never used as classification rules.
for (const root of process.argv.slice(2)) {
  const entries = [], warnings = [];
  function walk(dir, prefix = '') {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix + item.name; if (!safePath(relative)) continue;
      if (item.isSymbolicLink()) { warnings.push('シンボリックリンクの列挙は未対応です。'); continue; }
      if (entries.length >= MAX_FILES) { warnings.push('一覧上限に達しました。'); return; }
      if (item.isDirectory()) walk(path.join(dir, item.name), relative + '/');
      else if (item.isFile()) entries.push({ path: relative, size: fs.statSync(path.join(root, relative)).size });
    }
  }
  walk(root);
  let used = 0;
  for (const entry of [...entries].sort((a,b) => readPriority(a.path) - readPriority(b.path) || a.path.localeCompare(b.path))) {
    if (!wantsText(entry.path)) continue;
    if (entry.size > MAX_TEXT || used + entry.size > MAX_TOTAL_TEXT) { warnings.push('テキスト読取上限'); continue; }
    used += entry.size; entry.text = fs.readFileSync(path.join(root, entry.path), 'utf8');
  }
  const a = analyze(entries, '', path.basename(root), [...new Set(warnings)]);
  const candidates = recommend(a, { purpose:'unknown', budget:'free', priority:'simple', traffic:'unknown', runtime:'auto' });
  console.log(JSON.stringify({ project: path.basename(root), runtime:a.runtime, recommendation:candidates.find(c=>!c.blocked&&!c.conditional)?.name ?? '要確認', assets:a.assets, warnings:a.warnings }));
}
