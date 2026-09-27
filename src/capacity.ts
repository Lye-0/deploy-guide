import type { Analysis, Candidate, Preferences } from './types.ts';

export const LIMITS = { githubBytes: 1_000_000_000, cloudflareFileBytes: 25 * 1024 * 1024, cloudflareFreeFiles: 20_000, cloudflarePaidFiles: 100_000 };
export type CapacityMetric = {
  label: string; current: number | null; limit: number | null;
  unit: 'MB' | 'MiB' | '件' | 'GB'; limitLabel: string; note?: string;
};
export type CapacityView = CapacityMetric & { currentLabel: string; remaining: string; percent: number | null; percentLabel: string; status: 'unknown' | 'ok' | 'near' | 'full' | 'over' };
const number = (value: number) => value.toLocaleString('ja-JP', { maximumFractionDigits: 3 });
export function amount(value: number, unit: CapacityMetric['unit']): string {
  const divisor = unit === 'MB' ? 1_000_000 : unit === 'MiB' ? 1024 * 1024 : unit === 'GB' ? 1_000_000_000 : 1;
  const n = value / divisor;
  return `${n > 0 && n < .001 ? '0.001未満' : number(n)} ${unit}`;
}
export function capacityView(metric: CapacityMetric, incomplete = false): CapacityView {
  const { current, limit, unit } = metric;
  const base = { ...metric, currentLabel: current === null ? '未確認' : amount(current, unit), percent: null, percentLabel: '', remaining: '算出不可', status: 'unknown' } as CapacityView;
  // A partial scan is only a lower bound. Never report its remainder as safe headroom.
  if (incomplete && current !== null) base.currentLabel += '（確認分）';
  if (current === null || limit === null || incomplete) return base;
  const percent = current / limit * 100;
  const percentLabel = percent > 0 && percent < .01 ? '0.01%未満' : `${percent > 99.99 && percent < 100 ? '99.99%超' : percent > 100 && percent < 100.01 ? '100%超' : percent.toLocaleString('ja-JP', { maximumFractionDigits: 2 }) + '%'}`;
  return { ...base, percent, percentLabel, remaining: current > limit ? `${amount(current - limit, unit)} 超過` : current === limit ? '残り 0（上限到達）' : `残り ${amount(limit - current, unit)}`, status: current > limit ? 'over' : current === limit ? 'full' : percent >= 80 ? 'near' : 'ok' };
}
export function capacityMetrics(a: Analysis, c: Candidate, p: Preferences): CapacityMetric[] {
  const assets = a.assets;
  const total: CapacityMetric = { label: '公開容量', current: assets?.bytes ?? null, limit: null, unit: 'MB', limitLabel: '一律の総容量上限は未確認' };
  const count: CapacityMetric = { label: '公開ファイル数', current: assets?.count ?? null, limit: null, unit: '件', limitLabel: '明示上限なし' };
  if (c.id === 'github') return [
    { ...total, limit: LIMITS.githubBytes, limitLabel: '1,000 MB（1 GB）' },
    { ...count, limitLabel: 'Pages固有の明示上限なし' },
    { label: '月間転送量', current: null, limit: 100_000_000_000, unit: 'GB', limitLabel: '100 GB / 月', note: `ソフト上限。${p.traffic === 'large' ? '回答：100 GBを超える見込み。' : p.traffic === 'small' ? '回答：100 GBより十分少ない見込み。' : ''}フォルダから実績は確認できません。` }
  ];
  if (c.id === 'cloudflare') {
    // Match the actual candidate plan, not merely willingness to pay.
    const paid = c.plan.includes('Paid');
    return [total,
      { ...count, limit: paid ? LIMITS.cloudflarePaidFiles : LIMITS.cloudflareFreeFiles, limitLabel: `${(paid ? LIMITS.cloudflarePaidFiles : LIMITS.cloudflareFreeFiles).toLocaleString('ja-JP')} 件（${paid ? 'Paid' : 'Free'}）` },
      { label: '最大ファイル容量', current: assets?.largest ?? null, limit: LIMITS.cloudflareFileBytes, unit: 'MiB', limitLabel: '25 MiB / ファイル', note: '最も大きい1ファイルを上限と比較しています。' }
    ];
  }
  const pro = p.purpose === 'commercial';
  return [total, { ...count, limitLabel: 'ビルド出力ファイルは上限なし' },
    { label: 'CLI送信ソース容量', current: null, limit: pro ? 1_000_000_000 : 100_000_000, unit: 'MB', limitLabel: pro ? '1,000 MB（Proの場合）' : '100 MB（Hobby）', note: 'CLIで送るソースの制限です。公開容量とは別のため、残りは算出しません。Git連携への適用はありません。' },
    { label: 'CLI送信ソース数', current: null, limit: 15_000, unit: '件', limitLabel: '15,000 件', note: '除外設定・送信方法が未確認のため、確認ファイル数では代用しません。' }
  ];
}
export function capacitySummary(a: Analysis, views: CapacityView[]): string {
  if (!a.assets) return '公開容量は未確認です';
  if (a.capacityIncomplete ?? a.incomplete) return '一部未確認のため、余裕は判定できません';
  if (views.some(v => v.status === 'over')) return '確認した指標に上限超過があります';
  if (views.some(v => v.status === 'full')) return '確認した指標が上限に達しています';
  if (views.some(v => v.status === 'near')) return '確認した指標の使用率が80%以上です';
  if (views.some(v => v.status === 'ok')) return '比較できた指標は上限の80%未満です';
  return '公開サイズを確認しました';
}
export function detailedReasons(a: Analysis, c: Candidate, p: Preferences): { title: string; body: string }[] {
  const runtime = p.runtime === 'auto' ? a.runtime : p.runtime;
  const intro = `対象の${a.scanned.toLocaleString('ja-JP')}ファイルを確認し、うち${a.textRead.toLocaleString('ja-JP')}ファイルの内容を読み取りました。`;
  const body = p.runtime !== 'auto' ? '実行方式は利用者の指定を優先しています。' : a.runtimeReason ?? '実行方式は確認が必要です。';
  const purpose = { personal: '個人・非商用', commercial: '事業・商用', unknown: '用途は未定' }[p.purpose];
  const priority = { simple: '手軽さ', growth: '拡張性', preview: 'プレビュー' }[p.priority];
  return [
    { title: runtime === 'static' ? '静的配信の構成として評価しています' : runtime === 'server' ? 'サーバー処理を配置できる候補です' : '実行方式の確認が必要です', body: intro + body },
    { title: '選んだ運用条件との相性', body: `「${purpose}」「${p.access === 'restricted' ? '閲覧制限あり' : p.access === 'public' ? '一般公開' : '閲覧範囲は未定'}」「${p.budget === 'free' ? '無料で運用' : '有料も検討'}」「${priority}」で比較しています。${c.reasons.slice(0, 3).join(' ')}` }
  ];
}
