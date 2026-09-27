import type { Analysis, Candidate, Preferences } from './types.ts';
import { LIMITS } from './capacity.ts';
export const SOURCES = [
  { name: 'GitHub Pages：容量・帯域・利用目的の制限', url: 'https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits', note: '公開サイト1 GB、月100 GBのソフト帯域上限。EC・商用SaaS等の用途に制限。' },
  { name: 'Vercel：Hobbyプラン', url: 'https://vercel.com/docs/plans/hobby', note: 'Hobbyは個人・非商用向け。商用は有料プランを検討。' },
  { name: 'Cloudflare：Static Assetsの料金', url: 'https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/', note: '静的アセットへのリクエストは無料・無制限。Worker実行は別枠。' },
  { name: 'Cloudflare：Workersの上限', url: 'https://developers.cloudflare.com/workers/platform/limits/', note: '無料枠は20,000アセット、1ファイル25 MiB。動的処理は100,000リクエスト/日、CPU 10 ms/回。' },
  { name: 'Cloudflare：Next.jsの対応', url: 'https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/', note: 'vinext（ベータ）やOpenNext等の経路について、バージョン・機能の互換性確認が必要。' },
  { name: 'Next.js：静的エクスポート', url: 'https://nextjs.org/docs/app/guides/static-exports', note: 'output: exportでも、機能によって静的出力できない場合があります。' },
  { name: 'Vercel：Next.jsの統合', url: 'https://vercel.com/docs/frameworks/full-stack/nextjs', note: 'Next.js向けのデプロイ統合とPRプレビュー。' },
  { name: 'Cloudflare：WorkerとAccess', url: 'https://developers.cloudflare.com/workers/configuration/cloudflare-access/', note: 'AccessでWorkerの本番とプレビュー、静的アセットへのアクセスを制限できます。' },
  { name: 'Cloudflare：Zero Trustの料金', url: 'https://www.cloudflare.com/plans/', note: 'Zero Trust Freeは50ユーザーまで。' },
  { name: 'Vercel：Deployment Protection', url: 'https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication', note: 'Vercel Authenticationは全プランで利用可能。本番を含む全URLの保護と閲覧者の条件を確認。' },
  { name: 'GitHub Pages：非公開サイトの条件', url: 'https://docs.github.com/en/enterprise-cloud@latest/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site', note: '非公開のPagesサイトにはGitHub Enterprise Cloudを使う組織などの条件があります。' }
];
export function recommend(a: Analysis, p: Preferences): Candidate[] {
  const runtime = p.runtime === 'auto' ? a.runtime : p.runtime;
  const gh: Candidate = { id: 'github', name: 'GitHub Pages', plan: 'GitHub Pages', score: 0, blocked: false, reasons: [], cautions: [], condition: '静的配信で完結し、GitHubで管理したい場合に。' };
  const vc: Candidate = { id: 'vercel', name: 'Vercel', plan: p.purpose === 'commercial' ? 'Pro等の有料プラン' : 'Hobby（個人・非商用）', score: 0, blocked: false, reasons: [], cautions: [], condition: 'Next.jsの統合やPRプレビューを重視する場合に。' };
  const cf: Candidate = { id: 'cloudflare', name: 'Cloudflare', plan: 'Workers + Static Assets', score: 0, blocked: false, reasons: [], cautions: [], condition: 'APIの追加や配信量の増加に備えたい場合に。' };
  gh.cautions.push('公開サイト1 GB、月100 GBのソフト帯域上限があります。');
  vc.cautions.push('Hobbyは個人・非商用向けです。利用量・機能ごとの上限を確認してください。');
  cf.cautions.push('静的アセットは1ファイル25 MiBまで。無料枠は20,000ファイルまでです。');
  if (runtime === 'unknown') for (const c of [gh,vc,cf]) c.conditional = true;
  if (runtime === 'server') {
    vc.conditional = !['next', 'functions'].includes(a.runtimeKind ?? '');
    cf.conditional = a.runtimeKind !== 'worker';
    if (a.runtimeKind === 'node') {
      vc.cautions.unshift('Nodeの常駐HTTPサーバーを検出しました。Functionsへの変換・互換性確認が必要です。');
      cf.cautions.unshift('Nodeの常駐HTTPサーバーを検出しました。Workersへの変換・互換性確認が必要です。');
    }
    gh.blocked = true; gh.cautions.unshift('この公開先でサーバー処理が必要なため、GitHub Pages単体では動かせません。');
    vc.reasons.push('サーバー側のAPIやSSRを配置できます。'); cf.reasons.push('WorkerでAPIやサーバー側処理を実行できます。');
    cf.cautions.push('Workersの実行環境との互換性が必要です。無料枠は日10万リクエスト・CPU 10 ms/回で、SSR等は有料枠が必要になる場合があります。');
    vc.cautions.push('常駐サーバーをそのまま動かす構成は適合しません。Functions向けの構成確認が必要です。');
  } else if (runtime === 'static') {
    gh.reasons.push('静的ファイルの配信で完結する構成です。'); cf.reasons.push('静的アセットへのリクエストは無料・無制限です。'); vc.reasons.push('静的サイトとして公開できます。');
  } else {
    gh.score -= 30; gh.cautions.unshift('静的配信で完結することを確認できていません。');
    cf.cautions.push('実行方式が未確定のため、Workersへの適合性は未確認です。');
  }
  if (runtime === 'static' && a.staticHost === 'cloudflare') {
    cf.score += 20;
    cf.reasons.push('既存のCloudflare静的配信設定が集計対象と一致しており、構成の変更を抑えられます。');
  }
  if (runtime === 'static' && a.historyRouting) {
    gh.conditional = true;
    gh.cautions.unshift('BrowserRouter等の履歴ベースのルーティングがあります。途中のURLへの直接アクセスと公開パスへの対応が必要です。');
    for (const c of [cf, vc]) c.cautions.push('SPAの途中のURLを直接開けるよう、index.htmlへのフォールバック設定を確認してください。');
  }
  if (a.next && runtime !== 'static') { vc.score += 45; vc.reasons.unshift('Next.jsのデプロイ統合を利用でき、構成変更を抑えやすいためです。'); cf.cautions.push('Next.jsはvinext（ベータ）やOpenNext等の対応経路・互換性確認が必要です。'); }
  if (a.worker) { cf.score += 40; cf.reasons.unshift('Cloudflare向けの設定または依存関係が見つかりました。'); }
  if (p.purpose === 'commercial') {
    gh.conditional = true; gh.cautions.unshift('EC・商用SaaS等には利用制限があります。事業の具体的用途が未確認のため適合判定を保留しています。');
    if (p.budget === 'free') { vc.blocked = true; vc.cautions.unshift('商用利用と無料必須の条件では、Hobbyを選べません。'); }
    cf.reasons.push('Vercel Hobbyの個人・非商用限定という条件を避けられます。利用規約・無料枠は別途確認が必要です。');
  }
  if (p.purpose === 'unknown') { vc.cautions.unshift('用途が未定です。Hobbyを利用できるか確認してください。'); gh.cautions.push('用途が未定です。EC・商用SaaS等には用途制限があります。'); }
  if (p.priority === 'simple' && runtime === 'static') { gh.score += 15; gh.reasons.push('GitHubでソースと公開をまとめて管理する、シンプルな運用に向きます。'); }
  if (p.priority === 'growth') { cf.score += 25; cf.reasons.push('将来のAPI・D1・R2などへの拡張を重視しています。'); }
  if (p.priority === 'preview') { vc.score += 30; vc.reasons.push('PRごとのプレビューを利用した運用に向いています。'); }
  if (p.traffic === 'large') { gh.blocked = true; gh.cautions.unshift('見込み配信量が月100 GBのソフト上限を超えます。'); cf.score += 25; cf.reasons.push('配信量が多い想定で、静的アセットの無料・無制限配信が合います。'); vc.cautions.push('配信量の条件に応じたプラン・追加費用を確認してください。'); }
  if (a.assets) {
    if (a.assets.bytes > LIMITS.githubBytes) { gh.blocked = true; gh.cautions.unshift('検出した公開フォルダが1 GBを超えています。'); }
    if (a.assets.largest > LIMITS.cloudflareFileBytes) { cf.blocked = true; cf.cautions.unshift('25 MiB超のファイルがあります。R2等への分離かファイル削減が必要です。'); }
    if (a.assets.count > (p.budget === 'free' ? LIMITS.cloudflareFreeFiles : LIMITS.cloudflarePaidFiles)) { cf.blocked = true; cf.cautions.unshift('アセット数が選択した料金条件の上限を超えています。'); }
    if (a.assets.count > LIMITS.cloudflareFreeFiles && p.budget === 'paid') cf.plan = 'Workers Paid + Static Assets';
  }
  if (a.externalApi) for (const c of [gh, vc, cf]) c.cautions.push('HTTP通信を検出しました。ブラウザから呼ぶ場合はCORSと公開可能な認証方式を確認してください。');
  if (p.runtime === 'static' && a.runtime === 'server') for (const c of [gh, vc, cf]) c.cautions.unshift('回答に従い静的配信として評価しています。検出したサーバー処理が別の公開先にあるか確認してください。');
  if (p.access === 'restricted') {
    cf.score += 45;
    cf.plan += ' + Access';
    cf.condition = 'Cloudflare Accessで許可した閲覧者だけに配信する場合に。';
    cf.reasons.unshift('Cloudflare AccessでWorkerの本番・プレビューと静的アセットを保護できます。');
    cf.cautions.unshift('公開前にAccessのAllowポリシーを設定し、本番・プレビュー・画像を含む全URLを未認証では開けないことを確認してください。Zero Trust Freeは50ユーザーまでです。');
    vc.score += 18;
    vc.plan += ' + Vercel Authentication';
    vc.condition = 'Vercelアカウントで閲覧者を管理する場合に。';
    vc.reasons.unshift('Vercel Authenticationで本番を含む全デプロイへのアクセスを制限できます。');
    vc.cautions.unshift('公開前にDeployment Protectionを「All Deployments」に設定してください。閲覧者にはアクセスを許可されたVercelアカウントが必要で、Hobbyの外部閲覧者は1人までです。');
    gh.conditional = true;
    gh.condition = 'GitHub Enterprise Cloudの組織で非公開Pagesを使える場合に。';
    gh.cautions.unshift('通常のGitHub Pagesは公開サイトです。非公開PagesにはGitHub Enterprise Cloudの組織などの条件があります。非公開リポジトリだけでは閲覧制限になりません。');
    if (p.budget === 'free') gh.blocked = true;
  } else if (p.access === 'unknown') {
    for (const c of [gh, vc, cf]) c.cautions.unshift('閲覧範囲が未定です。この提案は配信構成の比較です。閲覧制限が必要なら条件を変更してください。');
  }
  return [gh, vc, cf].sort((a, b) => Number(a.blocked) - Number(b.blocked) || Number(!!a.conditional) - Number(!!b.conditional) || b.score - a.score);
}
