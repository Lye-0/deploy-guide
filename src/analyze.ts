import { analyzeWorkspace } from './workspace-layout.ts';
import type { Analysis, Entry } from './types.ts';
import { detectOutput } from './output-directory.ts';
import { inspectClient } from './client-graph.ts';
import { inspectServer } from './server-inspection.ts';
import { parseCode, walk, stringValue } from './syntax.ts';
import { safePath, projectRoots } from './inventory.ts';
export { MAX_FILES, MAX_TEXT, MAX_TOTAL_TEXT, safePath, wantsText, readPriority, projectRoots } from './inventory.ts';
function launchEntries(scripts: Record<string, unknown>, files: Set<string>): { paths: string[]; unknown: boolean } {
  const found = new Set<string>(), seen = new Set<string>(); let unknown = false;
  function command(key: string) {
    if (seen.has(key)) { unknown = true; return; } seen.add(key);
    const cmd = scripts[key]; if (typeof cmd !== 'string') return;
    const child = [...cmd.matchAll(/\b(?:npm|pnpm|yarn)\s+(?:run\s+)?([\w:-]+)/g)];
    for (const m of child) if (m[1] in scripts) command(m[1]);
    const paths = [...cmd.matchAll(/(?:^|\s)["']?((?:\.\/)?[\w./-]+\.[cm]?[jt]s)["']?(?=\s|$)/g)].map(m => m[1].replace(/^\.\//, ''));
    for (const p of paths) if (files.has(p)) found.add(p); else unknown = true;
    if (!paths.length && !child.length && !/^(?:vite(?:\s|$)|next\s+start|(?:npx\s+)?(?:http-server|serve)(?:\s|$))/.test(cmd.trim())) unknown = true;
  }
  if (scripts.start) command('start'); else if (scripts.dev) command('dev');
  return { paths: [...found], unknown };
}
export function analyze(all: Entry[], root = '', name = 'project', scanWarnings: string[] = [], outputChoice = 'auto'): Analysis {
  const workspace = analyzeWorkspace(all, root, name, scanWarnings, outputChoice);
  if (workspace) return workspace;
  const nested = projectRoots(all).filter(p => p && p !== root && p.startsWith(root));
  const entries = all.filter(e => safePath(e.path) && e.path.startsWith(root) && !nested.some(p => e.path.startsWith(p))).map(e => ({ ...e, path: e.path.slice(root.length) }));
  const map = new Map(entries.map(e => [e.path, e]));
  const a: Analysis = { name, framework: '未対応・不明な構成', next: false, worker: false, runtime: 'unknown', runtimeKind: 'unknown', runtimeReason: '', staticExport: false, externalApi: false, recognized: false, assets: null, evidence: [], warnings: [...scanWarnings], incomplete: scanWarnings.length > 0, capacityIncomplete: scanWarnings.some(w => /一覧|読み取れません|列挙/.test(w)), scanned: entries.length, textRead: entries.filter(e => e.text !== undefined).length };
  const add = (label: string, path: string) => a.evidence.push({ label, path: root + path });
  let pkg: any = {};
  let metadataUnknown = false;
  const meta = map.get('package.json');
  try { if (meta) { if (meta.text === undefined) throw Error(); pkg = JSON.parse(meta.text); if (!pkg || typeof pkg !== 'object') throw Error(); add('構成と起動コマンドを確認', 'package.json'); } }
  catch { pkg = {}; metadataUnknown = true; a.warnings.push('package.jsonを読み取れません。'); a.incomplete = true; }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const scripts = pkg.scripts ?? {};
  a.next = Boolean(deps.next);
  const vite = Boolean(deps.vite || entries.some(e => /^vite\.config\./.test(e.path)));
  a.framework = a.next ? 'Next.js' : vite ? (deps.react ? 'React + Vite' : 'Vite') : map.has('index.html') ? 'HTML / CSS / JavaScript' : '未対応・不明な構成';
  const nextConfig = entries.find(e => /^next\.config\.[cm]?[jt]s$/.test(e.path));
  if (nextConfig?.text) { const ast = parseCode(nextConfig.text); if (ast) walk(ast, n => { if (n.type === 'Property' && (n.key.name ?? n.key.value) === 'output' && stringValue(n.value) === 'export') a.staticExport = true; }); }
  const outputEntries = all.filter(e => safePath(e.path) && e.path.startsWith(root)).map(e => ({ ...e, path: e.path.slice(root.length) }));
  const selection = detectOutput(entries, outputChoice, outputEntries);
  a.warnings.push(...selection.warnings);
  const output = selection.path;
  const htmlPath = vite && map.has('index.html') ? 'index.html' : output !== null && map.has(output + 'index.html') ? output + 'index.html' : 'index.html';
  const graph = inspectClient(entries, htmlPath, vite && htmlPath === 'index.html', output);
  let viteSSR = false;
  const viteConfig = entries.find(e => /^vite\.config\./.test(e.path));
  if (viteConfig?.text) { const ast = parseCode(viteConfig.text); if (ast) walk(ast, n => { if (n.type === 'Property' && (n.key.name ?? n.key.value) === 'ssr' && !(n.value.type === 'Literal' && n.value.value === false)) viteSSR = true; }); else viteSSR = true; }
  const foreignRuntime = entries.some(e => /^(app\.py|server\.py|main\.go|go\.mod|Gemfile|composer\.json|Cargo\.toml|requirements\.txt|pyproject\.toml)$/.test(e.path));
  a.evidence.push(...graph.evidence.map(e => ({ ...e, path: root + e.path })));
  a.externalApi = graph.externalApi;
  const launch = launchEntries(scripts, new Set(map.keys()));
  for (const e of entries) if (/^(?:src\/)?server\.[cm]?[jt]s$/.test(e.path) && !launch.paths.includes(e.path)) launch.paths.push(e.path);
  let dynamicServer = false, unresolvedServer = launch.unknown || metadataUnknown || !!a.capacityIncomplete, staticServers = 0;
  for (const path of launch.paths) {
    const result = inspectServer(path, map);
    if (result.kind === 'server') dynamicServer = true;
    if (result.kind === 'unknown' || result.kind === 'none') unresolvedServer = true;
    if (result.kind === 'static-files') staticServers++;
    a.evidence.push(...result.evidence.map(e => ({ ...e, path: root + e.path })));
    a.warnings.push(...result.issues);
  }
  let routeServer = false, unresolvedRoute = false;
  for (const e of entries.filter(e => !/(^|\/)(tests?|__tests__|examples|docs|scripts|dist|out|build)\//.test(e.path))) {
    const route = (a.next && /^(?:src\/)?(?:app\/.*route\.[jt]s|pages\/api\/.*\.[jt]s)$/.test(e.path)) || (/^api\/.*\.[jt]s$/.test(e.path) && map.has('vercel.json'));
    const possibleAction = a.next && /\.[jt]sx?$/.test(e.path);
    if (!route && !possibleAction) continue;
    const ast = e.text === undefined ? null : parseCode(e.text);
    if (!ast) { if (route) unresolvedRoute = true; continue; }
    let serverFeature = false;
    walk(ast, n => { if (n.type === 'ExpressionStatement' && stringValue(n.expression) === 'use server') serverFeature = true; if (n.type === 'ExportNamedDeclaration' && n.declaration?.id?.name === 'getServerSideProps') serverFeature = true; });
    if (serverFeature || route && !a.staticExport) { routeServer = true; add('フレームワークのサーバー実行エントリーポイント', e.path); }
    if (route && a.staticExport) unresolvedRoute = true;
  }
  const wrangler = entries.find(e => /^wrangler\.(jsonc?|toml)$/.test(e.path));
  let workerMain: string | null = null;
  if (wrangler?.text) { const match = wrangler.text.match(/(?:^|[,{\n])\s*["']?main["']?\s*[:=]\s*["']([^"']+)["']/); if (match) workerMain = match[1].replace(/^\.\//, ''); }
  if (workerMain) {
    const e = map.get(workerMain), ast = e?.text ? parseCode(e.text) : null;
    let exported = false;
    if (ast) walk(ast, n => { if (n.type === 'ExportDefaultDeclaration') exported = true; });
    if (exported) { a.worker = true; dynamicServer = true; add('Workersのmainとエクスポートを確認', workerMain); }
    else { unresolvedServer = true; a.warnings.push('Workersのmainを確認できません。'); }
  }
  const unsupportedFramework = ['nuxt', 'astro', '@sveltejs/kit', '@angular/ssr', '@tanstack/react-start'].find(key => deps[key]);
  if (dynamicServer || routeServer || a.next && !a.staticExport) {
    a.runtime = 'server'; a.runtimeKind = a.worker ? 'worker' : a.next ? 'next' : routeServer ? 'functions' : 'node';
    a.runtimeReason = a.worker ? 'Workersの実行エントリーポイントを確認しました。' : a.next ? 'Next.jsのサーバー実行構成として評価しています。' : routeServer ? '公開APIのエントリーポイントを確認しました。' : '起動処理に、ファイル配信以外のHTTP応答があります。';
  } else if (!unresolvedServer && !unresolvedRoute && !unsupportedFramework && !viteSSR && !foreignRuntime && (graph.ready || a.next && a.staticExport)) {
    a.runtime = 'static'; a.runtimeKind = 'static';
    a.runtimeReason = staticServers ? 'ブラウザ側の参照と、起動サーバーのファイル配信を確認しました。公開先に独自バックエンドは不要と推定します。' : vite && htmlPath === 'index.html' ? 'Viteのブラウザ用エントリーポイントを確認しました。ビルド後の静的配信を想定しています。' : 'HTMLから実行ファイルを追跡し、ブラウザで動く構成を確認しました。';
  } else {
    a.runtimeReason = '公開時の実行方式を確定できません。根拠と未確認事項を確認してください。';
    if (unresolvedServer) a.warnings.push('起動コマンドの処理を静的配信と確認できません。公開先で必要な処理か確認してください。');
    if (unresolvedRoute) a.warnings.push('APIルートと静的出力の整合性を確認してください。');
    if (viteSSR) a.warnings.push('ViteのSSR設定は実行環境・アダプターの確認が必要です。');
    if (foreignRuntime) a.warnings.push('JavaScript以外の実行環境が含まれます。公開時に必要な処理か確認してください。');
    if (unsupportedFramework) a.warnings.push(`${unsupportedFramework}のアダプター・実行モードは未対応です。`);
  }
  a.warnings.push(...graph.issues, ...graph.notes);
  a.recognized = map.has('index.html') || vite || a.next || a.worker || launch.paths.length > 0;
  const rootCanPublish = graph.ready && !graph.needsBuild && a.runtime === 'static' && htmlPath === 'index.html';
  const measurement = output !== null ? output : rootCanPublish && !selection.warnings.length ? '' : null;
  if (measurement !== null) {
    const assets = outputEntries.filter(e => e.path.startsWith(measurement) && (!/(^|\/)\.[^/]+/.test(e.path) || /(?:^|\/)\.nojekyll$/.test(e.path)));
    a.assets = { path: root + (measurement || './'), count: assets.length, bytes: assets.reduce((s, e) => s + e.size, 0), largest: assets.reduce((s, e) => Math.max(s, e.size), 0) };
    add(selection.reason || 'ブラウザの参照関係からルートを公開候補として確認', measurement || './');
  }
  if (!a.assets) a.warnings.push('公開容量は未確認です。出力がまだない場合は構成だけで評価します。');
  a.warnings = [...new Set(a.warnings)];
  return a;
}
