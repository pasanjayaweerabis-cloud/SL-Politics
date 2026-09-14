/**
 * Javora — curated identity assertions.
 *
 * WHY THIS FILE EXISTS
 *
 * `cabinetDataset.ts` matches Cabinet Office names onto Parliament people
 * mechanically: exact key, token-subset, near-spelling. That resolver is
 * deliberately conservative, and it must stay that way. Measured against the
 * live dataset:
 *
 *   Anura Kumara Dissanayake  vs  Anura Dissanayaka     distance 8, tokens 3v2
 *   Anura Kumara Dissanayake  vs  Thanura Dissanayake   distance 8, tokens 3v2
 *   Anura Dissanayaka         vs  Thanura Dissanayake   distance 3, tokens 2v2
 *
 * The first pair is one human — the sitting President, whose Parliament record
 * carries his date of birth, his JVP career and the 2004–05 Agriculture
 * portfolio. The second and third pairs are two different men. Every
 * mechanical measure ranks the FALSE pair at least as close as the true one,
 * so no threshold exists that merges the President without also merging two
 * unrelated members. The resolver is not too strict; the names are genuinely
 * ambiguous, and the distinguishing evidence (a birth date, a portfolio, a
 * seat that ends the day before an inauguration) is not in the name at all.
 *
 * So the judgement is made HERE, by a person, once, in writing — not by
 * loosening a distance threshold until the right answer falls out and three
 * wrong ones come with it. This is the mechanism CLAUDE.md's rule points at:
 * "Identity never auto-merges on names alone — only an exact external-id
 * match. Uncertain matches go to the identity-review queue." An entry below is
 * a human resolving one queued review and signing their reasoning.
 *
 * RULES FOR ADDING AN ENTRY
 *
 *   · `evidence` is required prose naming the facts that establish the
 *     identity. "The names look similar" is not evidence — that is precisely
 *     what the resolver already tested and rejected.
 *   · Merging changes a published URL, and slugs are permanent. Whatever slug
 *     the record stops publishing under goes in `retiredSlugs`, stays
 *     resolvable, and declares the new slug canonical. A retired slug is never
 *     deleted and never reused for a different person.
 *   · An entry is a claim about the world that outlives its author. It is
 *     reviewable because it is written down; keep it that way.
 */

/** One asserted identity, resolving one entry in the identity-review queue. */
export interface IdentityOverride {
  /**
   * The Cabinet Office name that failed to resolve, exactly as that source
   * publishes it. Matched on the same normalised key the resolver uses.
   */
  cabinetName: string;
  /** The Parliament person this name refers to. */
  personId: string;
  /** The name the merged record publishes under. */
  canonicalName: string;
  /** The slug the merged record publishes under. */
  slug: string;
  /**
   * Slugs this person previously published under. Kept resolvable forever;
   * each declares `slug` above as its canonical URL.
   */
  retiredSlugs: string[];
  /** The facts establishing the identity. Never "the names are similar". */
  evidence: string;
}

export const IDENTITY_OVERRIDES: readonly IdentityOverride[] = [
  {
    cabinetName: "Anura Kumara Dissanayake",
    personId: "parliament:112",
    canonicalName: "Anura Kumara Dissanayake",
    slug: "anura-kumara-dissanayake",
    retiredSlugs: ["anura-dissanayaka"],
    evidence:
      "The Cabinet Office publishes the President as “Anura Kumara Dissanayake”; " +
      "Parliament's past-members directory publishes the same man as “Anura Dissanayaka” " +
      "(parliament:112). Four independent facts establish one identity: the Parliament " +
      "record's date of birth is 1968-11-24; its political career reads “Engage in full " +
      "time Politics of the Janatha Vimukti Peramuna”; it records Minister of Agriculture, " +
      "Livestock, Land and Irrigation from 2004-04-28 to 2005-06-16, the portfolio Anura " +
      "Kumara Dissanayake held in that government; and its parliamentary seat ends " +
      "2024-09-22, the day before he was sworn in as President. The Cabinet Office " +
      "publishes no identifiers, so no external-id match was available to the resolver, " +
      "and the two spellings differ by both an added middle name and a transliterated " +
      "final vowel — which together defeat token-subset and near-spelling matching alike. " +
      "The Cabinet Office spelling is adopted as canonical because it is the fuller form " +
      "and the one the office of the President publishes under.",
  },
];

const byCabinetKey = new Map<string, IdentityOverride>();
const byPersonId = new Map<string, IdentityOverride>();
const byRetiredSlug = new Map<string, IdentityOverride>();

for (const override of IDENTITY_OVERRIDES) {
  byCabinetKey.set(normaliseOverrideKey(override.cabinetName), override);
  byPersonId.set(override.personId, override);
  for (const retired of override.retiredSlugs) byRetiredSlug.set(retired, override);
}

/**
 * The same normalisation the Cabinet resolver keys on, restated locally.
 *
 * Importing `matchKey` here would make this module depend on the matching
 * policy it deliberately sits outside of: an override is an assertion about
 * two identifiers, not a fuzzy comparison, and it must not start behaving
 * differently because the resolver's normalisation was tuned.
 */
function normaliseOverrideKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** The assertion for a Cabinet Office name, or null when none was made. */
export function overrideForCabinetName(name: string): IdentityOverride | null {
  return byCabinetKey.get(normaliseOverrideKey(name)) ?? null;
}

/** The assertion naming this person as its target, or null. */
export function overrideForPersonId(personId: string): IdentityOverride | null {
  return byPersonId.get(personId) ?? null;
}

/** The assertion that retired this slug, or null when the slug is not retired. */
export function overrideForRetiredSlug(slug: string): IdentityOverride | null {
  return byRetiredSlug.get(slug) ?? null;
}
