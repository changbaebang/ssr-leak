import { isServer } from './runtime';

let last: string | null = null;

export function save(value: string) {
  if (isServer()) return;
  last = value;
}

export function saveWithBlock(value: string) {
  if (isServer()) {
    console.warn('server');
    return;
  }
  last = value;
}

export function read() {
  return last;
}
