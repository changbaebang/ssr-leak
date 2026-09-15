export function handler(req: { id: string }) {
  const local: Record<string, string> = {};
  const items: string[] = [];
  local.id = req.id;
  items.push(req.id);
  return { local, items };
}
