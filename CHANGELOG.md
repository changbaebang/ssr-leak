# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-09-17

### Added

- Positive-evidence downgrades: a request-path write is reported at `low` (with the reason in the message) when
  it is a **dedupe set** (`add` guarded by `has` in the same function), an **argument-keyed cache** (`map.set(k, v)`
  with only `k` weakly tainted), a **request-lifetime entry** (the same function also `delete`s it), or is
  **preceded by an unconditional browser-only dereference** (`window.location`, `document`, `localStorage`, …,
  which throws on the server). `navigator` / `self` are not browser-only. Exported: `EVIDENCE_NOTES`.
- New SSR entry points (parameters are request primitives, R4 `high`): Server Actions (`'use server'` at file
  level → every exported function; as a function's first statement → that function, at any depth), Next 16
  `proxy` (exported `proxy`, or the default export of `middleware.*` / `proxy.*`), exported `generateMetadata` /
  `generateViewport`, `app/**/default.*` default exports, and Remix / React Router `loader` / `action` whose first
  parameter destructures `request`, `params` or `context`. Exported: `isServerActionFile`.
- `parse-error` diagnostic: a file with syntax errors is analyzed as far as it parsed and reported in
  `report.diagnostics` (`kind: 'parse-error'`, path, first message and position). The CLI prints it as a warning
  without changing the exit code; when every analyzed file has syntax errors an `empty-input` diagnostic is added
  (exit 2 unless `--allow-empty`). Exported: `analyzeSourceDetailed`, `ParseError`, `SourceAnalysis`.
- `--env`: prints versions (ssr-leak, Node, TypeScript), root, config file, default pattern, excluded
  directories, guard names, taint sources and the rule list for bug reports; exit 0.
- README "Requirements & compatibility": framework / HTTP client / syntax / runtime support matrix, what is and
  is not detected, and every exit-2 condition and diagnostic with its exact message prefix.

### Changed

- `params`, `searchParams` and `event` are now *weak* taint names when they are a parameter of a function that is
  not an SSR entry point and the accessed member is not request-like (`searchParams.get('tab')` → `medium`;
  `params.cookies`, `req.*`, entry-point parameters → still `high`). Exported: `WEAK_TAINT_IDENTIFIERS`,
  `REQUEST_MEMBERS`.
- On a large Next.js monorepo this took the default output from 6 high / 17 medium to 4 high / 10 medium with
  every true positive kept.

### Fixed

- `import * as axios from 'axios'` followed by `axios.default.defaults.headers… = …` inside a function is now R1
  (it was R4/R5 because the `.default` hop hid the `.defaults` path).

## [0.1.0] - 2026-09-16

Initial release.

### Added

- CLI `ssr-leak [globs...] [--root] [--all] [--include-client] [--json] [--config] [--fail-on] [--allow-empty]`
  with exit codes 0 (clean), 1 (findings at or above `--fail-on`), 2 (usage/config error, missing path,
  empty input set unless `--allow-empty`, unreadable file).
- Rules:
  - R1 `axios-defaults-in-function` (high)
  - R2 `axios-defaults-at-module-scope` (low, `--all` only)
  - R3 `axios-interceptor-in-request-path` (high)
  - R4 `module-state-write-tainted` (high when the taint is a request primitive or a parameter of a recognized
    SSR entry point; medium when the only taint source is a bare parameter of another function)
  - R5 `module-state-write-untainted` (low, `--all` only)
  - R6 `global-object-write` (medium)
- Syntactic taint tracking with provenance: `headers()`, `cookies()`, `draftMode()`, `getServerSession()`,
  property reads on `req`/`request`/`ctx`/`context`/`params`/`searchParams`/`event`, and parameters of
  `getServerSideProps`/`getStaticProps`/`getInitialProps` (also when wrapped), exported route handlers
  (`GET`/`POST`/`PUT`/`PATCH`/`DELETE`/`HEAD`/`OPTIONS`), exported `middleware`, `pages/api/**` default exports
  and `app/**/page|layout|template.*` default exports are request primitives; bare parameters of other
  functions are weak sources. Propagated through locals, member access, calls, template literals, object/array
  literals and destructuring.
- Module init detection: IIFEs, non-exported functions invoked by a top-level statement, and constructors of
  non-exported classes instantiated by a top-level statement (`new Boot()`).
- Axios instance recognition: default import, `require('axios')`, `<axios>.create()`, and `create()` when
  `create` is destructured from `axios` (`import { create }` / `const { create } = require('axios')`).
- Destructuring assignments to module-level bindings (`[last] = …`, `({ last } = …)`) are detected as writes.
- File discovery skips `node_modules`, `dist`, `build`, `out`, `.next`, `.vercel`, `.output`, `.turbo`,
  `.cache`, `.git`, `coverage`, `storybook-static`, `public`, plus minified files (`*.min.js` or any line longer
  than 2000 characters); overridable with the `exclude` / `include` config keys. Explicitly named paths are always
  analyzed.
- `'use client'` files skipped by default (documented as a noise trade-off, not a safety guarantee); test, spec,
  story and declaration files skipped during discovery.
- Suppression via `// ssr-leak-ignore-next-line [rules] [-- reason]` and `/* ssr-leak-disable */`.
- Config file `ssr-leak.config.{json,mjs,js,cjs}` (resolved relative to `--root`) with `ignore`, `exclude`,
  `include` and `taintSources`.
- `Report.diagnostics` (`missing-path`, `empty-input`, `unreadable-file`); `run()` never throws for input
  problems, the CLI prints them as one-line errors and exits 2.
- Programmatic API: `analyzeSource`, `analyzeFile`, `run`, `shouldFail`, `formatHuman`, `formatJson`,
  `collectFilesDetailed`, `parseIgnoreRules`, `isMinifiedSource`, `RULES`, `DEFAULT_EXCLUDED_DIRS`.
- Dual ESM/CJS library build with per-condition type declarations (`import` → `index.d.ts`,
  `require` → `index.d.cts`), ESM CLI with shebang.
- `publishConfig.registry` pinned to `https://registry.npmjs.org/`; publishing happens only through the
  tag-triggered Release workflow.
- Browser-only guard recognition: writes that can only run in a browser are reported at `low` (visible with
  `--all`, with a note in the message) instead of their normal confidence. Recognized within the same function:
  statements after `if (isServer()) return;` / `throw` in the same block, the then-branch of
  `if (typeof window !== 'undefined')`, the else-branch of `if (typeof window === 'undefined')`, the right side of
  `isClient() && …` / `isServer() || …`, and the matching arm of a ternary. Conditions use three-valued logic
  (`isServer() || flag` is a guard, `isServer() && flag` is not). Atoms: `typeof window|document` (also via
  `globalThis.`) vs `'undefined'` / `'object'` — `navigator` and `self` are deliberately not guards because
  Node 21+ and Bun define `navigator`, and Deno and edge runtimes may also define `self` — `!x`, and calls or identifiers named `isServer`,
  `isSSR`, `isServerSide` (server) or `isClient`, `isBrowser`, `isClientSide`, `canUseDOM` (client), matched by
  the last name of the callee.
- Config key `guards: { server?: string[]; client?: string[] }` (and `AnalyzeOptions.guards`) to add guard names.
- Programmatic exports `classifyCondition`, `buildGuardNames`, `DEFAULT_SERVER_GUARDS`, `DEFAULT_CLIENT_GUARDS`.

### Changed (pre-release review, round 1)

- R4 findings whose only taint source is a bare function parameter are `medium` instead of `high`, with the
  message "Possible per-request write (value comes from a function argument)". R5 is `low` instead of `medium`.
- Build outputs (`build`, `storybook-static`, `.vercel`, `.output`, `.turbo`, `.cache`, `.git`), `public/` and
  minified files are no longer scanned by default.
- An empty input set or a positional path that does not exist exits 2 instead of 0 (`--allow-empty` restores
  exit 0).
- `bin` uses `dist/cli.js` without a leading `./` so npm no longer logs a normalizer warning on pack/publish.
- Discovery skips `mocks/` and `__mocks__/` directories and `*.mock.*` files by default (MSW and Jest handlers
  keep module-level stores by design). Name them explicitly or use `include` to analyze them.
- `include` now overrides the test/story/mock filename skip as well as excluded directories and minified names;
  previously `*.test.*` / `*.stories.*` could only be analyzed by naming the file explicitly.

### Fixed (pre-release review, round 1)

- CommonJS TypeScript consumers under `moduleResolution: node16` no longer hit TS1479: the `require` export
  condition points at `dist/index.d.cts`.
- `// ssr-leak-ignore-next-line R4 -- reason` now suppresses R4; previously the reason disabled the suppression.
- A class instantiated once at module top level counts as module init for its constructor body (was R1 high).
- `const { create } = require('axios')` / `import { create } from 'axios'` instances are recognized as axios
  (were R4/R5 instead of R1/R2).
- `[x] = …` / `({ x } = …)` assignments to module-level bindings are detected.
- An unreadable file is reported as a diagnostic with a one-line message and exit 2 instead of a stack trace;
  `analyzeFile`'s JSDoc matches its behavior; the unused `ModuleBinding.exported` field was removed.
- README documents the full excluded-directory list, `--config` resolution relative to `--root`, and that
  `'use client'` components are still server-rendered.

[0.1.0]: https://github.com/changbaebang/ssr-leak/releases/tag/v0.1.0
