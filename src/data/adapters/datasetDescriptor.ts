/**
 * Javora — dataset mode.
 *
 * `mode` is the single switch governing how the interface describes its own
 * contents.
 *
 * It now reads "live": the records loaded are not a hand-entered sample.
 * They were retrieved from the official Parliament of Sri Lanka Directory of
 * Members by `scripts/import-parliament.mjs`, and every claim carries
 * evidence pointing at the specific member profile page it came from.
 *
 * WHAT "live" DOES AND DOES NOT ASSERT
 *
 * It asserts: these records came from an authoritative source, and each one
 * cites the exact document it came from. `normaliseClaim()` no longer forces
 * everything down to DEMONSTRATION, so records may reach SOURCE_LINKED.
 *
 * It does NOT assert that anything is VERIFIED. Nothing in this dataset is.
 * See `verificationForImportedFact()` in `sync/verificationPolicy.ts` for the
 * rule, and the README for why an official source alone is not verification.
 *
 * It does NOT assert that automatic synchronisation is running. No scheduler
 * or worker exists; the importer is a script a human runs. Every
 * `InstitutionalSource.syncState` still reads "not-connected" and every
 * `lastCheckedAt` is still null, because no automated check has happened.
 */

import type { DatasetDescriptor } from "../../types/models.ts";
import parliamentData from "../imported/parliamentMembers.json" with { type: "json" };

export const DATASET: DatasetDescriptor = {
  mode: "live",

  /**
   * When the loaded records were retrieved from the official source. Taken
   * from the import snapshot itself rather than typed by hand, so it cannot
   * drift away from the data it describes.
   */
  compiledOn: parliamentData.snapshot.retrievedAt.slice(0, 10),

  /**
   * How current the source's own content was. The Directory of Members
   * publishes no "as at" date, so this is the retrieval date and nothing
   * more — it is not a claim that the source itself was current then.
   */
  knownAsOf: parliamentData.snapshot.retrievedAt.slice(0, 10),
};

export const isDemonstration = (): boolean => DATASET.mode === "demonstration";

/** The snapshot the loaded records were parsed from. */
export const IMPORT_SNAPSHOT = parliamentData.snapshot;
