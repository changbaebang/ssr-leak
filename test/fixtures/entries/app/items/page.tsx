let lastId = '';

// generateMetadata runs per request on dynamic routes and receives the same params as the page.
export async function generateMetadata({ params }: { params: { id: string } }) {
  lastId = params.id;
  return { title: lastId };
}

// generateStaticParams runs at build time: its parameter is not request data.
export async function generateStaticParams() {
  return [{ id: '1' }];
}

export default function Page({ params }: { params: { id: string } }) {
  lastId = params.id;
  return null;
}
