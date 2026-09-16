import { isServer } from './runtime';

let last: string | null = null;

export function save(value: string) {
  last = value; // runs everywhere: still reported
  if (isServer()) return;
  last = `${value}!`; // browser-only
}
