import { apiClient } from './client';

export async function loader(token: string) {
  apiClient.defaults.headers.common.Authorization = token;
  return apiClient.get('/me');
}
