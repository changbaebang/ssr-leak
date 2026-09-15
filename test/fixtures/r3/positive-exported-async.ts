import axios from 'axios';

const http = axios.create();

export async function fetchWithUser(userId: string) {
  http.interceptors.request.use((config) => {
    config.headers['x-user'] = userId;
    return config;
  });
  return http.get('/orders');
}
