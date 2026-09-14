/**
 * Javora — Parliament member-profile detail: shared shapes and classifiers.
 *
 * The HTML parsing lives server-side; these are the pure pieces BOTH sides
 * need — the row shapes the panes produce, and the judgement calls about what
 * those rows mean. They live here so the browser bundle can classify a stored
 * record without importing a scraper, and so there is exactly one definition
 * of "is this a credential or a job title" in the codebase.
 */

/** One parliament a member actually served in, with that member's own dates. */
export interface ParliamentTermRow {
  /** Verbatim, e.g. "Tenth Parliament of the D.S.R. of Sri Lanka". */
  parliament: string;
  startDate: string | null;
  endDate: string | null;
  /** The source wrote "to date" rather than an end date. */
  ongoing: boolean;
}

/** An office as listed under "Portfolios Held", grouped by parliament. */
export interface PortfolioRow {
  parliament: string;
  title: string;
  startDate: string | null;
}

/** An office as listed under "Ministerial Services", with a date range. */
export interface MinisterialServiceRow {
  title: string;
  startDate: string | null;
  endDate: string | null;
  ongoing: boolean;
}

export interface QualificationRows {
  /** Verbatim entries under "Academic Qualifications". */
  academic: string[];
  /** Verbatim entries under "Professional Qualifications". */
  professional: string[];
}

/**
 * One line of a past member's "Political Career" narrative.
 *
 * `verbatim` is what the source printed; `text` is that line with a leading
 * "YYYY - " stripped, and `year` is set ONLY when the line stated one. A null
 * year means the source gave no date, never that the event is undated in
 * reality.
 */
export interface PoliticalCareerEntry {
  year: string | null;
  text: string;
  verbatim: string;
}

export interface ProfileDetail {
  qualifications: QualificationRows;
  legislativeHistory: ParliamentTermRow[];
  portfoliosHeld: PortfolioRow[];
  ministerialServices: MinisterialServiceRow[];
  /**
   * Present only on past members' profiles, and OPTIONAL so a snapshot taken
   * before this pane was read still parses. A snapshot missing the field is
   * silent about the political career, not asserting the member had none.
   */
  politicalCareer?: PoliticalCareerEntry[];
}



/**
 * Parliament shows this notice in place of the qualifications list when a
 * member submitted their Information Form in Sinhala or Tamil only.
 *
 * It is a statement about the WEBSITE, not about the member. Storing it would
 * put a paragraph of site boilerplate on 35 people's profiles where their
 * degree belongs, and would make "we hold no English record" look like a
 * qualification the person holds.
 */
const BOILERPLATE =
  /please note|included in the website only in the language|information forms?/i;

export function isBoilerplate(value: string): boolean {
  return BOILERPLATE.test(value);
}

/** Values the source uses to mean "nothing recorded". */
export function isAbsentMarker(value: string): boolean {
  return /^(not provided|n\/?a|none|-+|—)$/i.test(value.trim());
}

export type EducationLevel = "school" | "university" | "postgraduate" | "professional" | "other";

/**
 * Award tokens, longest first so "MPhil" is not matched as "MA".
 *
 * This is an explicit table on purpose. The temptation is a rule like
 * "contains 'M' → master's", which would classify "MBBS" (a bachelor's) as a
 * postgraduate degree and quietly overstate a doctor's education on their
 * public record. Anything not listed returns "other" and is reported by the
 * import so the gap is noticed instead of guessed at.
 */
const AWARD_LEVELS: [RegExp, EducationLevel][] = [
  [/^(ph\.?\s?d|d\.?\s?phil|doctor of philosophy)\b/i, "postgraduate"],
  [/^(m\.?\s?phil)\b/i, "postgraduate"],
  [/^(post[\s-]?graduate|pg)\b/i, "postgraduate"],
  [/^(m\.?\s?b\.?\s?b\.?\s?s)\b/i, "university"], // bachelor's, despite the M
  [/^(m\.?\s?d)\b/i, "postgraduate"],
  [/^(ll\.?\s?m)\b/i, "postgraduate"],
  [/^(m\.?\s?b\.?\s?a)\b/i, "postgraduate"],
  [/^(m\.?\s?sc)\b/i, "postgraduate"],
  [/^(m\.?\s?a)\b/i, "postgraduate"],
  [/^(m\.?\s?ed)\b/i, "postgraduate"],
  [/^(m\.?\s?com)\b/i, "postgraduate"],
  [/^(master)\b/i, "postgraduate"],
  [/^(ll\.?\s?b)\b/i, "university"],
  [/^(b\.?\s?sc)\b/i, "university"],
  [/^(b\.?\s?a)\b/i, "university"],
  [/^(b\.?\s?com)\b/i, "university"],
  [/^(b\.?\s?ed)\b/i, "university"],
  [/^(b\.?\s?eng)\b/i, "university"],
  [/^(bachelor)\b/i, "university"],
  [/^(diploma|dip\.)\b/i, "other"],
  [/^(attorney[\s-]?at[\s-]?law|barrister)\b/i, "professional"],
];

/**
 * Classify one verbatim award string into a level for grouping.
 *
 * Returns "other" rather than a guess when the token is unrecognised. Callers
 * are expected to report the "other" bucket, not to hide it.
 */
export function classifyEducationLevel(award: string): EducationLevel {
  const value = award.trim();
  for (const [re, level] of AWARD_LEVELS) if (re.test(value)) return level;
  return "other";
}

/**
 * Does a "Professional Qualifications" entry name a CREDENTIAL, or is it the
 * person's OCCUPATION restated?
 *
 * Parliament files both under one heading. "Attorney-at-Law" is a credential;
 * "University Lecturer", "DOCTOR" and "Businessman" are jobs. Recording a job
 * as a qualification would put "University Lecturer" on a profile as though
 * it were a degree — precisely the confusion this platform is supposed to
 * avoid, and one the source itself does not resolve.
 *
 * Only entries matching the credential table are treated as credentials.
 * Everything else is returned as an occupation restatement, which the profile
 * already shows in its own field and does not repeat.
 */
const CREDENTIAL_PATTERNS: RegExp[] = [
  /attorney[\s-]?at[\s-]?law/i,
  /barrister/i,
  /solicitor/i,
  /\bchartered\b/i,
  /\bcima\b/i,
  /\bacca\b/i,
  /\bca\s?sri\s?lanka\b/i,
  /\bfcma\b/i,
  /\bacma\b/i,
  /\bcpa\b/i,
  /\bfellow\b/i,
  /\bassociate member\b/i,
  /\bmember of the institute\b/i,
  /\bdiploma\b/i,
  /\bcertificate\b/i,
  /\blicenc?iate\b/i,
  /\bregistered (?:medical|nurse|engineer)/i,
];

export function looksLikeCredential(entry: string): boolean {
  return CREDENTIAL_PATTERNS.some((re) => re.test(entry));
}
