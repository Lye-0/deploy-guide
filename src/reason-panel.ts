import type { Analysis, Candidate, Preferences } from './types.ts';
import { capacityMetrics, capacityView, capacitySummary, detailedReasons } from './capacity.ts';
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const source = (id: Candidate['id']) => id === 'github' ? 'https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits' : id === 'cloudflare' ? 'https://developers.cloudflare.com/workers/platform/limits/' : 'https://vercel.com/docs/limits';
export function renderCapacity(a: Analysis, c: Candidate, p: Preferences): string {
  const views = capacityMetrics(a, c, p).map(m => capacityView(m, a.incomplete));
  return `<section class="capacity-panel" aria-label="${esc(c.name)}の公開サイズと上限"><div class="capacity-heading"><h5>${esc(capacitySummary(a, views))}</h5><a href="${source(c.id)}" target="_blank" rel="noopener noreferrer">公式の上限 ↗</a></div><p class="capacity-scope">${a.assets ? `集計対象：<code>${esc(a.assets.path)}</code> ・ ${a.assets.count.toLocaleString('ja-JP')}公開ファイル` : 'ビルド済みの公開フォルダを選ぶと、容量を比較できます。'}</p><div class="capacity-metrics">${views.map(v => `<div class="capacity-metric ${v.status}"><h6>${esc(v.label)}</h6><dl><div><dt>現在値</dt><dd>${esc(v.currentLabel)}</dd></div><div><dt>上限</dt><dd>${esc(v.limitLabel)}</dd></div><div><dt>余裕</dt><dd>${esc(v.remaining)}</dd></div></dl>${v.percent !== null ? `<div class="usage-line"><meter min="0" max="100" value="${Math.min(100, v.percent)}" aria-label="${esc(v.label)}の使用率" aria-valuetext="使用率 ${esc(v.percentLabel)}"></meter><span>使用率 ${esc(v.percentLabel)}</span></div>` : ''}${v.note ? `<p class="capacity-note">${esc(v.note)}</p>` : ''}</div>`).join('')}</div><p class="capacity-note">${a.incomplete ? '確認できた分だけの集計です。未確認分があるため残りと使用率は表示しません。' : '選択フォルダの集計値です。実際に公開する内容との一致を確認してください。'} MB = 1,000,000 B / MiB = 1,048,576 B。</p></section>`;
}
export function renderReasons(a: Analysis, c: Candidate, p: Preferences): string {
  const reasons = detailedReasons(a, c, p);
  const item = (r: typeof reasons[number]) => `<div class="reason-detail"><h5><span aria-hidden="true">✓</span>${esc(r.title)}</h5><p>${esc(r.body)}</p></div>`;
  return `<div class="reasons"><h4>このプロジェクトに合う理由</h4>${item(reasons[0])}${renderCapacity(a, c, p)}${item(reasons[1])}</div>`;
}
export function reasonsText(a: Analysis, c: Candidate, p: Preferences): string {
  return detailedReasons(a, c, p).map(r => `${r.title}\n${r.body}`).join('\n') + '\n' + capacityMetrics(a, c, p).map(m => {
    const v = capacityView(m, a.incomplete);
    return `${v.label}：${v.currentLabel} / 上限 ${v.limitLabel} / ${v.remaining}${v.percent !== null ? ' / 使用率 ' + v.percentLabel : ''}${v.note ? '\n' + v.note : ''}`;
  }).join('\n');
}
