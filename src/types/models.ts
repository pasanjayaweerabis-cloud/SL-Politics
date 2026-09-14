/**
 * Javora — canonical domain model.
 *
 * These types are the schema contract between the data layer and everything
 * else. They are deliberately written so that the current in-memory
 * demonstration repository and a future PostgreSQL/API backend can satisfy the
 * same shapes: nothing here assumes records are local, static, or complete.
 *
 * Design rules encoded in these types:
 *
 *  1. A PERSON is separate from the offices they hold. Positions, affiliations,
 *     qualifications and events are related records keyed by `personId`, never
 *     fields flattened onto the person.
 *
 *  2. Nothing time-dependent is stored. `current`, `age`, `tenure` are absent
 *     from stored shapes by design — they are derived (see `lib/date.ts` and
 *     `lib/positions.ts`). A stored `current: true` competing with an `endDate`
 *     is the exact class of bug this model forbids.
 *
 *  3. Dates carry explicit precision. A year-only date is not silently widened
 *     into a false exact date. See `PrecisionDate`.
 *
 *  4. Evidence is a first-class record, not a string id. A claim points at the
 *     specific document/page/locator that supports it, not merely at an
 *     institution's homepage.
 *
 *  5. History is append-only. Leaving office writes an `endDate` onto the
 *     existing position and adds a new one; it never rewrites the old record.
 */

/* ==========================================================================
   Dates
   ========================================================================== */

/**
 * How precisely a date is actually known. Sri Lankan public records routinely
 * give only a year or a month, and the interface must not invent a day.
 */
export type DatePrecision = "year" | "month" | "day";

/**
 * A partial ISO date string, precision-tagged by its own length:
 *   "1968-11-24" day · "2024-09" month · "2000" year · null not recorded.
 *
 * Stored as a string so records stay diff-friendly and human-auditable; parsed
 * into `ParsedDate` for any arithmetic.
 */
export type DateString = string;

export interface ParsedDate {
  year: number;
  /** Null when the source recorded only a year. */
  month: number | null;
  /** Null unless the source recorded a full calendar date. */
  day: number | null;
  precision: DatePrecision;
}

/**
 * The result of any duration calculation (age, tenure).
 *
 * `exact`   — both endpoints were precise enough to name a single number.
 * `range`   — precision permits only a bounded range, e.g. "57 or 58".
 * `unknown` — an endpoint is missing entirely.
 *
 * There is deliberately no way to express "probably 57": a range is reported as
 * a range, and the UI renders it as one.
 */
export type Duration =
  | { kind: "exact"; years: number }
  | { kind: "range"; min: number; max: number }
  | { kind: "unknown"; reason: DurationUnknownReason };

export type DurationUnknownReason =
  | "no-start-date"
  | "no-end-date"
  | "invalid-date"
  | "negative-duration";

/* ==========================================================================
   Verification
   ========================================================================== */

/**
 * How well-attested a claim is. Ordered from weakest to strongest confidence,
 * but note these are states, not a scale to be averaged.
 *
 * The critical distinction this enum exists to preserve: "we have not found a
 * record" (`UNAVAILABLE`) is never the same as "no such record exists".
 */
export const VerificationState = {
  /** Hand-entered sample used to exercise the interface. Never a truth claim. */
  DEMONSTRATION: "demonstration",
  /** Real claim, entered without a source reference yet. */
  UNVERIFIED: "unverified",
  /** Points at a specific source document, but no human/pipeline check yet. */
  SOURCE_LINKED: "source-linked",
  /** Matched against a named authoritative source on a recorded date. */
  VERIFIED: "verified",
  /**
   * Attested only by non-authoritative sources: news reports, biography
   * aggregators, research compilations.
   *
   * Distinct from SOURCE_LINKED, which points at a specific document from a
   * source that has standing. A newspaper reporting a minister's degree and
   * Parliament publishing it are not the same kind of evidence, and collapsing
   * them lets the weaker one inherit the stronger one's authority.
   *
   * Distinct from UNVERIFIED as well: something IS attested here. It is simply
   * not attested by anyone official, and the interface says so in those words.
   */
  SECONDARY_CORROBORATED: "secondary-corroborated",
  /** Two or more sources disagree. Surfaced, never silently resolved. */
  CONFLICTING: "conflicting",
  /** Queued for human review (new ingest, lapsed check, low-confidence match). */
  PENDING_REVIEW: "pending-review",
  /** No authoritative record located. A gap shown as a gap. */
  UNAVAILABLE: "unavailable",
} as const;

export type VerificationStateValue =
  (typeof VerificationState)[keyof typeof VerificationState];

/** Presentation metadata for a verification state. */
export interface VerificationPresentation {
  label: string;
  icon: string;
  modifier: string;
  description: string;
}

/* ==========================================================================
   Sources and evidence
   ========================================================================== */

export type SourceType =
  | "legislature"
  | "election-authority"
  | "executive"
  | "gazette"
  | "ministry"
  | "academic"
  | "statistical"
  | "other-official";

/**
 * Whether Javora's own ingestion pipeline reads this source. Purely a
 * statement about Javora's infrastructure — never about the institution.
 *
 * `manual-import` exists because none of the other four could describe the
 * true state of the Parliament connector: a real, working connector that has
 * genuinely retrieved the source, but which a person runs by hand. Calling
 * that "live" would claim an automation that does not exist; calling it
 * "not-connected" would deny a retrieval that demonstrably happened.
 */
export type SyncState =
  | "not-connected"
  | "manual-import"
  | "scheduled"
  | "live"
  | "failing";

/**
 * A class of fact. Source authority is per-fact-type, not global: Parliament is
 * authoritative for parliamentary membership but not for election returns, and
 * the Election Commission is the reverse. `AUTHORITY_RULES` encodes this.
 */
export type FactType =
  | "parliamentary-membership"
  | "election-result"
  | "executive-appointment"
  | "portfolio-assignment"
  | "gazette-instrument"
  | "party-affiliation"
  | "qualification"
  | "biographical";

export interface InstitutionalSource {
  id: string;
  name: string;
  institution: string;
  sourceType: SourceType;
  category: string;
  url: string;
  description: string;
  /** Fact types for which this source is treated as primary. */
  authoritativeFor: FactType[];
  syncState: SyncState;
  syncLabel: string;
  /** Null until a real check runs. Never back-filled to look active. */
  lastCheckedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  verification: VerificationStateValue;
}

/**
 * Evidence binding one specific claim to one specific document.
 *
 * A record whose evidence names only `sourceId` is `UNVERIFIED`, not
 * `SOURCE_LINKED` — pointing at an institution is not pointing at a document.
 * `hasPreciseEvidence()` in `lib/evidence.ts` enforces that distinction.
 */
export interface SourceEvidence {
  id: string;
  sourceId: string;
  entityType: EntityType;
  entityId: string;
  /** Which field of the entity this evidence supports. */
  fieldName: string | null;
  /** Exact document/page URL, not the institution homepage. */
  sourceUrl: string | null;
  documentTitle: string | null;
  publishedAt: DateString | null;
  /** When Javora fetched it. Null until a fetch actually happens. */
  retrievedAt: string | null;
  /** e.g. "Page 12, paragraph 4". Null when not established — never invented. */
  locator: string | null;
  /** The source's own record identifier, where one exists. */
  sourceRecordId: string | null;
  contentHash: string | null;
  notes: string | null;
}

/** Raw fetched content, retained so changes can be detected and audited. */
export interface SourceSnapshot {
  id: string;
  sourceId: string;
  retrievedAt: string;
  url: string;
  contentHash: string;
  /** Pointer into blob storage; snapshots are not held in the database. */
  storageReference: string;
  parserVersion: string;
}

export type EntityType =
  | "person"
  | "position"
  | "position-event"
  | "party"
  | "affiliation"
  | "election"
  | "candidacy"
  | "qualification"
  | "education"
  | "employment"
  | "public-service"
  | "legal-challenge";

/**
 * A claim plus its provenance. Every factual field that matters travels with
 * one of these rather than a bare value.
 */
export interface Claim {
  verification: VerificationStateValue;
  /** Evidence ids supporting this claim. Empty is meaningful and allowed. */
  evidenceIds: string[];
  /** When a human or pipeline last confirmed it. Null unless actually checked. */
  verifiedAt: string | null;
}

/* ==========================================================================
   People
   ========================================================================== */

/**
 * Identifiers assigned by the source institutions themselves. These, not names,
 * are the reliable join key across sources — names transliterate inconsistently
 * between English, Sinhala and Tamil records.
 */
export interface ExternalIds {
  parliament?: string;
  electionCommission?: string;
  presidentialSecretariat?: string;
  gazette?: string;
  [source: string]: string | undefined;
}

/** A name in a specific script/language, as officially recorded. */
export interface LocalizedNames {
  en: string;
  si: string | null;
  ta: string | null;
}

/**
 * Where a person stands relative to public office.
 *
 * DERIVED, never stored as a competing flag — the same rule that keeps
 * `current` off `Position`. A person is current because they hold an office
 * with no end date, not because a column says so, so this can never contradict
 * the position records it is computed from.
 *
 * `historical` is distinct from `former`: it marks someone whose record is
 * held for the history rather than because they recently left office. The
 * distinction is about how a profile should read, not about the person.
 */
export type PersonStatus = "current" | "former" | "historical" | "unknown";

/**
 * Whether a person is alive, confirmed deceased, or simply not established
 * either way. Independent of `PersonStatus`: a person can be `former` (no
 * longer serving) and still `unknown` here, because leaving office is not
 * evidence of death. See `deriveVitalStatus()` in `lib/vitalStatus.ts` for
 * the derivation rule — `deceased` requires `Person.dateOfDeath` to be set,
 * never inferred from how old a record is.
 */
export type VitalStatus = "alive" | "deceased" | "unknown";

export interface Person {
  id: string;
  /** URL-stable slug. Never reused, never changed once published. */
  slug: string;
  canonicalName: string;
  names: LocalizedNames;
  /** Alternate spellings, transliterations, initials, former names. */
  aliases: string[];
  dateOfBirth: DateString | null;
  dateOfDeath: DateString | null;
  gender: string | null;
  portrait: Portrait | null;
  biography: string | null;
  /**
   * Occupation as a source states it ("Attorney-at-Law", "Teacher").
   *
   * Deliberately NOT an employment record: it names what someone is, with no
   * employer, no post and no dates. Deriving an `Employment` row from it
   * would manufacture a job history nobody published.
   */
  profession: string | null;
  externalIds: ExternalIds;
  claim: Claim;
  createdAt: string;
  updatedAt: string;
}

/**
 * Portraits carry their own provenance, separate from political data. An image
 * without a source is not displayed as though it were official.
 */
export interface Portrait {
  url: string;
  sourceId: string | null;
  credit: string | null;
  license: string | null;
  retrievedAt: string | null;
}

/* ==========================================================================
   Parties and affiliation
   ========================================================================== */

export interface Party {
  id: string;
  name: string;
  abbreviation: string;
  names: LocalizedNames;
  aliases: string[];
  foundedDate: DateString | null;
  dissolvedDate: DateString | null;
  claim: Claim;
}

export type AffiliationRole =
  | "member"
  | "leader"
  | "deputy-leader"
  | "general-secretary"
  | "chairperson"
  | "founder"
  | "other";

/**
 * Party membership over time. A person changing party adds a new affiliation
 * and closes the old one; the previous affiliation is never deleted.
 */
export interface PoliticalAffiliation {
  id: string;
  personId: string;
  partyId: string;
  role: AffiliationRole;
  startDate: DateString | null;
  endDate: DateString | null;
  claim: Claim;
}

/* ==========================================================================
   Positions
   ========================================================================== */

/**
 * Explicit office classification. Filtering, precedence and grouping all key
 * off `roleType`; `title` stays verbatim as the source wrote it.
 *
 * Production ingestion must set this explicitly. `resolveRoleType()` maps the
 * demonstration dataset's titles via an exact-match table and reports anything
 * unmapped rather than guessing from substrings.
 */
export const RoleType = {
  PRESIDENT: "president",
  PRIME_MINISTER: "prime-minister",
  CABINET_MINISTER: "cabinet-minister",
  STATE_MINISTER: "state-minister",
  /**
   * A minister who is not of Cabinet rank, as Parliament titles them:
   * "Non Cabinet Minister of Science, Technology & Research".
   *
   * Given its own type rather than folded into STATE_MINISTER. They are
   * different ranks in Sri Lankan practice, and equating them would assert a
   * constitutional equivalence this platform has no source for — the same
   * reason PARLIAMENTARY_OFFICE exists instead of a catch-all.
   */
  NON_CABINET_MINISTER: "non-cabinet-minister",
  /**
   * A District Minister — a national-level minister holding a district
   * portfolio. The office existed from 1978 until the 1990s and has no modern
   * counterpart, so it is recorded as itself rather than mapped onto the
   * nearest surviving rank.
   */
  DISTRICT_MINISTER: "district-minister",
  /**
   * A Parliamentary Secretary — the pre-1978 junior ministerial office.
   *
   * Deliberately NOT mapped to DEPUTY_MINISTER. The two are often described
   * as equivalents, but that is a constitutional judgement and no source in
   * this platform makes it.
   */
  PARLIAMENTARY_SECRETARY: "parliamentary-secretary",
  DEPUTY_MINISTER: "deputy-minister",
  MEMBER_OF_PARLIAMENT: "member-of-parliament",
  SPEAKER: "speaker",
  DEPUTY_SPEAKER: "deputy-speaker",
  OPPOSITION_LEADER: "opposition-leader",
  /**
   * Parliamentary offices that are neither ministerial nor the chair: Leader
   * of the House, Chief Government Whip, Deputy Chairperson of Committees.
   * Added because Parliament of Sri Lanka's member directory publishes these
   * as distinct offices and filing them under "other public office" would
   * lose a real distinction the source draws.
   */
  PARLIAMENTARY_OFFICE: "parliamentary-office",
  PARTY_LEADER: "party-leader",
  PROVINCIAL_OFFICE: "provincial-office",
  LOCAL_GOVERNMENT: "local-government",
  PUBLIC_SERVICE: "public-service",
  OTHER_PUBLIC_OFFICE: "other-public-office",
} as const;

export type RoleTypeValue = (typeof RoleType)[keyof typeof RoleType];

/** See `Position.endStatus`. */
export type PositionEndStatus = "ongoing" | "dated" | "not-recorded";

/** How the office was come by. Only set when a source actually says so. */
export type AppointmentType =
  | "elected"
  | "appointed"
  | "ex-officio"
  | "acting"
  | "caretaker"
  | "unknown";

/**
 * A public office held by a person.
 *
 * Note the absence of a `current` field: currency is derived from `endDate`
 * against today (`isCurrent()`), so the two can never contradict each other.
 */
export interface Position {
  id: string;
  personId: string;
  /** Verbatim official title. Never normalised for display. */
  title: string;
  roleType: RoleTypeValue;
  institution: string;
  ministry: string | null;
  districtId: string | null;
  constituency: string | null;
  startDate: DateString | null;
  endDate: DateString | null;
  /**
   * The date on which a source asserted this office was *being held*, where
   * the source states the holding but not when it began.
   *
   * This is NOT the forbidden stored `current: true` flag. That flag is
   * banned because it is a computed status that can silently contradict
   * `endDate`. This is the opposite: a dated observation about a source —
   * "the official current-members directory listed this person on
   * 2026-08-28" — in the same family as `SourceEvidence.retrievedAt`.
   *
   * It exists because Parliament of Sri Lanka's member directory asserts
   * current membership without publishing a term start date. Leaving such a
   * position with a null `startDate` and no other signal would render every
   * sitting MP as no-longer-serving, which is as false as inventing a start
   * date would be. `isCurrent()` still lets `endDate` win, so this can never
   * contradict a recorded end.
   */
  currentAsOf: DateString | null;
  /**
   * What the source said about the END of this office.
   *
   * "ongoing"      the source stated it is still held ("to date").
   * "dated"        the source gave an end date; it is in `endDate`.
   * "not-recorded" the source gave a start and NOTHING about the end.
   *
   * The third case is the reason this field exists. A null `endDate` alone
   * cannot distinguish "still in office" from "the source never said when
   * they left", and reading the second as the first puts former ministers on
   * the site as sitting ones — a president who left in 2005 rendered as
   * currently holding the defence portfolio. Both facts are absences in the
   * data; only the source can tell them apart, so the source's own signal is
   * recorded rather than inferred.
   */
  endStatus: PositionEndStatus;
  appointmentType: AppointmentType;
  /** Lower ranks higher when picking a headline office. 1 = head of state. */
  precedence: number;
  claim: Claim;
  createdAt: string;
  updatedAt: string;
}

/**
 * A discrete, dated event in an office's life. Event types are recorded only
 * when a source states them — a term simply ending is not evidence of a
 * resignation, a dismissal, or anything else.
 */
export type PositionEventType =
  | "elected"
  | "appointed"
  | "assumed-office"
  | "resigned"
  | "removed"
  | "dismissed"
  | "reappointed"
  | "ceased-office"
  | "acting-appointment"
  | "caretaker-appointment";

export interface PositionEvent {
  id: string;
  positionId: string | null;
  personId: string;
  eventType: PositionEventType;
  eventDate: DateString;
  title: string;
  description: string | null;
  claim: Claim;
}

/* ==========================================================================
   Elections
   ========================================================================== */

export type ElectionType =
  | "presidential"
  | "parliamentary"
  | "provincial-council"
  | "local-authority"
  | "referendum";

export interface Election {
  id: string;
  name: string;
  electionType: ElectionType;
  electionDate: DateString;
  /** Parliament/term this election constituted, where applicable. */
  term: string | null;
  claim: Claim;
}

export type CandidacyResult = "elected" | "not-elected" | "withdrawn" | "unknown";

export interface Candidacy {
  id: string;
  electionId: string;
  personId: string;
  partyId: string | null;
  districtId: string | null;
  result: CandidacyResult;
  /** Null unless an official count is published. Never estimated. */
  votes: number | null;
  preferenceVotes: number | null;
  seat: string | null;
  claim: Claim;
}

/* ==========================================================================
   Qualifications
   ========================================================================== */

/**
 * An academic or professional credential.
 *
 * An empty qualification list means "none recorded", never "none held". The UI
 * is required to state that distinction explicitly.
 */
export interface Qualification {
  id: string;
  personId: string;
  institution: string;
  qualification: string;
  field: string | null;
  startDate: DateString | null;
  endDate: DateString | null;
  claim: Claim;
}

export type EducationType = "school" | "university" | "postgraduate" | "professional" | "other";
export type CompletionState = "completed" | "incomplete" | "ongoing" | "unknown";

/**
 * One educational record.
 *
 * `institution` is nullable because Parliament of Sri Lanka routinely names an
 * award without naming the awarding body ("BA (Hons) Sociology", "MBBS"). The
 * alternative to a nullable column is inventing a university, which is not an
 * alternative at all.
 *
 * `sourceText` keeps the source's exact words alongside this platform's
 * classification of them. Classification is a judgement — "MBBS" is a
 * bachelor's degree despite beginning with M — and keeping the raw string
 * means a wrong judgement can be found and fixed without re-fetching, and that
 * a reader can always see what was actually published.
 */
export interface Education {
  id: string;
  personId: string;
  educationType: EducationType;
  institution: string | null;
  qualification: string | null;
  field: string | null;
  /**
   * Set for a G.C.E. Ordinary or Advanced Level entry.
   *
   * Recording the EXAMINATION is not recording RESULTS. Grades belong in
   * `ExamResult` and are absent for every member: individual examination
   * records are personal data held by the Department of Examinations and are
   * published for no one.
   */
  examLevel: "ol" | "al" | null;
  stream: string | null;
  startDate: DateString | null;
  endDate: DateString | null;
  completion: CompletionState;
  sourceText: string | null;
  claim: Claim;
}

/** One subject's result. Never inferred, never derived from a biography. */
export interface ExamResult {
  id: string;
  personId: string;
  examType: "ol" | "al";
  examYear: DateString | null;
  stream: string | null;
  subject: string;
  grade: string;
  claim: Claim;
}

/**
 * A job. Deliberately separate from `Position` (public office) and from
 * `Person.profession` (an occupation label with no employer and no dates).
 */
export interface Employment {
  id: string;
  personId: string;
  organisation: string;
  role: string | null;
  startDate: DateString | null;
  endDate: DateString | null;
  description: string | null;
  claim: Claim;
}

/** A board, commission, caucus or other institutional appointment. */
export interface PublicService {
  id: string;
  personId: string;
  organisation: string;
  role: string | null;
  startDate: DateString | null;
  endDate: DateString | null;
  description: string | null;
  claim: Claim;
}

export type LegalChallengeOutcome = "pending" | "withdrawn" | "dismissed" | "upheld" | "other";

/**
 * A challenge to a person's mandate or eligibility.
 *
 * THIS RECORDS THAT A CHALLENGE EXISTS. IT DOES NOT RECORD A VERDICT.
 *
 * A petition is an allegation by one party. Rendering one as an established
 * fact would tell readers a sitting member is disqualified when no court has
 * decided anything — false, and about a named living person. `outcome`
 * defaults to "pending" and becomes a decided value only with a dated,
 * sourced decision; the interface is required to label anything pending as
 * under review rather than as a finding.
 */
export interface LegalChallenge {
  id: string;
  personId: string;
  challengeType: string;
  forum: string | null;
  caseReference: string | null;
  petitioner: string | null;
  /** The ground asserted, in the petition's terms. Not a finding. */
  claimSummary: string;
  filedOn: DateString | null;
  outcome: LegalChallengeOutcome;
  decidedOn: DateString | null;
  decisionSummary: string | null;
  claim: Claim;
}

/* ==========================================================================
   Corrections
   ========================================================================== */

export type CorrectionStatus =
  | "open"
  | "under-review"
  | "verified"
  | "rejected"
  | "published";

export interface CorrectionReport {
  id: string;
  entityType: EntityType;
  entityId: string;
  fieldName: string;
  currentValue: string | null;
  proposedValue: string;
  /** URL of the official source that contradicts the current value. */
  supportingSourceUrl: string;
  explanation: string;
  submittedAt: string;
  reviewStatus: CorrectionStatus;
  reviewedAt: string | null;
  reviewer: string | null;
  resolution: string | null;
}

/* ==========================================================================
   Audit
   ========================================================================== */

/**
 * A recorded change to canonical data. Enables "what changed, when, and which
 * source caused it" without re-reading snapshots.
 */
export interface ChangeEvent {
  id: string;
  entityType: EntityType;
  entityId: string;
  fieldName: string;
  previousValue: string | null;
  newValue: string | null;
  /** The snapshot/ingest run that produced the change, if automated. */
  sourceSnapshotId: string | null;
  sourceId: string | null;
  detectedAt: string;
  verifiedAt: string | null;
  actor: string;
}

/* ==========================================================================
   Dataset mode
   ========================================================================== */

/**
 * Governs how the interface describes its own contents.
 *
 * While `mode` is "demonstration", `normaliseClaim()` forces every record's
 * verification state down to DEMONSTRATION. That is enforced in code, not left
 * to the discipline of whoever edits the dataset.
 */
export type DatasetMode = "demonstration" | "live";

export interface DatasetDescriptor {
  mode: DatasetMode;
  /** When the sample was last hand-edited. NOT a verification timestamp. */
  compiledOn: DateString;
  /** How current the compiler believed the sample to be. */
  knownAsOf: DateString;
}
