import * as axios from 'axios';

export function withUser(req: { headers: { cookie: string } }) {
  axios.default.defaults.headers.common.Cookie = req.headers.cookie;
}
