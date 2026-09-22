import type { Analysis, Entry } from "./types.ts";
import { safePath, projectRoots } from "./inventory.ts";
import { parseCode, walk } from "./syntax.ts";

type Package = {
  root: string;
  name: string;
  scripts: Record<string, string>;
  data: Record<string, any>;
};
function jsonc(text: string): Record<string, any> {
  const clean = text.replace(
    /"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
    (token) => (token.startsWith("/") ? " " : token),
  );
  const result = JSON.parse(
    clean.replace(/("(?:\\.|[^"\\])*")|,\s*(?=[}\]])/g, (_, str) => str ?? ""),
  );
  if (!result || Array.isArray(result) || typeof result !== "object")
    throw Error("Invalid configuration");
  return result;
}
/** Resolve a configuration-relative path, bounded by the user-selected repository. */
export function repositoryPath(base: string, target: unknown): string | null {
  if (
    typeof target !== "string" ||
    !target.trim() ||
    /^[\\/]|^[a-z]:/i.test(target) ||
    /[:\x00-\x1f]/.test(target)
  )
    return null;
  const parts = base.split("/").filter(Boolean);
  for (const segment of target.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(segment);
  }
  const result = parts.join("/");
  return safePath(result) ? result : null;
}
function deploymentTargets(
  packages: Package[],
  root: string,
): { root: string; env: string | null }[] {
  const targets: { root: string; env: string | null }[] = [],
    seen = new Set<string>();
  function follow(pkg: Package, script: string, depth = 0) {
    const key = pkg.root + ":" + script;
    if (depth > 12 || seen.has(key)) return;
    seen.add(key);
    const command = pkg.scripts[script];
    if (typeof command !== "string") return;
    for (const segment of command.split(/&&|\|\||;/)) {
      if (
        /^\s*(?:(?:npx|pnpm\s+exec|npm\s+exec|yarn\s+exec)\s+)?wrangler\s+deploy\b/.test(
          segment,
        )
      ) {
        const match = segment.match(/(?:--env(?:=|\s+)|-e\s+)(?:"([\w-]+)"|'([\w-]+)'|([\w-]+))(?=\s|$)/);
        const explicit = match ? match[1] ?? match[2] ?? match[3] : null;
        const env = /(?:--config\b|-c\s)/.test(segment) ? '(未対応の設定ファイル指定)' : explicit ?? (/(?:--env\b|-e\s)/.test(segment) ? '(動的・未対応の指定)' : null);
        targets.push({ root: pkg.root, env });
      }
      for (const m of segment.matchAll(
        /\b(?:pnpm|npm|yarn)\s+(?:--filter\s+["']?([^\s"']+)["']?\s+)?(?:run\s+)?([\w:-]+)/g,
      )) {
        const matches = m[1]
          ? packages.filter(
              (p) =>
                p.name === m[1] ||
                p.root.replace(/\/$/, "") === m[1].replace(/^\.\//, ""),
            )
          : [pkg];
        const dest = matches.length === 1 ? matches[0] : undefined;
        if (dest && m[2] in dest.scripts) follow(dest, m[2], depth + 1);
      }
    }
  }
  const owner = packages.find((p) => p.root === root);
  if (owner) {
    const script = ["deploy:production", "deploy", "prod"].find(
      (k) => k in owner.scripts,
    );
    if (script) follow(owner, script);
  }
  return targets;
}

/** Aggregate only an explicitly related Worker + static-assets deployment. */
export function analyzeWorkspace(
  all: Entry[],
  root: string,
  name: string,
  scanWarnings: string[],
  outputChoice: string,
): Analysis | null {
  const safe = all.filter((e) => safePath(e.path)),
    map = new Map(safe.map((e) => [e.path, e]));
  const roots = projectRoots(safe).filter((p) => p.startsWith(root));
  const packages: Package[] = [];
  for (const p of roots) {
    try {
      const data = JSON.parse(map.get(p + "package.json")?.text ?? "null");
      if (data && typeof data === "object")
        packages.push({
          root: p,
          name: data.name ?? p,
          scripts: data.scripts ?? {},
          data,
        });
    } catch {
      /* reported by the normal analyzer when selected */
    }
  }
  const owner = packages.find((p) => p.root === root);
  const declaredWorkspace =
    map.has(root + "pnpm-workspace.yaml") || Boolean(owner?.data.workspaces);
  if (!declaredWorkspace || roots.length < 2 || map.has(root + "index.html"))
    return null;
  const scoped = safe.filter((e) => e.path.startsWith(root));
  const a: Analysis = {
    name,
    framework: "モノレポ（構成の確認が必要）",
    next: false,
    worker: false,
    runtime: "unknown",
    runtimeKind: "unknown",
    runtimeReason: "複数アプリの公開関係を確認してください。",
    staticExport: false,
    externalApi: false,
    recognized: true,
    assets: null,
    evidence: [],
    warnings: [...scanWarnings],
    incomplete: !!scanWarnings.length,
    capacityIncomplete: scanWarnings.some((w) =>
      /一覧|読み取れません|列挙/.test(w),
    ),
    scanned: scoped.length,
    textRead: scoped.filter((e) => e.text !== undefined).length,
  };
  const evidence = (label: string, path: string) =>
    a.evidence.push({ label, path });
  evidence(
    `${packages.length}パッケージを含むワークスペース`,
    root +
      (map.has(root + "pnpm-workspace.yaml")
        ? "pnpm-workspace.yaml"
        : "package.json"),
  );
  if (a.capacityIncomplete) {
    a.warnings.push(
      "ファイル一覧が不完全なため、ワークスペース全体の判定を保留しています。",
    );
    return a;
  }
  const targets = deploymentTargets(packages, root);
  const unique = [
    ...new Map(targets.map((t) => [t.root + ":" + t.env, t])).values(),
  ];
  if (unique.length !== 1) {
    a.warnings.push(
      unique.length
        ? "複数のWorker・環境へのデプロイがあります。個別アプリを選んで確認してください。"
        : "ワークスペース内のアプリを統合する公開コマンドを特定できません。個別アプリを選んで確認してください。",
    );
    return a;
  }
  const target = unique[0];
  const configFile = [
    target.root + "wrangler.jsonc",
    target.root + "wrangler.json",
  ].find((p) => map.has(p));
  if (!configFile) {
    a.warnings.push("対象WorkerのJSON/JSONC設定を確認できません。");
    return a;
  }
  let config: Record<string, any>;
  try {
    config = jsonc(map.get(configFile)?.text ?? "");
  } catch {
    a.warnings.push("Worker設定を読み取れません。");
    return a;
  }
  if (target.env && (!config.env || !Object.hasOwn(config.env, target.env))) {
    a.warnings.push(`デプロイ環境「${target.env}」の設定がありません。`);
    return a;
  }
  const env = target.env ? config.env[target.env] : config;
  const main = repositoryPath(target.root, env.main ?? config.main);
  const assetDirectory = env.assets?.directory ?? config.assets?.directory;
  const assets = repositoryPath(target.root, assetDirectory);
  if (!main || !main.startsWith(root) || !assets || !assets.startsWith(root)) {
    a.warnings.push(
      "Workerのmainまたは静的配信フォルダを選択範囲内で解決できません。",
    );
    return a;
  }
  const code = map.get(main)?.text,
    ast = code ? parseCode(code) : null;
  let handler = false;
  if (ast)
    walk(ast, (n) => {
      if (n.type !== "ExportDefaultDeclaration") return;
      let d = n.declaration;
      while (["TSSatisfiesExpression", "TSAsExpression"].includes(d?.type))
        d = d.expression;
      if (
        d?.type === "ObjectExpression" &&
        d.properties.some(
          (p: any) =>
            ["fetch", "scheduled", "queue"].includes(
              p.key?.name ?? p.key?.value,
            ) &&
            ["FunctionExpression", "ArrowFunctionExpression"].includes(
              p.value?.type,
            ),
        )
      )
        handler = true;
    });
  if (!handler) {
    a.warnings.push("Workerの実行ハンドラーを確認できません。");
    return a;
  }
  const assetPrefix = assets + "/";
  const frontend = packages
    .filter((p) => assetPrefix.startsWith(p.root) && p.root !== target.root)
    .sort((x, y) => y.root.length - x.root.length)[0];
  if (
    !frontend ||
    !(map.has(frontend.root + "index.html") || frontend.data.dependencies?.next)
  ) {
    a.warnings.push("静的配信フォルダとフロントエンドの関係を確認できません。");
    return a;
  }
  const extraApps = packages.filter(
    (p) =>
      p.root !== root &&
      p.root !== target.root &&
      p.root !== frontend.root &&
      (map.has(p.root + "index.html") ||
        map.has(p.root + "wrangler.jsonc") ||
        map.has(p.root + "wrangler.json") ||
        p.data.dependencies?.next),
  );
  if (extraApps.length) {
    a.warnings.push(
      "同じ公開設定に含まれないアプリもあります。個別アプリを選んで確認してください。",
    );
    return a;
  }
  a.framework = "モノレポ / Workers + Web";
  a.runtime = "server";
  a.runtimeKind = "worker";
  a.worker = true;
  const d1 = Array.isArray(env.d1_databases) && env.d1_databases.length > 0;
  a.runtimeReason = `${target.env ? "環境「" + target.env + "」" : "既定環境"}の公開設定で、${target.root}のWorkerと${assetPrefix}のWeb配信が関連付いています。${d1 ? "D1のバインディングも確認しました。" : ""}`;
  evidence(
    `公開コマンドから${target.env ? "環境「" + target.env + "」" : "既定環境"}を選択`,
    target.root + "package.json",
  );
  evidence("Workersの実行ハンドラーを確認", main);
  evidence("Workerに関連付いたフロントエンド", frontend.root + "package.json");
  evidence(`Static Assetsの公開先 → ${assetPrefix}`, configFile);
  if (d1)
    evidence("対象環境にD1のバインディングあり（接続は未検証）", configFile);
  const patterns =
    env.assets?.run_worker_first ?? config.assets?.run_worker_first;
  if (Array.isArray(patterns))
    evidence(
      `Worker優先ルート：${patterns.filter((p: unknown) => typeof p === "string").join(", ")}`,
      configFile,
    );
  const measured =
    outputChoice === "auto" ? assets : repositoryPath(root, outputChoice);
  if (measured === null)
    a.warnings.push("手動指定した公開フォルダは選択範囲外です。");
  else {
    const prefix = measured ? measured + "/" : "";
    const measuredFiles = safe.filter((e) => e.path.startsWith(prefix));
    if (measuredFiles.length)
      a.assets = {
        path: prefix || "./",
        count: measuredFiles.length,
        bytes: measuredFiles.reduce((s, e) => s + e.size, 0),
        largest: measuredFiles.reduce((n, e) => Math.max(n, e.size), 0),
      };
    else
      a.warnings.push(
        `公開先「${prefix}」はまだ生成されていません。Webのビルド後に容量を確認してください。`,
      );
  }
  a.warnings.push(
    "公開設定を根拠とする構成判定です。APIの動作・認証・DB接続・本番の利用量は未検証です。",
  );
  return a;
}
