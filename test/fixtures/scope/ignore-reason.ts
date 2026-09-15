let last = '';

export function set(req: { id: string }) {
  // ssr-leak-ignore-next-line R4 -- browser only
  last = req.id;
  // ssr-leak-ignore-next-line -- every rule, with a reason
  last = req.id;
  /* ssr-leak-ignore-next-line R6 -- wrong rule, finding stays */
  last = req.id;
}
