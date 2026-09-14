/**
 * Javora — mechanical name-matching primitives.
 *
 * `matchKey` and `editDistance` were byte-identical in
 * src/data/adapters/cabinetDataset.ts and server/sync/resolveCabinetIdentity.ts
 * (verified before moving: identical logic, differing only in comment
 * wording and whitespace). Both files use them as building blocks inside a
 * larger, DELIBERATELY SEPARATE resolution policy — this file holds only the
 * mechanical string comparison, never the decision.
 *
 * WHAT DID NOT MOVE HERE, and must not:
 *   - cabinetDataset.ts's resolveIdentity() — fuzzy name matching against the
 *     bundled dataset, used when building the static site.
 *   - resolveCabinetIdentity.ts's matchAgainst() — the same policy's DB-side
 *     twin, used by the sync worker.
 * These are two independent implementations of ONE policy (Cabinet Office
 * names carry no external identifier, so matching is name-based and fuzzy),
 * kept as two files because one runs over the bundle and one runs over the
 * database. They must stay separate from Parliament's identity resolution
 * (src/lib/identity.ts), which is external-ID-first and never fuzzy. Sharing
 * these two leaf functions does not merge policies — it only means a fix to
 * how a name is normalised, or how an edit distance is computed, reaches both
 * without being applied twice.
 *
 * NOT unified: MatchConfidence. It is declared separately in
 * src/lib/identity.ts ("exact" | "probable" | "uncertain" | "none") and in
 * server/research/reconcileResearch.ts ("exact" | "strong" | "weak" | "none").
 * These share a name, not a meaning — they are confidence vocabularies for
 * two unrelated domains (Parliament/Cabinet identity vs. research-claim
 * reconciliation) and merging them would force one domain's labels onto the
 * other's decisions, which is a real semantic change and not a mechanical
 * extraction. Left as two independent types.
 */

/** Lowercase, strip honorifics and punctuation, collapse whitespace. */
export function matchKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(hon|dr|prof|mr|mrs|ms|rev|ven|eng|attorney at law)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Levenshtein distance, capped — only small edits are of interest. */
export function editDistance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j]! + 1,
        row[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length]!;
}
