import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase, migrate, type Database } from "../db/database.ts";
import { CanonicalStore } from "../db/store.ts";
import { syncSource, type ConnectorRun, type NormalisedPerson } from "./syncSource.ts";

/**
 * End-to-end synchronisation tests against a REAL database (node:sqlite,
 * migrated from the same SQL that production would run) and a CONTROLLED
 * source fixture whose contents the test changes between runs.
 *
 * The fixture matters: proving "a portfolio change preserves history"
 * requires being able to change the portfolio, which nobody can do to
 * parliament.lk. The Parliament connector is exercised separately against
 * the live source; this exercises the pipeline's behaviour when a source
 * genuinely moves.
 */

const SOURCE_ID = "S001";

/** A source whose payload the test controls. */
function fixtureConnector(people: NormalisedPerson[], retrievedAt: string): ConnectorRun {
  return {
    sourceId: SOURCE_ID,
    connectorVersion: "fixture@1",
    parserVersion: "fixture@1",
    url: "https://www.parliament.lk/en/members-of-parliament/directory-of-members/",
    async fetch() {
      return {
        retrievedAt,
        // Canonical serialisation: stable order, only the facts that matter.
        canonicalPayload: JSON.stringify(
          people.map((p) => [p.externalId, p.canonicalName, p.partyId, p.positions.map((x) => x.title).sort()]),
        ),
        people,
        problems: [],
      };
    },
  };
}

function person(over: Partial<NormalisedPerson> = {}): NormalisedPerson {
  return {
    externalId: "3560",
    externalIdKey: "parliament",
    canonicalName: "A.H.M.H. Abayarathna",
    slug: "a-h-m-h-abayarathna",
    aliases: ["Hon. (Prof.) A.H.M.H. Abayarathna, M.P."],
    dateOfBirth: "1965-09-19",
    partyId: "jathika-jana-balawegaya",
    partyName: "Jathika Jana balawegaya",
    partyAbbreviation: "JJB",
    districtId: "puttalam",
    districtName: "Puttalam",
    sourceUrl: "https://www.parliament.lk/en/members-of-parliament/mp-profile/3560",
    searchText: "a h m h abayarathna jathika jana balawegaya puttalam",
    positions: [
      {
        title: "Member of Parliament",
        roleType: "member-of-parliament",
        institution: "Parliament of Sri Lanka",
        factType: "parliamentary-membership",
        precedence: 40,
        supersedable: false,
      },
      {
        title: "Minister of X",
        roleType: "cabinet-minister",
        institution: "Cabinet of Ministers",
        ministry: "X",
        factType: "portfolio-assignment",
        precedence: 10,
        supersedable: true,
      },
    ],
    ...over,
  };
}

/** The same person, after the source changes their portfolio to Y. */
function personWithMinisterY(): NormalisedPerson {
  const base = person();
  return {
    ...base,
    positions: [
      base.positions[0]!,
      {
        title: "Minister of Y",
        roleType: "cabinet-minister",
        institution: "Cabinet of Ministers",
        ministry: "Y",
        factType: "portfolio-assignment",
        precedence: 10,
        supersedable: true,
      },
    ],
  };
}

let db: Database;
let store: CanonicalStore;

beforeEach(() => {
  db = openDatabase(":memory:");
  migrate(db, { silent: true });
  store = new CanonicalStore(db);
  store.upsertSource({
    id: SOURCE_ID,
    name: "Parliament of Sri Lanka — Members Directory",
    institution: "Parliament of Sri Lanka",
    sourceType: "legislature",
    category: "Official directory",
    url: "https://www.parliament.lk/",
    authoritativeFor: [{ factType: "parliamentary-membership" }, { factType: "portfolio-assignment", rank: 3 }],
  });
});

/* ==========================================================================
   Initial import
   ========================================================================== */

describe("initial synchronisation", () => {
  it("creates the person, their positions, and evidence", async () => {
    const result = await syncSource(store, fixtureConnector([person()], "2026-01-01T00:00:00.000Z"));

    expect(result.outcome).toBe("applied");
    expect(result.counts).toMatchObject({ seen: 1, created: 1 });

    const counts = store.counts();
    expect(counts.people).toBe(1);
    expect(counts.positions).toBe(2);
    expect(counts.evidence).toBeGreaterThan(0);
    expect(counts.snapshots).toBe(1);
  });

  it("records a snapshot with the parsed-content hash", async () => {
    await syncSource(store, fixtureConnector([person()], "2026-01-01T00:00:00.000Z"));
    const snap = store.latestSnapshot(SOURCE_ID);
    expect(snap).not.toBeNull();
    expect(snap!.content_hash).toMatch(/^fnv1a32:/);
  });

  it("anchors the person on the source's external id", async () => {
    await syncSource(store, fixtureConnector([person()], "2026-01-01T00:00:00.000Z"));
    expect(store.findPersonByExternalId("parliament", "3560")).toBe("parliament:3560");
  });
});

/* ==========================================================================
   Idempotency
   ========================================================================== */

describe("re-running against an unchanged source", () => {
  it("detects no change and writes nothing new", async () => {
    const connector = fixtureConnector([person()], "2026-01-01T00:00:00.000Z");
    await syncSource(store, connector);
    const before = store.counts();

    const second = await syncSource(store, fixtureConnector([person()], "2026-01-02T00:00:00.000Z"));

    expect(second.outcome).toBe("unchanged");
    expect(second.changeReason).toBe("unchanged");

    const after = store.counts();
    expect(after.people).toBe(before.people);
    expect(after.positions).toBe(before.positions);
    expect(after.evidence).toBe(before.evidence);
    expect(after.changeEvents).toBe(before.changeEvents);
  });

  it("still records the snapshot, as proof the source was checked", async () => {
    await syncSource(store, fixtureConnector([person()], "2026-01-01T00:00:00.000Z"));
    await syncSource(store, fixtureConnector([person()], "2026-01-02T00:00:00.000Z"));
    // Two checks happened; both are on the record even though only one changed.
    expect(store.countSnapshots(SOURCE_ID)).toBe(2);
  });

  it("creates no duplicates even when forced to re-apply", async () => {
    await syncSource(store, fixtureConnector([person()], "2026-01-01T00:00:00.000Z"));
    const before = store.counts();

    await syncSource(store, fixtureConnector([person()], "2026-01-02T00:00:00.000Z"), { force: true });

    const after = store.counts();
    expect(after.people).toBe(before.people);
    expect(after.positions).toBe(before.positions);
    expect(after.evidence).toBe(before.evidence);
    expect(after.changeEvents).toBe(before.changeEvents);
  });

  it("stays stable across five runs", async () => {
    for (let i = 0; i < 5; i++) {
      await syncSource(store, fixtureConnector([person()], `2026-01-0${i + 1}T00:00:00.000Z`), { force: true });
    }
    const counts = store.counts();
    expect(counts.people).toBe(1);
    expect(counts.positions).toBe(2);
  });
});

/* ==========================================================================
   THE PORTFOLIO CHANGE — the behaviour this whole system exists for
   ========================================================================== */

describe("a portfolio change in the official source", () => {
  const T1 = "2026-01-01T00:00:00.000Z";
  const T2 = "2026-06-01T00:00:00.000Z";

  async function runChange() {
    await syncSource(store, fixtureConnector([person()], T1));
    return syncSource(store, fixtureConnector([personWithMinisterY()], T2));
  }

  it("is detected as a change", async () => {
    const result = await runChange();
    expect(result.outcome).toBe("applied");
    expect(result.changed).toBe(true);
    expect(result.changeReason).toBe("content-changed");
  });

  it("PRESERVES the old position instead of overwriting it", async () => {
    await runChange();

    const positions = store.listPositions("parliament:3560");
    const titles = positions.map((p) => p.title).sort();

    // Both offices exist. The old one was not rewritten into the new one.
    expect(titles).toEqual(["Member of Parliament", "Minister of X", "Minister of Y"]);

    const oldOne = positions.find((p) => p.title === "Minister of X")!;
    expect(oldOne.end_date).toBe("2026-06-01");
    expect(oldOne.title).toBe("Minister of X"); // untouched
  });

  it("makes the new position current and the old one historical", async () => {
    await runChange();
    const positions = store.listPositions("parliament:3560");

    const x = positions.find((p) => p.title === "Minister of X")!;
    const y = positions.find((p) => p.title === "Minister of Y")!;

    expect(x.end_date).not.toBeNull();   // historical
    expect(y.end_date).toBeNull();       // current
  });

  it("links the closed position to the one that replaced it", async () => {
    await runChange();
    const x = store.listPositions("parliament:3560").find((p) => p.title === "Minister of X")!;
    const y = store.listPositions("parliament:3560").find((p) => p.title === "Minister of Y")!;
    expect(x.superseded_by).toBe(y.id);
  });

  it("creates a CHANGE EVENT describing the transition", async () => {
    await runChange();
    const events = store.listChangeEvents();
    const portfolio = events.find((e) => (e as Record<string, unknown>).change_kind === "portfolio-changed");

    expect(portfolio).toBeDefined();
    expect(portfolio).toMatchObject({
      entity_type: "position",
      field_name: "end_date",
      new_value: "2026-06-01",
    });
    // Detecting a change is not verifying it.
    expect((portfolio as Record<string, unknown>).verified_at).toBeNull();
  });

  it("changes the source snapshot hash", async () => {
    await syncSource(store, fixtureConnector([person()], T1));
    const first = store.latestSnapshot(SOURCE_ID)!.content_hash;

    await syncSource(store, fixtureConnector([personWithMinisterY()], T2));
    const second = store.latestSnapshot(SOURCE_ID)!.content_hash;

    expect(second).not.toBe(first);
    expect(store.countSnapshots(SOURCE_ID)).toBe(2);
  });

  it("creates NO duplicate person", async () => {
    await runChange();
    expect(store.counts().people).toBe(1);
  });

  it("leaves Member of Parliament untouched — it is not a supersedable slot", async () => {
    await runChange();
    const mp = store.listPositions("parliament:3560").find((p) => p.title === "Member of Parliament")!;
    expect(mp.end_date).toBeNull();
  });

  it("is idempotent AFTER the change: re-running adds nothing", async () => {
    await runChange();
    const before = store.counts();

    const third = await syncSource(store, fixtureConnector([personWithMinisterY()], "2026-06-02T00:00:00.000Z"));

    expect(third.outcome).toBe("unchanged");
    const after = store.counts();
    expect(after.people).toBe(before.people);
    expect(after.positions).toBe(before.positions);
    expect(after.changeEvents).toBe(before.changeEvents);
  });

  it("keeps evidence for BOTH the old and the new office", async () => {
    await runChange();
    const x = store.listPositions("parliament:3560").find((p) => p.title === "Minister of X")!;
    const y = store.listPositions("parliament:3560").find((p) => p.title === "Minister of Y")!;

    // Losing currency must never delete the record that the office was held.
    expect(store.evidenceFor("position", x.id).length).toBeGreaterThan(0);
    expect(store.evidenceFor("position", y.id).length).toBeGreaterThan(0);
  });
});

/* ==========================================================================
   Reappointment
   ========================================================================== */

describe("reappointment to a previously ended office", () => {
  it("reopens the position rather than creating a second copy", async () => {
    await syncSource(store, fixtureConnector([person()], "2026-01-01T00:00:00.000Z"));
    await syncSource(store, fixtureConnector([personWithMinisterY()], "2026-06-01T00:00:00.000Z"));
    // The source reports Minister of X again.
    await syncSource(store, fixtureConnector([person()], "2026-09-01T00:00:00.000Z"));

    const positions = store.listPositions("parliament:3560");
    const xRows = positions.filter((p) => p.title === "Minister of X");

    expect(xRows).toHaveLength(1);        // no duplicate row
    expect(xRows[0]!.end_date).toBeNull(); // current again

    const reappointed = store.listChangeEvents().find(
      (e) => (e as Record<string, unknown>).change_kind === "reappointed",
    );
    expect(reappointed).toBeDefined();
  });
});

/* ==========================================================================
   New and departing people
   ========================================================================== */

describe("membership changes", () => {
  it("adds a newly appearing person without disturbing existing ones", async () => {
    await syncSource(store, fixtureConnector([person()], "2026-01-01T00:00:00.000Z"));

    const newcomer = person({
      externalId: "9999",
      canonicalName: "New Member",
      slug: "new-member",
      aliases: [],
      dateOfBirth: null,
    });
    const result = await syncSource(store, fixtureConnector([person(), newcomer], "2026-02-01T00:00:00.000Z"));

    expect(result.counts.created).toBe(1);
    expect(result.counts.unchanged).toBe(1);
    expect(store.counts().people).toBe(2);
  });
});

/* ==========================================================================
   A run that reads less must not delete what a fuller run established
   ========================================================================== */

describe("a partial run (fields not fetched)", () => {
  it("does NOT erase a field it simply did not look at", async () => {
    // Full run: profile pages fetched, so date of birth is known.
    await syncSource(store, fixtureConnector([person()], "2026-01-01T00:00:00.000Z"));
    expect(store.getPerson("parliament:3560")!.date_of_birth).toBe("1965-09-19");

    // Listing-only run: reports `undefined` for date of birth, meaning "this
    // run did not look", NOT "the source says there is none".
    const listingOnly = person({ dateOfBirth: undefined, biography: undefined });
    await syncSource(store, fixtureConnector([listingOnly], "2026-02-01T00:00:00.000Z"), { force: true });

    // The regression this pins: a listing-only sync once wiped the date of
    // birth off 219 people and logged 365 change events for facts that had
    // not changed.
    expect(store.getPerson("parliament:3560")!.date_of_birth).toBe("1965-09-19");
    expect(store.countChangeEvents()).toBe(0);
  });

  it("DOES clear a field when the source explicitly reports no value", async () => {
    await syncSource(store, fixtureConnector([person()], "2026-01-01T00:00:00.000Z"));

    // null, not undefined: the source looked and found nothing.
    const cleared = person({ dateOfBirth: null });
    await syncSource(store, fixtureConnector([cleared], "2026-02-01T00:00:00.000Z"), { force: true });

    expect(store.getPerson("parliament:3560")!.date_of_birth).toBeNull();
    expect(store.countChangeEvents()).toBeGreaterThan(0);
  });
});

/* ==========================================================================
   Failure handling
   ========================================================================== */

describe("when the official source is unavailable", () => {
  const failing = (): ConnectorRun => ({
    sourceId: SOURCE_ID,
    connectorVersion: "fixture@1",
    parserVersion: "fixture@1",
    url: "https://www.parliament.lk/",
    async fetch() {
      throw new Error("connect ETIMEDOUT parliament.lk:443");
    },
  });

  it("does NOT erase existing canonical data", async () => {
    await syncSource(store, fixtureConnector([person()], "2026-01-01T00:00:00.000Z"));
    const before = store.counts();

    const result = await syncSource(store, failing(), { retry: { attempts: 1 } });

    expect(result.outcome).toBe("failed");
    expect(result.error).toMatch(/ETIMEDOUT/);

    const after = store.counts();
    expect(after.people).toBe(before.people);
    expect(after.positions).toBe(before.positions);
    expect(after.evidence).toBe(before.evidence);
  });

  it("records the failure with its error", async () => {
    await syncSource(store, failing(), { retry: { attempts: 1 } });
    const runs = store.listRuns(SOURCE_ID) as Array<Record<string, unknown>>;
    expect(runs[0]!.outcome).toBe("failed");
    expect(String(runs[0]!.error_message)).toMatch(/ETIMEDOUT/);
  });

  it("keeps the last successful snapshot as the baseline", async () => {
    await syncSource(store, fixtureConnector([person()], "2026-01-01T00:00:00.000Z"));
    const good = store.latestSnapshot(SOURCE_ID)!;

    await syncSource(store, failing(), { retry: { attempts: 1 } });

    // latestSnapshot only considers status='ok', so a failed fetch cannot
    // become the baseline that the next change is compared against.
    expect(store.latestSnapshot(SOURCE_ID)!.id).toBe(good.id);
  });

  it("marks the source failing without claiming a successful sync", async () => {
    await syncSource(store, fixtureConnector([person()], "2026-01-01T00:00:00.000Z"));
    await syncSource(store, failing(), { retry: { attempts: 1 } });

    const source = store.getSource(SOURCE_ID) as Record<string, unknown>;
    expect(source.sync_state).toBe("failing");
    // The last SUCCESSFUL sync timestamp is not moved by a failure.
    expect(source.last_successful_sync_at).toBe("2026-01-01T00:00:00.000Z");
  });
});

/* ==========================================================================
   Dry run
   ========================================================================== */

describe("dry run", () => {
  it("reports what would happen without writing canonical records", async () => {
    const result = await syncSource(store, fixtureConnector([person()], "2026-01-01T00:00:00.000Z"), {
      dryRun: true,
    });

    expect(result.outcome).toBe("dry-run");
    expect(store.counts().people).toBe(0);
    expect(store.counts().snapshots).toBe(0);
  });
});
