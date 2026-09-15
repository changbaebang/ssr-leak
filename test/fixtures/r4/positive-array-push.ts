const seen: string[] = [];

export function track(request: Request) {
  const id = request.headers.get('x-request-id');
  seen.push(`${id}`);
}
