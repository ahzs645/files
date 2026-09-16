/** Bound bridge concurrency below the host's eight-operation limit. No mutation retries. */
export function createRequestQueue(limit = 4) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        Promise.resolve().then(operation).then(resolve, reject).finally(() => {
          active--;
          waiting.shift()?.();
        });
      };
      if (active < limit) run(); else waiting.push(run);
    });
  };
}
