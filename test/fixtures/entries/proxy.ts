import type { NextRequest } from 'next/server';

let lastPath = '';

// Next 16: `middleware` was renamed to `proxy`; the file exports it by name…
export function proxy(request: NextRequest) {
  lastPath = request.nextUrl.pathname;
}
