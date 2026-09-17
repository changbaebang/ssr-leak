import type { NextRequest } from 'next/server';

let lastPath = '';

// …or as the default export (both `middleware.*` and `proxy.*` accept a default export).
export default function handler(r: NextRequest) {
  lastPath = r.nextUrl.pathname;
}
