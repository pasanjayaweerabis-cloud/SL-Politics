import { describe, it, expect } from "vitest";
import { normaliseMembers } from "./parliamentConnector.ts";
import type { ParliamentMemberRow } from "../../src/sync/connectors/parliament.ts";

/**
 * Regression coverage for a real bug: a live run of the "operational"
 * Parliament schedule reset 269 members' position `start_date` to NULL,
 * verified against the real database on 1 September 2026.
 *
 * The listing page this connector reads asserts THAT an office is held,
 * never SINCE WHEN — it has no start date to report. That absence must be
 * `undefined` ("this run did not look"), never `null` ("the source looked
 * and confirmed no value"): `store.upsertPosition`'s `keep()` treats the two
 * as opposite instructions, and `null` overwrites a real per-term start date
 * that `scripts/promote-detail.mjs` or `scripts/promote-past-members.mjs`
 * already established from the same member's Legislative History pane —
 * which is exactly what happened the one time this ran against live data
 * with automatic sync enabled.
 */
function row(overrides: Partial<ParliamentMemberRow> = {}): ParliamentMemberRow {
  return {
    parliamentId: "1",
    name: "Hon. Test Member, M.P.",
    profileUrl: "https://www.parliament.lk/en/members-of-parliament/mp-profile/1",
    portraitUrl: null,
    party: "Test Party",
    district: "Colombo",
    role: null,
    dateOfBirth: null,
    profession: null,
    ...overrides,
  };
}

describe("normaliseMembers — position start dates", () => {
  it("never asserts a start date for the Member of Parliament position", () => {
    for (const [people] of [
      [normaliseMembers([row()], "2026-09-01T00:00:00.000Z", true)],
      [normaliseMembers([row()], "2026-09-01T00:00:00.000Z", false)],
    ]) {
      const mp = people[0]!.positions.find((p) => p.title === "Member of Parliament")!;
      expect(mp.startDate).toBeUndefined();
      // The listing page's own retrieval date IS what this connector can
      // truthfully assert — that the office was held as of this check.
      expect(mp.currentAsOf).toBe("2026-09-01");
    }
  });

  it("never asserts a start date for a ministerial or parliamentary office either", () => {
    const [person] = normaliseMembers(
      [row({ role: "Minister of Finance" })],
      "2026-09-01T00:00:00.000Z",
      true,
    );
    const minister = person!.positions.find((p) => p.title === "Minister of Finance")!;
    expect(minister.startDate).toBeUndefined();
  });

  it("leaves dateOfBirth and profession undefined when profiles were not fetched, matching startDate's absence semantics", () => {
    const [person] = normaliseMembers(
      [row({ dateOfBirth: "1970-01-01", profession: "Lawyer" })],
      "2026-09-01T00:00:00.000Z",
      false,
    );
    expect(person!.dateOfBirth).toBeUndefined();
    expect(person!.profession).toBeUndefined();
  });
});
