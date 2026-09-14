/**
 * Javora — former Members of Parliament.
 *
 * The historical half of the people universe, read from the official
 * Directory of Past Members.
 *
 * ONE IDENTIFIER SPACE, SO NO DUPLICATES
 *
 * Parliament gives every member a numeric id and keeps it when they leave; the
 * current and past directories are two views over one identifier space. Javora
 * uses `parliament:<id>` for both, so a person cannot appear twice across the
 * two imports — and anyone present in the current directory is skipped here
 * outright rather than merged after the fact.
 *
 * That property is what makes this expansion safe: adding ~1,400 historical
 * people cannot disturb the 225 sitting members, because a collision is
 * impossible by construction rather than prevented by a matching heuristic.
 *
 * WHAT PAST PROFILES CARRY, AND WHAT THEY DO NOT
 *
 * They carry qualifications, per-member legislative history, ministerial
 * service with dates, and a "Political Career" narrative the current
 * directory has no equivalent of. They do NOT carry district or profession.
 * Absent fields stay null; the interface says "not recorded", never invents.
 */

import pastData from "../imported/parliamentPastMembers.json" with { type: "json" };
import {
  RoleType,
  type Education, type Person, type Position, type PoliticalAffiliation,
  type SourceEvidence, type PersonStatus,
} from "../../types/models.ts";
import type { ProfileDetail } from "../../lib/parliamentDetail.ts";
import {
  educationFromAcademicEntry, educationFromProfessionalEntry,
  positionsFromTerms, positionsFromServices,
} from "./profileDetailMapping.ts";
import {
  splitCompoundRole, roleTypeForOffice, ministryFromTitle,
  canonicalNameFrom, honorificFrom, postNominalFrom,
} from "../../sync/connectors/parliament.ts";
import { precedenceFor } from "../roles.ts";
import { isCurrent } from "../../lib/positions.ts";
import {
  personIdFor, positionIdFor, educationIdFor, affiliationIdFor, evidenceIdFor,
} from "../../sync/importRun.ts";

import { VerificationState } from "../../types/models.ts";
import { slugify } from "../../lib/slug.ts";

const PARLIAMENT_SOURCE_ID = "S001";
const BASE = "https://www.parliament.lk";

interface RawPastMember {
  parliamentId: string;
  name: string | null;
  legislativeService: string | null;
  portraitUrl: string | null;
  dateOfBirth: string | null;
  profession: string | null;
  partyOnProfile: string | null;
  districtOnProfile: string | null;
  detail: ProfileDetail | null;
  profileError: string | null;
}

const RAW = (pastData.members ?? []) as unknown as RawPastMember[];
const SNAPSHOT = pastData.snapshot as { retrievedAt: string };
const RETRIEVED_AT: string = SNAPSHOT?.retrievedAt ?? new Date(0).toISOString();

/** A disagreement between two things the SAME source publishes. */
export interface SourceSelfConflict {
  personId: string;
  positionId: string;
  title: string;
  detail: string;
}

export interface PastMembersDataset {
  people: Person[];
  positions: Position[];
  education: Education[];
  affiliations: PoliticalAffiliation[];
  evidence: SourceEvidence[];
  /** Derived status per person id, for search results and profile headers. */
  status: Map<string, PersonStatus>;
  /** Positions where the source contradicts itself. Surfaced, not resolved. */
  conflicts: SourceSelfConflict[];
  searchIndex: Map<string, string>;
}

const profileUrl = (id: string): string => `${BASE}/en/members-of-parliament/mp-profile/${id}`;

/**
 * Past-member names are sometimes printed surname-first
 * ("Kumaratunga, Chandrika Bandaranaike").
 *
 * Reordered for display, and BOTH forms kept as aliases so a search for
 * either finds the person. The comma is the only signal the source gives, so
 * a name without one is left exactly as printed rather than guessed at.
 */
export function uninvertName(name: string): { display: string; inverted: string | null } {
  const m = /^([^,]+),\s+(.+)$/.exec(name.trim());
  if (!m) return { display: name.trim(), inverted: null };
  const surname = m[1]!.trim();
  const rest = m[2]!.trim();
  // Only treat it as inverted when the tail looks like given names rather
  // than a post-nominal ("Attorney at Law", "M.P.").
  if (/^(m\.?p\.?|attorney|barrister|ph\.?d|esq)/i.test(rest)) return { display: name.trim(), inverted: null };
  return { display: `${rest} ${surname}`, inverted: name.trim() };
}

function project(): PastMembersDataset {
  const people: Person[] = [];
  const positions: Position[] = [];
  const education: Education[] = [];
  const affiliations: PoliticalAffiliation[] = [];
  const evidence: SourceEvidence[] = [];
  const status = new Map<string, PersonStatus>();
  const conflicts: SourceSelfConflict[] = [];
  const searchIndex = new Map<string, string>();
  const takenSlugs = new Set<string>();

  const evidenceFor = (entityType: SourceEvidence["entityType"], entityId: string, field: string | null, memberId: string): string[] => {
    const url = profileUrl(memberId);
    const id = evidenceIdFor({ sourceId: PARLIAMENT_SOURCE_ID, entityType, entityId, fieldName: field, sourceUrl: url });
    if (!evidence.some((e) => e.id === id)) {
      evidence.push({
        id, sourceId: PARLIAMENT_SOURCE_ID, entityType, entityId, fieldName: field,
        sourceUrl: url, documentTitle: "Directory of Past Members — member profile",
        publishedAt: null, retrievedAt: RETRIEVED_AT, locator: `mp-profile/${memberId}`,
        sourceRecordId: memberId, contentHash: null, notes: null,
      });
    }
    return [id];
  };

  // Source-linked, never verified: Parliament published it and Javora links
  // the exact page, but nobody has confirmed Javora read that page correctly.
  const claim = (evidenceIds: string[]) => ({
    verification: VerificationState.SOURCE_LINKED,
    evidenceIds,
    verifiedAt: null,
  });

  for (const row of [...RAW].sort((a, b) => a.parliamentId.localeCompare(b.parliamentId, "en"))) {
    if (!row.name) continue;
    const personId = personIdFor("parliament", row.parliamentId);
    /*
     * Strip titles FIRST, then un-invert. The order is the whole thing.
     *
     * The source writes past members surname-first with the honorific and
     * post-nominal still attached:
     *
     *     "Hon. Weerasekera, Dhanapala Philip Ranil, M.P."
     *
     * Un-inverting that first splits on the comma after "Hon. Weerasekera",
     * so the honorific travels with the surname to the END of the name and
     * the post-nominal is stranded in the middle:
     *
     *     "Dhanapala Philip Ranil, M.P. Hon. Weerasekera"
     *
     * Cleaning first leaves "Weerasekera, Dhanapala Philip Ranil", which
     * inverts correctly. This affected 920 of the 1,398 historical members.
     */
    const cleaned = canonicalNameFrom(row.name);
    const { display, inverted } = uninvertName(cleaned);
    // Cleaned AGAIN after inverting: one record is written
    // "Hon. Senanayake, Rt. Hon. D.S.", where the second honorific sits in the
    // given-name half and only reaches the front once the halves are swapped.
    const canonicalName = canonicalNameFrom(display);
    if (!canonicalName) continue;

    const base = slugify(canonicalName) || `member-${row.parliamentId}`;
    const slug = takenSlugs.has(base) ? `${base}-${row.parliamentId}` : base;
    takenSlugs.add(slug);

    const honorific = honorificFrom(row.name);
    const postNominal = postNominalFrom(row.name);
    const aliases = [...new Set([
      row.name.trim(),
      inverted,
      honorific ? `${honorific} ${canonicalName}` : null,
      postNominal ? `${canonicalName}, ${postNominal}` : null,
    ].filter((a): a is string => Boolean(a) && a !== canonicalName))];

    const detail = row.detail;
    const partyId = row.partyOnProfile ? slugify(row.partyOnProfile) : null;

    people.push({
      id: personId,
      slug,
      canonicalName,
      names: { en: canonicalName, si: null, ta: null },
      aliases,
      dateOfBirth: row.dateOfBirth,
      // The past-members directory records service, not deaths. A null here
      // is "not recorded", never "still living".
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
      biography: null,
      profession: row.profession,
      externalIds: { parliament: row.parliamentId },
      claim: claim(evidenceFor("person", personId, "canonicalName", row.parliamentId)),
      createdAt: RETRIEVED_AT,
      updatedAt: RETRIEVED_AT,
    });

    /* ------------------------------------------------------------ education */
    const drafts = [
      ...(detail?.qualifications?.academic ?? []).map(educationFromAcademicEntry),
      ...(detail?.qualifications?.professional ?? []).map(educationFromProfessionalEntry),
    ].filter((d): d is NonNullable<typeof d> => d !== null);

    for (const draft of drafts) {
      const id = educationIdFor(personId, draft.sourceText);
      if (education.some((e) => e.id === id)) continue;
      education.push({
        id, personId,
        educationType: draft.educationType,
        institution: draft.institution,
        qualification: draft.qualification,
        field: draft.field,
        examLevel: draft.examLevel,
        stream: draft.stream,
        startDate: draft.startDate,
        endDate: draft.endDate,
        completion: "unknown",
        sourceText: draft.sourceText,
        claim: claim(evidenceFor("education", id, "qualification", row.parliamentId)),
      });
    }

    /* ------------------------------------------------------------ positions */
    const ongoing = (d: { endDate: string | null }) => d.endDate === null;

    for (const draft of positionsFromTerms(detail?.legislativeHistory ?? [], null, precedenceFor(RoleType.MEMBER_OF_PARLIAMENT))) {
      const id = ongoing(draft)
        ? positionIdFor(personId, draft.title)
        : positionIdFor(personId, draft.title, draft.parliament ?? "");
      if (positions.some((p) => p.id === id)) continue;
      positions.push({
        id, personId, title: draft.title, roleType: draft.roleType,
        institution: draft.institution, ministry: null,
        districtId: null, constituency: draft.parliament,
        startDate: draft.startDate, endDate: draft.endDate, currentAsOf: null, endStatus: draft.endStatus,
        appointmentType: "unknown", precedence: draft.precedence,
        claim: claim(evidenceFor("position", id, "title", row.parliamentId)),
        createdAt: RETRIEVED_AT, updatedAt: RETRIEVED_AT,
      });
    }

    for (const draft of positionsFromServices(
      detail?.ministerialServices ?? [],
      splitCompoundRole, roleTypeForOffice, ministryFromTitle, precedenceFor,
    )) {
      const id = ongoing(draft)
        ? positionIdFor(personId, draft.title)
        : positionIdFor(personId, draft.title, draft.startDate ?? "");
      if (positions.some((p) => p.id === id)) continue;

      /*
       * The source contradicts itself, and this is where that is caught.
       *
       * parliament.lk publishes "Minister of Defence (1997-06-09 - to date)"
       * for a former President who left office in 2005 — while ALSO listing
       * her in the Directory of Past Members, whose whole meaning is that she
       * no longer sits. A ministerial office in Sri Lanka is held by virtue of
       * parliamentary membership, so the two statements cannot both hold.
       *
       * Believing the "to date" would put a former head of state on this site
       * as the sitting Defence Minister. Inventing an end date would be
       * fabrication. So the office is recorded as ended on an unrecorded date,
       * and the claim is marked CONFLICTING with the source's own wording kept
       * on the evidence — the disagreement is surfaced rather than resolved.
       */
      const staleOngoing = draft.endStatus === "ongoing";
      const evidenceIds = evidenceFor("position", id, "title", row.parliamentId);

      positions.push({
        id, personId, title: draft.title, roleType: draft.roleType,
        institution: draft.institution, ministry: draft.ministry,
        districtId: null, constituency: null,
        startDate: draft.startDate,
        endDate: draft.endDate,
        currentAsOf: null,
        endStatus: staleOngoing ? "not-recorded" : draft.endStatus,
        appointmentType: "unknown", precedence: draft.precedence,
        claim: staleOngoing
          ? { verification: VerificationState.CONFLICTING, evidenceIds, verifiedAt: null }
          : claim(evidenceIds),
        createdAt: RETRIEVED_AT, updatedAt: RETRIEVED_AT,
      });

      if (staleOngoing) {
        conflicts.push({
          personId,
          positionId: id,
          title: draft.title,
          detail:
            `Parliament's past-member profile states this office is held "to date" ` +
            `(from ${draft.startDate ?? "an unrecorded date"}), while listing the person in the ` +
            `Directory of Past Members. Recorded as ended on an unrecorded date; no end date invented.`,
        });
      }
    }

    /* ---------------------------------------------------------- affiliation */
    if (partyId && row.partyOnProfile) {
      const id = affiliationIdFor(personId, partyId);
      affiliations.push({
        id, personId, partyId, role: "member",
        // "Last Elected Party" names the party at their last election, with
        // no dates. Recording a start would invent one.
        startDate: null, endDate: null,
        claim: claim(evidenceFor("affiliation", id, "partyId", row.parliamentId)),
      });
    }

    /* --------------------------------------------------------------- status */
    // Derived from the positions just built, not asserted. Anyone in this
    // directory has left Parliament, but they may still hold another office.
    //
    // Derived through `isCurrent()` rather than a local rule. A second
    // definition of "current" living here would drift from the canonical one
    // — and it did: an earlier version tested `endDate === null` directly and
    // so ignored `endStatus`, reporting a former President as currently in
    // office because the source left her end date blank.
    const mine = positions.filter((p) => p.personId === personId);
    status.set(personId, mine.some((p) => isCurrent(p)) ? "current" : "former");

    searchIndex.set(personId, [
      canonicalName, row.name, inverted, ...aliases,
      row.partyOnProfile, row.profession,
      "Former Member of Parliament", "Former MP",
      ...mine.map((p) => p.title),
    ].filter(Boolean).join(" ").toLowerCase());
  }

  return { people, positions, education, affiliations, evidence, status, conflicts, searchIndex };
}

export const pastMembersDataset: PastMembersDataset = project();
