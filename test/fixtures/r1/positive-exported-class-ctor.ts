import axios from 'axios';

export class Service {
  constructor(baseURL: string) {
    axios.defaults.baseURL = baseURL;
  }
}
