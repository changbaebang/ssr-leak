let lastUser = '';

export function Story({ user }: { user: string }) {
  lastUser = user;
  globalThis.fetch = async () => new Response(lastUser);
  return null;
}
