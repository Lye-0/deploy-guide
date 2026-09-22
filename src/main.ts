import './style.css';
import { enhanceSelects } from './dropdown.ts';
import { renderReasons, renderCapacity, reasonsText } from './reason-panel.ts';
import { projectRoots } from './inventory.ts';
import { outputFolders } from './output-directory.ts';
import { recommend, SOURCES } from './rules.ts';
import type { Analysis, Entry, Preferences, Candidate } from './types.ts';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
let current: Analysis | null = null, worker: Worker | null = null;
let analysisWorker: Worker | null = null, analysisId = 0;
let entries: Entry[] = [], projectName = '', scanWarnings: string[] = [];
const prefs = (): Preferences => ({
  purpose: document.querySelector<HTMLInputElement>('input[name="purpose"]:checked')!.value as Preferences['purpose'],
  budget: document.querySelector<HTMLInputElement>('input[name="budget"]:checked')!.value as Preferences['budget'],
  priority: document.querySelector<HTMLInputElement>('input[name="priority"]:checked')!.value as Preferences['priority'],
  traffic: $('traffic') instanceof HTMLSelectElement ? ($<HTMLSelectElement>('traffic').value as Preferences['traffic']) : 'unknown',
  runtime: $<HTMLSelectElement>('runtime').value as Preferences['runtime']
});
const formatBytes = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`;
const icon = (c: Candidate) => c.id === 'github' ? '◉' : c.id === 'vercel' ? '▲' : '☁';
const list = (items: string[], className = '') => `<ul class="text-list ${className}">${items.map(t => `<li>${escape(t)}</li>`).join('')}</ul>`;
function render() {
  refreshSelects();
  if (!current) {
    $('result-state').textContent = '解析待ち';
    $('result').innerHTML = `<div class="empty-result"><div class="orbit" aria-hidden="true"><span class="orbit-center">↗</span><span class="orbit-dot dot-one">◉</span><span class="orbit-dot dot-two">▲</span><span class="orbit-dot dot-three">☁</span></div><p class="eyebrow">YOUR PROJECT, YOUR DESTINATION</p><h3>次の公開先を、見つけよう。</h3><p>フォルダを選ぶと、ここに<br />おすすめと判断理由が表示されます。</p><div class="empty-foot"><span>構成を読み取り</span><span aria-hidden="true">→</span><span>3つの公開先を比較</span></div></div>`;
    return;
  }
  const p = prefs();
  const candidates = recommend(current, p), best = candidates.find(c => !c.blocked && !c.conditional);
  const unknown = (current.runtime === 'unknown' && p.runtime === 'auto');
  const provisional = current.incomplete || p.purpose === 'unknown' || (current.runtime === 'unknown' && p.runtime === 'auto');
  $('result-state').textContent = unknown ? '構成の確認が必要' : provisional ? '暫定のおすすめ' : '解析完了';
  const runtime = p.runtime === 'auto' ? current.runtime : p.runtime;
  const badges = `<div class="detected"><span>${escape(current.framework)}</span><span>${runtime === 'static' ? '静的配信' : runtime === 'server' ? 'サーバー処理あり' : '実行方式は要確認'}</span></div>`;
  let primary = '';
  if (unknown || !best) primary = `<article class="recommendation needs-check"><p class="eyebrow">LET’S CHECK ONE MORE THING</p><h3>${unknown ? '構成を確認してください' : '構成・条件の見直しが必要です'}</h3><p>${unknown ? '実行方式を確定する根拠が不足しています。下の未確認事項を確認するか、追加の条件で実行方式を指定してください。' : '現在の条件では、そのままおすすめできる公開先がありません。以下の制限・実行環境との互換性を確認してください。'}</p>${badges}${list(current.warnings.slice(0, 3))}</article>`;
  else primary = `<article class="recommendation ${best.id}"><div class="recommendation-top"><span class="recommend-label">${provisional ? '暫定のおすすめ' : 'おすすめの公開先'}</span><span class="match-mark" aria-hidden="true">↗</span></div><h3><span class="provider-icon" aria-hidden="true">${icon(best)}</span>${best.name}</h3><p class="plan">${escape(best.plan)}</p>${badges}${renderReasons(current, best, p)}</article><section class="cautions"><h3><span aria-hidden="true">!</span> 公開前に確認すること</h3>${list(best.cautions.slice(0, 3))}${best.cautions.length > 3 ? `<details><summary>ほか${best.cautions.length - 3}件の確認点</summary>${list(best.cautions.slice(3))}</details>` : ''}</section>`;
  $('result').innerHTML = `${primary}<section class="alternatives"><h3>${!best || unknown ? '各サービスの条件' : 'ほかの選択肢'}</h3>${candidates.filter(c => !best || unknown || c.id !== best.id).map(c => `<details class="alternative"><summary><span class="alternative-name"><b aria-hidden="true">${icon(c)}</b>${c.name}</span><span class="status-tag ${c.blocked ? 'hold' : ''}">${c.blocked ? '条件の変更が必要' : c.conditional ? '互換性・構成は要確認' : '候補'}</span></summary><div class="alternative-body"><p>${escape(c.condition)}</p>${renderCapacity(current!, c, p)}${list(c.cautions)}<p class="muted small">${escape(c.plan)}</p></div></details>`).join('')}</section><details class="evidence"><summary>解析の根拠・未確認事項 <span>${current.evidence.length}件の手掛かり</span></summary><dl class="scan-facts"><div><dt>対象</dt><dd>${escape(current.name)}</dd></div><div><dt>確認ファイル</dt><dd>${current.scanned.toLocaleString()}件（内容読取 ${current.textRead.toLocaleString()}件）</dd></div><div><dt>公開容量</dt><dd>${current.assets ? `${formatBytes(current.assets.bytes)} / ${current.assets.count.toLocaleString()}ファイル` : '未確認'}</dd></div>${current.assets ? `<div><dt>集計対象</dt><dd>${escape(current.assets.path)}</dd></div>` : ''}</dl><ul class="evidence-list">${current.evidence.map(e => `<li>${escape(e.label)}<code>${escape(e.path)}</code></li>`).join('')}</ul>${current.warnings.length ? `<h4>未確認・補足</h4>${list(current.warnings)}` : ''}<p class="help">静的解析による提案です。ビルド、実際の動作、配信速度は未検証です。利用条件の回答も判定に使用しています。</p></details><div class="result-bottom"><span>基準確認：2026.09.22</span><button class="quiet small" id="copy-result">結果をコピー <span aria-hidden="true">↗</span></button></div>`;
  $('copy-result').addEventListener('click', async () => {
    const text = `Deploy Guide\n対象：${current!.name}\n${unknown ? '構成の確認が必要' : best ? `${provisional ? '暫定の' : ''}おすすめ：${best.name} / ${best.plan}\n理由：\n${reasonsText(current!, best, p)}\n確認点：\n${best.cautions.join('\n')}` : '構成・条件の見直しが必要'}\n未確認事項：\n${current!.warnings.join('\n')}\n基準確認：2026-09-22\n静的解析による提案。ビルド・動作・速度は未検証。`;
    try { await navigator.clipboard.writeText(text); $('copy-result').textContent = 'コピーしました'; } catch { $('copy-result').textContent = 'コピーできませんでした'; }
  });
}
function stop(message = '') {
  worker?.terminate(); worker = null;
  $<HTMLButtonElement>('choose-folder').disabled = false;
  $('cancel-scan').hidden = true;
  $('scan-status').textContent = message;
  $('folder-zone').classList.remove('scanning');
}
function analyzeSelection(resetOutput = false) {
  const root = $<HTMLSelectElement>('project-select').value;
  const select = $<HTMLSelectElement>('output-select');
  if (resetOutput) {
    const scoped = entries.filter(e => e.path.startsWith(root)).map(e => ({ ...e, path: e.path.slice(root.length) }));
    select.innerHTML = '<option value="auto">設定・フォルダ名から自動検出</option><option value="./">このアプリのフォルダ全体を公開対象にする</option>' + outputFolders(scoped).map(p => `<option value="${escape(p)}">${escape(p)}</option>`).join('');
    select.value = 'auto';
  }
  analysisWorker?.terminate();
  const id = ++analysisId;
  analysisWorker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
  $('output-picker').hidden = false;
  $('output-status').textContent = '参照関係と実行方式を解析しています…';
  current = null; render();
  $('result-state').textContent = '解析中';
  const failed = () => { if (id !== analysisId) return; $('output-status').textContent = '構成を解析できませんでした。対象アプリを絞って再選択してください。'; $('result-state').textContent = '要確認'; analysisWorker?.terminate(); };
  analysisWorker.onerror = failed;
  analysisWorker.onmessage = ({data}) => {
    if (data.id !== analysisId) return;
    if (data.error) { failed(); return; }
    current = data.analysis;
    $('scan-status').textContent = '解析が完了しました';
    analysisWorker?.terminate(); analysisWorker = null;
    if (!current) return;
  $('output-picker').hidden = false;
  $('output-status').textContent = current.assets
    ? `${select.value === 'auto' ? '自動検出' : '指定済み'}：${current.assets.path} ・ ${current.assets.count.toLocaleString()}ファイル`
    : '公開先を特定できませんでした。集計するフォルダを選んでください。';
  render();
  };
  analysisWorker.postMessage({ id, entries, root, name: projectName + (root ? '/' + root.replace(/\/$/, '') : ''), warnings: scanWarnings, output: select.value });
}
function applyEntries(newEntries: Entry[], name: string, warnings: string[] = []) {
  entries = newEntries; projectName = name; scanWarnings = warnings;
  const roots = projectRoots(entries);
  const select = $<HTMLSelectElement>('project-select');
  select.innerHTML = roots.map(p => `<option value="${escape(p)}">${escape(p || 'ルートフォルダ')}</option>`).join('');
  $('project-picker').hidden = roots.length <= 1;
  // For a monorepo, start with an app rather than a package-less workspace root.
  const root = !entries.some(e => e.path === 'package.json' || e.path === 'index.html') && roots.length > 1 ? roots[1] : '';
  select.value = root;
  $('folder-name').textContent = name;
  $('folder-hint').textContent = `${entries.length.toLocaleString()}ファイルを確認しました`;
  $('choose-folder').innerHTML = '別のフォルダを選ぶ <span aria-hidden="true">↗</span>';
  analyzeSelection(true);
}
function scan(payload: object) {
  stop(); analysisWorker?.terminate(); analysisId++; current = null; render();
  $('project-picker').hidden = true;
  $('output-picker').hidden = true;
  $<HTMLSelectElement>('runtime').value = 'auto';
  $('scan-status').textContent = 'ファイルを確認しています…';
  $('folder-zone').classList.add('scanning');
  $<HTMLButtonElement>('choose-folder').disabled = true;
  $('cancel-scan').hidden = false;
  try {
    worker = new Worker(new URL('./scan.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') $('scan-status').textContent = `${data.count.toLocaleString()}ファイルを確認中…`;
      else if (data.type === 'complete') { stop('読み込みが完了しました'); applyEntries(data.entries, data.name, data.warnings); }
      else if (data.type === 'error') stop(data.message);
    };
    worker.onerror = () => stop('解析を開始できませんでした。ページを再読み込みしてお試しください。');
    worker.postMessage(payload);
  } catch { stop('この環境では解析を開始できません。別のブラウザでお試しください。'); }
}
$('choose-folder').addEventListener('click', async () => {
  const picker = (window as unknown as { showDirectoryPicker?: (options: { mode: string }) => Promise<unknown> }).showDirectoryPicker;
  if (picker) {
    try { const handle = await picker.call(window, { mode: 'read' }); scan({ handle }); }
    catch (error) { if ((error as Error).name !== 'AbortError') { $('scan-status').textContent = '標準のフォルダ選択を使用します。'; $<HTMLInputElement>('folder-input').click(); } }
  } else $<HTMLInputElement>('folder-input').click();
});
$('folder-input').addEventListener('change', () => { const input = $<HTMLInputElement>('folder-input'); if (input.files?.length) scan({ files: Array.from(input.files) }); input.value = ''; });
$('cancel-scan').addEventListener('click', () => stop('解析をキャンセルしました。別のフォルダを選べます。'));
$('project-select').addEventListener('change', () => analyzeSelection(true));
$('output-select').addEventListener('change', () => analyzeSelection());
document.querySelectorAll('input[type="radio"], #traffic, #runtime').forEach(input => input.addEventListener('change', render));
const dialog = $<HTMLDialogElement>('sources-dialog');
$('sources-list').innerHTML = SOURCES.map(s => `<article class="source"><a href="${s.url}" target="_blank" rel="noopener noreferrer">${escape(s.name)} ↗</a><p>${escape(s.note)}</p></article>`).join('');
for (const id of ['about-button', 'sources-button']) $(id).addEventListener('click', () => dialog.showModal());
$('close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } });
const refreshSelects = enhanceSelects();
render();
