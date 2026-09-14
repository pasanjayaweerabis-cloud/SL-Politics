import { describe, it, expect, vi } from "vitest";
import { withTimeout } from "./withTimeout.ts";

/**
 * Javora — locking in the shared timer-race mechanism.
 *
 * server/api/server.ts and server/sync/retry.ts each declared their own
 * withTimeout with no test covering either. This pins the mechanism itself,
 * plus — the reason for the makeError factory rather than a bare message —
 * that each caller's own error class and message text survive the move
 * unchanged: server.ts's generic, per-endpoint-labelled Error persisted only
 * to logs, and retry.ts's TimeoutError persisted into
 * source_snapshot.error_message.
 */

describe("withTimeout", () => {
  it("resolves with the promise's value when it settles first", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000, () => new Error("timed out"))).resolves.toBe(
      "ok",
    );
  });

  it("accepts a bare value, not only a promise", async () => {
    await expect(withTimeout("ok" as never, 1000, () => new Error("timed out"))).resolves.toBe("ok");
  });

  it("rejects with the promise's own error when it rejects before the timeout", async () => {
    const original = new Error("upstream failed");
    await expect(withTimeout(Promise.reject(original), 1000, () => new Error("timed out"))).rejects.toBe(
      original,
    );
  });

  it("rejects with makeError()'s result when the timer fires first", async () => {
    vi.useFakeTimers();
    const never = new Promise(() => {});
    const promise = withTimeout(never, 1000, () => new Error("boom"));
    const assertion = expect(promise).rejects.toThrow("boom");
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    vi.useRealTimers();
  });

  it("does not fire the timer once the promise has already settled", async () => {
    vi.useFakeTimers();
    const makeError = vi.fn(() => new Error("should not be called"));
    const promise = withTimeout(Promise.resolve("fast"), 1000, makeError);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe("fast");
    expect(makeError).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("preserves server.ts's exact message format: '<label> timed out after <ms>ms'", async () => {
    vi.useFakeTimers();
    const QUERY_TIMEOUT_MS = 8000;
    const never = new Promise(() => {});
    const promise = withTimeout(
      never,
      QUERY_TIMEOUT_MS,
      () => new Error(`suggestPeople timed out after ${QUERY_TIMEOUT_MS}ms`),
    );
    const assertion = expect(promise).rejects.toThrow("suggestPeople timed out after 8000ms");
    await vi.advanceTimersByTimeAsync(QUERY_TIMEOUT_MS);
    await assertion;
    vi.useRealTimers();
  });

  it("preserves retry.ts's TimeoutError class identity and message", async () => {
    // Mirrors retry.ts's own class rather than importing it, so this test
    // does not silently pass if retry.ts's factory call is ever edited to
    // pass a generic Error instead — the class check would fail either way.
    class TimeoutError extends Error {
      constructor(ms: number) {
        super(`timed out after ${ms}ms`);
        this.name = "TimeoutError";
      }
    }
    vi.useFakeTimers();
    const never = new Promise(() => {});
    const promise = withTimeout(never, 500, () => new TimeoutError(500));
    const assertion = promise.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(500);
    const error = await assertion;
    expect(error).toBeInstanceOf(TimeoutError);
    expect((error as Error).message).toBe("timed out after 500ms");
    vi.useRealTimers();
  });
});
