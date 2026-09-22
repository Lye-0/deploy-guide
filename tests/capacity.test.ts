import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/analyze.ts';
import { recommend } from '../src/rules.ts';
import { capacityMetrics, capacityView, capacitySummary, detailedReasons } from '../src/capacity.ts';
import { renderReasons, reasonsText } from '../src/reason-panel.ts';
import type { Preferences } from '../src/types.ts';
const prefs: Preferences = { purpose: 'personal', budget: 'free', priority: 'simple', traffic: 'unknown', runtime: 'auto' };
const fixture = () => analyze([{ path: 'index.html', size: 2_400_000, text: '' }, { path: 'image.webp', size: 0 }]);
test('2.4 MB of 1GB yields 997.6MB remaining and .24 percent', () => {
  const a = fixture(), c = recommend(a, prefs).find(c => c.id === 'github')!;
  const v = capacityView(capacityMetrics(a, c, prefs)[0]);
  assert.equal(v.currentLabel, '2.4 MB'); assert.equal(v.remaining, '残り 997.6 MB'); assert.equal(v.percent, .24);
  assert.equal(a.scanned, 2); assert.equal(a.textRead, 1);
});
test('exact limit and one byte over are distinct', () => {
  const a = fixture(), c = recommend(a, prefs)[0], m = capacityMetrics(a, c, prefs)[0];
  assert.equal(capacityView({ ...m, current: m.limit }).status, 'full');
  const over = capacityView({ ...m, current: m.limit! + 1 });
  assert.equal(over.status, 'over'); assert.match(over.remaining, /超過/); assert.equal(over.percentLabel, '100%超');
});
test('missing and incomplete data never produce false headroom', () => {
  const a = fixture(), c = recommend(a, prefs)[0], m = capacityMetrics(a, c, prefs)[0];
  for (const v of [capacityView({ ...m, current: null }), capacityView(m, true)]) { assert.equal(v.percent, null); assert.equal(v.remaining, '算出不可'); }
  a.incomplete = true; a.capacityIncomplete = true; assert.match(capacitySummary(a, [capacityView(m, true)]), /判定できません/);
});
test('unknown traffic and no numeric file limit have no meter', () => {
  const a = fixture(), c = recommend(a, prefs)[0], m = capacityMetrics(a, c, prefs);
  assert.equal(capacityView(m[1]).percent, null); assert.equal(m[2].current, null); assert.equal(m[2].limitLabel, '100 GB / 月');
});
test('Cloudflare free vs actual Paid candidate and MiB limit', () => {
  const a = fixture();
  const c = recommend(a, { ...prefs, budget: 'paid' }).find(c => c.id === 'cloudflare')!;
  assert.equal(capacityMetrics(a, c, prefs)[1].limit, 20_000);
  a.assets!.count = 20001;
  const paid = recommend(a, { ...prefs, budget: 'paid' }).find(c => c.id === 'cloudflare')!;
  assert.equal(capacityMetrics(a, paid, prefs)[1].limit, 100_000);
  a.assets!.largest = 25 * 1024 * 1024;
  const max = capacityView(capacityMetrics(a, paid, prefs)[2]);
  assert.equal(max.currentLabel, '25 MiB'); assert.equal(max.status, 'full');
});
test('Vercel CLI sources never use deployment output totals as current', () => {
  const a = fixture(), c = recommend(a, prefs).find(c => c.id === 'vercel')!;
  const m = capacityMetrics(a, c, prefs);
  assert.equal(m[2].current, null); assert.equal(m[2].limit, 100_000_000); assert.equal(m[3].current, null);
  assert.equal(capacityMetrics(a, c, { ...prefs, purpose: 'commercial', budget: 'paid' })[2].limit, 1_000_000_000);
});
test('HTML paths escaped; copied results include metrics and scope', () => {
  const a = fixture(), c = recommend(a, prefs)[0]; a.assets!.path = '<img src=x onerror=alert(1)>';
  assert.doesNotMatch(renderReasons(a, c, prefs), /<img/);
  assert.match(reasonsText(a, c, prefs), /997.6 MB/);
  assert.match(detailedReasons(a, c, prefs)[0].body, /2ファイル.*1ファイル/);
});
