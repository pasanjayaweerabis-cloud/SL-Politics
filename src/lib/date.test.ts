import { describe, it, expect } from "vitest";
import {
  parseDate,
  isValidDate,
  precisionOf,
  toSortKey,
  toLatestKey,
  formatDate,
  formatDuration,
  formatAge,
  yearsBetween,
  deriveAge,
} from "./date.ts";

/** Fixed "today" so every assertion is deterministic. */
const TODAY = new Date(Date.UTC(2026, 7, 28)); // 28 August 2026

describe("parseDate", () => {
  it("parses a full date and tags day precision", () => {
    expect(parseDate("1968-11-24")).toEqual({
      year: 1968, month: 11, day: 24, precision: "day",
    });
  });

  it("parses a month date and leaves day null", () => {
    expect(parseDate("2024-09")).toEqual({
      year: 2024, month: 9, day: null, precision: "month",
    });
  });

  it("parses a year date and leaves month and day null", () => {
    expect(parseDate("2000")).toEqual({
      year: 2000, month: null, day: null, precision: "year",
    });
  });

  it("rejects non-strings and malformed input", () => {
    for (const bad of [null, undefined, 1968, {}, "", "68", "2024-9", "not-a-date"]) {
      expect(parseDate(bad)).toBeNull();
    }
  });

  it("rejects calendar-invalid dates rather than accepting the shape", () => {
    expect(parseDate("2023-02-30")).toBeNull();
    expect(parseDate("2023-13-01")).toBeNull();
    expect(parseDate("2023-00-01")).toBeNull();
  });

  it("accepts a real leap day and rejects a fake one", () => {
    expect(parseDate("2024-02-29")).not.toBeNull();
    expect(parseDate("2023-02-29")).toBeNull();
  });

  it("exposes validity and precision helpers", () => {
    expect(isValidDate("2024-09")).toBe(true);
    expect(isValidDate("2023-02-30")).toBe(false);
    expect(precisionOf("2024")).toBe("year");
    expect(precisionOf("nonsense")).toBeNull();
  });
});

describe("ordering keys", () => {
  it("widens a partial date to its earliest instant for sorting", () => {
    expect(toSortKey("2024")).toBe(Date.UTC(2024, 0, 1));
    expect(toSortKey("2024-06")).toBe(Date.UTC(2024, 5, 1));
  });

  it("widens a partial date to its latest instant", () => {
    expect(toLatestKey("2024")).toBe(Date.UTC(2024, 11, 31, 23, 59, 59, 999));
    expect(toLatestKey("2024-02")).toBe(Date.UTC(2024, 1, 29, 23, 59, 59, 999));
  });

  it("sorts unparseable dates to the extremes rather than throwing", () => {
    expect(toSortKey(null)).toBe(Number.NEGATIVE_INFINITY);
    expect(toLatestKey(null)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("formatDate", () => {
  it("renders at exactly the precision recorded", () => {
    expect(formatDate("1968-11-24", "long")).toBe("24 November 1968");
    expect(formatDate("1968-11-24", "short")).toBe("Nov 24, 1968");
    expect(formatDate("2024-09", "long")).toBe("September 2024");
    expect(formatDate("2024-09", "short")).toBe("Sep 2024");
    expect(formatDate("2000", "long")).toBe("2000");
  });

  it("never invents a month or day for a year-only date", () => {
    expect(formatDate("2000", "long")).toBe("2000");
    expect(formatDate("2000", "short")).toBe("2000");
  });

  it("returns null rather than a placeholder for missing dates", () => {
    expect(formatDate(null)).toBeNull();
    expect(formatDate("garbage")).toBeNull();
  });
});

describe("yearsBetween — precision honesty", () => {
  it("gives an exact result when both endpoints are day-precise", () => {
    expect(yearsBetween("2000-01-01", "2024-01-01")).toEqual({ kind: "exact", years: 24 });
  });

  it("does not count a year that has not completed", () => {
    expect(yearsBetween("2000-06-15", "2024-06-14")).toEqual({ kind: "exact", years: 23 });
    expect(yearsBetween("2000-06-15", "2024-06-15")).toEqual({ kind: "exact", years: 24 });
  });

  it("returns a RANGE for year-only endpoints instead of a false exact value", () => {
    // From "2020" to "2024" the true gap is 3, 4 or 5 years depending on days.
    expect(yearsBetween("2020", "2024")).toEqual({ kind: "range", min: 3, max: 4 });
  });

  it("returns a range when only one endpoint is imprecise", () => {
    const result = yearsBetween("2020", "2024-06-15");
    expect(result.kind).toBe("range");
  });

  it("collapses to exact when imprecision cannot change the answer", () => {
    // Months far enough apart that no choice of day alters the completed-year
    // count: 1 Jun 2020–31 Aug 2024 and 30 Jun 2020–1 Aug 2024 are both 4.
    expect(yearsBetween("2020-06", "2024-08")).toEqual({ kind: "exact", years: 4 });
  });

  it("keeps a range when adjacent months leave the count genuinely open", () => {
    // 30 Jun 2020 → 1 Jun 2021 is 0 completed years; 1 Jun 2020 → 30 Jun 2021 is 1.
    expect(yearsBetween("2020-06", "2021-06")).toEqual({ kind: "range", min: 0, max: 1 });
  });

  it("reports unknown for a missing start date", () => {
    expect(yearsBetween(null, "2024")).toEqual({ kind: "unknown", reason: "no-start-date" });
  });

  it("reports unknown for malformed input", () => {
    expect(yearsBetween("nope", "2024")).toEqual({ kind: "unknown", reason: "invalid-date" });
    expect(yearsBetween("2020", "nope")).toEqual({ kind: "unknown", reason: "invalid-date" });
  });

  it("reports unknown when the end precedes the start", () => {
    expect(yearsBetween("2024-01-01", "2020-01-01")).toEqual({
      kind: "unknown", reason: "negative-duration",
    });
  });

  it("measures an open interval against the injected today", () => {
    expect(yearsBetween("2024-09-21", null, TODAY)).toEqual({ kind: "exact", years: 1 });
  });
});

describe("deriveAge", () => {
  it("derives an exact age from a full birth date", () => {
    const { duration, atDeath } = deriveAge("1968-11-24", null, TODAY);
    // Birthday has not occurred yet in Aug 2026.
    expect(duration).toEqual({ kind: "exact", years: 57 });
    expect(atDeath).toBe(false);
  });

  it("REGRESSION: a year-only birth date yields a range, not a false exact age", () => {
    // The old implementation returned exactly 58 here, silently treating
    // "1968" as 1 January 1968. Both 57 and 58 are possible.
    const { duration } = deriveAge("1968", null, TODAY);
    expect(duration).toEqual({ kind: "range", min: 57, max: 58 });
  });

  it("narrows to exact when the month alone settles it", () => {
    // Born Nov 1968; in Aug 2026 the birthday has not occurred regardless of day.
    const { duration } = deriveAge("1968-11", null, TODAY);
    expect(duration).toEqual({ kind: "exact", years: 57 });
  });

  it("derives age at death and flags it", () => {
    const { duration, atDeath } = deriveAge("1924-11-17", "2010-03-25", TODAY);
    expect(duration).toEqual({ kind: "exact", years: 85 });
    expect(atDeath).toBe(true);
  });

  it("reports unknown when no birth date is recorded", () => {
    const { duration } = deriveAge(null, null, TODAY);
    expect(duration).toEqual({ kind: "unknown", reason: "no-start-date" });
  });
});

describe("formatting durations honestly", () => {
  it("renders an exact duration", () => {
    expect(formatDuration({ kind: "exact", years: 1 })).toBe("1 yr");
    expect(formatDuration({ kind: "exact", years: 12 })).toBe("12 yrs");
  });

  it("renders a range as a range", () => {
    expect(formatDuration({ kind: "range", min: 3, max: 4 })).toBe("3–4 yrs");
  });

  it("renders nothing for an unknown duration", () => {
    expect(formatDuration({ kind: "unknown", reason: "no-start-date" })).toBeNull();
  });

  it("renders ages with approximate wording only when imprecise", () => {
    expect(formatAge({ kind: "exact", years: 57 })).toBe("57 years old");
    expect(formatAge({ kind: "exact", years: 85 }, true)).toBe("aged 85 at death");
    expect(formatAge({ kind: "range", min: 57, max: 58 })).toBe("approximately 57–58");
    expect(formatAge({ kind: "unknown", reason: "no-start-date" })).toBeNull();
  });
});
