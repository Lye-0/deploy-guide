import { buildProfiles, type BuildProfile } from './build-profiles.ts';
import type { Entry } from './types.ts';
export type OutputSelection = { path: string | null; reason: string; warnings: string[]; profiles?: BuildProfile[] };

import { normalizeOutputPath } from './output-paths.ts';
export { normalizeOutputPath, outputFolders } from './output-paths.ts';
// Strip comments without changing string literals. Never evaluate project configuration.
function uncomment(text: string): string {
  return text.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g, token => token.startsWith('//') || token.startsWith('/*') ? ' ' : token);
}
function jsonConfig(text: string): Record<string, unknown> {
  return JSON.parse(uncomment(text).replace(/("(?:\\.|[^"\\])*")|,\s*(?=[}\]])/g, (match, str) => str ?? ''));
}
export function detectOutput(entries: Entry[], manual = 'auto', files = entries): OutputSelection {
  const profiles = buildProfiles(entries);
  const result = detect(entries, manual, files, profiles);
  return { ...result, profiles };
}
function detect(entries: Entry[], manual: string, files: Entry[], profiles: BuildProfile[]): OutputSelection {
  const available = (path: string) => files.some(e => e.path.startsWith(path));
  if (manual !== 'auto') {
    const path = normalizeOutputPath(manual);
    return path !== null && available(path)
      ? { path, reason: '利用者が公開対象として指定', warnings: ['指定フォルダ内の確認できたファイルを集計しています。ソースや設定ファイルも含まれる場合があります。'] }
      : { path: null, reason: '', warnings: ['指定した公開フォルダを読み取れません。選択したアプリ内のフォルダを指定してください。'] };
  }
  const found: { path: string; source: string }[] = [];
  const warnings: string[] = [];
  let unresolved = false;
  const add = (value: unknown, source: string) => {
    if (typeof value !== 'string' || normalizeOutputPath(value) === null) { unresolved = true; warnings.push(`${source}の公開先を安全に特定できません。公開フォルダを手動で指定してください。`); }
    else found.push({ path: normalizeOutputPath(value)!, source });
  };
  for (const e of entries.filter(e => /^(vercel\.json|wrangler\.(jsonc?|toml)|vite\.config\.[cm]?[jt]s)$/.test(e.path))) {
    if (e.text === undefined) { unresolved = true; warnings.push(`${e.path}の内容は未読のため、公開先を手動で指定してください。`); continue; }
    try {
      if (e.path === 'vercel.json') { const data = jsonConfig(e.text); if ('outputDirectory' in data && data.outputDirectory !== null) add(data.outputDirectory, e.path); }
      else if (/^wrangler\.jsonc?$/.test(e.path)) {
        const data = jsonConfig(e.text);
        if ('pages_build_output_dir' in data) add(data.pages_build_output_dir, e.path);
        if (data.assets && typeof data.assets === 'object' && 'directory' in data.assets) add((data.assets as Record<string, unknown>).directory, e.path);
      } else if (e.path === 'wrangler.toml') {
        const lines = e.text.split(/\r?\n/); let section = '';
        for (const line of lines) {
          const heading = line.match(/^\s*\[([^\]]+)\]/); if (heading) { section = heading[1].trim(); continue; }
          const match = line.match(/^\s*(directory|pages_build_output_dir)\s*=\s*(['"])([^'"\\]*)\2\s*(?:#.*)?$/);
          if (match && ((section === 'assets' && match[1] === 'directory') || (!section && match[1] === 'pages_build_output_dir'))) add(match[3], e.path);
        }
      } else {
        // Vite profiles are reconciled with hosting configuration below.
      }
    } catch { unresolved = true; warnings.push(`${e.path}の設定を読み取れません。公開フォルダを手動で指定してください。`); }
  }
  const hosting = [...new Set(found.map(f => f.path))];
  const variants = [...new Set(profiles.flatMap(p => p.output === undefined ? [] : [normalizeOutputPath(p.output)]))];
  const invalid = profiles.some(p => p.output === undefined || normalizeOutputPath(p.output) === null);
  const describe = (p: BuildProfile) => p.script + ' (mode=' + p.mode + ') → ' + (p.output ?? '未確認' + (p.issue ? '（' + p.issue + '）' : ''));
  if (profiles.length > 1) warnings.push('ビルドごとの出力：' + profiles.map(describe).join(' ／ ') + '。配信する内容に合うフォルダを選んでください。');
  if (hosting.length === 1 && variants.includes(hosting[0]) && !unresolved) {
    const matched = profiles.filter(p => p.output !== undefined && normalizeOutputPath(p.output) === hosting[0]);
    const reason = found[0].source + 'と ' + matched.map(describe).join(' ／ ') + ' の一致から検出';
    if (invalid) warnings.push('他のビルドに未確認の出力があります。選択中の配信設定との一致だけを確認しています。');
    return available(hosting[0]) ? { path: hosting[0], reason, warnings }
      : { path: null, reason, warnings: [...warnings, '設定された出力「' + hosting[0] + '」は未生成です。対象のビルド後に再選択してください。'] };
  }
  if (profiles.length) {
    if (invalid) { unresolved = true; warnings.push('ビルド出力を特定できません：' + profiles.filter(p => p.output === undefined || normalizeOutputPath(p.output) === null).map(describe).join(' ／ ')); }
    for (const p of profiles) if (p.output !== undefined) add(p.output, p.script + ' (mode=' + p.mode + ')');
  }
  const unique = [...new Set(found.map(f => f.path))];
  if (unresolved || unique.length > 1) return { path: null, reason: '', warnings: [...warnings, ...(unique.length > 1 ? ['設定に複数の公開先があります。使用する公開フォルダを指定してください。'] : [])] };
  if (unique.length === 1) {
    const item = found[0];
    return available(item.path) ? { path: item.path, reason: `${item.source}の公開先設定から検出`, warnings }
      : { path: null, reason: '', warnings: [`${item.source}の公開先「${item.path || './'}」にファイルが見つかりません。ビルド後に再選択するか、公開フォルダを指定してください。`] };
  }
  const conventional = ['dist/', 'out/', 'build/'].filter(available);
  if (conventional.length > 1) return { path: null, reason: '', warnings: ['公開候補フォルダが複数あります。使用する公開フォルダを指定してください。'] };
  if (conventional.length === 1) return { path: conventional[0], reason: '標準的な出力フォルダ名から推定', warnings: ['フォルダ名からの推定です。実際に公開する内容と一致するか確認してください。'] };
  return { path: null, reason: '', warnings: [] };
}
