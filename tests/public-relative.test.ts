import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/analyze.ts';
import { inspectClient } from '../src/client-graph.ts';
const f=(path:string,text:string)=>({path,text,size:text.length});
const pkg=f('package.json','{"devDependencies":{"vite":"7"}}');
test('Vite HTML resolves relative public favicon, with query and fragment',()=>{
 for(const url of ['./favicon.svg','favicon.svg','./favicon.svg?v=2#icon','/favicon.svg']){
  const a=analyze([pkg,f('index.html',`<link rel="icon" href="${url}">`),f('public/favicon.svg','<svg/>'),f('dist/index.html','built'),f('dist/favicon.svg','<svg/>')]);assert.equal(a.runtime,'static',url);assert.equal(a.assets?.path,'dist/');
 }
});
test('missing icon still stays unresolved',()=>{assert.equal(analyze([pkg,f('index.html','<link rel="icon" href="./favicon.svg">')]).runtime,'unknown');});
test('unrelated same-name file is not accepted',()=>{assert.equal(analyze([pkg,f('index.html','<link rel="icon" href="./favicon.svg">'),f('other/favicon.svg','<svg/>')]).runtime,'unknown');});
test('relative JS imports do not silently resolve to public',()=>{assert.equal(analyze([pkg,f('index.html','<script src="src/main.js"></script>'),f('src/main.js','import "./missing.js"'),f('public/src/missing.js','console.log(1)')]).runtime,'unknown');});
test('nested HTML uses its own URL directory',()=>{const r=inspectClient([f('pages/index.html','<link rel="icon" href="../favicon.svg">'),f('public/favicon.svg','<svg/>')],'pages/index.html',true);assert.equal(r.ready,true);});
test('non-Vite projects do not invent public URL mappings',()=>{assert.equal(analyze([f('index.html','<link rel="icon" href="./favicon.svg">'),f('public/favicon.svg','<svg/>')]).runtime,'unknown');});
