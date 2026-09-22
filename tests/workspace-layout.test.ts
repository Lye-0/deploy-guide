import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, safePath } from "../src/analyze.ts";
import { recommend } from "../src/rules.ts";
import { repositoryPath } from "../src/workspace-layout.ts";
const f = (path: string, text: string, size = text.length) => ({
  path,
  text,
  size,
});
const fixture = () => [
  f(
    "package.json",
    '{"private":true,"scripts":{"deploy:production":"pnpm --filter backend deploy:release"}}',
  ),
  f("pnpm-workspace.yaml", 'packages:\n - "apps/*"\n - "packages/*"'),
  f(
    "apps/api/package.json",
    '{"name":"backend","scripts":{"deploy:release":"wrangler deploy --env live"}}',
  ),
  f(
    "apps/api/wrangler.jsonc",
    '{ // production\n "main":"src/index.ts", "env":{"live":{"assets":{"directory":"../web/dist","run_worker_first":["/api/*"]},"d1_databases":[{"binding":"DB","database_id":"do-not-output"}]},"dev":{"assets":{"directory":"./preview"}}}}',
  ),
  f(
    "apps/api/src/index.ts",
    'export default {async fetch(request,env){return new Response("API")}} satisfies ExportedHandler<Env>',
  ),
  f(
    "apps/web/package.json",
    '{"name":"frontend","dependencies":{"react":"19"},"devDependencies":{"vite":"8"}}',
  ),
  f("apps/web/index.html", '<div id="app"></div>'),
  f("apps/web/dist/index.html", "built", 100),
  f("apps/web/dist/main.js", "", 200),
  f("packages/database/package.json", '{"name":"schema"}'),
];
const prefs = {
  purpose: "unknown",
  budget: "free",
  priority: "simple",
  traffic: "unknown",
  runtime: "auto",
} as const;
test("root workspace follows named deploy target, environment and sibling assets", () => {
  const a = analyze(fixture());
  assert.equal(a.runtimeKind, "worker");
  assert.equal(a.assets?.path, "apps/web/dist/");
  assert.equal(a.assets?.bytes, 300);
  assert.equal(a.assets?.count, 2);
  assert.match(a.runtimeReason!, /live/);
  assert.match(a.runtimeReason!, /D1/);
  assert.equal(
    recommend(a, prefs).find((c) => !c.blocked && !c.conditional)?.id,
    "cloudflare",
  );
  assert.doesNotMatch(JSON.stringify(a), /do-not-output/);
});
test("missing output does not erase known Worker runtime", () => {
  const a = analyze(
    fixture().filter((e) => !e.path.startsWith("apps/web/dist/")),
  );
  assert.equal(a.runtimeKind, "worker");
  assert.equal(a.assets, null);
  assert.match(a.warnings.join(""), /生成されていません/);
});
test("missing requested environment stays unknown", () => {
  const entries = fixture();
  entries[2].text =
    '{"name":"backend","scripts":{"deploy:release":"wrangler deploy --env absent"}}';
  assert.equal(analyze(entries).runtime, "unknown");
});
test("commented assets are not selected", () => {
  const entries = fixture();
  entries[3].text =
    '{"main":"src/index.ts","env":{"live":{}} /* "assets":{"directory":"../web/dist"} */}';
  assert.equal(analyze(entries).runtime, "unknown");
});
test("multiple deployments are not collapsed into one host", () => {
  const entries = fixture();
  entries[2].text =
    '{"name":"backend","scripts":{"deploy:release":"wrangler deploy --env live && wrangler deploy --env dev"}}';
  assert.equal(analyze(entries).runtime, "unknown");
});
test("independent frontend remains separate", () => {
  const entries = fixture();
  entries.push(
    f("apps/other/package.json", "{}"),
    f("apps/other/index.html", "hello"),
  );
  assert.equal(analyze(entries).runtime, "unknown");
});
test("library packages do not count as independent deployable apps", () => {
  assert.equal(analyze(fixture()).runtime, "server");
});
test("choosing a child app does not inherit the whole workspace backend", () => {
  const a = analyze(fixture(), "apps/web/");
  assert.equal(a.worker, false);
  assert.equal(a.runtime, "static");
});
test("sibling references stay inside repository boundaries", () => {
  assert.equal(repositoryPath("apps/api/", "../web/dist"), "apps/web/dist");
  for (const p of ["../../../secret", "C:\\secret", "/secret", "../../.env"])
    assert.equal(repositoryPath("apps/api/", p), null);
});
test("default export without handler is not enough", () => {
  const entries = fixture();
  entries[4].text = "export default {}";
  assert.equal(analyze(entries).runtime, "unknown");
});
test("manual asset selection preserves runtime relationship", () => {
  const a = analyze(fixture(), "", "repo", [], "apps/web/dist/");
  assert.equal(a.runtimeKind, "worker");
  assert.equal(a.assets?.count, 2);
});
test("secrets used by Workers are excluded before file reads", () => {
  for (const p of [
    ".dev.vars",
    ".dev.vars.production",
    "apps/api/.dev.vars.json",
  ])
    assert.equal(safePath(p), false);
});

test("dynamic environment variables do not silently use defaults", () => {
  const entries = fixture();
  entries[2].text = JSON.stringify({
    name: "backend",
    scripts: { "deploy:release": "wrangler deploy --env $DEPLOY_ENV" },
  });
  assert.equal(analyze(entries).runtime, "unknown");
});
test("duplicate package names do not select the first match", () => {
  const entries = fixture();
  entries.push(f("examples/api/package.json", '{"name":"backend"}'));
  assert.equal(analyze(entries).runtime, "unknown");
});
test("incomplete inventory does not claim a complete workspace layout", () => {
  assert.equal(
    analyze(fixture(), "", "repo", ["一覧上限に達しました"]).runtime,
    "unknown",
  );
});
