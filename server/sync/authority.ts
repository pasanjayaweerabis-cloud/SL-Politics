/**
 * Javora — fact-specific source authority.
 *
 * There is deliberately no global "source A beats source B" ranking. Which
 * institution is authoritative depends on WHICH FACT is in dispute:
 * Parliament is definitive about who sits in Parliament but says nothing
 * binding about election returns; the Election Commission is the reverse. A
 * single ordering would silently prefer the wrong body for roughly half the
 * facts on the site.
 *
 * `rank` orders competing authorities for one fact type — 1 is primary. Two
 * sources at the same rank for the same fact type means neither outranks the
 * other, so a disagreement between them CANNOT be settled automatically and
 * goes to review rather than being decided by declaration order.
 */

import type { FactType } from "../../src/types/models.ts";

export interface AuthorityRule {
  factType: FactType;
  /** Source ids in authority order; index 0 is primary. */
  sourceIds: string[];
}

/**
 * The authority table.
 *
 * Sources appear here whether or not a connector exists for them: this
 * records which institution *is* authoritative, which is a fact about Sri
 * Lankan public administration, not a claim about Javora's plumbing. Whether
 * Javora can read a source is recorded separately, in `source.sync_state`.
 */
export const AUTHORITY_RULES: AuthorityRule[] = [
  // Who sits in Parliament, and their parliamentary office.
  { factType: "parliamentary-membership", sourceIds: ["S001"] },

  // Declared election results.
  { factType: "election-result", sourceIds: ["S002"] },

  // Appointment to executive office. The Gazette is the instrument that
  // gives an appointment legal force, so it outranks announcements of it.
  { factType: "executive-appointment", sourceIds: ["S005", "S003", "S006"] },

  // Which subjects and functions a minister holds. The Gazette assigns them
  // legally; the Cabinet Office publishes the working record; Parliament
  // reprints a portfolio label on each member's page, which is useful but
  // downstream of both.
  { factType: "portfolio-assignment", sourceIds: ["S005", "S006", "S001"] },

  { factType: "gazette-instrument", sourceIds: ["S005"] },
  { factType: "party-affiliation", sourceIds: ["S002", "S001"] },
  { factType: "qualification", sourceIds: ["S004"] },
  // Nobody is definitive about biography; Parliament is merely the source
  // that happens to publish it.
  { factType: "biographical", sourceIds: ["S001"] },
];

const ruleIndex = new Map(AUTHORITY_RULES.map((r) => [r.factType, r]));

/** Authority rank for a source on a fact type; null when it has none. */
export function authorityRank(sourceId: string, factType: FactType): number | null {
  const rule = ruleIndex.get(factType);
  if (!rule) return null;
  const index = rule.sourceIds.indexOf(sourceId);
  return index === -1 ? null : index + 1;
}

export function isAuthoritative(sourceId: string, factType: FactType): boolean {
  return authorityRank(sourceId, factType) !== null;
}

export function primarySourceFor(factType: FactType): string | null {
  return ruleIndex.get(factType)?.sourceIds[0] ?? null;
}

export type AuthorityDecision =
  | { outcome: "a-wins"; sourceId: string; reason: string }
  | { outcome: "b-wins"; sourceId: string; reason: string }
  | { outcome: "indeterminate"; reason: string };

/**
 * Decide which of two disagreeing sources should supply the canonical value.
 *
 * Returns `indeterminate` — meaning "a human must look" — whenever the rules
 * cannot settle it confidently: equal rank, or a source with no recognised
 * authority for this fact type at all. Guessing here would silently pick a
 * winner between two official bodies, which is exactly what the conflict
 * record exists to prevent.
 */
export function decideAuthority(
  factType: FactType,
  sourceAId: string,
  sourceBId: string,
): AuthorityDecision {
  const rankA = authorityRank(sourceAId, factType);
  const rankB = authorityRank(sourceBId, factType);

  if (rankA === null && rankB === null) {
    return {
      outcome: "indeterminate",
      reason: `Neither ${sourceAId} nor ${sourceBId} is a recognised authority for ${factType}.`,
    };
  }
  if (rankA !== null && rankB === null) {
    return { outcome: "a-wins", sourceId: sourceAId, reason: `${sourceAId} is authoritative for ${factType}; ${sourceBId} is not.` };
  }
  if (rankB !== null && rankA === null) {
    return { outcome: "b-wins", sourceId: sourceBId, reason: `${sourceBId} is authoritative for ${factType}; ${sourceAId} is not.` };
  }
  if (rankA! < rankB!) {
    return { outcome: "a-wins", sourceId: sourceAId, reason: `${sourceAId} outranks ${sourceBId} for ${factType} (${rankA} vs ${rankB}).` };
  }
  if (rankB! < rankA!) {
    return { outcome: "b-wins", sourceId: sourceBId, reason: `${sourceBId} outranks ${sourceAId} for ${factType} (${rankB} vs ${rankA}).` };
  }
  return {
    outcome: "indeterminate",
    reason: `${sourceAId} and ${sourceBId} hold equal authority (rank ${rankA}) for ${factType}; the rules cannot choose between them.`,
  };
}
