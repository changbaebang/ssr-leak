import axios from 'axios';

const api = axios.create();

export const withAuth = (token: string) => {
  Object.assign(api.defaults.headers, { Authorization: token });
  return api;
};
