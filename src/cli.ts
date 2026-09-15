import { parseArgs } from 'node:util';
import pc from 'picocolors';
import { DEFAULT_EXCLUDED_DIRS } from './files.js';
import { formatHuman, formatJson } from './format.js';
import { run, shouldFail } from './run.js';
import { type Confidence, ConfigError } from './types.js';
import { VERSION } from './version.js';

const HELP = `ssr-leak ${VERSION}
Catch module-scope state that leaks between SSR requests in Next.js.

Usage:
  ssr-leak [globs...] [options]

Arguments:
  globs                 Globs, directories or files to analyze (relative to --root).
                        Default: **/*.{ts,tsx,js,jsx,mjs,cjs}
                        Always skipped: directories ${DEFAULT_EXCLUDED_DIRS.join(', ')};
                        test/story/declaration files; minified files (*.min.js or a line > 2000 chars).
                        Override with "exclude" / "include" in the config file.

Options:
  --root <dir>          Directory that globs and reported paths are relative to (default: cwd)
  --all                 Also report low-confidence findings (R2 axios-defaults-at-module-scope,
                        R5 module-state-write-untainted)
  --include-client      Analyze files that start with a 'use client' directive
                        (recommended for audits: client components are still server-rendered)
  --json                Machine-readable output
  --config <path>       Config file, relative to --root
                        (default: ssr-leak.config.{json,mjs,js,cjs} in --root)
  --fail-on <level>     Exit 1 when a finding is at or above this confidence:
                        high (default) | medium | low | none
  --allow-empty         Exit 0 instead of 2 when no file was analyzed or a path does not exist
  -h, --help            Show this help
  -v, --version         Show the version

Exit codes:
  0  no finding at or above --fail-on
  1  at least one finding at or above --fail-on
  2  usage or config error, a path that does not exist, an empty input set
     (unless --allow-empty), or an unreadable file

Suppression:
  // ssr-leak-ignore-next-line [R1, R4, ...] [-- reason]   suppress the next line (optionally only some rules)
  /* ssr-leak-disable */                                   at the top of a file: skip the whole file
`;

const FAIL_LEVELS = new Set(['high', 'medium', 'low', 'none']);

function usageError(message: string): never {
  process.stderr.write(`${pc.red('error')}: ${message}\n\nRun with --help for usage.\n`);
  process.exit(2);
}

export async function main(argv: string[]): Promise<number> {
  let parsed: ReturnType<typeof parseArgs<typeof spec>>;
  const spec = {
    options: {
      root: { type: 'string' },
      all: { type: 'boolean', default: false },
      'include-client': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      config: { type: 'string' },
      'fail-on': { type: 'string', default: 'high' },
      'allow-empty': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
    allowPositionals: true,
    args: argv,
  } as const;
  try {
    parsed = parseArgs(spec);
  } catch (err) {
    usageError((err as Error).message);
  }
  const { values, positionals } = parsed;

  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (values.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  const failOn = values['fail-on'] ?? 'high';
  if (!FAIL_LEVELS.has(failOn)) {
    usageError(`--fail-on must be one of high, medium, low, none (got "${failOn}")`);
  }

  try {
    const report = await run({
      ...(values.root !== undefined ? { root: values.root } : {}),
      ...(values.config !== undefined ? { config: values.config } : {}),
      patterns: positionals,
      all: values.all,
      includeClient: values['include-client'],
    });
    process.stdout.write(`${values.json ? formatJson(report) : formatHuman(report)}\n`);

    let inputError = false;
    for (const d of report.diagnostics) {
      const fatal = d.kind === 'unreadable-file' || !values['allow-empty'];
      inputError ||= fatal;
      process.stderr.write(`${fatal ? pc.red('error') : pc.yellow('warning')}: ${d.message}\n`);
    }
    if (inputError) return 2;
    return shouldFail(report.findings, failOn as Confidence | 'none') ? 1 : 0;
  } catch (err) {
    if (err instanceof ConfigError) usageError(err.message);
    throw err;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(
      `${pc.red('error')}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    process.exitCode = 2;
  },
);
