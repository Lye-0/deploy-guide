import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/analyze.ts';
import { detectOutput, normalizeOutputPath } from '../src/output-directory.ts';
import type { Entry } from '../src/types.ts';
const file = (path: string, text?: string, size = 100): Entry => ({ path, text, size });
test('package.json static project can explicitly publish the root', () => {
  const files = [file('package.json', '{}'), file('index.html'), file('style.css'), file('.env', 'secret'), file('node_modules/a.js')];
  assert.equal(analyze(files).assets, null);
  const a = analyze(files, '', 'site', [], './');
  assert.equal(a.assets!.count, 3); assert.equal(a.assets!.bytes, 300);
  assert.match(a.evidence.at(-1)!.label, /利用者/);
});
test('output without index.html is supported', () => { assert.equal(analyze([file('dist/about.html'), file('dist/site.js')]).assets!.count, 2); });
test('Vite literal output takes precedence over stale dist', () => {
  const a = analyze([file('vite.config.ts', "export default { build: { outDir: 'website' } }"), file('website/about.html'), file('dist/index.html')]);
  assert.equal(a.assets!.path, 'website/'); assert.equal(a.assets!.count, 1);
});
test('Vercel config supports custom folder', () => { assert.equal(analyze([file('vercel.json', '{"outputDirectory":"docs/site"}'), file('docs/site/a.js')]).assets!.path, 'docs/site/'); });
test('Wrangler JSONC supports comments and trailing commas without changing quoted content', () => {
  const a = analyze([file('wrangler.jsonc', '{ // comment\n "assets": {"directory": "site",}, "url": "https://example.com" }'), file('site/main.js')]);
  assert.equal(a.assets!.path, 'site/');
});
test('Wrangler TOML root and assets table, not env-specific values', () => {
  for (const text of ['[assets]\ndirectory = "website" # note\n[env.preview.assets]\ndirectory = "other"', 'pages_build_output_dir = "website"']) {
    assert.equal(analyze([file('wrangler.toml', text), file('website/a.js')]).assets!.path, 'website/');
  }
});
test('missing configured directory never falls back to stale dist', () => {
  const a = analyze([file('vercel.json', '{"outputDirectory":"website"}'), file('dist/index.html')]);
  assert.equal(a.assets, null); assert.match(a.warnings.join(''), /website/);
});
test('conflicting configurations and multiple conventional folders need manual selection', () => {
  const files = [file('vercel.json', '{"outputDirectory":"site"}'), file('wrangler.json', '{"assets":{"directory":"public"}}'), file('site/a.js'), file('public/b.js')];
  assert.equal(analyze(files).assets, null); assert.equal(analyze(files, '', 'site', [], 'site/').assets!.count, 1);
  assert.equal(analyze([file('dist/index.html'), file('out/index.html')]).assets, null);
});
test('dynamic expressions and spread do not execute or incorrectly use literal prefix', () => {
  for (const code of ["build: {outDir: process.env.OUT}", "build: {outDir: 'site' + suffix}", "build: {...other, outDir: 'site'}"]) {
    assert.equal(detectOutput([file('vite.config.ts', `export default {${code}}`), file('site/a.js'), file('dist/a.js')]).path, null);
  }
});
test('commented out configuration is ignored', () => {
  assert.equal(analyze([file('vite.config.ts', "// build: {outDir:'wrong'}\nexport default {build:{outDir:'site'}}"), file('site/a.js')]).assets!.path, 'site/');
});
test('paths stay inside the selected application', () => {
  for (const path of ['../site', '/site', 'C:\\site', 'https://site', 'a/../site']) assert.equal(normalizeOutputPath(path), null);
  assert.equal(normalizeOutputPath('./docs//site/'), 'docs/site/');
  assert.equal(normalizeOutputPath('./'), '');
  assert.equal(analyze([file('dist/a.js')], '', 'site', [], '../').assets, null);
});
test('monorepo output is resolved relative to selected app and nested output metadata is counted', () => {
  const a = analyze([file('apps/web/package.json','{}'), file('apps/web/vercel.json','{"outputDirectory":"site"}'), file('apps/web/site/package.json','{}'), file('apps/web/site/a.js'), file('apps/api/site/a.js')], 'apps/web/');
  assert.equal(a.assets!.path, 'apps/web/site/'); assert.equal(a.assets!.count, 2);
});
