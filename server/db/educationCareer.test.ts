import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase, migrate, type Database } from "./database.ts";
import { CanonicalStore } from "./store.ts";

/**
 * Education, employment, public service and portrait rights.
 *
 * These tables are almost entirely empty in production, because no
 * authoritative Sri Lankan source publishes the data. The tests still matter:
 * they prove the structures are correct and constrained, so that when a
 * genuine source does appear the data has somewhere correct to land — and
 * they pin the rules that keep unsourced material out.
 */

let db: Database;
let store: CanonicalStore;
const PERSON = "parliament:3449";

beforeEach(() => {
  db = openDatabase(":memory:");
  migrate(db, { silent: true });
  store = new CanonicalStore(db);
  store.upsertSource({
    id: "S001", name: "Parliament", institution: "Parliament of Sri Lanka",
    sourceType: "legislature", category: "Official directory", url: "https://www.parliament.lk/",
  });
  store.upsertPerson({
    id: PERSON, slug: "harini-amarasuriya", canonicalName: "Harini Amarasuriya",
    externalIds: { parliament: "3449" },
  });
});

describe("education", () => {
  it("is empty by default — and that is the honest state", () => {
    // No official Sri Lankan source publishes politicians' education.
    expect(store.listEducation(PERSON)).toEqual([]);
  });

  it("records a school, university and postgraduate entry separately", () => {
    store.upsertEducation({ id: "E1", personId: PERSON, educationType: "school", institution: "A School" });
    store.upsertEducation({ id: "E2", personId: PERSON, educationType: "university", institution: "A University", qualification: "BA" });
    store.upsertEducation({ id: "E3", personId: PERSON, educationType: "postgraduate", institution: "Another University", qualification: "MPhil" });

    const rows = store.listEducation(PERSON) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);
    // Ordered school → university → postgraduate, which is how a reader scans it.
    expect(rows.map((r) => r.education_type)).toEqual(["school", "university", "postgraduate"]);
  });

  it("preserves the precision of a year-only date", () => {
    store.upsertEducation({
      id: "E1", personId: PERSON, educationType: "university",
      institution: "A University", startDate: "1990", endDate: "1994",
    });
    const row = store.listEducation(PERSON)[0] as Record<string, unknown>;
    expect(row.start_date).toBe("1990");
    // Not widened to 1990-01-01.
    expect(row.start_date_precision).toBe("year");
  });

  it("defaults completion to unknown — attending is not graduating", () => {
    store.upsertEducation({ id: "E1", personId: PERSON, educationType: "university", institution: "A University" });
    expect((store.listEducation(PERSON)[0] as Record<string, unknown>).completion).toBe("unknown");
  });

  it("is idempotent: re-recording the same entry does not duplicate it", () => {
    const entry = { id: "E1", personId: PERSON, educationType: "university" as const, institution: "A University" };
    expect(store.upsertEducation(entry).outcome).toBe("created");
    expect(store.upsertEducation(entry).outcome).toBe("unchanged");
    expect(store.listEducation(PERSON)).toHaveLength(1);
  });

  it("reports a changed institution as an update", () => {
    store.upsertEducation({ id: "E1", personId: PERSON, educationType: "university", institution: "A University" });
    const result = store.upsertEducation({ id: "E1", personId: PERSON, educationType: "university", institution: "Another University" });
    expect(result.outcome).toBe("updated");
    expect(result.changes[0]).toMatchObject({ fieldName: "institution", newValue: "Another University" });
  });

  it("refuses to mark an entry verified without a verification date", () => {
    expect(() =>
      store.upsertEducation({
        id: "E1", personId: PERSON, educationType: "university",
        institution: "A University", verification: "verified",
      }),
    ).toThrow();
  });
});

describe("examination results (O/L and A/L)", () => {
  it("holds nothing — individual results are not published for anyone", () => {
    // The Department of Examinations does not publish candidate results.
    // Anything here would have to have been inferred, which is forbidden.
    expect(store.listExamResults(PERSON)).toEqual([]);
  });

  it("stores one row per SUBJECT, not one blob per exam", () => {
    store.upsertExamResult({ id: "X1", personId: PERSON, examType: "al", subject: "Economics", grade: "A" });
    store.upsertExamResult({ id: "X2", personId: PERSON, examType: "al", subject: "Accounting", grade: "B" });

    const rows = store.listExamResults(PERSON, "al") as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => `${r.subject}=${r.grade}`).sort()).toEqual(["Accounting=B", "Economics=A"]);
  });

  it("keeps O/L and A/L apart", () => {
    store.upsertExamResult({ id: "X1", personId: PERSON, examType: "ol", subject: "Mathematics", grade: "A" });
    store.upsertExamResult({ id: "X2", personId: PERSON, examType: "al", subject: "Economics", grade: "A" });
    expect(store.listExamResults(PERSON, "ol")).toHaveLength(1);
    expect(store.listExamResults(PERSON, "al")).toHaveLength(1);
  });

  it("cannot record the same subject twice for one exam", () => {
    store.upsertExamResult({ id: "X1", personId: PERSON, examType: "al", subject: "Economics", grade: "A" });
    store.upsertExamResult({ id: "X2", personId: PERSON, examType: "al", subject: "Economics", grade: "B" });
    const rows = store.listExamResults(PERSON, "al") as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.grade).toBe("B");
  });
});

describe("employment", () => {
  it("is empty by default", () => {
    expect(store.listEmployment(PERSON)).toEqual([]);
  });

  it("does NOT contain political office", () => {
    // Offices live in `position`. A ministry is not a job someone applied
    // for, and listing it here would double-count a career and blur the line
    // the two profile tabs exist to draw.
    store.upsertPosition({
      id: "p1", personId: PERSON, title: "Prime Minister",
      roleType: "prime-minister", institution: "Cabinet of Ministers", currentAsOf: "2026-01-01",
    });
    expect(store.listPositions(PERSON)).toHaveLength(1);
    expect(store.listEmployment(PERSON)).toHaveLength(0);
  });

  it("records an employment entry with its period", () => {
    store.upsertEmployment({
      id: "W1", personId: PERSON, organisation: "A University",
      title: "Lecturer", startDate: "1994", endDate: "2019",
    });
    const row = store.listEmployment(PERSON)[0] as Record<string, unknown>;
    expect(row).toMatchObject({ organisation: "A University", title: "Lecturer", start_date: "1994", end_date: "2019" });
  });

  it("rejects an end date before the start date", () => {
    expect(() =>
      store.upsertEmployment({
        id: "W1", personId: PERSON, organisation: "X", title: "Y",
        startDate: "2020", endDate: "2010",
      }),
    ).toThrow();
  });

  it("is idempotent", () => {
    const row = { id: "W1", personId: PERSON, organisation: "A University", title: "Lecturer" };
    expect(store.upsertEmployment(row).outcome).toBe("created");
    expect(store.upsertEmployment(row).outcome).toBe("unchanged");
    expect(store.listEmployment(PERSON)).toHaveLength(1);
  });
});

describe("public service", () => {
  it("records a commission or board role", () => {
    store.upsertPublicService({
      id: "PS1", personId: PERSON, institution: "National Education Commission",
      role: "Member", startDate: "2017", endDate: "2019",
    });
    expect(store.listPublicService(PERSON)).toHaveLength(1);
  });

  it("is idempotent", () => {
    const row = { id: "PS1", personId: PERSON, institution: "A Commission", role: "Member" };
    store.upsertPublicService(row);
    store.upsertPublicService(row);
    expect(store.listPublicService(PERSON)).toHaveLength(1);
  });
});

describe("profession", () => {
  it("is a scalar on the person, not a manufactured employment record", () => {
    store.setPersonBiographical(PERSON, { profession: "University Lecturer" });
    expect(store.getPerson(PERSON)!.profession).toBe("University Lecturer");
    // Crucially: recording a profession creates no employment row.
    expect(store.listEmployment(PERSON)).toHaveLength(0);
  });

  it("is not erased by a run that did not look at it", () => {
    store.setPersonBiographical(PERSON, { profession: "University Lecturer" });
    store.setPersonBiographical(PERSON, { placeOfBirth: null });
    expect(store.getPerson(PERSON)!.profession).toBe("University Lecturer");
  });

  it("IS cleared when a source explicitly reports none", () => {
    store.setPersonBiographical(PERSON, { profession: "University Lecturer" });
    store.setPersonBiographical(PERSON, { profession: null });
    expect(store.getPerson(PERSON)!.profession).toBeNull();
  });
});

describe("portrait rights", () => {
  it("defaults to unknown rights, so nothing is displayed by assumption", () => {
    expect(store.getPerson(PERSON)!.portrait_rights).toBe("unknown");
  });

  it("records the portrait location even when rights are reserved", () => {
    // parliament.lk states "All Rights Reserved", so the image may not be
    // reused — but knowing where the official portrait lives is still useful.
    store.setPortrait(PERSON, {
      url: "https://www.parliament.lk/uploads/images/members/profile_images/thumbs/3449.jpg",
      sourceId: "S001",
      sourceUrl: "https://www.parliament.lk/en/members-of-parliament/mp-profile/3449",
      credit: "Parliament of Sri Lanka",
      rights: "all-rights-reserved",
      rightsNote: "No reuse licence published.",
      retrievedAt: "2026-08-28T00:00:00.000Z",
    });

    const person = store.getPerson(PERSON)! as unknown as Record<string, unknown>;
    expect(person.portrait_url).toContain("3449.jpg");
    expect(person.portrait_rights).toBe("all-rights-reserved");
    expect(person.portrait_credit).toBe("Parliament of Sri Lanka");
  });

  it("counts stored portraits separately from displayable ones", () => {
    store.setPortrait(PERSON, {
      url: "https://example.gov.lk/p.jpg", sourceId: "S001", rights: "all-rights-reserved",
    });
    const counts = store.counts();
    expect(counts.portraitsStored).toBe(1);
    // Stored is not the same as having an established reuse grant.
    expect(counts.portraitsRightsEstablished).toBe(0);
    expect(counts.portraitsRightsReserved).toBe(1);
  });

  it("counts a properly licensed portrait as rights-established", () => {
    store.setPortrait(PERSON, {
      url: "https://example.gov.lk/p.jpg", sourceId: "S001", rights: "public-domain",
    });
    expect(store.counts().portraitsRightsEstablished).toBe(1);
  });
});
