import { describe, it, expect } from "vitest";
import {
  deriveCurrentGovernment, isHeldNow, normaliseOfficeKey, governmentSize,
  type GovPerson, type GovPosition,
} from "./currentGovernment.ts";

const TODAY = "2026-08-29T00:00:00.000Z";

const person = (id: string, name: string): GovPerson => ({
  id, slug: id, canonicalName: name,
});

const position = (over: Partial<GovPosition> & Pick<GovPosition, "id" | "personId" | "roleType">): GovPosition => ({
  title: "Minister of Energy",
  institution: "Cabinet of Ministers",
  ministry: "Energy",
  startDate: null,
  endDate: null,
  currentAsOf: "2026-08-01",
  precedence: 10,
  ...over,
});

describe("isHeldNow", () => {
  it("treats a recorded end date as decisive", () => {
    expect(isHeldNow(position({ id: "p", personId: "a", roleType: "cabinet-minister", endDate: "2025-01-01" }), TODAY)).toBe(false);
  });

  it("does not read an unrecorded end as tenure", () => {
    // The trap this guards: a source that gave a start date and never said
    // when the office ended has NOT said it is still held. Reading that
    // silence as "current" put a President who left in 2005 on the site as
    // the sitting Defence Minister.
    expect(isHeldNow(position({
      id: "p", personId: "a", roleType: "cabinet-minister",
      startDate: "1997-06-09", currentAsOf: null, endStatus: "not-recorded",
    }), TODAY)).toBe(false);
  });

  it("does not show an office that has not begun", () => {
    expect(isHeldNow(position({
      id: "p", personId: "a", roleType: "cabinet-minister",
      startDate: "2027-01-01", currentAsOf: null,
    }), TODAY)).toBe(false);
  });

  it("accepts a dated observation when no start date exists", () => {
    // The Cabinet Office publishes no appointment dates, so `currentAsOf`
    // is the only evidence the office is held.
    expect(isHeldNow(position({
      id: "p", personId: "a", roleType: "cabinet-minister", currentAsOf: "2026-08-01",
    }), TODAY)).toBe(true);
  });

  it("requires SOME temporal evidence", () => {
    expect(isHeldNow(position({
      id: "p", personId: "a", roleType: "cabinet-minister", startDate: null, currentAsOf: null,
    }), TODAY)).toBe(false);
  });
});

describe("deriveCurrentGovernment", () => {
  it("places each person in exactly one section, by their best office", () => {
    // The Prime Minister also holds an education portfolio. She belongs under
    // Prime Minister with both offices on her card — not in two sections.
    const people = [person("pm", "A Premier")];
    const positions = [
      position({ id: "1", personId: "pm", roleType: "prime-minister", title: "Prime Minister", precedence: 2 }),
      position({ id: "2", personId: "pm", roleType: "cabinet-minister", title: "Minister of Education", precedence: 10 }),
    ];
    const g = deriveCurrentGovernment(people, positions, TODAY);

    expect(g.primeMinister?.name).toBe("A Premier");
    expect(g.primeMinister?.offices.map((o) => o.title)).toEqual(["Prime Minister", "Minister of Education"]);
    expect(g.cabinet).toHaveLength(0);
    expect(governmentSize(g)).toBe(1);
  });

  it("shows one card per office when two sources describe the same one", () => {
    // Parliament publishes the appointment DATE; the Cabinet Office publishes
    // that the office is CURRENTLY held. Two rows, one office — rendering
    // both printed "Prime Minister" twice on the Prime Minister's card.
    const people = [person("pm", "A Premier")];
    const positions = [
      position({ id: "parliament:1#pm", personId: "pm", roleType: "prime-minister", title: "Prime Minister", startDate: "2024-11-18", currentAsOf: null, precedence: 2 }),
      position({ id: "cabinet:1#pm", personId: "pm", roleType: "prime-minister", title: "Prime Minister", startDate: null, currentAsOf: "2026-08-01", precedence: 2 }),
    ];
    const g = deriveCurrentGovernment(people, positions, TODAY);

    expect(g.primeMinister?.offices).toHaveLength(1);
    // The more informative record wins: the one that carries a real date.
    expect(g.primeMinister?.offices[0]!.since).toBe("2024-11-18");
  });

  it("keeps a renamed portfolio distinct from the old one", () => {
    // "Minister of Energy" and "Minister of Energy and Power" are different
    // portfolios. Collapsing them would hide a real change.
    expect(normaliseOfficeKey("Minister of Energy")).not.toBe(normaliseOfficeKey("Minister of Energy and Power"));
    // But punctuation and case alone must not create a second office.
    expect(normaliseOfficeKey("Minister of Energy")).toBe(normaliseOfficeKey("MINISTER OF ENERGY"));
  });

  it("omits an ended office, so the holder leaves the page", () => {
    const people = [person("a", "Departed"), person("b", "Serving")];
    const positions = [
      position({ id: "1", personId: "a", roleType: "cabinet-minister", endDate: "2026-02-01" }),
      position({ id: "2", personId: "b", roleType: "cabinet-minister" }),
    ];
    const g = deriveCurrentGovernment(people, positions, TODAY);
    expect(g.cabinet.map((m) => m.name)).toEqual(["Serving"]);
  });

  it("keeps Deputy Ministers out of the Cabinet", () => {
    const people = [person("a", "A Deputy")];
    const positions = [position({ id: "1", personId: "a", roleType: "deputy-minister", precedence: 16 })];
    const g = deriveCurrentGovernment(people, positions, TODAY);
    expect(g.cabinet).toHaveLength(0);
    expect(g.deputyMinisters.map((m) => m.name)).toEqual(["A Deputy"]);
  });

  it("excludes ordinary parliamentary membership entirely", () => {
    // 225 sitting members is the Directory's job. Current Government answers
    // "who runs the country", not "who sits in the House".
    const people = [person("a", "A Backbencher")];
    const positions = [position({
      id: "1", personId: "a", roleType: "member-of-parliament",
      title: "Member of Parliament", precedence: 40,
    })];
    const g = deriveCurrentGovernment(people, positions, TODAY);
    expect(governmentSize(g)).toBe(0);
  });

  it("includes parliamentary leadership offices", () => {
    const people = [person("a", "A Speaker"), person("b", "An Opposition Leader")];
    const positions = [
      position({ id: "1", personId: "a", roleType: "speaker", title: "Speaker", precedence: 8 }),
      position({ id: "2", personId: "b", roleType: "opposition-leader", title: "Leader of the Opposition", precedence: 5 }),
    ];
    const g = deriveCurrentGovernment(people, positions, TODAY);
    expect(g.parliamentaryLeadership.map((m) => m.name).sort()).toEqual(["A Speaker", "An Opposition Leader"]);
  });

  it("never shows the same person twice across sections", () => {
    const people = [person("a", "Busy Person")];
    const positions = [
      position({ id: "1", personId: "a", roleType: "cabinet-minister", title: "Minister of Health", precedence: 10 }),
      position({ id: "2", personId: "a", roleType: "speaker", title: "Speaker", precedence: 8 }),
      position({ id: "3", personId: "a", roleType: "deputy-minister", title: "Deputy Minister of X", precedence: 16 }),
    ];
    const g = deriveCurrentGovernment(people, positions, TODAY);
    const everyone = [
      g.president, g.primeMinister, ...g.cabinet, ...g.deputyMinisters,
      ...g.stateMinisters, ...g.parliamentaryLeadership, ...g.otherMajorLeadership,
    ].filter(Boolean);
    expect(everyone).toHaveLength(1);
    // Placed by their best office — Speaker outranks a ministry here.
    expect(g.parliamentaryLeadership).toHaveLength(1);
  });

  it("ignores a position whose person is not in the dataset", () => {
    const g = deriveCurrentGovernment([], [position({ id: "1", personId: "ghost", roleType: "cabinet-minister" })], TODAY);
    expect(governmentSize(g)).toBe(0);
  });

  it("returns empty sections rather than throwing on no data", () => {
    const g = deriveCurrentGovernment([], [], TODAY);
    expect(g.president).toBeNull();
    expect(g.primeMinister).toBeNull();
    expect(governmentSize(g)).toBe(0);
  });
});
