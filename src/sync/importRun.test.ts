import { describe, it, expect } from "vitest";
import {
  personIdFor,
  positionIdFor,
  affiliationIdFor,
  evidenceIdFor,
  diffFields,
  reconcile,
  emptySummary,
} from "./importRun.ts";
import { contentHash, makeSnapshot, SnapshotLog } from "./snapshot.ts";
import { detectChange, isDuplicateImport } from "./pipeline.ts";

/* ==========================================================================
   Deterministic identity — the foundation of idempotency
   ========================================================================== */

describe("deterministic identifiers", () => {
  it("derives the same person id from the same source identity, every time", () => {
    expect(personIdFor("parliament", "3560")).toBe(personIdFor("parliament", "3560"));
    expect(personIdFor("parliament", "3560")).toBe("parliament:3560");
  });

  it("keeps identifier spaces from different sources apart", () => {
    // Both sources can legitimately use id "3560"; they are not the same person.
    expect(personIdFor("parliament", "3560")).not.toBe(personIdFor("electionCommission", "3560"));
  });

  it("derives the same position id from the same person and office", () => {
    const person = personIdFor("parliament", "3560");
    expect(positionIdFor(person, "Minister of Energy")).toBe(positionIdFor(person, "Minister of Energy"));
  });

  it("gives one person's two different offices two different ids", () => {
    const person = personIdFor("parliament", "3604");
    expect(positionIdFor(person, "Minister of Ports and Civil Aviation")).not.toBe(
      positionIdFor(person, "Minister of Energy"),
    );
  });

  it("gives two people holding the same office two different ids", () => {
    expect(positionIdFor("parliament:1", "Member of Parliament")).not.toBe(
      positionIdFor("parliament:2", "Member of Parliament"),
    );
  });

  it("derives stable affiliation and evidence ids", () => {
    expect(affiliationIdFor("parliament:1", "sjb")).toBe(affiliationIdFor("parliament:1", "sjb"));

    const args = {
      sourceId: "S001",
      entityType: "position" as const,
      entityId: "parliament:1#member-of-parliament",
      fieldName: "title",
      sourceUrl: "https://www.parliament.lk/en/members-of-parliament/mp-profile/1",
    };
    expect(evidenceIdFor(args)).toBe(evidenceIdFor(args));
  });

  it("gives evidence for different documents different ids", () => {
    const base = {
      sourceId: "S001",
      entityType: "person" as const,
      entityId: "parliament:1",
      fieldName: null,
    };
    expect(evidenceIdFor({ ...base, sourceUrl: "https://x.lk/a" })).not.toBe(
      evidenceIdFor({ ...base, sourceUrl: "https://x.lk/b" }),
    );
  });
});

/* ==========================================================================
   IMPORT → IMPORT AGAIN
   ========================================================================== */

describe("re-importing an unchanged source", () => {
  /** A tiny stand-in for the importer's per-record reconciliation loop. */
  function runImport(store: Map<string, Record<string, unknown>>, rows: Array<{ id: string; name: string; party: string }>) {
    const summary = emptySummary();
    for (const row of rows) {
      summary.seen++;
      const entityId = personIdFor("parliament", row.id);
      const incoming = { name: row.name, party: row.party };
      const result = reconcile({
        stored: store.get(entityId) ?? null,
        incoming,
        entityType: "person",
        entityId,
        watchedFields: ["name", "party"],
        sourceId: "S001",
        sourceSnapshotId: "SNAP-1",
        detectedAt: "2026-08-28T00:00:00.000Z",
        actor: "pipeline:parliament",
      });
      summary[result.outcome]++;
      summary.changeEvents.push(...result.changeEvents);
      store.set(entityId, incoming);
    }
    return summary;
  }

  const rows = [
    { id: "3560", name: "A.H.M.H. Abayarathna", party: "jathika-jana-balawegaya" },
    { id: "3143", name: "Ajith P. Perera", party: "samagi-jana-balawegaya-sjb" },
  ];

  it("creates every record on the first run", () => {
    const store = new Map();
    const first = runImport(store, rows);
    expect(first).toMatchObject({ seen: 2, created: 2, updated: 0, unchanged: 0 });
    expect(store.size).toBe(2);
  });

  it("creates NOTHING on a second run against unchanged data", () => {
    const store = new Map();
    runImport(store, rows);
    const second = runImport(store, rows);

    expect(second).toMatchObject({ seen: 2, created: 0, updated: 0, unchanged: 2 });
    // The whole point: no duplicate people.
    expect(store.size).toBe(2);
    // And no spurious audit noise.
    expect(second.changeEvents).toEqual([]);
  });

  it("stays stable across many runs", () => {
    const store = new Map();
    for (let i = 0; i < 5; i++) runImport(store, rows);
    expect(store.size).toBe(2);
  });

  it("records an update — and only the changed field — when the source changes", () => {
    const store = new Map();
    runImport(store, rows);

    const changed = [{ ...rows[0]!, party: "united-national-party-unp" }, rows[1]!];
    const second = runImport(store, changed);

    expect(second).toMatchObject({ seen: 2, created: 0, updated: 1, unchanged: 1 });
    expect(store.size).toBe(2); // still no duplicate
    expect(second.changeEvents).toHaveLength(1);
    expect(second.changeEvents[0]).toMatchObject({
      entityType: "person",
      entityId: "parliament:3560",
      fieldName: "party",
      previousValue: "jathika-jana-balawegaya",
      newValue: "united-national-party-unp",
    });
  });

  it("never marks a detected change as verified", () => {
    const store = new Map();
    runImport(store, rows);
    const second = runImport(store, [{ ...rows[0]!, name: "Renamed Person" }, rows[1]!]);
    // Detecting a change is not confirming it.
    expect(second.changeEvents[0]!.verifiedAt).toBeNull();
  });
});

describe("diffFields", () => {
  it("reports nothing for an identical record", () => {
    expect(diffFields({ a: "1", b: "2" }, { a: "1", b: "2" }, ["a", "b"])).toEqual([]);
  });

  it("ignores fields it was not asked to watch", () => {
    expect(diffFields({ a: "1", b: "2" }, { a: "1", b: "changed" }, ["a"])).toEqual([]);
  });

  it("treats null, undefined and empty string alike", () => {
    // A source that stops publishing a value has not set it to "null".
    expect(diffFields({ a: null }, { a: "" }, ["a"])).toEqual([]);
    expect(diffFields({ a: undefined }, { a: null }, ["a"])).toEqual([]);
  });

  it("reports a genuine change", () => {
    expect(diffFields({ a: "old" }, { a: "new" }, ["a"])).toEqual([
      { fieldName: "a", previousValue: "old", newValue: "new" },
    ]);
  });

  it("reports nothing when there is no stored record — that is a creation", () => {
    expect(diffFields(null, { a: "1" }, ["a"])).toEqual([]);
  });
});

/* ==========================================================================
   Snapshots and change detection
   ========================================================================== */

describe("snapshots", () => {
  it("hashes identical content identically and different content differently", () => {
    expect(contentHash("abc")).toBe(contentHash("abc"));
    expect(contentHash("abc")).not.toBe(contentHash("abd"));
  });

  it("keeps history rather than replacing it", () => {
    const log = new SnapshotLog();
    log.append(makeSnapshot({ sourceId: "S001", url: "https://x.lk", content: "v1", retrievedAt: "2026-01-01T00:00:00Z", parserVersion: "v1" }));
    log.append(makeSnapshot({ sourceId: "S001", url: "https://x.lk", content: "v2", retrievedAt: "2026-02-01T00:00:00Z", parserVersion: "v1" }));

    expect(log.size).toBe(2);
    expect(log.historyFor("S001")).toHaveLength(2);
    expect(log.latestFor("S001")?.retrievedAt).toBe("2026-02-01T00:00:00Z");
  });

  it("detects a real change and a real non-change across snapshots", () => {
    const log = new SnapshotLog();
    const v1 = log.append(makeSnapshot({ sourceId: "S001", url: "https://x.lk", content: "v1", retrievedAt: "2026-01-01T00:00:00Z", parserVersion: "v1" }));

    expect(detectChange(v1, { contentHash: contentHash("v1") })).toEqual({ changed: false, reason: "unchanged" });
    expect(detectChange(v1, { contentHash: contentHash("v2") })).toEqual({ changed: true, reason: "content-changed" });
  });

  it("prevents importing the same snapshot twice", () => {
    const snap = makeSnapshot({ sourceId: "S001", url: "https://x.lk", content: "same", retrievedAt: "2026-01-01T00:00:00Z", parserVersion: "v1" });
    expect(isDuplicateImport([snap], { sourceId: "S001", contentHash: snap.contentHash })).toBe(true);
  });

  it("hashes SEMANTIC content, so a per-request token does not look like a change", () => {
    // The Parliament directory embeds a fresh CSRF token in every response.
    // Hashing raw bytes would report a change on every single check; hashing
    // the parsed rows does not. This pins that distinction.
    const rowsA = JSON.stringify([["3560", "Abayarathna", "JJB"]]);
    const rowsB = JSON.stringify([["3560", "Abayarathna", "JJB"]]);
    expect(contentHash(rowsA)).toBe(contentHash(rowsB));

    const rawA = `<script>token="aaa"</script>${rowsA}`;
    const rawB = `<script>token="bbb"</script>${rowsB}`;
    expect(contentHash(rawA)).not.toBe(contentHash(rawB));
  });
});
