let currentUser = '';

export async function load() {
  const session = await auth();
  currentUser = session.user;
}

declare function auth(): Promise<{ user: string }>;
