import axios from 'axios';

const http = axios.create();

export async function withTemporaryHeader(value: string) {
  const id = http.interceptors.request.use((config) => {
    config.headers['x-temp'] = value;
    return config;
  });
  try {
    return await http.get('/x');
  } finally {
    http.interceptors.request.eject(id);
  }
}
