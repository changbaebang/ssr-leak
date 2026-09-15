import type { NextRequest } from 'next/server';

let last = '';

const withAuth = <T>(fn: T): T => fn;

export const getServerSideProps = withAuth(async (c: { query: { id: string } }) => {
  last = c.query.id;
  return { props: {} };
});

export async function GET(r: Request) {
  last = r.url;
  return new Response(last);
}

export function middleware(m: NextRequest) {
  last = m.url;
}

export function helper(x: string) {
  last = x;
}
