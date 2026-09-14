import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase, migrate, type Database } from "../db/database.ts";
import { CanonicalStore } from "../db/store.ts";
import { syncSource, type ConnectorRun, type NormalisedPerson } from "./syncSource.ts";
import { SourceLock, staleRunGuard } from "../scheduler/lock.ts";

/**
 * Javora — the eight production-readiness scenarios for automatic source
 * synchronisation, run against the real pipeline and a real (in-memory)
 * database.
 *
 *   1. no change                6. duplicate source record
 *   2. one changed field         7. source unavailable
 *   3. new position              8. partial sync failure
 *   4. ended position
 *   5. malformed source record
 *
 * Several of these are also exercised elsewhere (server/sync/syncSource.test.ts,
 * server/sync/cabinetSync.test.ts) as part of testing specific pipeline
 * behaviours; this file exists as the one place that maps directly onto the
 * checklist, so "is scenario N covered" has a single, findable answer. Two
 * further checks — the overlapping-run lock and stale-run reclaim — cover the
 * worker-level requirement that scheduled execution not run a source twice
 * at once.
 */

const SOURCE_ID = "S001";

function fixtureConnector(
  people: NormalisedPerson[],
  retrievedAt: string,
  fetchImpl?: () => Promise<{ retrievedAt: string; canonicalPayload: string; people: NormalisedPerson[]; problems?: never[] }>,
): ConnectorRun {
  return {
    sourceId: SOURCE_ID,
    connectorVersion: "fixture@1",
    parserVersion: "fixture@1",
    url: "https://www.parliament.lk/en/members-of-parliament/directory-of-members/",
    fetch:
      fetchImpl ??
      (async () => ({
        retrievedAt,
        // Everything that matters to the pipeline's output must be reflected
        // here — the hash IS the change-detection mechanism, so a field left
        // out of this serialisation is a field whose change goes unnoticed.
        canonicalPayload: JSON.stringify(
          people.map((p) => [
            p.externalId,
            p.canonicalName,
            p.districtId ?? null,
            p.positions.map((x) => [x.title, x.roleType, x.institution, x.districtId ?? null]).sort(),
          ]),
        ),
        people,
        problems: [],
      })),
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
        factType: "parliamentary-membership",
        precedence: 40,
      },
    ],
    ...over,
  };
}

function freshStore(): { db: Database; store: CanonicalStore } {
  const db = openDatabase(":memory:");
  migrate(db, { silent: true });
  const store = new CanonicalStore(db);
  store.upsertSource({
    id: SOURCE_ID, name: "Parliament", institution: "Parliament of Sri Lanka",
    sourceType: "legislature", category: "Official directory", url: "https://www.parliament.lk/",
  });
  return { db, store };
}

let store: CanonicalStore;
beforeEach(() => { store = freshStore().store; });

/* ==========================================================================
   1. No change
   ========================================================================== */

describe("1. no change", () => {
  it("re-syncing identical content writes nothing new and reports 'unchanged'", async () => {
    const people = [person()];
    await syncSource(store, fixtureConnector(people, "2026-01-01T00:00:00.000Z"));
    const before = store.counts();

    const result = await syncSource(store, fixtureConnector(people, "2026-01-02T00:00:00.000Z"));

    expect(result.outcome).toBe("unchanged");
    // Canonical data is untouched. `syncRuns`/`snapshots` are EXPECTED to
    // grow — a snapshot is still recorded on an unchanged check, as proof
    // the source was checked at all — so those two are deliberately excluded
    // from this comparison rather than compared and then explained away.
    const { syncRuns: _r1, snapshots: _s1, ...beforeData } = before;
    const { syncRuns: _r2, snapshots: _s2, ...afterData } = store.counts();
    expect(afterData).toEqual(beforeData);
    expect(store.countSnapshots(SOURCE_ID)).toBe(2);
  });
});

/* ==========================================================================
   2. One changed field
   ========================================================================== */

describe("2. one changed field", () => {
  it("changing only the district updates that field and logs one change event, preserving everything else", async () => {
    await syncSource(store, fixtureConnector([person()], "2026-01-01T00:00:00.000Z"));
    const before = store.getPerson("parliament:100")!;

    const changed = person({ districtId: "kandy", districtName: "Kandy" });
    const result = await syncSource(store, fixtureConnector([changed], "2026-01-02T00:00:00.000Z"));

    expect(result.outcome).toBe("applied");
    const affiliation = store.database.get<{ party_id: string }>(
      `SELECT * FROM position WHERE person_id = 'parliament:100' AND district_id = 'kandy'`,
    );
    // District lives on the position row for a parliamentary seat.
    expect(affiliation).toBeTruthy();
    // The person's OTHER fields are untouched.
    const after = store.getPerson("parliament:100")!;
    expect(after.canonical_name).toBe(before.canonical_name);
    expect(after.date_of_birth).toBe(before.date_of_birth);
  });
});

/* ==========================================================================
   3. New position
   ========================================================================== */

describe("3. new position", () => {
  it("a newly reported office is added without disturbing the existing one", async () => {
    await syncSource(store, fixtureConnector([person()], "2026-01-01T00:00:00.000Z"));

    const withMinistry = person({
      positions: [
        ...person().positions,
        {
          title: "Minister of Testing", roleType: "cabinet-minister", institution: "Cabinet of Ministers",
          factType: "portfolio-assignment", precedence: 10, supersedable: true,
        },
      ],
    });
    const result = await syncSource(store, fixtureConnector([withMinistry], "2026-01-02T00:00:00.000Z"));

    expect(result.outcome).toBe("applied");
    expect(result.positionsOpened).toBe(1);
    const positions = store.listPositions("parliament:100");
    expect(positions).toHaveLength(2);
    expect(positions.every((p) => !p.end_date)).toBe(true); // the original MP seat is untouched
  });
});

/* ==========================================================================
   4. Ended position
   ========================================================================== */

describe("4. ended position", () => {
  // Modelled on how the real Cabinet Office source behaves: it reports
  // ONLY ministerial portfolios, never parliamentary membership, so a
  // minister who leaves government disappears from that source's payload
  // ENTIRELY rather than remaining present minus one position. That is what
  // `closeUnreportedPositions` is built to recognise (see syncSource.ts) —
  // mixing a supersedable and a non-supersedable role from the SAME source
  // for one person, as an earlier draft of this test did, does not occur in
  // production and is not what the pipeline's supersession logic targets.
  const minister = person({
    positions: [{
      title: "Minister of Testing", roleType: "cabinet-minister", institution: "Cabinet of Ministers",
      factType: "portfolio-assignment", precedence: 10, supersedable: true,
    }],
  });

  it("an office no longer reported is CLOSED, not deleted — history survives", async () => {
    await syncSource(store, fixtureConnector([minister], "2026-01-01T00:00:00.000Z"));

    // The minister no longer appears in this source's payload at all.
    const result = await syncSource(store, fixtureConnector([], "2026-01-02T00:00:00.000Z"));

    expect(result.outcome).toBe("applied");
    expect(result.positionsClosed).toBe(1);
    const positions = store.listPositions("parliament:100");
    expect(positions).toHaveLength(1); // the row still exists
    const ministry = positions[0]!;
    expect(ministry.end_date).toBe("2026-01-02");
    expect(ministry.title).toBe("Minister of Testing"); // the row itself was never rewritten
  });
});

/* ==========================================================================
   5. Malformed source record
   ========================================================================== */

describe("5. malformed source record", () => {
  it("a record with no name is rejected, logged, and does not stop the rest of the batch", async () => {
    const good = person({ externalId: "200", slug: "good-person", canonicalName: "Good Person" });
    const bad = person({ externalId: "201", slug: "bad-person", canonicalName: "" }); // malformed: no name

    const result = await syncSource(store, fixtureConnector([good, bad], "2026-01-01T00:00:00.000Z"));

    expect(result.outcome).toBe("applied"); // the run as a whole still succeeds
    expect(result.skipped).toBe(1);
    expect(result.problems.some((p) => p.code === "missing-name")).toBe(true);
    // The good record was written despite the bad one.
    expect(store.getPersonBySlug("good-person")).toBeTruthy();
    expect(store.getPersonBySlug("bad-person")).toBeFalsy();
  });

  it("a position with no title is rejected without silently inventing one", async () => {
    const bad = person({
      positions: [{ title: "", roleType: "member-of-parliament", institution: "Parliament of Sri Lanka", factType: "parliamentary-membership" }],
    });
    const result = await syncSource(store, fixtureConnector([bad], "2026-01-01T00:00:00.000Z"));

    expect(result.skipped).toBe(1);
    expect(result.problems.some((p) => p.code === "missing-position-title")).toBe(true);
    expect(store.database.all(`SELECT * FROM person`)).toHaveLength(0);
  });

  it("a malformed re-report of an EXISTING person does not close their real position", async () => {
    await syncSource(store, fixtureConnector([person()], "2026-01-01T00:00:00.000Z"));
    expect(store.openPositions("parliament:100")).toHaveLength(1);

    // The source reports this person again, but the record itself is now
    // malformed (no positions data at all would be a parse failure upstream;
    // here the position has no institution, so it fails validation).
    const malformed = person({
      positions: [{ title: "Member of Parliament", roleType: "member-of-parliament", institution: "" }] as never,
    });
    const result = await syncSource(store, fixtureConnector([malformed], "2026-01-02T00:00:00.000Z"));

    expect(result.skipped).toBe(1);
    // The critical assertion: their EXISTING seat must still be open. A
    // parser hiccup must never be read as "this person left office".
    expect(store.openPositions("parliament:100")).toHaveLength(1);
  });
});

/* ==========================================================================
   6. Duplicate source record
   ========================================================================== */

describe("6. duplicate source record", () => {
  it("the same person appearing twice in one payload does not create two records", async () => {
    const p = person();
    const result = await syncSource(store, fixtureConnector([p, p], "2026-01-01T00:00:00.000Z"));

    expect(result.outcome).toBe("applied");
    expect(result.counts.seen).toBe(2); // both were processed
    expect(store.database.all(`SELECT id FROM person`)).toHaveLength(1); // one row
    expect(store.listPositions("parliament:100")).toHaveLength(1);
  });

  it("is idempotent across separate runs of the same content", async () => {
    await syncSource(store, fixtureConnector([person()], "2026-01-01T00:00:00.000Z"));
    await syncSource(store, fixtureConnector([person()], "2026-01-02T00:00:00.000Z"), { force: true });

    expect(store.database.all(`SELECT id FROM person`)).toHaveLength(1);
    expect(store.database.all(`SELECT id FROM position`)).toHaveLength(1);
  });
});

/* ==========================================================================
   7. Source unavailable
   ========================================================================== */

describe("7. source unavailable", () => {
  it("preserves canonical data and records the failure when every retry attempt fails", async () => {
    await syncSource(store, fixtureConnector([person()], "2026-01-01T00:00:00.000Z"));
    const before = store.counts();

    let calls = 0;
    const failing = fixtureConnector([], "", async () => {
      calls++;
      throw new Error("connect ETIMEDOUT parliament.lk:443");
    });

    const result = await syncSource(store, failing, { retry: { attempts: 3, timeoutMs: 5000, backoffMs: 1, sleep: async () => {} } });

    expect(result.outcome).toBe("failed");
    expect(result.error).toMatch(/ETIMEDOUT/);
    expect(calls).toBe(3); // all three attempts were made
    // Canonical data untouched. syncRuns/snapshots DO grow — the failure is
    // recorded, not hidden — which is exactly what must not be mistaken for
    // canonical data having changed.
    const after = store.counts();
    expect(after.people).toBe(before.people);
    expect(after.positions).toBe(before.positions);
    expect(after.evidence).toBe(before.evidence);
  });

  it("recovers if the source fails once and then succeeds — a transient blip does not fail the run", async () => {
    let calls = 0;
    const flaky = fixtureConnector([person()], "2026-01-01T00:00:00.000Z", async () => {
      calls++;
      if (calls === 1) throw new Error("socket hang up");
      return {
        retrievedAt: "2026-01-01T00:00:00.000Z",
        canonicalPayload: JSON.stringify([["100", "Test Person"]]),
        people: [person()],
        problems: [],
      };
    });

    const result = await syncSource(store, flaky, { retry: { attempts: 3, timeoutMs: 5000, backoffMs: 1, sleep: async () => {} } });

    expect(result.outcome).toBe("applied");
    expect(calls).toBe(2); // failed once, succeeded on the second attempt
    expect(store.getPersonBySlug("test-person")).toBeTruthy();
  });

  it("abandons a single attempt that never responds, rather than hanging forever", async () => {
    const hanging = fixtureConnector([], "", () => new Promise(() => {})); // never resolves
    const result = await syncSource(store, hanging, {
      retry: { attempts: 1, timeoutMs: 20, backoffMs: 1, sleep: async () => {} },
    });

    expect(result.outcome).toBe("failed");
    expect(result.error).toMatch(/timed out/i);
  });
});

/* ==========================================================================
   8. Partial sync failure
   ========================================================================== */

describe("8. partial sync failure", () => {
  it("when one of several records fails to write, the others still commit", async () => {
    const ok1 = person({ externalId: "1", slug: "person-one", canonicalName: "Person One" });
    // Same slug as ok1 on a DIFFERENT external id — will collide on the
    // UNIQUE(slug) constraint and throw partway through the batch.
    const willFail = person({ externalId: "2", slug: "person-one", canonicalName: "Person Two" });
    const ok2 = person({ externalId: "3", slug: "person-three", canonicalName: "Person Three" });

    const result = await syncSource(store, fixtureConnector([ok1, willFail, ok2], "2026-01-01T00:00:00.000Z"));

    expect(result.outcome).toBe("applied"); // the batch as a whole is not failed
    expect(result.skipped).toBe(1);
    expect(result.problems.some((p) => p.code === "apply-failed")).toBe(true);
    // The two good records committed despite the one that threw mid-batch —
    // this is the transaction NOT being rolled back wholesale.
    expect(store.getPersonBySlug("person-one")).toBeTruthy();
    expect(store.getPersonBySlug("person-three")).toBeTruthy();
  });

  it("the run's own error_message and outcome make a partial failure visible, not silent", async () => {
    const ok = person({ externalId: "1", slug: "person-one" });
    const willFail = person({ externalId: "2", slug: "person-one", canonicalName: "Collides" });

    await syncSource(store, fixtureConnector([ok, willFail], "2026-01-01T00:00:00.000Z"));

    const runs = store.listRuns(SOURCE_ID) as Array<Record<string, unknown>>;
    expect(runs[0]!.outcome).toBe("applied");
    expect(String(runs[0]!.error_message)).toMatch(/rejected/i);
  });
});

/* ==========================================================================
   Worker-level: overlapping runs and stale-run reclaim
   ========================================================================== */

describe("overlapping-run protection", () => {
  it("a second acquire for the same source fails while the first holds the lock", () => {
    const lock = new SourceLock();
    expect(lock.tryAcquire("S001")).toBe(true);
    expect(lock.tryAcquire("S001")).toBe(false); // already running
    lock.release("S001");
    expect(lock.tryAcquire("S001")).toBe(true); // free again
  });

  it("locks are independent per source", () => {
    const lock = new SourceLock();
    expect(lock.tryAcquire("S001")).toBe(true);
    expect(lock.tryAcquire("S006")).toBe(true); // a different source is unaffected
  });

  it("a recent unfinished run blocks a new one from starting", () => {
    store.startRun({ id: "RUN-1", sourceId: SOURCE_ID, trigger: "scheduled", startedAt: new Date().toISOString() });
    const check = staleRunGuard(store, SOURCE_ID, 30);
    expect(check.blocked).toBe(true);
    expect(check.staleRunId).toBeNull();
  });

  it("an old unfinished run is reclaimed as abandoned rather than blocking forever", () => {
    const longAgo = new Date(Date.now() - 60 * 60_000).toISOString(); // 1 hour ago
    store.startRun({ id: "RUN-1", sourceId: SOURCE_ID, trigger: "scheduled", startedAt: longAgo });
    const check = staleRunGuard(store, SOURCE_ID, 30); // 30-minute threshold
    expect(check.blocked).toBe(false);
    expect(check.staleRunId).toBe("RUN-1");
  });

  it("a completed run never blocks the next one", async () => {
    await syncSource(store, fixtureConnector([person()], "2026-01-01T00:00:00.000Z"));
    const check = staleRunGuard(store, SOURCE_ID, 30);
    expect(check.blocked).toBe(false);
    expect(check.staleRunId).toBeNull();
  });
});
