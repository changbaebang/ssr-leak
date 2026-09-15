import axios from 'axios';

function configure() {
  axios.defaults.baseURL = 'https://api.acme.test';
}

configure();

export const ready = true;
