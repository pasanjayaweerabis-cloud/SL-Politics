/**
 * Javora — reconciling research-file claims against canonical data.
 *
 * This is where the research files stop being text and start being either
 * corroboration, a conflict, or a new record — and where most of them turn
 * out to be none of the three.
 *
 * THE ORDER OF OPERATIONS MATTERS
 *
 * A claim is compared against what the AUTHORITATIVE source already says
 * before anything else happens to it. That ordering is the whole design:
 *
 *   Parliament states it too      → `corroborates`. Nothing is written. The
 *                                   canonical record already exists and comes
 *                                   from a better source; the research file
 *                                   agreeing with it adds no evidence.
 *
 *   Parliament contradicts it     → `conflict`. Nothing is overwritten. Both
 *                                   claims survive and a human decides.
 *
 *   Parliament is silent          → `promoted`, at SECONDARY_CORROBORATED and
 *                                   never higher, carrying the file, line and
 *                                   verbatim sentence it came from.
 *
 *   Nobody is named               → `unmatched`. A claim about a person Javora
 *                                   cannot identify is not a claim about
 *                                   anyone.
 *
 * WHY SO MUCH IS DISCARDED
 *
 * Once Parliament's own Qualifications pane was read, most of what the
 * research files offer on education became redundant: the institution states
 * it directly. That is the correct outcome, not a failure of the import — the
 * files were compiled without access to the pane, and where they agree with
 * it they confirm the reading rather than extend it.
 */

import type { ResearchClaim } from "./parseResearchFiles.ts";
import { extractCredentials } from "./extractCredentials.ts";

/* ==========================================================================
   Person matching
   ========================================================================== */

export type MatchConfidence = "exact" | "strong" | "weak" | "none";

export interface CandidatePerson {
  id: string;
  canonicalName: string;
  aliases: string[];
}

/** Lowercase, strip honorifics and punctuation, collapse spaces. */
export function normaliseForMatch(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(hon|dr|prof|mr|mrs|ms|rev|ven|major|general|colonel|rtd|m\.?p)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Initials-and-surname form: "a.h.m.h. abayarathna" → tokens + surname. */
function tokensOf(name: string): string[] {
  return normaliseForMatch(name).split(" ").filter(Boolean);
}

export interface MatchResult {
  personId: string | null;
  confidence: MatchConfidence;
  method: string;
}

/**
 * Match a research-file name to a canonical person.
 *
 * Never creates a person. The research files are not an identity authority,
 * and a name they mention that Javora cannot place is far more likely to be a
 * spelling variant, a National List member listed differently, or an error
 * than a 226th member of a 225-seat parliament.
 *
 * "Weak" exists so that a plausible-but-unproven match is recorded as needing
 * review rather than silently accepted or silently dropped.
 */
export function matchPerson(name: string, people: CandidatePerson[]): MatchResult {
  const target = normaliseForMatch(name);
  if (!target) return { personId: null, confidence: "none", method: "empty-name" };

  for (const person of people) {
    if (normaliseForMatch(person.canonicalName) === target) {
      return { personId: person.id, confidence: "exact", method: "canonical-name" };
    }
  }
  for (const person of people) {
    if (person.aliases.some((a) => normaliseForMatch(a) === target)) {
      return { personId: person.id, confidence: "exact", method: "alias" };
    }
  }

  // Every token of one name present in the other, in any order. Catches
  // "Archchuna Ramanathan" against "Ramanathan Archchuna".
  const targetTokens = tokensOf(name);

  // The DIRECTION of the subset matters, and treating both alike overstates
  // confidence in one of them.
  //
  //   research ⊂ canonical ("Harini Amarasuriya" vs "Harini Amarasuriya, M.P.")
  //     — the file names a subset of what Parliament names. Strong.
  //
  //   canonical ⊂ research ("Amila Prasad" vs "Amila Prasad Siriwardana")
  //     — the file adds a name Parliament does not carry. That is usually the
  //     same person under a fuller name, but it is also exactly what a
  //     confusion between two members of one family looks like, so it goes to
  //     review rather than being accepted silently.
  const researchInCanonical = people.filter((p) => {
    const t = tokensOf(p.canonicalName);
    return targetTokens.length > 0 && targetTokens.every((x) => t.includes(x));
  });
  if (researchInCanonical.length === 1) {
    return { personId: researchInCanonical[0]!.id, confidence: "strong", method: "token-subset" };
  }
  if (researchInCanonical.length > 1) {
    return { personId: null, confidence: "weak", method: "ambiguous-token-subset" };
  }

  const canonicalInResearch = people.filter((p) => {
    const t = tokensOf(p.canonicalName);
    return t.length > 0 && t.every((x) => targetTokens.includes(x));
  });
  if (canonicalInResearch.length === 1) {
    return {
      personId: canonicalInResearch[0]!.id,
      confidence: "weak",
      method: "research-name-has-extra-tokens",
    };
  }
  if (canonicalInResearch.length > 1) {
    return { personId: null, confidence: "weak", method: "ambiguous-token-superset" };
  }

  // Surname (longest token) shared and nothing else contradicting.
  const surname = [...targetTokens].sort((a, b) => b.length - a.length)[0] ?? "";
  if (surname.length >= 5) {
    const weak = people.filter((p) => tokensOf(p.canonicalName).includes(surname));
    if (weak.length === 1) {
      return { personId: weak[0]!.id, confidence: "weak", method: "surname-only" };
    }
  }
  return { personId: null, confidence: "none", method: "no-candidate" };
}

/* ==========================================================================
   Claim disposition
   ========================================================================== */

export type Disposition = "corroborates" | "promoted" | "conflict" | "rejected" | "unmatched";

export interface CanonicalEducationLike {
  qualification: string | null;
  institution: string | null;
  sourceText: string | null;
}

export interface DispositionResult {
  disposition: Disposition;
  note: string;
  /** Credentials worth promoting, when the disposition is "promoted". */
  credentials: ReturnType<typeof extractCredentials>;
  /** A career record worth promoting, for employment and public service. */
  entity?: StructuredEntity;
}

/** Loose comparison of two award strings: same award, written differently. */
export function sameAward(a: string, b: string): boolean {
  const key = (s: string) =>
    s.toLowerCase()
      .replace(/\(.*?\)/g, " ")
      .replace(/[^a-z]+/g, "")
      // Common spellings of the same award.
      .replace(/^bachelorofscience$/, "bsc")
      .replace(/^bachelorofarts$/, "ba")
      .replace(/^bachelorofcommerce$/, "bcom")
      // "Bachelor of Medicine" is the spelled-out MBBS. Missing this pairing
      // makes the research file's phrasing look like a SECOND degree and
      // duplicates a doctor's medical qualification on their profile.
      .replace(/^bachelorofmedicine$/, "mbbs")
      .replace(/^doctorofphilosophy$/, "phd")
      .replace(/^masterofscience$/, "msc")
      .replace(/^masterofarts$/, "ma");
  const ka = key(a), kb = key(b);
  if (!ka || !kb) return false;
  return ka === kb || ka.startsWith(kb) || kb.startsWith(ka);
}

const EDUCATION_FIELDS = new Set(["school", "university", "postgraduate", "certification"]);

/* ---------------------------------------------- structured entity parsing */

export interface StructuredEntity {
  organisation: string | null;
  role: string | null;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
}

/** A date the file states outright. "CURRENT" is a status, not a date. */
function entityDate(value: string | null): string | null {
  if (!value) return null;
  const m = /(\d{4}(?:-\d{2}(?:-\d{2})?)?)/.exec(value);
  return m ? m[1]! : null;
}

/**
 * Parse the Gemini file's "Key: Value; Key: Value" entity rows.
 *
 * Returns null when the row names no organisation. A service or employment
 * record whose organisation is missing says only that a person did something
 * somewhere, which is not a record of anything — and the files do produce
 * these, because their own "Organization: NOT PUBLICLY VERIFIED" collapses to
 * a bare key.
 */
export function parseStructuredEntity(value: string): StructuredEntity | null {
  const fields: Record<string, string> = {};
  for (const part of value.split(";")) {
    const kv = /^\s*([A-Za-z/ ]+?):\s*(.+)$/.exec(part);
    if (kv) fields[kv[1]!.trim().toLowerCase()] = kv[2]!.trim();
  }
  const organisation = fields["organization"] ?? fields["organisation"] ?? null;
  if (!organisation) return null;
  return {
    organisation,
    role: fields["position"] ?? fields["role"] ?? null,
    startDate: entityDate(fields["start"] ?? null),
    // "End: CURRENT" means no end date, not an end date of "CURRENT".
    endDate: /current/i.test(fields["end"] ?? "") ? null : entityDate(fields["end"] ?? null),
    description: fields["description"] ?? null,
  };
}

/** Fields promoted as career records rather than education. */
const CAREER_FIELDS = new Set(["employment", "public-service"]);

/**
 * Decide what to do with one matched claim.
 *
 * `canonicalEducation` is what Parliament already publishes for this person.
 */
export function disposeClaim(
  claim: ResearchClaim,
  canonicalEducation: CanonicalEducationLike[],
): DispositionResult {
  if (CAREER_FIELDS.has(claim.field)) {
    // Employment and institutional service are the one area where these files
    // genuinely extend the record: Parliament publishes offices held, not
    // jobs worked or caucuses chaired. Only STRUCTURED rows are promoted —
    // prose like "The Manthri profile lists him as a Teacher" names no
    // employer, no post and no dates, and turning it into an employment
    // record would manufacture a job history nobody published.
    const entity = parseStructuredEntity(claim.value);
    if (!entity) {
      return {
        disposition: "rejected",
        note: "No organisation named; an employment or service record without one is not a record of anything.",
        credentials: [],
      };
    }
    return {
      disposition: "promoted",
      note: claim.tier === 1
        ? `Named by an official source (${claim.citedSource ?? "Tier 1"}); Parliament's member panes do not carry this category, so it is new rather than duplicated.`
        : `Attested at Tier ${claim.tier}${claim.citedSource ? ` (${claim.citedSource})` : ""}; recorded as secondary-corroborated and never as verified.`,
      credentials: [],
      entity,
    };
  }

  if (!EDUCATION_FIELDS.has(claim.field)) {
    // Political, electoral, party and timeline claims are staged but never
    // promoted. Parliament's own panes already carry the political history
    // WITH dates, which these files mostly lack; and the vote counts are
    // attributed to a news aggregator for a figure the Election Commission is
    // the authority for. Neither improves on canonical data, and importing
    // them would let a weaker source restate a stronger one's facts.
    return {
      disposition: "rejected",
      note: `Field "${claim.field}" is not promoted: an authoritative source already covers it with better provenance, or the claim's tier (${claim.tier}) is too weak to add to canonical data.`,
      credentials: [],
    };
  }

  const credentials = extractCredentials(claim.value);
  if (credentials.length === 0) {
    return {
      disposition: "rejected",
      note: "No affirmative credential could be extracted; the text is an absence statement, a cross-reference, or a hedged claim.",
      credentials: [],
    };
  }

  const corroborated = credentials.filter((c) =>
    canonicalEducation.some((e) =>
      (e.qualification && sameAward(c.award, e.qualification)) ||
      (e.sourceText && sameAward(c.award, e.sourceText))));

  const novel = credentials.filter((c) => !corroborated.includes(c));

  if (novel.length === 0) {
    return {
      disposition: "corroborates",
      note: `Parliament already publishes ${corroborated.map((c) => c.award).join(", ")}. The research file agrees; canonical data is unchanged and keeps its Tier 1 source.`,
      credentials: [],
    };
  }

  if (claim.tier <= 2) {
    return {
      disposition: "promoted",
      note: `Not present in Parliament's record; cited to a Tier ${claim.tier} source.`,
      credentials: novel,
    };
  }

  return {
    disposition: "promoted",
    note: `Not present in Parliament's record. Attested only at Tier ${claim.tier}${claim.citedSource ? ` (${claim.citedSource})` : ""}, so it is recorded as secondary-corroborated and never as verified.`,
    credentials: novel,
  };
}
