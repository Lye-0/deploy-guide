import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/analyze.ts';
import { parseCode, walk } from '../src/syntax.ts';
import { recommend } from '../src/rules.ts';
import type { Entry } from '../src/types.ts';
const f = (path: string, text: string): Entry => ({ path, text, size: text.length });
const base = [f('package.json', JSON.stringify({dependencies:{vite:'7',parser:'1',tailwindcss:'4'},scripts:{build:'vite build',deploy:'pnpm build && wrangler deploy'}})), f('index.html', '<script type="module" src="/src/main.ts"></script>')];
const prefs = { purpose:'personal',budget:'free',priority:'simple',traffic:'unknown',runtime:'auto' } as const;

test('non-null assignment/update preserves runtime expressions', () => {
  const ast = parseCode('const counts: number[] = []; counts[0]! += 1; counts[1]!++; counts[2]! = 3; fetch("/api/data");');
  assert.ok(ast); let calls = 0; walk(ast, n => { if(n.type === 'CallExpression' && n.callee.name === 'fetch') calls++; }); assert.equal(calls,1);
  assert.equal(parseCode('getValue()! += 1'), null);
});
test('nested object satisfies leaves API calls visible', () => {
  const ast = parseCode('navigate({ state: { value: fetch("/api") } satisfies RouteStamp });');
  assert.ok(ast); let calls = 0; walk(ast,n => {if(n.type==='CallExpression' && n.callee.name==='fetch') calls++;}); assert.equal(calls,1);
});
const wasm = [f('src/assets.ts', 'import wasm from "parser/runtime.wasm?url"; export const runtimeUrl = wasm;'), f('src/main.ts', 'import {runtimeUrl} from "./assets"; fetch(runtimeUrl);')];
test('immutable Vite package URL imports remain static through exports', () => {
  const a = analyze([...base,...wasm]); assert.equal(a.runtime,'static'); assert.equal(a.externalApi,false);
  assert.ok(a.evidence.some(e=>e.label.includes('URL import')));
});
test('local Vite URL assets require an existing file', () => {
  const entries=[...base,f('src/main.ts','import wasm from "./runtime.wasm?url"; fetch(wasm);')];
  assert.equal(analyze(entries).runtime,'unknown');
  assert.equal(analyze([...entries,{path:'src/runtime.wasm',size:10}]).runtime,'static');
});
test('undeclared packages and ordinary module imports do not prove static URLs', () => {
  for (const spec of ['missing/runtime.wasm?url','parser/runtime.wasm']) assert.equal(analyze([...base,f('src/main.ts','import wasm from '+JSON.stringify(spec)+'; fetch(wasm);')]).runtime,'unknown');
});
test('shadowed, mutable, POST and mixed API references stay unresolved', () => {
  for(const text of [
    'import {runtimeUrl} from "./assets"; function load(runtimeUrl:string){fetch(runtimeUrl)}',
    'import wasm from "parser/runtime.wasm?url"; let runtimeUrl=wasm; runtimeUrl=window.endpoint; fetch(runtimeUrl);',
    'import {runtimeUrl} from "./assets"; fetch(runtimeUrl,{method:"POST"});',
    'import {runtimeUrl} from "./assets"; fetch(runtimeUrl); fetch("/api/data");',
    'fetch("@@VITE_ASSET@@/api/data")'
  ]) assert.equal(analyze([...base,wasm[0],f('src/main.ts',text)]).runtime,'unknown',text);
});
test('declared CSS package imports are build dependencies; missing local CSS remains unresolved', () => {
  const entries=[...base,f('src/main.ts','import "./styles.css";')];
  assert.equal(analyze([...entries,f('src/styles.css','@import "tailwindcss";')]).runtime,'static');
  for(const css of ['@import "missing-package";','@import "./missing.css";','div{background:url(tailwindcss)}']) assert.equal(analyze([...entries,f('src/styles.css',css)]).runtime,'unknown');
});
test('unread unused output does not block source proof but unread reachable source does', () => {
  const entries=[...base,...wasm,{path:'dist/assets/large.js',size:5*1024*1024},f('dist/index.html','<script src="assets/large.js"></script>')];
  const a=analyze(entries,'','project',['テキスト読み取り上限']); assert.equal(a.runtime,'static'); assert.equal(a.capacityIncomplete,false); assert.equal(a.assets?.count,2);
  assert.equal(analyze(entries.map(e=>e.path==='src/main.ts'?{path:e.path,size:e.size}:e)).runtime,'unknown');
});
test('static Cloudflare deployment preference does not imply a backend', () => {
  const a=analyze([...base,...wasm,f('wrangler.jsonc','{"assets":{"directory":"./dist","not_found_handling":"single-page-application"}}'),f('dist/index.html','hello')]);
  assert.equal(a.runtime,'static');assert.equal(a.worker,false);assert.equal(a.staticHost,'cloudflare');assert.equal(recommend(a,prefs)[0].id,'cloudflare');
});
test('environment-specific deploy and mismatched asset config do not imply existing static hosting',()=>{
  for(const extra of [f('wrangler.jsonc','{"assets":{"directory":"./other"}}'),f('wrangler.jsonc','{"main":"worker.ts","assets":{"directory":"./dist"}}')]) assert.equal(analyze([...base,...wasm,extra,f('dist/index.html','hello')]).staticHost,undefined);
});
test('history router requires Pages routing work while plain sites still recommend Pages', () => {
  const a=analyze([...base,f('src/main.ts','import {BrowserRouter} from "react-router-dom"; const view=<BrowserRouter/>;')]);
  assert.equal(a.runtime,'static');assert.equal(a.historyRouting,true);assert.equal(recommend(a,prefs).find(c=>c.id==='github')?.conditional,true);
  assert.equal(recommend(analyze([...base,...wasm]),prefs)[0].id,'github');
});

test('explicit deploy environment is not silently replaced with default static hosting', () => {
  const entries = [...base.filter(e=>e.path!=='package.json'), ...wasm,
    f('package.json', JSON.stringify({dependencies:{vite:'7',parser:'1'},scripts:{deploy:'wrangler deploy --env production'}})),
    f('wrangler.jsonc','{"assets":{"directory":"./dist"},"env":{"production":{"main":"server.ts"}}}'),f('dist/index.html','hello')];
  assert.equal(analyze(entries).staticHost,undefined);
});
test('immutable asset fast path does not depend on unrelated program size', () => {
  const declarations=Array.from({length:13000},(_,i)=>'const value'+i+'={value:'+i+'};').join('');
  const a=analyze([...base,wasm[0],f('src/main.ts','import {runtimeUrl} from "./assets";'+declarations+'fetch(runtimeUrl);')]);
  assert.equal(a.runtime,'static');
});
