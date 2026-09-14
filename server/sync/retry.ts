/**
 * Javora — timeout and retry for a source fetch.
 *
 * Two independent protections, deliberately not conflated:
 *
 *   TIMEOUT bounds how long a single attempt may hang. Without it, a
 *   government server that accepts a connection and never responds ties up
 *   the sync worker (and, transitively, a `setInterval` slot) indefinitely —
 *   the schedule for that source would silently stop advancing.
 *
 *   RETRY absorbs a transient failure — a dropped connection, a momentary
 *   5xx — without escalating it to a failed `sync_run` on the first blip. It
 *   backs off between attempts rather than hammering a source that is
 *   struggling, and it is bounded: a source that is genuinely down still
 *   ends in a recorded failure, not an infinite loop.
 *
 * Both apply to FETCH only. A parse or database error is not transient —
 * retrying it would just fail the same way again — so those are reported
 * once, immediately, exactly as before.
 */

import { withTimeout } from "../lib/withTimeout.ts";

export interface RetryOptions {
  /** Milliseconds before ONE attempt is abandoned. */
  timeoutMs: number;
  /** Total attempts, including the first — 1 means "no retry". */
  attempts: number;
  /** Delay before the second attempt; doubles each attempt after that. */
  backoffMs: number;
  /** Overridable for tests; real callers use the platform timer. */
  sleep?: (ms: number) => Promise<void>;
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn` with a per-attempt timeout, retrying on failure up to
 * `attempts` times with doubling backoff.
 *
 * Every attempt (including failed ones) is reported through `onAttempt`, so
 * the caller can log "attempt 2/3 failed: timed out" rather than learning
 * about retries only after they have all been exhausted.
 */
export async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
  onAttempt?: (attempt: number, error: unknown | null) => void,
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    try {
      const result = await withTimeout(fn(), options.timeoutMs, () => new TimeoutError(options.timeoutMs));
      onAttempt?.(attempt, null);
      return result;
    } catch (error) {
      lastError = error;
      onAttempt?.(attempt, error);
      if (attempt < options.attempts) {
        await sleep(options.backoffMs * 2 ** (attempt - 1));
      }
    }
  }

  throw lastError;
}
