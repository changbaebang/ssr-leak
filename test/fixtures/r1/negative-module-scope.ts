import axios from 'axios';

axios.defaults.baseURL = 'https://api.acme.test';
axios.defaults.headers.common['X-App'] = 'acme-web';

const instance = axios.create();
instance.defaults.timeout = 5000;

export function fetchProfile() {
  return instance.get('/profile');
}
