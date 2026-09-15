export function goHome() {
  globalThis.location.href = '/';
  globalThis.document.title = 'Home';
  globalThis.localStorage.setItem('k', 'v');
}
