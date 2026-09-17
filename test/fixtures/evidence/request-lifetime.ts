const inFlight = new Map<number, Promise<void>>();
const forever = new Map<number, Promise<void>>();

export function dedupe(userId: number, run: () => Promise<void>) {
  const existing = inFlight.get(userId);
  if (existing) return existing;
  const p = run().finally(() => inFlight.delete(userId));
  inFlight.set(userId, p); // removed in the same function: low
  return p;
}

export function leak(userId: number, run: () => Promise<void>) {
  const p = run();
  forever.set(userId, p); // never removed here, value derives from an argument call: medium
  return p;
}
