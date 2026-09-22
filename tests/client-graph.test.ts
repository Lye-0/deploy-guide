import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze,wantsText,projectRoots } from '../src/analyze.ts';
import { inspectClient } from '../src/client-graph.ts';
const file=(path:string,text?:string)=>({path,text,size:text?.length??100});
test('HTML -> module -> CSS -> image is traced',()=>{
 const a=analyze([file('index.html','<script type="module" src="main.js"></script>'),file('main.js','import "./helper.js"'),file('helper.js','console.log(1)'),file('package.json','{"scripts":{"build:preview":"node optional.js"}}')]);assert.equal(a.runtime,'static');assert.equal(a.assets?.path,'./');
});
test('generated artifacts remain usable regardless of optional build script',()=>{
 const a=analyze([file('index.html','<script src="app.bundle.js"></script>'),file('app.bundle.js','(()=>{console.log(1)})();'),file('package.json','{"scripts":{"build":"custom-command"}}')]);assert.equal(a.runtime,'static');assert.ok(a.assets);
});
test('missing scripts, unread scripts and dynamic imports abstain',()=>{
 for(const js of [undefined,'import(target)']){const a=analyze([file('index.html','<script src="main.js"></script>'),file('main.js',js)]);assert.equal(a.runtime,'unknown');}
 assert.equal(analyze([file('index.html','<script src="missing.js"></script>')]).runtime,'unknown');
});
test('unreachable strings/comments do not imply servers or APIs',()=>{
 const a=analyze([file('index.html','<script src="main.js"></script>'),file('main.js','// app.listen(); fetch("/api")\nconst doc="server.listen()";')]);assert.equal(a.runtime,'static');assert.equal(a.externalApi,false);
});
test('external API is distinct from missing same-origin backend',()=>{
 const html=file('index.html','<script src="app.js"></script>');assert.equal(analyze([html,file('app.js','fetch("https://example.org/data")')]).runtime,'static');
 assert.equal(analyze([html,file('app.js','fetch("/api/data")')]).runtime,'unknown');
 assert.equal(analyze([html,file('app.js','fetch("./data.json")'),file('data.json','{}')]).runtime,'static');
});
test('Vite public assets and env base placeholder resolve',()=>{
 const a=analyze([file('package.json','{"devDependencies":{"vite":"7"}}'),file('index.html','<link rel="icon" href="%BASE_URL%logo.svg"><script type="module" src="src/main.ts"></script>'),file('src/main.ts','const n: number = 1;'),file('public/logo.svg','<svg/>')]);assert.equal(a.runtime,'static');assert.equal(a.assets,null);
});
test('CSS data SVG nested url is not a missing file',()=>{
 const a=analyze([file('index.html','<link rel="stylesheet" href="style.css">'),file('style.css',`body{background:url("data:image/svg+xml,%3Csvg filter='url(%23n)'%3E")}`)]);assert.equal(a.runtime,'static');
});
test('entrypoint worker and module imports are traversed',()=>{const r=inspectClient([file('index.html','<script src="app.js"></script>'),file('app.js','new Worker(new URL("./worker.js",import.meta.url))'),file('worker.js','postMessage(1)')],'index.html',false);assert.equal(r.ready,true);assert.ok(r.files.has('worker.js'));});
test('CSS is read, clock/minified JS are read, lock files are not',()=>{for(const p of ['clock.js','app.min.js','style.css','dist/assets/main.js'])assert.equal(wantsText(p),true);assert.equal(wantsText('package-lock.json'),false);});
test('hidden worktrees are not apps',()=>{assert.deepEqual(projectRoots([file('.kilo/worktrees/x/package.json','{}'),file('package.json','{}')]),['']);});
test('invalid metadata and unsupported frameworks abstain',()=>{assert.equal(analyze([file('package.json','{'),file('index.html','hello')]).runtime,'unknown');assert.equal(analyze([file('package.json','{"dependencies":{"nuxt":"4"}}'),file('index.html','hello')]).runtime,'unknown');});
test('inventory truncation cannot claim complete static scope',()=>{assert.equal(analyze([file('index.html','hello')],'','site',['一覧上限に達しました']).runtime,'unknown');});
