export function withFakeGlobal() {
  const globalThis = { locale: '' };
  globalThis.locale = 'en';
  return globalThis;
}
