# ssr-leak

Catch module-scope state that leaks between SSR requests in Next.js.

[한국어 README](./README.ko.md)

## The problem

On the server, a module is evaluated **once** and then shared by **every request** that the process serves.
Anything you write into module scope — `axios.defaults`, a shared axios instance, a `let` at the top of a file,
a module-level `Map` — is therefore visible to the next request, which may belong to a different user.

```ts
// lib/api.ts
import axios from 'axios';

export async function getServerSideProps(ctx) {
  // ❌ Request A writes its token into the shared instance.
  //    Request B, arriving 2 ms later, is served with A's Authorization header.
  axios.defaults.headers.common['Authorization'] = `Bearer ${ctx.req.cookies.token}`;
  const { data } = await axios.get('https://api.acme.test/me');
  return { props: { data } };
}
```

```ts
// ✅ Keep request data in request scope.
export async function getServerSideProps(ctx) {
  const { data } = await axios.get('https://api.acme.test/me', {
    headers: { Authorization: `Bearer ${ctx.req.cookies.token}` },
  });
  return { props: { data } };
}
```

This is a security bug (cross-user data exposure). It reproduces deterministically under concurrent load and is
invisible in local development where there is one user and one request at a time. No mainstream lint rule targets
it, so `ssr-leak` is a small static checker that does.

## What it does / does not do

**Does**

- Finds writes to `<axios>.defaults.*`, `<axios>.interceptors.*.use()`, module-level variables / objects / collections,
  and `globalThis` / `process.env` that happen **inside a function body** — i.e. code that can run per request.
- Tracks whether the written value is derived from the request and **where the taint comes from**: a request
  primitive (`headers()`, `cookies()`, `req.*`, a parameter of `getServerSideProps` / a route handler / …) gives
  `high` confidence; a bare argument of some other function (a setter, a subscription) gives `medium`. The
  default output therefore stays short and actionable.
- Runs on the TypeScript compiler's parser only (no type checker, no project setup): ~10k files in a few seconds.
- Ships a CLI, a programmatic API, and a stable `--json` shape for CI.

**Does not**

- Prove that a function runs during SSR. A module without `'use client'` is analyzed even if, at runtime, only the
  browser ever calls the function. Use the `ignore` config or suppression comments for such modules.
- Treat `'use client'` as "not server code". **Client Components are still server-rendered on every request**, so
  a module-scope write inside one leaks exactly like any other. Such files are skipped by default only to keep the
  default output short (most of their writes are browser-only event handlers). This is a noise trade-off, not a
  safety guarantee — run with `--include-client` for audits and for `app/**` trees.
- Follow values across files. A shared instance created in another module is only recognized by shape
  (`.defaults.headers`, `.interceptors.request.use`).
- Replace `eslint-plugin-react-hooks`, `@next/eslint-plugin-next`, or type-aware ESLint rules. Those catch
  different classes of bugs; none of them models "module scope is shared across requests".
- Detect leaks through closures stored in module scope (`handlers.push(() => req.user)`), or through
  class instances stored at module scope and mutated via `this`.

## Install & usage

```sh
# one-off
npx ssr-leak

# in a project
pnpm add -D ssr-leak
pnpm ssr-leak src app pages lib
```

Default: every `*.{ts,tsx,js,jsx,mjs,cjs}` under the current directory, skipping

- directories named `node_modules`, `dist`, `build`, `out`, `.next`, `.vercel`, `.output`, `.turbo`, `.cache`,
  `.git`, `coverage`, `storybook-static`, `public`, `mocks`, `__mocks__` wherever they appear (build outputs,
  static assets, caches, VCS metadata, mock handlers) — override with `exclude` / `include` in the config file; a
  directory you name explicitly on the command line is always walked;
- declaration files and test/story/mock files (`*.test.*`, `*.spec.*`, `__tests__/`, `*.stories.*`, `*.mock.*`);
- minified files: `*.min.js` and any file with a line longer than 2000 characters (a file you name explicitly or
  match with `include` is analyzed anyway);
- files that start with `'use client'`, unless `--include-client` is given (see the caveat above).

An empty input set is an error: a positional path that does not exist, or globs that match nothing, exit 2 so a
misconfigured CI job cannot pass silently. Pass `--allow-empty` to get exit 0 instead.

## CLI options

| Option | Description |
| --- | --- |
| `[globs...]` | Globs, directories or files, relative to `--root`. Supports `**`, `*`, `?`, `{a,b}`. A directory means "everything under it". A path that does not exist is an error (exit 2). |
| `--root <dir>` | Directory that globs, `--config` and reported paths are relative to. Default: current directory. |
| `--all` | Also report low-confidence rules: R2 `axios-defaults-at-module-scope` and R5 `module-state-write-untainted`. |
| `--include-client` | Analyze files whose first statement is `'use client'`. Recommended for audits. |
| `--json` | Machine-readable output (see below). |
| `--config <path>` | Config file, resolved relative to `--root`. Default: `ssr-leak.config.{json,mjs,js,cjs}` in `--root`, if present. |
| `--fail-on <level>` | Exit 1 when any finding is at or above `high` (default), `medium`, `low`; `none` never fails. |
| `--allow-empty` | Exit 0 instead of 2 when no file was analyzed or a positional path does not exist. |
| `-h, --help` / `-v, --version` | Help / version. |

## Rules

| ID | Name | Confidence | Default | What it flags |
| --- | --- | --- | --- | --- |
| R1 | `axios-defaults-in-function` | high | on | `<axios>.defaults.*` assigned (or `Object.assign`ed) inside a function. `<axios>` is the default import of `axios`, `require('axios')`, a module-level variable initialized by `<axios>.create()` or by `create()` destructured from `axios`, or an imported binding when the path is `.defaults.headers…`. |
| R2 | `axios-defaults-at-module-scope` | low | `--all` | The same write at module top level. Not per-request, only global mutable config. |
| R3 | `axios-interceptor-in-request-path` | high | on | `<axios>.interceptors.request\|response.use()` inside a function that is not module init, not a React effect, and has no matching `.eject()` in the same function. |
| R4 | `module-state-write-tainted` | high / medium | on | Inside a function: reassigning a module-level `let`/`var` (also via destructuring `[x] = …`, `({ x } = …)`), assigning a property of a module-level binding, or calling `set/add/push/unshift/splice` on a module-level `Map`/`Set`/`Array` (or `Object.assign(moduleObj, …)`), where the value **or key** is request-scoped. `high` when the taint comes from a request primitive; `medium` when its only source is a bare parameter of a function that is not a recognized SSR entry point (message: *possible per-request write (value comes from a function argument)*). |
| R5 | `module-state-write-untainted` | low | `--all` | The same write with a value that is not request-scoped (a constant-keyed memo cache, a counter). Useful for audits. |
| R6 | `global-object-write` | medium | on | `globalThis.x`, `global.x`, `process.env.X` assigned inside a function. Browser host objects (`globalThis.location`, `.document`, …) are excluded. |

`high` and `medium` findings are shown by default; `low` only with `--all`. `--fail-on` defaults to `high`, so a
`medium` finding is visible but does not fail CI until you opt in with `--fail-on medium`.

**Request primitives** (R4 `high`): calls to `headers()`, `cookies()`, `draftMode()`, `getServerSession()` (plus
`taintSources.functions`); property reads on identifiers named `req`, `request`, `ctx`, `context`, `params`,
`searchParams`, `event` (plus `taintSources.identifiers`); and parameters of recognized SSR entry points:
`getServerSideProps`, `getStaticProps`, `getInitialProps` (also when wrapped: `export const getServerSideProps =
withAuth(async (ctx) => …)`), exported `GET`/`POST`/`PUT`/`PATCH`/`DELETE`/`HEAD`/`OPTIONS` route handlers, exported
`middleware`, the default export of a `pages/api/**` file, and a default-exported function with parameters in
`app/**/page|layout|template.*`.

### Suppression

```ts
// ssr-leak-ignore-next-line
cache.set(key, value);

// ssr-leak-ignore-next-line R5, module-state-write-tainted   ← only these rules
counter++;

// ssr-leak-ignore-next-line R4 -- browser only               ← anything after "--" is a reason and is ignored
lastScroll = y;
```

```ts
/* ssr-leak-disable */   ← at the top of a file (before the first statement, after any directive)
```

### Config file

`ssr-leak.config.json` (or `.mjs` / `.js` / `.cjs` with a default export):

```json
{
  "ignore": ["**/mocks/**", "src/legacy/browser-only/**"],
  "exclude": ["node_modules", "dist", ".next", "generated"],
  "include": ["public/sw/**"],
  "taintSources": {
    "functions": ["auth", "getToken"],
    "identifiers": ["nextReq"]
  },
  "guards": {
    "server": ["isNodeRuntime"],
    "client": ["inBrowser"]
  }
}
```

- `ignore` — globs relative to `--root`; matching files and directories are skipped.
- `exclude` — directory basenames skipped wherever they appear. **Replaces** the built-in list (see
  "Install & usage"), so repeat the entries you still want.
- `include` — globs relative to `--root` that are analyzed even when they sit under an excluded directory or look
  minified.
- `taintSources.functions` — extra function names whose return value is request-scoped (built-in:
  `headers`, `cookies`, `draftMode`, `getServerSession`).
- `taintSources.identifiers` — extra identifiers whose property reads are request-scoped (built-in:
  `req`, `request`, `ctx`, `context`, `params`, `searchParams`, `event`).
- `guards.server` — extra functions or identifiers that are truthy only on the server, used to recognize
  browser-only code (built-in: `isServer`, `isSSR`, `isServerSide`). Matched by the last name of the callee, so
  `runtime.isServer()` counts.
- `guards.client` — the browser-side counterparts (built-in: `isClient`, `isBrowser`, `isClientSide`,
  `canUseDOM`). `typeof window !== 'undefined'` and friends are always recognized.

## Output example

Human:

```
src/pages/profile.tsx:12:3  R1 axios-defaults-in-function [high]  `axios.defaults.headers.common['Authorization']` is assigned inside a function. The axios instance lives at module scope and is shared by every SSR request, so one request's value is served to the next.
    fix: Create a per-request instance (axios.create({ headers })) or pass headers per call (axios.get(url, { headers })).
src/lib/session.ts:9:3  R4 module-state-write-tainted [high]  Request-scoped data (from `headers()`) is written into module-level state `cfg.token`. The module is shared across SSR requests, so a different user's request can read it.
    fix: Keep request data in request scope: return it, pass it as an argument, or use a per-request container (React cache(), AsyncLocalStorage, or a per-request object).
src/lib/store.ts:4:3  R4 module-state-write-tainted [medium]  Possible per-request write (value comes from a function argument): parameter `next` is written into module-level state `payload`. If this function runs during SSR, the module is shared across requests and a different user's request can read the value.
    fix: Keep request data in request scope: return it, pass it as an argument, or use a per-request container (React cache(), AsyncLocalStorage, or a per-request object).

3 findings (2 high, 1 medium, 0 low) — 412 files scanned in 180ms
```

`--json`:

```json
{
  "version": "0.1.0",
  "root": "/work/acme-web",
  "filesScanned": 412,
  "durationMs": 180,
  "findings": [
    {
      "file": "src/pages/profile.tsx",
      "line": 12,
      "column": 3,
      "endLine": 12,
      "endColumn": 78,
      "ruleId": "R1",
      "rule": "axios-defaults-in-function",
      "confidence": "high",
      "message": "`axios.defaults.headers.common['Authorization']` is assigned inside a function. ...",
      "fixHint": "Create a per-request instance (axios.create({ headers })) or pass headers per call (axios.get(url, { headers })).",
      "snippet": "axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;"
    }
  ],
  "summary": { "total": 3, "high": 2, "medium": 1, "low": 0 },
  "diagnostics": []
}
```

`file` is relative to `root` with `/` separators; `line`/`column` are 1-based. `diagnostics` lists input problems
(`{ "kind": "missing-path" | "empty-input" | "unreadable-file", "path"?, "message" }`); the CLI also prints them
on stderr. The shape is stable within a major version; new fields may be added.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | No finding at or above `--fail-on` |
| 1 | At least one finding at or above `--fail-on` (default `high`) |
| 2 | Usage or config error (unknown option, bad `--fail-on`, invalid or missing config file); a positional path that does not exist or an empty input set (unless `--allow-empty`); a file that could not be read |

Errors that exit 2 are printed as one line on stderr, without a stack trace.

## Programmatic API

```ts
import { analyzeSource, run, shouldFail } from 'ssr-leak';

// Pure, single source text. The file name selects the parser (ts / tsx / js / jsx).
const findings = analyzeSource(code, 'app/page.tsx', { all: false, includeClient: false });

// Discover files under root, apply ssr-leak.config.*, analyze everything.
const report = await run({
  root: process.cwd(),
  patterns: ['src', 'app'],
  all: false,
  includeClient: false,
  config: { ignore: ['**/mocks/**'] }, // or a path (relative to root); omit to auto-discover
  taintSources: { functions: ['auth'] },
});

if (report.diagnostics.length > 0) process.exitCode = 2; // missing path, empty input, unreadable file
else process.exitCode = shouldFail(report.findings, 'high') ? 1 : 0;
```

`run()` never throws for input problems; it reports them in `report.diagnostics`. `analyzeFile(file, options)`
analyzes one file and throws like `fs.readFileSync` when it cannot be read.

Also exported: `analyzeFile`, `collectFiles`, `collectFilesDetailed`, `formatHuman`, `formatJson`, `summarize`,
`parseIgnoreRules`, `isMinifiedSource`, `RULES`, `RULE_LIST`, `validateConfig`, `loadConfigFile`,
`DEFAULT_EXCLUDED_DIRS`, `DEFAULT_TAINT_FUNCTIONS`, `DEFAULT_TAINT_IDENTIFIERS`, `VERSION`, and the types
`Finding`, `Report`, `Diagnostic`, `RunOptions`, `AnalyzeOptions`, `Config`, `RuleId`, `Confidence`, `Taint`.
The CLI is a thin wrapper over `run()`.

The package ships ESM and CommonJS builds with matching declarations (`import` resolves `dist/index.d.ts`,
`require` resolves `dist/index.d.cts`), so TypeScript consumers under `moduleResolution: node16` / `bundler`
work in both module systems.

## How it works

Everything is syntactic plus a small binder; no type checker, no `tsconfig`, no cross-file resolution.

1. **Parse** with `ts.createSourceFile` (script kind from the extension; `.js`/`.mjs`/`.cjs` parse as JS,
   `.jsx`/`.tsx` with JSX).
2. **File gates.** Skip when a `ssr-leak-disable` comment precedes the first statement, or when the directive
   prologue contains `'use client'` (unless `--include-client`; remember that client components are still
   server-rendered — this gate only reduces noise). Test and story files, excluded directories and minified files
   are dropped during discovery.
3. **Module scope.** Walk top-level statements and record every binding: imports (with "is this `axios`?" and
   "is this `create` from `axios`?"), `const`/`let`/`var` (with the initializer's shape: `new Map()`, `[]`, `{}`,
   `<axios>.create()`, `create()`, `require()`), functions, classes, enums. Also record the names of functions
   **invoked** and classes **instantiated** by a top-level statement.
4. **Function scopes.** Each function-like node (declaration, expression, arrow, method, accessor, constructor)
   gets a scope holding its parameter names, the names declared in its body, and every expression assigned to
   each local (initializers, `=`, destructuring, `for…of` sources). Blocks are not modeled separately: a name
   declared anywhere in the function body is local to the function. This is imprecise in the direction that
   produces **fewer** findings. The scope also records whether the function is a recognized SSR entry point.
5. **Name resolution.** An identifier is resolved from the innermost function scope outward, then module scope,
   otherwise "unresolved" (`globalThis`, `process`, `Object`, undeclared globals).
6. **Request path.** A node is "in the request path" when at least one function encloses it, and none of the
   enclosing functions is *module init*: an IIFE at module scope, a non-exported function that a top-level
   statement invokes directly, or the constructor of a non-exported class that a top-level statement instantiates
   (`const boot = new Boot()`). Code inside `useEffect` / `useLayoutEffect` / `useInsertionEffect` callbacks is
   never checked, because effects do not run during SSR.
   **Browser-only guards.** A write that can only execute in a browser is reported at `low` (visible with
   `--all`, with a note in the message) instead of its normal confidence. Recognized shapes, all within the
   same function: everything after `if (isServer()) return;` (or `throw`) in the same block; the then-branch of
   `if (typeof window !== 'undefined')`; the else-branch of `if (typeof window === 'undefined')`; the right side of
   `isClient() && …` / `isServer() || …`; the matching arm of a ternary. Conditions use three-valued logic on
   "what is this during SSR": `isServer() || flag` is still a server guard (true on the server whatever `flag`
   is), `isServer() && flag` is not. Recognized atoms: `typeof window|document|navigator|self` (also via
   `globalThis.`) compared with `'undefined'` / `'object'`, `!x`, and calls or identifiers whose last name is in
   the built-in or configured `guards` lists. A guard in a *different* function (`ensureBrowser()` called at the
   top) is not followed.
7. **Writes.** For every assignment (`=`, `+=`, …, including destructuring targets), `++`/`--`,
   `Object.assign(target, …)`, and mutating call (`set/add/push/unshift/splice/clear/delete/pop/shift`), resolve
   the target's root identifier and property chain and classify: axios defaults → R1/R2;
   `globalThis`/`global`/`process.env` → R6; a module-level binding → R4/R5 (reassignment only for `let`/`var`;
   mutating calls only when the binding was initialized as a `Map`/`Set`/`Array` literal or constructor, so
   `router.push(url)` on an imported `router` is not a finding).
8. **Taint.** Flow-insensitive: an expression is request-scoped if it is a parameter of *any* enclosing
   function, a call to a taint-source function (`headers()`, `cookies()`, `draftMode()`, `getServerSession()`,
   plus config), a property read on a taint identifier (`req`, `ctx`, `params`, … plus config) that is not a
   module-level binding, or is built from something tainted: local variables (any assignment to the local),
   member access, calls whose receiver or **any argument** is tainted, `await`, `as`, template literals,
   binary/conditional expressions, object/array literals, `new`. Function and class expressions are never
   tainted. Each taint carries its **provenance**: a request primitive (taint-source call, taint identifier,
   parameter of an SSR entry point) wins over a bare parameter, and R4's confidence follows it (`high` vs
   `medium`).
9. **Suppression** is checked on the finding's line before it is recorded (`-- reason` suffixes are ignored);
   low-confidence findings are dropped unless `--all`.

### Design choices

These are deliberate and documented here so you can decide whether they fit your codebase.

- **R4 confidence follows taint provenance.** A write is `high` only when the value comes from a request
  primitive or from a parameter of a recognized SSR entry point (list under "Rules"). A write whose only taint is
  a bare parameter of some other function — a setter (`set(next) { payload = next }`), a subscription
  (`listeners.add(listener)`), a DI setter, a memo cache keyed by its argument — is `medium`, because the tool
  cannot tell whether that function runs during SSR. It is still shown by default; fail on it with
  `--fail-on medium`. Consequently R5 (untainted write) is `low`, R2 stays `low`, R6 stays `medium`.
- **Build outputs, static assets and minified code are skipped by default** (directory list under "Install &
  usage", `*.min.js`, lines over 2000 characters). Minified bundles produce hundreds of meaningless findings and
  static assets are never SSR modules. Override with `exclude` / `include`.
- **A class instantiated once by a top-level statement is module init** for its constructor body, consistent with
  the top-level-invoked-function rule: `class Boot { constructor() { axios.defaults.baseURL = … } } new Boot();`
  is R2 (`--all`), not R1. An exported class stays a request-path candidate.
- **`'use client'` files are skipped for noise, not safety** — see "Does not". Use `--include-client` for audits.
- **Suppression comments accept a reason** after ` -- `; everything after `--` is ignored.
- **`create` destructured from axios** (`import { create } from 'axios'`, `const { create } = require('axios')`)
  marks the resulting instance as axios, so its `.defaults` writes are R1/R2.
- **Destructuring assignments** to module-level bindings (`[last] = …`, `({ last } = …)`) are writes.
- **Input problems exit 2** (missing path, empty input set, unreadable file) with a one-line message and no stack
  trace; `--allow-empty` turns the first two into warnings. `run()` returns them as `diagnostics`.
- **R1 fires for `.defaults.headers…` on any imported binding**, even when the import is not provably axios: a
  module-level HTTP client with that shape is what the rule is for, and the path is distinctive enough.
- **Every rule is skipped inside React effect callbacks and inside module-init functions.** Cost: a handler
  registered from inside an init IIFE (`app.use(...)`) and a function that is both invoked at top level and per
  request are missed.
- **`*.stories.*` files are skipped like tests**: Storybook stories are never server-rendered by Next.js.
- **`--config` resolves relative to `--root`**, like the positional globs.
- **Explicitly named paths win**: a file or directory given on the command line is analyzed even if its name is on
  the exclude list or it looks minified.

### Choices that reduce false positives (and their cost)

- A non-exported function called at module top level (or a class instantiated there) counts as module init (R1
  becomes R2, R3/R4/R6 are not reported). Cost: if the same function is also called per request from elsewhere, it
  is missed.
- Any enclosing module-init function or effect callback makes the whole subtree non-request-path, including
  callbacks passed to `app.use(...)` inside an init IIFE. Cost: those handlers are missed.
- `.defaults.*` on a binding that is not provably axios is only R4 (when tainted) or R5, not R1 — except the
  distinctive `.defaults.headers…` path on an imported binding, which is R1.
- Mutating-call detection requires a literal collection initializer; a `Map` returned by a factory is missed.
- `globalThis.location`, `.document`, `.window`, `.navigator`, `.history`, `.localStorage`, `.sessionStorage` and
  a few more browser host objects are excluded from R6.
- A bare taint identifier (`req`, `params`, …) is tainted only when it is not a module-level binding, so a
  module-level `const context = createContext()` is not a taint source. A function-local `const params = …`
  **is** treated as tainted by name; rename it or suppress if it is not request data.
- Writes behind a browser-only guard (`typeof window !== 'undefined'`, `if (isServer()) return;`, …) are
  downgraded to `low`, not dropped, so `--all` still lists them for audits. Cost: a guard whose name is not in
  `guards` (or that lives in another function) is not seen, and a guard that is *wrong* (e.g. a `canUseDOM`
  that is computed once at module load in a test environment) is trusted.
- `mocks/`, `__mocks__/` and `*.mock.*` are skipped by default (MSW and Jest handlers keep module-level stores
  by design). Name the directory explicitly or use `include` to analyze them.

### Known false positives

- **Setters, subscriptions, DI setters and argument-keyed memo caches** (`set(next) { payload = next }`,
  `listeners.add(listener)`, `setHeaderProvider(p) { provider = p }`, `iconCache.set(icon, …)`,
  `inFlight.set(userId, promise)`): reported as R4 `medium`. Most are browser-only or process-wide by design; the
  tool cannot see who calls them. Review once, then suppress with a reason or move on — they do not fail CI at the
  default `--fail-on high`.
- **`useCallback` / event-handler bodies** in components without `'use client'`: same as above — a component prop
  written into module scope inside a callback is R4 `medium`, although the callback never runs during SSR.
- **Browser-only modules in the Pages Router** (no `'use client'` directive exists there): a module that stores
  scroll positions or popstate listeners at module scope is flagged as R4 even if only the browser calls it and
  the function itself has no guard (the guard sits in a helper it calls, or in the caller). Add a guard to the
  function, add it to `ignore`, or use a suppression comment.
- **Mock servers outside the default directories** (an MSW handler under `src/api/fake/`): technically a
  cross-request store; add the path to `ignore` or `exclude` if it is dev-only.
- **Conservative call propagation**: `cache.set(key, expensive(params.id))` is tainted through the argument even
  when `expensive()` returns something request-independent.
- **A function-local variable named like a request primitive** (`const params = new URLSearchParams(…)`) is
  tainted by name.

### Known false negatives

- Values flowing through **another module** (a singleton class, a `store` module with setters) unless the write
  site is syntactically visible in the analyzed file.
- **Closures** stored at module scope that capture request data.
- Module-level state mutated through `this` in class methods, or through aliases (`const c = cache; c.set(...)`
  is tracked only when `c` is itself module-level).
- Writes inside functions passed to a top-level `app.use(...)` / server framework registration (treated as init).
- An axios instance held in a module-level `let` that is assigned later (`let client; function init() { client = axios.create() }`).
- A function (or class constructor) that is invoked at module top level **and** per request from another module.
- `'use client'` files, unless `--include-client` is given.
- Anything under an excluded directory or in a minified file, unless re-included with `include`.

## Roadmap

- ESLint plugin (`eslint-plugin-ssr-leak`) exposing the same rules with the same IDs.
- Optional type-aware mode (project service) to recognize axios instances and collections by type.
- Cross-file taint for `store`-style modules with exported setters.
- Rule for closures / class instances stored at module scope.
- Exempt `useCallback` bodies and functions passed as JSX `on*` props from all rules (they never run during SSR).
- Follow browser-only guards across functions (`ensureBrowser()` helpers, guarded callers) — today a guard only
  covers its own function.
- Opt-in `.gitignore` awareness during discovery.
- SARIF output.

## Development & Release

```sh
pnpm install
pnpm build          # tsup: dist/index.{js,cjs,d.ts,d.cts}, dist/cli.js (ESM, shebang)
pnpm test           # builds first, then vitest (the CLI e2e test spawns dist/cli.js)
pnpm lint           # biome
pnpm typecheck      # tsc --noEmit
npm pack --dry-run  # verify the published file list
```

Release: bump `version` in `package.json` and `CHANGELOG.md`, commit, then

```sh
git tag vX.Y.Z
git push origin vX.Y.Z
```

The `Release` GitHub Action builds, tests, and runs `npm publish --provenance --access public` using the
`NPM_TOKEN` repository secret. **Publish only through this tag → GitHub Actions flow; never run `npm publish`
locally.** `publishConfig.registry` is pinned to `https://registry.npmjs.org/` so a local `~/.npmrc` pointing at
a private registry cannot redirect an accidental publish.

## License

MIT
