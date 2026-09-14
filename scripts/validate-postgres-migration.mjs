/**
 * Javora — post-migration validation.
 *
 * Compares the SQLite source and the migrated PostgreSQL target directly,
 * rather than trusting that a migration which didn't throw is a migration
 * that is correct. "It ran without an error" and "the data is intact" are
 * different claims, and only this script's checks support the second one.
 *
 * Categories, each of which can fail independently:
 *
 *   1. Row counts, every table            - nothing was dropped or duplicated
 *   2. Duplicate canonical people          - a person was not split or merged
 *   3. Orphaned foreign keys               - every reference still resolves
 *   4. Position history                    - open/closed counts match exactly
 *   5. Source evidence                     - every claim's citation survived
 *   6. Exhaustive content hash             - every row, every column, not a sample
 *   7. Spot-check sampled records          - human-readable diagnostic on top of #6
 *
 * Exits non-zero on any failure, so it is safe to gate a deploy on.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/validate-postgres-migration.mjs
 */

import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { openPostgres } from "../server/db/postgres.ts";

const SQLITE_PATH = process.env.JAVORA_DB ?? join(process.cwd(), ".data", "javora.db");
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("validate-postgres-migration: DATABASE_URL is not set.");
  process.exit(1);
}

const failures = [];
const pass = (label) => console.log(`  OK    ${label}`);
const fail = (label, detail) => {
  console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ""}`);
  failures.push(label);
};

/** Every table, named explicitly so a silent schema addition can't hide from row-count checking. */
const ALL_TABLES = [
  "source", "source_authority", "source_snapshot", "sync_run",
  "person", "person_alias", "person_external_id", "person_search",
  "party", "party_alias", "political_affiliation", "district",
  "position", "position_event", "election", "candidacy", "qualification",
  "source_evidence", "change_event", "identity_review", "source_conflict",
  "correction_report", "education", "exam_result", "employment",
  "public_service", "legal_challenge", "research_document", "research_claim",
];

/**
 * The counts this migration is required to hit exactly.
 *
 * A canary, not the primary check: the source-vs-target comparison above is
 * self-adjusting and catches any copy error regardless of these numbers.
 * This exists so a silent, unexplained change in the dataset's SIZE is
 * noticed rather than migrated faithfully and shipped.
 *
 * `source_evidence` was 785 when this file was written and is 1,084 now.
 * That +299 is exactly one evidence row per education record: the integrity
 * review found all 299 education rows marked `source-linked` with no
 * `source_evidence` row anywhere behind them — a verification state the data
 * could not support — and the profile-detail promotion now writes the
 * missing provenance. The number moved because a real gap was closed, not
 * because anything was duplicated.
 */
const REQUIRED_BASELINE = {
  person: 226,
  position: 643,
  education: 299,
  source_evidence: 1084,
  research_claim: 185,
  change_event: 29,
};

async function main() {
  const sqlite = new DatabaseSync(SQLITE_PATH, { readOnly: true });
  const pg = openPostgres(DATABASE_URL);

  console.log(`source : ${SQLITE_PATH}`);
  console.log(`target : ${DATABASE_URL.replace(/:[^:@/]+@/, ":***@")}`);

  /* ---------------------------------------------------------- 1. row counts */
  console.log("\n1. Row counts (SQLite source vs. PostgreSQL target)");
  const counts = {};
  for (const table of ALL_TABLES) {
    const sourceRow = sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
    const targetRow = await pg.get(`SELECT COUNT(*) AS n FROM ${table}`);
    const source = Number(sourceRow.n);
    const target = Number(targetRow.n);
    counts[table] = { source, target };

    if (source === target) pass(`${table}: ${source} = ${target}`);
    else fail(`${table}: source=${source} target=${target}`, "row counts differ");
  }

  console.log("\n   Required baseline (stated explicitly, checked against the TARGET):");
  for (const [table, expected] of Object.entries(REQUIRED_BASELINE)) {
    const actual = counts[table]?.target;
    if (actual === expected) pass(`${table} = ${expected}`);
    else fail(`${table}`, `expected ${expected}, target has ${actual}`);
  }

  /* ------------------------------------------------- 2. duplicate people */
  console.log("\n2. Duplicate canonical people");

  const dupIds = await pg.all(
    "SELECT id, COUNT(*) AS n FROM person GROUP BY id HAVING COUNT(*) > 1",
  );
  if (dupIds.length === 0) pass("no duplicate person.id (primary key)");
  else fail("duplicate person.id", `${dupIds.length} id(s) - should be structurally impossible`);

  const dupSlugs = await pg.all(
    "SELECT slug, COUNT(*) AS n FROM person GROUP BY slug HAVING COUNT(*) > 1",
  );
  if (dupSlugs.length === 0) pass("no duplicate person.slug");
  else fail("duplicate person.slug", dupSlugs.map((r) => r.slug).join(", "));

  const dupExternal = await pg.all(
    "SELECT source_key, external_id, COUNT(*) AS n FROM person_external_id GROUP BY source_key, external_id HAVING COUNT(*) > 1",
  );
  if (dupExternal.length === 0) pass("no external id mapped to more than one person");
  else fail("duplicate person_external_id", `${dupExternal.length} external id(s) reused`);

  /* ------------------------------------------------- 3. orphaned foreign keys */
  console.log("\n3. Orphaned foreign keys (child row whose parent is missing)");

  // One check per REFERENCES clause that points at a required (non-nullable)
  // parent id. A nullable FK (e.g. district_id) is checked only where NOT NULL.
  const FK_CHECKS = [
    ["position", "person_id", "person", "id"],
    ["position_event", "person_id", "person", "id"],
    ["political_affiliation", "person_id", "person", "id"],
    ["political_affiliation", "party_id", "party", "id"],
    ["person_alias", "person_id", "person", "id"],
    ["person_external_id", "person_id", "person", "id"],
    ["person_search", "person_id", "person", "id"],
    ["education", "person_id", "person", "id"],
    ["exam_result", "person_id", "person", "id"],
    ["employment", "person_id", "person", "id"],
    ["public_service", "person_id", "person", "id"],
    ["legal_challenge", "person_id", "person", "id"],
    ["candidacy", "person_id", "person", "id"],
    ["candidacy", "election_id", "election", "id"],
    ["qualification", "person_id", "person", "id"],
    ["source_evidence", "source_id", "source", "id"],
    ["source_authority", "source_id", "source", "id"],
    ["source_snapshot", "source_id", "source", "id"],
    ["sync_run", "source_id", "source", "id"],
    ["research_claim", "document_id", "research_document", "id"],
  ];

  for (const [child, fk, parent, parentKey] of FK_CHECKS) {
    const orphans = await pg.all(
      `SELECT c.${fk} FROM ${child} c
        LEFT JOIN ${parent} p ON p.${parentKey} = c.${fk}
        WHERE c.${fk} IS NOT NULL AND p.${parentKey} IS NULL`,
    );
    if (orphans.length === 0) pass(`${child}.${fk} -> ${parent}.${parentKey}`);
    else fail(`${child}.${fk} -> ${parent}.${parentKey}`, `${orphans.length} orphaned row(s)`);
  }

  /* ------------------------------------------------------- 4. position history */
  console.log("\n4. Position history (nothing collapsed or silently closed)");

  const sourceOpen = sqlite.prepare("SELECT COUNT(*) AS n FROM position WHERE end_date IS NULL").get().n;
  const targetOpen = Number((await pg.get("SELECT COUNT(*) AS n FROM position WHERE end_date IS NULL")).n);
  if (sourceOpen === targetOpen) pass(`open positions: ${sourceOpen} = ${targetOpen}`);
  else fail("open positions", `source=${sourceOpen} target=${targetOpen}`);

  const sourceClosed = sqlite.prepare("SELECT COUNT(*) AS n FROM position WHERE end_date IS NOT NULL").get().n;
  const targetClosed = Number((await pg.get("SELECT COUNT(*) AS n FROM position WHERE end_date IS NOT NULL")).n);
  if (sourceClosed === targetClosed) pass(`closed positions: ${sourceClosed} = ${targetClosed}`);
  else fail("closed positions", `source=${sourceClosed} target=${targetClosed}`);

  const sourceMinStart = sqlite.prepare("SELECT MIN(start_date) AS d FROM position WHERE start_date IS NOT NULL").get().d;
  const targetMinStart = (await pg.get("SELECT MIN(start_date) AS d FROM position WHERE start_date IS NOT NULL")).d;
  if (sourceMinStart === targetMinStart) pass(`earliest recorded start_date preserved: ${sourceMinStart}`);
  else fail("earliest start_date", `source=${sourceMinStart} target=${targetMinStart}`);

  /* ------------------------------------------------------- 5. source evidence */
  console.log("\n5. Source evidence (every claim's citation survived)");

  const sourceEvidenceHash = sqlite
    .prepare("SELECT COUNT(*) AS n FROM source_evidence WHERE source_url IS NOT NULL")
    .get().n;
  const targetEvidenceHash = Number(
    (await pg.get("SELECT COUNT(*) AS n FROM source_evidence WHERE source_url IS NOT NULL")).n,
  );
  if (sourceEvidenceHash === targetEvidenceHash) {
    pass(`evidence rows carrying a source_url: ${sourceEvidenceHash} = ${targetEvidenceHash}`);
  } else {
    fail("evidence with source_url", `source=${sourceEvidenceHash} target=${targetEvidenceHash}`);
  }

  const evidenceEntityTypes = await pg.all(
    "SELECT entity_type, COUNT(*) AS n FROM source_evidence GROUP BY entity_type ORDER BY entity_type",
  );
  const sourceEntityTypes = sqlite
    .prepare("SELECT entity_type, COUNT(*) AS n FROM source_evidence GROUP BY entity_type ORDER BY entity_type")
    .all();
  const entityTypesMatch =
    JSON.stringify(evidenceEntityTypes.map((r) => [r.entity_type, Number(r.n)])) ===
    JSON.stringify(sourceEntityTypes.map((r) => [r.entity_type, r.n]));
  if (entityTypesMatch) pass("evidence distribution across entity_type matches");
  else fail("evidence entity_type distribution", "counts per entity_type differ");

  /* ---------------------------------------------------- 6. exhaustive content hash */
  console.log("\n6. Exhaustive content hash (every row, every column - not a sample)");

  /*
   * The row-count checks above prove nothing about VALUES: a table could keep
   * the right row count while a column was truncated, byte-mangled, or one
   * row's content swapped with another's. A random sample catches that only
   * probabilistically - tested directly against this script during
   * development, a single corrupted row out of 226 was MISSED by a 10-row
   * sample, which is exactly the false confidence a sample-only check risks.
   *
   * Comparing every row of every table closes that gap completely, at
   * negligible cost for a dataset this size (3,230 rows total).
   */
  for (const table of ALL_TABLES) {
    const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!columns.includes("id")) continue; // no stable row identity to key on

    const orderedCols = [...columns].sort();
    const projection = orderedCols.join(", ");

    const sourceRows = sqlite.prepare(`SELECT ${projection} FROM ${table} ORDER BY id`).all();
    const targetRows = await pg.all(`SELECT ${projection} FROM ${table} ORDER BY id`);

    // A row canonicalises to JSON of its columns in a fixed order, not a
    // delimiter-joined string - joining is ambiguous, since {a:"ab",b:"c"}
    // and {a:"a",b:"bc"} would both join to the string "abc" and silently
    // compare equal. JSON's own escaping makes the field boundary unambiguous.
    const canonRow = (row) => JSON.stringify(orderedCols.map((c) => row[c] ?? null));
    const sourceDigest = sourceRows.map(canonRow).join("\n");
    const targetDigest = targetRows.map(canonRow).join("\n");

    if (sourceDigest === targetDigest) {
      if (sourceRows.length > 0) pass(`${table}: all ${sourceRows.length} row(s) byte-identical, every column`);
      continue;
    }

    // Content differs - find exactly which row(s), for a diagnosable failure
    // rather than a bare "these don't match".
    const targetById = new Map(targetRows.map((row) => [row.id, row]));
    let mismatches = 0;
    for (const row of sourceRows) {
      const target = targetById.get(row.id);
      if (!target || canonRow(row) !== canonRow(target)) mismatches++;
    }
    fail(`${table} content`, `${mismatches} row(s) differ from source (row counts matched, values did not)`);
  }

  /* ------------------------------------------------------- 7. spot-check */
  console.log("\n7. Spot-check sampled records (human-readable diagnostic on top of #6)");

  const sample = sqlite
    .prepare("SELECT id, slug, canonical_name, date_of_birth, verification FROM person ORDER BY RANDOM() LIMIT 10")
    .all();
  let sampleMismatches = 0;
  for (const row of sample) {
    const target = await pg.get("SELECT slug, canonical_name, date_of_birth, verification FROM person WHERE id = ?", [row.id]);
    if (!target) {
      fail(`person ${row.id}`, "missing from target entirely");
      sampleMismatches++;
      continue;
    }
    const mismatch =
      target.slug !== row.slug ||
      target.canonical_name !== row.canonical_name ||
      (target.date_of_birth ?? null) !== (row.date_of_birth ?? null) ||
      target.verification !== row.verification;
    if (mismatch) {
      fail(`person ${row.id}`, `field value differs (source: ${JSON.stringify(row)}, target: ${JSON.stringify(target)})`);
      sampleMismatches++;
    }
  }
  if (sampleMismatches === 0) pass(`${sample.length} randomly sampled person records match field-for-field`);

  /* ------------------------------------------------------------- summary */
  sqlite.close();
  await pg.close();

  console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED`}`);
  if (failures.length > 0) {
    console.log("failed:");
    for (const label of failures) console.log(`  - ${label}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("validate-postgres-migration: crashed", error);
  process.exit(1);
});
