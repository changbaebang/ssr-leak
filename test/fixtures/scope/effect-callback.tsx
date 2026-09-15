import axios from 'axios';
import { useEffect, useLayoutEffect } from 'react';

let lastUser = '';
const listeners = new Set<() => void>();

export function useTracker(user: string, listener: () => void) {
  useEffect(() => {
    lastUser = user;
    listeners.add(listener);
    const id = setInterval(() => {
      lastUser = user;
    }, 1000);
    return () => clearInterval(id);
  }, [user, listener]);

  useLayoutEffect(() => {
    globalThis.acme = user;
    axios.defaults.headers.common.Authorization = user;
  }, [user]);
}
