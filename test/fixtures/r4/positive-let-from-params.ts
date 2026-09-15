let currentUser: string | null = null;

export function setUser(params: { id: string }) {
  currentUser = params.id;
}

export function getUser() {
  return currentUser;
}
