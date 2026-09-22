import { traceFetchUrls } from "./url-provenance.ts";
import type { Entry, Evidence } from "./types.ts";
import {
  parseCode,
  references,
  resolveReference,
  walk,
  member,
  stringValue,
  type Ast,
} from "./syntax.ts";
export type ClientGraph = {
  ready: boolean;
  evidence: Evidence[];
  issues: string[];
  notes: string[];
  files: Set<string>;
  externalApi: boolean;
  localApi: boolean;
  needsBuild: boolean;
};
export function inspectClient(
  entries: Entry[],
  htmlPath: string,
  bundled: boolean,
  outputPath: string | null = null,
): ClientGraph {
  const map = new Map(entries.map((e) => [e.path, e])),
    paths = new Set(map.keys());
  const r: ClientGraph = {
    ready: false,
    evidence: [],
    issues: [],
    notes: [],
    files: new Set(),
    externalApi: false,
    localApi: false,
    needsBuild: false,
  };
  const pending: { path: string; node: Ast }[] = [];
  function issue(message: string) {
    if (!r.issues.includes(message)) r.issues.push(message);
  }
  function visit(
    spec: string,
    from: string,
    kind: "asset" | "module" = "asset",
  ) {
    if (bundled) spec = spec.replace(/^%BASE_URL%/, "/");
    if (/^(https?:|data:|blob:|\/\/|#)/.test(spec)) return;
    if (
      bundled &&
      kind === "module" &&
      !spec.startsWith(".") &&
      !spec.startsWith("/") &&
      !/^[@~]\//.test(spec)
    ) {
      if (/^(node:|fs$|path$|http$|child_process$)/.test(spec))
        issue(`${from}からブラウザ非対応の${spec}を参照しています。`);
      return;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(spec);
    } catch {
      issue(`${from}の参照パスを確認できません。`);
      return;
    }
    let resolved = resolveReference(
      kind === "asset" && !/^[./]/.test(decoded) ? "./" + decoded : decoded,
      from,
      paths,
      bundled,
    );
    if (!resolved && bundled && decoded.startsWith("/"))
      resolved = resolveReference("/public" + decoded, from, paths, true);
    if (!resolved) {
      issue(`${from}の参照先「${spec}」を確認できません。`);
      return;
    }
    inspect(resolved);
  }
  function code(text: string, path: string) {
    const ast = parseCode(text);
    if (!ast) {
      issue(`${path}の構文に未対応です。`);
      return;
    }
    const refs = references(ast);
    if (refs.dynamic) issue(`${path}の動的import/require先を特定できません。`);
    refs.imports.forEach((spec) => visit(spec, path, "module"));
    walk(ast, (node) => {
      if (
        node.type === "CallExpression" &&
        ["fetch", "axios.get", "axios.post", "navigator.sendBeacon"].includes(
          member(node.callee),
        )
      ) {
        pending.push({ path, node });
      }
      if (
        node.type === "NewExpression" &&
        ["Worker", "SharedWorker"].includes(member(node.callee))
      ) {
        const arg = node.arguments[0],
          spec =
            stringValue(arg) ??
            (member(arg?.callee) === "URL"
              ? stringValue(arg.arguments[0])
              : null);
        if (spec) visit(spec, path, "module");
        else
          r.notes.push(
            `${path}のブラウザ内Worker参照先は動的です。公開後のアセット読み込みを確認してください。`,
          );
      }
    });
  }
  function inspect(path: string) {
    if (r.files.has(path)) return;
    r.files.add(path);
    const entry = map.get(path)!;
    if (/\.(tsx?|jsx|vue|svelte|scss|sass|less)$/.test(path))
      r.needsBuild = true;
    if (!/\.(?:html|css|[cm]?[jt]sx?)$/.test(path)) return;
    if (entry.text === undefined) {
      issue(`${path}の内容が未読です。`);
      return;
    }
    if (/\.[cm]?[jt]sx?$/.test(path)) {
      code(entry.text, path);
      return;
    }
    if (/\.css$/.test(path)) {
      for (const m of entry.text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .matchAll(
          /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)|@import\s+['"]([^'"]+)['"]/g,
        ))
        visit((m[1] ?? m[2] ?? m[3] ?? m[4]).trim(), path);
      return;
    }
    const html = entry.text.replace(/<!--[\s\S]*?-->/g, "");
    if (/<base\b/i.test(html)) issue(`${path}のbase設定は要確認です。`);
    for (const m of html.matchAll(
      /<(script|link|img|source|video|audio)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi,
    )) {
      const tag = m[0],
        attr = m[1].toLowerCase() === "link" ? "href" : "src";
      const value = tag.match(
        new RegExp(
          "\\b" + attr + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))",
          "i",
        ),
      );
      if (value) visit(value[1] ?? value[2] ?? value[3], path);
    }
    let n = 0;
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (
        /\bsrc\s*=/.test(m[1]) ||
        /\btype\s*=\s*['"](?:application\/(?:ld\+)?json|importmap)['"]/.test(
          m[1],
        ) ||
        !m[2].trim()
      )
        continue;
      code(m[2], path + `#inline-${++n}`);
    }
  }
  if (!map.has(htmlPath))
    issue(`HTMLエントリーポイント「${htmlPath}」がありません。`);
  else inspect(htmlPath);
  const proofs = pending.some(({ node }) => !stringValue(node.arguments[0]))
    ? traceFetchUrls(entries, r.files, bundled)
    : new Map();
  function readOnly(node: Ast): boolean {
    const name = member(node.callee);
    if (name === "axios.get") return true;
    if (name !== "fetch") return false;
    function options(n: Ast): boolean {
      if (!n || (n.type === "Literal" && n.value === null)) return true;
      if (n.type === "ConditionalExpression")
        return options(n.consequent) && options(n.alternate);
      if (n.type !== "ObjectExpression") return false;
      return n.properties.every((p: Ast) =>
        p.type === "SpreadElement"
          ? options(p.argument)
          : p.computed
            ? false
            : (p.key.name ?? p.key.value) === "body"
              ? false
              : (p.key.name ?? p.key.value) === "method"
                ? ["GET", "HEAD"].includes(stringValue(p.value) ?? "")
                : true,
      );
    }
    return options(node.arguments[1]);
  }
  function asset(raw: string): string | null {
    const url = raw.replace(/^@@BASE@@/, "");
    if (/^[a-z]+:|^\/\//i.test(url)) return null;
    let pathname: string;
    try {
      pathname = decodeURIComponent(
        new URL(url, "https://local.invalid/" + htmlPath).pathname,
      ).slice(1);
    } catch {
      return null;
    }
    if (outputPath !== null)
      return paths.has(outputPath + pathname) ? outputPath + pathname : null;
    for (const p of [pathname, ...(bundled ? ["public/" + pathname] : [])])
      if (paths.has(p)) return p;
    return null;
  }
  for (const { path, node } of pending) {
    const direct = stringValue(node.arguments[0]);
    if (direct && /^(https?:|\/\/|data:|blob:)/.test(direct)) {
      r.externalApi = true;
      continue;
    }
    const proof = direct
      ? { urls: [direct], complete: true, origins: [] }
      : proofs.get(path + ":" + node.start);
    const matched = proof?.urls.map(asset) ?? [];
    if (
      readOnly(node) &&
      proof?.complete &&
      matched.length &&
      matched.every(Boolean)
    ) {
      const count = new Set(matched).size;
      r.evidence.push({
        label:
          "GET/HEADのURL参照元を追跡し、" + count + "件の公開アセットと照合",
        path,
      });
      for (const origin of proof.origins)
        r.evidence.push({ label: "通信URLの参照元データ", path: origin });
      continue;
    }
    r.externalApi = true;
    r.localApi = true;
    issue(
      direct
        ? path +
            "から同じ公開先の「" +
            direct +
            "」へ通信しています。APIの配置先を確認してください。"
        : path +
            "の通信先を公開アセットに限定できません。APIの配置先・未確認の参照を確認してください。",
    );
  }
  if (r.needsBuild && !bundled)
    issue(
      "ブラウザで直接実行できないソースが参照されています。ビルド方式を確認してください。",
    );
  r.ready = r.issues.length === 0;
  if (r.ready)
    r.evidence.push({
      label: `HTMLから${r.files.size}ファイルの参照を追跡${bundled ? "（ビルド用ソース）" : "（ブラウザ実行構成）"}`,
      path: htmlPath,
    });
  return r;
}
