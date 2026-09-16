export const isServer = () => typeof window === 'undefined';
export const isClient = () => !isServer();
export const runtime = { isServer };
