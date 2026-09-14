/**
 * Javora — identity review queue.
 *
 * `lib/identity.ts` already enforces the hard rule: two records are merged
 * automatically only on an exact external-ID match from the same source.
 * Everything weaker — a name match, a name-plus-birth-date match, an
 * initials-only match — comes back from `resolveIdentity()` with
 * `autoMergeable: false`. This module is what happens to those: rather than
 * being silently discarded or silently applied, they become a queued item a
 * human reviews before any merge happens.
 *
 * No storage or UI exists yet for this queue — see the README. This module
 * is the shape that storage/UI will be built against.
 */

import type { IdentityMatch, MatchConfidence } from "../lib/identity.ts";

export interface IdentityReviewItem {
  id: string;
  incomingName: string;
  /** The existing person this incoming record was matched against, if any. */
  candidatePersonId: string | null;
  confidence: Exclude<MatchConfidence, "exact">;
  signals: string[];
  sourceId: string | null;
  detectedAt: string;
}

let counter = 0;

/**
 * Turn a resolved identity match into a review item — unless it needs no
 * review at all: an exact match was already safe to auto-merge, and "no
 * match found" isn't a review item, it's a new person.
 */
export function reviewItemFor(
  match: IdentityMatch,
  incoming: { canonicalName: string },
  sourceId: string | null,
  detectedAt: string = new Date().toISOString(),
): IdentityReviewItem | null {
  if (match.autoMergeable) return null;
  if (match.confidence === "none" || match.confidence === "exact") return null;

  return {
    id: `review-${++counter}`,
    incomingName: incoming.canonicalName,
    candidatePersonId: match.personId,
    confidence: match.confidence,
    signals: match.signals,
    sourceId,
    detectedAt,
  };
}
