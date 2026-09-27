export function createLatestSerialQueue() {
  let tail: Promise<void> = Promise.resolve();

  return function enqueue<T>(isCurrent: () => boolean, task: () => Promise<T>): Promise<T | undefined> {
    const result = tail.then(() => isCurrent() ? task() : undefined);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}
