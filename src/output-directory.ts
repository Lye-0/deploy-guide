import type { Entry } from './types.ts';
export type OutputSelection = { path: string | null; reason: string; warnings: string[] };

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
// Strip comments without changing string literals. Never evaluate project configuration.
function uncomment(text: string): string {
  return text.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g, token => token.startsWith('//') || token.startsWith('/*') ? ' ' : token);
}
function jsonConfig(text: string): Record<string, unknown> {
  return JSON.parse(uncomment(text).replace(/("(?:\\.|[^"\\])*")|,\s*(?=[}\]])/g, (match, str) => str ?? ''));
}
// Only direct string literals are supported; expressions, spreads and multiple candidates stay unknown.
function viteOutput(text: string): { present: boolean; value?: string } {
  const clean = uncomment(text);
  if (/\.\.\.|\broot\s*:/.test(clean)) return { present: true };
  // Tokenize without executing configuration; keep nested object braces balanced.
  const tokens = clean.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$]*|[^\s]/g) ?? [];
  const key = (token: string) => token.replace(/^['"]|['"]$/g, '');
  const builds = tokens.map((t, i) => key(t) === 'build' && tokens[i + 1] === ':' ? i : -1).filter(i => i >= 0);
  if (builds.length > 1) return { present: true };
  if (!builds.length) return { present: /\boutDir\b/.test(clean) };
  const begin = builds[0] + 2;
  if (tokens[begin] !== '{') return { present: true };
  let depth = 1;
  const values: (string | undefined)[] = [];
  for (let i = begin + 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '{') depth++;
    if (token === '}') {
      depth--;
      if (depth === 0) return values.length === 0 ? { present: false } : values.length === 1 ? { present: true, value: values[0] } : { present: true };
    }
    if (depth === 1 && key(token) === 'outDir' && tokens[i + 1] === ':') {
      const literal = tokens[i + 2] ?? '';
      const value = /^(['"])[^'"\\]*\1$/.test(literal) && [',', '}'].includes(tokens[i + 3]) ? literal.slice(1, -1) : undefined;
      values.push(value);
    }
  }
  return { present: true };

}
export function detectOutput(entries: Entry[], manual = 'auto', files = entries): OutputSelection {
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
        const value = viteOutput(e.text); if (value.present) add(value.value, e.path);
      }
    } catch { unresolved = true; warnings.push(`${e.path}の設定を読み取れません。公開フォルダを手動で指定してください。`); }
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
