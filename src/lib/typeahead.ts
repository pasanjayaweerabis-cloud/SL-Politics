/**
 * Javora — typeahead selection logic.
 *
 * Kept framework-free and pure on purpose. `SearchTypeahead.jsx` is thin
 * glue: it calls these functions and applies the result to DOM/React state.
 * That split means the interaction logic — arrow-key wrapping, what Enter
 * does with and without a highlighted suggestion, when Escape closes the
 * panel — is fully unit-testable without rendering React or a browser DOM,
 * which this project has no test renderer set up for (see the note in
 * `SearchTypeahead.test.ts`).
 */

import { matchKey, editDistance } from "./nameMatch.ts";

/** Move the highlighted suggestion, wrapping around both ends of the list. */
export function moveActiveIndex(
  current: number,
  direction: 1 | -1,
  length: number,
): number {
  if (length === 0) return -1;
  if (current < 0) return direction === 1 ? 0 : length - 1;
  return (current + direction + length) % length;
}

export type TypeaheadAction =
  | { type: "move"; direction: 1 | -1 }
  | { type: "select"; index: number }
  | { type: "submit" }
  | { type: "close" }
  | { type: "none" };

/**
 * What a keydown on the search input should do, given the panel's current
 * state. Doesn't touch state itself — the caller applies the result.
 */
export function resolveKeyAction(
  key: string,
  state: { open: boolean; activeIndex: number; resultCount: number },
): TypeaheadAction {
  if (key === "ArrowDown") {
    return state.resultCount ? { type: "move", direction: 1 } : { type: "none" };
  }
  if (key === "ArrowUp") {
    return state.resultCount ? { type: "move", direction: -1 } : { type: "none" };
  }
  if (key === "Enter") {
    if (state.open && state.activeIndex >= 0 && state.activeIndex < state.resultCount) {
      return { type: "select", index: state.activeIndex };
    }
    // No suggestion highlighted — Enter falls through to the form's own
    // submit behaviour (a full directory search), so return "none" rather
    // than intercepting it.
    return { type: "none" };
  }
  if (key === "Escape") {
    return state.open ? { type: "close" } : { type: "none" };
  }
  return { type: "none" };
}

/**
 * Whether a bare Enter (nothing arrow-key-selected, just the automatic
 * top-result highlight) should jump straight to that person, or submit to
 * the full directory search instead.
 *
 * Typing "ranil" should jump straight to a profile; typing "kandy" — a
 * place, not a name — should not silently land the reader on one person's
 * biography with no explanation. `ranks` is `suggestPeopleRanked`'s output,
 * in display order: index 0 is the row that would be auto-highlighted. The
 * gate only ever loosens for an UNAMBIGUOUS name match (rank 0, the direct
 * name/alias hit) whose next-best result is strictly weaker — a second rank-0
 * result means two people plausibly answer the query, which is exactly the
 * ambiguous case Enter should not silently resolve on the reader's behalf.
 *
 * Arrow-key or click selection never calls this: the reader pointing at a
 * row is itself the confidence signal, independent of rank.
 */
export function shouldAutoJump(ranks: number[]): boolean {
  if (ranks.length === 0) return false;
  if (ranks[0] !== 0) return false;
  return ranks.length === 1 || ranks[1] > 0;
}

/**
 * Spelling-variant suggestions for the no-results path only.
 *
 * Transliteration means "Wickremesinghe", "Wickramasinghe" and
 * "Wickremesinghe" are one person to a reader and three different strings to
 * a prefix match. This proposes alternate spellings to *search*, nothing
 * more — it never merges or resolves identity, and it is a separate,
 * independently-thresholded use of `editDistance` from anything in
 * `identity.ts`/`nameMatch.ts`'s own callers. Compared against every
 * individual name TOKEN (not whole names — "wickramasinghe" against the full
 * "Ranil Wickremesinghe" would fail the length-gated distance check before it
 * even compares letters), so a surname typo still surfaces the right people.
 *
 * `query` shorter than 3 characters returns nothing: below that, almost
 * every candidate is within distance 2 of almost every short token, which
 * would suggest everything and mean nothing.
 */
export function didYouMean(query: string, candidateNames: string[], limit = 3): string[] {
  const queryTokens = matchKey(query).split(" ").filter((token) => token.length >= 3);
  if (!queryTokens.length) return [];

  const best = new Map<string, number>();
  for (const name of candidateNames) {
    const nameTokens = matchKey(name).split(" ").filter((token) => token.length >= 3);
    if (!nameTokens.length) continue;
    // Every query token must land close to SOME token in this name — a
    // one-word surname typo should not surface a name it only half matches.
    const distances = queryTokens.map(
      (qt) => Math.min(...nameTokens.map((nt) => editDistance(qt, nt, 2)), Infinity),
    );
    if (distances.some((d) => d > 2)) continue;
    const total = distances.reduce((sum, d) => sum + d, 0);
    if (total === 0) continue; // an exact match has nothing to suggest instead of itself
    const prior = best.get(name);
    if (prior === undefined || total < prior) best.set(name, total);
  }

  return [...best.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, limit)
    .map(([name]) => name);
}
