let last = '';
let other = '';

export function set(req: { id: string; other: string }) {
  [last] = [req.id];
  ({ other } = req);
}
