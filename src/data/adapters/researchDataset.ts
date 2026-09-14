/**
 * Javora — records promoted from research compilations.
 *
 * Kept in its own adapter, and its own JSON file, so that institutional facts
 * and research claims can never be mistaken for one another. Everything here
 * came from a document ABOUT sources rather than from a source, and carries
 * the file, line and verbatim sentence it was read from.
 *
 * VERIFICATION IS CAPPED BY PROVENANCE, NOT BY CONFIDENCE
 *
 * A record's state is decided by what its claim actually cited:
 *
 *   Tier 1 (an official institution, named with a document)
 *     → SOURCE_LINKED. Parliament's own caucus announcements land here.
 *
 *   Tier 2–4 (a news outlet, an aggregator, a self-declared "secondary
 *   corroboration", or nothing checkable)
 *     → SECONDARY_CORROBORATED, which the interface labels in those words.
 *
 * Nothing in this file can ever reach VERIFIED. Verification in Javora means
 * a human checked the record against an authoritative source on a stated
 * date; reading a claim out of a compilation is not that, however confidently
 * the compilation phrased it.
 */

import researchData from "../imported/researchDerived.json" with { type: "json" };
import {
  VerificationState,
  type Claim,
  type Education,
  type EducationType,
  type Employment,
  type PublicService,
  type SourceEvidence,
} from "../../types/models.ts";
import { educationIdFor, employmentIdFor, publicServiceIdFor, evidenceIdFor } from "../../sync/importRun.ts";

const RESEARCH_SOURCE_ID = "S900";

interface Provenance {
  tier: number;
  citedSource: string | null;
  sourceUrl: string | null;
  selfReportedStatus: string | null;
  file: string;
  line: number;
  rawText: string;
}

interface RawEducation {
  personId: string;
  educationType: string;
  institution: string | null;
  qualification: string | null;
  field: string | null;
  sourceText: string | null;
  provenance: Provenance;
}

interface RawCareer {
  personId: string;
  organisation: string;
  role: string | null;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
  provenance: Provenance;
}

const RAW = researchData as unknown as {
  generatedAt: string;
  education: RawEducation[];
  employment: RawCareer[];
  publicService: RawCareer[];
};

export interface ResearchDataset {
  education: Education[];
  employment: Employment[];
  publicService: PublicService[];
  evidence: SourceEvidence[];
}

const evidence: SourceEvidence[] = [];

/**
 * Evidence for a research-derived record.
 *
 * The locator is the file and line, which is the only thing about this claim
 * that can actually be checked without leaving the repository. `documentTitle`
 * records what the compilation SAID its source was — preserved verbatim,
 * including when that attribution is unverifiable.
 */
function researchEvidence(entityType: SourceEvidence["entityType"], entityId: string, p: Provenance): string[] {
  const id = evidenceIdFor({
    sourceId: RESEARCH_SOURCE_ID,
    entityType,
    entityId,
    fieldName: null,
    sourceUrl: p.sourceUrl,
  });
  if (!evidence.some((e) => e.id === id)) {
    evidence.push({
      id,
      sourceId: RESEARCH_SOURCE_ID,
      entityType,
      entityId,
      fieldName: null,
      sourceUrl: p.sourceUrl,
      documentTitle: p.citedSource
        ? `Cited as: ${p.citedSource}`
        : "No source cited by the research document",
      publishedAt: null,
      retrievedAt: RAW.generatedAt,
      // The one checkable thing about this claim: where to find it verbatim.
      locator: `${p.file}:${p.line}`,
      sourceRecordId: null,
      contentHash: null,
      // The verbatim sentence, kept on the evidence rather than discarded:
      // for a claim whose citation cannot be resolved, the exact wording is
      // the only thing a reviewer has to judge it by.
      notes: [
        p.selfReportedStatus ? `Document labelled this: ${p.selfReportedStatus}` : null,
        `Verbatim: ${p.rawText.slice(0, 300)}`,
      ].filter(Boolean).join(" · "),
    });
  }
  return [id];
}

/** Tier 1 keeps a document-linked state; everything weaker is secondary. */
function researchClaim(evidenceIds: string[], tier: number): Claim {
  return {
    verification: tier === 1
      ? VerificationState.SOURCE_LINKED
      : VerificationState.SECONDARY_CORROBORATED,
    evidenceIds,
    // Never set. A verification date would assert a check that never happened.
    verifiedAt: null,
  };
}

const EDUCATION_TYPES = new Set<EducationType>([
  "school", "university", "postgraduate", "professional", "other",
]);

function project(): ResearchDataset {
  const education: Education[] = [];
  const employment: Employment[] = [];
  const publicService: PublicService[] = [];

  for (const row of RAW.education ?? []) {
    // Keyed on the AWARD, not on the sentence it came from. Several
    // credentials routinely share one sentence ("he earned a Bachelor of Arts
    // (Honours) and a Ph.D."), and keying on the sentence gives them the same
    // id — so the second silently replaces the first and a person loses a
    // degree to a hash collision.
    const id = educationIdFor(row.personId, `${row.qualification ?? ""} ${row.field ?? ""}`.trim());
    if (education.some((e) => e.id === id)) continue;
    education.push({
      id,
      personId: row.personId,
      educationType: EDUCATION_TYPES.has(row.educationType as EducationType)
        ? (row.educationType as EducationType)
        : "other",
      institution: row.institution,
      qualification: row.qualification,
      field: row.field,
      examLevel: null,
      stream: null,
      // The compilations give no dates for any credential they add, and a
      // plausible date is still an invented one.
      startDate: null,
      endDate: null,
      completion: "unknown",
      sourceText: row.sourceText,
      claim: researchClaim(researchEvidence("education", id, row.provenance), row.provenance.tier),
    });
  }

  for (const row of RAW.employment ?? []) {
    const id = employmentIdFor(row.personId, row.organisation, row.role);
    if (employment.some((e) => e.id === id)) continue;
    employment.push({
      id,
      personId: row.personId,
      organisation: row.organisation,
      role: row.role,
      startDate: row.startDate,
      endDate: row.endDate,
      description: row.description,
      claim: researchClaim(researchEvidence("employment", id, row.provenance), row.provenance.tier),
    });
  }

  for (const row of RAW.publicService ?? []) {
    const id = publicServiceIdFor(row.personId, row.organisation, row.role);
    if (publicService.some((e) => e.id === id)) continue;
    publicService.push({
      id,
      personId: row.personId,
      organisation: row.organisation,
      role: row.role,
      startDate: row.startDate,
      endDate: row.endDate,
      description: row.description,
      claim: researchClaim(researchEvidence("public-service", id, row.provenance), row.provenance.tier),
    });
  }

  return { education, employment, publicService, evidence };
}

export const researchDataset: ResearchDataset = project();
