const reported = new Set<string>();
const unguarded = new Set<string>();

export function reportOnce(key: string) {
  if (reported.has(key)) return;
  reported.add(key); // dedupe set: low
}

export function collect(key: string) {
  unguarded.add(key); // no .has() check: medium
}
