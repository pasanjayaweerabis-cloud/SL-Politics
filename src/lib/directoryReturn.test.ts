import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Javora — the directory a profile returns to.
 *
 * There is no DOM test renderer in this project (see CLAUDE.md's note on why
 * jsdom was considered and rejected), so the hook itself is exercised by
 * hand. What IS testable, and what actually matters, is the store
 * underneath: what gets remembered, what clears it, and — the one that would
 * break every prerendered page if it regressed — that the plain `/directory`
 * a crawler and a no-JS reader receive is what the server snapshot always
 * returns, whatever a session happens to hold.
 *
 * Modules are reset between tests so the in-memory cache starts empty, the
 * way it does on a fresh page load.
 */

/** A minimal in-memory stand-in for the real per-tab sessionStorage. */
function installSessionStorage(): void {
  const data = new Map<string, string>();
  (globalThis as Record<string, unknown>).sessionStorage = {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const load = () => import("./directoryReturn.ts");

beforeEach(() => {
  vi.resetModules();
  installSessionStorage();
});
afterEach(() => {
  delete (globalThis as Record<string, unknown>).sessionStorage;
});

describe("directoryReturn", () => {
  it("remembers a filtered view of the register as a full href", async () => {
    const { rememberDirectorySearch, directoryReturnHref } = await load();
    rememberDirectorySearch("?party=jjb&district=colombo");
    expect(directoryReturnHref()).toBe("/directory?party=jjb&district=colombo");
  });

  it("normalises away a leading '?' so only one stored form exists", async () => {
    const { rememberDirectorySearch, directoryReturnHref } = await load();
    rememberDirectorySearch("party=jjb");
    expect(directoryReturnHref()).toBe("/directory?party=jjb");
  });

  it("falls back to the plain directory when nothing has been remembered", async () => {
    const { directoryReturnHref } = await load();
    expect(directoryReturnHref()).toBe("/directory");
  });

  it("reads back a value written by an earlier page in the same session", async () => {
    const first = await load();
    first.rememberDirectorySearch("?letter=W");
    // A client-side navigation keeps the module alive, but a reload does not;
    // resetting proves the value came out of storage, not out of the cache.
    vi.resetModules();
    const second = await load();
    expect(second.directoryReturnHref()).toBe("/directory?letter=W");
  });

  it("forgets, rather than keeps, the filters a reader deliberately cleared", async () => {
    const { rememberDirectorySearch, directoryReturnHref } = await load();
    rememberDirectorySearch("?party=jjb");
    rememberDirectorySearch("");
    expect(directoryReturnHref()).toBe("/directory");
  });

  it("notifies subscribers only when the destination actually changes", async () => {
    const { rememberDirectorySearch, directoryReturnHref } = await load();
    // `useSyncExternalStore` re-renders on every notification, so repeating
    // the same search — which DirectoryPage's effect does on any re-render
    // that leaves the URL alone — must not be one.
    rememberDirectorySearch("?party=jjb");
    const before = directoryReturnHref();
    rememberDirectorySearch("?party=jjb");
    expect(directoryReturnHref()).toBe(before);
  });

  it("survives storage being unavailable, because a blocked store is not an error", async () => {
    // Private browsing, or a reader who has disabled site data. The link must
    // still lead somewhere real.
    delete (globalThis as Record<string, unknown>).sessionStorage;
    const { rememberDirectorySearch, directoryReturnHref } = await load();
    expect(() => rememberDirectorySearch("?party=jjb")).not.toThrow();
    expect(directoryReturnHref()).toBe("/directory?party=jjb");
  });

  it("serves the plain directory to the server, whatever the session holds", async () => {
    // The prerendered HTML is built with no session at all, and the first
    // client render during hydration has to reproduce it exactly or React
    // discards the prerendered tree — see CLAUDE.md's prerender invariants.
    const { rememberDirectorySearch, DIRECTORY_HREF } = await load();
    rememberDirectorySearch("?party=jjb&letter=W");
    expect(DIRECTORY_HREF).toBe("/directory");
  });
});
