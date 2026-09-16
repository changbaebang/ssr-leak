import { isServer } from './runtime';

let inner: string | null = null;
let outer: string | null = null;

export function save(value: string, flag: boolean) {
  if (flag) {
    if (isServer()) return;
    inner = value; // browser-only: guard is in this block
  }
  outer = value; // the guard does not reach here
}
