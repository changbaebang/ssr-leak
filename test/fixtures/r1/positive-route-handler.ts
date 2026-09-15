import axios from 'axios';

const instance = axios.create({ baseURL: 'https://api.acme.test' });

export async function GET(req: Request) {
  instance.defaults.headers.Cookie = req.headers.get('cookie') ?? '';
  const res = await instance.get('/profile');
  return Response.json(res.data);
}
