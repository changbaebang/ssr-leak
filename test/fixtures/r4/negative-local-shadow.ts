let currentUser: string | null = null;
const cache = new Map<string, string>();

export function handle(req: { id: string }) {
  let currentUser: string | null = null;
  const cache = new Map<string, string>();
  currentUser = req.id;
  cache.set(req.id, 'x');
  return currentUser;
}

export function readModuleState() {
  return currentUser ?? cache.size;
}
