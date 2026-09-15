import type { Confidence, RuleId } from './types.js';

export interface MessageVars {
  /** Text of the mutated expression, e.g. `axios.defaults.headers.common['Authorization']`. */
  target: string;
  /** Description of the request-scoped taint source, when known. */
  source?: string;
  /**
   * R4 only: the taint comes solely from a bare parameter of a function that is not a
   * recognized SSR entry point, so the write is only *possibly* per request.
   */
  weak?: boolean;
  /** Interceptor kind for R3 (`request` | `response`). */
  kind?: string;
}

export interface RuleMeta {
  id: RuleId;
  name: string;
  /** Default confidence. R4 is downgraded to `medium` when its only taint source is a bare parameter. */
  confidence: Confidence;
  /** Low-confidence rules are only reported when `all` is set. */
  onlyWithAll: boolean;
  message: (vars: MessageVars) => string;
  fixHint: string;
}

export const RULES: Readonly<Record<RuleId, RuleMeta>> = {
  R1: {
    id: 'R1',
    name: 'axios-defaults-in-function',
    confidence: 'high',
    onlyWithAll: false,
    message: ({ target }) =>
      `\`${target}\` is assigned inside a function. The axios instance lives at module scope and is shared by every SSR request, so one request's value is served to the next.`,
    fixHint:
      'Create a per-request instance (axios.create({ headers })) or pass headers per call (axios.get(url, { headers })).',
  },
  R2: {
    id: 'R2',
    name: 'axios-defaults-at-module-scope',
    confidence: 'low',
    onlyWithAll: true,
    message: ({ target }) =>
      `\`${target}\` is assigned at module scope. This runs once per process, not per request, but it is global mutable config shared by all requests.`,
    fixHint:
      'Prefer passing static config to axios.create({ ... }) once; keep anything request-specific out of defaults.',
  },
  R3: {
    id: 'R3',
    name: 'axios-interceptor-in-request-path',
    confidence: 'high',
    onlyWithAll: false,
    message: ({ target, kind }) =>
      `\`${target}\` registers a ${kind ?? 'request'} interceptor inside a function that may run per request. Interceptors accumulate on the shared instance and the closure keeps this request's data alive for later requests.`,
    fixHint:
      'Register the interceptor once at module scope, or eject it in the same function (const id = instance.interceptors.request.use(...); ... instance.interceptors.request.eject(id)).',
  },
  R4: {
    id: 'R4',
    name: 'module-state-write-tainted',
    confidence: 'high',
    onlyWithAll: false,
    message: ({ target, source, weak }) =>
      weak
        ? `Possible per-request write (value comes from a function argument): ${source ?? 'a parameter'} is written into module-level state \`${target}\`. If this function runs during SSR, the module is shared across requests and a different user's request can read the value.`
        : `Request-scoped data${source ? ` (from ${source})` : ''} is written into module-level state \`${target}\`. The module is shared across SSR requests, so a different user's request can read it.`,
    fixHint:
      'Keep request data in request scope: return it, pass it as an argument, or use a per-request container (React cache(), AsyncLocalStorage, or a per-request object).',
  },
  R5: {
    id: 'R5',
    name: 'module-state-write-untainted',
    confidence: 'low',
    onlyWithAll: true,
    message: ({ target }) =>
      `Module-level state \`${target}\` is mutated inside a function with a value that does not appear to come from the request. Fine for constant caches; verify nothing request-specific ends up here.`,
    fixHint:
      'If this is a memo cache keyed by constants, ignore it (// ssr-leak-ignore-next-line). Otherwise move the state into request scope.',
  },
  R6: {
    id: 'R6',
    name: 'global-object-write',
    confidence: 'medium',
    onlyWithAll: false,
    message: ({ target }) =>
      `\`${target}\` is assigned inside a function. The global object is shared by every request in the server process.`,
    fixHint:
      'Avoid mutating globals per request. For a process-wide singleton, initialize it once at module scope behind a guard and never store request data in it.',
  },
};

export const RULE_LIST: readonly RuleMeta[] = Object.values(RULES);

export const CONFIDENCE_RANK: Readonly<Record<Confidence, number>> = { high: 3, medium: 2, low: 1 };
