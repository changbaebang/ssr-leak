let last = '';

export function f(req: { url: string }) {
  last = req.url;
