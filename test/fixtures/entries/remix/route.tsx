let lastId = '';

// Remix / React Router: `loader({ request, params })` and `action({ request })` run per request.
export async function loader({ params }: { params: { id: string } }) {
  lastId = params.id;
  return null;
}

export const action = async ({ request }: { request: Request }) => {
  lastId = request.url;
};

// An exported `loader` that is not a route data function (no `request`/`params`/`context`).
export function loaderHelper(x: string) {
  lastId = x;
}
export const loaderUnrelated = (opts: { id: string }) => {
  lastId = opts.id;
};
