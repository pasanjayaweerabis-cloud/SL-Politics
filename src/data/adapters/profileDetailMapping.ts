/**
 * Javora — Parliament profile panes → canonical records.
 *
 * Pure mapping. No network, no dates-of-today, no I/O: given the rows a
 * profile page published, produce the education, position and service records
 * they justify — and nothing they do not.
 *
 * THREE RULES THIS MODULE ENFORCES
 *
 * 1. VERBATIM SURVIVES CLASSIFICATION. Every record keeps the source string it
 *    came from. Deciding that "MBBS" is a bachelor's degree is a judgement;
 *    the string is the evidence. Keeping both means a wrong call is auditable
 *    instead of invisible.
 *
 * 2. AN OCCUPATION IS NOT A QUALIFICATION. Parliament files "University
 *    Lecturer" and "Attorney-at-Law" under one "Professional Qualifications"
 *    heading. The first is a job, already recorded as `profession`; the second
 *    is a credential. Only credentials become education records — otherwise a
 *    profile shows a job title where a degree should be.
 *
 * 3. AN EXAMINATION IS NOT A RESULT. Parliament lists "G.C.E. (A/L)" among
 *    qualifications. That establishes the person sat and holds the
 *    qualification; it says nothing about subjects or grades, and no grade is
 *    ever derived from it.
 */

import {
  RoleType, VerificationState,
  type Education, type Position, type Claim,
  type RoleTypeValue, type DateString,
} from "../../types/models.ts";
import {
  classifyEducationLevel, looksLikeCredential, isBoilerplate,
  type ParliamentTermRow, type MinisterialServiceRow,
} from "../../lib/parliamentDetail.ts";

/* ==========================================================================
   Education
   ========================================================================== */

/**
 * G.C.E. entries as Parliament writes them, in all their variety:
 * "G.C.E.O/L", "G.C.E. (A/L)", "Advanced Level", "Passed GCE Advanced Level.",
 * "GCE A/L (Commerce)".
 */
const AL_PATTERN = /\b(?:g\.?\s?c\.?\s?e\.?)?\s*\(?\s*(?:a\s*\/\s*l|advanced\s+level)\s*\)?/i;
const OL_PATTERN = /\b(?:g\.?\s?c\.?\s?e\.?)?\s*\(?\s*(?:o\s*\/\s*l|ordinary\s+level)\s*\)?/i;

/** A stream named in parentheses: "GCE A/L (Commerce)". */
const STREAM_PATTERN = /\((commerce|arts|bio(?:logical)?\s*science|physical\s*science|maths?|science|technology|biology)\)/i;

/** A four-digit year the source states outright. Never inferred. */
const YEAR_PATTERN = /\b(19\d{2}|20\d{2})\b/;

export interface EducationDraft {
  educationType: Education["educationType"];
  institution: string | null;
  qualification: string | null;
  field: string | null;
  examLevel: "ol" | "al" | null;
  stream: string | null;
  startDate: DateString | null;
  endDate: DateString | null;
  sourceText: string;
}

/**
 * Does this entry name an examination rather than an award?
 *
 * Order matters: "A/L" must be tested before "O/L", because an entry reading
 * "G.C.E. A/L" contains no "O/L" but a sloppier pattern could still match on
 * the "L". Both patterns are anchored on the level token itself.
 */
function examLevelOf(entry: string): "ol" | "al" | null {
  // An entry that mentions a degree alongside the exam is a degree entry that
  // happens to mention schooling; classify on the strongest award present.
  if (/\b(BA|BSc|B\.?\s?Sc|LLB|MBBS|MSc|MBA|PhD|Diploma|Bachelor|Master)\b/i.test(entry)
      && !/^\s*(?:g\.?\s?c\.?\s?e|passed)/i.test(entry)) {
    return null;
  }
  if (AL_PATTERN.test(entry)) return "al";
  if (OL_PATTERN.test(entry)) return "ol";
  return null;
}

/** Index of the first comma not inside parentheses, or -1. */
export function topLevelCommaIndex(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) return i;
  }
  return -1;
}

/** Turn one verbatim academic-qualification entry into an education draft. */
export function educationFromAcademicEntry(entry: string): EducationDraft | null {
  const text = entry.trim();
  if (!text || isBoilerplate(text)) return null;

  const examLevel = examLevelOf(text);
  if (examLevel) {
    const stream = STREAM_PATTERN.exec(text)?.[1] ?? null;
    const year = YEAR_PATTERN.exec(text)?.[1] ?? null;
    return {
      educationType: "school",
      institution: null,
      qualification: examLevel === "al" ? "G.C.E. Advanced Level" : "G.C.E. Ordinary Level",
      field: null,
      examLevel,
      stream,
      // A year stated on the entry is the year of the examination.
      startDate: null,
      endDate: year,
      sourceText: text,
    };
  }

  // A trailing or embedded institution, only when the source names a body.
  const institution = institutionIn(text);

  // "PHD, Social Anthropology" — a comma-separated field is unambiguous.
  //
  // The comma must be OUTSIDE any parentheses. "MSc Project Management
  // (Cardiff, UK)" carries a comma inside a parenthetical, and splitting there
  // produces the award "MSc Project Management (Cardiff" with a field of
  // "UK)" — a mangled degree and an invented subject.
  const splitAt = topLevelCommaIndex(text);
  const usable = splitAt > 1 && splitAt < text.length - 2 && !institution;
  const field = usable ? text.slice(splitAt + 1).trim() : null;
  const award = usable ? text.slice(0, splitAt).trim() : text;

  return {
    educationType: classifyEducationLevel(award),
    institution,
    // The award stays verbatim. Splitting "BA (Hons) Sociology" into award and
    // field would require deciding whether "(Hons)" is a field, which the
    // source does not say.
    qualification: award,
    field,
    examLevel: null,
    stream: null,
    startDate: null,
    endDate: null,
    sourceText: text,
  };
}

const INSTITUTION_WORDS =
  /\b(University|College|Institute|Academy|Open University|Law College|Polytechnic)\b/i;

/**
 * Pull an institution out of an entry, but only when it is unmistakable.
 *
 * "MSc Project Management (Cardiff, UK)" names a place, not a body, and is
 * left alone. "Bachelor of Science (Eastern University of Sri Lanka)" names a
 * body. Guessing wrong here attributes a real person's degree to the wrong
 * institution, so anything short of an explicit institution word is skipped.
 */
export function institutionIn(entry: string): string | null {
  const paren = /\(([^)]{3,80})\)/.exec(entry);
  if (paren && INSTITUTION_WORDS.test(paren[1]!)) return paren[1]!.trim();

  // "Diploma in Linguistic University of Kelaniya" — trailing institution
  // with no punctuation, which this source does produce.
  const trailing = /\b((?:The\s+)?(?:Open\s+)?University\s+of\s+[A-Z][A-Za-z]+|[A-Z][A-Za-z]+\s+(?:University|College)(?:\s+of\s+Sri\s+Lanka)?)\s*$/.exec(entry);
  if (trailing) return trailing[1]!.trim();
  return null;
}

/**
 * Professional-qualification entries that are genuine credentials.
 *
 * Entries that merely restate the person's occupation are dropped: they carry
 * no information the profile does not already show in its Profession field,
 * and displaying "Full Time Politics" under Certifications would be absurd as
 * well as wrong.
 */
export function educationFromProfessionalEntry(entry: string): EducationDraft | null {
  const text = entry.trim();
  if (!text || isBoilerplate(text) || !looksLikeCredential(text)) return null;
  return {
    educationType: "professional",
    institution: institutionIn(text),
    qualification: text,
    field: null,
    examLevel: null,
    stream: null,
    startDate: null,
    endDate: null,
    sourceText: text,
  };
}

/* ==========================================================================
   Positions from Legislative History
   ========================================================================== */

/**
 * Ordinal names Parliament uses for its own terms, mapped to a number so the
 * profile can order terms without parsing English ordinals at render time.
 */
const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
  fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
};

export function parliamentOrdinal(name: string): number | null {
  const first = name.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return ORDINALS[first] ?? null;
}

export interface PositionDraft {
  title: string;
  roleType: RoleTypeValue;
  institution: string;
  ministry: string | null;
  districtId: string | null;
  startDate: DateString | null;
  endDate: DateString | null;
  currentAsOf: DateString | null;
  /** What the source said about the end — see Position.endStatus. */
  endStatus: "ongoing" | "dated" | "not-recorded";
  precedence: number;
  sourceText: string;
  /** Which parliament this belongs to, where the source groups it. */
  parliament: string | null;
}

/**
 * One Member-of-Parliament position per term actually served.
 *
 * These dates are PER MEMBER, not per parliament: two members of the same
 * parliament carry different start dates on this source, which is what makes
 * them real service records rather than a restatement of the term's calendar.
 *
 * A term the source marks "to date" gets a start date and NO end date, which
 * is exactly what `isCurrent()` needs; `currentAsOf` is left null because a
 * real start date makes the dated-observation fallback unnecessary.
 */
export function positionsFromTerms(
  terms: ParliamentTermRow[],
  districtId: string | null,
  precedence: number,
): PositionDraft[] {
  return terms.map((term) => ({
    title: "Member of Parliament",
    roleType: RoleType.MEMBER_OF_PARLIAMENT,
    institution: "Parliament of Sri Lanka",
    ministry: null,
    // Only the current term can be attributed to the current district; a
    // member may have represented somewhere else in an earlier parliament and
    // this source does not say where.
    districtId: term.ongoing ? districtId : null,
    startDate: term.startDate,
    endDate: term.endDate,
    currentAsOf: null,
    endStatus: term.ongoing ? "ongoing" : term.endDate ? "dated" : "not-recorded",
    precedence,
    sourceText: `${term.parliament}${term.startDate ? ` (${term.startDate} - ${term.endDate ?? "to date"})` : ""}`,
    parliament: term.parliament,
  }));
}

/**
 * Ministerial and parliamentary offices, split into one position per office.
 *
 * Parliament publishes these as compound strings — "Prime Minister and
 * Minister of Education, Higher Education and Vocational Education" is one
 * line describing two offices. Keeping it as one record would make the
 * platform unable to answer "who is the Minister of Education", which is the
 * whole point of modelling offices separately. Splitting is delegated to the
 * caller's existing `splitCompoundRole`, which is already the single place
 * that logic lives.
 */
export function positionsFromServices(
  services: MinisterialServiceRow[],
  splitCompoundRole: (title: string | null) => string[],
  roleTypeForOffice: (title: string) => RoleTypeValue,
  ministryFromTitle: (title: string) => string | null,
  precedenceFor: (roleType: RoleTypeValue) => number,
): PositionDraft[] {
  const out: PositionDraft[] = [];
  for (const service of services) {
    for (const title of splitCompoundRole(service.title)) {
      const roleType = roleTypeForOffice(title);
      const ministerial =
        roleType === RoleType.CABINET_MINISTER || roleType === RoleType.STATE_MINISTER ||
        roleType === RoleType.DEPUTY_MINISTER || roleType === RoleType.PRIME_MINISTER;
      out.push({
        title,
        roleType,
        institution: ministerial ? "Cabinet of Ministers" : "Parliament of Sri Lanka",
        ministry: ministryFromTitle(title),
        districtId: null,
        startDate: service.startDate,
        endDate: service.endDate,
        currentAsOf: null,
        // "to date" means still held. A start with no end means the source
        // never said when it finished — not that it never finished.
        endStatus: service.ongoing ? "ongoing" : service.endDate ? "dated" : "not-recorded",
        precedence: precedenceFor(roleType),
        sourceText: service.title,
        parliament: null,
      });
    }
  }
  return out;
}

/**
 * The claim state for anything read from a Parliament profile pane.
 *
 * SOURCE_LINKED, never VERIFIED: the institution published it and Javora
 * links to the exact page, but nobody has confirmed Javora read that page
 * correctly. That confirmation is what `verified` means here, and it has not
 * happened.
 */
export function parliamentClaim(evidenceId: string): Claim {
  return {
    verification: VerificationState.SOURCE_LINKED,
    evidenceIds: [evidenceId],
    verifiedAt: null,
  };
}
