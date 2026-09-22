import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/analyze.ts';
const file = (path: string, text?: string) => ({ path, text, size: 100 });
const plain = () => [file('package.json', '{"scripts":{"lint":"eslint ."},"devDependencies":{"eslint":"9"}}'), file('index.html', '<link rel="stylesheet" href="style.css"><script type="module" src="main.js"></script>'), file('style.css'), file('main.js', 'import "./helper.js";'), file('helper.js', 'console.log(1)')];
test('plain site with development-only package automatically aggregates root', () => {
  const a = analyze(plain()); assert.equal(a.assets?.path, './'); assert.equal(a.assets?.count, 5);
});
test('build command prevents source size being called output size', () => {
  const entries = plain(); entries[0].text = '{"scripts":{"build":"node scripts/build.js"}}'; assert.equal(analyze(entries).assets, null);
});
test('Vite dependency or dev script requires output', () => {
  for(const text of ['{"devDependencies":{"vite":"7"}}','{"scripts":{"dev":"vite"}}']) { const entries=plain();entries[0].text=text;assert.equal(analyze(entries).assets,null); }
});
test('TS reference without package is still build-dependent', () => {
  const a = analyze([file('index.html','<script type="module" src="src/main.ts"></script>'),file('src/main.ts','const a: number = 1')]); assert.equal(a.assets,null);
});
test('missing reference is unknown; manual selection remains available', () => {
  const entries=plain().filter(e=>e.path!=='helper.js');assert.equal(analyze(entries).assets,null);assert.equal(analyze(entries,'','site',[],'./').assets?.count,4);
});
test('CDN dependencies and query strings are accepted', () => {
  const entries=plain();entries[1].text='<script src="https://cdn.example.com/library.js"></script><script src="main.js?v=1"></script>';assert.equal(analyze(entries).assets?.count,5);
});
test('bare imports and dynamic imports are ambiguous', () => {
  for(const code of ['import React from "react"','import(path)']) { const entries=plain();entries[3].text=code;assert.equal(analyze(entries).assets,null); }
});
test('unread HTML, malformed package and base URLs require confirmation', () => {
  for(const entries of [[file('package.json','{}'),file('index.html')],[file('package.json','{'),file('index.html','hello')],[file('package.json','{}'),file('index.html','<base href="/other/">')]]) assert.equal(analyze(entries).assets,null);
});
