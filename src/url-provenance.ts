import type { Entry } from "./types.ts";
import {
  parseCode,
  stringValue,
  member,
  resolveReference,
  type Ast,
} from "./syntax.ts";

// A bounded abstract interpreter. It propagates values; it never executes project code.
type Value = {
  id: number;
  strings: Set<string>;
  links: Value[];
  props: Map<string, Value>;
  functions: Set<Fn>;
  unknown: boolean;
  access?: [Value, string];
  parameter?: boolean;
  jsonData?: unknown;
  jsonSource?: string;
  label?: string;
  collection?: boolean;
};
type Scope = { bindings: Map<string, Value>; parent?: Scope; self?: Value };
type Fn = {
  params: Ast[];
  scope: Scope;
  result: Value;
  node?: Ast;
  inputs?: Value[];
  builtin?: (args: Value[]) => void;
};
type Call = { callee: Value; args: Value[]; result: Value; invoked: Set<Fn> };
export type UrlProof = { urls: string[]; origins: string[]; complete: boolean };
const LIMIT = 25000;
export function traceFetchUrls(
  entries: Entry[],
  reachable: Set<string>,
  bundled: boolean,
): Map<string, UrlProof> {
  let next = 0,
    overflow = false,
    hint = "";
  const nodes: Value[] = [];
  const modules = new Map<
    string,
    { scope: Scope; exports: Value; ast?: Ast }
  >();
  const files = new Map(entries.map((e) => [e.path, e])),
    paths = new Set(files.keys());
  const calls: Call[] = [],
    fetches: { key: string; value: Value }[] = [];
  const origins = new Map<number, Set<string>>();
  const cache = new Map<string, Value>();
  const writes: [Value, string, Value][] = [];
  function write(target: Value, key: string, source: Value) {
    writes.push([target, key, source]);
    link(prop(target, key), source);
  }
  function value(unknown = false): Value {
    if (++next > LIMIT) {
      overflow = true;
      throw Error("URL analysis budget");
    }
    const v: Value = {
      id: next,
      strings: new Set(),
      links: [],
      props: new Map(),
      functions: new Set(),
      unknown,
      label: unknown ? hint : undefined,
    };
    nodes.push(v);
    return v;
  }
  function literal(s: string): Value {
    const v = value();
    v.strings.add(s);
    return v;
  }
  function link(target: Value, source: Value) {
    if (target !== source && !target.links.includes(source))
      target.links.push(source);
  }
  function prop(v: Value, key: string): Value {
    if (!v.props.has(key)) v.props.set(key, value());
    return v.props.get(key)!;
  }
  function access(v: Value, key: string): Value {
    const k = `${v.id}:${key}`;
    if (!cache.has(k)) {
      const a = value();
      a.label = (v.label ?? String(v.id)) + "." + key;
      a.access = [v, key];
      cache.set(k, a);
    }
    return cache.get(k)!;
  }
  function bind(scope: Scope, name: string): Value {
    if (!scope.bindings.has(name)) {
      const v = value();
      v.label = name;
      scope.bindings.set(name, v);
    }
    return scope.bindings.get(name)!;
  }
  function lookup(scope: Scope, name: string): Value {
    if (scope.bindings.has(name)) return scope.bindings.get(name)!;
    if (scope.parent) return lookup(scope.parent, name);
    if (name === "undefined") return value();
    const missing = value(true);
    missing.label = "unbound:" + name;
    return missing;
  }
  function declare(pattern: Ast, scope: Scope) {
    if (!pattern) return;
    if (pattern.type === "Identifier") bind(scope, pattern.name);
    else if (pattern.type === "AssignmentPattern") declare(pattern.left, scope);
    else if (pattern.type === "ObjectPattern")
      for (const p of pattern.properties) declare(p.value ?? p.argument, scope);
    else if (pattern.type === "ArrayPattern")
      pattern.elements.forEach((p: Ast) => declare(p, scope));
  }
  function assign(pattern: Ast, v: Value, scope: Scope) {
    if (!pattern) return;
    if (pattern.type === "Identifier") {
      let owner = scope;
      while (!owner.bindings.has(pattern.name) && owner.parent)
        owner = owner.parent;
      link(
        bind(owner.bindings.has(pattern.name) ? owner : scope, pattern.name),
        v,
      );
    } else if (pattern.type === "AssignmentPattern") {
      assign(pattern.left, v, scope);
      assign(pattern.left, expr(pattern.right, scope), scope);
    } else if (pattern.type === "ObjectPattern")
      for (const p of pattern.properties) {
        if (p.type === "RestElement") assign(p.argument, v, scope);
        else assign(p.value, access(v, p.key.name ?? p.key.value), scope);
      }
    else if (pattern.type === "ArrayPattern")
      pattern.elements.forEach((p: Ast, i: number) =>
        assign(p, access(v, String(i)), scope),
      );
    else if (pattern.type === "MemberExpression")
      write(
        expr(pattern.object, scope),
        pattern.computed
          ? (stringValue(pattern.property) ?? "*")
          : pattern.property.name,
        v,
      );
  }
  function json(v: unknown, source: string): Value {
    const out = value();
    origins.set(out.id, new Set([source]));
    if (typeof v === "string") out.strings.add(v);
    else if (v && typeof v === "object") {
      out.jsonData = v;
      out.jsonSource = source;
    }
    return out;
  }
  const projections = new Map<string, Set<Value>>(),
    resolving = new Set<string>(),
    projectedThisPass = new Set<string>();
  function deref(v: Value, key?: string, seen = new Set<string>()): Value[] {
    const token = `${v.id}/${key ?? ""}`;
    if (!projections.has(token)) projections.set(token, new Set());
    const projected = projections.get(token)!;
    if (resolving.size > 180) {
      overflow = true;
      return [...projected];
    }
    if (projections.size > 50000) throw Error("URL projection budget");
    if (projectedThisPass.has(token) || resolving.has(token))
      return [...projected];
    resolving.add(token);
    seen.add(token);
    if (key !== undefined && v.jsonData && typeof v.jsonData === "object") {
      const data = v.jsonData as Record<string, unknown>;
      if (key === "*" || (key === "@element" && Array.isArray(v.jsonData))) {
        for (const [k, item] of Object.entries(data))
          if (!v.props.has(k)) v.props.set(k, json(item, v.jsonSource!));
      } else if (Object.hasOwn(data, key) && !v.props.has(key))
        v.props.set(key, json(data[key], v.jsonSource!));
    }
    const result: Value[] = [];
    if (key === undefined || v.unknown) result.push(v);
    else if (key === "@element") {
      if (v.collection && v.props.has("*")) result.push(v.props.get("*")!);
      else if (Array.isArray(v.jsonData)) result.push(...v.props.values());
    } else if (key === "*")
      result.push(
        ...(v.props.has("*") ? [v.props.get("*")!] : v.props.values()),
      );
    else if (v.props.has(key)) result.push(v.props.get(key)!);
    else if (v.props.has("*")) result.push(v.props.get("*")!);
    if (v.access)
      for (const base of deref(v.access[0], v.access[1], new Set(seen)))
        result.push(...deref(base, key, new Set(seen)));
    for (const child of v.links)
      result.push(...deref(child, key, new Set(seen)));
    result.forEach((x) => projected.add(x));
    resolving.delete(token);
    projectedThisPass.add(token);
    return [...projected];
  }
  function invoke(callee: Value, args: Value[]): Value {
    const result = value();
    result.label = "call:" + callee?.label;
    calls.push({ callee, args, result, invoked: new Set() });
    return result;
  }
  function fn(node: Ast, scope: Scope, self?: Value): Value {
    const out = value(),
      local: Scope = {
        bindings: new Map(),
        parent: scope,
        self: self ?? scope.self,
      };
    const f: Fn = {
      params: node.params ?? [],
      scope: local,
      result: value(),
      node,
      inputs: [],
    };
    out.functions.add(f);
    for (const p of f.params) {
      declare(p, local);
      const initial = value();
      initial.parameter = true;
      initial.label =
        currentPath + ":param:" + (p.name ?? p.left?.name ?? p.start);
      initial.unknown = true;
      f.inputs!.push(initial);
      assign(p, initial, local);
    }
    if (node.body?.type === "BlockStatement")
      block(node.body.body, local, f.result);
    else if (node.body) link(f.result, expr(node.body, local));
    return out;
  }
  function expr(n: Ast, s: Scope): Value {
    if (!n) return value();
    hint = currentPath + ":" + n.type + ":" + n.start;
    switch (n.type) {
      case "Literal":
        return typeof n.value === "string" || typeof n.value === "number"
          ? literal(String(n.value))
          : value();
      case "Identifier":
        return lookup(s, n.name);
      case "UnaryExpression":
        expr(n.argument, s);
        return value();
      case "ThisExpression":
        return s.self ?? value(true);
      case "AwaitExpression":
      case "TSAsExpression":
      case "TSNonNullExpression":
      case "TSTypeAssertion":
      case "ChainExpression":
        return expr(n.argument ?? n.expression, s);
      case "ArrowFunctionExpression":
      case "FunctionExpression":
        return fn(n, s);
      case "ObjectExpression": {
        const v = value();
        for (const p of n.properties) {
          if (p.type === "SpreadElement") link(v, expr(p.argument, s));
          else
            link(
              prop(
                v,
                p.computed
                  ? (stringValue(p.key) ?? "*")
                  : (p.key.name ?? p.key.value),
              ),
              expr(p.value, s),
            );
        }
        return v;
      }
      case "ArrayExpression": {
        const v = value();
        v.collection = true;
        n.elements.forEach((e: Ast, i: number) => {
          const x = expr(e?.argument ?? e, s);
          const item = e?.type === "SpreadElement" ? access(x, "@element") : x;
          link(prop(v, String(i)), item);
          link(prop(v, "*"), item);
        });
        return v;
      }
      case "MemberExpression": {
        if (member(n) === "import.meta.env.BASE_URL")
          return literal("@@BASE@@/");
        return access(
          expr(n.object, s),
          n.computed
            ? (stringValue(n.property) ??
                (n.property.type === "Literal"
                  ? String(n.property.value)
                  : "*"))
            : n.property.name,
        );
      }
      case "ConditionalExpression":
      case "LogicalExpression": {
        const v = value();
        link(v, expr(n.consequent ?? n.left, s));
        link(v, expr(n.alternate ?? n.right, s));
        return v;
      }
      case "AssignmentExpression": {
        const v = n.operator === "=" ? expr(n.right, s) : value(true);
        assign(n.left, v, s);
        return v;
      }
      case "BinaryExpression": {
        if (n.operator !== "+") return value();
        const v = value();
        v.label = currentPath + ":binary:" + n.start;
        const a = expr(n.left, s),
          b = expr(n.right, s);
        const callback = value();
        callback.functions.add({
          params: [],
          scope: s,
          result: v,
          builtin: () => {
            const aa = collect(a),
              bb = collect(b);
            v.unknown = aa.unknown || bb.unknown;
            for (const x of aa.strings)
              for (const y of bb.strings)
                if (v.strings.size < 1024) v.strings.add(x + y);
                else if (!v.strings.has(x + y)) overflow = true;
          },
        });
        calls.push({
          callee: callback,
          args: [],
          result: v,
          invoked: new Set(),
        });
        return v;
      }
      case "TemplateLiteral": {
        if (!n.expressions.length) return literal(n.quasis[0].value.cooked);
        const v = value(),
          inputs = n.expressions.map((x: Ast) => expr(x, s)),
          task = value();
        task.functions.add({
          params: [],
          scope: s,
          result: v,
          builtin: () => {
            let strings = [n.quasis[0].value.cooked];
            v.unknown = false;
            for (let i = 0; i < inputs.length; i++) {
              const part = collect(inputs[i]);
              v.unknown ||= part.unknown;
              const next: string[] = [];
              for (const prefix of strings)
                for (const item of part.strings) {
                  if (next.length >= 1024) {
                    v.unknown = true;
                    break;
                  }
                  next.push(prefix + item + n.quasis[i + 1].value.cooked);
                }
              strings = next;
            }
            for (const str of strings) v.strings.add(str);
          },
        });
        calls.push({ callee: task, args: [], result: v, invoked: new Set() });
        return v;
      }

      case "NewExpression": {
        const args = n.arguments.map((a: Ast) => expr(a, s));
        const name = member(n.callee);
        if (["Map", "Set", "WeakMap"].includes(name)) {
          const v = value();
          v.collection = true;
          for (const method of ["delete", "clear"]) {
            const operation = value();
            operation.functions.add({
              params: [],
              scope: s,
              result: value(),
              builtin: () => {},
            });
            link(prop(v, method), operation);
          }
          if (args[0]) link(prop(v, "*"), access(args[0], "*"));
          return v;
        }
        if (name === "Promise") return value();
        return invoke(expr(n.callee, s), args);
      }
      case "CallExpression": {
        const name = member(n.callee),
          args: Value[] = n.arguments.map((a: Ast) => expr(a.argument ?? a, s));
        if (
          /^(Math\.|Number(?:\.|$)|Boolean$|parseInt$|parseFloat$|isNaN$|isFinite$)/.test(
            name,
          )
        )
          return value();
        if (name === "String") return args[0] ?? literal("");
        if (name === "fetch") {
          fetches.push({
            key: `${currentPath}:${n.start}`,
            value: args[0] ?? value(true),
          });
          return value(true);
        }
        if (name === "Object.values") return array(access(args[0], "*"));
        if (name === "Object.entries") {
          const pair = value();
          link(prop(pair, "0"), value());
          link(prop(pair, "1"), access(args[0], "*"));
          return array(pair);
        }
        if (name === "Object.fromEntries")
          return objectValues(access(access(args[0], "*"), "1"));
        if (name === "Array.from") return args[0] ?? value();
        if (
          name === "Promise.all" ||
          name === "Promise.race" ||
          name === "Promise.resolve"
        )
          return name === "Promise.race"
            ? access(args[0], "*")
            : (args[0] ?? value());
        if (/(?:^|\.)(useMemo|useEffect|useLayoutEffect)$/.test(name))
          return invoke(args[0], []);
        if (/(?:^|\.)useCallback$/.test(name)) return args[0];
        if (/(?:^|\.)useRef$/.test(name)) {
          const v = value();
          link(prop(v, "current"), args[0] ?? value());
          return v;
        }
        if (/(?:^|\.)createContext$/.test(name)) {
          const v = value();
          link(prop(v, "$context"), args[0] ?? value());
          return v;
        }
        if (/(?:^|\.)useContext$/.test(name))
          return access(args[0], "$context");
        if (/(?:^|\.)useState$/.test(name)) {
          const v = value(),
            state = prop(v, "0"),
            setter = value();
          link(state, args[0] ?? value());
          setter.functions.add({
            params: [],
            scope: s,
            result: value(),
            builtin: (incoming) => {
              if (incoming[0]) link(state, incoming[0]);
            },
          });
          link(prop(v, "1"), setter);
          return v;
        }
        if (n.callee.type === "MemberExpression") {
          const receiver = expr(n.callee.object, s),
            method = n.callee.property.name;
          if (method === "forEach") {
            invoke(args[0], [access(receiver, "@element"), value()]);
            return value();
          }
          if (["map", "flatMap"].includes(method))
            return array(invoke(args[0], [access(receiver, "*"), value()]));
          if (["filter", "sort", "slice", "reverse"].includes(method)) {
            if (["filter", "sort"].includes(method))
              invoke(args[0], [access(receiver, "*"), access(receiver, "*")]);
            return receiver;
          }
          if (["find", "at", "pop", "shift"].includes(method)) {
            if (method === "find") invoke(args[0], [access(receiver, "*")]);
            return access(receiver, "*");
          }
          if (method === "then") return invoke(args[0], [receiver]);
          if (method === "set") {
            receiver.collection = true;
            link(prop(receiver, "*"), args[1] ?? value());
            return receiver;
          }
          if (method === "get") return access(receiver, "*");
          if (method === "values") return array(access(receiver, "*"));
          if (method === "push") {
            for (const a of args) link(prop(receiver, "*"), a);
            return value();
          }
          if (
            method === "replace" &&
            n.arguments[0]?.regex?.pattern === "\\/+$" &&
            stringValue(n.arguments[1]) === ""
          ) {
            // Canonical URL base normalization only; arbitrary rewrites remain unknown.
            const v = value(),
              task = value();
            v.label = currentPath + ":replace:" + n.start;
            task.functions.add({
              params: [],
              scope: s,
              result: v,
              builtin: () => {
                const result = collect(receiver);
                v.unknown = result.unknown;
                for (const x of result.strings)
                  v.strings.add(x.replace(/\/+$/, ""));
              },
            });
            calls.push({
              callee: task,
              args: [],
              result: v,
              invoked: new Set(),
            });
            return v;
          }
          if (
            [
              "startsWith",
              "endsWith",
              "includes",
              "some",
              "every",
              "canPlayType",
              "decodingInfo",
              "has",
            ].includes(method)
          )
            return value();
        }
        return invoke(expr(n.callee, s), args);
      }
      case "JSXElement": {
        const opening = n.openingElement,
          props = value();
        for (const a of opening.attributes) {
          if (a.type === "JSXSpreadAttribute") link(props, expr(a.argument, s));
          else
            link(
              prop(props, a.name.name),
              a.value?.type === "JSXExpressionContainer"
                ? expr(a.value.expression, s)
                : expr(a.value, s),
            );
        }
        if (
          opening.name.type === "JSXIdentifier" &&
          /^[A-Z]/.test(opening.name.name)
        )
          invoke(lookup(s, opening.name.name), [props]);
        if (
          opening.name.type === "JSXMemberExpression" &&
          opening.name.property.name === "Provider"
        )
          write(
            lookup(s, opening.name.object.name),
            "$context",
            access(props, "value"),
          );
        for (const child of n.children ?? [])
          expr(
            child.type === "JSXExpressionContainer" ? child.expression : child,
            s,
          );
        return value();
      }
      case "JSXFragment":
        for (const child of n.children ?? [])
          expr(
            child.type === "JSXExpressionContainer" ? child.expression : child,
            s,
          );
        return value();
      case "JSXText":
        return value();
      case "SequenceExpression": {
        let v = value();
        for (const e of n.expressions) v = expr(e, s);
        return v;
      }
      default:
        return value(true);
    }
  }
  function array(v: Value) {
    const a = value();
    a.collection = true;
    link(prop(a, "*"), v);
    return a;
  }
  function objectValues(v: Value) {
    const o = value();
    link(prop(o, "*"), v);
    return o;
  }
  let currentPath = "";
  function block(statements: Ast[], scope: Scope, returns = value()) {
    for (const raw of statements) {
      const n = raw.declaration ?? raw;
      if (n.type === "VariableDeclaration")
        for (const d of n.declarations) declare(d.id, scope);
      if (n.type === "FunctionDeclaration" && n.id) bind(scope, n.id.name);
      if (n.type === "ClassDeclaration" && n.id) bind(scope, n.id.name);
    }
    for (const raw of statements) {
      const n = raw.declaration ?? raw;
      if (n.type === "VariableDeclaration")
        for (const d of n.declarations)
          assign(d.id, expr(d.init, scope), scope);
      else if (n.type === "FunctionDeclaration" && n.id)
        link(bind(scope, n.id.name), fn(n, scope));
      else if (n.type === "ClassDeclaration") {
        const instance = value(),
          ctor = value();
        const f: Fn = { params: [], scope, result: instance };
        ctor.functions.add(f);
        link(bind(scope, n.id.name), ctor);
        for (const m of n.body.body) {
          const key = m.key.name ?? m.key.value;
          if (m.type === "MethodDefinition")
            link(prop(instance, key), fn(m.value, scope, instance));
          else
            link(
              prop(instance, key),
              expr(m.value, {
                bindings: new Map(),
                parent: scope,
                self: instance,
              }),
            );
        }
      } else if (n.type === "ReturnStatement")
        link(returns, expr(n.argument, scope));
      else if (n.type === "ExpressionStatement") expr(n.expression, scope);
      else if (n.type === "BlockStatement")
        block(
          n.body,
          { bindings: new Map(), parent: scope, self: scope.self },
          returns,
        );
      else if (n.type === "IfStatement") {
        expr(n.test, scope);
        block([n.consequent], scope, returns);
        if (n.alternate) block([n.alternate], scope, returns);
      } else if (n.type === "ForOfStatement") {
        const local: Scope = {
          bindings: new Map(),
          parent: scope,
          self: scope.self,
        };
        assign(
          n.left.declarations?.[0]?.id ?? n.left,
          access(expr(n.right, scope), "@element"),
          local,
        );
        block([n.body], local, returns);
      } else if (n.type === "TryStatement") {
        block([n.block], scope, returns);
        if (n.handler) block([n.handler.body], scope, returns);
        if (n.finalizer) block([n.finalizer], scope, returns);
      } else if (n.type === "SwitchStatement") {
        expr(n.discriminant, scope);
        for (const c of n.cases) block(c.consequent, scope, returns);
      } else if (
        n.type === "ForStatement" ||
        n.type === "WhileStatement" ||
        n.type === "DoWhileStatement"
      ) {
        if (n.init?.type === "VariableDeclaration")
          block([n.init], scope, returns);
        else expr(n.init, scope);
        expr(n.test, scope);
        block([n.body], scope, returns);
        expr(n.update, scope);
      } else if (n.type === "LabeledStatement") block([n.body], scope, returns);
    }
  }
  function collect(v: Value): {
    strings: Set<string>;
    unknown: boolean;
    origins: Set<string>;
  } {
    const strings = new Set<string>(),
      src = new Set<string>(),
      seen = new Set<number>();
    let unknown = false;
    function gather(node: Value) {
      if (seen.has(node.id)) return;
      seen.add(node.id);
      unknown ||= node.unknown;
      node.strings.forEach((x) => strings.add(x));
      origins.get(node.id)?.forEach((x) => src.add(x));
      for (const child of node.links) gather(child);
      if (node.access) {
        const nodes = deref(node.access[0], node.access[1]);
        nodes.forEach(gather);
      }
    }
    gather(v);
    return { strings, unknown, origins: src };
  }
  try {
    for (const path of reachable) {
      const e = files.get(path);
      if (!e || e.text === undefined) continue;
      const scope: Scope = { bindings: new Map() },
        exports = value();
      const ast = /\.[cm]?[jt]sx?$/.test(path) ? parseCode(e.text) : undefined;
      modules.set(path, { scope, exports, ast });
      if (path.endsWith(".json")) {
        try {
          link(prop(exports, "default"), json(JSON.parse(e.text), path));
        } catch {
          exports.unknown = true;
        }
      }
    }
    for (const [path, m] of modules) {
      if (!m.ast) continue;
      for (const n of m.ast.body) {
        if (n.type !== "ImportDeclaration" || n.importKind === "type") continue;
        const source = stringValue(n.source);
        if (!source) continue;
        const target = resolveReference(source, path, paths, bundled),
          imported = target ? modules.get(target)?.exports : undefined;
        for (const spec of n.specifiers) {
          if (imported)
            link(
              bind(m.scope, spec.local.name),
              spec.type === "ImportNamespaceSpecifier"
                ? imported
                : access(
                    imported,
                    spec.type === "ImportDefaultSpecifier"
                      ? "default"
                      : spec.imported.name,
                  ),
            );
        }
      }
    }
    for (const [path, m] of modules) {
      if (!m.ast) continue;
      currentPath = path;
      block(m.ast.body, m.scope);
      for (const n of m.ast.body) {
        if (n.type === "ExportNamedDeclaration") {
          if (n.declaration?.id)
            link(
              prop(m.exports, n.declaration.id.name),
              lookup(m.scope, n.declaration.id.name),
            );
          for (const d of n.declaration?.declarations ?? [])
            if (d.id.name)
              link(prop(m.exports, d.id.name), lookup(m.scope, d.id.name));
          for (const spec of n.specifiers ?? [])
            link(
              prop(m.exports, spec.exported.name),
              lookup(m.scope, spec.local.name),
            );
        }
        if (n.type === "ExportDefaultDeclaration")
          link(
            prop(m.exports, "default"),
            n.declaration.id
              ? lookup(m.scope, n.declaration.id.name)
              : expr(n.declaration, m.scope),
          );
      }
    }
    let prior = "",
      settled = false;
    for (let pass = 0; pass < 32; pass++) {
      projectedThisPass.clear();
      for (const [target, key, source] of writes)
        for (const actual of deref(target))
          if (
            !actual.unknown &&
            !actual.access &&
            !actual.links.length &&
            (actual.props.has(key) ||
              (actual.jsonData &&
                Object.hasOwn(actual.jsonData as object, key)) ||
              (!actual.jsonData &&
                !actual.props.size &&
                !actual.functions.size))
          )
            link(prop(actual, key), source);
      for (const call of calls) {
        for (const candidate of deref(call.callee))
          for (const f of candidate.functions) {
            if (f.builtin) f.builtin(call.args);
            else if (!call.invoked.has(f)) {
              f.inputs?.forEach((input) => (input.unknown = false));
              f.params.forEach((p, i) =>
                assign(p, call.args[i] ?? value(), f.scope),
              );
            }
            link(call.result, f.result);
            call.invoked.add(f);
          }
      }
      for (const call of calls)
        if (![...call.invoked].some((f) => f.builtin))
          call.result.unknown = !call.invoked.size;
      const signature =
        nodes
          .map((v) =>
            [
              v.strings.size,
              v.links.length,
              v.props.size,
              Number(v.unknown),
            ].join(","),
          )
          .join("|") +
        ":" +
        [...projections.values()].reduce((n, s) => n + s.size, 0);
      if (signature === prior) {
        settled = true;
        break;
      }
      prior = signature;
    }
    if (!settled) overflow = true;
    // Unresolved calls on the demanded URL path are never silently treated as known data.
    for (const call of calls)
      if (!call.invoked.size) {
        call.result.unknown = true;
        for (const arg of call.args)
          for (const actual of deref(arg))
            if (actual.jsonData || actual.props.size) {
              actual.unknown = true;
              actual.label = "opaque:" + call.callee.label;
            }
      }
    const proofs = new Map<string, UrlProof>();
    for (const f of fetches) {
      const result = collect(f.value);
      proofs.set(f.key, {
        urls: [...result.strings].filter((s) => s.length > 0),
        origins: [...result.origins],
        complete: !overflow && !result.unknown && result.strings.size > 0,
      });
    }
    return proofs;
  } catch {
    return new Map();
  }
}
