/**
 * Wait for a specified duration.
 * @param milliseconds duration to wait in milliseconds
 * @returns promise that fulfills no less than `milliseconds` after timeout() was called
 */
export async function timeout(milliseconds:number):Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, milliseconds);
  return promise;
}