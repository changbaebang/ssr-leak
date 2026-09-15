let currentUser = '';
let other = '';

export function set(params: { id: string }) {
  // ssr-leak-ignore-next-line
  currentUser = params.id;
  // ssr-leak-ignore-next-line R6
  other = params.id;
}
