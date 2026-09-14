#!/usr/bin/env node
/**
 * Javora — reconcile the database onto every curated identity override.
 *
 *   node scripts/reconcile-identity-overrides.mjs [--dry]
 *
 * WHAT THIS FIXES
 *
 * `resolveCabinetIdentity.ts` now checks `data/identityOverrides.ts` before
 * its three fuzzy rules, so a Cabinet Office sync run started AFTER the
 * override existed resolves straight onto the override's target person — no
 * duplicate is ever created. But a run that happened BEFORE the override
 * existed already wrote a separate, isolated person under the Cabinet
 * Office's own id-space (`cabinetOffice:<slug>`), and nothing about adding
 * the override retroactively fixes a row already sitting in the database.
 *
 * This script is that one-time fix, and it is safe to run repeatedly (a
 * second run finds nothing left to reconcile). Two steps:
 *
 *   1. RE-SYNC Cabinet with `force: true`, so it re-evaluates every name
 *      against the override even though the roster's content hasn't
 *      changed. Once `promote-past-members.mjs` has run, the override's
 *      target person (e.g. `parliament:112`) exists, so this attaches the
 *      Cabinet Office's current positions (President, Minister of Defence,
 *      etc.) directly to it.
 *   2. REMOVE the now-orphaned pre-override person this same override
 *      predicted — the exact id the OLD unresolved path would have minted
 *      (`cabinetOffice:${slugify(cabinetName)}`) — but only when the
 *      override's real target already exists under a DIFFERENT id, so this
 *      never deletes the one and only record of a person.
 *
 * `source_evidence` is polymorphic (entity_type/entity_id, no foreign key),
 * so removing a person does not cascade to it the way `position` and
 * `person_alias` do. Evidence for the orphan's person record and its
 * positions is deleted explicitly, in the same transaction, before the
 * position rows that named it are gone.
 */

import { openMigrated } from "../server/db/database.ts";
import { CanonicalStore } from "../server/db/store.ts";
import { createCabinetConnector } from "../server/fetchers/cabinetConnector.ts";
import { createCabinetResolver } from "../server/sync/resolveCabinetIdentity.ts";
import { syncSource } from "../server/sync/syncSource.ts";
import { IDENTITY_OVERRIDES } from "../src/data/identityOverrides.ts";
import { slugify } from "../src/lib/slug.ts";

const DRY = process.argv.includes("--dry");

async function main() {
  const db = openMigrated();
  const store = new CanonicalStore(db);

  console.log(`SL Politics identity-override reconciliation${DRY ? " [dry run]" : ""}`);

  // ---- 1. re-sync Cabinet so it resolves onto every override's target ----
  console.log("\nRe-syncing Cabinet Office against current overrides...");
  const result = await syncSource(
    store,
    createCabinetConnector({ resolvePerson: createCabinetResolver(store) }),
    { trigger: "manual", force: true, dryRun: DRY },
  );
  console.log(
    `  outcome=${result.outcome} seen=${result.counts.seen} created=${result.counts.created} ` +
      `updated=${result.counts.updated} unchanged=${result.counts.unchanged}` +
      (result.error ? ` error=${result.error}` : ""),
  );
  if (result.outcome === "failed") {
    console.error("Cabinet re-sync failed; leaving any pre-existing duplicates untouched.");
    db.close();
    process.exit(1);
  }

  // ---- 2. remove any now-orphaned pre-override duplicate -----------------
  console.log("\nChecking for pre-override duplicates...");
  let removed = 0;
  for (const override of IDENTITY_OVERRIDES) {
    const staleId = `cabinetOffice:${slugify(override.cabinetName)}`;
    if (staleId === override.personId) continue; // the override's target IS this id-space; nothing to merge.

    const target = store.getPerson(override.personId);
    const stale = store.getPerson(staleId);
    if (!target || !stale) continue; // nothing to reconcile — either side missing.

    console.log(`  found orphan ${staleId} — target ${override.personId} (${target.canonical_name}) exists`);
    if (DRY) { removed++; continue; }

    db.transaction(() => {
      const stalePositions = db.all("SELECT id FROM position WHERE person_id = ?", [staleId]);
      for (const { id } of stalePositions) {
        db.run("DELETE FROM source_evidence WHERE entity_type = 'position' AND entity_id = ?", [id]);
      }
      db.run("DELETE FROM source_evidence WHERE entity_type = 'person' AND entity_id = ?", [staleId]);
      db.run("DELETE FROM source_evidence WHERE entity_type = 'affiliation' AND entity_id IN " +
        "(SELECT id FROM political_affiliation WHERE person_id = ?)", [staleId]);
      // position, person_alias, person_external_id, person_search and
      // political_affiliation all carry ON DELETE CASCADE on person_id.
      db.run("DELETE FROM person WHERE id = ?", [staleId]);
    })();
    removed++;
    console.log(`    removed ${staleId} — its positions were re-attached to ${override.personId} in step 1`);
  }

  if (!removed) console.log("  none found — already reconciled.");

  db.close();
}

main().catch((e) => { console.error("Reconciliation failed:", e); process.exit(1); });
