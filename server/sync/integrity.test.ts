import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase, migrate } from "../db/database.ts";
import { CanonicalStore } from "../db/store.ts";
import { syncSource, type ConnectorRun, type NormalisedPerson } from "./syncSource.ts";

/**
 * Javora — synchronisation integrity.
 *
 * One rule, tested from every angle it could be broken from:
 *
 *   A CURRENT SOURCE UPDATE MUST NEVER DESTROY HISTORICAL TRUTH.
 *
 * The scenarios below are the six the integrity review calls for — same
 * input twice, changed once, changed twice, reordered records, a missing
 * optional field, and a field the source stops publishing for one run — plus
 * the per-entity provenance audit (can we say, for any synchronised record,
 * where it came from and when it was last confirmed).
 *
 * These are deliberately separate from productionReadiness.test.ts: that file
 * asks "does the pipeline survive bad input"; this one asks "does the
 * pipeline ever quietly lose something that was true".
 */

const SOURCE_ID = "S001";

function connector(
  people: NormalisedPerson[],
  retrievedAt: string,
): ConnectorRun {
  return {
    sourceId: SOURCE_ID,
    connectorVersion: "fixture@1",
    parserVersion: "fixture@1",
    url: "https://www.parliament.lk/en/members-of-parliament/directory-of-members/",
    async fetch() {
      return {
        retrievedAt,
        // Sorted, exactly as the real connectors do (see
        // parliamentConnector.canonicalPayloadFor and the Cabinet
        // connector's equivalent): the hash must describe WHAT the source
        // says, never the order it happened to say it in.
        canonicalPayload: JSON.stringify(
          [...people]
            .sort((a, b) => a.externalId.localeCompare(b.externalId, "en"))
            .map((p) => [
              p.externalId,
              p.canonicalName,
              p.districtId ?? null,
              [...p.positions]
                .map((x) => [x.title, x.roleType, x.institution, x.ministry ?? null, x.startDate ?? null])
                .sort((a, b) => String(a[0]).localeCompare(String(b[0]), "en")),
            ]),
        ),
        people,
        problems: [],
      };
    },
  };
}

function person(over: Partial<NormalisedPerson> = {}): NormalisedPerson {
  return {
    externalId: "100",
    externalIdKey: "parliament",
    canonicalName: "Test Person",
    slug: "test-person",
    dateOfBirth: "1970-01-01",
    partyId: "test-party",
    partyName: "Test Party",
    partyAbbreviation: "TP",
    districtId: "colombo",
    districtName: "Colombo",
    sourceUrl: "https://www.parliament.lk/en/members-of-parliament/mp-profile/100",
    searchText: "test person",
    positions: [
      {
        title: "Member of Parliament",
        roleType: "member-of-parliament",
        institution: "Parliament of Sri Lanka",
        districtId: over.districtId ?? "colombo",
        startDate: "2024-11-21",
        factType: "parliamentary-membership",
        precedence: 40,
      },
    ],
    ...over,
  };
}

/** A minister, from a source that reports portfolios only (as the Cabinet Office does). */
function minister(title: string, over: Partial<NormalisedPerson> = {}): NormalisedPerson {
  return person({
    positions: [
      {
        title,
        roleType: "cabinet-minister",
        institution: "Cabinet of Ministers",
        ministry: title.replace(/^Minister of /, ""),
        factType: "portfolio-assignment",
        precedence: 10,
        supersedable: true,
      },
    ],
    ...over,
  });
}

let store: CanonicalStore;

beforeEach(() => {
  const db = openDatabase(":memory:");
  migrate(db, { silent: true });
  store = new CanonicalStore(db);
  store.upsertSource({
    id: SOURCE_ID, name: "Parliament", institution: "Parliament of Sri Lanka",
    sourceType: "legislature", category: "Official directory", url: "https://www.parliament.lk/",
  });
});

const changeEvents = () =>
  store.database.all<{ entity_id: string; field_name: string; previous_value: string | null; new_value: string | null }>(
    `SELECT entity_id, field_name, previous_value, new_value FROM change_event ORDER BY detected_at, id`,
  );

/* ==========================================================================
   1. Same input twice
   ========================================================================== */

describe("same input twice", () => {
  it("produces no change events and no second row", async () => {
    await syncSource(store, connector([person()], "2026-01-01T00:00:00.000Z"));
    const eventsAfterFirst = changeEvents().length;

    await syncSource(store, connector([person()], "2026-01-02T00:00:00.000Z"));

    expect(changeEvents()).toHaveLength(eventsAfterFirst);
    expect(store.database.all(`SELECT id FROM person`)).toHaveLength(1);
    expect(store.database.all(`SELECT id FROM position`)).toHaveLength(1);
  });

  it("produces no change events even when re-applied with force, because nothing actually differs", async () => {
    await syncSource(store, connector([person()], "2026-01-01T00:00:00.000Z"));
    const before = changeEvents().length;

    // `force` skips the hash short-circuit and re-runs the whole apply path.
    // Change detection must still find nothing: the guarantee is that events
    // describe REAL differences, not merely that a run happened.
    await syncSource(store, connector([person()], "2026-01-02T00:00:00.000Z"), { force: true });

    expect(changeEvents()).toHaveLength(before);
  });

  it("does not fabricate a change from insignificant whitespace or casing in the source", async () => {
    await syncSource(store, connector([person()], "2026-01-01T00:00:00.000Z"));
    const before = changeEvents().length;

    // The same facts, as a slightly different scrape would render them:
    // padded whitespace and a doubled internal space. Nothing about the
    // office has changed, so nothing should be recorded as changed.
    const padded = person({
      positions: [{
        title: "  Member of  Parliament ",
        roleType: "member-of-parliament",
        institution: " Parliament of Sri Lanka",
        districtId: "colombo",
        startDate: "2024-11-21",
        factType: "parliamentary-membership",
        precedence: 40,
      }],
    });
    await syncSource(store, connector([padded], "2026-01-03T00:00:00.000Z"), { force: true });

    expect(changeEvents()).toHaveLength(before);
  });
});

/* ==========================================================================
   2. Changed input once
   ========================================================================== */

describe("changed input once", () => {
  it("Minister A -> Minister B closes A and opens B, keeping both rows", async () => {
    await syncSource(store, connector([minister("Minister of Energy")], "2026-01-01T00:00:00.000Z"));
    await syncSource(store, connector([minister("Minister of Ports")], "2026-02-01T00:00:00.000Z"));

    const positions = store.listPositions("parliament:100");
    expect(positions).toHaveLength(2);

    const energy = positions.find((p) => p.title === "Minister of Energy")!;
    const ports = positions.find((p) => p.title === "Minister of Ports")!;

    // The historical record survives intact and is now closed.
    expect(energy.end_date).toBe("2026-02-01");
    expect(energy.title).toBe("Minister of Energy");
    expect(energy.ministry).toBe("Energy");
    // The new office is open, and is a DIFFERENT row.
    expect(ports.end_date).toBeNull();
    expect(ports.id).not.toBe(energy.id);
    // The two are linked, so a reader can follow the transition.
    expect(energy.superseded_by).toBe(ports.id);
  });

  it("records the change with both the previous and the new value", async () => {
    await syncSource(store, connector([minister("Minister of Energy")], "2026-01-01T00:00:00.000Z"));
    await syncSource(store, connector([minister("Minister of Ports")], "2026-02-01T00:00:00.000Z"));

    const closing = changeEvents().find((e) => e.field_name === "end_date" && e.new_value === "2026-02-01");
    expect(closing).toBeTruthy();
    expect(closing!.previous_value).toBeNull(); // it was open
  });
});

/* ==========================================================================
   3. Changed input twice
   ========================================================================== */

describe("changed input twice", () => {
  it("A -> B -> C leaves three rows, two closed in order, one open", async () => {
    await syncSource(store, connector([minister("Minister of Energy")], "2026-01-01T00:00:00.000Z"));
    await syncSource(store, connector([minister("Minister of Ports")], "2026-02-01T00:00:00.000Z"));
    await syncSource(store, connector([minister("Minister of Health")], "2026-03-01T00:00:00.000Z"));

    const positions = store.listPositions("parliament:100");
    expect(positions).toHaveLength(3);

    const byTitle = Object.fromEntries(positions.map((p) => [p.title, p]));
    expect(byTitle["Minister of Energy"]!.end_date).toBe("2026-02-01");
    expect(byTitle["Minister of Ports"]!.end_date).toBe("2026-03-01");
    expect(byTitle["Minister of Health"]!.end_date).toBeNull();

    // The chain is intact: each closed office points at the one that replaced it.
    expect(byTitle["Minister of Energy"]!.superseded_by).toBe(byTitle["Minister of Ports"]!.id);
    expect(byTitle["Minister of Ports"]!.superseded_by).toBe(byTitle["Minister of Health"]!.id);
  });

  it("returning to a previously held office reopens that row rather than losing its history", async () => {
    await syncSource(store, connector([minister("Minister of Energy")], "2026-01-01T00:00:00.000Z"));
    await syncSource(store, connector([minister("Minister of Ports")], "2026-02-01T00:00:00.000Z"));
    await syncSource(store, connector([minister("Minister of Energy")], "2026-03-01T00:00:00.000Z"));

    const positions = store.listPositions("parliament:100");
    // Still two distinct offices, not four rows and not a lost one.
    expect(positions).toHaveLength(2);
    const energy = positions.find((p) => p.title === "Minister of Energy")!;
    expect(energy.end_date).toBeNull(); // held again
    // The record of having held it before is not erased by re-holding it.
    expect(energy.created_at).toBeTruthy();
  });
});

/* ==========================================================================
   4. Reordered source records
   ========================================================================== */

describe("reordered source records", () => {
  it("the same people in a different order is not a change", async () => {
    const a = person({ externalId: "1", slug: "person-a", canonicalName: "Person A" });
    const b = person({ externalId: "2", slug: "person-b", canonicalName: "Person B" });
    const c = person({ externalId: "3", slug: "person-c", canonicalName: "Person C" });

    await syncSource(store, connector([a, b, c], "2026-01-01T00:00:00.000Z"));
    const before = changeEvents().length;

    const result = await syncSource(store, connector([c, a, b], "2026-01-02T00:00:00.000Z"));

    expect(result.outcome).toBe("unchanged");
    expect(changeEvents()).toHaveLength(before);
  });

  it("a person's own offices arriving in a different order is not a change", async () => {
    const twoOffices = (order: "ab" | "ba") =>
      person({
        positions: order === "ab"
          ? [
              { title: "Minister of Energy", roleType: "cabinet-minister", institution: "Cabinet of Ministers", factType: "portfolio-assignment", supersedable: true },
              { title: "Minister of Ports", roleType: "cabinet-minister", institution: "Cabinet of Ministers", factType: "portfolio-assignment", supersedable: true },
            ]
          : [
              { title: "Minister of Ports", roleType: "cabinet-minister", institution: "Cabinet of Ministers", factType: "portfolio-assignment", supersedable: true },
              { title: "Minister of Energy", roleType: "cabinet-minister", institution: "Cabinet of Ministers", factType: "portfolio-assignment", supersedable: true },
            ],
      });

    await syncSource(store, connector([twoOffices("ab")], "2026-01-01T00:00:00.000Z"));
    const before = changeEvents().length;

    const result = await syncSource(store, connector([twoOffices("ba")], "2026-01-02T00:00:00.000Z"));

    expect(result.outcome).toBe("unchanged");
    expect(changeEvents()).toHaveLength(before);
    // Critically: neither office was closed as "no longer reported".
    expect(store.openPositions("parliament:100")).toHaveLength(2);
  });
});

/* ==========================================================================
   5. Missing optional field
   ========================================================================== */

describe("missing optional field", () => {
  it("a record that never had a ministry is stored without inventing one", async () => {
    const noMinistry = person({
      positions: [{
        title: "Member of Parliament", roleType: "member-of-parliament",
        institution: "Parliament of Sri Lanka", factType: "parliamentary-membership",
      }],
    });
    await syncSource(store, connector([noMinistry], "2026-01-01T00:00:00.000Z"));

    const position = store.listPositions("parliament:100")[0]!;
    expect(position.ministry).toBeNull();
    expect(position.start_date).toBeNull();
  });

  it("an absent optional field does not itself generate a change event", async () => {
    const noMinistry = person({
      positions: [{
        title: "Member of Parliament", roleType: "member-of-parliament",
        institution: "Parliament of Sri Lanka", factType: "parliamentary-membership",
      }],
    });
    await syncSource(store, connector([noMinistry], "2026-01-01T00:00:00.000Z"));
    const before = changeEvents().length;

    await syncSource(store, connector([noMinistry], "2026-01-02T00:00:00.000Z"), { force: true });

    expect(changeEvents()).toHaveLength(before);
  });
});

/* ==========================================================================
   6. Source field temporarily unavailable
   ========================================================================== */

describe("source field temporarily unavailable", () => {
  /*
   * The distinction this whole section turns on:
   *
   *   `null`      the source looked and says there is no value
   *   `undefined` THIS RUN did not carry that field at all
   *
   * Conflating them is how a listing-only sync — one that legitimately does
   * not fetch profile pages — erases a start date, a ministry or a district
   * that a fuller earlier run established. The same bug was already found and
   * fixed for `person` (see the `keep()` helper in store.upsertPerson); these
   * tests assert that positions are protected the same way.
   */

  it("a run that omits start_date does not erase a start date already established", async () => {
    await syncSource(store, connector([person()], "2026-01-01T00:00:00.000Z"));
    expect(store.listPositions("parliament:100")[0]!.start_date).toBe("2024-11-21");

    // A later, shallower run: same office, but this run carries no dates.
    const withoutDates = person({
      positions: [{
        title: "Member of Parliament", roleType: "member-of-parliament",
        institution: "Parliament of Sri Lanka", districtId: "colombo",
        factType: "parliamentary-membership", precedence: 40,
        // startDate deliberately absent — not null.
      }],
    });
    await syncSource(store, connector([withoutDates], "2026-02-01T00:00:00.000Z"), { force: true });

    // The established date must survive a run that simply did not look.
    expect(store.listPositions("parliament:100")[0]!.start_date).toBe("2024-11-21");
  });

  it("a run that omits the ministry does not erase a known ministry", async () => {
    await syncSource(store, connector([minister("Minister of Energy")], "2026-01-01T00:00:00.000Z"));
    expect(store.listPositions("parliament:100")[0]!.ministry).toBe("Energy");

    const withoutMinistry = person({
      positions: [{
        title: "Minister of Energy", roleType: "cabinet-minister",
        institution: "Cabinet of Ministers", factType: "portfolio-assignment",
        precedence: 10, supersedable: true,
        // ministry deliberately absent.
      }],
    });
    await syncSource(store, connector([withoutMinistry], "2026-02-01T00:00:00.000Z"), { force: true });

    expect(store.listPositions("parliament:100")[0]!.ministry).toBe("Energy");
  });

  it("a run that omits the district does not erase a known district", async () => {
    await syncSource(store, connector([person()], "2026-01-01T00:00:00.000Z"));
    expect(store.listPositions("parliament:100")[0]!.district_id).toBe("colombo");

    const withoutDistrict = person({
      positions: [{
        title: "Member of Parliament", roleType: "member-of-parliament",
        institution: "Parliament of Sri Lanka",
        startDate: "2024-11-21",
        factType: "parliamentary-membership", precedence: 40,
        // districtId deliberately absent.
      }],
    });
    await syncSource(store, connector([withoutDistrict], "2026-02-01T00:00:00.000Z"), { force: true });

    expect(store.listPositions("parliament:100")[0]!.district_id).toBe("colombo");
  });

  it("erasing a field is still possible when the source explicitly says there is no value", async () => {
    await syncSource(store, connector([minister("Minister of Energy")], "2026-01-01T00:00:00.000Z"));

    const explicitlyNone = person({
      positions: [{
        title: "Minister of Energy", roleType: "cabinet-minister",
        institution: "Cabinet of Ministers", factType: "portfolio-assignment",
        precedence: 10, supersedable: true,
        ministry: null, // the source states there is no ministry
      }],
    });
    await syncSource(store, connector([explicitlyNone], "2026-02-01T00:00:00.000Z"), { force: true });

    // `null` is an assertion, not an omission, and must be honoured.
    expect(store.listPositions("parliament:100")[0]!.ministry).toBeNull();
  });
});

/* ==========================================================================
   Cross-source field preservation (the real regression)
   ========================================================================== */

describe("a source that does not publish a field never erases it", () => {
  /*
   * This is the live bug this review found, reduced to a test.
   *
   * The Cabinet Office roster publishes portfolios and no appointment dates.
   * Parliament's profile pages publish the dates. Because the Cabinet
   * connector emitted `startDate: null` — asserting "there is no date" rather
   * than "I do not carry one" — every Cabinet sync erased the dates Parliament
   * had established. Twenty-three ministerial start dates, the Prime
   * Minister's among them, were found NULL in the live database and were
   * recoverable only by re-running the profile promotion.
   */
  const rosterHtml = (rows: Array<{ name: string; offices: string[] }>) =>
    [
      "<html><body>",
      "<td>Cabinet of Ministers</td>",
      ...rows.flatMap((row) => [
        `<td id="cab_normal_text_bold_e">${row.name}</td>`,
        ...row.offices.map((office) => `<td id="cab_normal_text_e">${office}</td>`),
      ]),
      "</body></html>",
    ].join("\n");

  it("a Cabinet sync preserves an appointment date Parliament established", async () => {
    const { createCabinetConnector } = await import("../fetchers/cabinetConnector.ts");
    const { createCabinetResolver } = await import("./resolveCabinetIdentity.ts");

    store.upsertSource({
      id: "S006", name: "Cabinet Office", institution: "Cabinet Office of Sri Lanka",
      sourceType: "executive", category: "Executive record", url: "https://www.cabinetoffice.gov.lk/",
    });

    // Parliament first: it publishes the dated appointment.
    await syncSource(
      store,
      connector(
        [person({
          canonicalName: "Test Person",
          positions: [{
            title: "Minister of Energy", roleType: "cabinet-minister",
            institution: "Cabinet of Ministers", ministry: "Energy",
            startDate: "2024-11-18",
            factType: "portfolio-assignment", precedence: 10, supersedable: true,
          }],
        })],
        "2026-01-01T00:00:00.000Z",
      ),
    );
    expect(store.listPositions("parliament:100")[0]!.start_date).toBe("2024-11-18");

    // Now the Cabinet Office, which publishes the same portfolio and no date.
    await syncSource(
      store,
      createCabinetConnector({
        fetchHtml: async () => rosterHtml([{ name: "Hon. Test Person", offices: ["Minister of Energy"] }]),
        now: () => "2026-02-01T00:00:00.000Z",
        resolvePerson: createCabinetResolver(store),
      }),
    );

    // The date must survive a source that simply does not publish dates.
    const position = store.listPositions("parliament:100").find((p) => p.title === "Minister of Energy")!;
    expect(position.start_date).toBe("2024-11-18");
  });
});

/* ==========================================================================
   Per-entity provenance
   ========================================================================== */

describe("per-entity provenance", () => {
  it("every synchronised position can answer all nine provenance questions", async () => {
    await syncSource(store, connector([person()], "2026-01-01T00:00:00.000Z"));
    await syncSource(store, connector([minister("Minister of Energy")], "2026-02-01T00:00:00.000Z"));

    const position = store.listPositions("parliament:100").find((p) => p.title === "Member of Parliament")!;
    const record = store.provenanceFor("position", position.id);

    expect(record).not.toBeNull();
    expect(record!.canonicalId).toBe(position.id);          // canonical ID
    expect(record!.sourceId).toBe(SOURCE_ID);               // source ID
    expect(record!.currentValue).toBeTruthy();              // current value
    expect(record!.firstSeenAt).toBeTruthy();               // first-seen
    expect(record!.lastSeenAt).toBeTruthy();                // last-seen
    expect(record!.sourceUrl).toMatch(/^https:\/\//);       // source URL
    expect(record!.sourceRetrievedAt).toBeTruthy();         // retrieval timestamp
    expect(record!.verification).toBe("source-linked");     // verification state
    expect(Array.isArray(record!.previousValues)).toBe(true); // previous value(s)
  });

  it("reports the previous value of a field that changed", async () => {
    await syncSource(store, connector([minister("Minister of Energy")], "2026-01-01T00:00:00.000Z"));
    await syncSource(store, connector([minister("Minister of Ports")], "2026-02-01T00:00:00.000Z"));

    const energy = store.listPositions("parliament:100").find((p) => p.title === "Minister of Energy")!;
    const record = store.provenanceFor("position", energy.id)!;

    const endDateChange = record.previousValues.find((c) => c.fieldName === "end_date");
    expect(endDateChange).toBeTruthy();
    expect(endDateChange!.newValue).toBe("2026-02-01");
  });

  it("last-seen advances on an unchanged re-check, because the source did confirm it", async () => {
    /*
     * These fixture timestamps deliberately LEAD the wall clock.
     *
     * `updated_at` is written with the real current time, while a fixture's
     * `retrievedAt` is whatever the test says. Past-dated fixtures therefore
     * always lose the `max(updated_at, last_successful_sync_at)` comparison
     * to the wall clock, and the derivation under test never gets exercised.
     * In production the two track each other, since a sync's retrieval time
     * IS roughly now.
     */
    const far = (year: number) => `${year}-01-01T00:00:00.000Z`;

    await syncSource(store, connector([person()], far(2090)));
    const position = store.listPositions("parliament:100")[0]!;
    const first = store.provenanceFor("position", position.id)!;

    await syncSource(store, connector([person()], far(2091)));
    const second = store.provenanceFor("position", position.id)!;

    // An unchanged run writes no canonical rows — that is the point of hash
    // comparison — so last-seen must be DERIVED from the source's own
    // successful-check timestamp, not from a row nobody rewrote.
    expect(second.lastSeenAt! > first.lastSeenAt!).toBe(true);
    // First-seen, by contrast, must not move.
    expect(second.firstSeenAt).toBe(first.firstSeenAt);
  });

  it("every education record carries evidence naming where it came from", async () => {
    // Education is written by the profile-detail promotion path, not by
    // syncSource, so it is exercised directly here.
    store.upsertPerson({ id: "parliament:100", slug: "test-person", canonicalName: "Test Person" });
    store.upsertEducation({
      id: "parliament:100~edu~bsc",
      personId: "parliament:100",
      educationType: "university",
      institution: "University of Colombo",
      qualification: "BSc",
      sourceId: SOURCE_ID,
      sourceUrl: "https://www.parliament.lk/en/members-of-parliament/mp-profile/100",
      retrievedAt: "2026-01-01T00:00:00.000Z",
      verification: "source-linked",
    });

    const record = store.provenanceFor("education", "parliament:100~edu~bsc");
    expect(record).not.toBeNull();
    expect(record!.sourceId).toBe(SOURCE_ID);
    expect(record!.sourceUrl).toMatch(/mp-profile\/100$/);
    expect(record!.sourceRetrievedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("refuses to claim source-linked verification for education with no evidence", () => {
    store.upsertPerson({ id: "parliament:100", slug: "test-person", canonicalName: "Test Person" });

    // No sourceId/sourceUrl supplied: the claim of being source-linked is
    // unsupported, and must not be recorded as though it were.
    expect(() =>
      store.upsertEducation({
        id: "parliament:100~edu~unsourced",
        personId: "parliament:100",
        educationType: "university",
        institution: "Nowhere University",
        verification: "source-linked",
      }),
    ).toThrow(/evidence/i);
  });
});

/* ==========================================================================
   Education history
   ========================================================================== */

describe("education history", () => {
  beforeEach(() => {
    store.upsertPerson({ id: "parliament:100", slug: "test-person", canonicalName: "Test Person" });
  });

  const edu = (qualification: string) => ({
    id: `parliament:100~edu~${qualification.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    personId: "parliament:100",
    educationType: "university" as const,
    institution: "University of Colombo",
    qualification,
    sourceId: SOURCE_ID,
    sourceUrl: "https://www.parliament.lk/en/members-of-parliament/mp-profile/100",
    retrievedAt: "2026-01-01T00:00:00.000Z",
  });

  it("a new unrelated qualification does not replace an existing one", () => {
    store.upsertEducation(edu("BSc Physics"));
    store.upsertEducation(edu("MPhil Economics"));

    const records = store.listEducation("parliament:100") as Array<{ qualification: string }>;
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.qualification).sort()).toEqual(["BSc Physics", "MPhil Economics"]);
  });

  it("re-importing the same qualification is idempotent", () => {
    expect(store.upsertEducation(edu("BSc Physics")).outcome).toBe("created");
    expect(store.upsertEducation(edu("BSc Physics")).outcome).toBe("unchanged");
    expect(store.listEducation("parliament:100")).toHaveLength(1);
  });
});
