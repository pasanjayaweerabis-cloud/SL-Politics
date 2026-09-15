import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { allPeople, evidenceFor } from "../../src/services/repository.ts";

/**
 * Javora — the two canonical stores must agree where they overlap.
 *
 * This project has two write paths and they do not share state:
 *
 *   A. scripts/import-*.mjs -> src/data/imported/*.json -> adapters ->
 *      services/repository.ts   (what 99% of the site renders)
 *   B. server/fetchers/* -> server/sync/syncSource.ts -> CanonicalStore
 *      -> /api/**              (what the API serves)
 *
 * They share their PARSERS, which prevents the worst class of divergence. They
 * do not share STATE, and until this file nothing checked that they agree
 * about anything. The audit called this the biggest data-integrity gap in the
 * repository; this converts it from an invisible risk into a named one.
 *
 * WHAT THIS DELIBERATELY DOES NOT ASSERT. Historically the two stores were not
 * the same size: the database held only the 225 current members the live
 * sync connector wrote, while 1,398 past members existed only in the bundle
 * (scripts/import-past-members.mjs writes JSON and, until
 * scripts/promote-past-members.mjs, never touched the database at all). As of
 * 1 September 2026 that gap is closed — `promote-past-members.mjs` promotes
 * the same past-member records the bundle already computes into the
 * database, so both stores now hold the same 1,623-person universe. This file
 * still compares the OVERLAP rather than asserting exact equality, because a
 * position that fails a schema check (58 of Parliament's own past-member term
 * dates have an end before their start — a publishing error on the source's
 * part) is skipped on the database side rather than silently invented a fix
 * for; the bundle, which stores plain objects with no CHECK constraint,
 * carries all of them.
 *
 * KNOWN DIVERGENCES. One real one exists today, enumerated below rather than
 * hidden by a loose assertion, so that a second cannot appear unnoticed. This
 * list must only ever shrink. (A second — five people with a different
 * canonical name/slug in each store — resolved itself on 1 September 2026:
 * Parliament's live listing page updated to spell all five the same way its
 * profile pages, and therefore the bundle, already did. Caught by the sync
 * connector's own regression test suite running the "operational" schedule
 * against real data — see this file's git history for the removed
 * `KNOWN_NAME_DIVERGENCES` map rather than re-adding empty scaffolding.)
 *
 * SAFETY. The database is opened READ-ONLY. Nothing here migrates, seeds or
 * syncs, and the live file is never written.
 *
 * SKIPPING. .data/javora.db is gitignored and absent in CI and a fresh clone,
 * so these skip there — the same pattern queries.postgres.test.ts uses.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const DB_PATH = process.env.JAVORA_DB ?? join(ROOT, ".data", "javora.db");
const HAVE_DB = existsSync(DB_PATH);
const FIXED_DAY = new Date("2026-08-31T00:00:00Z");

/**
 * RESOLVED — the President used to be one person in the bundle and a separate
 * Cabinet-namespaced person (`cabinetOffice:anura-kumara-dissanayake`) in the
 * database, because `.data/javora.db` had been synced before
 * `src/data/identityOverrides.ts` existed. `scripts/promote-past-members.mjs`
 * retired that stale record and `scripts/reconcile-identity-overrides.mjs`
 * re-synced the Cabinet Office, which now resolves him directly onto
 * `parliament:112` via the override — the same id and record the bundle uses.
 * No alias map is needed here any more; if a future override ever needs one,
 * add it back deliberately rather than leaving empty scaffolding.
 *
 * KNOWN DIVERGENCE 2 — 353 of the database's positions have no
 * source_evidence row. The bundle has none of this problem: all of its
 * positions resolve at least one evidence row (asserted below, strictly).
 *
 * Provenance per claim is the property this project exists to keep, so this is
 * a ratchet, not a permanent exemption: the count may fall, never rise.
 */
const DB_POSITIONS_WITHOUT_EVIDENCE_BASELINE = 353;

describe.skipIf(!HAVE_DB)("bundled dataset and database agree where they overlap", () => {
  let db: DatabaseSync;
  const rows = <T,>(sql: string): T[] => db.prepare(sql).all() as T[];
  let dbPeople: { id: string; slug: string; canonical_name: string }[];
  let bundle: ReturnType<typeof allPeople>;
  let bundleById: Map<string, (typeof bundle)[number]>;

  beforeAll(() => {
    db = new DatabaseSync(DB_PATH, { readOnly: true });
    dbPeople = rows<{ id: string; slug: string; canonical_name: string }>(
      "SELECT id, slug, canonical_name FROM person",
    );
    bundle = allPeople(FIXED_DAY);
    bundleById = new Map(bundle.map((v) => [v.person.id, v]));
  });

  afterAll(() => {
    db.close();
  });

  it("has people in both stores to compare", () => {
    expect(dbPeople.length).toBeGreaterThan(0);
    expect(bundle.length).toBeGreaterThan(0);
  });

  it("every person in the database also exists in the bundle, under the same id", () => {
    const missing = dbPeople
      .filter((r) => !bundleById.has(r.id))
      .map((r) => r.id);
    expect(missing).toEqual([]);
  });

  it("gives the same person the same slug", () => {
    // The assertion that earns this file. slugify is implemented six times
    // across the two paths; if one drifts, a person's permanent public URL
    // depends on which path created their record.
    const mismatched = dbPeople
      .map((r) => ({ r, b: bundleById.get(r.id) }))
      .filter(({ r, b }) => b && b.person.slug !== r.slug)
      .map(({ r, b }) => ({ id: r.id, db: r.slug, bundle: b!.person.slug }));
    expect(mismatched).toEqual([]);
  });

  it("gives the same person the same name", () => {
    const mismatched = dbPeople
      .map((r) => ({ r, b: bundleById.get(r.id) }))
      .filter(({ r, b }) => b && b.person.canonicalName !== r.canonical_name)
      .map(({ r, b }) => ({ id: r.id, db: r.canonical_name, bundle: b!.person.canonicalName }));
    expect(mismatched).toEqual([]);
  });

  it("mints no duplicate slug in the database", () => {
    const dupes = rows<{ slug: string; n: number }>(
      "SELECT slug, COUNT(*) n FROM person GROUP BY slug HAVING COUNT(*) > 1",
    );
    expect(dupes).toEqual([]);
  });

  it("cites no evidence from a source it does not know", () => {
    const dangling = rows<{ source_id: string }>(
      `SELECT DISTINCT e.source_id FROM source_evidence e
        WHERE e.source_id NOT IN (SELECT id FROM source)`,
    );
    expect(dangling).toEqual([]);
  });

  it("has no MORE positions without evidence than the recorded baseline", () => {
    // A ratchet. Provenance per claim is the point of the project, and the
    // database is currently behind the bundle on it. This may fall, never rise.
    const [{ n }] = rows<{ n: number }>(
      `SELECT COUNT(*) n FROM position p
        WHERE NOT EXISTS (
          SELECT 1 FROM source_evidence e
           WHERE e.entity_type = 'position' AND e.entity_id = p.id
        )`,
    );
    expect(n).toBeLessThanOrEqual(DB_POSITIONS_WITHOUT_EVIDENCE_BASELINE);
  });
});

describe("the bundled dataset — what the public site actually renders", () => {
  const bundle = allPeople(FIXED_DAY);

  it("resolves at least one evidence row for EVERY position", () => {
    // Strict, with no baseline, because it currently passes for all 6,649.
    // Provenance per claim must not regress in the store readers see.
    const unsupported = bundle
      .flatMap((v) => v.positions)
      .filter((p) => evidenceFor(p.claim).length === 0)
      .map((p) => p.id);
    expect(unsupported).toEqual([]);
  });

  it("mints a unique slug for every person", () => {
    const slugs = bundle.map((v) => v.person.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe.skipIf(HAVE_DB)("bundle/database parity", () => {
  it("skipped: no database at the expected path", () => {
    // Present so a skip is reported rather than the file looking deleted.
    expect(HAVE_DB).toBe(false);
  });
});
