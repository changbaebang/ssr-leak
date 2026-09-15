const cache = new Map<string, number>();

export function memoized() {
  const hit = cache.get('constant');
  if (hit !== undefined) return hit;
  const value = Math.random();
  cache.set('constant', value);
  return value;
}
