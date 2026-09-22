import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/analyze.ts';
import { recommend } from '../src/rules.ts';
import { inspectServer } from '../src/server-inspection.ts';
const file=(path:string,text:string)=>({path,text,size:text.length});
const site=[file('index.html','<script src="app.js"></script>'),file('app.js','console.log("server.listen()")')];
const serve=(body:string, imports='')=>`import http from 'node:http';import {readFile} from 'node:fs/promises';${imports}const server=http.createServer(async(request,reply)=>{${body}});server.listen(3000,'0.0.0.0');`;
function app(code:string, scripts:Record<string,string>={start:'node scripts/serve.mjs'}){return [...site,file('package.json',JSON.stringify({scripts})),file('scripts/serve.mjs',code)];}
const prefs={purpose:'personal',budget:'free',priority:'simple',traffic:'unknown',runtime:'auto'} as const;
test('static HTTP file serving does not need same start/dev or loopback binding',()=>{
 const a=analyze(app(serve("const bytes=await readFile('index.html');reply.end(bytes);")));
 assert.equal(a.runtime,'static');assert.equal(recommend(a,prefs).find(c=>!c.blocked&&!c.conditional)?.id,'github');
});
test('HEAD and status error responses remain static',()=>{
 const a=analyze(app(serve("if(request.method!=='GET'&&request.method!=='HEAD'){reply.writeHead(405);reply.end('Method unsupported');return;}try{const bytes=await readFile('index.html');reply.end(request.method==='HEAD'?undefined:bytes);}catch{reply.writeHead(404);reply.end('Missing');}")));
 assert.equal(a.runtime,'static');
});
test('import aliases and file streaming are followed',()=>{
 const code=`import {createServer as serve} from 'node:http';import {createReadStream as read} from 'node:fs';const server=serve((request,response)=>{read('index.html').pipe(response)});server.listen(0);`;
 assert.equal(analyze(app(code)).runtime,'static');
});
test('relative helpers and exported handlers are followed',()=>{
 const files=app("import {createServer} from 'node:http';import {handler} from './handler.mjs';createServer(handler).listen(0)");
 files.push(file('scripts/handler.mjs',`import {createServer} from 'node:http';import {readFile} from 'node:fs/promises';export function make(){return createServer(async(q,s)=>{const x=await readFile('index.html');s.end(x)})}`));
 // The imported symbol is not resolvable as a callback in this grammar: abstain.
 assert.equal(analyze(files).runtime,'unknown');
});
test('dynamic API and mixed static/API cannot be recommended for Pages',()=>{
 for(const code of [serve("reply.end(JSON.stringify({time:Date.now()}));"),serve("if(request.url==='/api'){reply.end('hello');return;}const b=await readFile('index.html');reply.end(b);")]){
  const a=analyze(app(code));assert.equal(a.runtime,'server');assert.equal(a.runtimeKind,'node');
  const c=recommend(a,prefs);assert.equal(c.find(c=>c.id==='github')!.blocked,true);assert.equal(c.some(c=>!c.blocked&&!c.conditional),false);
 }
});
test('data transformations are not plain file serving',()=>{assert.equal(analyze(app(serve("const b=await readFile('index.html');reply.end(b.toString().replace('x',Date.now()));"))).runtime,'server');});
test('outbound network, unresolved dependency and unsupported parser cause abstention',()=>{
 for(const code of [serve("await fetch('https://x');const b=await readFile('index.html');reply.end(b);"),serve("const b=await readFile('index.html');reply.end(b);","import helper from 'unknown-package';"),'%%% invalid']){
  const a=analyze(app(code));assert.equal(a.runtime,'unknown');assert.ok(recommend(a,prefs).every(c=>c.blocked||c.conditional));
 }
});
test('test/dev code is not automatically a production entrypoint',()=>{
 const a=analyze([...site,file('tests/server.ts',serve("reply.end('dynamic')")),file('tools/serve.js',serve("reply.end('dynamic')"))]);assert.equal(a.runtime,'static');assert.equal(a.scanned,4);
});
test('explicit start in a tests folder is analyzed',()=>{const a=analyze([...site,file('package.json','{"scripts":{"start":"node tests/server.js"}}'),file('tests/server.js',serve("reply.end('live API')"))]);assert.equal(a.runtime,'server');});
test('npm script indirection and cycles',()=>{assert.equal(analyze(app(serve("reply.end('dynamic');"),{start:'npm run live',live:'node scripts/serve.mjs'})).runtime,'server');assert.equal(analyze(app('',{start:'npm run live',live:'npm run start'})).runtime,'unknown');});
test('framework dependencies alone do not invent a backend',()=>{const a=analyze([...site,file('package.json','{"devDependencies":{"express":"5","hono":"4"}}')]);assert.equal(a.runtime,'static');assert.equal(a.worker,false);});
test('monorepo root and nested tools cannot cross-contaminate apps',()=>{const a=analyze([file('apps/web/package.json','{}'),file('apps/web/index.html','hello'),file('apps/api/package.json','{"scripts":{"start":"node server.js"}}'),file('apps/api/server.js',serve("reply.end('api')"))],'apps/web/');assert.equal(a.runtime,'static');});
