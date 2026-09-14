/**
 * Javora — profile tab state.
 *
 * Pure functions, kept out of the component for the same reason as
 * `lib/typeahead.ts`: this project has no DOM test renderer, so extracting
 * the decisions makes them testable rather than merely asserted.
 */

export const PROFILE_TABS = ["education", "political"] as const;
export type ProfileTabId = (typeof PROFILE_TABS)[number];

/** The tab shown when nothing else is specified. Person-first, by design. */
export const DEFAULT_TAB: ProfileTabId = "education";

/**
 * Which tab a URL asks for.
 *
 * Anything unrecognised falls back to the default rather than rendering an
 * empty profile — a stale or hand-edited `?tab=` must never leave the reader
 * looking at nothing.
 */
export function tabFromSearch(search: string | null | undefined): ProfileTabId {
  const requested = new URLSearchParams(search ?? "").get("tab");
  return (PROFILE_TABS as readonly string[]).includes(requested ?? "")
    ? (requested as ProfileTabId)
    : DEFAULT_TAB;
}

/**
 * The query string for a tab.
 *
 * The default tab produces an EMPTY string, so a person's canonical URL stays
 * `/person/name` rather than `/person/name?tab=education`. One page, one
 * address.
 */
export function searchForTab(tab: ProfileTabId): string {
  return tab === DEFAULT_TAB ? "" : `tab=${tab}`;
}

/**
 * Where arrow-key focus moves within the tab strip, wrapping at both ends.
 * Focus only — activation is a separate, deliberate act (see `Tabs.jsx`).
 */
export function nextTabIndex(current: number, key: string, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowRight": return (current + 1) % count;
    case "ArrowLeft": return (current - 1 + count) % count;
    case "Home": return 0;
    case "End": return count - 1;
    default: return null;
  }
}
