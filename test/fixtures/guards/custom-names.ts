import { runtime } from './runtime';

let last: string | null = null;
let viaMember: string | null = null;

export function save(value: string) {
  if (isNodeRuntime()) return;
  last = value;
}

export function saveMember(value: string) {
  if (runtime.isServer()) return; // member call: last name matches the built-in
  viaMember = value;
}

declare function isNodeRuntime(): boolean;
