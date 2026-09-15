import axios from 'axios';
import type { GetServerSidePropsContext } from 'next';

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
  const token = ctx.req.cookies.token;
  axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  const { data } = await axios.get('https://api.acme.test/me');
  return { props: { data } };
}
