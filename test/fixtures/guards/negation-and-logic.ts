import { isServer } from './runtime';

let a: string | null = null;
let b: string | null = null;
let c: string | null = null;
let d: string | null = null;

export function save(value: string, flag: boolean) {
  if (!isServer()) {
    a = value; // browser-only
  }
  if (isServer() || flag) return; // returns on the server no matter what
  b = value; // browser-only
}

export function saveWeak(value: string, flag: boolean) {
  if (isServer() && flag) return; // does not always return on the server
  c = value; // still reported
  if (flag && typeof window !== 'undefined') {
    d = value; // browser-only
  }
}
