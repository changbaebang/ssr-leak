let pathname = '';
let after = '';
let guardedByTypeof = '';
let optional = '';
let inAnd = '';
let inTry = '';
let viaGlobalThis = '';
let inIfCondition = '';

export function before(value: string) {
  const current = window.location.pathname;
  pathname = value + current; // window.location was dereferenced first: low
}

export function afterWrite(value: string) {
  after = value; // written before any browser access: medium
  document.title = value;
}

export function withTypeof(value: string) {
  if (typeof window === 'object') {
    // handled by the guard logic, not by deref evidence
  }
  guardedByTypeof = value; // medium
}

export function withOptional(value: string) {
  const x = (globalThis as { window?: Window }).window?.location;
  optional = value + String(x); // optional chain does not throw: medium
}

export function withAnd(value: string, flag: boolean) {
  const x = flag && window.innerWidth;
  inAnd = value + String(x); // right side of && is conditional: medium
}

export function withTry(value: string) {
  try {
    void window.innerWidth;
  } catch {}
  inTry = value; // inside try: medium
}

export function withGlobalThis(value: string) {
  const p = globalThis.location.pathname;
  viaGlobalThis = value + p; // globalThis.location.pathname throws on the server: low
}

export function withIfCondition(value: string) {
  if (localStorage.getItem('k') !== value) {
    inIfCondition = value; // the if condition dereferenced localStorage first: low
  }
}
