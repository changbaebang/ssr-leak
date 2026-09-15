export function setLocale(locale: string) {
  globalThis.locale = locale;
}

export function setEnv(req: { env: string }) {
  process.env.CURRENT_USER = req.env;
  (global as Record<string, unknown>).currentRequest = req;
}
