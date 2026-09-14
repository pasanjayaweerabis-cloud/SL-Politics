import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase, migrate, type Database } from "../db/database.ts";
import { CanonicalStore } from "../db/store.ts";
import { listPeople, suggestPeople, getPerson, getFacets } from "./queries.ts";
import { syncSource, type ConnectorRun, type NormalisedPerson } from "../sync/syncSource.ts";

/**
 * Query-layer tests. The data is loaded the way production loads it — through
 * a sync run — so these exercise the same rows the API serves, rather than
 * hand-inserted fixtures that could drift from what the pipeline writes.
 *
 * Every query function takes a `Queryable` (`get`/`all`), not a
 * `CanonicalStore` — so tests call them against `store.database` directly.
 * That is the same object the API passes in production against SQLite, and
 * the same shape `server/db/postgres.ts`'s `AsyncDatabase` satisfies against
 * PostgreSQL — these tests exercise the exact code path both backends run.
 */

const SOURCE_ID = "S001";

function makePerson(over: Partial<NormalisedPerson> = {}): NormalisedPerson {
  const id = over.externalId ?? "1";
  const name = over.canonicalName ?? "Anura Karunathilaka";
  return {
    externalId: id,
    externalIdKey: "parliament",
    canonicalName: name,
    slug: over.slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    aliases: [],
    partyId: "jathika-jana-balawegaya",
    partyName: "Jathika Jana balawegaya",
    partyAbbreviation: "JJB",
    districtId: "colombo",
    districtName: "Colombo",
    sourceUrl: `https://www.parliament.lk/en/members-of-parliament/mp-profile/${id}`,
    searchText: `${name.toLowerCase()} jathika jana balawegaya jjb colombo member of parliament`,
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
    ],
    ...over,
  };
}

const connector = (people: NormalisedPerson[]): ConnectorRun => ({
  sourceId: SOURCE_ID,
  connectorVersion: "test@1",
  parserVersion: "test@1",
  url: "https://www.parliament.lk/",
  async fetch() {
    return {
      retrievedAt: "2026-01-01T00:00:00.000Z",
      canonicalPayload: JSON.stringify(people.map((p) => [p.externalId, p.canonicalName])),
      people,
    };
  },
});

let db: Database;
let store: CanonicalStore;

beforeEach(async () => {
  db = openDatabase(":memory:");
  migrate(db, { silent: true });
  store = new CanonicalStore(db);
  store.upsertSource({
    id: SOURCE_ID,
    name: "Parliament",
    institution: "Parliament of Sri Lanka",
    sourceType: "legislature",
    category: "Official directory",
    url: "https://www.parliament.lk/",
  });

  await syncSource(
    store,
    connector([
      makePerson({ externalId: "1", canonicalName: "Anura Karunathilaka", slug: "anura-karunathilaka" }),
      makePerson({
        externalId: "2",
        canonicalName: "Harini Amarasuriya",
        slug: "harini-amarasuriya",
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
            supersedable: true,
          },
        ],
      }),
      makePerson({
        externalId: "3",
        canonicalName: "Bhagya Sri Herath",
        slug: "bhagya-sri-herath",
        districtId: "anuradhapura",
        districtName: "Anuradhapura",
        searchText: "bhagya sri herath jathika jana balawegaya jjb anuradhapura member of parliament",
        positions: [
          {
            title: "Member of Parliament",
            roleType: "member-of-parliament",
            institution: "Parliament of Sri Lanka",
            districtId: "anuradhapura",
            currentAsOf: "2026-01-01",
            precedence: 40,
            factType: "parliamentary-membership",
          },
        ],
      }),
    ]),
  );
});

const TODAY = "2026-06-01";

describe("listPeople", () => {
  it("returns everyone, paginated", async () => {
    const page = await listPeople(store.database, { limit: 2, today: TODAY });
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(true);
  });

  it("ranks the highest office first", async () => {
    const page = await listPeople(store.database, { today: TODAY });
    expect(page.items[0]!.name).toBe("Harini Amarasuriya");
    expect(page.items[0]!.headlineTitle).toBe("Prime Minister");
  });

  it("derives serving status rather than reading a stored flag", async () => {
    const page = await listPeople(store.database, { today: TODAY });
    expect(page.items.every((p) => p.serving)).toBe(true);
  });

  it("filters by party, district and role server-side", async () => {
    expect((await listPeople(store.database, { party: ["jathika-jana-balawegaya"], today: TODAY })).total).toBe(3);
    expect((await listPeople(store.database, { district: ["anuradhapura"], today: TODAY })).total).toBe(1);
    expect((await listPeople(store.database, { role: ["prime-minister"], today: TODAY })).total).toBe(1);
  });

  it("combines a search term with a filter", async () => {
    const page = await listPeople(store.database, { q: "colombo", role: ["prime-minister"], today: TODAY });
    expect(page.total).toBe(1);
    expect(page.items[0]!.name).toBe("Harini Amarasuriya");
  });

  it("returns nothing for a term that matches no record", async () => {
    expect((await listPeople(store.database, { q: "zzzz-nobody", today: TODAY })).total).toBe(0);
  });

  it("caps an absurd page size rather than serving the whole table", async () => {
    // parseListOptions/validation.ts rejects an absurd limit outright at the
    // HTTP boundary (see server.test.ts); listPeople itself still clamps a
    // limit that arrives via a direct call, as a second line of defence.
    expect((await listPeople(store.database, { limit: 100000, today: TODAY })).limit).toBeLessThanOrEqual(200);
  });

  it("is not confused by a quote in the search term", async () => {
    // Bound as a parameter, never interpolated.
    await expect(listPeople(store.database, { q: "o'brien'; DROP TABLE person;--", today: TODAY })).resolves.not.toThrow();
    expect(store.counts().people).toBe(3);
  });

  /*
   * L-1 (docs/security-audit-followup-2026-09-04.md). `q` reaches a SQL LIKE
   * pattern via normaliseName() — before the fix, a bare "%" normalised to
   * "%" unchanged and matched every row (LIKE '%%'), turning a would-be-empty
   * query into a full scan plus COUNT(*). It must behave like any other
   * no-match term now, not like an unfiltered listing.
   */
  it("a bare '%' behaves like any other non-matching term, not a wildcard that matches everyone", async () => {
    const page = await listPeople(store.database, { q: "%", today: TODAY });
    expect(page.total).toBe(0);
  });

  it("'%' embedded in an otherwise-real term does not widen the match", async () => {
    // "harini%" would, as a raw LIKE pattern, match "harini" followed by
    // anything — but normaliseName() strips the "%" before it ever reaches
    // SQL, so this must behave exactly like the plain term "harini".
    const page = await listPeople(store.database, { q: "harini%", today: TODAY });
    expect(page.total).toBe(1);
    expect(page.items[0]!.name).toBe("Harini Amarasuriya");
  });
});

describe("suggestPeople", () => {
  it("suggests matches while typing", async () => {
    const items = await suggestPeople(store.database, "anura", 8, TODAY);
    expect(items.length).toBeGreaterThan(0);
  });

  it("ranks a name match above an incidental district match", async () => {
    // "anura" prefixes both the name Anura and the district Anuradhapura.
    const items = await suggestPeople(store.database, "anura", 8, TODAY);
    expect(items[0]!.name).toBe("Anura Karunathilaka");
  });

  it("returns nothing for an empty query", async () => {
    expect(await suggestPeople(store.database, "", 8, TODAY)).toEqual([]);
    expect(await suggestPeople(store.database, "   ", 8, TODAY)).toEqual([]);
  });

  it("caps the number of suggestions", async () => {
    expect((await suggestPeople(store.database, "a", 2, TODAY)).length).toBeLessThanOrEqual(2);
  });

  it("carries what the dropdown renders", async () => {
    const [first] = await suggestPeople(store.database, "harini", 8, TODAY);
    expect(first).toMatchObject({ headlineTitle: "Prime Minister", partyAbbreviation: "JJB" });
  });

  it("a bare '%' suggests nothing, rather than matching every record (L-1)", async () => {
    expect(await suggestPeople(store.database, "%", 8, TODAY)).toEqual([]);
  });

  it("finds people by party abbreviation and by district", async () => {
    expect((await suggestPeople(store.database, "jjb", 8, TODAY)).length).toBe(3);
    expect((await suggestPeople(store.database, "anuradhapura", 8, TODAY)).length).toBe(1);
  });
});

describe("getPerson", () => {
  it("resolves by slug and by id", async () => {
    expect((await getPerson(store.database, "harini-amarasuriya", TODAY))?.person.canonical_name).toBe("Harini Amarasuriya");
    expect((await getPerson(store.database, "parliament:2", TODAY))?.person.canonical_name).toBe("Harini Amarasuriya");
  });

  it("returns null for an unknown person", async () => {
    expect(await getPerson(store.database, "nobody", TODAY)).toBeNull();
  });

  it("includes positions, affiliations and evidence", async () => {
    const record = (await getPerson(store.database, "harini-amarasuriya", TODAY))!;
    expect(record.positions.length).toBe(2);
    expect(record.affiliations.length).toBe(1);
    expect(record.evidence.length).toBeGreaterThan(0);
  });

  it("marks current positions as current, derived from dates", async () => {
    const record = (await getPerson(store.database, "harini-amarasuriya", TODAY))!;
    expect(record.positions.every((p) => p.current)).toBe(true);
  });

  it("does not mark a closed position as current", async () => {
    const before = (await getPerson(store.database, "harini-amarasuriya", TODAY))!;
    const pm = before.positions.find((p) => (p as unknown as { title: string }).title === "Prime Minister")! as unknown as { id: string };
    store.closePosition(pm.id, "2026-03-01");
    const after = (await getPerson(store.database, "harini-amarasuriya", TODAY))!;
    const afterPm = after.positions.find((p) => (p as unknown as { title: string }).title === "Prime Minister")!;
    expect(afterPm.current).toBe(false);
  });
});

/*
 * M-2 — response field allowlist. `getPerson()` used to be `SELECT *` on
 * every table it touches, including `change_event.actor` (a sync identifier
 * today, an administrative account identifier once §5 administration
 * exists). Every query now selects an explicit column list and the three
 * named tables (person, change_event, source_conflict) additionally go
 * through a `toPublicXxx()` mapper.
 */
describe("getPerson — public response shape (M-2)", () => {
  it("never includes change_event.actor, however the change was recorded", async () => {
    store.insertChangeEvent({
      id: "change-test-1",
      entityType: "person",
      entityId: "parliament:2",
      fieldName: "biography",
      previousValue: "old bio",
      newValue: "new bio",
      detectedAt: "2026-02-01T00:00:00.000Z",
      actor: "sync-worker@internal-host.example",
    });

    const record = (await getPerson(store.database, "harini-amarasuriya", TODAY))!;
    expect(record.changes.length).toBeGreaterThan(0);
    for (const change of record.changes) {
      expect(change).not.toHaveProperty("actor");
    }
    expect(JSON.stringify(record.changes)).not.toMatch(/internal-host/);

    expect(Object.keys(record.changes[0] as object).sort()).toEqual(
      ["change_kind", "detected_at", "entity_id", "entity_type", "field_name", "id", "new_value", "previous_value", "source_id", "verified_at"].sort(),
    );
  });

  it("source_conflict rows go through the public mapper with a pinned key set", async () => {
    store.upsertConflict({
      id: "conflict-test-1",
      entityType: "person",
      entityId: "parliament:2",
      fieldName: "date_of_birth",
      factType: "biographical",
      sourceAId: SOURCE_ID,
      valueA: "1970-01-01",
      sourceBId: SOURCE_ID,
      valueB: "1970-01-02",
      resolutionState: "unresolved",
      detectedAt: "2026-02-01T00:00:00.000Z",
    });

    const record = (await getPerson(store.database, "harini-amarasuriya", TODAY))!;
    expect(record.conflicts.length).toBeGreaterThan(0);
    expect(Object.keys(record.conflicts[0] as object).sort()).toEqual(
      [
        "detected_at", "entity_id", "entity_type", "evidence_a_id", "evidence_b_id", "fact_type", "field_name",
        "id", "resolution_state", "resolved_at", "resolved_source_id", "resolved_value", "source_a_id", "source_b_id",
        "value_a", "value_b",
      ].sort(),
    );
  });

  it("the person object's key set is pinned and excludes bookkeeping-only columns", async () => {
    const record = (await getPerson(store.database, "harini-amarasuriya", TODAY))!;
    expect(Object.keys(record.person).sort()).toEqual(
      [
        "biography", "canonical_name", "date_of_birth", "date_of_birth_precision", "date_of_death",
        "date_of_death_precision", "gender", "id", "is_demonstration", "name_en", "name_si", "name_ta",
        "nationality", "place_of_birth", "portrait_credit", "portrait_retrieved_at", "portrait_source_id",
        "portrait_url", "profession", "slug", "verification", "verified_at",
      ].sort(),
    );
  });
});

describe("getFacets", () => {
  it("counts parties, districts and roles from the data", async () => {
    const facets = (await getFacets(store.database)) as {
      parties: Array<{ id: string; count: number }>;
      districts: Array<{ id: string; count: number }>;
      roles: Array<{ id: string; count: number }>;
    };
    expect(facets.parties.find((p) => p.id === "jathika-jana-balawegaya")?.count).toBe(3);
    expect(facets.districts.find((d) => d.id === "colombo")?.count).toBe(2);
    expect(facets.roles.find((r) => r.id === "member-of-parliament")?.count).toBe(3);
  });
});
