/**
 * Javora — Parliament import → canonical model.
 *
 * Turns the rows retrieved by `scripts/import-parliament.mjs` into Person,
 * Position, PoliticalAffiliation and SourceEvidence records.
 *
 * WHAT THIS ADAPTER REFUSES TO DO
 *
 *   - Invent dates. The Directory of Members states *that* a member holds an
 *     office, never *since when*, so every position here has
 *     `startDate: null` and carries `currentAsOf` instead.
 *   - Invent party history. The source gives one current party and no
 *     joining date, so affiliations are open-ended and undated.
 *   - Assert vocabulary mappings. Parties and districts are derived from
 *     the source's own strings rather than mapped onto a curated list, so
 *     nothing here claims "Jathika Jana balawegaya is the NPP" — a claim the
 *     source does not make. The verbatim name IS the record.
 *
 * Every id is deterministic (see `sync/importRun.ts`), so re-importing
 * unchanged data reproduces this dataset exactly rather than duplicating it.
 */

import parliamentData from "../imported/parliamentMembers.json" with { type: "json" };
import {
  canonicalNameFrom,
  honorificFrom,
  postNominalFrom,
  ministryFromTitle,
  roleTypeForOffice,
  splitCompoundRole,
  parliamentProfileUrl,
  PARLIAMENT_SOURCE_ID,
} from "../../sync/connectors/parliament.ts";
import {
  personIdFor,
  positionIdFor,
  educationIdFor,
  affiliationIdFor,
  evidenceIdFor,
} from "../../sync/importRun.ts";
import { verificationForImportedFact } from "../../sync/verificationPolicy.ts";
import { normaliseClaim } from "../../lib/verification.ts";
import { buildSearchIndex, nameKeys } from "../../lib/identity.ts";
import { slugify } from "../../lib/slug.ts";
import { precedenceFor } from "../roles.ts";
import { DATASET } from "./datasetDescriptor.ts";
import {
  RoleType,
  type Claim,
  type Education,
  type Employment,
  type FactType,
  type LegalChallenge,
  type Party,
  type Person,
  type PoliticalAffiliation,
  type Position,
  type PositionEvent,
  type PublicService,
  type Qualification,
  type SourceEvidence,
} from "../../types/models.ts";

/* ==========================================================================
   Source rows
   ========================================================================== */

interface RawMember {
  parliamentId: string;
  name: string | null;
  party: string | null;
  district: string | null;
  role: string | null;
  dateOfBirth: string | null;
  profession: string | null;
  portraitUrl: string | null;
  partyOnProfile?: string | null;
  districtOnProfile?: string | null;
  /**
   * The profile page's "Related Information" panes. Present since parser
   * version 2; null for a member whose profile page was never fetched.
   */
  detail?: ProfileDetail | null;
}

import type { ProfileDetail } from "../../lib/parliamentDetail.ts";
import { legalChallengesFor } from "./legalChallenges.ts";
import {
  educationFromAcademicEntry, educationFromProfessionalEntry,
  positionsFromTerms, positionsFromServices, parliamentOrdinal,
} from "./profileDetailMapping.ts";

const RAW = parliamentData.members as RawMember[];
const SNAPSHOT = parliamentData.snapshot;
const RETRIEVED_AT: string = SNAPSHOT.retrievedAt;
/** Date part only — `currentAsOf` is a DateString, not a timestamp. */
const RETRIEVED_ON: string = RETRIEVED_AT.slice(0, 10);

/* ==========================================================================
   Vocabularies, derived from the source's own strings
   ========================================================================== */

/**
 * Provinces for the districts Parliament names.
 *
 * Geography, not politics: which province a district sits in is stable
 * public fact and the source does not publish it. Districts the map does not
 * cover — including "National List", which is not a place — get a null
 * province rather than a guess.
 */
const PROVINCE_BY_DISTRICT: Record<string, string> = {
  colombo: "Western", gampaha: "Western", kalutara: "Western",
  mahanuwara: "Central", matale: "Central", "nuwara-eliya": "Central",
  galle: "Southern", matara: "Southern", hambantota: "Southern",
  jaffna: "Northern", vanni: "Northern",
  batticaloa: "Eastern", digamadulla: "Eastern", trincomalee: "Eastern",
  kurunegala: "North Western", puttalam: "North Western",
  anuradhapura: "North Central", polonnaruwa: "North Central",
  badulla: "Uva", monaragala: "Uva",
  ratnapura: "Sabaragamuwa", kegalle: "Sabaragamuwa",
};

export interface DerivedDistrict {
  id: string;
  name: string;
  province: string | null;
}

/** Abbreviation Parliament prints in parentheses, e.g. "…(SJB)". */
function abbreviationFrom(name: string): string {
  const m = name.match(/\(([^)]+)\)\s*$/);
  if (m) return m[1]!.trim();
  // No parenthesised abbreviation: initials of the significant words.
  return name
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .map((w) => w[0]!.toUpperCase())
    .join("")
    .slice(0, 5);
}

/** Party name without the trailing parenthesised abbreviation. */
const partyDisplayName = (name: string): string => name.replace(/\s*\([^)]+\)\s*$/, "").trim();

function buildVocabularies() {
  const partyMap = new Map<string, Party>();
  const districtMap = new Map<string, DerivedDistrict>();

  for (const row of RAW) {
    if (row.party) {
      const id = slugify(row.party);
      if (!partyMap.has(id)) {
        partyMap.set(id, {
          id,
          name: partyDisplayName(row.party),
          abbreviation: abbreviationFrom(row.party),
          // The source publishes English only; Sinhala/Tamil forms are not
          // recorded and are never machine-transliterated to fill the gap.
          names: { en: partyDisplayName(row.party), si: null, ta: null },
          // The verbatim string as Parliament writes it, kept searchable.
          aliases: row.party === partyDisplayName(row.party) ? [] : [row.party],
          foundedDate: null,
          dissolvedDate: null,
          claim: normaliseClaim(
            { verification: "unverified", evidenceIds: [], verifiedAt: null },
            DATASET.mode,
          ),
        });
      }
    }
    if (row.district) {
      const id = slugify(row.district);
      if (!districtMap.has(id)) {
        districtMap.set(id, {
          id,
          name: row.district,
          province: PROVINCE_BY_DISTRICT[id] ?? null,
        });
      }
    }
  }

  return {
    parties: [...partyMap.values()].sort((a, b) => a.name.localeCompare(b.name, "en")),
    districts: [...districtMap.values()].sort((a, b) => a.name.localeCompare(b.name, "en")),
  };
}

export const { parties: derivedParties, districts: derivedDistricts } = buildVocabularies();

/* ==========================================================================
   Evidence
   ========================================================================== */

const evidence: SourceEvidence[] = [];

/**
 * Build evidence pointing at the member's own profile page.
 *
 * Unlike the retired demonstration data — which could only name an
 * institution — this carries a real document URL, the source's own record
 * id, and the moment of retrieval. `hasPreciseEvidence()` therefore returns
 * true, which is what lets these claims reach SOURCE_LINKED.
 */
function evidenceFor(
  entityType: SourceEvidence["entityType"],
  entityId: string,
  fieldName: string | null,
  member: RawMember,
): string[] {
  const sourceUrl = parliamentProfileUrl(member.parliamentId);
  const id = evidenceIdFor({
    sourceId: PARLIAMENT_SOURCE_ID,
    entityType,
    entityId,
    fieldName,
    sourceUrl,
  });
  if (!evidence.some((e) => e.id === id)) {
    evidence.push({
      id,
      sourceId: PARLIAMENT_SOURCE_ID,
      entityType,
      entityId,
      fieldName,
      sourceUrl,
      documentTitle: `Directory of Members — ${member.name ?? member.parliamentId}`,
      // The page carries no publication date of its own.
      publishedAt: null,
      retrievedAt: RETRIEVED_AT,
      // The whole page is the locator; there is no finer subdivision to cite.
      locator: null,
      sourceRecordId: member.parliamentId,
      contentHash: SNAPSHOT.contentHash,
      notes: null,
    });
  }
  return [id];
}

/** A claim carrying the given evidence, at the state the policy allows. */
function claimFor(evidenceIds: string[], factType: FactType, conflicting = false): Claim {
  return normaliseClaim(
    {
      verification: verificationForImportedFact({
        sourceId: PARLIAMENT_SOURCE_ID,
        factType,
        hasPreciseEvidence: evidenceIds.length > 0,
        // No review UI and only one connected source: nothing is confirmed.
        confirmed: false,
        confirmedAt: null,
        conflicting,
      }),
      evidenceIds,
      verifiedAt: null,
    },
    DATASET.mode,
  );
}

/**
 * Whether the two Parliament pages that both state a member's district
 * disagree.
 *
 * This is real and currently affects two members: the directory lists them
 * under "National List" while their own profile page names a territorial
 * district. Both pages are official, so Javora does not pick a winner — the
 * claim is marked CONFLICTING and the disagreement is shown. Silently
 * preferring one would be inventing a resolution the source has not made.
 */
const districtConflicts = (row: RawMember): boolean =>
  Boolean(row.districtOnProfile && row.district && row.districtOnProfile !== row.district);

/* ==========================================================================
   Projection
   ========================================================================== */

export interface ParliamentDataset {
  people: Person[];
  positions: Position[];
  qualifications: Qualification[];
  education: Education[];
  employment: Employment[];
  publicService: PublicService[];
  legalChallenges: LegalChallenge[];
  events: PositionEvent[];
  affiliations: PoliticalAffiliation[];
  evidence: SourceEvidence[];
  searchIndex: Map<string, string>;
  personContext: Map<string, { partyId: string | null; districtId: string | null }>;
}

/**
 * URL-stable slugs, de-duplicated deterministically.
 *
 * Two members can share a name; the second one to appear gets their
 * Parliament id appended rather than silently overwriting the first. Sorting
 * by member id first makes which-one-gets-the-plain-slug stable across runs,
 * so a person's URL does not change just because the source reordered its
 * listing.
 */
function buildSlugs(rows: RawMember[]): Map<string, string> {
  const slugs = new Map<string, string>();
  const taken = new Set<string>();
  for (const row of [...rows].sort((a, b) => a.parliamentId.localeCompare(b.parliamentId, "en"))) {
    const base = slugify(canonicalNameFrom(row.name ?? "")) || `member-${row.parliamentId}`;
    const slug = taken.has(base) ? `${base}-${row.parliamentId}` : base;
    taken.add(slug);
    slugs.set(row.parliamentId, slug);
  }
  return slugs;
}

function project(): ParliamentDataset {
  const people: Person[] = [];
  const positions: Position[] = [];
  const affiliations: PoliticalAffiliation[] = [];
  const education: Education[] = [];
  const employment: Employment[] = [];
  const publicService: PublicService[] = [];
  const legalChallenges: LegalChallenge[] = [];
  const searchIndex = new Map<string, string>();
  const personContext = new Map<string, { partyId: string | null; districtId: string | null }>();

  const slugs = buildSlugs(RAW);

  for (const row of RAW) {
    if (!row.name) continue;

    const personId = personIdFor("parliament", row.parliamentId);
    const canonicalName = canonicalNameFrom(row.name);
    const honorific = honorificFrom(row.name);
    const postNominal = postNominalFrom(row.name);
    const partyId = row.party ? slugify(row.party) : null;
    const districtId = row.district ? slugify(row.district) : null;

    // Aliases: the verbatim printed form, plus honorific/post-nominal
    // variants — all forms the source itself used, none invented.
    const aliases = [...new Set([row.name.trim(), honorific ? `${honorific} ${canonicalName}` : null, postNominal ? `${canonicalName}, ${postNominal}` : null].filter((a): a is string => Boolean(a) && a !== canonicalName))];

    const person: Person = {
      id: personId,
      slug: slugs.get(row.parliamentId)!,
      canonicalName,
      names: { en: canonicalName, si: null, ta: null },
      aliases,
      dateOfBirth: row.dateOfBirth,
      // The directory lists sitting members; it records no deaths.
      dateOfDeath: null,
      gender: null,
      portrait: row.portraitUrl
        ? {
            url: row.portraitUrl,
            sourceId: PARLIAMENT_SOURCE_ID,
            credit: "Parliament of Sri Lanka",
            license: null,
            retrievedAt: RETRIEVED_AT,
          }
        : null,
      // The source publishes no prose biography.
      biography: null,
      // Occupation as Parliament states it. Not an employment record.
      profession: row.profession,
      externalIds: { parliament: row.parliamentId },
      claim: claimFor(evidenceFor("person", personId, null, row), "biographical"),
      createdAt: RETRIEVED_AT,
      updatedAt: RETRIEVED_AT,
    };
    people.push(person);
    personContext.set(personId, { partyId, districtId });

    // Every person in this directory is, by definition of the directory, a
    // sitting Member of Parliament.
    //
    // This undated record is now a FALLBACK. When the profile publishes a
    // Legislative History, the per-term positions built below carry real
    // start and end dates and this one would be a duplicate of the current
    // term with worse data — so it is only emitted when the source gave us
    // nothing better.
    const mpId = positionIdFor(personId, "Member of Parliament");
    if (!(row.detail?.legislativeHistory?.length)) positions.push({
      id: mpId,
      personId,
      title: "Member of Parliament",
      roleType: RoleType.MEMBER_OF_PARLIAMENT,
      institution: "Parliament of Sri Lanka",
      ministry: null,
      districtId,
      constituency: null,
      startDate: null,
      endDate: null,
      currentAsOf: RETRIEVED_ON,
      // The directory asserts this office is held as at the retrieval date.
      endStatus: "ongoing",
      // The source does not say whether a member was elected or appointed
      // from the national list, so this stays unknown.
      appointmentType: "unknown",
      precedence: precedenceFor(RoleType.MEMBER_OF_PARLIAMENT),
      claim: claimFor(
        evidenceFor("position", mpId, "title", row),
        "parliamentary-membership",
        // The MP position is where district lives, so a district
        // disagreement makes this claim conflicting.
        districtConflicts(row),
      ),
      createdAt: RETRIEVED_AT,
      updatedAt: RETRIEVED_AT,
    });

    /* ------------------------------------------------------- education
       Parliament's own Qualifications pane. Tier 1 evidence: the
       institution stating its members' records. Recorded SOURCE_LINKED and
       not "verified" — Javora links the exact page, but nobody has confirmed
       Javora read that page correctly, and that confirmation is what
       "verified" means here. */
    const detail = row.detail ?? null;
    const academicDrafts = (detail?.qualifications.academic ?? [])
      .map(educationFromAcademicEntry)
      .filter((d): d is NonNullable<typeof d> => d !== null);
    const professionalDrafts = (detail?.qualifications.professional ?? [])
      .map(educationFromProfessionalEntry)
      .filter((d): d is NonNullable<typeof d> => d !== null);

    for (const draft of [...academicDrafts, ...professionalDrafts]) {
      const eduId = educationIdFor(personId, draft.sourceText);
      // Deterministic ids make a re-import idempotent; a person who lists the
      // same award twice on one profile still gets one record.
      if (education.some((e) => e.id === eduId)) continue;
      education.push({
        id: eduId,
        personId,
        educationType: draft.educationType,
        institution: draft.institution,
        qualification: draft.qualification,
        field: draft.field,
        examLevel: draft.examLevel,
        stream: draft.stream,
        startDate: draft.startDate,
        endDate: draft.endDate,
        // Parliament lists awards held. It never says whether a course was
        // completed, and "listed as a qualification" is not the same claim.
        completion: "unknown",
        sourceText: draft.sourceText,
        claim: claimFor(evidenceFor("education", eduId, "qualification", row), "qualification"),
      });
    }

    /* ------------------------------------------- parliamentary service
       One position per term actually served, with that member's OWN dates.
       This is what finally gives sitting members a real start date instead
       of a dated observation, and gives returning members the earlier terms
       that the current-members directory alone cannot show. */
    for (const draft of positionsFromTerms(detail?.legislativeHistory ?? [], districtId, precedenceFor(RoleType.MEMBER_OF_PARLIAMENT))) {
      const ordinal = parliamentOrdinal(draft.parliament ?? "");
      const termId = positionIdFor(personId, draft.title, draft.parliament ?? String(ordinal ?? ""));
      if (positions.some((x) => x.id === termId)) continue;
      positions.push({
        id: termId,
        personId,
        title: draft.title,
        roleType: draft.roleType,
        institution: draft.institution,
        ministry: null,
        districtId: draft.districtId,
        constituency: draft.parliament,
        startDate: draft.startDate,
        endDate: draft.endDate,
        currentAsOf: null,
        endStatus: draft.endStatus,
        appointmentType: "unknown",
        precedence: draft.precedence,
        claim: claimFor(
          evidenceFor("position", termId, "title", row),
          "parliamentary-membership",
          districtConflicts(row) && draft.districtId !== null,
        ),
        createdAt: RETRIEVED_AT,
        updatedAt: RETRIEVED_AT,
      });
    }

    /* ------------------------------------------------ ministerial service
       Offices with real start AND end dates, including every office the
       member has left. This is where historical portfolios come from: the
       current-members directory shows only what someone holds now, so
       without this pane a minister's earlier portfolios do not exist. */
    for (const draft of positionsFromServices(
      detail?.ministerialServices ?? [],
      splitCompoundRole, roleTypeForOffice, ministryFromTitle, precedenceFor,
    )) {
      const svcId = positionIdFor(
        personId, draft.title,
        // Two spells in the same office are two records; the start date is
        // what distinguishes them.
        draft.startDate ?? null,
      );
      if (positions.some((x) => x.id === svcId)) continue;
      positions.push({
        id: svcId,
        personId,
        title: draft.title,
        roleType: draft.roleType,
        institution: draft.institution,
        ministry: draft.ministry,
        districtId: null,
        constituency: null,
        startDate: draft.startDate,
        endDate: draft.endDate,
        currentAsOf: null,
        endStatus: draft.endStatus,
        appointmentType: "unknown",
        precedence: draft.precedence,
        claim: claimFor(
          evidenceFor("position", svcId, "title", row),
          draft.roleType === RoleType.MEMBER_OF_PARLIAMENT
            ? "parliamentary-membership" : "portfolio-assignment",
        ),
        createdAt: RETRIEVED_AT,
        updatedAt: RETRIEVED_AT,
      });
    }

    // Ministerial and parliamentary offices, split out of the compound role.
    //
    // Kept for members whose profile publishes a current portfolio but no
    // Ministerial Services pane. A title already recorded from that pane is
    // skipped rather than duplicated with worse (undated) data.
    const datedTitles = new Set(
      (detail?.ministerialServices ?? []).flatMap((svc) => splitCompoundRole(svc.title)),
    );
    for (const title of splitCompoundRole(row.role)) {
      if (datedTitles.has(title)) continue;
      const roleType = roleTypeForOffice(title);
      const id = positionIdFor(personId, title);
      positions.push({
        id,
        personId,
        title,
        roleType,
        institution:
          roleType === RoleType.CABINET_MINISTER ||
          roleType === RoleType.STATE_MINISTER ||
          roleType === RoleType.DEPUTY_MINISTER ||
          roleType === RoleType.PRIME_MINISTER
            ? "Cabinet of Ministers"
            : "Parliament of Sri Lanka",
        ministry: ministryFromTitle(title),
        districtId: null,
        constituency: null,
        startDate: null,
        endDate: null,
        currentAsOf: RETRIEVED_ON,
        // The directory asserts this office is held as at the retrieval date.
        endStatus: "ongoing",
        appointmentType: "unknown",
        precedence: precedenceFor(roleType),
        claim: claimFor(
          evidenceFor("position", id, "title", row),
          roleType === RoleType.MEMBER_OF_PARLIAMENT
            ? "parliamentary-membership"
            : "portfolio-assignment",
        ),
        createdAt: RETRIEVED_AT,
        updatedAt: RETRIEVED_AT,
      });
    }

    if (partyId) {
      const affiliationId = affiliationIdFor(personId, partyId);
      affiliations.push({
        id: affiliationId,
        personId,
        partyId,
        // The directory records membership, never a party office.
        role: "member",
        // No joining date is published; inventing one would be fabrication.
        startDate: null,
        endDate: null,
        claim: claimFor(
          evidenceFor("affiliation", affiliationId, "partyId", row),
          "party-affiliation",
        ),
      });
    }

    const partyRecord = partyId ? derivedParties.find((p) => p.id === partyId) : null;
    searchIndex.set(
      personId,
      buildSearchIndex([
        ...nameKeys(person),
        row.name,
        partyRecord?.name ?? row.party,
        partyRecord?.abbreviation ?? null,
        row.district,
        row.profession,
        row.role,
        ...splitCompoundRole(row.role),
        "Member of Parliament",
        "MP",
      ]),
    );
  }

  // Bound to canonical people by Parliament id, so a challenge can never be
  // attached to a person Javora has not actually identified.
  const byParliamentId = new Map(RAW.map((r) => [r.parliamentId, personIdFor("parliament", r.parliamentId)]));
  legalChallenges.push(...legalChallengesFor((pid) => byParliamentId.get(pid) ?? null));

  return {
    people,
    positions,
    // `qualification` is the older shape, which requires an institution the
    // source often does not name. Education records carry the same facts in a
    // shape this source can actually fill.
    qualifications: [],
    education,
    employment,
    publicService,
    legalChallenges,
    events: [],
    affiliations,
    evidence,
    searchIndex,
    personContext,
  };
}

export const parliamentDataset: ParliamentDataset = project();
