let a: string | null = null;
let b: string | null = null;
let c: string | null = null;
let d: string | null = null;
let e: string | null = null;

// `req` / `ctx` are strong names: any read on them is request data.
export function fromReq(req: { headers: { cookie?: string } }) {
  a = req.headers.cookie ?? null;
}

// `params` / `searchParams` / `event` are weak names on a plain function's parameter…
export function fromParamsPlain(params: { id: string }) {
  b = params.id; // medium
}

// …unless the member looks like request data…
export function fromParamsCookies(params: { cookies: string }) {
  c = params.cookies; // high
}

// …or the identifier is not a parameter at all (a global-ish `event`, like `window.event`).
export function fromUnresolved() {
  d = (event as unknown as { id: string }).id; // high
}

// A weak name on an SSR entry point is still a request primitive.
export async function getServerSideProps(params: { id: string }) {
  e = params.id; // high
  return { props: {} };
}

