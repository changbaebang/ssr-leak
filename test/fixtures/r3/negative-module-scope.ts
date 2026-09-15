import axios from 'axios';

const http = axios.create();

http.interceptors.request.use((config) => {
  config.headers['x-app'] = 'acme';
  return config;
});

axios.interceptors.response.use((res) => res);

export { http };
