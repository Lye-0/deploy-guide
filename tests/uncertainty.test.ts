import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/analyze.ts';
import { recommend } from '../src/rules.ts';
const f=(path:string,text:string)=>({path,text,size:text.length});
const pref={purpose:'personal',budget:'free',priority:'simple',traffic:'unknown',runtime:'auto'} as const;
const html=f('index.html','<h1>Hello</h1>');
test('Vite SSR configuration is not treated as a plain browser build',()=>{const a=analyze([html,f('package.json','{"devDependencies":{"vite":"7"}}'),f('vite.config.ts','export default {build:{ssr:"src/entry-server.ts"}}')]);assert.equal(a.runtime,'unknown');});
test('Python and other unsupported backends are not forced into one of three hosts',()=>{const a=analyze([html,f('app.py','app.run()')]);assert.equal(a.runtime,'unknown');assert.ok(recommend(a,pref).every(c=>c.conditional||c.blocked));});
test('authentication gate cannot disappear when choosing static hosting',()=>{const a=analyze([html,f('package.json','{"scripts":{"start":"node serve.js"}}'),f('serve.js',`import http from 'node:http';import {readFile} from 'node:fs/promises';http.createServer(async(req,res)=>{if(!req.headers.authorization){res.writeHead(403);res.end('Forbidden');return;}const data=await readFile('index.html');res.end(data);}).listen(3000);`)]);assert.notEqual(a.runtime,'static');});
test('modified file buffers are not proven static',()=>{const a=analyze([html,f('package.json','{"scripts":{"start":"node serve.js"}}'),f('serve.js',`import http from 'node:http';import {readFile} from 'node:fs/promises';http.createServer(async(req,res)=>{const data=await readFile('index.html');data[0]=1;res.end(data);}).listen(3000);`)]);assert.notEqual(a.runtime,'static');});
test('text budget gaps do not erase known artifact byte counts',()=>{const a=analyze([html,f('dist/index.html','hello')],'','site',['テキスト読み取り上限に達したファイルがあります。']);assert.equal(a.capacityIncomplete,false);assert.equal(a.assets?.bytes,5);});

test('file bytes passed into an opaque mutating function are not proven static',()=>{const a=analyze([html,f('package.json','{"scripts":{"start":"node serve.js"}}'),f('serve.js',`import http from 'node:http';import {readFile} from 'node:fs/promises';function modify(x){x[0]=42;}http.createServer(async(req,res)=>{const data=await readFile('index.html');modify(data);res.end(data);}).listen(3000);`)]);assert.notEqual(a.runtime,'static');});
test('browser Worker with a dynamic path is an asset caution, not a backend',()=>{const a=analyze([f('index.html','<script src="app.js"></script>'),f('app.js','new Worker(window.workerUrl)')]);assert.equal(a.runtime,'static');assert.ok(a.warnings.some(w=>w.includes('ブラウザ内Worker')));});
