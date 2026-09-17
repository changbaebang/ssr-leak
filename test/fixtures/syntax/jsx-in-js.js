let last = '';

export function Banner(req) {
  last = req.url;
  return <div>{last}</div>;
}
