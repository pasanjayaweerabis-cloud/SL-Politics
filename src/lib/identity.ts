/**
 * Javora — name normalisation and identity resolution.
 *
 * Sri Lankan public records write the same person many ways: with and without
 * initials, with Sinhala or Tamil script, with varying English transliterations
 * ("Wickremesinghe" / "Wickramasinghe"), and with honorifics attached. Matching
 * on formatted names is therefore unreliable, and matching on names *alone* is
 * never sufficient to merge two records.
 *
 * The rule this module exists to enforce: two people are merged automatically
 * only on an exact external-ID match from the same source. Name evidence, however
 * strong, produces a review item instead. Wrongly merging two politicians is a
 * far worse failure than leaving a duplicate for a human to resolve.
 */

import type { ExternalIds, LocalizedNames } from "../types/models.ts";

/** Honorifics and post-nominals that carry no identifying information. */
const HONORIFICS = [
  "hon", "honourable", "honorable", "mr", "mrs", "ms", "dr", "prof", "professor",
  "rev", "ven", "sir", "madam", "his excellency", "her excellency", "excellency",
];

/**
 * Reduce a name to a comparable key: lowercase, unaccented, punctuation-free,
 * honorific-free, single-spaced.
 *
 * Deliberately preserves Sinhala and Tamil characters — NFD/diacritic stripping
 * is applied only to Latin marks, so non-Latin scripts survive intact.
 */
export function normaliseName(value: string | null | undefined): string {
  if (!value) return "";
  let text = String(value)
    .normalize("NFD")
    // Strip combining marks only in the Latin range; leave Indic scripts alone.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // Punctuation → space, so "A.K.D." and "A K D" agree. `%` is included too
    // (L-1, docs/security-audit-followup-2026-09-04.md): every normalised
    // term server/api/queries.ts builds a SQL LIKE pattern from goes through
    // this function first, and no real name ever contains a `%`. Without
    // this, `?q=%` reached SQL as `LIKE '%%'` — a full table scan plus
    // COUNT(*) over the party/search joins, on an uncached public endpoint.
    // `_` (SQL's other LIKE metacharacter) was already covered here.
    .replace(/[.,'’\-_/\\()[\]%]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const honorific of HONORIFICS) {
    if (text.startsWith(`${honorific} `)) text = text.slice(honorific.length + 1);
  }
  return text.trim();
}

/** Initials of a name: "Anura Kumara Dissanayake" → "akd". */
export function initialsKey(value: string | null | undefined): string {
  const normalised = normaliseName(value);
  if (!normalised) return "";
  return normalised
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0])
    .join("");
}

/** Monogram for the avatar fallback: first and last initial, uppercased. */
export function initialsOf(name: string | null | undefined): string {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "—";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

/**
 * Every string under which a person should be findable — canonical name,
 * all script variants, aliases, and initials — normalised for comparison.
 */
export function nameKeys(person: {
  canonicalName: string;
  names?: LocalizedNames;
  aliases?: string[];
}): string[] {
  const raw = [
    person.canonicalName,
    person.names?.en,
    person.names?.si,
    person.names?.ta,
    ...(person.aliases ?? []),
  ].filter((v): v is string => Boolean(v));

  const keys = new Set<string>();
  for (const value of raw) {
    const normalised = normaliseName(value);
    if (normalised) keys.add(normalised);
  }
  // Initials are searchable but never sufficient for identity matching.
  const initials = initialsKey(person.canonicalName);
  if (initials.length >= 2) keys.add(initials);

  return [...keys];
}

/* ==========================================================================
   Identity resolution
   ========================================================================== */

export type MatchConfidence = "exact" | "probable" | "uncertain" | "none";

export interface IdentityMatch {
  personId: string | null;
  confidence: MatchConfidence;
  /** Which signals fired, for the review queue to display. */
  signals: string[];
  /**
   * True only for an exact external-ID match. Everything else must go through
   * human review before two records are merged.
   */
  autoMergeable: boolean;
}

export interface IdentityCandidate {
  id: string;
  canonicalName: string;
  names?: LocalizedNames;
  aliases?: string[];
  externalIds?: ExternalIds;
  dateOfBirth?: string | null;
}

/**
 * Resolve an incoming source record against known people.
 *
 * Signal ranking:
 *   exact     — same external ID from the same source. Safe to merge.
 *   probable  — normalised name match corroborated by date of birth.
 *   uncertain — name match alone, or an initials match. Review required.
 *   none      — no signal.
 */
export function resolveIdentity(
  incoming: IdentityCandidate,
  candidates: readonly IdentityCandidate[],
): IdentityMatch {
  // 1. External IDs — the only automatic merge.
  const incomingIds = Object.entries(incoming.externalIds ?? {}).filter(
    (entry): entry is [string, string] => Boolean(entry[1]),
  );
  for (const [source, id] of incomingIds) {
    for (const candidate of candidates) {
      if (candidate.externalIds?.[source] === id) {
        return {
          personId: candidate.id,
          confidence: "exact",
          signals: [`externalId:${source}`],
          autoMergeable: true,
        };
      }
    }
  }

  // 2. Name signals — never sufficient on their own.
  const incomingKeys = new Set(nameKeys(incoming));
  const incomingInitials = initialsKey(incoming.canonicalName);

  let nameMatch: IdentityCandidate | null = null;
  let initialsMatch: IdentityCandidate | null = null;

  for (const candidate of candidates) {
    const keys = nameKeys(candidate);
    if (keys.some((key) => incomingKeys.has(key))) {
      nameMatch = candidate;
      break;
    }
    if (!initialsMatch && incomingInitials.length >= 2 && keys.includes(incomingInitials)) {
      initialsMatch = candidate;
    }
  }

  if (nameMatch) {
    const bothHaveDob = Boolean(incoming.dateOfBirth && nameMatch.dateOfBirth);
    const dobAgrees = bothHaveDob && incoming.dateOfBirth === nameMatch.dateOfBirth;
    const dobConflicts = bothHaveDob && !dobAgrees;

    if (dobConflicts) {
      // Same name, different birth date — likely two different people.
      return {
        personId: nameMatch.id,
        confidence: "uncertain",
        signals: ["name", "dateOfBirth:conflict"],
        autoMergeable: false,
      };
    }
    return {
      personId: nameMatch.id,
      confidence: dobAgrees ? "probable" : "uncertain",
      signals: dobAgrees ? ["name", "dateOfBirth"] : ["name"],
      autoMergeable: false,
    };
  }

  if (initialsMatch) {
    return {
      personId: initialsMatch.id,
      confidence: "uncertain",
      signals: ["initials"],
      autoMergeable: false,
    };
  }

  return { personId: null, confidence: "none", signals: [], autoMergeable: false };
}

/* ==========================================================================
   Search
   ========================================================================== */

/**
 * Build the text blob a person is searched against. Kept separate from
 * rendering so the same index definition can move to a database column
 * (a Postgres `tsvector`) without changing call sites.
 */
export function buildSearchIndex(parts: Array<string | null | undefined>): string {
  return parts
    .filter((v): v is string => Boolean(v))
    .map((v) => normaliseName(v))
    .filter(Boolean)
    .join(" ");
}

/**
 * Match a free-text query against a prepared index.
 *
 * Terms match at TOKEN BOUNDARIES, not as raw substrings. A term matches when
 * some token in the index starts with it, so "wick" finds "Wickremesinghe"
 * while "a" does not match every record that happens to contain the letter.
 *
 * That distinction matters more than it looks. Punctuation is normalised to
 * whitespace, so a query like "A.K.D." becomes the terms a/k/d; under substring
 * matching those appear in virtually every record and the search silently
 * returned everything. Token-prefix matching instead requires a token beginning
 * with each letter, which is the behaviour a reader typing initials expects.
 *
 * Every term must match, so adding terms narrows the result set.
 */
export function matchesQuery(index: string, query: string): boolean {
  const terms = normaliseName(query).split(" ").filter(Boolean);
  if (!terms.length) return true;
  const tokens = index.split(" ").filter(Boolean);
  return terms.every((term) => tokens.some((token) => token.startsWith(term)));
}
