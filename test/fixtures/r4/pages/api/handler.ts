let last = '';

export default function handler(a: { body: string }, b: { end(): void }) {
  last = a.body;
  b.end();
}
