import axios from 'axios';

class Boot {
  constructor() {
    axios.defaults.baseURL = 'https://api.acme.test';
  }
}

new Boot();

export const ready = true;
