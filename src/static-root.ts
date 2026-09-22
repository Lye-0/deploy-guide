import type { Entry } from './types.ts';

/** Conservative source-only check. No project code or scripts are executed. */
export function staticRoot(entries: Entry[]): { ready: boolean; note: string } {
  const html = entries.find(e => e.path === 'index.html');
  if (!html) return { ready: false, note: '' };
  const pkg = entries.find(e => e.path === 'package.json');
  const buildNote = 'ビルドが必要な手掛かりがあります。公開先の提案は続けますが、公開容量はビルド後の出力フォルダで確認してください。';
  if (entries.some(e => /^(vite|webpack|rollup|next|nuxt|astro|svelte)\.config\./.test(e.path) || e.path === 'angular.json')) return { ready: false, note: buildNote };
  if (pkg) {
    try {
      if (pkg.text === undefined) throw new Error();
      const data = JSON.parse(pkg.text);
      const deps = { ...data.dependencies, ...data.devDependencies };
      if (['express', 'fastify', 'hono', '@nestjs/core'].some(key => key in deps)) return { ready: false, note: 'サーバー用の依存関係があるため、公開する静的ファイルの範囲を確認してください。' };
      if (Object.values(data.scripts ?? {}).some(value => typeof value === 'string' && /\b(vite|webpack|rollup|parcel|next|nuxt|astro|tsc|esbuild)\b/.test(value))) return { ready: false, note: buildNote };
      if (['vite', 'webpack', 'rollup', 'parcel', 'next', 'nuxt', 'astro', '@sveltejs/kit', 'react-scripts', '@angular/core'].some(key => key in deps) || Object.entries(data.scripts ?? {}).some(([key, value]) => /^build(?::|$)|^(prebuild|postbuild|generate|export)$/.test(key) && typeof value === 'string' && value.trim())) return { ready: false, note: buildNote };
    } catch { return { ready: false, note: 'package.jsonを読み取れないため、公開範囲を自動判定できません。' }; }
  }
  // Preserve support for directly selected build artifacts whose HTML was not read by the scanner.
  if (html.text === undefined) return { ready: !pkg, note: pkg ? 'HTMLの内容が未読のため、公開範囲を自動判定できません。' : '' };
  const paths = new Map(entries.map(e => [e.path, e]));
  let problem = '';
  const visited = new Set<string>();
  function reference(raw: string, from: string, module = false): void {
    if (problem || !raw || /^(https?:|data:|\/\/|#)/i.test(raw)) return;
    if (module && !/^(\.?\.?\/)/.test(raw)) { problem = 'パッケージ名によるモジュール参照があり、ビルド不要とは確認できません。'; return; }
    if (/&|\$\{|<%|\{\{/.test(raw)) { problem = '動的な参照先があり、公開範囲を自動判定できません。'; return; }
    let path: string;
    try { path = decodeURIComponent(new URL(raw, 'https://local.invalid/' + from).pathname).slice(1); } catch { problem = '参照先のパスを確認できません。'; return; }
    if (/\.(tsx?|jsx|vue|svelte|scss|sass|less)$/.test(path)) { problem = buildNote; return; }
    const file = paths.get(path);
    if (!file) { problem = `HTML・スクリプトの参照先「${path}」が見つかりません。公開範囲を確認してください。`; return; }
    if (/\.[cm]?js$/.test(path) && !visited.has(path)) {
      visited.add(path);
      if (file.text === undefined) { problem = '参照するJavaScriptの内容が未読のため、ビルド不要とは確認できません。'; return; }
      imports(file.text, path);
    }
  }
  function imports(code: string, from: string) {
    const clean = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of clean.matchAll(/\b(?:import|export)\s+(?:[^;'"\n]*?\s+from\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) reference(m[1] ?? m[2], from, true);
    if (/\brequire\s*\(|\bimport\.meta\.env\b/.test(clean)) problem = buildNote;
    if (/\bimport\s*\(\s*[^'"\s]/.test(clean)) problem = '動的なモジュール参照があり、ビルド不要とは確認できません。';
  }
  const content = html.text.replace(/<!--[\s\S]*?-->/g, '');
  if (/<base\b/i.test(content)) return { ready: false, note: 'base要素で参照先が変わるため、公開範囲を確認してください。' };
  if (/<script\b[^>]*type\s*=\s*['"](?:text\/babel|text\/typescript)['"]/i.test(content)) return { ready: false, note: buildNote };
  for (const tag of content.matchAll(/<(script|link|img|source|video|audio)\b[^>]*>/gi)) {
    const attr = tag[1].toLowerCase() === 'link' ? 'href' : 'src';
    const m = tag[0].match(new RegExp('\\b' + attr + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'));
    if (m) reference(m[1] ?? m[2] ?? m[3], 'index.html');
  }
  for (const script of content.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) imports(script[1], 'index.html');
  return { ready: !problem, note: problem };
}
