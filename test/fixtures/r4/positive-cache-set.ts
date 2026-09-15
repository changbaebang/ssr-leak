import type { NextApiRequest, NextApiResponse } from 'next';

const cache = new Map<string, unknown>();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const data = await fetch('https://api.acme.test/data').then((r) => r.json());
  cache.set(req.headers['x-user'] as string, data);
  res.status(200).json(data);
}
