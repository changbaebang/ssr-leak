import { router } from './router';

const client = createClient();

export function go(req: { path: string }) {
  router.push(req.path);
  client.set('x', req.path);
}

function createClient() {
  return { set: (_k: string, _v: string) => undefined };
}
