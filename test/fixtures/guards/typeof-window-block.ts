const store = new Map<number, number>();

export function seed(itemNo: number, count: number) {
  if (typeof globalThis.window !== 'undefined') {
    store.set(itemNo, count);
  }
}

export function seedReversed(itemNo: number, count: number) {
  if ('undefined' !== typeof window) {
    store.set(itemNo, count);
  }
}

export function seedDocument(itemNo: number, count: number) {
  if (typeof document === 'object') store.set(itemNo, count);
}
