import { headers } from 'next/headers';

const cfg: { token?: string } = {};

export async function Page() {
  const h = headers();
  const t = h.get('x-token');
  cfg.token = t ?? undefined;
  return null;
}
