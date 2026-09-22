import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../src/analyze.ts";
import { inspectClient } from "../src/client-graph.ts";
import { recommend } from "../src/rules.ts";
const f = (path: string, text: string, size = text.length) => ({
  path,
  text,
  size,
});
const html = f("index.html", '<script type="module" src="app.js"></script>');
const asset = f("movie.mp4", "", 1024);
const run = (code: string, extra: ReturnType<typeof f>[] = []) =>
  analyze([html, f("app.js", code), asset, ...extra]);
test("constant variable fetch resolves to an existing asset", () => {
  assert.equal(run('const url="./movie.mp4";fetch(url)').runtime, "static");
});
test("imported JSON values through map and function args resolve", () => {
  const a = run(
    'import data from "./data.json";function load(url){fetch(url)}data.videos.map(v=>load(v.src))',
    [f("data.json", '{"videos":[{"src":"./movie.mp4"}]}')],
  );
  assert.equal(a.runtime, "static");
  assert.ok(a.evidence.some((e) => e.path === "data.json"));
});
test("class Map queue preserves URL provenance", () => {
  const a = run(
    'import list from "./data.json"; class Queue { entries=new Map();add(src){this.entries.set(src,{src});this.pump()}pump(){const entry=[...this.entries.values()].filter(e=>e)[0];fetch(entry.src,{headers:{Range:"bytes=0-"}})}} const queue=new Queue();list.map(item=>queue.add(item.src));',
    [f("data.json", '[{"src":"./movie.mp4"}]')],
  );
  assert.equal(a.runtime, "static");
});
test("base URL and templates are resolved against built assets", () => {
  const r = inspectClient(
    [
      html,
      f(
        "app.js",
        'import data from "./data.json";const base=import.meta.env.BASE_URL;for(const item of data){const src=base+`${item.name}`;fetch(src)}',
      ),
      f("data.json", '[{"name":"movie.mp4"}]'),
      f("dist/movie.mp4", "", 1024),
    ],
    "index.html",
    true,
    "dist/",
  );
  assert.equal(r.ready, true);
});
test("unrelated manifest cannot validate an unknown URL", () => {
  assert.equal(
    run('import data from "./data.json";fetch(window.location.hash)', [
      f("data.json", '{"src":"./movie.mp4"}'),
    ]).runtime,
    "unknown",
  );
});
test("missing asset in manifest stays unknown", () => {
  assert.equal(
    run('import data from "./data.json";data.forEach(v=>fetch(v.src))', [
      f("data.json", '[{"src":"./absent.mp4"}]'),
    ]).runtime,
    "unknown",
  );
});
test("API URL mixed with static assets stays unknown", () => {
  assert.equal(
    run('import data from "./data.json";data.forEach(v=>fetch(v.src))', [
      f("data.json", '[{"src":"./movie.mp4"},{"src":"/api/video"}]'),
    ]).runtime,
    "unknown",
  );
});
test("user input mixed with known URL remains unknown", () => {
  assert.equal(
    run('const url=window.choose?"./movie.mp4":window.input;fetch(url)')
      .runtime,
    "unknown",
  );
});
test("POST or body is not treated as static asset reading", () => {
  for (const options of [
    '{method:"POST"}',
    '{body:"payload"}',
    '{...(window.x?{method:"POST"}:{})}',
  ])
    assert.equal(
      run(`const src="./movie.mp4";fetch(src,${options})`).runtime,
      "unknown",
    );
});
test("GET/HEAD and conditional Range headers work", () => {
  for (const options of [
    '{method:"HEAD"}',
    '{...(window.offset?{headers:{Range:"bytes=0-"}}:{})}',
  ])
    assert.equal(
      run(`const src="./movie.mp4";fetch(src,${options})`).runtime,
      "static",
    );
});
test("unresolved fetch options remain unknown", () => {
  assert.equal(run('fetch("./movie.mp4",window.options)').runtime, "unknown");
});
test("opaque function cannot be assumed to return a manifest URL", () => {
  assert.equal(
    run('import data from "./data.json";fetch(transform(data))', [
      f("data.json", '{"src":"./movie.mp4"}'),
    ]).runtime,
    "unknown",
  );
});
test("URL property mutated through an alias remains unknown", () => {
  assert.equal(
    run(
      'const data={src:"./movie.mp4"};const alias=data;alias.src=window.input;fetch(data.src)',
    ).runtime,
    "unknown",
  );
});
test("scope shadowing does not borrow unrelated outer values", () => {
  assert.equal(
    run(
      'const url="./movie.mp4";function download(url){fetch(url)}download(window.input)',
    ).runtime,
    "unknown",
  );
});
test("uninvoked dynamic function does not become a finite known source", () => {
  assert.equal(
    run('function download(url){fetch(url||"./movie.mp4")}').runtime,
    "unknown",
  );
});
test("large asset cap remains independent from URL proof", () => {
  const a = analyze([
    html,
    f("app.js", 'const url="./movie.mp4";fetch(url)'),
    f("movie.mp4", "", 30 * 1024 * 1024),
  ]);
  assert.equal(a.runtime, "static");
  assert.equal(
    recommend(a, {
      purpose: "personal",
      budget: "free",
      priority: "simple",
      traffic: "unknown",
      runtime: "auto",
    }).find((c) => c.id === "cloudflare")!.blocked,
    true,
  );
});
test("source file cannot substitute for absent built asset", () => {
  const r = inspectClient(
    [
      html,
      f("app.js", 'const url="/movie.mp4";fetch(url)'),
      f("public/movie.mp4", "", 100),
      f("dist/index.html", "hello"),
    ],
    "index.html",
    true,
    "dist/",
  );
  assert.equal(r.ready, false);
});
