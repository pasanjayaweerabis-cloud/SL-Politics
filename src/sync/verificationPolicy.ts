/**
 * Javora — what "verified" means, and why almost nothing is.
 *
 * The tempting shortcut, which this module exists to refuse: "it came from
 * parliament.lk, therefore it is verified." That conflates two different
 * things — the authority of the source, and whether *our reading of it* is
 * correct. An importer can point at an impeccable official page and still
 * have put the district in the party field, split one office into two, or
 * carried over a row the source has since removed. Marking that VERIFIED
 * would make the badge meaningless exactly where it matters most.
 *
 * THE RULE
 *
 * A claim is VERIFIED only when all four hold:
 *
 *   1. Its evidence is precise — a specific document URL, record id or
 *      locator, not merely an institution's name. (`hasPreciseEvidence`)
 *   2. That evidence comes from a source that is authoritative FOR THIS FACT
 *      TYPE — Parliament for parliamentary membership, the Election
 *      Commission for results, and not vice versa. (`isAuthoritativeFor`)
 *   3. The extraction has been confirmed — either a human reviewed it, or a
 *      second independent source agrees. Two pages of the same website are
 *      a consistency check, not independent agreement.
 *   4. A confirmation date is recorded. A verification with no date is not a
 *      verification; it is a hope.
 *
 * Today, condition 3 is never satisfied: no review UI exists and only one
 * source is connected. So every imported fact lands on SOURCE_LINKED, which
 * says precisely what is true — "here is the official document this came
 * from; nobody has checked our reading of it."
 */

import { VerificationState, type VerificationStateValue } from "../types/models.ts";
import { isAuthoritativeFor } from "../data/sources.ts";
import type { FactType } from "../types/models.ts";

export interface ImportedFactContext {
  sourceId: string;
  factType: FactType;
  /** True when the evidence names a specific document, not just an institution. */
  hasPreciseEvidence: boolean;
  /** A human reviewed this extraction, or an independent source corroborated it. */
  confirmed: boolean;
  /** When that confirmation happened. Null unless it actually did. */
  confirmedAt: string | null;
  /** Set when two sources assert different values for the same fact. */
  conflicting?: boolean;
}

/**
 * The verification state an imported fact is entitled to.
 *
 * Deliberately returns the *weakest* state consistent with the evidence.
 * `normaliseClaim()` in `lib/verification.ts` independently enforces the
 * same floor at render time, so a mistake here cannot promote a claim past
 * what its evidence supports.
 */
export function verificationForImportedFact(
  context: ImportedFactContext,
): VerificationStateValue {
  // Disagreement is surfaced, never resolved by picking a winner.
  if (context.conflicting) return VerificationState.CONFLICTING;

  // No checkable document: naming an institution is not a citation.
  if (!context.hasPreciseEvidence) return VerificationState.UNVERIFIED;

  // Right document, wrong authority for this kind of fact.
  if (!isAuthoritativeFor(context.sourceId, context.factType)) {
    return VerificationState.SOURCE_LINKED;
  }

  // Precise evidence from the authoritative source, but nobody has confirmed
  // our reading of it. This is where every record currently sits.
  if (!context.confirmed || !context.confirmedAt) {
    return VerificationState.SOURCE_LINKED;
  }

  return VerificationState.VERIFIED;
}
