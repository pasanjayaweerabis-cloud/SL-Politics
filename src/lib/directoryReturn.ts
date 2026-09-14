/**
 * Javora — the directory a reader actually came from.
 *
 * Every profile opens with "Back to Directory", and it pointed at the bare
 * `/directory`. For a reader who arrived from a search engine that is right.
 * For the reader it was written for — one who narrowed 1,623 records down to
 * "JJB · Colombo · Ministers", opened a name to check it, and wants the list
 * back — it silently discarded the search, the facets, the sort and the
 * letter, and dropped them at the top of the unfiltered register with the
 * work to do again. The browser's own Back button restores all of it (see
 * `useRouteTransition` in router.tsx); the link that looks like Back should
 * not be the one control on the page that throws it away.
 *
 * SESSION STORAGE, NOT LOCAL. This is "where I am in this piece of
 * research", which belongs to one tab and ends with it — not a preference to
 * carry into next month. A second tab reading a different slice of the
 * register keeps its own answer, and nothing about which records someone
 * looked at outlives the session.
 *
 * CLIENT-ONLY, the same way `recentProfiles.ts` is and for the same reason:
 * a prerendered page has no session to read, so the server snapshot is the
 * plain `/directory` every crawler and every no-JS reader gets in the static
 * HTML. `useSyncExternalStore` is what makes that safe — React renders the
 * server snapshot during hydration and only then adopts the stored one, so
 * the markup never disagrees with itself.
 */

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "javora.directorySearch";

/**
 * The register with nothing narrowing it.
 *
 * Also the SERVER snapshot, and that is the load-bearing part: a prerendered
 * page is built with no session, so this is the href in the static HTML, and
 * the first client render during hydration must reproduce it exactly.
 */
export const DIRECTORY_HREF = "/directory";
const DIRECTORY = DIRECTORY_HREF;

/**
 * The remembered query string, as a full href.
 *
 * Cached so a render does not touch storage, and so `getSnapshot` returns a
 * stable value between renders — `useSyncExternalStore` re-renders whenever
 * the snapshot changes, and a fresh read each time would be a new value only
 * by accident of timing.
 */
let cache: string | null = null;
const listeners = new Set<() => void>();

/**
 * The remembered directory href, read from the session on first call and
 * cached after. Exported so the behaviour can be tested without a DOM; the
 * hook below is the way components should reach it.
 */
export function directoryReturnHref(): string {
  if (cache !== null) return cache;
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    cache = stored ? `${DIRECTORY}?${stored}` : DIRECTORY;
  } catch {
    // Private browsing / storage disabled. The plain directory is a correct
    // destination, just a less helpful one.
    cache = DIRECTORY;
  }
  return cache;
}

/**
 * Record the directory's current query string. Called from `DirectoryPage`
 * whenever its URL settles.
 *
 * An EMPTY search clears the memory rather than being ignored: a reader who
 * deliberately cleared their filters has said what they want to come back
 * to, and remembering the filters they just removed would be worse than
 * remembering nothing.
 *
 * The leading "?" is not stored — `DirectoryPage` works in bare query
 * strings (see `toSearchString`) and `Route.search` carries the "?", so the
 * one canonical form here is "without", normalised on the way in.
 */
export function rememberDirectorySearch(search: string): void {
  const normalised = (search ?? "").replace(/^\?/, "");
  const next = normalised ? `${DIRECTORY}?${normalised}` : DIRECTORY;
  if (cache === next) return;
  cache = next;
  try {
    if (normalised) sessionStorage.setItem(STORAGE_KEY, normalised);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same as `read`: the in-memory cache still serves this page view.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

function getServerSnapshot(): string {
  return DIRECTORY_HREF;
}

/**
 * Where "Back to Directory" should go: the reader's own last view of the
 * register, or the plain directory when there isn't one.
 */
export function useDirectoryReturnHref(): string {
  return useSyncExternalStore(subscribe, directoryReturnHref, getServerSnapshot);
}
