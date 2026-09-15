const store: Record<string, string> = {};

export function outer(userId: string) {
  const save = () => {
    store.user = userId;
  };
  save();
}
