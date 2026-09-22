import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/analyze.ts';
import { recommend } from '../src/rules.ts';
const file=(path:string,text:string)=>({path,text,size:text.length});
const base=()=>[file('package.json','{"devDependencies":{"vite":"8","react":"19"},"scripts":{"start":"vite"}}'),file('index.html','<div id="app"></div>')];
test('browser-test servers do not turn Vite site into a server app',()=>{
 const entries=[...base(),...['browser.ts','disclosures.browser.ts','relocation.ts','scrollbars.browser.ts','scrollbars.react.ts'].map(n=>file('tests/'+n,"const server = await createServer(); await server.listen();"))];
 const a=analyze(entries);assert.equal(a.runtime,'static');assert.equal(a.scanned,7);assert.equal(a.textRead,7);
 assert.equal(a.evidence.filter(e=>e.label.includes('判定から除外')).length,5);
 assert.equal(recommend(a,{purpose:'unknown',budget:'free',priority:'simple',traffic:'unknown',runtime:'auto'})[0].id,'github');
});
test('nested tests, mocks and tooling are excluded from server inference',()=>{
 for(const path of ['src/__tests__/server.ts','src/service.spec.ts','e2e/server.ts','scripts/preview.ts','tools/server.ts','docs/demo.ts','examples/api/demo.ts']) assert.equal(analyze([...base(),file(path,'server.listen(3000)')]).runtime,'static',path);
});
test('real production server is still recognized alongside tests',()=>{
 const a=analyze([...base(),file('tests/browser.ts','server.listen()'),file('src/server.ts','app.listen(3000)')]);assert.equal(a.runtime,'server');assert.ok(a.evidence.some(e=>e.label==='サーバー処理の手掛かり'&&e.path==='src/server.ts'));
});
test('explicit production start entry is retained even in scripts',()=>{
 const a=analyze([file('package.json','{"scripts":{"start":"node ./scripts/serve.js"},"devDependencies":{"vite":"8"}}'),file('scripts/serve.js','server.listen(3000)')]);assert.equal(a.runtime,'server');
});
test('dev-only express does not force server; runtime express still does',()=>{
 for(const kind of ['devDependencies','dependencies']){const a=analyze([file('package.json',JSON.stringify({[kind]:{express:'5'},devDependencies:{vite:'8',...(kind==='devDependencies'?{express:'5'}:{})}})),file('index.html','hello')]);assert.equal(a.runtime,kind==='dependencies'?'server':'static');}
});
