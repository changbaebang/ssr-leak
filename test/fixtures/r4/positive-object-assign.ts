import { cookies } from 'next/headers';

const session = { locale: 'en', user: '' };

export async function load() {
  const jar = cookies();
  Object.assign(session, { user: jar.get('user')?.value });
}
