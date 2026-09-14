/**
 * Javora — recently-viewed profiles, for the search panel's "Recent" group.
 *
 * Client-only, by construction: which three profiles a reader looked at last
 * is per-browser state with no server snapshot to prerender, so this follows
 * the same `useSyncExternalStore` pattern `NotFoundPage.jsx` uses for its own
 * client-only address — an empty list on the first render (server and first
 * client paint agree), filled in a tick later once the browser can read
 * `localStorage`. A read during render instead would fail hydration for
 * every profile the reader has ever opened.
 */

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "javora.recentProfiles";
const MAX_ENTRIES = 3;
const EMPTY: RecentProfile[] = [];

export interface RecentProfile {
  slug: string;
  name: string;
}

function isRecentProfile(value: unknown): value is RecentProfile {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>).slug === "string" &&
    typeof (value as Record<string, unknown>).name === "string"
  );
}

let cache: RecentProfile[] | null = null;
const listeners = new Set<() => void>();

function read(): RecentProfile[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? parsed.filter(isRecentProfile).slice(0, MAX_ENTRIES) : [];
  } catch {
    cache = [];
  }
  return cache;
}

/** Called from `PersonPage.jsx` when a profile view actually renders. */
export function recordProfileVisit(slug: string, name: string): void {
  try {
    const withoutThisPerson = read().filter((entry) => entry.slug !== slug);
    cache = [{ slug, name }, ...withoutThisPerson].slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
    listeners.forEach((listener) => listener());
  } catch {
    // Private browsing / storage disabled: recent search history is a
    // convenience, not a feature anything else depends on.
  }
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

function getServerSnapshot(): RecentProfile[] {
  return EMPTY;
}

export function useRecentProfiles(): RecentProfile[] {
  return useSyncExternalStore(subscribe, read, getServerSnapshot);
}
