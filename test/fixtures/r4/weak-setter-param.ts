let payload = '';
const listeners = new Set<() => void>();
const memo = new Map<string, Promise<unknown>>();

export function set(next: string) {
  payload = next;
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
}

export function load(userId: string) {
  memo.set(userId, fetch(`/api/${userId}`));
}
