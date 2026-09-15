import axios from 'axios';
import { useEffect } from 'react';

const http = axios.create();

export function useAuthHeader(token: string) {
  useEffect(() => {
    const id = http.interceptors.request.use((config) => {
      config.headers.Authorization = token;
      return config;
    });
    return () => {
      http.interceptors.request.eject(id);
    };
  }, [token]);
}
