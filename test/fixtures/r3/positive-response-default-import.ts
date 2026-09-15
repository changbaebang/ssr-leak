import axios from 'axios';

export function attachLogger(requestId: string) {
  axios.interceptors.response.use((res) => {
    console.log(requestId, res.status);
    return res;
  });
}
