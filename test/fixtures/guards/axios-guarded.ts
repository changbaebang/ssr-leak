import axios from 'axios';
import { isServer } from './runtime';

export function attach(token: string) {
  if (isServer()) return;
  axios.defaults.headers.common.Authorization = `Bearer ${token}`;
}
