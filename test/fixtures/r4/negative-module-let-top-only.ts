let counter = 0;
const config = { retries: 3 };

counter = 1;
config.retries = 5;

export function read() {
  return counter + config.retries;
}
