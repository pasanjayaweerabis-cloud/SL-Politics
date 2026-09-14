import { describe, it, expect } from "vitest";
import { authorityRank, decideAuthority, primarySourceFor, isAuthoritative } from "./authority.ts";
import { reconcileClaims, comparableValue, sameOfficeLikely } from "./reconcile.ts";

/* ==========================================================================
   Fact-specific authority
   ========================================================================== */

describe("fact-specific authority", () => {
  it("makes Parliament primary for parliamentary membership", () => {
    expect(primarySourceFor("parliamentary-membership")).toBe("S001");
  });

  it("makes the Election Commission primary for election results", () => {
    expect(primarySourceFor("election-result")).toBe("S002");
  });

  it("makes the Gazette primary for portfolio assignment, above Parliament", () => {
    // Parliament reprints a portfolio label; the Gazette assigns it legally.
    expect(authorityRank("S005", "portfolio-assignment")).toBeLessThan(
      authorityRank("S001", "portfolio-assignment")!,
    );
  });

  it("does NOT use one global ranking — authority flips by fact type", () => {
    // Parliament outranks the Election Commission on membership...
    expect(authorityRank("S001", "parliamentary-membership")).not.toBeNull();
    expect(authorityRank("S002", "parliamentary-membership")).toBeNull();
    // ...and the Election Commission outranks Parliament on results.
    expect(authorityRank("S002", "election-result")).not.toBeNull();
    expect(authorityRank("S001", "election-result")).toBeNull();
  });

  it("reports a source with no authority for a fact type", () => {
    expect(isAuthoritative("S004", "election-result")).toBe(false);
    expect(isAuthoritative("S004", "qualification")).toBe(true);
  });
});

describe("decideAuthority", () => {
  it("prefers the higher-ranked source", () => {
    const decision = decideAuthority("portfolio-assignment", "S001", "S005");
    expect(decision.outcome).toBe("b-wins");
    if (decision.outcome === "b-wins") expect(decision.sourceId).toBe("S005");
  });

  it("prefers an authoritative source over a non-authoritative one", () => {
    const decision = decideAuthority("election-result", "S002", "S001");
    expect(decision.outcome).toBe("a-wins");
  });

  it("refuses to choose when NEITHER source has authority", () => {
    const decision = decideAuthority("election-result", "S004", "S003");
    expect(decision.outcome).toBe("indeterminate");
  });

  it("refuses to choose between sources of EQUAL rank", () => {
    // Declaration order must never decide a dispute between two official
    // bodies; that is what human review is for.
    const decision = decideAuthority("parliamentary-membership", "S001", "S001");
    expect(decision.outcome).toBe("indeterminate");
    expect(decision.reason).toMatch(/equal authority/i);
  });
});

/* ==========================================================================
   Comparison helpers
   ========================================================================== */

describe("comparableValue", () => {
  it("ignores the cosmetic differences institutions genuinely have", () => {
    expect(comparableValue("Minister of Ports & Civil Aviation"))
      .toBe(comparableValue("Minister of Ports and Civil Aviation"));
    expect(comparableValue("  Minister  of Energy ")).toBe(comparableValue("Minister of Energy"));
    expect(comparableValue("MINISTER OF ENERGY")).toBe(comparableValue("Minister of Energy"));
  });

  it("treats null and empty alike", () => {
    expect(comparableValue(null)).toBe("");
  });
});

describe("sameOfficeLikely", () => {
  it("recognises an elaborated version of the same office", () => {
    expect(sameOfficeLikely("Minister of Energy", "Minister of Energy and Power")).toBe(true);
  });

  it("does NOT merge two genuinely different portfolios", () => {
    expect(sameOfficeLikely("Minister of Energy", "Minister of Health")).toBe(false);
    expect(sameOfficeLikely("Minister of Trade and Commerce", "Minister of Trade and Industry")).toBe(false);
  });

  it("never treats a deputy ministry as the cabinet ministry of the same subject", () => {
    // Two different jobs, held by two different people.
    expect(sameOfficeLikely("Minister of Energy", "Deputy Minister of Energy")).toBe(false);
  });

  it("declines to judge offices that are not ministries", () => {
    expect(sameOfficeLikely("Speaker", "Deputy Speaker")).toBe(false);
  });
});

/* ==========================================================================
   Reconciliation
   ========================================================================== */

describe("reconcileClaims", () => {
  it("is agreement, not conflict, when sources say the same thing", () => {
    const outcome = reconcileClaims("portfolio-assignment", [
      { sourceId: "S001", value: "Minister of Energy" },
      { sourceId: "S005", value: "Minister of Energy" },
    ]);
    expect(outcome.kind).toBe("agreed");
  });

  it("is agreement when sources differ only cosmetically", () => {
    const outcome = reconcileClaims("portfolio-assignment", [
      { sourceId: "S001", value: "Minister of Ports and Civil Aviation" },
      { sourceId: "S005", value: "Minister of Ports & Civil Aviation" },
    ]);
    expect(outcome.kind).toBe("agreed");
  });

  it("is agreement when only one source has spoken", () => {
    const outcome = reconcileClaims("portfolio-assignment", [
      { sourceId: "S001", value: "Minister of Energy" },
      { sourceId: "S005", value: null },
    ]);
    expect(outcome.kind).toBe("agreed");
  });

  it("resolves a genuine disagreement using fact-type authority", () => {
    // The worked example: Parliament says one label, the Gazette another.
    const outcome = reconcileClaims(
      "portfolio-assignment",
      [
        { sourceId: "S001", value: "Minister of Energy", evidenceId: "EV-A" },
        { sourceId: "S005", value: "Minister of Energy and Power", evidenceId: "EV-B" },
      ],
      { treatSimilarOfficesAsSame: true },
    );

    expect(outcome.kind).toBe("resolved");
    if (outcome.kind !== "resolved") return;
    // The Gazette is authoritative for portfolio assignment.
    expect(outcome.winningSourceId).toBe("S005");
    expect(outcome.value).toBe("Minister of Energy and Power");
  });

  it("RETAINS the losing source's claim rather than discarding it", () => {
    const outcome = reconcileClaims(
      "portfolio-assignment",
      [
        { sourceId: "S001", value: "Minister of Energy", evidenceId: "EV-A" },
        { sourceId: "S005", value: "Minister of Energy and Power", evidenceId: "EV-B" },
      ],
      { treatSimilarOfficesAsSame: true },
    );

    expect(outcome.kind).toBe("resolved");
    if (outcome.kind !== "resolved") return;
    // Losing decides which value is displayed. It never deletes the record
    // that the other institution said something different.
    expect(outcome.losing).toHaveLength(1);
    expect(outcome.losing[0]).toMatchObject({ sourceId: "S001", value: "Minister of Energy", evidenceId: "EV-A" });
  });

  it("leaves a disagreement UNRESOLVED when authority cannot settle it", () => {
    const outcome = reconcileClaims("election-result", [
      { sourceId: "S003", value: "12,000" },
      { sourceId: "S004", value: "13,500" },
    ]);
    expect(outcome.kind).toBe("unresolved");
    if (outcome.kind === "unresolved") {
      // Both claims survive for a human to adjudicate.
      expect(outcome.claims).toHaveLength(2);
    }
  });

  it("does not merge offices that are not the same office", () => {
    const outcome = reconcileClaims(
      "portfolio-assignment",
      [
        { sourceId: "S001", value: "Minister of Energy" },
        { sourceId: "S005", value: "Minister of Health" },
      ],
      { treatSimilarOfficesAsSame: true },
    );
    // Two real, different portfolios — not a wording dispute.
    expect(outcome.kind).toBe("unresolved");
  });

  it("handles a source that reports nothing at all", () => {
    const outcome = reconcileClaims("portfolio-assignment", [
      { sourceId: "S001", value: null },
      { sourceId: "S005", value: null },
    ]);
    expect(outcome).toMatchObject({ kind: "agreed", value: null });
  });
});
