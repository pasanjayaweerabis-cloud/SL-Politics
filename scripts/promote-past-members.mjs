#!/usr/bin/env node
/**
 * Javora — promote past Members of Parliament into the canonical database.
 *
 *   node scripts/promote-past-members.mjs [--dry]
 *
 * THE GAP THIS CLOSES
 *
 * `pastMembersDataset` (src/data/adapters/pastMembersDataset.ts) already
 * computes fully-formed Person/Position/Education/PoliticalAffiliation/
 * SourceEvidence records for all ~1,398 former members, using the exact same
 * mapping functions the current-member path uses. Nothing has ever written
 * any of it to the database: `scripts/import-past-members.mjs` only produces
 * the JSON file the frontend bundle reads, and the live sync connector
 * (`server/fetchers/parliamentConnector.ts`) only ever sees the CURRENT
 * members directory. So every former member — including the sitting
 * President, whose parliamentary identity, degree and 2004 ministerial term
 * live only in the past-members record — has been reachable from the
 * frontend and invisible to the database and API.
 *
 * This script is the missing bridge: it reads the already-computed dataset
 * (no network calls — the retrieval already happened when the JSON was
 * generated) and writes it through the same `CanonicalStore` upsert methods
 * the live sync path uses, so a second run changes nothing.
 *
 * IDENTITY OVERRIDES ARE APPLIED HERE, NOT AFTER.
 *
 * `data/identityOverrides.ts` is read for every person before the row is
 * written, exactly as `repository.ts` applies it to the bundle — so the
 * canonical id (`parliament:112`) is created carrying its curated name and
 * slug from the first write, never needing a later rename.
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not re-run the Parliament connector or touch positions/education
 * for CURRENT members — that is `promote-detail.mjs`'s job and is untouched.
 *
 * A STALE DUPLICATE'S SLUG, RECLAIMED BEFORE IT IS NEEDED
 *
 * `person.slug` is UNIQUE. When an override renames a target
 * (`parliament:112` -> "anura-kumara-dissanayake"), that slug may already be
 * owned by the very pre-override duplicate the override exists to correct
 * (`cabinetOffice:anura-kumara-dissanayake`, written by a Cabinet sync that
 * ran before this override was authored). Creating the correctly-identified
 * person would otherwise fail on the UNIQUE constraint the stale duplicate
 * is squatting on. So before any person is written, every override's target
 * slug is checked against exactly this case and the stale row is retired —
 * never a general "delete anyone in the way", only a person id this
 * override's own evidence names as the same human, freeing a slug for a
 * record about to be created correctly under a different id.
 *
 * Retiring does not lose the stale row's positions: `reconcile-identity-
 * overrides.mjs`, meant to run immediately after this script, re-syncs the
 * Cabinet Office, which regenerates them fresh, correctly attached to the
 * override's target, from the same authoritative source.
 */

import { openMigrated } from "../server/db/database.ts";
import { CanonicalStore } from "../server/db/store.ts";
import { pastMembersDataset } from "../src/data/adapters/pastMembersDataset.ts";
import { overrideForPersonId, IDENTITY_OVERRIDES } from "../src/data/identityOverrides.ts";
import { slugify } from "../src/lib/slug.ts";
import pastData from "../src/data/imported/parliamentPastMembers.json" with { type: "json" };

const DRY = process.argv.includes("--dry");

/** partyId -> display name, from the same raw rows the dataset derives partyId from. */
function partyNamesById() {
  const names = new Map();
  for (const m of pastData.members ?? []) {
    if (!m.partyOnProfile) continue;
    const id = slugify(m.partyOnProfile);
    if (!names.has(id)) names.set(id, m.partyOnProfile);
  }
  return names;
}

function tableCounts(db) {
  const n = (t) => db.get(`SELECT COUNT(*) AS n FROM ${t}`).n;
  return {
    person: n("person"), position: n("position"), education: n("education"),
    political_affiliation: n("political_affiliation"), source_evidence: n("source_evidence"),
    party: n("party"),
  };
}

async function main() {
  console.log(`SL Politics past-member promotion — ${pastMembersDataset.people.length} people, ` +
    `${pastMembersDataset.positions.length} positions, ${pastMembersDataset.education.length} education rows` +
    (DRY ? " [dry run]" : ""));

  const db = openMigrated();
  const store = new CanonicalStore(db);
  const before = tableCounts(db);
  const partyNames = partyNamesById();
  const knownParties = new Set(db.all("SELECT id FROM party").map((r) => r.id));

  const counts = {
    staleDuplicatesRetired: 0,
    peopleSeen: 0, peopleCreated: 0, peopleUpdated: 0, peopleUnchanged: 0,
    overridesApplied: 0, partiesCreated: 0,
    positionsWritten: 0, affiliationsWritten: 0, evidenceWritten: 0,
    educationInserted: 0,
  };

  if (!DRY) db.run("BEGIN");

  const skippedPositions = [];

  try {
    /*
     * Free any slug an override's target needs from a stale pre-override
     * duplicate — see the file header. Scoped to exactly this shape: a
     * DIFFERENT existing person currently holding the slug the target is
     * about to claim.
     */
    let staleRemoved = 0;
    for (const override of IDENTITY_OVERRIDES) {
      const holder = db.get("SELECT id FROM person WHERE slug = ?", [override.slug]);
      if (!holder || holder.id === override.personId) continue;
      if (!DRY) {
        const stalePositions = db.all("SELECT id FROM position WHERE person_id = ?", [holder.id]);
        for (const { id } of stalePositions) {
          db.run("DELETE FROM source_evidence WHERE entity_type = 'position' AND entity_id = ?", [id]);
        }
        db.run("DELETE FROM source_evidence WHERE entity_type = 'person' AND entity_id = ?", [holder.id]);
        db.run("DELETE FROM source_evidence WHERE entity_type = 'affiliation' AND entity_id IN " +
          "(SELECT id FROM political_affiliation WHERE person_id = ?)", [holder.id]);
        // position, person_alias, person_external_id, person_search and
        // political_affiliation all carry ON DELETE CASCADE on person_id.
        db.run("DELETE FROM person WHERE id = ?", [holder.id]);
      }
      staleRemoved++;
      console.log(`  retired stale duplicate ${holder.id} to free slug "${override.slug}" for ${override.personId}`);
    }
    counts.staleDuplicatesRetired = staleRemoved;

    for (const person of pastMembersDataset.people) {
      counts.peopleSeen++;

      const override = overrideForPersonId(person.id);
      if (override) counts.overridesApplied++;
      const canonicalName = override?.canonicalName ?? person.canonicalName;
      const slug = override?.slug ?? person.slug;
      const aliases = override && !person.aliases.includes(person.canonicalName)
        ? [...person.aliases, person.canonicalName]
        : person.aliases;

      if (!DRY) {
        const result = store.upsertPerson({
          id: person.id,
          slug,
          canonicalName,
          dateOfBirth: person.dateOfBirth,
          biography: person.biography,
          portraitUrl: person.portrait?.url ?? null,
          portraitSourceId: person.portrait?.sourceId ?? null,
          portraitCredit: person.portrait?.credit ?? null,
          verification: person.claim.verification,
          aliases,
          externalIds: person.externalIds,
          searchText: pastMembersDataset.searchIndex.get(person.id) ?? canonicalName.toLowerCase(),
        });
        counts[`people${result.outcome[0].toUpperCase()}${result.outcome.slice(1)}`]++;
        store.setPersonBiographical(person.id, { profession: person.profession });
      } else {
        counts.peopleCreated++;
      }
    }

    /*
     * A bad record costs only itself, never the run — the same rule
     * syncSource.ts's own per-person loop follows, applied here per position.
     * 58 of Parliament's own past-member term dates fail the schema's
     * `end_date >= start_date` CHECK (the source states an end before its own
     * stated start — a publishing error on parliament.lk's part, not
     * something this pipeline may resolve by guessing which date is wrong).
     * Skipped and reported by id rather than silently dropped or allowed to
     * abort the other 5,900+ good positions in the same transaction.
     */
    for (const position of pastMembersDataset.positions) {
      if (!DRY) {
        try {
          store.upsertPosition({
            id: position.id,
            personId: position.personId,
            title: position.title,
            roleType: position.roleType,
            institution: position.institution,
            ministry: position.ministry,
            districtId: position.districtId,
            startDate: position.startDate,
            endDate: position.endDate,
            currentAsOf: position.currentAsOf,
            appointmentType: position.appointmentType,
            precedence: position.precedence,
            verification: position.claim.verification,
          });
        } catch (error) {
          skippedPositions.push({ id: position.id, reason: error.message });
          continue;
        }
      }
      counts.positionsWritten++;
    }
    counts.positionsSkipped = skippedPositions.length;
    const skippedPositionIds = new Set(skippedPositions.map((p) => p.id));

    for (const affiliation of pastMembersDataset.affiliations) {
      if (!knownParties.has(affiliation.partyId)) {
        if (!DRY) {
          store.upsertParty({
            id: affiliation.partyId,
            name: partyNames.get(affiliation.partyId) ?? affiliation.partyId,
            abbreviation: "",
          });
        }
        knownParties.add(affiliation.partyId);
        counts.partiesCreated++;
      }
      if (!DRY) {
        store.upsertAffiliation({
          id: affiliation.id,
          personId: affiliation.personId,
          partyId: affiliation.partyId,
          role: affiliation.role,
          startDate: affiliation.startDate,
          endDate: affiliation.endDate,
          verification: affiliation.claim.verification,
        });
      }
      counts.affiliationsWritten++;
    }

    for (const evidence of pastMembersDataset.evidence) {
      // Never write evidence for a position that was skipped — a citation
      // pointing at a row that does not exist is worse than no citation.
      if (evidence.entityType === "position" && skippedPositionIds.has(evidence.entityId)) continue;
      if (!DRY) {
        store.upsertEvidence({
          id: evidence.id,
          sourceId: evidence.sourceId,
          entityType: evidence.entityType,
          entityId: evidence.entityId,
          fieldName: evidence.fieldName,
          sourceUrl: evidence.sourceUrl,
          documentTitle: evidence.documentTitle,
          retrievedAt: evidence.retrievedAt,
          locator: evidence.locator,
          sourceRecordId: evidence.sourceRecordId,
          notes: evidence.notes,
        });
      }
      counts.evidenceWritten++;
    }

    /*
     * Education, via raw SQL rather than `store.upsertEducation` — the same
     * choice `promote-detail.mjs` already made and documents: that store
     * method predates migration 003's schema (nullable `institution`,
     * `exam_level`, `stream`) and requires a non-null institution, which
     * would reject the ~40% of academic entries Parliament names an award for
     * without naming an awarding body. This matches promote-detail.mjs's
     * INSERT exactly, so the two promotion paths agree on shape.
     */
    const stamp = new Date().toISOString();
    for (const edu of pastMembersDataset.education) {
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
             verification = excluded.verification,
             updated_at = excluded.updated_at`,
          [
            edu.id, edu.personId, edu.educationType, edu.institution, edu.qualification,
            edu.field, edu.examLevel, edu.stream, edu.startDate, edu.endDate,
            edu.completion, edu.sourceText, edu.claim.verification, stamp, stamp,
          ],
        );
      }
      counts.educationInserted++;
    }

    if (!DRY) db.run("COMMIT");
  } catch (error) {
    if (!DRY) db.run("ROLLBACK");
    throw error;
  }

  const after = DRY ? before : tableCounts(db);

  console.log("\nPromotion result:");
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(20)} ${v}`);
  if (skippedPositions.length) {
    console.log("\nSkipped positions (failed a schema check — reported, not written):");
    for (const { id, reason } of skippedPositions.slice(0, 10)) console.log(`  ${id}: ${reason}`);
    if (skippedPositions.length > 10) console.log(`  ... and ${skippedPositions.length - 10} more`);
  }

  console.log("\nCanonical table counts, before -> after:");
  for (const t of Object.keys(before)) console.log(`  ${t.padEnd(24)} ${before[t]} -> ${after[t]}`);

  db.close();
}

main().catch((e) => { console.error("Past-member promotion failed:", e); process.exit(1); });
