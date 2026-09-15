import { create } from 'axios';

const api = create({ baseURL: 'https://api.acme.test' });

export function withToken(req: { headers: { authorization: string } }) {
  api.defaults.headers.common.Authorization = req.headers.authorization;
}

export function slow() {
  api.defaults.timeout = 5000;
}
