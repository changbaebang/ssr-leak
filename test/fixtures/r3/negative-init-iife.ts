import axios from 'axios';

const http = axios.create();

(() => {
  http.interceptors.request.use((config) => config);
})();

function setup() {
  http.interceptors.response.use((res) => res);
}
setup();

export { http };
