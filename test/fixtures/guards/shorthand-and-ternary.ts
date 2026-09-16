import { isClient, isServer } from './runtime';

let last: string | null = null;
let other: string | null = null;
let third: string | null = null;

export function save(value: string) {
  isClient() && (last = value);
  isServer() || (other = value);
  typeof window !== 'undefined' ? (third = value) : void 0;
}
