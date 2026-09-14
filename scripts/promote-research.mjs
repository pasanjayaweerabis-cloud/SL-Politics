#!/usr/bin/env node
/**
 * Javora — promote research-derived education/career records into the database.
 *
 *   node scripts/promote-research.mjs [--dry]
 *
 * THE GAP THIS CLOSES
 *
 * `scripts/import-research.mjs` already does the hard part correctly: it
 * stages every claim in `research_claim`, matches each to a canonical person,
 * and disposes it against what Parliament's own record already says —
 * `corroborates` (already known, nothing written), `conflict` (Parliament
 * disagrees, nothing overwritten), `rejected` (too weak or out of scope), or
 * `promoted` (Parliament is silent, so this is genuinely new). Only
 * `promoted` claims carry a `credentials`/`entity` payload at all — see
 * `server/research/reconcileResearch.ts`'s `disposeClaim`.
 *
 * What that script does with a `promoted` claim, though, is write it to
 * `src/data/imported/researchDerived.json` — a bundle-only file — and never
 * to the database. `researchDataset.ts` (the bundle adapter reading that
 * file) is already merged into the bundle's rendering path in
 * `repository.ts`; the database has never seen any of it. This script is the
 * missing last step: it reads the SAME already-reconciled dataset the bundle
 * renders from and writes it into `education`, `employment` and
 * `public_service` via `CanonicalStore`, so a re-run changes nothing.
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not re-run reconciliation and does not read the research .txt
 * files directly — that decision (corroborates/conflict/rejected/promoted)
 * already happened and is not repeated or second-guessed here. Verification
 * state is carried through exactly as `researchDataset.ts` computed it
 * (`secondary-corroborated`, or `source-linked` for a Tier 1 citation) —
 * never upgraded to `verified`, which only a human confirming against an
 * authoritative source on a stated date may do.
 */

import { openMigrated } from "../server/db/database.ts";
import { CanonicalStore } from "../server/db/store.ts";
import { researchDataset } from "../src/data/adapters/researchDataset.ts";

const DRY = process.argv.includes("--dry");
const RESEARCH_SOURCE_ID = "S900";

function tableCounts(db) {
  const n = (t) => db.get(`SELECT COUNT(*) AS n FROM ${t}`).n;
  return { education: n("education"), employment: n("employment"), public_service: n("public_service"), source_evidence: n("source_evidence") };
}

async function main() {
  console.log(`SL Politics research-derived promotion — ${researchDataset.education.length} education, ` +
    `${researchDataset.employment.length} employment, ${researchDataset.publicService.length} public-service records` +
    (DRY ? " [dry run]" : ""));

  const db = openMigrated();
  const store = new CanonicalStore(db);
  const before = tableCounts(db);
  const knownPeople = new Set(db.all("SELECT id FROM person").map((r) => r.id));

  const counts = { educationWritten: 0, educationSkippedUnknownPerson: 0,
    employmentWritten: 0, employmentSkippedUnknownPerson: 0,
    publicServiceWritten: 0, publicServiceSkippedUnknownPerson: 0, evidenceWritten: 0 };

  if (!DRY) db.run("BEGIN");

  try {
    const stamp = new Date().toISOString();

    for (const edu of researchDataset.education) {
      if (!knownPeople.has(edu.personId)) { counts.educationSkippedUnknownPerson++; continue; }
      if (!DRY) {
        // Raw SQL, matching promote-detail.mjs and promote-past-members.mjs:
        // store.upsertEducation requires a non-null institution, which every
        // one of these records lacks (the research files name an award
        // without naming a university) — the exact case migration 003 made
        // the column nullable for.
        db.run(
          `INSERT INTO education (
             id, person_id, education_type, institution, qualification, field,
             exam_level, stream, start_date, end_date, completion, source_text,
             verification, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             education_type = excluded.education_type, institution = excluded.institution,
             qualification = excluded.qualification, field = excluded.field,
             exam_level = excluded.exam_level, stream = excluded.stream,
             end_date = excluded.end_date, source_text = excluded.source_text,
             verification = excluded.verification, updated_at = excluded.updated_at`,
          [
            edu.id, edu.personId, edu.educationType, edu.institution, edu.qualification,
            edu.field, edu.examLevel, edu.stream, edu.startDate, edu.endDate,
            edu.completion, edu.sourceText, edu.claim.verification, stamp, stamp,
          ],
        );
      }
      counts.educationWritten++;
    }

    for (const job of researchDataset.employment) {
      if (!knownPeople.has(job.personId)) { counts.employmentSkippedUnknownPerson++; continue; }
      if (!DRY) {
        store.upsertEmployment({
          id: job.id, personId: job.personId, organisation: job.organisation,
          title: job.role, description: job.description,
          startDate: job.startDate, endDate: job.endDate,
          verification: job.claim.verification,
        });
      }
      counts.employmentWritten++;
    }

    for (const svc of researchDataset.publicService) {
      if (!knownPeople.has(svc.personId)) { counts.publicServiceSkippedUnknownPerson++; continue; }
      if (!DRY) {
        store.upsertPublicService({
          id: svc.id, personId: svc.personId, institution: svc.organisation, role: svc.role,
          startDate: svc.startDate, endDate: svc.endDate,
          verification: svc.claim.verification,
        });
      }
      counts.publicServiceWritten++;
    }

    for (const evidence of researchDataset.evidence) {
      if (!DRY) {
        store.upsertEvidence({
          id: evidence.id, sourceId: evidence.sourceId ?? RESEARCH_SOURCE_ID, entityType: evidence.entityType,
          entityId: evidence.entityId, fieldName: evidence.fieldName, sourceUrl: evidence.sourceUrl,
          documentTitle: evidence.documentTitle, retrievedAt: evidence.retrievedAt,
          locator: evidence.locator, notes: evidence.notes,
        });
      }
      counts.evidenceWritten++;
    }

    if (!DRY) db.run("COMMIT");
  } catch (error) {
    if (!DRY) db.run("ROLLBACK");
    throw error;
  }

  const after = DRY ? before : tableCounts(db);

  console.log("\nPromotion result:");
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(32)} ${v}`);

  console.log("\nCanonical table counts, before -> after:");
  for (const t of Object.keys(before)) console.log(`  ${t.padEnd(16)} ${before[t]} -> ${after[t]}`);

  db.close();
}

main().catch((e) => { console.error("Research promotion failed:", e); process.exit(1); });
