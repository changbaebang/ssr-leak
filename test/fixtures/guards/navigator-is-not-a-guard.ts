let moduleState: string | undefined;
let viaSelf: string | undefined;

// Node 21+, Bun, Deno and the edge runtimes define `navigator` and `self`, so neither check proves
// we are in a browser. These writes run during SSR and must keep their normal confidence.
export function handler(req: { headers: { cookie?: string } }) {
  if (typeof navigator === 'object') {
    moduleState = req.headers.cookie;
  }
  if (typeof self !== 'undefined') {
    viaSelf = req.headers.cookie;
  }
}
