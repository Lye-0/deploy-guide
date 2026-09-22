import { runtimeSource, startEntries } from './runtime-scope.ts';
import type { Analysis, Entry } from './types.ts';
import { detectOutput } from './output-directory.ts';
export const MAX_FILES = 50_000;
export const MAX_TEXT = 512 * 1024;
export const MAX_TOTAL_TEXT = 8 * 1024 * 1024;
const ignored = /^(node_modules|\.git|\.svn|\.hg|\.idea|\.vscode|coverage|\.cache|\.turbo)$/i;
export function safePath(path: string): boolean {
  return !path.split('/').some(p => ignored.test(p) || /^\.env(?:\.|$)/i.test(p) || /\.(pem|key|p12|pfx|crt|keystore)$/i.test(p) || /^(id_rsa|id_ed25519|credentials(?:\.json)?|\.npmrc|\.netrc)$/i.test(p));
}
export function wantsText(path: string): boolean {
  return safePath(path) && !/(^|\/)(dist|build|out|\.next|vendor)\//.test(path) && !/(?:lock|\.min)\.(?:json|js)$/.test(path) && /(?:\.(?:[cm]?[jt]sx?|html|jsonc?|toml|ya?ml))$/.test(path);
}
export function projectRoots(entries: Entry[]): string[] {
  const roots = entries.filter(e => /(^|\/)package\.json$/.test(e.path) && !/(^|\/)(dist|build|out|\.next)\//.test(e.path)).map(e => e.path.slice(0, -'package.json'.length));
  return [...new Set(['', ...roots])].sort();
}
export function analyze(all: Entry[], root = '', name = 'project', scanWarnings: string[] = [], outputChoice = 'auto'): Analysis {
  const nested = projectRoots(all).filter(p => p && p !== root && p.startsWith(root));
  const entries = all.filter(e => safePath(e.path) && e.path.startsWith(root) && !nested.some(p => e.path.startsWith(p))).map(e => ({ ...e, path: e.path.slice(root.length) }));
  const a: Analysis = { name, framework: '構成を確認中', next: false, worker: false, runtime: 'unknown', staticExport: false, externalApi: false, recognized: false, assets: null, evidence: [], warnings: [...scanWarnings], incomplete: scanWarnings.length > 0, scanned: entries.length, textRead: entries.filter(e => e.text !== undefined).length };
  const add = (label: string, path: string) => a.evidence.push({ label, path: root + path });
  const pkg = entries.find(e => e.path === 'package.json');
  let deps: Record<string, unknown> = {};
  let runtimeDeps: Record<string, unknown> = {};
  let productionEntries = new Set<string>();
  if (pkg?.text) {
    try { const json = JSON.parse(pkg.text); deps = { ...json.dependencies, ...json.devDependencies }; runtimeDeps = json.dependencies ?? {}; productionEntries = startEntries(json.scripts); add('依存関係を確認', pkg.path); }
    catch { a.warnings.push('package.jsonを読み取れません。構成の確認が必要です。'); a.incomplete = true; }
  }
  a.next = Boolean(deps.next);
  const config = entries.find(e => /^next\.config\.[cm]?[jt]s$/.test(e.path));
  a.staticExport = Boolean(config?.text && /\boutput\s*:\s*['"]export['"]/.test(config.text));
  if (a.staticExport) add('静的エクスポート設定を検出（ビルドは未実行）', config!.path);
  a.worker = entries.some(e => /^wrangler\.(toml|jsonc?)$/.test(e.path)) || Boolean(deps['@cloudflare/workers-types'] || deps.hono);
  const cf = entries.find(e => /^wrangler\.(toml|jsonc?)$/.test(e.path));
  if (cf) add('Cloudflareの設定あり', cf.path);
  const candidateServerFiles = entries.filter(e => !/(^|\/)(dist|build|out|\.next|public)\//.test(e.path) && /(^|\/)(pages\/api\/|api\/.*\.[cm]?[jt]s$|server\.[cm]?[jt]s$|functions\/|.*\+server\.[jt]s$)/.test(e.path));
  const candidateServerCode = entries.filter(e => e.text && !/(^|\/)(dist|build|out|\.next|public)\//.test(e.path) && /\.(?:[cm]?[jt]sx?)$/.test(e.path) && /\bexport\s+(?:async\s+)?(?:function|const)\s+getServerSideProps\b|^\s*['"]use server['"]\s*;?|\b(?:Bun|Deno)\.serve\s*\(|\b(?:app|server)\.listen\s*\(/m.test(e.text));
  const serverFiles = candidateServerFiles.filter(e => runtimeSource(e.path, productionEntries));
  const serverCode = candidateServerCode.filter(e => runtimeSource(e.path, productionEntries));
  const tooling = [...new Map([...candidateServerFiles, ...candidateServerCode].filter(e => !runtimeSource(e.path, productionEntries)).map(e => [e.path, e])).values()];
  for (const e of tooling.slice(0, 5)) add('テスト・開発用のためサーバー判定から除外', e.path);
  const routeFiles = entries.filter(e => runtimeSource(e.path, productionEntries) && /(^|\/)app\/(?:.*\/)?route\.[jt]s$/.test(e.path));
  const workerMain = cf?.text && /(?:["']?main["']?\s*[:=])/.test(cf.text);
  const serverDeps = Boolean(runtimeDeps.express || runtimeDeps.fastify || runtimeDeps['@nestjs/core'] || runtimeDeps.hono);
  const server = serverFiles.length > 0 || serverCode.length > 0 || Boolean(workerMain) || serverDeps;
  for (const e of [...serverFiles, ...serverCode].slice(0, 5)) add('サーバー処理の手掛かり', e.path);
  if (routeFiles.length) add('Route Handlerあり（静的出力の可否は要確認）', routeFiles[0].path);
  const html = entries.some(e => e.path === 'index.html');
  const staticFramework = Boolean(deps.vite && !deps.next && !deps['@sveltejs/kit'] && !deps.nuxt && !deps['@tanstack/react-start']);
  a.recognized = a.next || a.worker || server || html || staticFramework;
  a.framework = a.next ? 'Next.js' : a.worker ? (deps.hono ? 'Hono / Workers候補' : 'Cloudflare Workers') : deps.express ? 'Express' : staticFramework ? (deps.react ? 'React + Vite' : 'Vite') : html ? 'HTML / CSS / JavaScript' : '未対応・不明な構成';
  a.runtime = server ? 'server' : a.next ? (a.staticExport ? 'static' : 'unknown') : (html || staticFramework) ? 'static' : 'unknown';
  if (a.next && !a.staticExport) a.warnings.push('Next.jsの実行方式は未確定です。SSR等の利用有無を「追加の条件」で確認してください。');
  if (a.staticExport && server) a.warnings.push('静的出力の設定とサーバー処理の手掛かりが両方あります。ビルドで互換性を確認してください。');
  if (a.staticExport && routeFiles.length) a.warnings.push('Route Handlerは静的生成できる場合があります。リクエスト依存の処理がないか確認してください。');
  const api = entries.find(e => e.text && /\bfetch\s*\(|\baxios\b/.test(e.text) && /\.[cm]?[jt]sx?$/.test(e.path));
  a.externalApi = Boolean(api);
  if (api) add('HTTP通信の手掛かり（公開先のサーバー要否とは別）', api.path);
  if (html) add('HTMLエントリーポイント', 'index.html');
  const outputEntries = all.filter(e => safePath(e.path) && e.path.startsWith(root)).map(e => ({ ...e, path: e.path.slice(root.length) }));
  const selection = detectOutput(entries, outputChoice, outputEntries);
  const output = selection.path;
  a.warnings.push(...selection.warnings);
  if (output !== null) {
    const assets = outputEntries.filter(e => e.path.startsWith(output) && !/(^|\/)\.[^/]+/.test(e.path));
    a.assets = { path: root + (output || './'), count: assets.length, bytes: assets.reduce((s, e) => s + e.size, 0), largest: assets.reduce((s, e) => Math.max(s, e.size), 0) };
    a.evidence.push({ label: selection.reason, path: a.assets.path });
  }
  if (!a.assets) a.warnings.push('公開容量は未確認です。「公開フォルダ」で集計対象を指定するか、ビルド後のフォルダを読み込んでください。');
  if (!a.recognized) a.warnings.push('対応するWebアプリ構成を特定できません。対象フォルダと実行方式を確認してください。');
  return a;
}
