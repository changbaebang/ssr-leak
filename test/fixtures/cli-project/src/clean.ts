import axios from 'axios';

const http = axios.create({ baseURL: 'https://api.acme.test' });

export function fetchProfile(token: string) {
  return http.get('/profile', { headers: { Authorization: token } });
}
