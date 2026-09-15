/* ssr-leak-disable */
let currentUser = '';

export function set(params: { id: string }) {
  currentUser = params.id;
}
