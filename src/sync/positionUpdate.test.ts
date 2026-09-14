import { describe, it, expect } from "vitest";
import { planPositionUpdate, type OpenPosition, type PositionFact } from "./positionUpdate.ts";
import { RoleType } from "../types/models.ts";

const openPosition = (over: Partial<OpenPosition> = {}): OpenPosition => ({
  id: "pos-1",
  title: "Minister of X",
  institution: "Cabinet of Ministers",
  startDate: "2024-01-01",
  endDate: null,
  ...over,
});

const fact = (over: Partial<PositionFact> = {}): PositionFact => ({
  title: "Minister of X",
  roleType: RoleType.CABINET_MINISTER,
  institution: "Cabinet of Ministers",
  ministry: "Ministry of X",
  startDate: "2024-01-01",
  endDate: null,
  appointmentType: "appointed",
  ...over,
});

describe("planPositionUpdate — no existing record", () => {
  it("opens a new position when the person has none for this slot", () => {
    const plan = planPositionUpdate(null, fact());
    expect(plan).toEqual({ action: "open-new", position: fact() });
  });
});

describe("planPositionUpdate — unchanged source", () => {
  it("is a no-op when the incoming fact matches the currently open position", () => {
    const plan = planPositionUpdate(openPosition(), fact());
    expect(plan).toEqual({ action: "no-op", reason: "unchanged" });
  });

  it("matches on title and institution without being sensitive to case or surrounding whitespace", () => {
    const plan = planPositionUpdate(
      openPosition({ title: "Minister of X", institution: "Cabinet of Ministers" }),
      fact({ title: "  minister of x  ", institution: "CABINET OF MINISTERS" }),
    );
    expect(plan.action).toBe("no-op");
  });
});

describe("planPositionUpdate — the worked example: a changed portfolio", () => {
  it("closes the old office and opens the new one — never overwrites in place", () => {
    const current = openPosition({ id: "pos-2024", title: "Minister of X", startDate: "2024-01-01" });
    const incoming = fact({ title: "Minister of Y", ministry: "Ministry of Y", startDate: "2026-01-01" });

    const plan = planPositionUpdate(current, incoming);

    expect(plan).toEqual({
      action: "close-and-open",
      closed: { positionId: "pos-2024", endDate: "2026-01-01" },
      opened: incoming,
    });
  });

  it("preserves history: the plan never asks to delete or mutate the old record, only to close it", () => {
    const current = openPosition({ id: "pos-2024" });
    const plan = planPositionUpdate(current, fact({ title: "Minister of Y", startDate: "2026-01-01" }));
    if (plan.action !== "close-and-open") throw new Error("expected close-and-open");
    // The closed position keeps its identity; only an end date is added.
    expect(plan.closed.positionId).toBe(current.id);
    expect(plan.closed).not.toHaveProperty("title");
    expect(plan.closed).not.toHaveProperty("institution");
  });

  it("uses a source-stated previous end date over the new appointment's start date, when given", () => {
    const current = openPosition({ id: "pos-2024" });
    const incoming = fact({
      title: "Minister of Y",
      startDate: "2026-01-05",
      previousEndDate: "2026-01-01",
    });

    const plan = planPositionUpdate(current, incoming);

    if (plan.action !== "close-and-open") throw new Error("expected close-and-open");
    expect(plan.closed.endDate).toBe("2026-01-01");
  });
});

describe("planPositionUpdate — conflicting source data", () => {
  it("flags a conflict when two sources disagree on the start date of the SAME office", () => {
    const current = openPosition({ startDate: "2024-01-01" });
    const incoming = fact({ startDate: "2024-06-01" }); // same title/institution, different date

    const plan = planPositionUpdate(current, incoming);

    expect(plan.action).toBe("flag-conflict");
  });

  it("flags a conflict rather than guessing an end date for the old office", () => {
    const current = openPosition({ title: "Minister of X" });
    const incoming = fact({ title: "Minister of Y", startDate: null });

    const plan = planPositionUpdate(current, incoming);

    expect(plan.action).toBe("flag-conflict");
    if (plan.action === "flag-conflict") {
      expect(plan.reason).toMatch(/no date was given/i);
    }
  });

  it("does not flag a conflict when only one source has ever reported the office", () => {
    // Guards against the "same office" branch firing on a single source's
    // own re-fetch producing the exact same start date twice.
    const current = openPosition({ startDate: "2024-01-01" });
    const plan = planPositionUpdate(current, fact({ startDate: "2024-01-01" }));
    expect(plan.action).toBe("no-op");
  });
});
