const byUser: Record<string, number> = {};

export function bump(ctx: { userId: string }) {
  byUser[ctx.userId] = Date.now();
}
