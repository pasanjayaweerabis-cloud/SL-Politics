/**
 * Javora — source reconciliation.
 *
 * When two official sources describe the same fact differently, this decides
 * what the canonical value becomes — and, just as importantly, what is kept.
 *
 * The rules, in order:
 *
 *   1. Sources that AGREE are not a conflict. Agreement is checked after
 *      normalising for the cosmetic differences institutions genuinely have
 *      (case, spacing, "&" vs "and"), not by raw string equality.
 *
 *   2. Sources that describe the SAME OFFICE under different labels —
 *      "Minister of Energy" vs "Minister of Energy and Power" — are a
 *      conflict about wording, not two separate offices. Treating them as two
 *      offices would give a minister a phantom second portfolio.
 *
 *   3. A genuine disagreement is settled by fact-type authority where the
 *      rules allow, and referred to human review where they do not.
 *
 *   4. EVIDENCE FROM BOTH SOURCES IS ALWAYS RETAINED. Losing a conflict
 *      decides which value is displayed; it never deletes the record that the
 *      other institution said something different. That record is often the
 *      most interesting thing on the page.
 */

import type { FactType } from "../../src/types/models.ts";
import { decideAuthority, type AuthorityDecision } from "./authority.ts";

/** One source's claim about one fact. */
export interface SourcedClaim {
  sourceId: string;
  value: string | null;
  evidenceId?: string | null;
  /** When the source was retrieved, used only to report recency. */
  retrievedAt?: string | null;
}

export type ReconciliationOutcome =
  /** Every source says the same thing. */
  | { kind: "agreed"; value: string | null; sourceIds: string[] }
  /** Authority rules picked a winner; the loser's claim is still kept. */
  | {
      kind: "resolved";
      value: string | null;
      winningSourceId: string;
      losing: SourcedClaim[];
      reason: string;
    }
  /** The rules cannot choose. Nothing is overwritten; a human decides. */
  | {
      kind: "unresolved";
      claims: SourcedClaim[];
      reason: string;
    };

/**
 * Normalise a value for COMPARISON only.
 *
 * Never applied to a stored value: the canonical record keeps whatever the
 * winning source actually wrote. This exists so that "Minister of Ports &
 * Civil Aviation" and "Minister of Ports and Civil Aviation" are recognised
 * as the same claim rather than logged as an institutional dispute.
 */
export function comparableValue(value: string | null): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.,;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether two office titles plausibly name the SAME office.
 *
 * Requires the same office *class* (a deputy ministry is never the same
 * office as the cabinet ministry of the same subject — that is a different
 * job held by a different person) and then overlapping subject words.
 *
 * Deliberately conservative: when unsure it answers false, which produces two
 * separate positions rather than silently merging two real offices into one.
 */
export function sameOfficeLikely(titleA: string, titleB: string): boolean {
  const a = comparableValue(titleA);
  const b = comparableValue(titleB);
  if (!a || !b) return false;
  if (a === b) return true;

  const classOf = (t: string) =>
    /^deputy minister of /.test(t) ? "deputy"
    : /^state minister of /.test(t) ? "state"
    : /^minister of /.test(t) ? "cabinet"
    : "other";

  if (classOf(a) !== classOf(b)) return false;
  if (classOf(a) === "other") return false;

  const subject = (t: string) =>
    new Set(
      t.replace(/^(deputy |state )?minister of /, "")
        .split(" ")
        .filter((w) => w.length > 2 && w !== "and"),
    );

  const sa = subject(a);
  const sb = subject(b);
  if (!sa.size || !sb.size) return false;

  let shared = 0;
  for (const word of sa) if (sb.has(word)) shared++;

  // Every word of the shorter title must appear in the longer one, so
  // "Energy" ⊂ "Energy and Power" matches, while "Energy" vs "Health" does
  // not, and neither does "Trade and Commerce" vs "Trade and Industry".
  return shared === Math.min(sa.size, sb.size);
}

/**
 * Reconcile several sources' claims about one fact.
 *
 * Pure: it decides, it does not write. The caller persists the outcome and
 * the conflict record.
 */
export function reconcileClaims(
  factType: FactType,
  claims: SourcedClaim[],
  { treatSimilarOfficesAsSame = false } = {},
): ReconciliationOutcome {
  const present = claims.filter((c) => c.value !== null && c.value !== undefined);
  if (present.length === 0) return { kind: "agreed", value: null, sourceIds: claims.map((c) => c.sourceId) };
  if (present.length === 1) {
    return { kind: "agreed", value: present[0]!.value, sourceIds: [present[0]!.sourceId] };
  }

  const groups = new Map<string, SourcedClaim[]>();
  for (const claim of present) {
    const key = comparableValue(claim.value);
    const bucket = groups.get(key);
    if (bucket) bucket.push(claim);
    else groups.set(key, [claim]);
  }

  if (groups.size === 1) {
    return { kind: "agreed", value: present[0]!.value, sourceIds: present.map((c) => c.sourceId) };
  }

  // Office titles that differ only by elaboration are one office, still to be
  // reconciled — but as a wording dispute, not as two jobs.
  if (treatSimilarOfficesAsSame) {
    const distinct = [...groups.values()].map((g) => g[0]!);
    const allSimilar = distinct.every((claim, i) =>
      distinct.every((other, j) => i === j || sameOfficeLikely(String(claim.value), String(other.value))),
    );
    if (!allSimilar) {
      return {
        kind: "unresolved",
        claims: present,
        reason: "Sources describe offices that do not appear to be the same office; they are kept apart rather than merged.",
      };
    }
  }

  // Pairwise authority, reduced to a single winner.
  let winner = present[0]!;
  let reason = "";
  for (let i = 1; i < present.length; i++) {
    const challenger = present[i]!;
    const decision: AuthorityDecision = decideAuthority(factType, winner.sourceId, challenger.sourceId);
    if (decision.outcome === "indeterminate") {
      return { kind: "unresolved", claims: present, reason: decision.reason };
    }
    reason = decision.reason;
    if (decision.outcome === "b-wins") winner = challenger;
  }

  return {
    kind: "resolved",
    value: winner.value,
    winningSourceId: winner.sourceId,
    losing: present.filter((c) => c.sourceId !== winner.sourceId),
    reason,
  };
}
