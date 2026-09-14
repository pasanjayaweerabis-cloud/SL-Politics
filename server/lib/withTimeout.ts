/**
 * Javora — race a promise against a timer.
 *
 * server/api/server.ts and server/sync/retry.ts each declared their own
 * withTimeout, sharing the same timer-race mechanism (setTimeout, race
 * against the promise, clearTimeout on whichever settles first) but
 * genuinely differing in what they reject with:
 *   - server.ts labels the error with which query timed out
 *     ("suggestPeople timed out after 8000ms") — that text goes into the
 *     server's own error log.
 *   - retry.ts's TimeoutError (server/sync/retry.ts) is a typed class with a
 *     fixed message ("timed out after 500ms") — that text is written into
 *     source_snapshot.error_message when a connector fetch fails, so
 *     changing its format would be changing what gets recorded, not merely
 *     refactoring code.
 *
 * So only the mechanism moved here, via a `makeError` factory each caller
 * supplies — never the choice of error class or message. Both call sites
 * produce EXACTLY the error they produced before this file existed.
 */
export function withTimeout<T>(
  promise: T | Promise<T>,
  ms: number,
  makeError: () => Error,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(makeError()), ms);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}
