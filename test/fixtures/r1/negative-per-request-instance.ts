import axios from 'axios';

export async function GET(req: Request) {
  const client = axios.create({ baseURL: 'https://api.acme.test' });
  client.defaults.headers.common['Authorization'] = req.headers.get('authorization') ?? '';
  client.defaults.timeout = 1000;
  Object.assign(client.defaults.headers, { 'x-trace': '1' });
  const res = await client.get('/profile');
  return Response.json(res.data);
}
