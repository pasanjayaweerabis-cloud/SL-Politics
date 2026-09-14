import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TtlCache } from "./cache.ts";

describe("TtlCache", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns the cached value within the TTL without recomputing", async () => {
    const cache = new TtlCache<number>(1000);
    const compute = vi.fn(async () => 42);

    expect(await cache.get(compute)).toBe(42);
    vi.advanceTimersByTime(500);
    expect(await cache.get(compute)).toBe(42);

    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("recomputes once the TTL has elapsed — staleness does not persist forever", async () => {
    const cache = new TtlCache<number>(1000);
    let value = 1;
    const compute = vi.fn(async () => value);

    expect(await cache.get(compute)).toBe(1);
    value = 2;
    vi.advanceTimersByTime(1001);
    expect(await cache.get(compute)).toBe(2);

    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("a real change becomes visible after expiry, not before", async () => {
    // Same property as above, phrased the way the task asks for it: proof
    // that caching cannot hide a genuine update indefinitely.
    const cache = new TtlCache<string>(1000);
    let current = "Minister of Energy";
    const compute = vi.fn(async () => current);

    expect(await cache.get(compute)).toBe("Minister of Energy");
    current = "Minister of Ports"; // the source changed
    expect(await cache.get(compute)).toBe("Minister of Energy"); // still cached — not yet stale-checked
    vi.advanceTimersByTime(1000);
    expect(await cache.get(compute)).toBe("Minister of Ports"); // now reflects reality
  });

  it("concurrent misses share ONE in-flight computation, not one each", async () => {
    // The actual protection this exists for: a burst of simultaneous
    // requests arriving right as the cache expires must not each independently
    // query the database.
    const cache = new TtlCache<number>(1000);
    let calls = 0;
    const compute = vi.fn(async () => {
      calls++;
      return calls; // distinguishable per call, so a duplicate call is visible
    });

    const [a, b, c] = await Promise.all([cache.get(compute), cache.get(compute), cache.get(compute)]);

    expect(compute).toHaveBeenCalledTimes(1);
    expect([a, b, c]).toEqual([1, 1, 1]);
  });

  it("a failed computation is not cached, and does not wedge future calls", async () => {
    const cache = new TtlCache<number>(1000);
    const compute = vi.fn()
      .mockRejectedValueOnce(new Error("db unavailable"))
      .mockResolvedValueOnce(7);

    await expect(cache.get(compute)).rejects.toThrow("db unavailable");
    expect(await cache.get(compute)).toBe(7);
  });

  it("invalidate() forces the next call to recompute immediately", async () => {
    const cache = new TtlCache<number>(10_000);
    let value = 1;
    const compute = async () => value;

    expect(await cache.get(compute)).toBe(1);
    value = 2;
    cache.invalidate();
    expect(await cache.get(compute)).toBe(2);
  });
});

/**
 * The correctness rule this whole feature exists to enforce: current
 * government data gets a SHORTER freshness window than more historical or
 * structural data. Importing the real constants from server.ts, not
 * hand-copied numbers, so this fails the moment the two default TTLs are
 * edited into the wrong relationship — which is exactly the mistake that
 * would silently reintroduce the problem this task was given to prevent.
 */
describe("cache TTL policy — current government data is fresher than facets", () => {
  it("GOVERNMENT_CACHE_TTL_MS is strictly shorter than FACETS_CACHE_TTL_MS", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("./server.ts", import.meta.url), "utf8"),
    );
    // [\d_]+ , not \d+: the real declarations use numeric separators (15_000).
    const govMatch = source.match(/GOVERNMENT_CACHE_TTL_MS = Number\(process\.env\.\w+ \?\? ([\d_]+)\)/);
    const facetsMatch = source.match(/FACETS_CACHE_TTL_MS = Number\(process\.env\.\w+ \?\? ([\d_]+)\)/);

    expect(govMatch, "could not find GOVERNMENT_CACHE_TTL_MS's default in server.ts").not.toBeNull();
    expect(facetsMatch, "could not find FACETS_CACHE_TTL_MS's default in server.ts").not.toBeNull();

    const govTtl = Number(govMatch![1].replace(/_/g, ""));
    const facetsTtl = Number(facetsMatch![1].replace(/_/g, ""));

    expect(
      govTtl,
      `current-government TTL (${govTtl}ms) must be shorter than facets TTL (${facetsTtl}ms) — ` +
        "current office-holders must never be cached as long as historical/structural counts",
    ).toBeLessThan(facetsTtl);
  });
});
