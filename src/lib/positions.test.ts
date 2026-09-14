import { describe, it, expect } from "vitest";
import {
  isCurrent,
  isFuture,
  hasEnded,
  tenureOf,
  formatTenure,
  hasInvalidDateRange,
  sortPositions,
  primaryPosition,
  isServing,
  overlappingPositions,
  type PositionLike,
} from "./positions.ts";
import { RoleType } from "../types/models.ts";

const TODAY = new Date(Date.UTC(2026, 7, 28)); // 28 August 2026

const pos = (over: Partial<PositionLike> = {}): PositionLike => ({
  title: "Member of Parliament",
  startDate: "2020-01",
  endDate: null,
  roleType: RoleType.MEMBER_OF_PARLIAMENT,
  ...over,
});

describe("isCurrent", () => {
  it("is current with a past start and no end date", () => {
    expect(isCurrent(pos({ startDate: "2024-09", endDate: null }), TODAY)).toBe(true);
  });

  it("is not current once an end date is recorded", () => {
    expect(isCurrent(pos({ startDate: "2020-01", endDate: "2024-09" }), TODAY)).toBe(false);
  });

  it("is not current without a start date — we cannot assert it began", () => {
    expect(isCurrent(pos({ startDate: null, endDate: null }), TODAY)).toBe(false);
  });

  it("is not current when the office has not yet been assumed", () => {
    expect(isCurrent(pos({ startDate: "2030-01", endDate: null }), TODAY)).toBe(false);
  });

  it("treats a year-only start in the current year as begun", () => {
    expect(isCurrent(pos({ startDate: "2026", endDate: null }), TODAY)).toBe(true);
  });
});

describe("isFuture / hasEnded", () => {
  it("identifies a future start date", () => {
    expect(isFuture("2030-01", TODAY)).toBe(true);
    expect(isFuture("2020-01", TODAY)).toBe(false);
    expect(isFuture(null, TODAY)).toBe(false);
  });

  it("identifies an office whose recorded end has passed", () => {
    expect(hasEnded(pos({ endDate: "2024-09" }), TODAY)).toBe(true);
    expect(hasEnded(pos({ endDate: null }), TODAY)).toBe(false);
  });
});

describe("tenure", () => {
  it("derives an exact tenure from month-precise dates", () => {
    expect(tenureOf(pos({ startDate: "2020-01", endDate: "2024-09" }), TODAY))
      .toEqual({ kind: "exact", years: 4 });
  });

  it("REGRESSION: year-only tenure is a range, not a false exact figure", () => {
    expect(tenureOf(pos({ startDate: "2020", endDate: "2024" }), TODAY))
      .toEqual({ kind: "range", min: 3, max: 4 });
  });

  it("measures an open tenure against today", () => {
    expect(tenureOf(pos({ startDate: "2024-09-21", endDate: null }), TODAY))
      .toEqual({ kind: "exact", years: 1 });
  });

  it("is unknown without a start date", () => {
    expect(tenureOf(pos({ startDate: null }), TODAY).kind).toBe("unknown");
  });
});

describe("formatTenure", () => {
  it("marks a held office as ongoing", () => {
    expect(formatTenure(pos({ startDate: "2024-09", endDate: null }), TODAY))
      .toBe("2024 – Present");
  });

  it("renders a closed range", () => {
    expect(formatTenure(pos({ startDate: "2000-10", endDate: "2024-09" }), TODAY))
      .toBe("2000 – 2024");
  });

  it("collapses a same-year term to a single year", () => {
    expect(formatTenure(pos({ startDate: "2004-04", endDate: "2005-01" }), TODAY))
      .toBe("2004 – 2005");
    expect(formatTenure(pos({ startDate: "2004-04", endDate: "2004-11" }), TODAY))
      .toBe("2004");
  });

  it("does not claim 'Present' for an office that has not begun", () => {
    expect(formatTenure(pos({ startDate: "2030-01", endDate: null }), TODAY)).toBe("2030");
  });

  it("returns null when no start date is recorded", () => {
    expect(formatTenure(pos({ startDate: null }), TODAY)).toBeNull();
  });
});

describe("hasInvalidDateRange", () => {
  it("flags an end date that precedes the start", () => {
    expect(hasInvalidDateRange(pos({ startDate: "2024-01", endDate: "2020-01" }))).toBe(true);
  });

  it("accepts a valid range and incomplete ranges", () => {
    expect(hasInvalidDateRange(pos({ startDate: "2020-01", endDate: "2024-01" }))).toBe(false);
    expect(hasInvalidDateRange(pos({ startDate: "2020-01", endDate: null }))).toBe(false);
  });

  it("does not flag overlapping imprecision as invalid", () => {
    // Start and end in the same year is ambiguous, not contradictory.
    expect(hasInvalidDateRange(pos({ startDate: "2024", endDate: "2024" }))).toBe(false);
  });
});

describe("sorting and headline office", () => {
  const president = pos({
    title: "President of Sri Lanka", roleType: RoleType.PRESIDENT,
    startDate: "2024-09", endDate: null,
  });
  const mp = pos({
    title: "Member of Parliament", roleType: RoleType.MEMBER_OF_PARLIAMENT,
    startDate: "2000-10", endDate: "2024-09",
  });
  const partyLeader = pos({
    title: "Leader of the Janatha Vimukthi Peramuna", roleType: RoleType.PARTY_LEADER,
    startDate: "2014-02", endDate: null,
  });

  it("puts currently-held offices first", () => {
    const sorted = sortPositions([mp, president, partyLeader], TODAY);
    expect(sorted.filter((p) => isCurrent(p, TODAY))).toHaveLength(2);
    expect(isCurrent(sorted[0]!, TODAY)).toBe(true);
  });

  it("leads with the highest-precedence current office", () => {
    expect(primaryPosition([mp, partyLeader, president], TODAY)?.title)
      .toBe("President of Sri Lanka");
  });

  it("falls back to the most recent office when none is current", () => {
    const older = pos({ title: "Mayor of Galle", startDate: "1990-01", endDate: "1994-01" });
    expect(primaryPosition([older, mp], TODAY)?.title).toBe("Member of Parliament");
  });

  it("returns null for a person with no recorded office", () => {
    expect(primaryPosition([], TODAY)).toBeNull();
  });

  it("derives serving status from the positions, not a stored flag", () => {
    expect(isServing([mp], TODAY)).toBe(false);
    expect(isServing([mp, president], TODAY)).toBe(true);
  });
});

describe("overlappingPositions", () => {
  it("reports concurrent offices, which are legitimate", () => {
    const a = pos({ title: "Member of Parliament", startDate: "2020-01", endDate: null });
    const b = pos({ title: "Minister of Finance", startDate: "2022-01", endDate: null });
    expect(overlappingPositions([a, b])).toHaveLength(1);
  });

  it("does not report sequential offices as overlapping", () => {
    const a = pos({ startDate: "2010-01", endDate: "2014-01" });
    const b = pos({ startDate: "2015-01", endDate: "2019-01" });
    expect(overlappingPositions([a, b])).toHaveLength(0);
  });

  it("handles a reappointment to the same office as two separate terms", () => {
    const first = pos({ title: "Prime Minister of Sri Lanka", startDate: "2001-12", endDate: "2004-04" });
    const second = pos({ title: "Prime Minister of Sri Lanka", startDate: "2015-01", endDate: "2019-11" });
    expect(overlappingPositions([first, second])).toHaveLength(0);
    expect(sortPositions([first, second], TODAY)[0]!.startDate).toBe("2015-01");
  });
});
