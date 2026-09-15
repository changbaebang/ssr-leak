'use client';

let lastUser = '';

export function Widget({ user }: { user: string }) {
  lastUser = user;
  return <div>{lastUser}</div>;
}
