let lastId = '';

// Parallel-route fallback: a server component that receives `params` like a page.
export default function Default({ params }: { params: { id: string } }) {
  lastId = params.id;
  return null;
}
