let settings = {};
export function update(request: { body: unknown }) {
  settings = request.body as object;
}
