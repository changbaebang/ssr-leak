let last = '';

export default async function Page({ params }: { params: { id: string } }) {
  last = params.id;
  return <div>{last}</div>;
}
