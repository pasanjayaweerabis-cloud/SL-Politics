import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase, migrate } from "../db/database.ts";
import { CanonicalStore } from "../db/store.ts";
import { syncSource } from "./syncSource.ts";
import { createCabinetConnector } from "../fetchers/cabinetConnector.ts";
import { matchAgainst } from "./resolveCabinetIdentity.ts";
import { matchKey, editDistance } from "../../src/lib/nameMatch.ts";
import { getCurrentGovernment } from "../api/currentGovernment.ts";

/**
 * End-to-end synchronisation tests for the Cabinet Office.
 *
 * These run the REAL pipeline — snapshot, change detection, identity
 * resolution, canonical write, history — against fixture HTML instead of the
 * network. That is the only way to assert the behaviours that matter and
 * cannot be observed from a single live fetch: what happens when a minister is
 * replaced, when a portfolio is renamed, and when the source goes down.
 *
 * Each test builds its own in-memory database, so nothing here depends on the
 * order tests run in or on what a previous run left behind.
 */

/** Fixture matching the Cabinet Office's real markup closely enough to parse. */
function rosterHtml(rows: Array<{ name: string; offices: string[]; section?: string }>): string {
  const parts: string[] = ["<html><body>", "<td>Cabinet of Ministers</td>"];
  for (const row of rows) {
    if (row.section) parts.push(`<td><b>${row.section}</b></td>`);
    parts.push(`<td id="cab_normal_text_bold_e">${row.name}</td>`);
    for (const office of row.offices) parts.push(`<td id="cab_normal_text_e">${office}</td>`);
  }
  parts.push("</body></html>");
  return parts.join("\n");
}

const PRESIDENT_SECTION = "President of the Democratic Socialist Republic of Sri Lanka";

function freshStore() {
  const db = openDatabase(":memory:");
  migrate(db, { silent: true });
  const store = new CanonicalStore(db);
  store.upsertSource({
    id: "S006",
    name: "Cabinet Office",
    institution: "Cabinet Office of Sri Lanka",
    sourceType: "executive",
    category: "Executive record",
    url: "https://www.cabinetoffice.gov.lk/",
    description: "Cabinet of Ministers",
    authoritativeFor: [{ factType: "portfolio-assignment", rank: 1 }],
  });
  return { db, store };
}

const connectorFor = (html: string, now = "2026-01-01T00:00:00.000Z") =>
  createCabinetConnector({ fetchHtml: async () => html, now: () => now });

describe("Cabinet Office sync — fetch, parse, apply", () => {
  let store: CanonicalStore;
  beforeEach(() => { store = freshStore().store; });

  it("applies a roster, keeping each portfolio a separate position", async () => {
    const html = rosterHtml([
      { name: "Hon. Anura Karunathilaka", offices: ["Minister of Ports and Civil Aviation", "Minister of Energy"] },
    ]);
    const result = await syncSource(store, connectorFor(html));

    expect(result.outcome).toBe("applied");
    const titles = store.database
      .all<{ title: string }>(`SELECT title FROM position ORDER BY title`)
      .map((r) => r.title);
    // The regression this guards: two portfolios collapsing into one
    // malformed office called "Ports and Civil Aviation and Energy".
    expect(titles).toEqual(["Minister of Energy", "Minister of Ports and Civil Aviation"]);
  });

  it("records a snapshot even when nothing changed", async () => {
    const html = rosterHtml([{ name: "Hon. A Person", offices: ["Minister of Energy"] }]);
    await syncSource(store, connectorFor(html, "2026-01-01T00:00:00.000Z"));
    const second = await syncSource(store, connectorFor(html, "2026-01-02T00:00:00.000Z"));

    expect(second.outcome).toBe("unchanged");
    // Two snapshots: the second is proof the source WAS checked and said the
    // same thing, which is different from not having checked.
    expect(store.database.all(`SELECT id FROM source_snapshot WHERE source_id='S006'`)).toHaveLength(2);
  });

  it("is idempotent — re-running creates no duplicates", async () => {
    const html = rosterHtml([{ name: "Hon. A Person", offices: ["Minister of Energy"] }]);
    await syncSource(store, connectorFor(html));
    await syncSource(store, connectorFor(html), { force: true });

    expect(store.database.all(`SELECT id FROM person`)).toHaveLength(1);
    expect(store.database.all(`SELECT id FROM position`)).toHaveLength(1);
  });

  it("refuses to treat an unparseable page as an empty Cabinet", async () => {
    const result = await syncSource(store, connectorFor("<html><body>nothing here</body></html>"));
    const errors = result.problems.filter((p) => p.severity === "error");
    expect(errors.map((e) => e.code)).toContain("cabinet-empty");
  });

  it("preserves canonical data when the source is unreachable", async () => {
    const html = rosterHtml([{ name: "Hon. A Person", offices: ["Minister of Energy"] }]);
    await syncSource(store, connectorFor(html));

    const failing = createCabinetConnector({
      fetchHtml: async () => { throw new Error("503 Service Unavailable"); },
    });
    const result = await syncSource(store, failing, { retry: { attempts: 1 } });

    expect(result.outcome).toBe("failed");
    expect(result.error).toMatch(/503/);
    // The whole point: a government website going down must not empty the site.
    expect(store.database.all(`SELECT id FROM position WHERE end_date IS NULL`)).toHaveLength(1);
    // And the failure is recorded rather than silently swallowed.
    const snapshot = store.database.all<{ status: string }>(
      `SELECT status FROM source_snapshot ORDER BY retrieved_at DESC LIMIT 1`)[0];
    expect(snapshot!.status).toBe("fetch-failed");
  });
});

describe("Cabinet Office sync — a minister is replaced", () => {
  /**
   * The scenario the Current Government page exists to get right.
   *
   *   version 1: Person A holds Minister of Energy
   *   version 2: Person B holds Minister of Energy
   *
   * A must end, B must begin, A's history must survive, and the government
   * view must show B and not A.
   */
  it("ends the outgoing minister and starts the incoming one", async () => {
    const store = freshStore().store;

    await syncSource(store, connectorFor(
      rosterHtml([{ name: "Hon. Person A", offices: ["Minister of Energy"] }]),
      "2026-01-01T00:00:00.000Z",
    ));

    const after = await syncSource(store, connectorFor(
      rosterHtml([{ name: "Hon. Person B", offices: ["Minister of Energy"] }]),
      "2026-02-01T00:00:00.000Z",
    ));
    expect(after.outcome).toBe("applied");

    const rows = store.database.all<{ name: string; title: string; end_date: string | null }>(
      `SELECT p.canonical_name AS name, pos.title, pos.end_date
         FROM position pos JOIN person p ON p.id = pos.person_id
        ORDER BY p.canonical_name`,
    );

    const a = rows.find((r) => r.name === "Person A")!;
    const b = rows.find((r) => r.name === "Person B")!;

    // A's office ENDED. The row still exists — history is never deleted.
    expect(a.end_date).toBe("2026-02-01");
    expect(b.end_date).toBeNull();

    // Both people still exist; leaving office does not remove a person.
    expect(store.database.all(`SELECT id FROM person`)).toHaveLength(2);

    // And the change is auditable.
    const events = store.database.all<{ change_kind: string }>(
      `SELECT change_kind FROM change_event WHERE entity_type='position'`);
    expect(events.some((e) => e.change_kind === "office-ended")).toBe(true);

    // The government view shows B, and does not show A.
    const government = getCurrentGovernment(store, "2026-02-02T00:00:00.000Z");
    const shown = government.cabinet.map((m) => m.name);
    expect(shown).toContain("Person B");
    expect(shown).not.toContain("Person A");
  });

  it("does not duplicate anything when the same change is synced twice", async () => {
    const store = freshStore().store;
    await syncSource(store, connectorFor(
      rosterHtml([{ name: "Hon. Person A", offices: ["Minister of Energy"] }]), "2026-01-01T00:00:00.000Z"));
    await syncSource(store, connectorFor(
      rosterHtml([{ name: "Hon. Person B", offices: ["Minister of Energy"] }]), "2026-02-01T00:00:00.000Z"));
    await syncSource(store, connectorFor(
      rosterHtml([{ name: "Hon. Person B", offices: ["Minister of Energy"] }]), "2026-03-01T00:00:00.000Z"),
      { force: true });

    expect(store.database.all(`SELECT id FROM person`)).toHaveLength(2);
    expect(store.database.all(`SELECT id FROM position`)).toHaveLength(2);
  });
});

describe("Cabinet Office sync — a portfolio is renamed", () => {
  /**
   *   version 1: Minister of Energy
   *   version 2: Minister of Energy and Power
   *
   * One person, two offices in the record: the old one closed, the new one
   * open. The rename is a real change and is NOT collapsed into the old row,
   * because "Energy" and "Energy and Power" are different portfolios and only
   * the source can say they are related.
   */
  it("keeps history and makes the new title current", async () => {
    const store = freshStore().store;

    await syncSource(store, connectorFor(
      rosterHtml([{ name: "Hon. A Person", offices: ["Minister of Energy"] }]),
      "2026-01-01T00:00:00.000Z",
    ));
    await syncSource(store, connectorFor(
      rosterHtml([{ name: "Hon. A Person", offices: ["Minister of Energy and Power"] }]),
      "2026-02-01T00:00:00.000Z",
    ));

    const rows = store.database.all<{ title: string; end_date: string | null }>(
      `SELECT title, end_date FROM position ORDER BY title`);

    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.title === "Minister of Energy")!.end_date).toBe("2026-02-01");
    expect(rows.find((r) => r.title === "Minister of Energy and Power")!.end_date).toBeNull();

    // Still one person: a renamed portfolio must not fork the human.
    expect(store.database.all(`SELECT id FROM person`)).toHaveLength(1);

    const government = getCurrentGovernment(store, "2026-02-02T00:00:00.000Z");
    const titles = government.cabinet.flatMap((m) => m.offices.map((o) => o.title));
    expect(titles).toEqual(["Minister of Energy and Power"]);
  });
});

describe("Cabinet Office sync — leaving government entirely", () => {
  it("ends the office, keeps the person, and drops them from the view", async () => {
    const store = freshStore().store;

    await syncSource(store, connectorFor(
      rosterHtml([
        { name: "Hon. Stays On", offices: ["Minister of Health"] },
        { name: "Hon. Departs", offices: ["Minister of Energy"] },
      ]),
      "2026-01-01T00:00:00.000Z",
    ));

    await syncSource(store, connectorFor(
      rosterHtml([{ name: "Hon. Stays On", offices: ["Minister of Health"] }]),
      "2026-02-01T00:00:00.000Z",
    ));

    const departed = store.database.all<{ end_date: string | null }>(
      `SELECT pos.end_date FROM position pos JOIN person p ON p.id = pos.person_id
        WHERE p.canonical_name = 'Departs'`)[0]!;
    expect(departed.end_date).toBe("2026-02-01");

    // The person is untouched: still in the database, still findable.
    expect(store.database.all(`SELECT id FROM person WHERE canonical_name='Departs'`)).toHaveLength(1);

    const government = getCurrentGovernment(store, "2026-02-02T00:00:00.000Z");
    expect(government.cabinet.map((m) => m.name)).toEqual(["Stays On"]);
  });
});

describe("identity resolution", () => {
  const candidates = [
    { id: "parliament:161", canonicalName: "Bimal Rathnayake", parliamentId: "161" },
    { id: "parliament:3472", canonicalName: "Anil Jayantha", parliamentId: "3472" },
    { id: "parliament:201", canonicalName: "Sunil Handunnetti", parliamentId: "201" },
    { id: "parliament:1", canonicalName: "Common Name", parliamentId: "1" },
    { id: "parliament:2", canonicalName: "Common Name", parliamentId: "2" },
  ];

  it("matches an identical name exactly", () => {
    const r = matchAgainst("Bimal Rathnayake", candidates);
    expect(r).toMatchObject({ method: "exact", externalIdKey: "parliament", externalId: "161" });
  });

  it("matches across a spelling difference", () => {
    // The Cabinet Office writes "Rathnayaka"; Parliament writes "Rathnayake".
    expect(matchAgainst("Bimal Rathnayaka", candidates)).toMatchObject({ method: "near-spelling", externalId: "161" });
    expect(matchAgainst("Sunil Handunneththi", candidates)).toMatchObject({ method: "near-spelling", externalId: "201" });
  });

  it("matches when one source carries an extra name", () => {
    // "Anil Jayantha Fernando" is a token superset of Parliament's record.
    expect(matchAgainst("Anil Jayantha Fernando", candidates)).toMatchObject({
      method: "token-subset", externalId: "3472",
    });
  });

  it("refuses to guess when two candidates are equally plausible", () => {
    // Merging the wrong two humans is worse than publishing an unmatched one.
    expect(matchAgainst("Common Name", candidates).method).toBe("unresolved");
  });

  it("leaves someone Parliament has never heard of unresolved", () => {
    // The President is not an MP and appears in neither directory.
    expect(matchAgainst("Anura Kumara Dissanayake", candidates).method).toBe("unresolved");
  });

  it("normalises honorifics and punctuation before comparing", () => {
    expect(matchKey("Hon. (Dr.) Nalinda Jayatissa")).toBe("nalinda jayatissa");
    expect(editDistance("rathnayake", "rathnayaka")).toBe(1);
  });
});

describe("the President, who is not a Member of Parliament", () => {
  it("is published even though no parliamentary directory lists him", async () => {
    const store = freshStore().store;
    await syncSource(store, connectorFor(rosterHtml([
      {
        section: PRESIDENT_SECTION,
        name: "Hon. A President",
        offices: ["President and Head of the Cabinet of Ministers", "Minister of Defence"],
      },
    ])));

    const government = getCurrentGovernment(store, "2026-01-02T00:00:00.000Z");
    expect(government.president?.name).toBe("A President");
    // The presidency and the portfolio are separate offices on one person.
    expect(government.president?.offices.map((o) => o.title)).toEqual([
      "President", "Minister of Defence",
    ]);
    // And he is NOT also listed among the Cabinet: one person, one section.
    expect(government.cabinet.map((m) => m.name)).not.toContain("A President");
  });
});
