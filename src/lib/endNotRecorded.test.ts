import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import React from "react";
import { Period } from "../pages/PersonPage.jsx";
import { isCurrent, endedWithoutRecordedDate, formatTenure } from "./positions.ts";
import { allPeople } from "../services/repository.ts";

/**
 * Javora — a missing end date is not a claim that the office is still held.
 *
 * THE DISTINCTION THIS PROTECTS. There are two different facts that both look
 * like "no end date" in the data:
 *
 *   endStatus: "ongoing"       a source SAID the role continues  -> "Present"
 *   endStatus: "not-recorded"  the source did not say either way -> "end not
 *                              recorded"
 *
 * Collapsing them renders an admitted gap as a claim that someone still holds
 * an office they may have left decades ago. On a public-record site that is
 * not a formatting difference; it is the site asserting something no source
 * said. `Period`'s own comment names the failure exactly, and `isCurrent()`
 * carries the same rule for positions ("Treating that silence as 'current' is
 * how a minister who left decades ago ends up displayed as sitting").
 *
 * The rule is enforced in three places, so it is tested in three places: the
 * Period component, the position predicates, and against the real dataset —
 * where, as of 31 August 2026, 314 positions are genuinely ongoing and 56 have
 * an unrecorded end. Those 56 are what this file exists for.
 *
 * This matters most during consolidation. Merging EducationEntry,
 * EmploymentEntry and ServiceEntry into one component with an `ongoing` flag
 * is an easy refactor that silently changes meaning: Education may legitimately
 * be ongoing, Employment and Service deliberately pass no `ongoing` because
 * their source does not say. A boolean prop makes that trivial to get wrong.
 */

const render = (props: {
  start?: string | null;
  end?: string | null;
  ongoing?: boolean;
}) => renderToString(React.createElement(Period as never, props));

describe("Period never invents a continuation", () => {
  it('renders "end not recorded" when there is no end date and no ongoing flag', () => {
    const html = render({ start: "1994-11-12", end: null });
    expect(html).toContain("end not recorded");
  });

  it('does NOT render "Present" in that case — this is the regression', () => {
    const html = render({ start: "1994-11-12", end: null });
    expect(html).not.toContain("Present");
  });

  it('renders "Present" only when a source said the role is ongoing', () => {
    const html = render({ start: "2024-09-23", end: null, ongoing: true });
    expect(html).toContain("Present");
    expect(html).not.toContain("end not recorded");
  });

  it("renders the recorded end date when there is one", () => {
    const html = render({ start: "1989-01-02", end: "1993-05-01" });
    expect(html).not.toContain("Present");
    expect(html).not.toContain("end not recorded");
  });

  it("an explicit end date wins even if ongoing is somehow also set", () => {
    // The two cannot both be true. A recorded end is the stronger statement.
    const html = render({ start: "1989-01-02", end: "1993-05-01", ongoing: true });
    expect(html).not.toContain("Present");
  });

  it('says "Dates not recorded" when the source gave neither date', () => {
    expect(render({ start: null, end: null })).toContain("Dates not recorded");
  });
});

describe("position predicates carry the same rule", () => {
  // `title` is required by PositionLike; the value is irrelevant to these
  // assertions, which are entirely about the date/endStatus combination.
  const base = {
    title: "H.E. the President of the Democratic Socialist Republic of Sri Lanka",
    startDate: "1994-11-12",
    endDate: null,
  } as const;
  const TODAY = new Date("2026-08-31T00:00:00Z");

  it('an open position with endStatus "not-recorded" is NOT current', () => {
    expect(isCurrent({ ...base, endStatus: "not-recorded" }, TODAY)).toBe(false);
  });

  it('an open position with endStatus "ongoing" IS current', () => {
    expect(isCurrent({ ...base, endStatus: "ongoing" }, TODAY)).toBe(true);
  });

  it("endedWithoutRecordedDate identifies exactly the not-recorded case", () => {
    expect(endedWithoutRecordedDate({ ...base, endStatus: "not-recorded" })).toBe(true);
    expect(endedWithoutRecordedDate({ ...base, endStatus: "ongoing" })).toBe(false);
    expect(
      endedWithoutRecordedDate({ ...base, startDate: "1989-01-02", endDate: "1993-05-01" }),
    ).toBe(false);
  });

  it('formatTenure does not append "Present" to an unrecorded end', () => {
    const text = formatTenure({ ...base, endStatus: "not-recorded" }, TODAY);
    expect(text).not.toContain("Present");
    expect(text).toBe("1994");
  });
});

describe("against the real dataset", () => {
  const TODAY = new Date("2026-08-31T00:00:00Z");
  const positions = allPeople(TODAY).flatMap((v) => v.positions);
  const unrecorded = positions.filter(
    (p) => !p.endDate && p.endStatus === "not-recorded",
  );

  it("the corpus actually contains unrecorded-end positions to protect", () => {
    // If this ever reaches zero the tests above stop proving anything about
    // real data, and the failure should be investigated rather than deleted.
    expect(unrecorded.length).toBeGreaterThan(0);
  });

  it("no position with an unrecorded end is treated as currently held", () => {
    expect(unrecorded.filter((p) => isCurrent(p, TODAY))).toEqual([]);
  });

  it('no position with an unrecorded end renders "Present"', () => {
    const leaked = unrecorded
      .map((p) => formatTenure(p, TODAY))
      .filter((text) => text?.includes("Present"));
    expect(leaked).toEqual([]);
  });

  it("positions marked ongoing are the only open ones counted as current", () => {
    const currentOpen = positions.filter((p) => !p.endDate && isCurrent(p, TODAY));
    expect(currentOpen.every((p) => p.endStatus === "ongoing")).toBe(true);
  });
});
