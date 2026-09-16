import type { GetServerSidePropsContext } from 'next';

let current: string | undefined;
const cache = new Map<string, string>();

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
  if (typeof window === 'undefined') {
    current = ctx.req.headers.cookie; // server branch: real leak, stays high
  } else {
    cache.set('k', ctx.req.headers.cookie ?? ''); // browser branch: low
  }
  return { props: {} };
}
