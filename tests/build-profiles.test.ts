import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectOutput } from '../src/output-directory.ts';
import { buildProfiles, viteProfile } from '../src/build-profiles.ts';
import { analyze } from '../src/analyze.ts';
import { recommend } from '../src/rules.ts';
const f = (path: string, text = '') => ({path,text,size:100});
const config = `export default defineConfig(({mode})=>({build:{outDir:mode === 'public' ? 'release' : 'personal'}}))`;
function files(scripts = {build:'vite build', 'build:public':'vite build --mode public'}) {
  return [f('package.json',JSON.stringify({scripts,devDependencies:{vite:'7'}})),f('vite.config.ts',config),f('personal/index.html'),f('release/index.html')];
}
test('all declared build modes yield separate output candidates',()=>{
  const a=detectOutput(files()); assert.equal(a.path,null);
  assert.deepEqual(a.profiles?.map(p=>[p.mode,p.output]),[['production','personal'],['public','release']]);
  assert.match(a.warnings.join(''),/build:public/);
});
test('shared output folders disclose that the measured files have unknown build provenance',()=>{
  const entries=[f('package.json',JSON.stringify({scripts:{build:'vite build','build:pages':'vite build --mode pages'},devDependencies:{vite:'7'}})),f('index.html','<h1>site</h1>'),f('dist/index.html','<h1>built</h1>')];
  const selection=detectOutput(entries);
  assert.equal(selection.path,'dist/');
  assert.match(selection.warnings.join(''),/どのビルドで作成されたか/);
  const analysis=analyze(entries);
  assert.equal(analysis.runtime,'static');
  assert.equal(analysis.assets?.count,1);
});
test('hosting output reconciles matching modes, without merging artifacts',()=>{
  const a=detectOutput([...files(),f('wrangler.jsonc','{"assets":{"directory":"personal"}}')]);
  assert.equal(a.path,'personal/');assert.match(a.reason,/production/);assert.match(a.warnings.join(''),/release/);
});
test('default script and aliased mode parameter need no hardcoded folder names',()=>{
  assert.equal(viteProfile(`export default defineConfig(({mode: edition})=>{const out=edition==='festival'?'showcase':'archive';return {build:{outDir:out}}})`,'festival'),'showcase');
  assert.equal(viteProfile(`export default defineConfig(context=>({build:{outDir:context.mode==='festival'?'showcase':'archive'}}))`,'production'),'archive');
  assert.equal(detectOutput(files({build:'vite build -m public'})).path,'release/');
});
test('script references and literal CLI output overrides are traced',()=>{
  const entries=files({build:'pnpm run bundle', 'build:public':'vite build --mode=public'});
  entries[0]=f('package.json',JSON.stringify({scripts:{build:'pnpm run bundle',bundle:'tsc -b && vite build --outDir release'}}));
  assert.equal(detectOutput(entries).path,'release/');
});
test('missing selected output does not fall back to another edition',()=>{
  const entries=files().filter(e=>e.path!=='personal/index.html');entries.push(f('wrangler.json','{"assets":{"directory":"personal"}}'));
  const a=detectOutput(entries);assert.equal(a.path,null);assert.match(a.warnings.join(''),/未生成/);
});
test('contradictory providers and absent matches remain unresolved',()=>{
  for(const extra of [[f('wrangler.json','{"assets":{"directory":"elsewhere"}}')],[f('wrangler.json','{"assets":{"directory":"personal"}}'),f('vercel.json','{"outputDirectory":"release"}')]]) assert.equal(detectOutput([...files(),...extra]).path,null);
});
test('dynamic environment, custom config, shell wrappers and cyclic scripts are not guessed',()=>{
  for(const cmd of ['vite build --mode $MODE','vite build --config alternate.ts','cross-env MODE=public vite build','node custom-build.js','pnpm build']) {
    const a=detectOutput(files({build:cmd,'build:public':cmd})); assert.equal(a.path,null,cmd);
  }
});
test('configuration mutations and unknown calls are not executed',()=>{
  for(const code of [`const cfg={build:{outDir:'personal'}};cfg.build.outDir='release';export default cfg`, `export default getConfig()`, `export default defineConfig(({mode})=>({build:{outDir:compute(mode)}}))`]) assert.equal(viteProfile(code,'production'),undefined);
});
test('manual edition choice retains runtime and measures only that edition',()=>{
  const a=analyze([...files(),f('index.html','<h1>Hello</h1>')],'','gallery',[],'release/');
  assert.equal(a.runtime,'static');assert.equal(a.assets?.path,'release/');assert.equal(a.assets?.count,1);assert.equal(a.buildProfiles?.length,2);
});
test('restricted readership recommends a provider that can add access control',()=>{
  const a=analyze([f('index.html','<h1>Hello</h1>')]);
  const p={purpose:'personal',budget:'free',priority:'simple',traffic:'unknown',runtime:'auto'} as const;
  const restricted=recommend(a,{...p,access:'restricted'});
  assert.equal(restricted[0].id,'cloudflare');
  assert.equal(restricted[0].conditional,undefined);
  assert.match(restricted[0].plan,/Access/);
  assert.ok(restricted[0].reasons.some(t=>t.includes('本番・プレビュー')));
  assert.ok(restricted[0].cautions.some(t=>t.includes('公開前')));
  assert.equal(restricted.find(c=>c.id==='github')?.blocked,true);
  assert.ok(restricted.find(c=>c.id==='vercel')?.reasons.some(t=>t.includes('Authentication')));
  assert.ok(recommend(a,{...p,access:'public'}).some(c=>!c.conditional&&!c.blocked));
});
test('existing access settings are not a prerequisite for a restricted recommendation',()=>{
  const a=analyze([f('package.json','{"private":true,"devDependencies":{"vite":"7"},"scripts":{"build":"vite build"}}'),f('index.html','<h1>gallery</h1>'),f('dist/index.html','<h1>built</h1>')]);
  const candidates=recommend(a,{purpose:'unknown',budget:'free',priority:'simple',traffic:'unknown',runtime:'auto',access:'restricted'});
  assert.equal(a.runtime,'static');
  assert.equal(candidates.find(c=>!c.blocked&&!c.conditional)?.id,'cloudflare');
});
test('asset limits can exclude Cloudflare while Vercel stays a protected option',()=>{
  const a=analyze([f('index.html','<h1>Hello</h1>')]);
  a.assets!.largest=25*1024*1024+1;
  const candidates=recommend(a,{purpose:'personal',budget:'free',priority:'simple',traffic:'unknown',runtime:'auto',access:'restricted'});
  assert.equal(candidates.find(c=>c.id==='cloudflare')?.blocked,true);
  assert.equal(candidates.find(c=>!c.blocked&&!c.conditional)?.id,'vercel');
});
test('unknown runtime remains unconfirmed even when access is required',()=>{
  const a=analyze([f('notes.txt','hello')]);
  const candidates=recommend(a,{purpose:'personal',budget:'free',priority:'simple',traffic:'unknown',runtime:'auto',access:'restricted'});
  assert.ok(candidates.every(c=>c.blocked||c.conditional));
});
test('package private flag does not imply viewer authentication',()=>{
  const a=analyze([f('package.json','{"private":true}'),f('index.html','<h1>Hello</h1>')]);
  assert.equal(a.runtime,'static');
  assert.ok(recommend(a,{purpose:'personal',budget:'free',priority:'simple',traffic:'unknown',runtime:'auto',access:'unknown'}).every(c=>c.cautions.some(t=>t.includes('閲覧範囲が未定'))));
});

test('config-free Vite builds honor explicit output and mode',()=>{
 const a=detectOutput([f('package.json',JSON.stringify({scripts:{build:'vite build --outDir release --mode demo'}})),f('release/index.html')]);
 assert.equal(a.path,'release/');assert.equal(a.profiles?.[0].mode,'demo');
});
test('changed root and multiple config files remain unresolved',()=>{
 const a=files({build:'vite build --outDir release','build:public':'cd elsewhere && vite build'});
 a[1]=f('vite.config.ts',"export default {root:'app',build:{outDir:'dist'}}");assert.equal(detectOutput(a).path,null);
 assert.equal(detectOutput([...files(),f('vite.config.js','export default {}')]).path,null);
});
test('script argument forwarding does not silently pick default mode',()=>{
 const a=files();a[0]=f('package.json',JSON.stringify({scripts:{build:'pnpm bundle -- --mode public',bundle:'vite build'}}));
 assert.equal(detectOutput(a).path,null);
});

test('GitHub Pages workflow binds a CLI base override to its uploaded build output',()=>{
  const entries = [
    f('package.json', JSON.stringify({scripts:{build:'tsc -b && vite build', 'build:pages':'tsc -b && vite build --base=/GAME/ --outDir=dist-pages'},devDependencies:{vite:'7'}})),
    f('vite.config.ts', "export default defineConfig({base:'./'})"),
    f('index.html','<h1>game</h1>'), f('dist/index.html'),f('dist-pages/index.html'),f('dist-pages/assets/game.js'),
    f('.github/workflows/pages.yml',`jobs:
  build:
    steps:
      - run: pnpm test
      - run: pnpm build:pages
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist-pages
  deploy:
    steps:
      - uses: actions/deploy-pages@v4`),
  ];
  const result = detectOutput(entries);
  assert.equal(result.path,'dist-pages/');
  assert.match(result.reason,/pages.yml.*build:pages/);
  assert.deepEqual(result.profiles?.map(p=>[p.script,p.output,p.base]),[['build','dist',undefined],['build:pages','dist-pages','/GAME/']]);
  const analysis=analyze(entries);
  assert.equal(analysis.runtime,'static');
  assert.equal(analysis.assets?.count,2);
});

test('an upload path alone or a different build script does not choose an artifact',()=>{
  const common=[f('package.json', JSON.stringify({scripts:{build:'vite build','build:pages':'vite build --base=/GAME/ --outDir=dist-pages'},devDependencies:{vite:'7'}})),f('index.html'),f('dist/index.html'),f('dist-pages/index.html')];
  for(const workflow of [
    `jobs:\n  build:\n    steps:\n      - uses: actions/upload-pages-artifact@v3\n        with:\n          path: dist-pages`,
    `jobs:\n  build:\n    steps:\n      - run: pnpm build\n      - uses: actions/upload-pages-artifact@v3\n        with:\n          path: dist-pages`,
    `jobs:\n  build:\n    steps:\n      - run: pnpm build:pages\n      - uses: actions/upload-pages-artifact@v3\n        with:\n          path: \${{ env.OUTPUT }}`,
  ]) assert.equal(detectOutput([...common,f('.github/workflows/pages.yml',workflow)]).path,null);
});

test('Pages workflow and build script must belong to the same job',()=>{
  const entries=[f('package.json', JSON.stringify({scripts:{build:'vite build','build:pages':'vite build --outDir dist-pages'},devDependencies:{vite:'7'}})),f('dist/index.html'),f('dist-pages/index.html'),
    f('.github/workflows/pages.yml',`jobs:
  first:
    steps:
      - run: pnpm build:pages
  second:
    steps:
      - uses: actions/upload-pages-artifact@v4
        with:
          path: dist-pages`)];
  assert.equal(detectOutput(entries).path,null);
});
