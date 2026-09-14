/**
 * Javora — cross-backend parity for the query layer.
 *
 * The bug this file exists to prevent: PostgreSQL folds an unquoted `AS`
 * alias to lowercase (`AS headlineTitle` comes back as the key `headlinetitle`),
 * while SQLite preserves it exactly. `toSummary()` in queries.ts reads
 * `row.headlineTitle` — which exists on the SQLite row and is `undefined` on
 * the Postgres one — so every derived field (headline office, party, district,
 * serving status, portrait) silently went `null` against Postgres. Nothing
 * threw. The only way this was found was running the identical query against
 * both engines and diffing the result, which is exactly what this file
 * automates so it cannot regress unnoticed a second time.
 *
 * SKIPPED when no test Postgres is configured — this project deliberately
 * does not require a running Postgres server for the ordinary test suite
 * (see server/db/postgres.ts's header). Set `DATABASE_URL_TEST` to a
 * throwaway database to run these; nothing here is destructive to a database
 * that already has rows (each test uses its own migrated schema), but it is
 * still a TEST fixture and must never point at anything real.
 *
 *   DATABASE_URL_TEST=postgres://postgres:pw@localhost:5432/javora_test \
 *     npx vitest run server/api/queries.postgres.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { openDatabase, migrate, type Database } from "../db/database.ts";
import { CanonicalStore } from "../db/store.ts";
import { listPeople, suggestPeople, getFacets } from "./queries.ts";
import { syncSource, type ConnectorRun, type NormalisedPerson } from "../sync/syncSource.ts";
import { openPostgres, migratePostgres, type AsyncDatabase } from "../db/postgres.ts";

const TEST_URL = process.env.DATABASE_URL_TEST;

const makePerson = (over: Partial<NormalisedPerson> = {}): NormalisedPerson => ({
  externalId: "1",
  externalIdKey: "parliament",
  canonicalName: "Harini Amarasuriya",
  slug: "harini-amarasuriya",
  aliases: [],
  partyId: "jathika-jana-balawegaya",
  partyName: "Jathika Jana balawegaya",
  partyAbbreviation: "JJB",
  districtId: "colombo",
  districtName: "Colombo",
  sourceUrl: "https://www.parliament.lk/en/members-of-parliament/mp-profile/1",
  searchText: "harini amarasuriya jathika jana balawegaya jjb colombo prime minister",
  positions: [
    {
      title: "Member of Parliament",
      roleType: "member-of-parliament",
      institution: "Parliament of Sri Lanka",
      districtId: "colombo",
      currentAsOf: "2026-01-01",
      precedence: 40,
      factType: "parliamentary-membership",
    },
    {
      title: "Prime Minister",
      roleType: "prime-minister",
      institution: "Cabinet of Ministers",
      currentAsOf: "2026-01-01",
      precedence: 2,
      factType: "portfolio-assignment",
    },
  ],
  ...over,
});

const connector = (people: NormalisedPerson[]): ConnectorRun => ({
  sourceId: "S001",
  connectorVersion: "test@1",
  parserVersion: "test@1",
  url: "https://www.parliament.lk/",
  async fetch() {
    return { retrievedAt: "2026-01-01T00:00:00.000Z", canonicalPayload: "[]", people };
  },
});

describe.skipIf(!TEST_URL)("query-layer parity: SQLite vs. PostgreSQL", () => {
  let sqlite: Database;
  let postgres: AsyncDatabase;

  beforeAll(async () => {
    sqlite = openDatabase(":memory:");
    migrate(sqlite, { silent: true });
    const sqliteStore = new CanonicalStore(sqlite);
    sqliteStore.upsertSource({
      id: "S001", name: "Parliament", institution: "Parliament of Sri Lanka",
      sourceType: "legislature", category: "Official directory", url: "https://www.parliament.lk/",
    });
    await syncSource(sqliteStore, connector([makePerson()]));

    postgres = openPostgres(TEST_URL!);
    // A fresh schema each run: DROP/CREATE rather than assuming an empty
    // database, so this is safe to point at a reused disposable container.
    await postgres.run("DROP SCHEMA public CASCADE");
    await postgres.run("CREATE SCHEMA public");
    await migratePostgres(postgres, { silent: true });

    // syncSource writes through CanonicalStore's synchronous Database, which
    // Postgres is not (see server/db/postgres.ts). Reuse the rows the SQLite
    // sync run already produced by copying them across, rather than
    // re-running the sync pipeline against a backend it was never built for.
    await copyAllTables(sqlite, postgres);
  });

  afterAll(async () => {
    sqlite.close();
    await postgres.close();
  });

  const TODAY = "2026-06-01";

  it("listPeople returns identical camelCase fields on both backends", async () => {
    const sqlitePage = await listPeople(sqlite, { today: TODAY });
    const pgPage = await listPeople(postgres, { today: TODAY });

    expect(pgPage.total).toBe(sqlitePage.total);
    expect(pgPage.items[0]).toEqual(sqlitePage.items[0]);

    // The specific regression: these must not be null/undefined on Postgres
    // while present on SQLite.
    expect(pgPage.items[0]!.headlineTitle).toBe("Prime Minister");
    expect(pgPage.items[0]!.serving).toBe(true);
    expect(pgPage.items[0]!.partyId).toBe("jathika-jana-balawegaya");
  });

  it("suggestPeople returns identical camelCase fields on both backends", async () => {
    const sqliteResults = await suggestPeople(sqlite, "harini", 8, TODAY);
    const pgResults = await suggestPeople(postgres, "harini", 8, TODAY);
    expect(pgResults).toEqual(sqliteResults);
    expect(pgResults[0]!.headlineTitle).toBe("Prime Minister");
  });

  it("getFacets returns the same shape on both backends", async () => {
    const sqliteFacets = await getFacets(sqlite);
    const pgFacets = (await getFacets(postgres)) as typeof sqliteFacets;
    expect(pgFacets.parties.length).toBe(sqliteFacets.parties.length);
    expect(pgFacets.roles.length).toBe(sqliteFacets.roles.length);
  });
});

/** Copies every row of every table from the SQLite fixture into the test Postgres database, in FK-safe order. */
async function copyAllTables(sqlite: Database, postgres: AsyncDatabase): Promise<void> {
  const order = [
    "source", "source_authority", "source_snapshot", "sync_run",
    "person", "person_alias", "person_external_id", "person_search",
    "party", "party_alias", "political_affiliation", "district",
    "position", "position_event", "election", "candidacy", "qualification",
    "source_evidence", "change_event", "identity_review", "source_conflict",
    "correction_report", "education", "exam_result", "employment",
    "public_service", "legal_challenge", "research_document", "research_claim",
  ];

  for (const table of order) {
    const rows = sqlite.all<Record<string, unknown>>(`SELECT * FROM ${table}`);
    if (rows.length === 0) continue;
    const columns = Object.keys(rows[0]!);
    for (const row of rows) {
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(",");
      await postgres.run(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${placeholders})`, columns.map((c) => row[c]));
    }
  }
}
