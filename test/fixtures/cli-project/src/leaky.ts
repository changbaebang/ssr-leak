import axios from 'axios';

const cache = new Map<string, string>();
let lastUser = '';

export async function getServerSideProps(ctx: { req: { headers: { cookie: string } } }) {
  axios.defaults.headers.common.Cookie = ctx.req.headers.cookie;
  cache.set('constant', 'value');
  lastUser = ctx.req.headers.cookie;
  return { props: {} };
}
