const stores = new Map<number, { count: number }>();
const byId = new Map<number, string>();
const byReq = new Map<string, string>();

export function getStore(id: number) {
  if (!stores.has(id)) stores.set(id, { count: 0 }); // key from argument, value not request data: low
  return stores.get(id);
}

export function remember(id: number, value: string) {
  byId.set(id, value); // value is an argument too: medium
}

export function remember2(req: { headers: { get(n: string): string } }) {
  byReq.set(req.headers.get('x-user'), 'seen'); // key is a request primitive: high
}
