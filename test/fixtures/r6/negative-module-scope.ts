globalThis.acmeVersion = '1.0.0';
process.env.TZ = 'UTC';

export function version() {
  return globalThis.acmeVersion;
}
