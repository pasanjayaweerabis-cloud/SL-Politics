#!/usr/bin/env node
/**
 * Javora — promote Parliament profile detail into canonical tables.
 *
 *   node --experimental-strip-types scripts/promote-detail.mjs [--dry]
 *
 * Reads the imported Parliament snapshot, applies the same pure mapping the
 * front end uses, and writes education rows and dated positions into the
 * database.
 *
 * WHY THIS IS A SEPARATE STEP
 *
 * Retrieval, mapping and promotion are deliberately three things. The importer
 * fetches and records what the source said; the mapping decides what that
 * means; this script is the only place either becomes canonical. Keeping them
 * apart is what makes a mapping change re-runnable against an existing
 * snapshot without touching the network, and what makes "the source changed"
 * distinguishable from "our reading of it changed".
 *
 * IDEMPOTENT. Ids are deterministic, every write is an upsert, and a second
 * run against the same snapshot changes nothing.
 *
 * WHAT IT DOES NOT PROMOTE
 *
 * Research-derived records. Those live in `research_claim` and in the separate
 * front-end file, and are never mixed into the tables that hold institutional
 * facts.
 */

import { readFile } from "node:fs/promises";

import { openMigrated } from "../server/db/database.ts";
import {
  educationFromAcademicEntry, educationFromProfessionalEntry,
  positionsFromTerms, positionsFromServices,
} from "../src/data/adapters/profileDetailMapping.ts";
import {
  splitCompoundRole, roleTypeForOffice, ministryFromTitle,
} from "../src/sync/connectors/parliament.ts";
import { precedenceFor } from "../src/data/roles.ts";
import { personIdFor, positionIdFor, educationIdFor, evidenceIdFor } from "../src/sync/importRun.ts";
import { RoleType } from "../src/types/models.ts";
import { slugify } from "../src/lib/slug.ts";

const DRY = process.argv.includes("--dry");
const SNAPSHOT = "src/data/imported/parliamentMembers.json";
const SOURCE_ID = "S001";

/** The exact document a member's facts came from — not the directory index. */
const profileUrl = (parliamentId) =>
  `https://www.parliament.lk/en/members-of-parliament/mp-profile/${parliamentId}`;

async function main() {
  const now = new Date().toISOString();
  const payload = JSON.parse(await readFile(SNAPSHOT, "utf8"));
  console.log(`SL Politics detail promotion — snapshot ${payload.snapshot.retrievedAt} (${payload.snapshot.parserVersion})${DRY ? " [dry run]" : ""}`);

  const db = openMigrated();
  const known = new Set(db.all("SELECT id FROM person").map((r) => r.id));

  const counts = {
    people: 0, educationInserted: 0, educationSkipped: 0, evidenceWritten: 0,
    examRows: 0, positionsDated: 0, positionsInserted: 0, unknownPeople: 0,
  };

  if (!DRY) db.run("BEGIN");

  for (const member of payload.members) {
    const personId = personIdFor("parliament", member.parliamentId);
    if (!known.has(personId)) { counts.unknownPeople++; continue; }
    counts.people++;

    const detail = member.detail;
    if (!detail) continue;

    /* ------------------------------------------------------------ education */
    const drafts = [
      ...(detail.qualifications?.academic ?? []).map(educationFromAcademicEntry),
      ...(detail.qualifications?.professional ?? []).map(educationFromProfessionalEntry),
    ].filter(Boolean);

    for (const draft of drafts) {
      const id = educationIdFor(personId, draft.sourceText);
      if (draft.examLevel) counts.examRows++;
      if (!DRY) {
        db.run(
          `INSERT INTO education (
             id, person_id, education_type, institution, qualification, field,
             exam_level, stream, start_date, end_date, completion, source_text,
             verification, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             education_type = excluded.education_type,
             institution = excluded.institution,
             qualification = excluded.qualification,
             field = excluded.field,
             exam_level = excluded.exam_level,
             stream = excluded.stream,
             end_date = excluded.end_date,
             source_text = excluded.source_text,
             updated_at = excluded.updated_at`,
          [
            id, personId, draft.educationType, draft.institution, draft.qualification,
            draft.field, draft.examLevel, draft.stream, draft.startDate, draft.endDate,
            // Parliament lists awards held; it never states whether a course
            // was completed, and "listed" is not "completed".
            "unknown", draft.sourceText,
            // Source-linked, never verified: Javora links the exact page, but
            // nobody has confirmed Javora read that page correctly.
            "source-linked", now, now,
          ],
        );

        /*
         * The evidence row backing that "source-linked" claim.
         *
         * Without this the qualification asserts source-linkage that nothing
         * in the database can substantiate — the exact gap the integrity
         * review found: 299 education records claiming a verification state
         * with no `source_evidence` row of any kind behind them. The profile
         * page is the document; the snapshot supplies the retrieval time.
         */
        writeEvidence(db, {
          entityType: "education",
          entityId: id,
          fieldName: null,
          sourceUrl: profileUrl(member.parliamentId),
          documentTitle: draft.qualification ?? draft.institution,
          retrievedAt: payload.snapshot.retrievedAt,
          sourceRecordId: String(member.parliamentId),
          // The source's own wording, so a misclassification stays auditable.
          notes: draft.sourceText,
          now,
        });
        counts.evidenceWritten++;
      }
      counts.educationInserted++;
    }

    /* ------------------------------------------------------------ positions */
    const districtId = member.district ? slugify(member.district) : null;

    const termDrafts = positionsFromTerms(
      detail.legislativeHistory ?? [], districtId, precedenceFor(RoleType.MEMBER_OF_PARLIAMENT));
    const serviceDrafts = positionsFromServices(
      detail.ministerialServices ?? [],
      splitCompoundRole, roleTypeForOffice, ministryFromTitle, precedenceFor);

    /*
     * The CURRENT spell of an office keeps the id it already had; only past
     * spells get a discriminated id.
     *
     * Without this the promotion inserts a second, dated "Member of
     * Parliament" beside the existing undated one and the office appears
     * twice — the record improved and the reader's view got worse. Reusing
     * the established id updates the row in place instead, which keeps ids
     * stable for anything already referencing them and turns the addition of
     * history into an append rather than a rewrite.
     */
    const ongoing = (d) => d.endDate === null;

    /*
     * The evidence row backing a PAST spell's "source-linked" claim.
     *
     * Only past spells: the current spell's position row keeps the id the
     * live sync connector already established (see `ongoing` above), and
     * that connector already writes its own evidence at that id
     * (server/sync/syncSource.ts) — duplicating it here, from a different
     * source snapshot, risks nothing structurally but adds nothing either.
     * A PAST spell exists ONLY because this script promoted it: without this,
     * every dated term/service this promotion adds asserts source-linkage
     * that nothing in the database can substantiate — the same gap the
     * integrity review found for education, fixed above the same way.
     */
    for (const draft of termDrafts) {
      const id = ongoing(draft)
        ? positionIdFor(personId, draft.title)
        : positionIdFor(personId, draft.title, draft.parliament ?? "");
      if (!DRY) {
        upsertPosition(db, id, personId, draft, now);
        if (!ongoing(draft)) {
          writeEvidence(db, {
            entityType: "position",
            entityId: id,
            fieldName: "title",
            sourceUrl: profileUrl(member.parliamentId),
            documentTitle: draft.title,
            retrievedAt: payload.snapshot.retrievedAt,
            sourceRecordId: String(member.parliamentId),
            notes: null,
            now,
          });
          counts.evidenceWritten++;
        }
      }
      counts.positionsInserted++;
      if (draft.startDate) counts.positionsDated++;
    }
    for (const draft of serviceDrafts) {
      const id = ongoing(draft)
        ? positionIdFor(personId, draft.title)
        : positionIdFor(personId, draft.title, draft.startDate ?? "");
      if (!DRY) {
        upsertPosition(db, id, personId, draft, now);
        if (!ongoing(draft)) {
          writeEvidence(db, {
            entityType: "position",
            entityId: id,
            fieldName: "title",
            sourceUrl: profileUrl(member.parliamentId),
            documentTitle: draft.title,
            retrievedAt: payload.snapshot.retrievedAt,
            sourceRecordId: String(member.parliamentId),
            notes: null,
            now,
          });
          counts.evidenceWritten++;
        }
      }
      counts.positionsInserted++;
      if (draft.startDate) counts.positionsDated++;
    }
  }

  if (!DRY) db.run("COMMIT");

  console.log("\nPromotion result:");
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(20)} ${v}`);

  if (!DRY) {
    console.log("\nCanonical table counts after promotion:");
    for (const t of ["person", "position", "education", "exam_result", "employment", "public_service"]) {
      console.log(`  ${t.padEnd(18)} ${db.all(`SELECT COUNT(*) AS n FROM ${t}`)[0].n}`);
    }
    console.log("\nEducation by type:");
    for (const r of db.all("SELECT education_type, COUNT(*) AS n FROM education GROUP BY education_type ORDER BY n DESC")) {
      console.log(`  ${r.education_type.padEnd(14)} ${r.n}`);
    }
    console.log("\nExamination rows (qualification recorded, no grades):");
    for (const r of db.all("SELECT exam_level, COUNT(*) AS n FROM education WHERE exam_level IS NOT NULL GROUP BY exam_level")) {
      console.log(`  ${r.exam_level.padEnd(14)} ${r.n}`);
    }
    console.log(`  exam_result rows (actual grades): ${db.all("SELECT COUNT(*) AS n FROM exam_result")[0].n}`);
  }
  db.close();
}

/**
 * Upsert one position.
 *
 * `current_as_of` is written as NULL whenever a real start date exists: a
 * position must never carry both a start date and the dated-observation
 * fallback, or it holds two competing accounts of when it began.
 */
function upsertPosition(db, id, personId, draft, now) {
  db.run(
    `INSERT INTO position (
       id, person_id, title, role_type, institution, ministry, district_id,
       constituency, start_date, end_date, current_as_of, appointment_type,
       precedence, verification, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       start_date = excluded.start_date,
       end_date = excluded.end_date,
       current_as_of = excluded.current_as_of,
       ministry = excluded.ministry,
       role_type = excluded.role_type,
       updated_at = excluded.updated_at`,
    [
      id, personId, draft.title, draft.roleType, draft.institution, draft.ministry,
      draft.districtId, draft.parliament ?? null,
      draft.startDate, draft.endDate,
      draft.startDate ? null : draft.currentAsOf,
      "unknown", draft.precedence, "source-linked", now, now,
    ],
  );
}

/** Upsert one source_evidence row backing a "source-linked" claim this script made. */
function writeEvidence(db, { entityType, entityId, fieldName, sourceUrl, documentTitle, retrievedAt, sourceRecordId, notes, now }) {
  db.run(
    `INSERT INTO source_evidence
       (id, source_id, entity_type, entity_id, field_name, source_url,
        document_title, published_at, retrieved_at, locator, source_record_id,
        content_hash, snapshot_id, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, NULL, NULL, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       source_url = excluded.source_url,
       document_title = excluded.document_title,
       retrieved_at = excluded.retrieved_at,
       notes = excluded.notes`,
    [
      evidenceIdFor({ sourceId: SOURCE_ID, entityType, entityId, fieldName, sourceUrl }),
      SOURCE_ID,
      entityType,
      entityId,
      fieldName,
      sourceUrl,
      documentTitle,
      retrievedAt,
      sourceRecordId,
      notes,
      now,
    ],
  );
}

main().catch((e) => { console.error("Promotion failed:", e); process.exit(1); });
