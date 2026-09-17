let lastId = '';

// loading/error/not-found receive no request data; a bare prop is a weak source.
export default function Loading(props: { id: string }) {
  lastId = props.id;
  return null;
}
