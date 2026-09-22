import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectOutput } from '../src/output-directory.ts';
const fixture=(text:string)=>[{path:'vite.config.ts',text,size:text.length},{path:'dist/index.html',size:100},{path:'dist/assets/main.js',size:200}];
test('nested Rollup options with manualChunks use default dist',()=>{
 const code=`export default defineConfig({plugins:[react()],base:'./',server:{port:5173},build:{chunkSizeWarningLimit:2500,rollupOptions:{output:{manualChunks(id){if(id.includes('three')) return 'graphics'}}}}})`;
 assert.equal(detectOutput(fixture(code)).path,'dist/');
});
test('explicit output after nested options is honored',()=>{
 const entries=fixture(`export default {build:{rollupOptions:{output:{manualChunks:{vendor:['react']}}},outDir:'site'}}`);entries.push({path:'site/index.html',size:10});assert.equal(detectOutput(entries).path,'site/');
});
test('nested output property does not masquerade as build.outDir',()=>{
 assert.equal(detectOutput(fixture(`export default {build:{plugin:{outDir:'other'}}}`)).path,'dist/');
});
test('braces in strings and comments do not close build block',()=>{
 const code=`export default {build:{rollupOptions:{output:{banner:'} {'}},/* } */outDir:'site'}}`;const entries=fixture(code);entries.push({path:'site/file.js',size:1});assert.equal(detectOutput(entries).path,'site/');
});
test('nested build with computed output still requires manual confirmation',()=>{
 assert.equal(detectOutput(fixture(`export default {build:{rollupOptions:{output:{}},outDir:process.env.OUTPUT}}`)).path,null);
});
